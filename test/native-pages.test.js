import test from 'node:test';
import assert from 'node:assert/strict';
import {createPagesReviewHandler,applyNativeConsensus} from '../src/pages.js';

const question={id:'example',type:'proof',statement:'Prove the claim.',maxMarks:2,rubric:[{id:'proof',description:'Establish the claim.',points:2}]};
const request=answer=>new Request('https://example.test/api/grade',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({questionId:question.id,answer})});
test('a recognized native certificate completes before binding configuration, admission or AI evaluation',async()=>{
  const stored={questionId:question.id,status:'verified_certificate',score:2,complete:true};
  const handler=createPagesReviewHandler({resolveQuestion:()=>question,loadGrader:()=>({assess:()=>stored}),admit:()=>assert.fail()});
  const response=await handler({request:request('AVENQUELLIS-PROOF/1'),env:{}});assert.equal(response.status,200);assert.deepEqual(await response.json(),stored);
});
test('native failure returns 503 and never falls back to a JS-only grade',async()=>{
  const handler=createPagesReviewHandler({assessmentOnly:true,resolveQuestion:()=>question,loadGrader:()=>{throw Error('private runtime message');},admit:()=>assert.fail()});
  const result=await handler({request:request('proof'),env:{}});assert.equal(result.status,503);assert.equal((await result.json()).code,'native_unavailable');
});
test('unvalidated model totals and criterion details cannot survive native refusal',()=>{
  const model={score:2,suggestedScore:2,reviews:[{status:'proposal'},{status:'proposal'}],criterionProposals:[{agreedPoints:2}],provenance:{provider:'workers-ai'}};
  const reading={reviewer:1,score:null,status:'failed'};
  const grader={compare:()=>({reviews:[reading,{...reading,reviewer:2}],suggestedScore:null,score:null,status:'needs_review',provenance:{nativeGrader:'avenquellis-grader-wasm/1'}})};
  const checked=applyNativeConsensus(question,'proof',model,grader);assert.equal(checked.suggestedScore,null);assert.equal(checked.criterionProposals[0].agreedPoints,null);assert.equal(checked.reviewerScoreRange,null);assert.equal(checked.uncertainty.kind,'insufficient_reviews');
});
const until=async condition=>{for(let i=0;i<400&&!condition();i++)await new Promise(resolve=>setTimeout(resolve,5));assert.ok(condition());};
test('certificate checks and assessments are answered while two model reviews hold both slots',async()=>{
  const calls=[];const env={AI:{run:()=>new Promise(resolve=>calls.push(resolve))}};
  const certificate={questionId:question.id,status:'verified_certificate',score:2,complete:true};
  const grader={assess:(_q,answer)=>answer.startsWith('AVENQUELLIS-PROOF/1')?certificate:{status:'needs_review',score:null},
    compare:(_q,_a,reviews)=>({reviews,suggestedScore:null,score:null,status:'needs_review',provenance:{}})};
  let admissions=0;const options={resolveQuestion:()=>question,loadGrader:()=>grader,admit:()=>{admissions++;return true;}};
  const grade=createPagesReviewHandler(options),assess=createPagesReviewHandler({...options,assessmentOnly:true});
  const reviews=[grade({request:request('First prose proof.'),env}),grade({request:request('Second prose proof.'),env})];
  await until(()=>calls.length===4);
  assert.equal((await grade({request:request('Third prose proof.'),env})).status,429);
  assert.equal((await grade({request:request('AVENQUELLIS-PROOF/1'),env})).status,200);
  const overlapping=await Promise.all(Array.from({length:6},()=>assess({request:request('AVENQUELLIS-PROOF/1'),env})));
  assert.deepEqual(overlapping.map(r=>r.status),[200,200,200,200,200,200]);assert.equal(admissions,2);
  calls.forEach(finish=>finish({}));
  assert.deepEqual((await Promise.all(reviews)).map(r=>r.status),[200,200]);
});
test('request bodies that never finish do not hold review slots',async()=>{
  const streams=[];
  const stalled=()=>new Request('https://example.test/api/grade',{method:'POST',headers:{'Content-Type':'application/json'},duplex:'half',
    body:new ReadableStream({start(controller){streams.push(controller);controller.enqueue(new TextEncoder().encode('{"questionId":'));}})});
  let admissions=0;const handler=createPagesReviewHandler({resolveQuestion:()=>question,admit:()=>{admissions++;return true;}});
  const env={AI:{run:async()=>({response:{criterionScores:{proof:0},rationale:'No argument is given.',evidence:[],gaps:['The claim is not proved.']}})}};
  const uploads=[handler({request:stalled(),env}),handler({request:stalled(),env})];
  const review=await handler({request:request('An attempted proof.'),env});
  assert.equal(review.status,200);assert.equal((await review.json()).suggestedScore,0);assert.equal(admissions,1);
  streams.forEach(controller=>controller.close());
  assert.deepEqual((await Promise.all(uploads)).map(r=>r.status),[400,400]);
});
test('an answer with an unpaired surrogate gets 400 before native grading or admission',async()=>{
  for(const assessmentOnly of [false,true]){
    let admissions=0;
    const handler=createPagesReviewHandler({assessmentOnly,resolveQuestion:()=>question,
      loadGrader:()=>({assess:()=>assert.fail('Ill-formed text must not reach the native grader')}),admit:()=>{admissions++;return true;}});
    const response=await handler({request:request('Let x = 1 \ud835 then the claim holds.'),env:{AI:{run:()=>assert.fail('No model call expected')}}});
    assert.equal(response.status,400);assert.match((await response.json()).error,/well-formed/);assert.equal(admissions,0);
  }
});
test('input the evaluator would refuse gets 400 without spending admission',async()=>{
  let admissions=0;const handler=createPagesReviewHandler({resolveQuestion:()=>question,admit:()=>{admissions++;return true;}});
  const run=()=>assert.fail('No model call expected');
  const lines=Array.from({length:129},(_,i)=>`Step ${i+1} follows.`).join('\n');
  const spans=await handler({request:request(lines),env:{AI:{run},EVALUATOR_PROTOCOL:'span-v2'}});
  assert.equal(spans.status,400);assert.match((await spans.json()).error,/128-span/);
  const oversized=await handler({request:request('\u0001'.repeat(16000)),env:{AI:{run}}});
  assert.equal(oversized.status,400);assert.match((await oversized.json()).error,/65KB/);
  assert.equal(admissions,0);
});
test('assessment accepts 50,000 characters while the review route refuses 20,001',async()=>{
  const lengths=[];const grader={assess:(_q,answer)=>{lengths.push(answer.length);return {status:'needs_review',score:null};}};
  const options={resolveQuestion:()=>question,loadGrader:()=>grader,admit:()=>assert.fail('No admission expected')};
  const assess=createPagesReviewHandler({...options,assessmentOnly:true}),grade=createPagesReviewHandler(options);
  assert.equal((await assess({request:request('∀'.repeat(50000)),env:{}})).status,200);
  const tooLong=await assess({request:request('x'.repeat(50001)),env:{}});
  assert.equal(tooLong.status,400);assert.match((await tooLong.json()).error,/up to 50,000/);
  const refused=await grade({request:request('x'.repeat(20001)),env:{}});
  assert.equal(refused.status,400);assert.match((await refused.json()).error,/1–20,000/);
  assert.deepEqual(lengths,[50000]);
});
