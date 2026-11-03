import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePartialCreditLedger,visibleCandidateText,makePartialCreditRequest,evaluatePartialCredit,PRIMARY_MODEL,FALLBACK_MODEL,PARTIAL_CREDIT_VERSION} from '../src/partial-credit.js';

const question={id:'smoke-parity',statement:'Prove that n(n+1) is even for every integer n.',maxMarks:4,rubric:[{id:'even',points:2,description:'Establish even n case.'},{id:'odd',points:2,description:'Establish odd n case.'}]};
const answer='Suppose n=2k. The product equals 2[k(2k+1)], twice an integer.\nThe odd case remains unproved.';
const even={p:2,s:[0],earned:'Even-input case.',why:'k(2k+1) is an integer and supplies the required factorization.',gap:''};
const odd={p:0,s:[1],earned:'',why:'The response admits that this case remains unproved.',gap:'No reasoning for odd n.'};
const partial={audit:'The even-input deduction is valid; the odd case is missing.',marks:[even,odd]};
const output=v=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(v),reasoning_content:'Unpublished internal reasoning.'}}]});
const env=run=>({PARTIAL_CREDIT_TRIAL:'enabled',AI:{run},EVALUATOR_MODEL:PRIMARY_MODEL,EVALUATOR_MAX_TOKENS:'2400'});
const parse=(obj,q=question,a=answer)=>parsePartialCreditLedger(q,a,JSON.stringify(obj));

