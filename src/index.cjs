'use strict';

// vidia-api — VIDIA(vidia.kr) 공개 REST API 공식 Node.js 클라이언트. 의존성 0개, Node 18+.
// 견적받기 → 제작 시작 → 진행 확인 → 결과물 다운로드. 키는 Authorization: Bearer 헤더로만 보내고
// 오류·출력에서 가린다. 서명 다운로드 링크에는 키를 붙이지 않는다.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const DEFAULT_BASE_URL = 'https://vidia.kr';
const DEFAULT_TIMEOUT_MS = 60_000;
const QUOTE_TIMEOUT_MS = 180_000;
const RUN_STATES = Object.freeze(['QUEUED', 'RUNNING', 'PAUSED', 'AWAITING_APPROVAL', 'COMPLETED', 'FAILED', 'CANCELLED']);
const FINISHED_STATES = Object.freeze(['COMPLETED', 'FAILED', 'CANCELLED']);
const ACTION_STATES = Object.freeze(['PAUSED', 'AWAITING_APPROVAL']);
const RUN_ACTIONS = Object.freeze(['add_budget', 'approve_price', 'retry', 'resume', 'finish', 'pause', 'set_mode', 'resend_external', 'cancel', 'skip', 'more', 'continue', 'choose', 'partial', 'start', 'acknowledge']);
const TEST_SCENARIOS = Object.freeze(['complete', 'fail', 'budget', 'review']);
const WEBHOOK_EVENTS = Object.freeze(['run.completed', 'run.failed', 'run.cancelled', 'run.action_required']);
const KEY_PATTERN = /^vd_[a-z]+_[A-Za-z0-9]{16,64}$/;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9_-]{8,96}$/;

function redact(value, apiKey) {
	let text = String(value === undefined || value === null ? '' : value);
	if (apiKey) text = text.split(apiKey).join('***');
	return text.replace(/(Bearer\s+)\S+/gi, '$1***').replace(/\b(vd_(?:live|test|oat|ort)_)[A-Za-z0-9]+/g, '$1***').replace(/\bwhsec_[A-Za-z0-9]+/g, 'whsec_***').replace(/(upload_token=)[A-Za-z0-9_.-]+/g, '$1***');
}

class VidiaApiError extends Error {
	constructor(message, options) {
		super(message);
		this.name = 'VidiaApiError';
		this.status = (options && options.status) || 0;
		this.code = (options && options.code) || 'VIDIA_API_ERROR';
		if (options && options.details !== undefined) this.details = options.details;
		if (options && options.requestId) this.requestId = options.requestId;
	}

	toJSON() {
		return { name: this.name, message: this.message, status: this.status, code: this.code, details: this.details, requestId: this.requestId };
	}
}

function requiredString(name, value, maxLength) {
	if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a non-empty string.`);
	const v = value.trim();
	if (maxLength && v.length > maxLength) throw new RangeError(`${name} must not exceed ${maxLength} characters.`);
	return v;
}

function positiveInteger(name, value) {
	if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive integer.`);
	return value;
}

function runId(value) {
	const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
	return positiveInteger('runId', n);
}

function isLocalHost(hostname) { return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'; }

function checkBaseUrl(raw) {
	let url;
	try { url = new URL(raw); } catch { throw new TypeError('baseUrl must be a valid URL.'); }
	if (url.username || url.password) throw new TypeError('baseUrl must not contain credentials.');
	if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalHost(url.hostname))) {
		throw new TypeError('baseUrl must use HTTPS (HTTP is allowed for localhost only).');
	}
	return url.origin + url.pathname.replace(/\/+$/, '');
}

function queryString(params) {
	const q = new URLSearchParams();
	for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
	const s = q.toString();
	return s ? '?' + s : '';
}

// SDK 의 camelCase 설정 → API 의 snake_case 칸.
function settingsBody(p) {
	const body = {};
	if (p.title !== undefined) body.title = p.title;
	if (p.mode !== undefined) body.mode = p.mode;
	if (p.problemPolicy !== undefined) body.problem_policy = p.problemPolicy;
	if (p.loopPolicy !== undefined) body.loop_policy = p.loopPolicy;
	if (p.loopRetries !== undefined) body.loop_retries = p.loopRetries;
	if (p.scheduledAt !== undefined) body.scheduled_at = p.scheduledAt;
	return body;
}

