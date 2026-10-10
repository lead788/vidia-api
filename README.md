<div align="center">

# vidia-api — VIDIA AI video API for Node.js

**비디아 AI 영상 제작 API 공식 Node.js SDK** · Official zero-dependency client

[![npm](https://img.shields.io/npm/v/vidia-api?color=%232463eb&label=npm%20vidia-api)](https://www.npmjs.com/package/vidia-api)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

**[vidia.kr](https://vidia.kr)** · **[개발자 가이드 Developer guide](https://vidia.kr/help/guide/developer)** · **[MCP: vidia-mcp](https://www.npmjs.com/package/vidia-mcp)**

</div>

---

비디아(VIDIA)는 패키지(영상 제작 방법)를 고르고 주제만 적으면 대본·음성·이미지·AI 영상·자막까지 만들어 주는 AI 영상 제작 서비스입니다. 이 SDK로 **견적받기 → 제작 시작 → 완성 대기 → 결과물 다운로드**를 몇 줄로 할 수 있습니다.

VIDIA turns a topic into a finished video (script, narration, images, AI video clips, subtitles) using production packages. This SDK lets you **quote, start, wait for and download** productions from Node.js.

- 의존성 0개, Node.js 18+, ESM·CommonJS·TypeScript 타입 / zero dependencies, ESM + CJS + types
- 키는 `Authorization` 헤더로만 보내고 오류 메시지에서 가립니다 / the key only travels in the header and is redacted from errors

## 설치 / Install

```bash
npm i vidia-api
```

## API 키 / API key

[vidia.kr/settings/api](https://vidia.kr/settings/api) 에서 만듭니다. Create one at [vidia.kr/settings/api](https://vidia.kr/settings/api).

| 권한 Scope | 할 수 있는 일 |
|---|---|
| `read` 조회·견적만 | `me`, `listPackages`, `getPackage`, `quote`, `getRun`, `listRuns`, `listAssets`, `listFiles`, `download` — 포인트를 쓰지 않음 / spends no points |
| `run` 제작 시작 허용 | 위 + `startRun`, `cancelRun`, `uploadAsset` — 키마다 하루 제작 상한 / per-key daily limit |

```bash
export VIDIA_API_KEY=YOUR_VIDIA_API_KEY
```

## 빠른 시작 / Quick start

```js
import VidiaClient from 'vidia-api';

const vidia = new VidiaClient(); // VIDIA_API_KEY 환경 변수를 씁니다 / reads VIDIA_API_KEY

// 1) 패키지 고르기 / pick a package
const { items } = await vidia.listPackages({ format: 'shorts', q: '건강' });
const pkg = await vidia.getPackage(items[0].slug);
console.log(pkg.inputs.map((f) => `${f.key}${f.required ? '*' : ''} (${f.type})`));

// 2) 견적 — 무료 / quote — free
const input = { topic: '하품은 왜 옮을까?', description: '하품이 전염되는 이유를 연구 결과로 설명한다.' };
const quote = await vidia.quote({ package: pkg.slug, input });
console.log(quote.point); // { minimum, recommended, expected, ... }

// 3) 제작 시작 — 사용자가 금액에 동의한 뒤 / start — after the user agrees
const run = await vidia.startRun({ package: pkg.slug, input, quote, confirm: true });

// 4) 완성 대기 / wait
const done = await vidia.waitForRun(run.id, { onProgress: (r) => console.log(r.stateLabel, r.progress) });

// 5) 다운로드 / download
if (done.state === 'COMPLETED') await vidia.downloadVideo(done.id, './video.mp4');
else console.log(done.actionNeeded || done.error);
```

CommonJS:

```js
const { VidiaClient } = require('vidia-api');
const vidia = new VidiaClient(process.env.VIDIA_API_KEY);
```

## 메서드 / Methods

| 메서드 Method | REST | 설명 |
|---|---|---|
| `me()` | `GET /api/v1/me` | 잔액·쿠폰·요금제 / balance, coupons, plan |
| `listPackages(query?)` | `GET /api/v1/packages` | 발행된 패키지(`q`, `format`, `mix`, `tag`, `sort`, `limit`, `offset`) |
| `getPackage(slug)` | `GET /api/v1/packages/:slug` | 설명·입력 칸(`inputs`) / details and input fields |
| `quote(params)` | `POST /api/v1/quotes` | 견적(무료, 10분 유효) / quote, valid 10 minutes |
| `startRun(params)` | `POST /api/v1/runs` | 제작 시작(`confirm: true` 필수) / start a production |
| `getRun(id, { wait? })` | `GET /api/v1/runs/:id` | 상태·진행·예상 남은 시간, 멈췄으면 `pending`·`actions`. `wait`(초, 최대 50)로 기다렸다 받기 / state, progress, ETA; long-poll with `wait` |
| `runAction(id, action, params?)` | `POST /api/v1/runs/:id/actions` | 멈춘 제작 풀기(예산 추가·다시 시도·선택·마치기) / resolve a stopped run |
| `batchQuotes(items)` · `batchStart(items, { confirm })` | `POST /api/v1/batch/quotes` · `/batch/runs` | 여러 편 한 번에(최대 10, 건별 결과) / up to 10 at once, per-item results |
| `getRunInput(id)` | `GET /api/v1/runs/:id/input` | 넣었던 입력값(다시 만들 때) / the input you used |
| `trashRun(id)` · `restoreRun(id)` | `POST /api/v1/runs/:id/trash` · `/restore` | 휴지통·복원 / trash and restore |
| `setThumbnail(id, opts)` · `setShowcase(id, opts)` | `POST /api/v1/runs/:id/thumbnail` · `/showcase` | 썸네일 바꾸기, 쇼케이스 공개 / thumbnail, showcase |
| `listRuns(query?)` | `GET /api/v1/runs` | 내 제작 목록 / my productions |
| `cancelRun(id, { confirmed? })` | `POST /api/v1/runs/:id/cancel` | 취소(되돌릴 수 없음) / cancel |
| `listAssets(query?)` | `GET /api/v1/assets` | 내 자료실 파일(asset 입력 칸에 넣을 id) / your library files |
| `uploadAsset(path, { label? })` | `POST /api/v1/assets` | 파일 올리기(`run` 키, 이미지·영상·소리 500MB 이하) / upload (run key) |
| `renameAsset(id, name)` · `deleteAsset(id, { confirm })` · `createUploadLink()` | `POST /api/v1/assets/:id/rename` · `/delete` · `/assets/upload-link` | 자료실 관리, 15분짜리 업로드 주소 / library housekeeping, 15-minute upload URL |
| `listFiles(id)` | `GET /api/v1/runs/:id/files` | 결과물과 1시간짜리 다운로드 링크, 유튜브 업로드 키트(`upload`) / files with 1-hour links and an upload kit |
| `usage()` · `pointHistory(query?)` | `GET /api/v1/usage` · `/points/history` | 사용량, 포인트 내역 / usage, point history |
| `topicIdea(slug, { skipId? })` · `packageResults(slug)` | `GET /api/v1/packages/:slug/topic-idea` · `/results` | 추천 주제, 공개 결과물 / topic ideas, public results |
| `createWebhook(params)` · `listWebhooks()` · `testWebhook(id)` · `deleteWebhook(id)` · `enableWebhook(id)` · `listWebhookDeliveries(id)` | `/api/v1/webhooks…` | 웹훅 / webhooks |
| `verifyWebhookSignature(secret, header, body)` | — | 받은 웹훅의 서명 확인 / verify a received webhook |
| `waitForRun(id, opts?)` | — | 완성·실패·취소·확인 대기까지 30초 간격으로 확인 / polls every 30s |
| `download(file, path)` | `GET /api/v1/download/:token` | 결과물 하나를 파일로 / save one file |
| `downloadVideo(id, path)` | — | 완성 영상 mp4 저장 / save the final mp4 |

설정 칸 / Settings: `title`, `mode` (`AUTO`|`MANUAL`), `problemPolicy` (`SKIP`|`ASK`), `loopPolicy` (`ACCEPT`|`ASK`), `loopRetries` (0–5), `scheduledAt`.

## 사진·영상 입력 / File inputs

입력 칸의 `type` 이 `asset` 이면 자료실 파일 id 를 넣습니다(여러 장이면 배열). / Fields of type `asset` take library file ids.

```js
const photo = await vidia.uploadAsset('./shop.jpg', { label: '가게 사진' });
const input = { topic: '…', user_images: [photo.id] };
```

## 시험용 키 / Test keys

`vd_test_` 로 시작하는 키는 포인트를 쓰지 않습니다. 같은 코드를 그대로 돌리면 실제 영상 대신 약 40초 뒤 견본 결과가 옵니다(응답에 `test: true`). `testScenario` 로 멈춘 상황을 재현합니다. / Test keys cost nothing: the same code gets a sample result after ~40 s.

```js
const run = await vidia.startRun({ package: slug, input, quote, confirm: true, testScenario: 'budget' }); // 'complete' | 'fail' | 'budget' | 'review'
```

## 멈춘 제작 풀기 / Resolving a stopped run

`getRun()` 의 `pending`(멈춘 사정)과 `actions`(지금 보낼 수 있는 동작)를 보고 `runAction()` 을 보냅니다. 포인트를 더 잡는 `add_budget`·`approve_price` 는 사용자 동의 뒤 `confirm: true` 가 필요합니다. / Read `pending` and `actions`, then send one with `runAction()`.

```js
let run = await vidia.getRun(id, { wait: 50 });           // 끝나거나 멈출 때까지 최대 50초 기다림
if (run.pending?.kind === 'BUDGET') run = await vidia.runAction(id, 'add_budget', { add: 2000, confirm: true });
if (run.actions?.includes('retry')) run = await vidia.runAction(id, 'retry');
```

## 웹훅 / Webhooks

```js
const { webhook, secret } = await vidia.createWebhook({ url: 'https://example.com/vidia-hook', events: ['run.completed', 'run.action_required'] });
// 받는 쪽 / in your handler (raw body!):
import { verifyWebhookSignature } from 'vidia-api';
if (!verifyWebhookSignature(secret, req.headers['vidia-signature'], rawBody)) return res.status(400).end();
```

2xx 로 답하면 받은 것으로 봅니다. 아니면 1분·5분·30분·2시간·6시간 뒤 다시 보냅니다. / Answer 2xx; otherwise deliveries are retried.

## 제작 시작 규칙 / Starting a production

- `confirm: true` 가 있어야 합니다 — 사용자가 견적 금액에 동의했다는 뜻입니다.
- `quote` 객체(또는 `quoteId` + `budget`)를 넘깁니다. 예산을 생략하면 견적의 권장 예산을 씁니다. 예산만큼 포인트를 먼저 잡아 두고 쓰지 않은 만큼 돌려줍니다.
- 견적 때와 같은 `package`·`input`·설정을 보내야 합니다(다르면 `QUOTE_CHANGED`). 견적은 10분 동안 유효합니다(`QUOTE_EXPIRED`).
- `idempotencyKey` 를 생략하면 새로 만들어 결과(`run.idempotencyKey`)에 돌려줍니다. 응답을 못 받아 다시 보낼 때는 그 키를 그대로 넘기면 중복 제작이 생기지 않습니다.
- `PAUSED`·`AWAITING_APPROVAL`·`FAILED` 는 고를 것이 있는 상태입니다. `run.pending`·`run.actions` 를 보고 `runAction()` 으로 풀거나 웹에서 이어 가세요.

- Pass `confirm: true` once the user has agreed to the quoted amount.
- Pass the `quote` object (or `quoteId` + `budget`). Points for the budget are held up front; unused points are returned.
- Send the same `package`, `input` and settings as the quote (`QUOTE_CHANGED` otherwise). Quotes expire after 10 minutes (`QUOTE_EXPIRED`).
- Reuse `run.idempotencyKey` when retrying a lost response; it never creates a second production.

## 오류 / Errors

모든 실패는 `VidiaApiError` 입니다 / All failures throw `VidiaApiError`:

```js
import { VidiaApiError } from 'vidia-api';
try { await vidia.startRun({ /* … */ confirm: true }); }
catch (e) { if (e instanceof VidiaApiError) console.log(e.status, e.code, e.message, e.details); }
```

주요 코드 / Common codes: `AUTH_REQUIRED`, `AUTH_INVALID`, `SCOPE_FORBIDDEN`, `INPUT_INVALID`, `INPUT_INCOMPLETE`, `PACKAGE_NOT_FOUND`, `QUOTE_EXPIRED`, `QUOTE_CHANGED`, `BUDGET_BELOW_MINIMUM`, `CONFIRM_REQUIRED`, `KEY_DAILY_RUN_LIMIT`, `KEY_BUDGET_LIMIT`, `KEY_DAILY_BUDGET_LIMIT`, `KEY_IP_NOT_ALLOWED`, `ACTION_NOT_AVAILABLE`, `TEST_KEY_NOT_ALLOWED`, `QUEUE_FULL`, `RATE_LIMITED`, `RUN_NOT_FOUND`, `TIMEOUT`, `NETWORK_ERROR`.

## 더 보기 / More

- [docs/guide.ko.md](docs/guide.ko.md) · [docs/guide.en.md](docs/guide.en.md) — REST 직접 호출(curl) / raw REST with curl
- [examples/](examples/)
- AI 에이전트(Claude·Cursor·Codex)에서 쓰려면 / for AI agents: [`vidia-mcp`](https://www.npmjs.com/package/vidia-mcp)

## License

MIT
