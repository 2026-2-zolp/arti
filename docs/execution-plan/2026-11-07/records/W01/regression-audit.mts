import fs from 'node:fs';
import { createServer } from 'node:http';
process.env.ANTHROPIC_API_KEY = '';
process.env.RATE_LIMIT = 'off';
const tags = Object.fromEntries(['landscape','people','abstract','light','vivid','cool','warm','soft'].map(t=>[t,0.6]));
const emotions = Object.fromEntries(['calm','joy','sadness','tension','awe','nostalgia'].map(t=>[t,0.5]));
const fake = createServer((req,res)=>{
  req.resume();
  res.setHeader('Content-Type','application/json');
  res.end(JSON.stringify(req.url==='/write'
    ? {summary:'AUDIT_NEW_SUMMARY',keywords:['AUDIT'],intro:'AUDIT_INTRO',questions:['AUDIT_QUESTION'],hints:['AUDIT_HINT'],model:'test-double'}
    : {emotions,tags,usedImage:false,usedText:true,imageError:null,models:{image:'test-double',text:'test-double'},tagSource:'text'}));
});
fake.listen(0,'127.0.0.1');
await new Promise<void>(r=>fake.once('listening',r));
process.env.EMOTION_SERVICE_URL = 'http://127.0.0.1:'+(fake.address() as {port:number}).port;
const {openDb}=await import('file:///C:/Proj/26-2-zolp/work/arti/backend/src/db.ts');
const {createApp}=await import('file:///C:/Proj/26-2-zolp/work/arti/backend/src/app.ts');
const repo=await import('file:///C:/Proj/26-2-zolp/work/arti/backend/src/repo.ts');
const db=openDb(':memory:');
const server=createApp(db).listen(0,'127.0.0.1');
await new Promise<void>(r=>server.once('listening',r));
const base='http://127.0.0.1:'+(server.address() as {port:number}).port+'/api';
const call=async(path:string,method='GET',body?:unknown,token?:string)=>{
  const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{'X-Admin-Token':token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:r.status,body:await r.json()};
};
const result:any={scope:'isolated in-memory backend, fake model provider; no actual AI or team local DB'};
try {
  const works=repo.listArtworks(db);
  result.freshDatabase={exhibitions:repo.listExhibitions(db).length,artworks:works.length,guideStatuses:[...new Set(works.map(w=>w.guideStatus))]};
  const auth=await call('/admin/login','POST',{id:'admin',password:'admin1234'});
  const token=auth.body.token;
  const oldEx=repo.listExhibitions(db)[0];
  const ex=await call('/admin/exhibitions','POST',{...oldEx,id:'',title:'AUDIT_YOO_STRUCTURE_ONLY',status:'draft'},token);
  result.newExhibition={status:ex.status,id:ex.body.id,draftPublicStatus:(await call('/exhibitions/'+ex.body.id)).status};
  const aw=await call('/admin/artworks','POST',{...works[0],id:'',exhibitionId:ex.body.id,title:'AUDIT_NEW_ARTWORK',position:null,tags:['landscape'],reviewStatus:'pending',summary:'AUDIT_OLD_SUMMARY',summaryStatus:'confirmed',guideStatus:'none',guideIntro:'',guidedHints:[],guidedLooking:[],tagStatus:'none',emotionStatus:'none',analysis:null},token);
  const id=aw.body.id;
  result.pendingArtwork={created:aw.status,publicGet:(await call('/artworks/'+id)).status,ask:(await call('/artworks/'+id+'/ask','POST',{question:'누가 그렸나요?'})).status};
  const recInput={exhibitionId:ex.body.id,tastes:['landscape'],duration:'30m'};
  result.recommendationConditions={pendingCount:(await call('/recommendations','POST',recInput)).body.length};
  const approved=await call('/admin/artworks/'+id,'PUT',{...aw.body,reviewStatus:'approved'},token);
  result.recommendationConditions.approvedWithoutPosition=(await call('/recommendations','POST',recInput)).body.length;
  const located=await call('/admin/artworks/'+id,'PUT',{...approved.body,position:{x:20,y:30}},token);
  result.recommendationConditions.approvedWithPosition=(await call('/recommendations','POST',recInput)).body.length;
  const analyzed=await call('/admin/artworks/'+id+'/analyze','POST',{useImage:false},token);
  result.confirmedSummaryReanalysis={provider:'test-double',status:analyzed.status,beforeSummary:located.body.summary,beforeStatus:located.body.summaryStatus,afterSummary:analyzed.body.artwork?.summary,afterStatus:analyzed.body.artwork?.summaryStatus,guideStatus:analyzed.body.artwork?.guideStatus};
  const fixed={...analyzed.body.artwork,summary:'AUDIT_REVIEWED_SUMMARY',summaryStatus:'confirmed',guideIntro:'AUDIT_REVIEWED_GUIDE',guidedLooking:['AUDIT_REVIEWED_QUESTION'],guidedHints:['AUDIT_REVIEWED_HINT'],guideStatus:'confirmed'};
  const confirmed=await call('/admin/artworks/'+id,'PUT',fixed,token);
  const referenceEdit=await call('/admin/artworks/'+id,'PUT',{...confirmed.body,referenceUrl:'https://example.com/changed-reference'},token);
  const descriptionEdit=await call('/admin/artworks/'+id,'PUT',{...referenceEdit.body,description:'AUDIT_CHANGED_DESCRIPTION'},token);
  result.sourceChanges={referenceOnly:{summaryStatus:referenceEdit.body.summaryStatus,guideStatus:referenceEdit.body.guideStatus},description:{summaryStatus:descriptionEdit.body.summaryStatus,guideStatus:descriptionEdit.body.guideStatus}};
  fs.writeFileSync('C:/Proj/26-2-zolp/docs/execution-plan/2026-11-07/records/W01/regression-audit.json',JSON.stringify(result,null,2));
  const {createRequire}=await import('node:module');
  const requireFromBackend=createRequire('file:///C:/Proj/26-2-zolp/work/arti/backend/package.json');
  const ts=requireFromBackend('typescript');
  const vm=await import('node:vm');
  const {tastesFromPicks}=await import('file:///C:/Proj/26-2-zolp/work/arti/frontend/src/lib/tasteFromPicks.ts');
  const {buildRecommendations}=await import('file:///C:/Proj/26-2-zolp/work/arti/backend/src/lib/recommend.ts');
  const sample=works[0];
  const t1=tastesFromPicks([{...sample,id:'A',tags:['landscape','warm']},{...sample,id:'B',tags:['landscape']}],['A','B']);
  const t2=tastesFromPicks([{...sample,id:'A',tags:['landscape','warm']},{...sample,id:'B',tags:['warm']}],['A','B']);
  const visitSource=fs.readFileSync('C:/Proj/26-2-zolp/work/arti/frontend/src/store/VisitContext.tsx','utf8');
  const js=ts.transpileModule(visitSource+String.fromCharCode(10)+'export {reducer};',{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS}}).outputText;
  const exports:any={};
  vm.runInNewContext(js,{exports,require:(name:string)=>name==='react'?{createContext:()=>({})}:name.includes('data/mock')?{TASTE_LABEL:{landscape:'landscape',warm:'warm'}}:{},Date});
  const before:any={exhibitionId:oldEx.id,user:null,tastes:['landscape'],duration:'30m',recommendations:[{artworkId:sample.id,order:1}],current:0,viewed:[],reactions:{},reactionReasons:{},dwell:{},startedAt:null,tasteDone:true};
  const after=exports.reducer(exports.reducer(before,{type:'finishTaste',tastes:['warm']}),{type:'setDuration',duration:'60m'});
  result.currentFrontendSource={frequencyTagsA:t1,frequencyTagsB:t2,recommendationsEqual:JSON.stringify(buildRecommendations(works,oldEx,t1,'60m'))===JSON.stringify(buildRecommendations(works,oldEx,t2,'60m')),oldRecommendationRemains:JSON.stringify(after.recommendations)===JSON.stringify(before.recommendations)};
  fs.writeFileSync('C:/Proj/26-2-zolp/docs/execution-plan/2026-11-07/records/W01/regression-audit.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
} finally {
  await new Promise<void>(r=>server.close(()=>r()));
  await new Promise<void>(r=>fake.close(()=>r()));
  db.close();
}