// 웹훅 서명 확인: Vidia-Signature 헤더(t=<초>,v1=<HMAC-SHA256(secret, t + "." + 본문)>)가 이 비밀값으로 만든 것이고 너무 오래되지 않았는지.
// body 는 받은 그대로의 본문 글자(파싱하기 전)여야 한다.
function verifyWebhookSignature(secret, header, body, options) {
	const o = options || {};
	const m = /^t=(\d{1,12}),\s*v1=([0-9a-f]{64})$/.exec(String(header || '').trim());
	if (!m || typeof secret !== 'string' || !secret) return false;
	const tolerance = o.toleranceSec === undefined ? 300 : o.toleranceSec;
	const now = Math.floor((o.now === undefined ? Date.now() : o.now) / 1000);
	if (Math.abs(now - Number(m[1])) > tolerance) return false;
	const text = Buffer.isBuffer(body) ? body.toString('utf8') : String(body === undefined || body === null ? '' : body);
	const want = crypto.createHmac('sha256', secret).update(m[1] + '.' + text).digest();
	const got = Buffer.from(m[2], 'hex');
	return want.length === got.length && crypto.timingSafeEqual(want, got);
}

function sleep(ms, signal) {
	return new Promise((resolve, reject) => {
		if (signal && signal.aborted) return reject(signal.reason || new Error('Aborted'));
		const t = setTimeout(resolve, ms);
		if (signal) signal.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason || new Error('Aborted')); }, { once: true });
	});
}

class VidiaClient {
	#apiKey;
	#fetch;
	#baseUrl;
	#timeoutMs;

