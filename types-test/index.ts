import VidiaClient, { VidiaApiError, RUN_STATES, verifyWebhookSignature, type Quote, type Run, type RunFile } from '../src/index.js';

const client = new VidiaClient({ apiKey: 'vd_live_' + 'a'.repeat(32), baseUrl: 'https://vidia.kr' });

async function flow(): Promise<void> {
	const account = await client.me();
	const available: number = account.balance.available;
	const page = await client.listPackages({ format: 'shorts', limit: 5 });
	const slug: string = page.items[0].slug;
	const detail = await client.getPackage(slug);
	const keys: string[] = detail.inputs.map((f) => f.key);
	const quote: Quote = await client.quote({ package: slug, input: { topic: '하품은 왜 옮을까?' }, mode: 'AUTO' });
	const started = await client.startRun({ package: slug, input: { topic: '하품은 왜 옮을까?' }, quote, confirm: true });
	const run: Run = await client.waitForRun(started.id, { intervalMs: 30_000, onProgress: (r) => r.progress?.step });
	const files = await client.listFiles(run.id);
	const video: RunFile | undefined = files.items.find((f) => f.role === 'final_video');
	if (video) await client.download(video, './out.mp4');
	await client.downloadVideo(run.id, './out.mp4');
	const up = await client.uploadAsset('./photo.png', { label: '사진' });
	const lib = await client.listAssets({ kind: 'image' });
	const assetId: number = up.id + lib.items.length;
	void assetId;
	const waited = await client.getRun(run.id, { wait: 30 });
	const kind: string | undefined = waited.pending?.kind;
	if (waited.actions?.includes('add_budget')) await client.runAction(run.id, 'add_budget', { add: 1000, confirm: true });
	const batch = await client.batchStart([{ package: slug, input: {}, quote }], { confirm: true });
	const first = batch.items[0];
	if (first.ok) { const startedId: number = first.run.id; void startedId; } else { const code: string = first.error.code; void code; }
	const hook = await client.createWebhook({ url: 'https://example.com/hook', events: ['run.completed'] });
	const okSig: boolean = verifyWebhookSignature(hook.secret, 't=1,v1=' + 'a'.repeat(64), '{}');
	const usage = await client.usage();
	const left: number | null = usage.key ? usage.key.runsLeft : null;
	const title: string | undefined = files.upload?.titles[0];
	await client.setShowcase(run.id, { on: true, confirm: true });
	await client.setThumbnail(run.id, { reset: true });
	void kind; void okSig; void left; void title;
	void available; void keys; void RUN_STATES;
}

try { await flow(); } catch (e) { if (e instanceof VidiaApiError) { const code: string = e.code; void code; } }
