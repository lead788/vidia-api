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

`state`: QUEUED · RUNNING · PAUSED(확인 대기) · AWAITING_APPROVAL(예산 승인 대기) · COMPLETED · FAILED · CANCELLED. 제작 중이면 `progress: { step, total }` 와 `eta: { seconds, finishAt }` 가 옵니다. 30초 이상 간격으로 확인하세요. PAUSED·AWAITING_APPROVAL 은 `actionNeeded` 의 웹 주소에서 이어 갑니다.

목록: `GET /api/v1/runs?state=RUNNING&limit=20`

취소: `POST /api/v1/runs/<id>/cancel` (`run` 키, 되돌릴 수 없음)

## 6. 결과물 받기

```bash
curl -H "Authorization: Bearer $VIDIA_API_KEY" https://vidia.kr/api/v1/runs/<id>/files
```

`items[].url` 은 키 없이 1시간 동안 받을 수 있는 링크입니다(Range 지원). `role: "final_video"` 가 완성 영상입니다. `publish` 에 게시용 제목 후보·설명이 있습니다.

```bash
curl -L -o video.mp4 "<items[0].url>"
```

## 한도

- 키별 요청 한도가 있습니다. 넘으면 429 와 `Retry-After` 를 돌려줍니다.
- `run` 키: 최근 24시간 제작 수가 키의 하루 제작 상한을 넘으면 429 `KEY_DAILY_RUN_LIMIT`.
- 견적은 회원별 하루 한도가 있습니다.

## 오류 형식

`{ "error": { "code": "QUOTE_EXPIRED", "message": "…" }, "detail": { "errors": [{ "key", "message" }], "missing": ["칸 key"] } }` — 4xx 메시지는 사용자에게 그대로 보여 줘도 되는 한국어 문장입니다. 5xx 는 `requestId` 만 줍니다. 실패한 제작은 `error.code: "RUN_FAILED"` 로만 알려 주고, 자세한 처리는 웹 프로젝트 화면에서 합니다.