test('valid partial progress earns exactly its established rubric points and unresolved work remains visible',()=>{
  const r=parse(partial);assert.equal(r.total,2);assert.equal(r.whole.state,'PARTIAL');assert.deepEqual(r.criteria.map(c=>c.points),[2,0]);
  assert.equal(r.criteria[0].support[0].quote,answer.split('\n')[0]);assert.equal(r.criteria[1].defect[0].quote,answer.split('\n')[1]);
});
test('a valid alternate route can map equivalent deductions to the same full-credit rubric',()=>{
  const proof='Consecutive integers have opposite parity.\nAn even factor exists in both cases.';
  const alt={audit:'The adjacent integers argument covers either parity.',marks:[{p:2,s:[0,1],earned:'Even inputs covered.',why:'The first factor is even.',gap:''},{p:2,s:[0,1],earned:'Odd inputs covered.',why:'The second factor is even.',gap:''}]};
  const r=parse(alt,question,proof);assert.equal(r.total,4);assert.equal(r.whole.state,'COMPLETE');
});
test('unknown is not zero, and an explicitly reported gap cannot receive full marks',()=>{
  const unknown={...odd,p:null,gap:'The route may be equivalent; the source allocation is unclear.'};
  const r=parse({...partial,marks:[even,unknown]});assert.equal(r.total,null);assert.equal(r.whole.state,'CHECK');assert.equal(r.criteria[0].points,2);
  assert.throws(()=>parse({...partial,marks:[{...even,gap:'The essential implication is unproved.'},odd]}),e=>e.code==='inconsistent_award');
  assert.throws(()=>parse({...partial,marks:[even,{...odd,gap:''}]}),e=>e.code==='missing_check');
});
test('holistic near-completion and substantial partial progress have distinct numerical categories',()=>{
  const q={id:'h',statement:'Prove the given claim.',maxMarks:7,rubric:[{id:'h',points:7,description:'Use the holistic guidance.'}]};
  const near={audit:'The main proof is valid, except for one boundary check.',marks:[{p:6,s:[0],earned:'Interior argument.',why:'The deduction works away from the endpoint.',gap:'One endpoint substitution remains.'}]};
  assert.equal(parse(near,q).whole.state,'ALMOST');
  assert.equal(parse({...near,marks:[{...near.marks[0],p:2}]},q).whole.state,'PARTIAL');
});
test('source-specific levels and dependencies take precedence over generic numerical anchors',()=>{
  const guide={version:1,source:'Authored demonstration',criteria:[{id:'even',levels:[{points:0,when:'Absent.'},{points:2,when:'Established.',requires:[{id:'odd',atLeast:1}]}]}]};
  assert.throws(()=>parse(partial,{...question,partialMarkingGuide:guide}),e=>e.code==='guide_violation');
  assert.throws(()=>parse({...partial,marks:[{...even,p:1,gap:'A deduction remains.'},odd]},{...question,partialMarkingGuide:guide}),e=>e.code==='guide_violation');
});
test('incompatible scheme paths cannot be summed into an unlisted award',()=>{
  const q={id:'exclusive',statement:'Prove this claim.',maxMarks:10,rubric:[{id:'whole',points:10,description:'Alternative path awards are nonadditive.'}],partialMarkingGuide:{version:1,source:'Synthetic exclusive-path rubric',criteria:[{id:'whole',levels:[{points:0,when:'No progress.'},{points:2,when:'Valid special case.'},{points:4,when:'Core lemma complete.'},{points:9,when:'Only minor repair.'},{points:10,when:'Complete.'}]}]}};
  const evidence={p:6,s:[0],earned:'Special case and lemma.',why:'Incorrectly adding two alternative progress levels.',gap:'Conclusion missing.'};
  assert.throws(()=>parse({audit:'Partial.',marks:[evidence]},q),e=>e.code==='guide_violation');
});
test('invalid marks, invented evidence and unsupported positive awards fail closed',()=>{
  for(const [row,code] of [[{...even,s:[9]},'invalid_span'],[{...even,s:[]},'missing_support'],[{...even,s:[0,0]},'invalid_span'],[{...even,p:2.5},'invalid_marks'],[{...even,why:''},'missing_check'],[{...even,extra:'x'},'invalid_ledger']]){
    assert.throws(()=>parse({...partial,marks:[row,odd]}),e=>e.code===code);
  }
});
test('only visible completed output is parsed; hidden reasoning and truncation do not become verdicts',()=>{
  const json=JSON.stringify(partial);
  assert.equal(visibleCandidateText({choices:[{finish_reason:'stop',message:{content:'<think>private</think>\n```json\n'+json+'\n```'}}]}),json);
  assert.throws(()=>visibleCandidateText({choices:[{finish_reason:'length',message:{content:json}}]}),e=>e.code==='incomplete_output');
  assert.throws(()=>visibleCandidateText({choices:[{finish_reason:'stop',message:{content:'',reasoning_content:json}}]}),e=>e.code==='incomplete_output');
  assert.equal(visibleCandidateText({status:'completed',output:[{type:'reasoning',summary:[]},{type:'message',role:'assistant',content:[{type:'output_text',text:json}]}]}),json);
});
test('the separate candidate needs explicit enablement and only exact criterion agreement yields a combined proposal',async()=>{
  await assert.rejects(evaluatePartialCredit({question,answer},{env:{AI:{run:()=>assert.fail()}}}),e=>e.code==='candidate_disabled');
  const inputs=[];const r=await evaluatePartialCredit({question,answer},{env:env(async(_m,p)=>{inputs.push(p);return output(partial);})});
  assert.equal(r.suggestedScore,2);assert.equal(r.score,null);assert.equal(r.primaryProposal,2);assert.equal(r.auditProposal,2);assert.equal(r.provenance.promptVersion,PARTIAL_CREDIT_VERSION);
  assert.equal(r.reviews[0].criterionScores.even,2);assert.deepEqual(r.criterionProposals.map(x=>x.agreedPoints),[2,0]);
  assert.notEqual(inputs[0].messages[0].content,inputs[1].messages[0].content);assert.equal(inputs[0].messages[1].content,inputs[1].messages[1].content);assert.ok(inputs.every(p=>p.messages[1].content.endsWith('/think')&&p.max_tokens===2400));
  let calls=0;const disputed=await evaluatePartialCredit({question,answer},{env:env(async()=>output(calls++?{...partial,marks:[{...even,p:1,gap:'A deduction is not established.'},odd]}:partial))});
  assert.deepEqual([disputed.primaryProposal,disputed.auditProposal,disputed.suggestedScore],[2,1,null]);
});
test('a failed audit stays separate from a valid primary diagnostic',async()=>{
  let calls=0;const r=await evaluatePartialCredit({question,answer},{env:env(async()=>calls++?{choices:[{finish_reason:'stop',message:{content:'not JSON'}}]}:output(partial))});
  assert.equal(r.primaryProposal,2);assert.equal(r.auditProposal,null);assert.equal(r.suggestedScore,null);assert.equal(r.readers[1].failureCode,'invalid_json');
});
test('only approved models are available and fallback cannot auto-activate',async()=>{
  assert.throws(()=>makePartialCreditRequest(question,answer,0,{model:'@cf/other'}),e=>e.code==='invalid_config');
  await assert.rejects(evaluatePartialCredit({question,answer},{env:{...env(()=>assert.fail()),EVALUATOR_MODEL:FALLBACK_MODEL}}),e=>e.code==='fallback_disabled');
  const p=makePartialCreditRequest(question,answer,0,{model:FALLBACK_MODEL,maxTokens:700});assert.equal(p.max_tokens,700);assert.ok(!p.messages[1].content.endsWith('/think'));
});

test('replay the two recorded synthetic parity ledgers without inference',async()=>{
  const {readFile}=await import('node:fs/promises');
  const {question:q,answer:a,visibleTexts}=JSON.parse(await readFile(new URL('./fixtures/partial-credit-synthetic-replay.json',import.meta.url),'utf8'));
  const aRead=parsePartialCreditLedger(q,a,visibleTexts[0]);
  assert.deepEqual(aRead.criteria.map(c=>c.points),[2,0]);
  assert.deepEqual(aRead.criteria[1].support,[]);assert.equal(aRead.criteria[1].secured,'');
  assert.equal(aRead.criteria[1].readerNote,'No valid reasoning for the odd case.');
  assert.throws(()=>parsePartialCreditLedger(q,a,visibleTexts[1]),e=>e.code==='inconsistent_award');
  const changed=JSON.parse(visibleTexts[1]);changed.marks[0].gap='';
  assert.equal(parsePartialCreditLedger(q,a,JSON.stringify(changed)).total,2);
  let index=0; const result=await evaluatePartialCredit({question:q,answer:a},{env:env(async()=>({choices:[{finish_reason:'stop',message:{content:visibleTexts[index++]}}]}))});
  assert.equal(result.primaryProposal,2);assert.equal(result.suggestedScore,null);assert.equal(result.readers[1].failureCode,'inconsistent_award');
});
