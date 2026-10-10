# 1.2.0

- 멈춘 제작 풀기: `getRun()` 응답의 `pending`·`actions`, `runAction()`(예산 추가·다시 시도·이어 하기·선택·마치기). `getRun(id, { wait })` 로 끝나거나 멈출 때까지 서버가 기다렸다 답합니다.
- 시험용 키(`vd_test_…`): 포인트 없이 모의 제작으로 연동을 시험합니다. `startRun({ testScenario })` 로 오류·예산 부족·품질 미달을 재현합니다.
- 웹훅: `createWebhook()`·`listWebhooks()`·`testWebhook()` 등과 서명 확인 `verifyWebhookSignature()`.
- 여러 편 한 번에: `batchQuotes()`·`batchStart()`. 다시 만들기: `getRunInput()`.
- 조회·관리: `usage()`·`pointHistory()`·`topicIdea()`·`packageResults()`·`trashRun()`·`restoreRun()`·`setThumbnail()`·`setShowcase()`·`renameAsset()`·`deleteAsset()`·`createUploadLink()`. `listRuns()` 필터(package·createdFrom·createdTo·trashed).
- 결과물 응답에 유튜브 업로드 키트(`upload`), 제작 시작에 `priceTolerance`·`autoResolve`.
- Resolve stopped runs with `runAction()`, long-poll with `getRun(id, { wait })`, test keys, webhooks with `verifyWebhookSignature()`, batch quotes/starts, and account, library and showcase helpers.

# 1.1.0

- 자료실 파일: `listAssets()`·`uploadAsset()` 추가 — asset 입력 칸(사진·영상·소리)이 있는 패키지도 API 로 만들 수 있습니다.
- Add `listAssets()` and `uploadAsset()` for packages with file inputs.

# 1.0.0

- 첫 공개: 비디아 공개 API(/api/v1) 클라이언트. 계정·패키지 찾기·패키지 입력 칸·견적·제작 시작·진행 확인·완성 대기·제작 목록·취소·결과물 목록·다운로드.
- First release: client for the VIDIA public API with account, packages, quotes, runs (start, status, wait, list, cancel) and downloads.
