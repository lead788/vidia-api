# 2026-11-05 회원 기능 연동

상담 확인 → 견적 → 설계도/대표 장면 검토 → 별도 본편 승인 순서로 사용합니다. 새 금액과 영향을 사용자에게 보여 주고 승인받은 뒤에만 `confirmed: true`를 보냅니다. 대표 장면 영상은 응답의 `webUrl`에서 직접 확인합니다. 관리자 기능은 기존 웹 인증 경로를 유지합니다.

| MCP 도구 | REST 경로 | 권한 | 필수 입력 |
|---|---|---|---|
| `vidia_check_counsel` | `POST /api/v1/member-briefs/check` | read | package, input |
| `vidia_consult` | `POST /api/v1/member-briefs/consult` | run | package, input |
| `vidia_get_blueprint` | `GET /api/v1/runs/{id}/blueprint` | read | run_id |
| `vidia_edit_blueprint` | `POST /api/v1/runs/{id}/blueprint/edit` | run | run_id, base_hash |
| `vidia_quote_blueprint` | `POST /api/v1/runs/{id}/blueprint/quote` | read | run_id |
| `vidia_approve_blueprint` | `POST /api/v1/runs/{id}/blueprint/approve` | run | run_id, quote_id, idempotency_key, confirmed |
| `vidia_quote_blueprint_refine` | `POST /api/v1/runs/{id}/blueprint/refine/quote` | read | run_id, scene_id, kind |
| `vidia_refine_blueprint` | `POST /api/v1/runs/{id}/blueprint/refine` | run | run_id, scene_id, kind, quote_point, idempotency_key, confirmed |
| `vidia_answer_blueprint` | `POST /api/v1/runs/{id}/blueprint/agent-answer` | run | run_id, question_id, choice, idempotency_key |
| `vidia_get_sample_review` | `GET /api/v1/runs/{id}/sample-review` | read | run_id |
| `vidia_quote_sample_review` | `POST /api/v1/runs/{id}/blueprint/sample-review/quote` | read | run_id, token, phase |
| `vidia_approve_sample_review` | `POST /api/v1/runs/{id}/sample-review/approve` | run | run_id, token, action, quote_id, confirmed |
| `vidia_finish_blueprint` | `POST /api/v1/runs/{id}/blueprint/finish` | run | run_id, confirmed |
| `vidia_get_settlement` | `GET /api/v1/runs/{id}/settlement` | read | run_id |
| `vidia_latest_draft` | `GET /api/v1/run-drafts/latest` | read |  |
| `vidia_get_draft` | `GET /api/v1/run-drafts/{id}` | read | draft_id |
| `vidia_create_draft` | `POST /api/v1/run-drafts` | run | draft_id, package, body |
| `vidia_update_draft` | `POST /api/v1/run-drafts/{id}/update` | run | draft_id, revision, body |
| `vidia_discard_draft` | `POST /api/v1/run-drafts/{id}/discard` | run | draft_id, revision, confirmed |
| `vidia_search` | `GET /api/v1/search` | read |  |
| `vidia_service_status` | `GET /api/v1/status` | read |  |
| `vidia_public_estimates` | `GET /api/v1/public-estimates` | read |  |
| `vidia_list_market` | `GET /api/v1/market/items` | read |  |
| `vidia_get_run_notifications` | `GET /api/v1/notifications/run-complete` | read |  |
| `vidia_set_run_notifications` | `POST /api/v1/notifications/run-complete` | run | app, email |
| `vidia_get_market_item` | `GET /api/v1/market/items/{slug}` | read | slug |
| `vidia_charge_recommendation` | `GET /api/v1/wallet/charge-recommendation` | read |  |
| `vidia_payment_history` | `GET /api/v1/payments` | read |  |
| `vidia_run_counts` | `GET /api/v1/runs/counts` | read |  |
| `vidia_get_scene_price` | `GET /api/v1/runs/{id}/scene-price` | read | run_id |
| `vidia_accept_scene_price` | `POST /api/v1/runs/{id}/scene-price/approve` | run | run_id, scene, point, confirmed |

정확한 입력 형식·범위는 [OpenAPI](https://vidia.kr/api/v1/openapi.json)와 MCP `tools/list`를 따릅니다. 시험 키는 새 실제 변경 작업을 실행할 수 없습니다. 초안은 개정 번호, AI 다듬기는 멱등키와 견적 포인트, 본편 승인은 현재 검토 토큰과 새 견적 번호가 필요합니다. 다듬기 예약과 본편 추가 예산도 키 한도에 포함됩니다. 정산·결제는 원장 조회이며 마켓 대표 가격은 부가세 포함입니다.
