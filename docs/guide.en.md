# VIDIA REST API guide

Base URL: `https://vidia.kr` · Auth: `Authorization: Bearer <API key>` on every request · Body: JSON · Methods: GET and POST

Create keys at [vidia.kr/settings/api](https://vidia.kr/settings/api). A `read` key can browse, quote and download; a `run` key can also start and cancel productions.

## 1. Find a package

```bash
curl -H "Authorization: Bearer $VIDIA_API_KEY" "https://vidia.kr/api/v1/packages?format=shorts&limit=5"
```

Returns `{ total, limit, offset, items: [{ slug, title, summary, format, tags, official, estimate, url }] }`.

## 2. Read its input fields

```bash
curl -H "Authorization: Bearer $VIDIA_API_KEY" https://vidia.kr/api/v1/packages/<slug>
```

Fill `input` with the `key` of each entry in `inputs` (`type`, `required`, `options`, `maxLength`, `default`, `showWhen`). `asset` fields take file ids from your VIDIA library.

## 3. Quote (free)

```bash
curl -X POST -H "Authorization: Bearer $VIDIA_API_KEY" -H "Content-Type: application/json" \
  -d '{"package":"<slug>","input":{"topic":"Why are yawns contagious?","description":"…"}}' \
  https://vidia.kr/api/v1/quotes
```

Optional settings: `title`, `mode` (AUTO|MANUAL), `problem_policy` (SKIP|ASK), `loop_policy` (ACCEPT|ASK), `loop_retries` (0–5), `scheduled_at`.

201 → `{ id, expiresAt, point: { minimum, recommended, expected, … }, balance, minutes, fees, external, next }`. No points are spent; the quote is valid for 10 minutes. When `external` is present the package calls outside services and the start request needs `external_consent: true`.

## 4. Start (run key, spends points)

```bash
curl -X POST -H "Authorization: Bearer $VIDIA_API_KEY" -H "Content-Type: application/json" \
  -d '{"package":"<slug>","input":{…same as the quote…},"quote_id":"<quote id>","budget":14625,"idempotency_key":"my-job-0001","confirm":true}' \
  https://vidia.kr/api/v1/runs
```

`budget` ≥ the quote `minimum` (usually `recommended`); it is held up front and unused points are returned. Re-sending the same `idempotency_key` returns the original production. `confirm: true` records the user's consent.

201 → `{ id, state: "QUEUED", scheduledAt, webUrl }`

## 5. Track

`GET /api/v1/runs/<id>` → `state` (QUEUED, RUNNING, PAUSED, AWAITING_APPROVAL, COMPLETED, FAILED, CANCELLED), `progress`, `eta`, `error`, `actionNeeded`. Poll every 30 seconds or more. PAUSED and AWAITING_APPROVAL need a person on the web page in `actionNeeded`.

List: `GET /api/v1/runs?state=RUNNING` · Cancel: `POST /api/v1/runs/<id>/cancel` (run key, irreversible)

## 6. Download

`GET /api/v1/runs/<id>/files` → `items[].url` are signed links valid for one hour without a key (Range supported). `role: "final_video"` is the finished mp4. `publish` holds suggested titles and a description.

## Limits

Each key has request limits (429 with `Retry-After`). Run keys also have a daily production limit (`KEY_DAILY_RUN_LIMIT`).

## Errors

`{ "error": { "code", "message" }, "detail"? }`. 4xx messages are user-facing Korean sentences; 5xx responses only carry a `requestId`. A failed production reports `error.code: "RUN_FAILED"`; details are handled on the web project page.
