// Local G4 fault injection only. Not imported by the app or production Compose.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const modeFile=path.resolve(root,'../../../../../data/private/g4-fault-mode.json');
const journal=path.join(root,'g4-fault-http.jsonl');
let catalogFailures=0;
const log=(request,status)=>fs.appendFileSync(journal,JSON.stringify({method:request.method,path:request.url,status})+'\n');
const server=http.createServer((request,response)=>{
  let mode='pass';try {mode=JSON.parse(fs.readFileSync(modeFile,'utf8')).mode;}catch {}
  if((mode==='catalog' || mode==='catalog-once') && request.method==='GET' && /^\/api\/artworks(?:\?|$)/.test(request.url) && (mode==='catalog' || catalogFailures++===0)){
    log(request,503);response.writeHead(503,{'Content-Type':'application/json'});response.end(JSON.stringify({error:'시험용 작품 목록 통신 실패입니다. 다시 시도해 주세요.',code:'UPSTREAM_UNAVAILABLE',retryable:true,requestId:'synthetic-g4-fault'}));return;
  }
  if(mode==='drop'){log(request,0);request.socket.destroy();return;}
  const upstream=http.request({hostname:'127.0.0.1',port:4018,path:request.url,method:request.method,headers:{...request.headers,host:'localhost:4018'}},result=>{
    log(request,result.statusCode);response.writeHead(result.statusCode,result.headers);result.pipe(response);
  });
  upstream.on('error',()=>{log(request,503);response.writeHead(503,{'Content-Type':'application/json'});response.end(JSON.stringify({error:'시험 API에 연결할 수 없어요.',code:'UPSTREAM_UNAVAILABLE',retryable:true,requestId:'synthetic-g4-fault'}));});
  request.pipe(upstream);
});
server.listen(4019,'127.0.0.1',()=>process.stdout.write('G4 local fault proxy 4019 → 4018; no request bodies or credentials logged.\n'));
