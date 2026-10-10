'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const test = require('node:test');
const { VidiaClient, VidiaApiError, RUN_STATES, RUN_ACTIONS, verifyWebhookSignature, redact } = require('../src/index.cjs');

const KEY = 'vd_live_' + 'Q'.repeat(32);

function jsonResponse(body, status) {
	return new Response(JSON.stringify(body), { status: status || 200, headers: { 'content-type': 'application/json' } });
}
function recorder(replies) {
	const calls = [];
	let i = 0;
	const fetch = async (url, init) => {
		calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined });
		const r = typeof replies === 'function' ? replies(url, init, i) : replies[Math.min(i, replies.length - 1)];
		i += 1;
		return r instanceof Response ? r : jsonResponse(r);
	};
	return { calls, fetch };
}

test('키 확인: vd_ 형식만 받고, 키는 객체 상태·JSON 에 드러나지 않는다', () => {
	assert.throws(() => new VidiaClient({ apiKey: 'sk-abc', fetch: async () => {} }), /VIDIA API key/);
	assert.throws(() => new VidiaClient({ apiKey: '', fetch: async () => {} }), /apiKey/);
	const c = new VidiaClient({ apiKey: KEY, fetch: async () => {} });
	assert.deepEqual(Object.keys(c), []);
	assert.doesNotMatch(JSON.stringify(c), /QQQQ/);
	assert.equal(c.baseUrl, 'https://vidia.kr');
});

test('환경 변수 VIDIA_API_KEY 를 기본 키로 쓴다', () => {
	const prev = process.env.VIDIA_API_KEY;
	process.env.VIDIA_API_KEY = KEY;
	try { assert.equal(new VidiaClient({ fetch: async () => {} }).baseUrl, 'https://vidia.kr'); }
	finally { if (prev === undefined) delete process.env.VIDIA_API_KEY; else process.env.VIDIA_API_KEY = prev; }
});

test('baseUrl: https 만, localhost 는 http 허용, 자격증명 금지', () => {
	assert.equal(new VidiaClient({ apiKey: KEY, baseUrl: 'http://localhost:8080/', fetch: async () => {} }).baseUrl, 'http://localhost:8080');
	assert.throws(() => new VidiaClient({ apiKey: KEY, baseUrl: 'http://vidia.kr', fetch: async () => {} }), /HTTPS/);
	assert.throws(() => new VidiaClient({ apiKey: KEY, baseUrl: 'https://u:p@vidia.kr', fetch: async () => {} }), /credentials/);
});

test('요청: Bearer 헤더·JSON 본문·리다이렉트 금지, 키는 URL 에 없다', async () => {
	const r = recorder([{ items: [], total: 0 }]);
	const c = new VidiaClient({ apiKey: KEY, fetch: r.fetch });
	await c.listPackages({ format: 'shorts', q: '건강', limit: 5 });
	assert.equal(r.calls[0].url, 'https://vidia.kr/api/v1/packages?q=%EA%B1%B4%EA%B0%95&format=shorts&limit=5');
	assert.equal(r.calls[0].init.headers.Authorization, 'Bearer ' + KEY);
	assert.equal(r.calls[0].init.redirect, 'error');
	assert.ok(!r.calls[0].url.includes(KEY));
});

test('견적: package·input 과 설정을 snake_case 로 보낸다', async () => {
	const r = recorder([{ id: 'q1', point: { minimum: 100, recommended: 200 } }]);
	const c = new VidiaClient({ apiKey: KEY, fetch: r.fetch });
	const q = await c.quote({ package: 'pkg', input: { topic: 't' }, problemPolicy: 'ASK', loopRetries: 1, title: '제목' });
	assert.equal(q.id, 'q1');
	assert.equal(r.calls[0].url, 'https://vidia.kr/api/v1/quotes');
	assert.equal(r.calls[0].init.method, 'POST');
	assert.deepEqual(r.calls[0].body, { package: 'pkg', input: { topic: 't' }, problem_policy: 'ASK', loop_retries: 1, title: '제목' });
});

