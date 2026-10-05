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
const KEY_PATTERN = /^vd_[a-z]+_[A-Za-z0-9]{16,64}$/;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9_-]{8,96}$/;

function redact(value, apiKey) {
	let text = String(value === undefined || value === null ? '' : value);
	if (apiKey) text = text.split(apiKey).join('***');
	return text.replace(/(Bearer\s+)\S+/gi, '$1***').replace(/vd_live_[A-Za-z0-9]+/g, 'vd_live_***');
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
		if (!KEY_PATTERN.test(this.#apiKey)) throw new TypeError('apiKey must be a VIDIA API key (vd_live_…). Create one at https://vidia.kr/settings/api');
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
	startRun(params) {
		const p = params || {};
		if (p.confirm !== true) throw new TypeError('startRun needs confirm: true after the user has agreed to the quote.');
		const quoteId = requiredString('quoteId', p.quoteId !== undefined ? p.quoteId : (p.quote && p.quote.id), 64);
		const budget = p.budget !== undefined ? p.budget : (p.quote && p.quote.point && p.quote.point.recommended);
		positiveInteger('budget', budget);
		const idempotencyKey = p.idempotencyKey || 'sdk-' + crypto.randomUUID();
		if (!IDEMPOTENCY_PATTERN.test(idempotencyKey)) throw new TypeError('idempotencyKey must be 8-96 characters of A-Z, a-z, 0-9, _ or -.');
		const body = Object.assign({ package: requiredString('package', p.package, 120), input: p.input || {}, quote_id: quoteId, budget: budget, idempotency_key: idempotencyKey, confirm: true }, settingsBody(p));
		if (p.useCoupon !== undefined) body.use_coupon = Boolean(p.useCoupon);
		if (p.externalConsent !== undefined) body.external_consent = Boolean(p.externalConsent);
		return this.#request('POST', '/api/v1/runs', body).then((run) => Object.assign({ idempotencyKey }, run));
	}

	/** 제작 상태·진행 단계·예상 남은 시간 */
	getRun(id) { return this.#request('GET', '/api/v1/runs/' + runId(id)); }

	/** 내 제작 목록(최근 순) */
	listRuns(query) {
		const q = query || {};
		if (q.state !== undefined && RUN_STATES.indexOf(q.state) < 0) throw new TypeError('state must be one of ' + RUN_STATES.join(', '));
		return this.#request('GET', '/api/v1/runs' + queryString({ state: q.state, limit: q.limit, offset: q.offset }));
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

module.exports = { VidiaClient, VidiaApiError, DEFAULT_BASE_URL, RUN_STATES, FINISHED_STATES, ACTION_STATES, redact };
module.exports.default = VidiaClient;
