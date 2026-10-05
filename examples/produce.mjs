// 견적 → 제작 → 완성 대기 → 영상 받기. 포인트가 듭니다("제작 시작 허용" 권한 키 필요).
// 실행: VIDIA_API_KEY=... node examples/produce.mjs <패키지 slug> "<제목>" "<내용>"
import readline from 'node:readline/promises';
import VidiaClient from 'vidia-api';

const [slug, topic, description] = process.argv.slice(2);
if (!slug || !topic) { console.error('사용법: node examples/produce.mjs <slug> "<제목>" "<내용>"'); process.exit(2); }
const vidia = new VidiaClient({ baseUrl: process.env.VIDIA_BASE_URL });
const input = { topic, description: description || topic };
const quote = await vidia.quote({ package: slug, input });

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question(`권장 예산 ${quote.point.recommended}P(예상 ${quote.point.expected}P)로 제작할까요? [y/N] `);
rl.close();
if (answer.trim().toLowerCase() !== 'y') process.exit(0);

const run = await vidia.startRun({ package: slug, input, quote, confirm: true });
console.log('제작 시작 #' + run.id, run.webUrl);
const done = await vidia.waitForRun(run.id, { onProgress: (r) => console.log(r.stateLabel, r.progress ? `${r.progress.step}/${r.progress.total}` : '') });
if (done.state !== 'COMPLETED') { console.log(done.stateLabel, done.actionNeeded || done.error); process.exit(1); }
const saved = await vidia.downloadVideo(done.id, `./vidia-${done.id}.mp4`);
console.log('저장', saved.path, saved.bytes, 'bytes');