test('제작 시작: confirm 필수, quote 객체에서 id·권장 예산을 쓰고 멱등 키를 만들어 돌려준다', async () => {
	const r = recorder([{ id: 7, state: 'QUEUED', scheduledAt: null, webUrl: 'https://vidia.kr/studio/7' }]);
	const c = new VidiaClient({ apiKey: KEY, fetch: r.fetch });
	assert.throws(() => c.startRun({ package: 'pkg', input: {}, quoteId: 'q', budget: 10 }), /confirm: true/);
	const run = await c.startRun({ package: 'pkg', input: { a: 1 }, quote: { id: 'q9', point: { recommended: 1234 } }, confirm: true, useCoupon: true });
	assert.equal(run.id, 7);
	assert.match(run.idempotencyKey, /^sdk-[0-9a-f-]{36}$/);
	assert.deepEqual(r.calls[0].body, { package: 'pkg', input: { a: 1 }, quote_id: 'q9', budget: 1234, idempotency_key: run.idempotencyKey, confirm: true, use_coupon: true });
	assert.throws(() => c.startRun({ package: 'pkg', input: {}, quoteId: 'q', budget: 10, idempotencyKey: 'bad key!', confirm: true }), /idempotencyKey/);
	assert.throws(() => c.startRun({ package: 'pkg', input: {}, quoteId: 'q', budget: 0, confirm: true }), /budget/);
});

test('오류: 서버의 code·message·detail 을 VidiaApiError 로 옮기고 키를 가린다', async () => {
	const r = recorder([jsonResponse({ error: { code: 'QUOTE_EXPIRED', message: '견적이 만료되었습니다 ' + KEY }, detail: { x: 1 } }, 409)]);
	const c = new VidiaClient({ apiKey: KEY, fetch: r.fetch });
	await assert.rejects(c.getRun(3), (e) => {
		assert.ok(e instanceof VidiaApiError);
		assert.equal(e.status, 409);
		assert.equal(e.code, 'QUOTE_EXPIRED');
		assert.deepEqual(e.details, { x: 1 });
		assert.ok(!e.message.includes(KEY));
		return true;
	});
	const down = new VidiaClient({ apiKey: KEY, fetch: async () => { throw new Error('ECONNREFUSED Bearer ' + KEY); } });
	await assert.rejects(down.me(), (e) => e.code === 'NETWORK_ERROR' && !e.message.includes(KEY));
});

test('runId·state 검사', async () => {
	const c = new VidiaClient({ apiKey: KEY, fetch: async () => jsonResponse({}) });
	assert.throws(() => c.getRun(0), /runId/);
	assert.throws(() => c.getRun('x'), /runId/);
	assert.throws(() => c.listRuns({ state: 'DONE' }), /state/);
	assert.equal(RUN_STATES.length, 7);
});

test('waitForRun: 진행 중이면 기다리고, 완성·확인 대기에서 돌아온다', async () => {
	const states = ['QUEUED', 'RUNNING', 'COMPLETED'];
	let n = 0;
	const seen = [];
	const c = new VidiaClient({ apiKey: KEY, fetch: async () => jsonResponse({ id: 5, state: states[n++] }) });
	const t0 = Date.now();
	const origSet = global.setTimeout;
	global.setTimeout = (fn) => origSet(fn, 0); // 기다림을 건너뛴다
	try {
		const run = await c.waitForRun(5, { intervalMs: 5000, onProgress: (r) => seen.push(r.state) });
		assert.equal(run.state, 'COMPLETED');
	} finally { global.setTimeout = origSet; }
	assert.deepEqual(seen, states);
	assert.ok(Date.now() - t0 < 5000);
	const paused = new VidiaClient({ apiKey: KEY, fetch: async () => jsonResponse({ id: 6, state: 'AWAITING_APPROVAL' }) });
	assert.equal((await paused.waitForRun(6)).state, 'AWAITING_APPROVAL');
	await assert.rejects(c.waitForRun(5, { intervalMs: 1000 }), /intervalMs/);
});

