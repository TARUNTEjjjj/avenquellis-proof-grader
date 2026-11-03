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
