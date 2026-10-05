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
| `read` 조회·견적만 | `me`, `listPackages`, `getPackage`, `quote`, `getRun`, `listRuns`, `listFiles`, `download` — 포인트를 쓰지 않음 / spends no points |
| `run` 제작 시작 허용 | 위 + `startRun`, `cancelRun` — 키마다 하루 제작 상한 / per-key daily limit |

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
| `getRun(id)` | `GET /api/v1/runs/:id` | 상태·진행·예상 남은 시간 / state, progress, ETA |
| `listRuns(query?)` | `GET /api/v1/runs` | 내 제작 목록 / my productions |
| `cancelRun(id, { confirmed? })` | `POST /api/v1/runs/:id/cancel` | 취소(되돌릴 수 없음) / cancel |
| `listFiles(id)` | `GET /api/v1/runs/:id/files` | 결과물과 1시간짜리 다운로드 링크 / files with 1-hour links |
| `waitForRun(id, opts?)` | — | 완성·실패·취소·확인 대기까지 30초 간격으로 확인 / polls every 30s |
| `download(file, path)` | `GET /api/v1/download/:token` | 결과물 하나를 파일로 / save one file |
| `downloadVideo(id, path)` | — | 완성 영상 mp4 저장 / save the final mp4 |

설정 칸 / Settings: `title`, `mode` (`AUTO`|`MANUAL`), `problemPolicy` (`SKIP`|`ASK`), `loopPolicy` (`ACCEPT`|`ASK`), `loopRetries` (0–5), `scheduledAt`.

## 제작 시작 규칙 / Starting a production

- `confirm: true` 가 있어야 합니다 — 사용자가 견적 금액에 동의했다는 뜻입니다.
- `quote` 객체(또는 `quoteId` + `budget`)를 넘깁니다. 예산을 생략하면 견적의 권장 예산을 씁니다. 예산만큼 포인트를 먼저 잡아 두고 쓰지 않은 만큼 돌려줍니다.
- 견적 때와 같은 `package`·`input`·설정을 보내야 합니다(다르면 `QUOTE_CHANGED`). 견적은 10분 동안 유효합니다(`QUOTE_EXPIRED`).
- `idempotencyKey` 를 생략하면 새로 만들어 결과(`run.idempotencyKey`)에 돌려줍니다. 응답을 못 받아 다시 보낼 때는 그 키를 그대로 넘기면 중복 제작이 생기지 않습니다.
- `PAUSED`·`AWAITING_APPROVAL` 은 사람이 골라야 하는 상태입니다. `run.actionNeeded` 의 웹 주소에서 이어 가세요.

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

주요 코드 / Common codes: `AUTH_REQUIRED`, `AUTH_INVALID`, `SCOPE_FORBIDDEN`, `INPUT_INVALID`, `INPUT_INCOMPLETE`, `PACKAGE_NOT_FOUND`, `QUOTE_EXPIRED`, `QUOTE_CHANGED`, `BUDGET_BELOW_MINIMUM`, `CONFIRM_REQUIRED`, `KEY_DAILY_RUN_LIMIT`, `QUEUE_FULL`, `RATE_LIMITED`, `RUN_NOT_FOUND`, `TIMEOUT`, `NETWORK_ERROR`.

## 더 보기 / More

- [docs/guide.ko.md](docs/guide.ko.md) · [docs/guide.en.md](docs/guide.en.md) — REST 직접 호출(curl) / raw REST with curl
- [examples/](examples/)
- AI 에이전트(Claude·Cursor·Codex)에서 쓰려면 / for AI agents: [`vidia-mcp`](https://www.npmjs.com/package/vidia-mcp)

## License

MIT