test('download: 다른 주소의 링크는 거절, 키를 붙이지 않고 파일로 저장한다(로컬 서버)', async () => {
	const body = Buffer.alloc(70_000, 7);
	let seenAuth = 'unset';
	const server = http.createServer((req, res) => {
		if (req.url === '/api/v1/runs/9/files') {
			res.setHeader('content-type', 'application/json');
			const port = server.address().port;
			return res.end(JSON.stringify({ runId: 9, state: 'COMPLETED', items: [{ id: 'final', role: 'final_video', url: `http://localhost:${port}/api/v1/download/tok.sig` }] }));
		}
		if (req.url.startsWith('/api/v1/download/')) { seenAuth = req.headers.authorization; res.setHeader('content-type', 'video/mp4'); return res.end(body); }
		res.statusCode = 404; res.end('{}');
	});
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	const port = server.address().port;
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidia-api-'));
	try {
		const c = new VidiaClient({ apiKey: KEY, baseUrl: `http://localhost:${port}` });
		await assert.rejects(c.download('https://evil.example/api/v1/download/x', path.join(dir, 'a.mp4')), /VIDIA download links/);
		await assert.rejects(c.download(`http://localhost:${port}/other`, path.join(dir, 'a.mp4')), /VIDIA download links/);
		const out = await c.downloadVideo(9, path.join(dir, 'sub', 'v.mp4'));
		assert.equal(out.bytes, body.length);
		assert.equal(fs.readFileSync(out.path).length, body.length);
		assert.equal(seenAuth, undefined);
		assert.ok(!fs.existsSync(out.path + '.part'));
	} finally {
		server.close();
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test('uploadAsset: multipart file·label 을 Bearer 로 보내고 asset 을 돌려준다, 목록은 kind 로 거른다', async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidia-up-'));
	const file = path.join(dir, '사진.png');
	fs.writeFileSync(file, Buffer.from([1, 2, 3]));
	const seen = [];
	const c = new VidiaClient({ apiKey: KEY, fetch: async (url, init) => { seen.push({ url, init }); return url.endsWith('/api/v1/assets') && init.method === 'POST' ? jsonResponse({ asset: { id: 41, kind: 'image', name: '사진' } }, 201) : jsonResponse({ items: [] }); } });
	try {
		const a = await c.uploadAsset(file, { label: '사진' });
		assert.equal(a.id, 41);
		assert.equal(seen[0].init.headers.Authorization, 'Bearer ' + KEY);
		assert.ok(seen[0].init.body instanceof FormData);
		assert.equal(seen[0].init.body.get('label'), '사진');
		assert.equal(seen[0].init.body.get('file').name, '사진.png');
		await c.listAssets({ kind: 'image', limit: 5 });
		assert.equal(seen[1].url, 'https://vidia.kr/api/v1/assets?kind=image&limit=5');
		const bad = new VidiaClient({ apiKey: KEY, fetch: async () => jsonResponse({ error: { code: 'SCOPE_FORBIDDEN', message: 'x' } }, 403) });
		await assert.rejects(bad.uploadAsset(file), (e) => e.code === 'SCOPE_FORBIDDEN' && e.status === 403);
	} finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('downloadVideo: 완성 영상이 없으면 VIDEO_NOT_READY', async () => {
	const c = new VidiaClient({ apiKey: KEY, fetch: async () => jsonResponse({ runId: 1, state: 'RUNNING', items: [] }) });
	await assert.rejects(c.downloadVideo(1, 'x.mp4'), (e) => e.code === 'VIDEO_NOT_READY');
});

test('redact', () => {
	assert.equal(redact('a ' + KEY, KEY), 'a ***');
	assert.equal(redact('Bearer abc', ''), 'Bearer ***');
	assert.equal(redact('x vd_live_abc123', ''), 'x vd_live_***');
});

test('ESM 진입점이 같은 클래스를 내보낸다', async () => {
	const esm = await import('../src/index.js');
	assert.equal(esm.VidiaClient, VidiaClient);
	assert.equal(esm.default, VidiaClient);
});

test('공개 메타데이터', () => {
	const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
	assert.equal(pkg.name, 'vidia-api');
	assert.equal(pkg.repository.url, 'git+https://github.com/lead788/vidia-api.git');
	assert.equal(pkg.publishConfig.access, 'public');
	assert.deepEqual(Object.keys(pkg.dependencies || {}), []);
	const readme = fs.readFileSync(path.join(__dirname, '../README.md'), 'utf8');
	assert.doesNotMatch(readme, /vd_live_[A-Za-z0-9]{32}/);
	for (const m of ['quote', 'startRun', 'waitForRun', 'downloadVideo', 'uploadAsset', 'listAssets']) assert.match(readme, new RegExp(m));
});

// ---- 1.2.0 ----
test('시험용 키도 받고, 가릴 때 시험용 키·웹훅 비밀값·업로드 토큰도 가린다', () => {
	assert.equal(new VidiaClient({ apiKey: 'vd_test_' + 'T'.repeat(32), fetch: async () => {} }).baseUrl, 'https://vidia.kr');
	const out = redact('key vd_test_ABCDEFGH1234 secret whsec_ZZZZ1234 url https://vidia.kr/api/v1/assets?upload_token=aaa.bbb-ccc');
	assert.doesNotMatch(out, /ABCDEFGH|ZZZZ1234|aaa\.bbb/);
});

test('getRun wait: 1~50 초만, 쿼리로 보낸다', async () => {
	const r = recorder([{ id: 7, state: 'COMPLETED' }]);
	const c = new VidiaClient({ apiKey: KEY, fetch: r.fetch });
	await c.getRun(7, { wait: 45 });
	assert.equal(r.calls[0].url, 'https://vidia.kr/api/v1/runs/7?wait=45');
	assert.throws(() => c.getRun(7, { wait: 51 }), /wait/);
	assert.throws(() => c.getRun(7, { wait: 0 }), /wait/);
});

test('runAction: 동작 이름 확인, 포인트를 더 잡는 동작은 confirm 필수, snake_case 로 보낸다', async () => {
	const r = recorder([{ id: 7, state: 'RUNNING' }]);
	const c = new VidiaClient({ apiKey: KEY, fetch: r.fetch });
	assert.ok(RUN_ACTIONS.includes('add_budget'));
	assert.throws(() => c.runAction(7, 'explode'), /action must be one of/);
	assert.throws(() => c.runAction(7, 'add_budget', { add: 1000 }), /confirm: true/);
	assert.throws(() => c.runAction(7, 'approve_price', {}), /confirm: true/);
	await c.runAction(7, 'add_budget', { add: 1000, confirm: true, idempotencyKey: 'budget-key-1' });
	assert.equal(r.calls[0].url, 'https://vidia.kr/api/v1/runs/7/actions');
	assert.deepEqual(r.calls[0].body, { action: 'add_budget', add: 1000, idempotency_key: 'budget-key-1', confirm: true });
	await c.runAction(7, 'choose', { stepId: 12 });
	assert.deepEqual(r.calls[1].body, { action: 'choose', step_id: 12 });
	await c.runAction(7, 'retry');
	assert.deepEqual(r.calls[2].body, { action: 'retry' });
});

test('startRun: 시가 허용·자동 처리·시험 시나리오를 보낸다', async () => {
	const r = recorder([{ id: 9000000001, state: 'QUEUED', test: true }]);
	const c = new VidiaClient({ apiKey: KEY, fetch: r.fetch });
	const run = await c.startRun({ package: 'p', input: {}, quoteId: 'q1', budget: 3000, confirm: true, priceTolerance: 20, autoResolve: false, testScenario: 'budget' });
	assert.equal(r.calls[0].body.price_tolerance, 20);
	assert.equal(r.calls[0].body.auto_resolve, false);
	assert.equal(r.calls[0].body.test_scenario, 'budget');
	assert.match(run.idempotencyKey, /^sdk-/);
	assert.throws(() => c.startRun({ package: 'p', input: {}, quoteId: 'q1', budget: 3000, confirm: true, testScenario: 'boom' }), /testScenario/);
});

test('batchStart: confirm 은 한 번, 건마다 식별자를 만들고 결과에 돌려준다', async () => {
	const r = recorder([{ total: 2, started: 1, failed: 1, items: [{ index: 0, ok: true, run: { id: 11, state: 'QUEUED' } }, { index: 1, ok: false, status: 422, error: { code: 'BUDGET_BELOW_MINIMUM', message: 'x' } }] }]);
	const c = new VidiaClient({ apiKey: KEY, fetch: r.fetch });
	const items = [{ package: 'p', input: {}, quoteId: 'q1', budget: 3000 }, { package: 'p', input: {}, quoteId: 'q2', budget: 1 }];
	assert.throws(() => c.batchStart(items), /confirm: true/);
	assert.throws(() => c.batchStart([], { confirm: true }), /1-10/);
	const out = await c.batchStart(items, { confirm: true });
	assert.equal(r.calls[0].url, 'https://vidia.kr/api/v1/batch/runs');
	assert.equal(r.calls[0].body.confirm, true);
	assert.equal(r.calls[0].body.items.length, 2);
	assert.equal(r.calls[0].body.items[0].confirm, undefined);
	assert.notEqual(r.calls[0].body.items[0].idempotency_key, r.calls[0].body.items[1].idempotency_key);
	assert.equal(out.items[0].run.idempotencyKey, r.calls[0].body.items[0].idempotency_key);
	assert.equal(out.items[1].error.code, 'BUDGET_BELOW_MINIMUM');
});

test('웹훅·마무리·자료실: 경로와 본문, 되돌릴 수 없는 일은 confirm 필수', async () => {
	const r = recorder([{}]);
	const c = new VidiaClient({ apiKey: KEY, fetch: r.fetch });
	await c.createWebhook({ url: 'https://example.com/h', events: ['run.completed'] });
	assert.deepEqual([r.calls[0].url, r.calls[0].body], ['https://vidia.kr/api/v1/webhooks', { url: 'https://example.com/h', events: ['run.completed'] }]);
	assert.throws(() => c.createWebhook({ url: 'https://example.com/h', events: ['run.deleted'] }), /events/);
	assert.throws(() => c.setShowcase(7, { on: true }), /confirm: true/);
	await c.setShowcase(7, { on: false });
	assert.deepEqual(r.calls[1].body, { on: false });
	await c.setThumbnail(7, { assetId: 5 });
	assert.deepEqual([r.calls[2].url, r.calls[2].body], ['https://vidia.kr/api/v1/runs/7/thumbnail', { asset_id: 5 }]);
	assert.throws(() => c.deleteAsset(5), /confirm: true/);
	await c.topicIdea('pkg', { skipId: 3 });
	assert.deepEqual([r.calls[3].url, r.calls[3].body], ['https://vidia.kr/api/v1/packages/pkg/topic-idea/skip', { idea_id: 3 }]);
	await c.listRuns({ package: 'pkg', trashed: true, createdFrom: '2026-10-01T00:00:00Z' });
	assert.equal(r.calls[4].url, 'https://vidia.kr/api/v1/runs?package=pkg&created_from=2026-10-01T00%3A00%3A00Z&trashed=true');
});

test('웹훅 서명 확인: 같은 비밀값·본문·시각만 통과', () => {
	const crypto = require('node:crypto');
	const now = Date.UTC(2026, 9, 10), t = Math.floor(now / 1000), body = '{"id":"evt_1"}';
	const header = 't=' + t + ',v1=' + crypto.createHmac('sha256', 'whsec_a').update(t + '.' + body).digest('hex');
	assert.equal(verifyWebhookSignature('whsec_a', header, body, { now }), true);
	assert.equal(verifyWebhookSignature('whsec_a', header, Buffer.from(body), { now }), true);
	assert.equal(verifyWebhookSignature('whsec_b', header, body, { now }), false);
	assert.equal(verifyWebhookSignature('whsec_a', header, body + ' ', { now }), false);
	assert.equal(verifyWebhookSignature('whsec_a', header, body, { now: now + 301000 }), false);
	assert.equal(verifyWebhookSignature('whsec_a', '', body, { now }), false);
	assert.equal(verifyWebhookSignature('', header, body, { now }), false);
});