	/**
	 * @param {string|{apiKey?: string, baseUrl?: string, timeoutMs?: number, fetch?: Function}} apiKeyOrOptions
	 */
	constructor(apiKeyOrOptions) {
		const options = typeof apiKeyOrOptions === 'string' ? { apiKey: apiKeyOrOptions } : (apiKeyOrOptions || {});
		const key = options.apiKey !== undefined ? options.apiKey : (typeof process !== 'undefined' && process.env ? process.env.VIDIA_API_KEY : undefined);
		this.#apiKey = requiredString('apiKey', key);
		if (!KEY_PATTERN.test(this.#apiKey)) throw new TypeError('apiKey must be a VIDIA API key (vd_live_… or vd_test_…). Create one at https://vidia.kr/settings/api');
		this.#fetch = options.fetch || globalThis.fetch;
		if (typeof this.#fetch !== 'function') throw new TypeError('A Fetch API implementation is required. Use Node.js 18+ or pass options.fetch.');
		this.#baseUrl = checkBaseUrl(options.baseUrl || DEFAULT_BASE_URL);
		this.#timeoutMs = options.timeoutMs === undefined ? null : positiveInteger('timeoutMs', options.timeoutMs);
	}

	get baseUrl() { return this.#baseUrl; }

	async #request(method, pathAndQuery, body, timeoutMs) {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.#timeoutMs || timeoutMs || DEFAULT_TIMEOUT_MS);
		const headers = { Accept: 'application/json', Authorization: `Bearer ${this.#apiKey}`, 'User-Agent': 'vidia-api-node' };
		const init = { method, headers, signal: controller.signal, redirect: 'error' };
		if (body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
		let res;
		try {
			res = await this.#fetch(this.#baseUrl + pathAndQuery, init);
		} catch (error) {
			const timedOut = controller.signal.aborted || (error && error.name === 'AbortError');
			throw new VidiaApiError(timedOut ? 'VIDIA request timed out.' : 'Cannot reach VIDIA: ' + redact(error && error.message, this.#apiKey), { code: timedOut ? 'TIMEOUT' : 'NETWORK_ERROR' });
		} finally {
			clearTimeout(timer);
		}
		const text = await res.text();
		let data = null;
		try { data = text ? JSON.parse(text) : null; } catch { data = null; }
		if (!res.ok) {
			const err = data && data.error ? data.error : {};
			throw new VidiaApiError(redact(err.message || `HTTP ${res.status}`, this.#apiKey), {
				status: res.status, code: err.code || 'HTTP_' + res.status, details: data && data.detail !== undefined ? data.detail : undefined, requestId: err.requestId || (res.headers.get && res.headers.get('x-request-id')) || undefined
			});
		}
		if (data === null) throw new VidiaApiError('VIDIA returned an unexpected response.', { status: res.status, code: 'BAD_RESPONSE' });
		return data;
	}

	/** 잔액·쿠폰·요금제 */
	me() { return this.#request('GET', '/api/v1/me'); }

	/** 발행된 패키지 찾기 */
	listPackages(query) {
		const q = query || {};
		return this.#request('GET', '/api/v1/packages' + queryString({ q: q.q, format: q.format, mix: q.mix, tag: q.tag, sort: q.sort, limit: q.limit, offset: q.offset }));
	}

	/** 패키지 설명과 입력 칸(inputs) */
	getPackage(slug) { return this.#request('GET', '/api/v1/packages/' + encodeURIComponent(requiredString('slug', slug, 120))); }

	/** 제작 견적(무료, 10분 유효) */
	quote(params) {
		const p = params || {};
		const body = Object.assign({ package: requiredString('package', p.package, 120), input: p.input || {} }, settingsBody(p));
		return this.#request('POST', '/api/v1/quotes', body, QUOTE_TIMEOUT_MS);
	}

	/**
	 * 견적대로 제작 시작. 예산만큼 포인트를 먼저 잡아 두고 끝나면 쓰지 않은 만큼 돌려준다.
	 * confirm: true 를 넘겨야 한다(사용자가 견적 금액에 동의했다는 뜻). idempotencyKey 를 생략하면 새로 만든다 —
	 * 응답을 못 받아 다시 보낼 때는 처음 키를 그대로 넘겨야 중복 제작이 생기지 않는다.
	 */
	#startBody(params, batch) {
		const p = params || {};
		if (!batch && p.confirm !== true) throw new TypeError('startRun needs confirm: true after the user has agreed to the quote.');
		const quoteId = requiredString('quoteId', p.quoteId !== undefined ? p.quoteId : (p.quote && p.quote.id), 64);
		const budget = p.budget !== undefined ? p.budget : (p.quote && p.quote.point && p.quote.point.recommended);
		positiveInteger('budget', budget);
		const idempotencyKey = p.idempotencyKey || 'sdk-' + crypto.randomUUID();
		if (!IDEMPOTENCY_PATTERN.test(idempotencyKey)) throw new TypeError('idempotencyKey must be 8-96 characters of A-Z, a-z, 0-9, _ or -.');
		const body = Object.assign({ package: requiredString('package', p.package, 120), input: p.input || {}, quote_id: quoteId, budget: budget, idempotency_key: idempotencyKey, confirm: true }, settingsBody(p));
		if (p.useCoupon !== undefined) body.use_coupon = Boolean(p.useCoupon);
		if (p.externalConsent !== undefined) body.external_consent = Boolean(p.externalConsent);
		if (p.priceTolerance !== undefined) body.price_tolerance = p.priceTolerance;
		if (p.autoResolve !== undefined) body.auto_resolve = Boolean(p.autoResolve);
		if (p.testScenario !== undefined) {
			if (TEST_SCENARIOS.indexOf(p.testScenario) < 0) throw new TypeError('testScenario must be one of ' + TEST_SCENARIOS.join(', '));
			body.test_scenario = p.testScenario;
		}
		return body;
	}

	startRun(params) {
		const body = this.#startBody(params);
		return this.#request('POST', '/api/v1/runs', body).then((run) => Object.assign({ idempotencyKey: body.idempotency_key }, run));
	}

	/**
	 * 제작 상태·진행 단계·예상 남은 시간. 멈췄으면 pending(멈춘 사정)과 actions(지금 보낼 수 있는 동작)가 함께 온다.
	 * options.wait(초, 1~50): 제작이 끝나거나 멈출 때까지 서버가 그만큼 기다렸다 답한다.
	 */
	getRun(id, options) {
		const wait = options && options.wait;
		if (wait !== undefined && (!Number.isInteger(wait) || wait < 1 || wait > 50)) throw new RangeError('wait must be an integer between 1 and 50 (seconds).');
		return this.#request('GET', '/api/v1/runs/' + runId(id) + queryString({ wait: wait }), undefined, wait ? (wait + 30) * 1000 : undefined);
	}

	/**
	 * 멈춘 제작에 동작 하나를 보낸다(getRun 의 actions 중 하나). 포인트를 더 잡는 add_budget·approve_price 와 resend_external 은 confirm: true 가 필요하다.
	 * 예: runAction(id, 'add_budget', { add: 2000, confirm: true }) · runAction(id, 'retry') · runAction(id, 'choose', { stepId: 12 })
	 */
	runAction(id, action, params) {
		if (RUN_ACTIONS.indexOf(action) < 0) throw new TypeError('action must be one of ' + RUN_ACTIONS.join(', '));
		const p = params || {};
		const body = { action: action };
		if (action === 'add_budget') {
			body.add = positiveInteger('add', p.add);
			body.idempotency_key = p.idempotencyKey || 'sdk-' + crypto.randomUUID();
			if (!IDEMPOTENCY_PATTERN.test(body.idempotency_key)) throw new TypeError('idempotencyKey must be 8-96 characters of A-Z, a-z, 0-9, _ or -.');
		}
		if (['add_budget', 'approve_price', 'resend_external'].indexOf(action) >= 0 && p.confirm !== true) throw new TypeError(action + ' needs confirm: true after the user has agreed.');
		if (p.confirm !== undefined) body.confirm = Boolean(p.confirm);
		if (p.approvalId !== undefined) body.approval_id = positiveInteger('approvalId', p.approvalId);
		if (p.headroomPct !== undefined) body.headroom_pct = p.headroomPct;
		if (p.stepId !== undefined) body.step_id = positiveInteger('stepId', p.stepId);
		if (p.rounds !== undefined) body.rounds = p.rounds;
		if (p.mode !== undefined) body.mode = p.mode;
		return this.#request('POST', '/api/v1/runs/' + runId(id) + '/actions', body);
	}

	/** 견적 여러 건 한 번에(최대 10). 건별 결과({ index, ok, quote } 또는 { index, ok: false, status, error })가 온다. */
	batchQuotes(items) {
		if (!Array.isArray(items) || !items.length || items.length > 10) throw new RangeError('items must be an array of 1-10 quote requests.');
		const body = { items: items.map((p) => Object.assign({ package: requiredString('package', p && p.package, 120), input: (p && p.input) || {} }, settingsBody(p || {}))) };
		return this.#request('POST', '/api/v1/batch/quotes', body, QUOTE_TIMEOUT_MS * 2);
	}

	/**
	 * 제작 여러 건 한 번에 시작(최대 10). 건별로 처리된다 — 하나가 거절돼도 나머지는 시작된다.
	 * options.confirm: true 는 모든 건의 금액과 권리 확인·책임 안내에 사용자가 동의했다는 뜻이다.
	 */
	batchStart(items, options) {
		if (!Array.isArray(items) || !items.length || items.length > 10) throw new RangeError('items must be an array of 1-10 start requests.');
		if (!options || options.confirm !== true) throw new TypeError('batchStart needs { confirm: true } after the user has agreed to every quote.');
		const bodies = items.map((p) => { const b = this.#startBody(p, true); delete b.confirm; return b; });
		return this.#request('POST', '/api/v1/batch/runs', { items: bodies, confirm: true }).then((r) => {
			(r.items || []).forEach((it) => { if (it && it.ok && it.run && bodies[it.index]) it.run.idempotencyKey = bodies[it.index].idempotency_key; });
			return r;
		});
	}

	/** 이 제작에 넣었던 입력값과 패키지 slug(같은 내용으로 다시 만들 때) */
	getRunInput(id) { return this.#request('GET', '/api/v1/runs/' + runId(id) + '/input'); }

	/** 끝난 제작을 휴지통으로(30일 뒤 자동 삭제, 그 전에는 복원 가능) */
	trashRun(id) { return this.#request('POST', '/api/v1/runs/' + runId(id) + '/trash', {}); }
	restoreRun(id) { return this.#request('POST', '/api/v1/runs/' + runId(id) + '/restore', {}); }

	/** 대표 썸네일을 자료실 이미지로 바꾸거나({ assetId }) 처음 것으로 되돌린다({ reset: true }) */
	setThumbnail(id, options) {
		const o = options || {};
		if (o.reset === true) return this.#request('POST', '/api/v1/runs/' + runId(id) + '/thumbnail', { reset: true });
		return this.#request('POST', '/api/v1/runs/' + runId(id) + '/thumbnail', { asset_id: positiveInteger('assetId', o.assetId) });
	}

	/** 쇼케이스 공개({ on: true, confirm: true }) · 내리기({ on: false }) */
	setShowcase(id, options) {
		const o = options || {};
		if (typeof o.on !== 'boolean') throw new TypeError('setShowcase needs { on: true | false }.');
		if (o.on && o.confirm !== true) throw new TypeError('Publishing to the showcase needs confirm: true after the user has agreed.');
		return this.#request('POST', '/api/v1/runs/' + runId(id) + '/showcase', o.on ? { on: true, confirm: true } : { on: false });
	}

	/** 사용량: 저장공간·진행 중 제작·제작 시스템 상황·이 키의 남은 제작 수 */
	usage() { return this.#request('GET', '/api/v1/usage'); }

	/** 포인트 내역(최근 순). days: 7 | 30 | 90 */
	pointHistory(query) {
		const q = query || {};
		return this.#request('GET', '/api/v1/points/history' + queryString({ days: q.days, limit: q.limit, page: q.page }));
	}

	/** 패키지에 맞는 추천 주제 한 개. skipId 를 주면 그 주제를 건너뛰고 다음 것을 받는다. */
	topicIdea(slug, options) {
		const base = '/api/v1/packages/' + encodeURIComponent(requiredString('slug', slug, 120)) + '/topic-idea';
		if (options && options.skipId !== undefined) return this.#request('POST', base + '/skip', { idea_id: positiveInteger('skipId', options.skipId) });
		return this.#request('GET', base);
	}

	/** 이 패키지로 만든 공개 결과물(제목·닉네임·썸네일·미리보기 주소) */
	packageResults(slug, query) {
		const q = query || {};
		return this.#request('GET', '/api/v1/packages/' + encodeURIComponent(requiredString('slug', slug, 120)) + '/results' + queryString({ limit: q.limit, offset: q.offset }));
	}

	/** 웹훅: 제작 완성·실패·취소·확인 필요를 https 주소로 알린다. createWebhook 응답의 secret 은 한 번만 온다. */
	listWebhooks() { return this.#request('GET', '/api/v1/webhooks'); }
	createWebhook(params) {
		const p = params || {};
		const body = { url: requiredString('url', p.url, 500) };
		if (p.events !== undefined) {
			if (!Array.isArray(p.events) || p.events.some((e) => WEBHOOK_EVENTS.indexOf(e) < 0)) throw new TypeError('events must be an array of ' + WEBHOOK_EVENTS.join(', '));
			body.events = p.events;
		}
		return this.#request('POST', '/api/v1/webhooks', body);
	}
	deleteWebhook(id) { return this.#request('POST', '/api/v1/webhooks/' + positiveInteger('id', id) + '/delete', {}); }
	enableWebhook(id) { return this.#request('POST', '/api/v1/webhooks/' + positiveInteger('id', id) + '/enable', {}); }
	testWebhook(id) { return this.#request('POST', '/api/v1/webhooks/' + positiveInteger('id', id) + '/test', {}); }
	listWebhookDeliveries(id, query) { return this.#request('GET', '/api/v1/webhooks/' + positiveInteger('id', id) + '/deliveries' + queryString({ limit: query && query.limit })); }

	/** 자료실 파일 이름 바꾸기 · 삭제(되돌릴 수 없어 confirm: true 필요) */
	renameAsset(id, name) { return this.#request('POST', '/api/v1/assets/' + positiveInteger('id', id) + '/rename', { name: requiredString('name', name, 200) }).then((r) => r.asset); }
	deleteAsset(id, options) {
		if (!options || options.confirm !== true) throw new TypeError('deleteAsset needs { confirm: true } — the file cannot be recovered.');
		return this.#request('POST', '/api/v1/assets/' + positiveInteger('id', id) + '/delete', { confirm: true });
	}

	/** 15분짜리 업로드 주소(키 헤더 없이 multipart POST, 칸 이름 file). 키를 넘기기 어려운 곳에서 파일을 올릴 때 쓴다. */
	createUploadLink() { return this.#request('POST', '/api/v1/assets/upload-link', {}); }

	/** 내 제작 목록(최근 순) */
	listRuns(query) {
		const q = query || {};
		if (q.state !== undefined && RUN_STATES.indexOf(q.state) < 0) throw new TypeError('state must be one of ' + RUN_STATES.join(', '));
		return this.#request('GET', '/api/v1/runs' + queryString({ state: q.state, package: q.package, created_from: q.createdFrom, created_to: q.createdTo, trashed: q.trashed === true ? 'true' : undefined, limit: q.limit, offset: q.offset }));
	}

	/** 제작 취소(되돌릴 수 없음). confirmed: 오류로 멈춘 제작을 전액 돌려받고 취소할 때 true */
	cancelRun(id, options) { return this.#request('POST', '/api/v1/runs/' + runId(id) + '/cancel', { confirmed: Boolean(options && options.confirmed) }); }

	/** 내 자료실 파일(asset 입력 칸에 넣을 id). kind: image | video | audio */
	listAssets(query) {
		const q = query || {};
		return this.#request('GET', '/api/v1/assets' + queryString({ kind: q.kind, q: q.q, limit: q.limit }));
	}

	/**
	 * 파일을 자료실에 올린다("제작 시작 허용" 키). 이미지(PNG·JPG·WebP)·영상(MP4·MOV·WebM)·소리(MP3·WAV·M4A), 500MB 이하.
	 * @returns {Promise<{id: number, kind: string, name: string|null, bytes: number|null}>} 돌려받은 id 를 asset 입력 칸에 넣는다.
	 */
	async uploadAsset(filePath, options) {
		const file = requiredString('filePath', filePath);
		const o = options || {};
		const data = await fs.promises.readFile(file);
		const form = new FormData();
		form.append('file', new Blob([data]), path.basename(file));
		if (o.label !== undefined) form.append('label', String(o.label).slice(0, 200));
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.#timeoutMs || 600_000);
		let res;
		try {
			res = await this.#fetch(this.#baseUrl + '/api/v1/assets', { method: 'POST', headers: { Accept: 'application/json', Authorization: `Bearer ${this.#apiKey}`, 'User-Agent': 'vidia-api-node' }, body: form, signal: controller.signal, redirect: 'error' });
		} catch (error) {
			const timedOut = controller.signal.aborted || (error && error.name === 'AbortError');
			throw new VidiaApiError(timedOut ? 'VIDIA upload timed out.' : 'Cannot reach VIDIA: ' + redact(error && error.message, this.#apiKey), { code: timedOut ? 'TIMEOUT' : 'NETWORK_ERROR' });
		} finally {
			clearTimeout(timer);
		}
		const text = await res.text();
		let body = null;
		try { body = text ? JSON.parse(text) : null; } catch { body = null; }
		if (!res.ok) {
			const err = body && body.error ? body.error : {};
			throw new VidiaApiError(redact(err.message || `HTTP ${res.status}`, this.#apiKey), { status: res.status, code: err.code || 'HTTP_' + res.status, details: body && body.detail !== undefined ? body.detail : undefined });
		}
		if (!body || !body.asset) throw new VidiaApiError('VIDIA returned an unexpected response.', { status: res.status, code: 'BAD_RESPONSE' });
		return body.asset;
	}

	/** 결과물 목록과 1시간짜리 서명 다운로드 링크 */
	listFiles(id) { return this.#request('GET', '/api/v1/runs/' + runId(id) + '/files'); }

	/**
	 * 끝날 때까지(또는 사람이 확인해야 할 때까지) 기다린다. COMPLETED·FAILED·CANCELLED·PAUSED·AWAITING_APPROVAL 에서 돌아온다.
	 * @param {number} id
	 * @param {{intervalMs?: number, timeoutMs?: number, signal?: AbortSignal, onProgress?: (run: object) => void}} [options]
	 */
	async waitForRun(id, options) {
		const o = options || {};
		const interval = o.intervalMs === undefined ? 30_000 : positiveInteger('intervalMs', o.intervalMs);
		if (interval < 5_000) throw new RangeError('intervalMs must be at least 5000.');
		const deadline = Date.now() + (o.timeoutMs === undefined ? 6 * 3600_000 : positiveInteger('timeoutMs', o.timeoutMs));
		for (;;) {
			const run = await this.getRun(id);
			if (typeof o.onProgress === 'function') o.onProgress(run);
			if (FINISHED_STATES.indexOf(run.state) >= 0 || ACTION_STATES.indexOf(run.state) >= 0) return run;
			if (Date.now() + interval > deadline) throw new VidiaApiError('Timed out waiting for run ' + id + ' (state ' + run.state + ').', { code: 'WAIT_TIMEOUT', details: { state: run.state } });
			await sleep(interval, o.signal);
		}
	}

	/**
	 * 결과물 하나를 파일로 받는다. file: listFiles 의 항목 또는 그 url.
	 * 링크가 이 클라이언트의 baseUrl 이 아니면 받지 않는다(키는 링크 요청에 붙이지 않는다).
	 * @returns {Promise<{path: string, bytes: number}>}
	 */
	async download(file, destPath) {
		const url = requiredString('url', typeof file === 'string' ? file : file && file.url, 2048);
		const target = new URL(url);
		if (target.origin !== new URL(this.#baseUrl).origin || !target.pathname.startsWith('/api/v1/download/')) {
			throw new TypeError('download only accepts VIDIA download links from listFiles().');
		}
		const dest = requiredString('destPath', destPath);
		const res = await this.#fetch(url, { method: 'GET', redirect: 'error', headers: { 'User-Agent': 'vidia-api-node' } }).catch((error) => {
			throw new VidiaApiError('Cannot reach VIDIA: ' + redact(error && error.message, this.#apiKey), { code: 'NETWORK_ERROR' });
		});
		if (!res.ok || !res.body) {
			let err = {};
			try { err = (JSON.parse(await res.text()) || {}).error || {}; } catch { err = {}; }
			throw new VidiaApiError(err.message || `HTTP ${res.status}`, { status: res.status, code: err.code || 'HTTP_' + res.status });
		}
		await fs.promises.mkdir(path.dirname(path.resolve(dest)), { recursive: true });
		const tmp = dest + '.part';
		await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
		await fs.promises.rename(tmp, dest);
		const stat = await fs.promises.stat(dest);
		return { path: dest, bytes: stat.size };
	}

	/** 완성 영상(mp4)을 받는다. 완성 전이면 VidiaApiError(VIDEO_NOT_READY). */
	async downloadVideo(id, destPath) {
		const files = await this.listFiles(id);
		const video = (files.items || []).find((it) => it.role === 'final_video');
		if (!video) throw new VidiaApiError('Run ' + id + ' has no finished video yet (state ' + files.state + ').', { code: 'VIDEO_NOT_READY', details: { state: files.state } });
		return this.download(video, destPath);
	}

	toJSON() { return { baseUrl: this.#baseUrl }; }
}

module.exports = { VidiaClient, VidiaApiError, DEFAULT_BASE_URL, RUN_STATES, FINISHED_STATES, ACTION_STATES, RUN_ACTIONS, TEST_SCENARIOS, WEBHOOK_EVENTS, verifyWebhookSignature, redact };
module.exports.default = VidiaClient;
