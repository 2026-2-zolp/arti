import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMapOperationGate} from '../src/lib/mapOperationGate.ts';

function deferred<T>() {
  let resolve!: (v:T)=>void;
  const promise=new Promise<T>(r=>resolve=r);
  return {promise,resolve};
}

test('late upload from exhibition A cannot apply after switching to B or returning to A', async () => {
  const a=createMapOperationGate(); const reply=deferred<string>();
  const ticket=a.begin()!; const applied:string[]=[];
  const pending=reply.promise.then(value=>{if(a.isCurrent(ticket)) applied.push(value);});
  a.dispose(); const b=createMapOperationGate(); const bTicket=b.begin()!;
  assert.equal(b.isCurrent(bTicket),true);
  a.activate(); // Also covers effect setup after cleanup: the retired ticket stays invalid.
  reply.resolve('A response'); await pending;
  assert.deepEqual(applied,[]); assert.equal(a.finish(ticket),false);
  assert.equal(b.isCurrent(bTicket),true);
});

test('upload and delete cannot overlap and an old completion cannot unlock the next operation', () => {
  const gate=createMapOperationGate(); const upload=gate.begin()!;
  assert.equal(gate.begin(),null);
  assert.equal(gate.finish(upload),true);
  const deletion=gate.begin()!;
  assert.equal(gate.finish(upload),false);
  assert.equal(gate.isCurrent(deletion),true);
  assert.equal(gate.finish(deletion),true);
});

test('late delete failure is ignored by the retired map view', async () => {
  const gate=createMapOperationGate(); const response=deferred<void>();
  const ticket=gate.begin()!; let errors=0;
  const pending=response.promise.then(()=>{throw new Error('delayed failure');})
    .catch(()=>{if(gate.isCurrent(ticket)) errors+=1;})
    .finally(()=>gate.finish(ticket));
  gate.dispose(); response.resolve(); await pending;
  assert.equal(errors,0); assert.equal(gate.begin(),null);
});
