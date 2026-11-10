import test from 'node:test';import assert from 'node:assert/strict';import {Readable} from 'node:stream';
import {readNativeBootstrap} from '../src/native-bootstrap.mjs';
const valid={schemaVersion:1,socketPath:'/private/tmp/kst-501-fixture/b.sock',capability:'a'.repeat(44)};
test('native bootstrap only accepts bounded private socket frames over inherited pipe',async()=>{
 assert.deepEqual(await readNativeBootstrap(Readable.from([JSON.stringify(valid)+'\n'])),valid);
 for(const value of [{...valid,socketPath:'/tmp/public.sock'},{...valid,capability:'short'},{...valid,extra:'no'},{...valid,schemaVersion:2}])assert.equal(await readNativeBootstrap(Readable.from([JSON.stringify(value)])),null);
 assert.equal(await readNativeBootstrap(Readable.from(['x'.repeat(4097)])),null);
 assert.equal(await readNativeBootstrap(Readable.from(['{"schemaVersion":1,"schemaVersion":1}'])),null);
});
test('native bootstrap has a deadline and does not consume interactive terminal',async()=>{
 const input=new Readable({read(){}});const start=Date.now();assert.equal(await readNativeBootstrap(input,{timeoutMs:15}),null);assert.ok(Date.now()-start<500);input.destroy();
 const terminal=new Readable({read(){throw Error('interactive input must not be read');}});terminal.isTTY=true;assert.equal(await readNativeBootstrap(terminal),null);terminal.destroy();
});
