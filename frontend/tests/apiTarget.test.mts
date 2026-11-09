/** 프론트 API 대상·개발 프록시 설정을 검증합니다. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {apiTarget, apiProxy} from '../src/lib/apiTarget.ts';
import {loadEnv} from 'vite';
import config from '../vite.config.ts';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {api, uploadedImageUrl} from '../src/api/client.ts';

test('default and explicit legacy share API/admin image route semantics',async()=>{
  assert.equal(apiTarget(),'django');assert.equal(apiProxy(apiTarget()),'http://127.0.0.1:4018');
  assert.equal(apiProxy(apiTarget('express')),'http://127.0.0.1:4000');
  assert.match(uploadedImageUrl('test.png',true),/^\/api\/admin\/uploads\//);
  Object.assign(globalThis,{window:{localStorage:{getItem:()=>null}}});
  let called='';globalThis.fetch=(async(url)=>{called=String(url);return Response.json([]);}) as typeof fetch;
  await api.listAdminArtworks();assert.match(called,/^\/api\/admin\/artworks/);
});

test('unknown or blank target and unsafe proxy fail instead of silently using legacy',()=>{
  for(const target of ['','Django','legacy','typo'])assert.throws(()=>apiTarget(target));
  for(const proxy of ['', 'file:///tmp/api','http://user:pass@localhost:4000','http://localhost:4018/api','http://localhost:4018?key=x'])assert.throws(()=>apiProxy('django',proxy));
  assert.equal(apiProxy('django','http://api:8000'),'http://api:8000');
});

test('Vite loads env-file values with process precedence and shares dev/preview target',()=>{
  const folder=mkdtempSync(join(tmpdir(),'arti-env-'));const saved={...process.env};
  try{
    delete process.env.VITE_API_TARGET;delete process.env.VITE_API_PROXY;
    writeFileSync(join(folder,'.env.local'),'VITE_API_TARGET=express\nVITE_API_PROXY=http://127.0.0.1:4000\nOPENAI_API_KEY=synthetic-do-not-expose\n');
    const fromFile=loadEnv('development',folder,'VITE_');
    assert.equal(fromFile.VITE_API_TARGET,'express');assert.equal(fromFile.OPENAI_API_KEY,undefined);
    process.env.VITE_API_TARGET='django';process.env.VITE_API_PROXY='http://api:8000';
    assert.equal(loadEnv('development',folder,'VITE_').VITE_API_TARGET,'django');
    const resolved=(config as Function)({mode:'development',command:'serve'});
    assert.equal(resolved.server.proxy['/api'],'http://api:8000');
    assert.equal(resolved.preview.proxy['/api'],'http://api:8000');
    assert.equal(resolved.define['import.meta.env.VITE_API_TARGET'],'"django"');
    process.env.VITE_API_TARGET='express';delete process.env.VITE_API_PROXY;
    const legacy=(config as Function)({mode:'production',command:'build'});
    assert.equal(legacy.server.proxy['/api'],'http://127.0.0.1:4000');
    assert.equal(legacy.define['import.meta.env.VITE_API_TARGET'],'"express"');
    process.env.VITE_API_TARGET='invalid';assert.throws(()=>(config as Function)({mode:'development'}));
  }finally{for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);rmSync(folder,{recursive:true,force:true});}
});

test('actual config reads frontend mode file and rejects mismatched preview bundle',()=>{
  const mode='arti-check-'+process.pid;
  const envFile=fileURLToPath(new URL('../.env.'+mode+'.local',import.meta.url));
  const savedTarget=process.env.VITE_API_TARGET, savedProxy=process.env.VITE_API_PROXY;
  const output=mkdtempSync(join(tmpdir(),'arti-preview-'));
  let createdEnv=false;
  try{
    delete process.env.VITE_API_TARGET;delete process.env.VITE_API_PROXY;
    writeFileSync(envFile,'VITE_API_TARGET=express\nVITE_API_PROXY=http://localhost:4999\n',{flag:'wx'});
    createdEnv=true;
    const resolved=(config as Function)({mode,command:'serve'});
    assert.equal(resolved.define['import.meta.env.VITE_API_TARGET'],'"express"');
    assert.equal(resolved.server.proxy['/api'],'http://localhost:4999');
    const plugin=resolved.plugins.find((p:any)=>p.name==='arti-build-target');
    const server={config:{root:output,build:{outDir:'.'}}};
    assert.throws(()=>plugin.configurePreviewServer(server),/build first/);
    writeFileSync(join(output,'arti-build.json'),JSON.stringify({target:'django',base:'/api'}));
    assert.throws(()=>plugin.configurePreviewServer(server),/differs from build/);
    writeFileSync(join(output,'arti-build.json'),JSON.stringify({target:'express',base:'/api'}));
    assert.doesNotThrow(()=>plugin.configurePreviewServer(server));
  }finally{
    if(createdEnv)rmSync(envFile,{force:true});rmSync(output,{recursive:true,force:true});
    if(savedTarget===undefined)delete process.env.VITE_API_TARGET;else process.env.VITE_API_TARGET=savedTarget;
    if(savedProxy===undefined)delete process.env.VITE_API_PROXY;else process.env.VITE_API_PROXY=savedProxy;
  }
});
