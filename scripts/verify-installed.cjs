'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),{createRequire}=require('node:module'),{pathToFileURL}=require('node:url'),{spawn}=require('node:child_process');
const base=path.resolve(process.argv[2]||'.'),local=createRequire(path.join(base,'package.json'));
async function main(){
 const sdk=local('vidia-api'),entry=local.resolve('vidia-api'),pkg=local(path.join(path.dirname(entry),'../package.json'));
 assert.equal(pkg.version,require('../package.json').version);
 const esm=await import(pathToFileURL(path.join(path.dirname(entry),'index.js')));assert.equal(esm.VidiaClient,sdk.VidiaClient);
 const ops=local(path.join(path.dirname(entry),'capabilities.json'));
 const spec=await (await fetch('https://vidia.kr/api/v1/openapi.json',{signal:AbortSignal.timeout(20000)})).json();
 const client=new sdk.VidiaClient({apiKey:'vd_live_'+ '0'.repeat(32)});
 await assert.rejects(client.serviceStatus(),e=>e.status===401);
 const bridgeEntry=local.resolve('vidia-mcp'),child=spawn(process.execPath,[path.join(path.dirname(bridgeEntry),'index.js')],{env:{...process.env,VIDIA_API_KEY:'',VIDIA_MCP_URL:'https://vidia.kr/mcp'},stdio:['pipe','pipe','pipe']});
 const pending=new Map();let buffer='';child.stdout.on('data',chunk=>{buffer+=chunk;let n;while((n=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,n);buffer=buffer.slice(n+1);try{const j=JSON.parse(line);pending.get(j.id)?.(j);pending.delete(j.id);}catch{}}});child.stderr.resume();
 let next=0;const rpc=(method,params)=>new Promise((resolve,reject)=>{const id=++next,t=setTimeout(()=>{pending.delete(id);reject(Error('MCP timeout'));},20000);pending.set(id,j=>{clearTimeout(t);j.error?reject(Object.assign(Error(j.error.message),{code:j.error.code})):resolve(j.result);});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
 try{
  await assert.rejects(rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'sdk-installed-check',version:pkg.version}}),{code:-32001});
  const list=await rpc('tools/list',{});assert.ok(list.tools.length>=57);
  for(const op of ops){assert.equal(typeof client[op.name.slice(6).replace(/_([a-z])/g,(_,c)=>c.toUpperCase())],'function');assert.equal(spec.paths[op.path][op.method].operationId,op.name);assert.deepEqual(list.tools.find(t=>t.name===op.name)?.inputSchema,op.inputSchema);}
  await assert.rejects(rpc('tools/call',{name:'vidia_service_status',arguments:{}}),{code:-32001});
  console.log(JSON.stringify({version:pkg.version,esm:true,cjs:true,capabilities:ops.length,liveRestPaths:Object.keys(spec.paths).length,liveMcpTools:list.tools.length,stdio:true,unauthorizedRejected:true,authenticatedCalls:false}));
 }finally{child.stdin.end();child.kill();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
