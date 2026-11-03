import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateProof,readEvaluatorConfig,PROMPT_VERSION} from '../src/provider.js';
import {proofSpans,makeSpanReviewRequest,resolveSpanReview,SPAN_REVIEW_VERSION} from '../src/span-v2.js';
import {createPagesReviewHandler} from '../src/pages.js';

const question={id:'sample',type:'proof',statement:'Prove n(n+1) is divisible by 2 for every integer n.',maxMarks:7,rubric:[{id:'parity',description:'Identify an even factor.',points:3},{id:'product',description:'Deduce the result for the full product.',points:4}]};
const answer='One of two consecutive integers is even.\nTherefore n(n+1) is divisible by two.';
const response={parity:{points:3,spans:[0],reason:'Parity gives an even factor.'},product:{points:4,spans:[0,1],reason:'An even factor suffices.'}};
const env=run=>({AI:{run},EVALUATOR_PROVIDER:'workers-ai',EVALUATOR_PROTOCOL:'span-v2'});

test('span extraction preserves exact offsets and Unicode across paragraph boundaries',()=>{
  const proof='  '+ 'x'.repeat(277)+'𝑛²'+' x'.repeat(125)+'\r\n第一步。\n    \nConclusion.';
  const spans=proofSpans(proof);
  assert.equal(spans.at(-1).text,'Conclusion.');
  assert.ok(spans.every((s,i)=>s.id===i && s.text===proof.slice(s.start,s.end) && !/^\p{Surrogate}|\p{Surrogate}$/u.test(s.text)));
  assert.equal(spans.map(s=>s.text).join('').replace(/\s/g,''),proof.replace(/\s/g,''));
});
test('V2 emits two blind prompts and resolves each selected ID to original student text',async()=>{
  const requests=[];
  const result=await evaluateProof({question,answer},{env:env(async(_model,input)=>{requests.push(input); return {response:requests.length===1?response:JSON.stringify(response)};})});
  assert.equal(requests.length,2);assert.notEqual(requests[0].messages[0].content,requests[1].messages[0].content);
  assert.equal(requests[0].messages[1].content,requests[1].messages[1].content);
  const submission=JSON.parse(requests[0].messages[1].content).submissionSpans;
  assert.deepEqual(submission.map(s=>s.id),[0,1]); assert.equal(submission[1].text,answer.split('\n')[1]);
  assert.equal(result.suggestedScore,7);assert.equal(result.score,null);
  assert.deepEqual(result.criterionProposals[1].reviewers[0].quotes,answer.split('\n'));
  assert.equal(result.provenance.protocol,'span-v2');assert.equal(result.provenance.promptVersion,SPAN_REVIEW_VERSION);
  assert.equal(result.uncertainty.calibrated,false);
});
test('matching totals under different criterion marks still abstain',async()=>{
  let calls=0;
  const result=await evaluateProof({question,answer},{env:env(async()=>({response:calls++===0?{...response,parity:{...response.parity,points:2}}:{...response,product:{...response.product,points:3}}}))});
  assert.equal(result.suggestedScore,null);assert.equal(result.reviewReason,'reviewer_disagreement');
  assert.deepEqual(result.reviewerScoreRange,{min:6,max:6});
});
test('invalid point values, span IDs, absent evidence and incomplete schemas are distinguished',async()=>{
  const examples=[
    [{...response,parity:{...response.parity,points:4}},'invalid_marks'],
    [{...response,parity:{...response.parity,spans:[]}},'missing_support'],
    [{...response,parity:{...response.parity,spans:[9]}},'invalid_span'],
    [{...response,parity:{...response.parity,spans:[0,0]}},'invalid_span'],
    [{...response,extra:{points:0,spans:[],reason:'extra'}},'invalid_schema'],
    [{product:response.product},'invalid_schema'],
    ['not json','invalid_json']
  ];
  for(const [value,code] of examples){
    const result=await evaluateProof({question,answer},{env:env(async()=>({response:value}))});
    assert.equal(result.suggestedScore,null);assert.ok(result.reviews.every(r=>r.failure.code===code),code);
  }
  const cut=await evaluateProof({question,answer},{env:env(async()=>({response,finish_reason:'length'}))});
  assert.ok(cut.reviews.every(r=>r.failure.code==='incomplete_output'));
});
test('zero points need no invented citation; protocol choice is server-controlled and defaults to measured V1',async()=>{
  const zero={parity:{points:0,spans:[],reason:'No reasoning supplied.'},product:{points:0,spans:[],reason:'No deduction.'}};
  assert.deepEqual(resolveSpanReview(question,answer,zero).evidence,[]);
  assert.equal(readEvaluatorConfig({EVALUATOR_PROVIDER:'workers-ai',AI:{run(){}}}).protocol,'verbatim-v1');
  assert.throws(()=>readEvaluatorConfig({...env(()=>{}),EVALUATOR_PROTOCOL:'unreleased'}),/EVALUATOR_PROTOCOL/);
  const old=await evaluateProof({question,answer,EVALUATOR_PROTOCOL:'span-v2'},{env:{EVALUATOR_PROVIDER:'workers-ai',AI:{async run(_m,input){assert.ok(input.response_format.json_schema.properties.criterionScores);return {response:{criterionScores:{parity:0,product:0},rationale:'No justification accepted.',evidence:[],gaps:['Missing proof.']}};}}}});
  assert.equal(old.provenance.promptVersion,PROMPT_VERSION);assert.equal(old.provenance.protocol,'verbatim-v1');
  const expanded='x\n'.repeat(129);assert.throws(()=>makeSpanReviewRequest(question,expanded,0,900),/128-span/);
});
test('Pages forwards V2 only from host environment after server catalog and admission gates',async()=>{
  const onRequest=createPagesReviewHandler({resolveQuestion:()=>question,admit:()=>true});
  const request=new Request('https://unit.test/api/proof-review',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({questionId:question.id,answer})});
  const r=await onRequest({request,env:env(async()=>({response}))});
  const data=await r.json();assert.equal(r.status,200);assert.equal(data.provenance.protocol,'span-v2');assert.equal(data.suggestedScore,7);
});
