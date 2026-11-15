import test from 'node:test';
import assert from 'node:assert/strict';
import {readJson,MAX_REQUEST_BYTES} from '../src/service.js';

function request(stream,headers={}) {
 return new Request('https://grader.invalid/assess',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:stream,duplex:'half'});
}
test('early request rejection cancels the unread body without waiting for cleanup',async()=>{
 for(const [headers,status] of [[{'Content-Type':'text/plain'},415],[{'Content-Length':String(MAX_REQUEST_BYTES+1)},413]]){
  let cancelled=false;
  const body=new ReadableStream({cancel(){cancelled=true;return new Promise(()=>{});}});
  await assert.rejects(readJson(request(body,headers)),error=>error.status===status);
  assert.equal(cancelled,true);
 }
});
test('stream-limit rejection is prompt even when cancellation never settles',async()=>{
 let cancelled=false;
 const body=new ReadableStream({start(c){c.enqueue(new Uint8Array(MAX_REQUEST_BYTES+1));},cancel(){cancelled=true;return new Promise(()=>{});}});
 const result=await Promise.race([readJson(request(body)).catch(error=>error),new Promise(resolve=>setTimeout(()=>resolve('timed out'),100))]);
 assert.equal(result.status,413);assert.equal(cancelled,true);
});
test('invalid UTF-8 cancels the remainder and preserves the safe error message',async()=>{
 let cancelled=false;
 const body=new ReadableStream({start(c){c.enqueue(new Uint8Array([0xff]));},cancel(){cancelled=true;throw new Error('cleanup detail');}});
 await assert.rejects(readJson(request(body)),/Malformed UTF-8 JSON request/);
 assert.equal(cancelled,true);
});
