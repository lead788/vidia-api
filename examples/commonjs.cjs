// CommonJS 예: 내 최근 제작 5개와 상태.
const { VidiaClient } = require('vidia-api');

const vidia = new VidiaClient(process.env.VIDIA_API_KEY);
vidia.listRuns({ limit: 5 }).then((page) => {
	for (const run of page.items) console.log('#' + run.id, run.stateLabel, run.title);
}).catch((e) => { console.error(e.code, e.message); process.exitCode = 1; });
