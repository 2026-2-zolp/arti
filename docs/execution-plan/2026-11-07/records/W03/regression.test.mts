/** Baseline characterization: tests pass when known defects reproduce.
 * No source patch, real model, team DB, or production network.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import type { AddressInfo } from 'node:net';
process.env.ANTHROPIC_API_KEY='';
process.env.RATE_LIMIT='off';
process.env.DEMO_MODE='false';
const output=new URL('./results.json',import.meta.url);
const observations:any[]=[];
const tags=Object.fromEntries(['landscape','people','abstract','light','vivid','cool','warm','soft'].map(k=>[k,0.6]));
const emotions=Object.fromEntries(['calm','joy','sadness','tension','awe','nostalgia'].map(k=>[k,0.5]));
let providerCalls=0;
const fake=createServer((req,res)=>{
  providerCalls++;req.resume();res.setHeader('Content-Type','application/json');
  res.end(JSON.stringify(req.url==='/write'
    ? {summary:'NEW_DRAFT',keywords:['test'],intro:'GUIDE',questions:['QUESTION'],hints:['HINT'],model:'test-double'}
    : {emotions,tags,usedImage:false,usedText:true,imageError:null,models:{image:'test-double',text:'test-double'},tagSource:'text'}));
});
before(async()=>{
  fake.listen(0,'127.0.0.1');await new Promise<void>(r=>fake.once('listening',r));
  process.env.EMOTION_SERVICE_URL=`http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
});
after(async()=>{
  await new Promise<void>(r=>fake.close(()=>r()));
  fs.writeFileSync(output,JSON.stringify({baseline:'ae0e58ebc338c17da6d4d17616fd802f03ba3bb6',
    scope:'Current-code HTTP/data characterization only; reproduced defects are NOT product fixes.',
    provider:'local fake only',providerCalls,observations},null,2)+'\n');
});
async function fixture(run:(f:any)=>Promise<void>){
  const {openDb}=await import(new URL('../../../../../backend/src/db.ts', import.meta.url).href);
  const {createApp}=await import(new URL('../../../../../backend/src/app.ts', import.meta.url).href);
  const repo=await import(new URL('../../../../../backend/src/repo.ts', import.meta.url).href);
  const db=openDb(':memory:');const server=createApp(db).listen(0,'127.0.0.1');
  await new Promise<void>(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const call=async(method:string,path:string,body?:unknown,headers:Record<string,string>={})=>{
    const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...headers},
      ...(body===undefined?{}:{body:JSON.stringify(body)})});
    const text=await response.text();return {status:response.status,body:text?JSON.parse(text):null};
  };
  try {
    const admin=await call('POST','/admin/login',{id:'admin',password:'admin1234'});
    assert.equal(admin.status,200);
    const ex=repo.listExhibitions(db)[0],sample=repo.listArtworks(db,ex.id)[0];
    await run({db,repo,call,ex,sample,admin:{'X-Admin-Token':admin.body.token}});
  }finally{await new Promise<void>(r=>server.close(()=>r()));db.close();}
}
function observe(id:string,issues:string[],actual:unknown,target:unknown){observations.push({id,issues,actual,target});}
test('R01 draft/pending GET and ask remain public (defect)',async()=>fixture(async({call,ex,sample,admin}:any)=>{
  const created=await call('POST','/admin/exhibitions',{...ex,id:'',status:'draft'},admin);
  const work=await call('POST','/admin/artworks',{...sample,id:'',exhibitionId:created.body.id,reviewStatus:'pending'},admin);
  const a=await call('GET',`/exhibitions/${created.body.id}`);
  const b=await call('GET',`/artworks/${work.body.id}`);
  const c=await call('POST',`/artworks/${work.body.id}/ask`,{question:'누가 그렸나요?'});
  assert.deepEqual([a.status,b.status,c.status],[200,200,200]);
  observe('R01',['F04'],[a.status,b.status,c.status],[404,404,404]);
}));
test('R02 confirmed summary overwritten when guide not confirmed (defect)',async()=>fixture(async({call,sample,admin}:any)=>{
  const saved=await call('PUT',`/admin/artworks/${sample.id}`,{...sample,summary:'REVIEWED',summaryStatus:'confirmed',guideStatus:'none',guidedLooking:[],guidedHints:[],guideIntro:''},admin);
  assert.equal(saved.body.summaryStatus,'confirmed');
  const result=await call('POST',`/admin/artworks/${sample.id}/analyze`,{useImage:false},admin);
  assert.equal(result.body.artwork.summary,'NEW_DRAFT');assert.equal(result.body.artwork.summaryStatus,'suggested');
  observe('R02',['F34'],{summary:result.body.artwork.summary,status:result.body.artwork.summaryStatus},{summary:'REVIEWED',status:'confirmed'});
}));
test('R03 guide intro/questions/hints PUT→GET preserved (existing correction)',async()=>fixture(async({call,sample,admin}:any)=>{
  const generated=await call('POST',`/admin/artworks/${sample.id}/analyze`,{useImage:false},admin);
  assert.equal(generated.status,200);assert.equal(generated.body.artwork.guideStatus,'suggested');
  const fields={guideIntro:'EDITED_INTRO',guidedLooking:['EDITED_Q'],guidedHints:['EDITED_HINT'],guideStatus:'confirmed'};
  const put=await call('PUT',`/admin/artworks/${sample.id}`,{...generated.body.artwork,...fields},admin);assert.equal(put.status,200);
  const got=await call('GET',`/artworks/${sample.id}`);
  for(const [key,value] of Object.entries(fields))assert.deepEqual(got.body[key],value);
  observe('R03',['F03'],fields,'Fake generation→edited API round-trip preserved; actual A04 UI save checked separately in browser-observations.md');
}));
test('R04 reference and artist edits leave confirmed outputs (defect)',async()=>fixture(async({call,sample,admin}:any)=>{
  let current=(await call('PUT',`/admin/artworks/${sample.id}`,{...sample,summary:'REVIEWED',summaryStatus:'confirmed',guideIntro:'GUIDE',guidedLooking:['Q'],guidedHints:['H'],guideStatus:'confirmed'},admin)).body;
  const results=[];
  for(const patch of [{referenceUrl:'https://example.invalid/source'},{artist:'CHANGED_ARTIST'}]){
    current=(await call('PUT',`/admin/artworks/${sample.id}`,{...current,...patch},admin)).body;
    assert.equal(current.summaryStatus,'confirmed');assert.equal(current.guideStatus,'confirmed');
    results.push({patch,statuses:[current.summaryStatus,current.guideStatus]});
  }
  observe('R04',['F35','F29'],results,'source_check and suggested after source/fact changes');
}));
test('R05 member duplicate save creates two records and drops reasons (defect)',async()=>fixture(async({call,repo,db,ex,sample}:any)=>{
  const auth=await call('POST','/auth/signup',{email:'regression@example.invalid',password:'testpass1234',nickname:'test'});
  const headers={Authorization:`Bearer ${auth.body.token}`};
  const body={visitId:'11111111-1111-4111-8111-111111111111',exhibitionId:ex.id,exhibitionTitle:ex.title,venue:ex.venue,date:'2026-11-08T03:00:00Z',durationMin:1,viewedArtworkIds:[sample.id],recommendedCount:1,reactions:{[sample.id]:'like'},reactionReasons:{[sample.id]:'색감이 좋아요'},longestViewedArtworkId:sample.id,keywords:['풍경']};
  const a=await call('POST','/visits',body,headers),b=await call('POST','/visits',body,headers);
  assert.equal(a.status,201);assert.equal(b.status,201);assert.notEqual(a.body.id,b.body.id);
  const records=repo.listVisits(db,auth.body.user.id);assert.equal(records.length,2);
  assert.equal('reactionReasons' in records[0],false);
  observe('R05',['F10','F11'],{rows:records.length,statuses:[a.status,b.status],reasonsPresent:false},{rows:1,statuses:[201,200],reasonsPresent:true});
}));
test('R06 invalid member Bearer silently becomes guest (defect)',async()=>fixture(async({call,db,ex}:any)=>{
  const before=db.prepare('SELECT count(*) as n FROM visits').get().n;
  const body={exhibitionId:ex.id,exhibitionTitle:ex.title,venue:ex.venue,date:'2026-11-08T03:00:00Z',durationMin:1,viewedArtworkIds:[],recommendedCount:0,reactions:{},longestViewedArtworkId:null,keywords:[]};
  const out=await call('POST','/visits',body,{Authorization:'Bearer invalid-test-token'});
  assert.equal(out.status,200);assert.equal(out.body.userId,null);
  assert.equal(db.prepare('SELECT count(*) as n FROM visits').get().n,before);
  observe('R06',['F11','F13','F14'],{status:out.status,userId:null,persistedField:'persisted' in out.body},{status:401,code:'SESSION_EXPIRED'});
}));
test('R07 no-token guest returns receipt without DB rows (policy baseline)',async()=>fixture(async({call,db,ex}:any)=>{
  const before=db.prepare('SELECT count(*) as n FROM visits').get().n;
  const out=await call('POST','/visits',{exhibitionId:ex.id,exhibitionTitle:ex.title,venue:ex.venue,date:'2026-11-08T03:00:00Z',durationMin:1,viewedArtworkIds:[],recommendedCount:0,reactions:{},longestViewedArtworkId:null,keywords:[]});
  assert.equal(out.status,200);assert.equal(out.body.userId,null);
  assert.equal(db.prepare('SELECT count(*) as n FROM visits').get().n,before);
  observe('R07',['F11'],{status:200,rowsAdded:0},'Maintain guest no DB storage; add persisted:false');
}));
test('R08 duplicate frequencies flatten into identical recommendation scores (defect)',async()=>fixture(async({repo,db,ex,sample}:any)=>{
  const {tastesFromPicks}=await import(new URL('../../../../../frontend/src/lib/tasteFromPicks.ts', import.meta.url).href);
  const {buildRecommendations}=await import(new URL('../../../../../backend/src/lib/recommend.ts', import.meta.url).href);
  const a=tastesFromPicks([{...sample,id:'x',tags:['landscape','warm']},{...sample,id:'y',tags:['landscape']}],['x','y']);
  const b=tastesFromPicks([{...sample,id:'x',tags:['landscape','warm']},{...sample,id:'y',tags:['warm']}],['x','y']);
  const works=repo.listArtworks(db,ex.id);
  assert.deepEqual(buildRecommendations(works,ex,a,'60m'),buildRecommendations(works,ex,b,'60m'));
  observe('R08',['F01'],{profileA:a,profileB:b,scoreResultsEqual:true},'Preserve counts; contract C05/C06 produce different scores, not necessarily different final lists');
}));
test('R09 approved but unpositioned excluded from recommendation (policy baseline)',async()=>fixture(async({call,ex,sample,admin}:any)=>{
  const created=await call('POST','/admin/exhibitions',{...ex,id:'',status:'running'},admin);
  const work=await call('POST','/admin/artworks',{...sample,id:'',exhibitionId:created.body.id,reviewStatus:'approved',position:null},admin);
  const input={exhibitionId:created.body.id,tastes:['landscape'],duration:'30m'};
  const a=await call('POST','/recommendations',input);assert.equal(a.body.length,0);
  await call('PUT',`/admin/artworks/${work.body.id}`,{...work.body,position:{x:20,y:30}},admin);
  const b=await call('POST','/recommendations',input);assert.equal(b.body.length,1);
  observe('R09',['F04','F17'],[a.body.length,b.body.length],[0,1]);
}));
