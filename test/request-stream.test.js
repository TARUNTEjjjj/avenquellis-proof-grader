import test from 'node:test';
import assert from 'node:assert/strict';
import {readJson,MAX_REQUEST_BYTES,createRequestHandler} from '../src/service.js';

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
test('a stalled body reaches its deadline even when cancellation never settles',{timeout:1000},async()=>{
 let cancelled=false;
 const body=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{'));},cancel(){cancelled=true;return new Promise(()=>{});}});
 await assert.rejects(readJson(request(body),{timeoutMs:20}),error=>error.status===408&&error.message==='Request body deadline exceeded.');
 assert.equal(cancelled,true);
 assert.equal(body.locked,false);
});
test('the body deadline covers the complete upload rather than restarting per chunk',{timeout:1000},async()=>{
 let timer;
 const body=new ReadableStream({start(c){timer=setInterval(()=>c.enqueue(new TextEncoder().encode(' ')),5);},cancel(){clearInterval(timer);}});
 try {await assert.rejects(readJson(request(body),{timeoutMs:30}),error=>error.status===408);}
 finally {clearInterval(timer);}
});
test('aborted uploads reject promptly and do not expose an abort reason',{timeout:1000},async()=>{
 for(const abortBefore of [true,false]){
  const controller=new AbortController();let cancelled=false;
  const body=new ReadableStream({cancel(){cancelled=true;return new Promise(()=>{});}});
  const input=new Request('https://grader.invalid/assess',{method:'POST',headers:{'Content-Type':'application/json'},body,duplex:'half',signal:controller.signal});
  if(abortBefore)controller.abort(new Error('private proof detail'));
  const reading=readJson(input);
  if(!abortBefore)controller.abort(new Error('private proof detail'));
  await assert.rejects(reading,error=>error.status===400&&error.message==='Request body was interrupted.');
  assert.equal(cancelled,true);
 }
});
test('transport failures return a safe validation error through the public handler',async()=>{
 const body=new ReadableStream({start(c){c.error(new Error('private proof detail'));}});
 const response=await createRequestHandler({publicDeployment:false})(request(body));
 assert.equal(response.status,400);
 assert.deepEqual(await response.json(),{error:'Request body could not be read.'});
});
test('a completed upload clears its deadline and releases the stream',async()=>{
 const body=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{"answer":"complete"}'));c.close();}});
 assert.deepEqual(await readJson(request(body),{timeoutMs:10}),{answer:'complete'});
 assert.equal(body.locked,false);
 for(const timeoutMs of [0,9,60001,NaN,Infinity,'20']) await assert.rejects(readJson(request('{}'),{timeoutMs}),RangeError);
});
