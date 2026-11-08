/** 계정 변경 뒤 늦은 응답이 인증·관람 기록에 적용되지 않는지 검증합니다. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {api} from '../src/api/client.ts';

function setup() {
 const values=new Map<string,string>(); const events: string[]=[];
 const storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)};
 Object.assign(globalThis,{window:{localStorage:storage,sessionStorage:storage,dispatchEvent:(e:Event)=>events.push(e.type)}});
 storage.setItem('arti.token',JSON.stringify('original-token'));
 return {storage,events};
}
function deferred<T>() {let resolve!: (v:T)=>void; const promise=new Promise<T>(r=>resolve=r);return {promise,resolve};}

test('late 401 from previous token cannot erase a newer account token', async () => {
 const {storage,events}=setup();const response=deferred<Response>();
 globalThis.fetch=(async ()=>response.promise) as typeof fetch;
 const pending=api.getVisit('previous-account');
 storage.setItem('arti.token',JSON.stringify('new-account-token'));
 response.resolve(Response.json({error:'expired',code:'SESSION_EXPIRED'},{status:401}));
 await assert.rejects(pending);assert.equal(storage.getItem('arti.token'),JSON.stringify('new-account-token'));assert.deepEqual(events,[]);
});

test('pending receipt cannot POST when token changes during same-owner verification', async () => {
 const {storage}=setup();const response=deferred<Response>();const methods:string[]=[];
 globalThis.fetch=(async (_url,options)=>{methods.push(options?.method??'GET');return response.promise;}) as typeof fetch;
 const pending=api.saveMemberVisit({userId:'original'} as any,'original');
 storage.setItem('arti.token',JSON.stringify('new-account-token'));
 response.resolve(Response.json({id:'original'}));
 await assert.rejects(pending);assert.deepEqual(methods,['GET']);
});

test('same-owner explicit recovery transmits the original frozen payload once', async () => {
 setup();const payload={userId:'original',visitId:'frozen-visit',date:'2026-11-08T01:00:00Z',reactionReasons:{a:'색감'}};
 const posts:unknown[]=[];
 globalThis.fetch=(async (_url,options)=>{
  if(options?.method==='GET')return Response.json({id:'original'});
  posts.push(JSON.parse(options?.body as string));return Response.json({persisted:true});
 }) as typeof fetch;
 const result=await api.saveMemberVisit(payload as any,'original');assert.equal(result.persisted,true);assert.deepEqual(posts,[payload]);
});

test('inactive receipt scope stops POST after successful account check', async () => {
 setup();const calls:string[]=[];
 globalThis.fetch=(async (_url,options)=>{calls.push(options?.method??'GET');return Response.json({id:'original'});}) as typeof fetch;
 await assert.rejects(api.saveMemberVisit({userId:'original'} as any,'original',()=>false));assert.deepEqual(calls,['GET']);
});

test('late logout completion cannot erase a newer login', async()=>{
 const {storage}=setup();const response=deferred<Response>();
 globalThis.fetch=(async()=>response.promise) as typeof fetch;
 const logout=api.logout();storage.setItem('arti.token',JSON.stringify('new-account-token'));
 response.resolve(new Response(null,{status:204}));assert.equal(await logout,false);assert.equal(storage.getItem('arti.token'),JSON.stringify('new-account-token'));
});

test('failed login credentials do not expire an existing valid session', async()=>{
 const {storage,events}=setup();globalThis.fetch=(async()=>Response.json({error:'incorrect credentials'},{status:401})) as typeof fetch;
 await assert.rejects(api.login('synthetic@example.test','incorrect'));
 assert.equal(storage.getItem('arti.token'),JSON.stringify('original-token'));assert.deepEqual(events,[]);
});
