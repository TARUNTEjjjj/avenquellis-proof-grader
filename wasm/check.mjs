import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {instantiateGrader} from '../edge/runtime.js';
const root=new URL('../',import.meta.url);
const bytes=readFileSync(new URL('edge/veyra-grader-runtime.wasm',root));
const grade=await instantiateGrader(await WebAssembly.compile(bytes));
const {question,answer}=JSON.parse(readFileSync(new URL('examples/checked-gcd.json',root)));
for(const header of ['VEYRA','NOETHER']){
  const result=grade.assess(question,answer.replace('VEYRA-PROOF',header+'-PROOF'));
  assert.equal(result.status,'verified_certificate');assert.equal(result.score,10);assert.equal(result.provenance.nativeGrader,'veyra-grader-wasm/1');
}
assert.match(grade.scaffold(question),/^VEYRA-PROOF\/1\n/);
assert.equal(grade.assess(question,'For even n only.').score,null);
const {question:q,answer:submission}=JSON.parse(readFileSync(new URL('examples/human-review.json',root)));
const row=reviewer=>({reviewer,status:'proposal',criterionScores:{even:2,odd:0},rationale:'Even case proved; odd missing.',evidence:[{criterionId:'even',quote:submission}],gaps:['Odd case missing.']});
assert.equal(grade.compare(q,submission,[row(1),row(2)]).suggestedScore,2);
const fake=row(2);fake.evidence[0].quote='invented';assert.equal(grade.compare(q,submission,[row(1),fake]).suggestedScore,null);
console.log('Compiled Veyra grader verifies current and legacy certificates and enforces two-reader provisional consensus.');
