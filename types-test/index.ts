import VidiaClient, { VidiaApiError, RUN_STATES, type Quote, type Run, type RunFile } from '../src/index.js';

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
	void available; void keys; void RUN_STATES;
}

try { await flow(); } catch (e) { if (e instanceof VidiaApiError) { const code: string = e.code; void code; } }
