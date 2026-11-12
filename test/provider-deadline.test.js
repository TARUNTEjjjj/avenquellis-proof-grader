import test from 'node:test';
import assert from 'node:assert/strict';
import {createHttpEvaluator} from '../src/provider.js';

const question={id:'q',statement:'Prove the claim.',maxMarks:1,rubric:[{id:'proof',description:'Justify it.',points:1}]};
const config={timeoutMs:50,endpoint:'http://localhost/v1/chat/completions',model:'test',tokenParameter:'max_tokens',maxTokens:256};
const run=fetchImpl=>createHttpEvaluator({config,reviewerIndex:0,fetchImpl})({question,submission:'A proof.'});

test('HTTP errors and oversized streams reject without waiting for cancellation', {timeout:1000}, async()=>{
  for (const kind of ['http','length','stream']) {
    let cancelled=false;
    const body=new ReadableStream({
      start(controller){if(kind==='stream')controller.enqueue(new Uint8Array(65537));},
      cancel(){cancelled=true;return new Promise(()=>{});},
    });
    const response=new Response(body,{status:kind==='http'?429:200,headers:kind==='length'?{'Content-Length':'65537'}:{}});
    await assert.rejects(run(async()=>response),{code:kind==='http'?'provider_http_error':'response_too_large'});
    assert.equal(cancelled,true);
  }
});

test('the configured deadline bounds an uncooperative fetch and response body', {timeout:1000}, async()=>{
  await assert.rejects(run(()=>new Promise(()=>{})),{code:'timeout'});
  let cancelled=false;
  await assert.rejects(run(async()=>new Response(new ReadableStream({
    cancel(){cancelled=true;return new Promise(()=>{});},
  }))),{code:'timeout'});
  assert.equal(cancelled,true);
});

test('malformed UTF-8 cannot become an accepted replacement character in a review', async()=>{
  const critique={criterionScores:{proof:0},rationale:'MARKER',evidence:[],gaps:['No evidence.']};
  const text=JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(critique)}}]});
  const position=text.indexOf('MARKER');
  const body=Buffer.concat([Buffer.from(text.slice(0,position)),Buffer.from([0xff]),Buffer.from(text.slice(position+6))]);
  await assert.rejects(run(async()=>new Response(body)),{code:'invalid_output'});
});
