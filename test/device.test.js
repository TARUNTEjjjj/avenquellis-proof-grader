import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeviceGrader, deviceModelInfo, deviceAvailability} from '../src/device.js';

const question = {id:'even-proof',statement:'Prove n(n+1) is even for every integer n.',maxMarks:7,
  rubric:[{id:'factor',points:3,description:'Find the even factor.'},{id:'deduction',points:4,description:'Deduce the even product.'}]};
const answer = 'One of the consecutive integers is even.\nTherefore the product is divisible by two.';
const complete = {factor:{points:3,span:0,reason:'One consecutive integer is even.'}, deduction:{points:4,span:1,reason:'An even factor makes the product even.'}};
function model(generation) {
  const calls = [];
  const engine = {calls, resetChat:async()=>calls.push('reset'), unload:async()=>calls.push('unload'), interruptGenerate:async()=>calls.push('interrupt'),
    chat:{completions:{create:async input=>{calls.push(input);return generation(input,calls.filter(c=>typeof c==='object').length);}}}};
  return engine;
}
const response = output => ({choices:[{finish_reason:'stop',message:{content:'<think>\n\n</think>\n\n'+JSON.stringify(output)}}]});

test('local reviews run serially in clean chats and source IDs map to exact quotations', async () => {
  const engine = model(() => response(complete));
  let loads=0;
  const grader = createDeviceGrader({loadEngine:async()=>{loads++;return engine;}});
  assert.equal(loads,0);
  const result = await grader.grade(question,answer);
  assert.equal(loads,1);
  assert.deepEqual(engine.calls.map(v=>typeof v==='string'?v:'generate'),['reset','generate','reset','generate']);
  const inputs = engine.calls.filter(v=>typeof v==='object');
  assert.notEqual(inputs[0].messages[0].content,inputs[1].messages[0].content);
  assert.equal(inputs[0].messages[1].content,inputs[1].messages[1].content);
  assert.equal(inputs[0].response_format.type,'json_object');
  assert.equal(result.suggestedScore,7); assert.equal(result.score,null);
  assert.equal(result.provenance.provider,'browser-webllm');
  assert.equal(result.criterionProposals[1].reviewers[0].quotes[0],'Therefore the product is divisible by two.');
  await grader.release();assert.equal(engine.calls.at(-1),'unload');
});

test('local disagreement produces no combined mark and preserves each valid assessment', async () => {
  const engine = model((_,i)=>response(i===1?complete:{...complete,factor:{...complete.factor,points:1}}));
  const grader = createDeviceGrader({loadEngine:async()=>engine});
  const result = await grader.grade(question,answer);
  assert.equal(result.score,null);assert.equal(result.suggestedScore,null);
  assert.deepEqual(result.reviewerScoreRange,{min:5,max:7});
  assert.deepEqual(result.criterionProposals.map(v=>v.agreedPoints),[null,4]);
});

test('fabricated span IDs, omitted evidence, inflated marks and incomplete generations abstain', async () => {
  for(const generation of [
    ()=>response({...complete,factor:{...complete.factor,span:20}}),
    ()=>response({...complete,factor:{...complete.factor,span:-1}}),
    ()=>response({...complete,factor:{...complete.factor,points:8}}),
    ()=>({choices:[{finish_reason:'length',message:{content:JSON.stringify(complete)}}]})
  ]) {
    const grader=createDeviceGrader({loadEngine:async()=>model(generation)});
    const result=await grader.grade(question,answer);
    assert.equal(result.suggestedScore,null);assert.equal(result.score,null);
    assert.equal(result.uncertainty.kind,'insufficient_reviews');
  }
});

test('a long submission is not silently truncated and does not trigger a model download',async()=>{
  const grader=createDeviceGrader({loadEngine:async()=>assert.fail('Unsupported input must be rejected first.')});
  await assert.rejects(grader.grade(question,'x'.repeat(14000)),e=>e.code==='context_limit');
});

test('a GPU deadline prevents overlapping generation or resetting a still-active engine',async()=>{
  let finish;
  const engine=model(()=>new Promise(resolve=>{finish=()=>resolve(response(complete));}));
  const grader=createDeviceGrader({loadEngine:async()=>engine,reviewTimeoutMs:50});
  const result=await grader.grade(question,answer);
  assert.equal(result.reviews[0].failure.code,'device_timeout');
  assert.equal(result.reviews[1].failure.code,'device_busy');
  assert.equal(engine.calls.filter(v=>v==='reset').length,1);
  assert.ok(engine.calls.includes('interrupt')); finish();
});

test('device metadata and availability checks do not load a runtime or weights',async()=>{
  const info=deviceModelInfo();assert.equal(info.weightBytes,968001536);assert.equal(info.contextWindowTokens,4096);
  assert.equal((await deviceAvailability()).available,false);
});
