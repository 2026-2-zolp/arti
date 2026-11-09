// Disposable UI fixture host: pinned product code is imported unchanged.
import fs from 'node:fs';
import { createServer } from 'node:http';
process.env.ANTHROPIC_API_KEY='';process.env.RATE_LIMIT='off';process.env.DEMO_MODE='false';
const {openDb}=await import(new URL('../../../../../backend/src/db.ts', import.meta.url).href);
const {createApp}=await import(new URL('../../../../../backend/src/app.ts', import.meta.url).href);
const repo=await import(new URL('../../../../../backend/src/repo.ts', import.meta.url).href);
const {hashPassword}=await import(new URL('../../../../../backend/src/lib/password.ts', import.meta.url).href);
const db=openDb(':memory:');
const user=repo.createUser(db,{email:'ui-regression@example.invalid',passwordHash:hashPassword('testpass1234'),nickname:'회귀검사'});
const app=createApp(db);const ex=repo.listExhibitions(db)[0];
const log=new URL('./browser-http.jsonl',import.meta.url);fs.writeFileSync(log,'');
const server=createServer((req,res)=>{
  if(req.url==='/__fixture/expire'&&req.method==='POST'){
    db.prepare("DELETE FROM sessions WHERE role='user'").run();res.end('expired');return;
  }
  res.on('finish',()=>{
    fs.appendFileSync(log,JSON.stringify({time:new Date().toISOString(),method:req.method,path:req.url,
      status:res.statusCode,memberVisitRows:repo.listVisits(db,user.id).length})+'\n');
  });
  app(req,res);
});
server.listen(4017,'127.0.0.1',()=>console.log(JSON.stringify({port:4017,exhibitionId:ex.id,firstArtworkId:repo.listArtworks(db,ex.id)[0].id,scope:'Disposable in-memory, no external AI'})));
process.on('SIGINT',()=>server.close(()=>{db.close();process.exit(0);}));
