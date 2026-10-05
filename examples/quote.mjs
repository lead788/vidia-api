// 견적만 받기(무료). 실행: VIDIA_API_KEY=... node examples/quote.mjs [패키지 slug]
import VidiaClient from 'vidia-api';

const vidia = new VidiaClient({ baseUrl: process.env.VIDIA_BASE_URL });
const slug = process.argv[2] || (await vidia.listPackages({ format: 'shorts', limit: 1 })).items[0].slug;
const pkg = await vidia.getPackage(slug);
console.log(pkg.title, '— 입력 칸:', pkg.inputs.map((f) => f.key + (f.required ? '*' : '')).join(', '));

const quote = await vidia.quote({ package: slug, input: { topic: '하품은 왜 옮을까?', description: '하품이 전염되는 이유를 연구 결과로 설명한다.' } });
console.log('최소', quote.point.minimum, 'P · 권장', quote.point.recommended, 'P · 예상', quote.point.expected, 'P · 잔액', quote.balance, 'P');
console.log('견적 id', quote.id, '(만료', quote.expiresAt + ')');
