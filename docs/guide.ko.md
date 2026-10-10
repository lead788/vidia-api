# 비디아 REST API 가이드

기본 주소: `https://vidia.kr` · 인증: 모든 요청에 `Authorization: Bearer <API 키>` · 본문: JSON · 메서드: GET·POST

키는 [vidia.kr/settings/api](https://vidia.kr/settings/api) 에서 만듭니다. `read` 키는 조회·견적·결과물 받기만, `run` 키는 제작 시작·취소까지 합니다.

## 1. 패키지 찾기

```bash
curl -H "Authorization: Bearer $VIDIA_API_KEY" "https://vidia.kr/api/v1/packages?format=shorts&q=건강&limit=5"
```

응답: `{ total, limit, offset, items: [{ slug, title, summary, format, tags, official, estimate: { point: { expected, low, high }, minutes }, url }] }`

## 2. 입력 칸 확인

```bash
curl -H "Authorization: Bearer $VIDIA_API_KEY" https://vidia.kr/api/v1/packages/<slug>
```

`inputs` 의 각 칸(`key`, `label`, `type`, `required`, `options`, `maxLength`, `default`, `showWhen` …)을 `input` 객체로 채웁니다. `showWhen` 이 있으면 그 칸은 다른 칸 값이 맞을 때만 씁니다. `asset` 칸은 비디아 자료실에 올린 파일 id 입니다.

## 3. 견적(무료)

```bash
curl -X POST -H "Authorization: Bearer $VIDIA_API_KEY" -H "Content-Type: application/json" \
  -d '{"package":"<slug>","input":{"topic":"하품은 왜 옮을까?","description":"하품이 전염되는 이유를 연구 결과로 설명한다."}}' \
  https://vidia.kr/api/v1/quotes
```

선택 설정: `title`, `mode`(AUTO·MANUAL), `problem_policy`(SKIP·ASK), `loop_policy`(ACCEPT·ASK), `loop_retries`(0~5), `scheduled_at`.

응답(201): `{ id, expiresAt, point: { minimum, recommended, expected, estimatedMin, estimatedMax }, balance, minutes, fees, external, next }`. 포인트는 빠지지 않고, 견적은 10분 동안 유효합니다. `external` 이 있으면 외부 서비스로 요청을 보내는 패키지이므로 제작 시작 때 `external_consent: true` 가 필요합니다.

## 4. 제작 시작(`run` 키, 포인트 사용)

```bash
curl -X POST -H "Authorization: Bearer $VIDIA_API_KEY" -H "Content-Type: application/json" \
  -d '{"package":"<slug>","input":{…견적과 같게…},"quote_id":"<견적 id>","budget":14625,"idempotency_key":"my-job-0001","confirm":true}' \
  https://vidia.kr/api/v1/runs
```

- `budget` 은 견적 `minimum` 이상(보통 `recommended`). 예산만큼 먼저 잡아 두고 남으면 돌려줍니다.
- `idempotency_key`(영숫자·`_`·`-` 8~96자): 같은 키로 다시 보내면 새 제작을 만들지 않고 처음 제작을 돌려줍니다.
- `confirm: true`: 사용자가 금액에 동의했다는 표시입니다.
- `use_coupon: true` 로 제작 쿠폰을 쓸 수 있습니다.

응답(201): `{ id, state: "QUEUED", scheduledAt, webUrl }`

## 5. 진행 확인

```bash
curl -H "Authorization: Bearer $VIDIA_API_KEY" https://vidia.kr/api/v1/runs/<id>
```

`state`: QUEUED · RUNNING · PAUSED(확인 대기) · AWAITING_APPROVAL(예산 승인 대기) · COMPLETED · FAILED · CANCELLED. 제작 중이면 `progress: { step, total }` 와 `eta: { seconds, finishAt }` 가 옵니다. 30초 이상 간격으로 확인하거나 `?wait=50`(초, 최대 50)을 붙여 끝나거나 멈출 때까지 기다렸다 받으세요.

멈추면(PAUSED·AWAITING_APPROVAL·FAILED) `pending`(멈춘 사정: `kind`·`message`·`budget`·`candidates`)과 `actions`(지금 보낼 수 있는 동작)가 옵니다. `POST /api/v1/runs/<id>/actions`(`run` 키)로 풉니다 — 예: `{"action":"add_budget","add":2000,"idempotency_key":"…","confirm":true}`, `{"action":"retry"}`, `{"action":"choose","step_id":12}`, `{"action":"finish"}`. 포인트를 더 잡는 `add_budget`·`approve_price` 는 `confirm: true` 가 필요합니다.

목록: `GET /api/v1/runs?state=RUNNING&limit=20`

취소: `POST /api/v1/runs/<id>/cancel` (`run` 키, 되돌릴 수 없음)

## 자료실 파일(asset 칸)

입력 칸 `type` 이 `asset` 이면 자료실 파일 id 를 넣습니다. 목록: `GET /api/v1/assets?kind=image`. 올리기(`run` 키): `curl -H "Authorization: Bearer $VIDIA_API_KEY" -F "file=@photo.jpg" -F "label=가게 사진" https://vidia.kr/api/v1/assets` → `201 { asset: { id, kind, name, bytes } }`. 이미지(PNG·JPG·WebP)·영상(MP4·MOV·WebM)·소리(MP3·WAV·M4A), 500MB 이하.

## 6. 결과물 받기

```bash
curl -H "Authorization: Bearer $VIDIA_API_KEY" https://vidia.kr/api/v1/runs/<id>/files
```

`items[].url` 은 키 없이 1시간 동안 받을 수 있는 링크입니다(Range 지원). `role: "final_video"` 가 완성 영상입니다. `upload` 에 유튜브 업로드 키트(제목 후보·설명란·태그·해시태그·챕터·고정 댓글·업로드 판정)가 있습니다.

```bash
curl -L -o video.mp4 "<items[0].url>"
```

## 시험용 키

`vd_test_` 로 시작하는 키는 포인트를 쓰지 않습니다. 같은 요청을 그대로 보내면 실제 영상 대신 약 40초 뒤 견본 결과가 옵니다(응답에 `test: true`). 제작 시작에 `"test_scenario": "fail" | "budget" | "review"` 를 넣으면 멈춘 상황과 그 뒤 처리까지 시험할 수 있습니다.

## 웹훅

`POST /api/v1/webhooks {"url":"https://…","events":["run.completed","run.failed","run.cancelled","run.action_required"]}`(`run` 키) → 응답의 `secret` 은 한 번만 옵니다. 비디아가 그 주소로 `{ id, event, createdAt, data: { run } }` 를 POST 합니다. 헤더 `Vidia-Signature: t=<초>,v1=<서명>` 의 서명은 `HMAC-SHA256(secret, t + "." + 본문)` 의 16진수입니다. 2xx 로 답하면 받은 것으로 보고, 아니면 1분·5분·30분·2시간·6시간 뒤 다시 보냅니다. 목록 `GET /api/v1/webhooks`, 시험 전송 `POST /api/v1/webhooks/<id>/test`, 삭제 `POST /api/v1/webhooks/<id>/delete`.

## 여러 편·다시 만들기·마무리

- 여러 편 한 번에(최대 10, 결과는 건별): `POST /api/v1/batch/quotes {"items":[…]}`, `POST /api/v1/batch/runs {"items":[…],"confirm":true}`.
- 다시 만들기: `GET /api/v1/runs/<id>/input` 으로 넣었던 입력값을 받아 견적에 그대로 넣습니다.
- 썸네일: `POST /api/v1/runs/<id>/thumbnail {"asset_id":123}` 또는 `{"reset":true}`. 쇼케이스: `POST /api/v1/runs/<id>/showcase {"on":true,"confirm":true}`.
- 휴지통: `POST /api/v1/runs/<id>/trash`·`/restore`. 추천 주제: `GET /api/v1/packages/<slug>/topic-idea`. 공개 결과물: `GET /api/v1/packages/<slug>/results`. 사용량: `GET /api/v1/usage`. 포인트 내역: `GET /api/v1/points/history`.
- 전체 경로와 입력 모양: `GET /api/v1/openapi.json`(OpenAPI 3.1).

## 한도

- 키별 요청 한도가 있습니다. 넘으면 429 와 `Retry-After` 를 돌려줍니다.
- `run` 키: 최근 24시간 제작 수가 키의 하루 제작 상한을 넘으면 429 `KEY_DAILY_RUN_LIMIT`.
- 견적은 회원별 하루 한도가 있습니다.

## 오류 형식

`{ "error": { "code": "QUOTE_EXPIRED", "message": "…" }, "detail": { "errors": [{ "key", "message" }], "missing": ["칸 key"] } }` — 4xx 메시지는 사용자에게 그대로 보여 줘도 되는 한국어 문장입니다. 5xx 는 `requestId` 만 줍니다. 실패한 제작은 `error.code: "RUN_FAILED"` 로 알려 주고, `pending`·`actions` 로 다음에 할 수 있는 일을 알려 줍니다.
