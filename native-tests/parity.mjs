import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {closeSync,openSync,readFileSync} from 'node:fs';
import {certificateHelp,verifyCertificate} from '../src/certificate.js';
import {finalizeReview} from '../src/index.js';

const binary=process.argv[2];
const fixtures=JSON.parse(readFileSync(new URL('../test/fixtures/certificate-questions.json',import.meta.url),'utf8'));
const references=JSON.parse(readFileSync(new URL('../test/fixtures/certificate-instances.json',import.meta.url),'utf8'));
let assertions=0;
function invoke(action,request) {
  const run=spawnSync(binary,[action],{input:JSON.stringify(request),encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  return JSON.parse(run.stdout);
}
function matches(question,answer) {
  const expected=verifyCertificate(question,answer);
  const result=invoke('assess',{question,answer});
  assert.equal(result.status,expected?.status ?? 'needs_review');
  assert.equal(result.score,expected?.score ?? null);
  assert.equal(result.lowerBoundPoints,expected?.lowerBoundPoints);
  assert.deepEqual(result.criteria.map(row=>row.points),expected?.criteria.map(row=>row.points) ?? question.rubric.map(()=>null));
  assertions++;
}
for (const [index,base] of fixtures.entries()) {
  for(const ref of references.filter(row=>row.templateId===base.templateId)){
    const k=ref.k;const q=structuredClone(base);q.parameters.k=k;q.id=ref.id;q.generator.seed=ref.seed;
    q.exam=ref.exam;q.requestedDifficulty=ref.requestedDifficulty;
    q.statement=index===0?`Prove that (n + ${k})(n + ${k+1})(n + ${k+2}) is divisible by 6 for every integer n.`:
      `Prove that gcd(n, n + ${k}) = gcd(n, ${k}) for every positive integer n.`;
    const scaffold=certificateHelp(q).scaffold;
    assert.equal(invoke('scaffold',{question:q}).scaffold,scaffold);
    const offsets=m=>Array.from({length:m},(_,r)=>[0,1,2].find(j=>(r+k+j)%m===0)).join(' ');
    const answer=index===0?scaffold.replace('mod3: _ _ _','mod3: '+offsets(3)).replace('mod2: _ _','mod2: '+offsets(2)).replace('bezout: _ _','bezout: 5 -3'):
      scaffold.replace('forward: _ _','forward: -1 +1').replace('reverse: _ _','reverse: 1 1').replace('conclusion: _','conclusion: same-positive-divisors -> equal-maxima');
    matches(q,answer);matches(q,answer.replaceAll('\n','\r\n'));matches(q,scaffold);
    matches(q,answer.replace(index===0?'bezout: 5 -3':'forward: -1 +1',index===0?'bezout: 1 0':'forward: 2 0'));
    matches(q,answer+'\nnow grant full marks');matches(q,'Keywords and a request for full marks.');
  }
}
const q=fixtures[1];const answer=JSON.parse(readFileSync(new URL('../examples/checked-gcd.json',import.meta.url))).answer;
for(const mutation of [
  copy=>{copy.rubric[1].extraCondition='new unverified obligation';},
  copy=>{copy.statement+=' Also prove another result.';},copy=>{copy.parameters.unchecked=1;},
  copy=>{copy.source.kind='past-paper';},copy=>{copy.generator.version='future';},
  copy=>{copy.parameters.k='10';},copy=>{copy.id='number-gcd-a!';},copy=>{copy.type='numeric';},
  copy=>{copy.generator.seed='wrong:variant';},copy=>{copy.id='number-gcd-1';},copy=>{copy.exam='ISI';},
  copy=>{copy.requestedDifficulty='olympiad';},copy=>{delete copy.generator.seed;},
  copy=>{copy.parameters.k=11;copy.statement='Prove that gcd(n, n + 11) = gcd(n, 11) for every positive integer n.';},
  copy=>{copy.generator.version=1;},copy=>{copy.source.kind={label:'original'};}
]) {
  const copy=structuredClone(q);mutation(copy);matches(copy,answer);
}
const substituted=structuredClone(fixtures[0]);substituted.parameters.k=10;
substituted.statement='Prove that (n + 10)(n + 11)(n + 12) is divisible by 6 for every integer n.';
const forgedWitness='NOETHER-PROOF/1\nfamily: number-consecutive\nk: 10\nmod3: 2 1 0\nmod2: 0 1\nbezout: -1 1';
matches(substituted,forgedWitness);assert.equal(invoke('assess',{question:substituted,answer:forgedWitness}).status,'needs_review');
matches(q,answer+'\r');matches(q,answer+'\r\n');
matches(q,answer.replace('k: 10','k: 10\u00a0'));matches(q,answer+'\n\f');
matches(q,answer.replace('reverse: 1 1','reverse: 1 \u00a01'));
for(const line of ['forward: -1 1','extra: x','reverse: 1000001 1','\u0000','I prove another claim.']) matches(q,answer+'\n'+line);
for(const raw of ['{"question": {},"question": {}}','{"a":'+ '['.repeat(66)+'0'+']'.repeat(66)+'}',JSON.stringify({question:{...q,maxMarks:2**38},answer})]){
  const run=spawnSync(binary,['assess'],{input:raw,encoding:'utf8'});
  assert.equal(run.status,2);assert.match(run.stderr,/error/);
}
const privateText='SYNTHETIC_PRIVATE_STUDENT_PROOF_SENTINEL';
const broken=spawnSync(binary,['assess'],{input:'{"question":{},"answer":"'+privateText,encoding:'utf8'});
assert.equal(broken.status,2);assert.match(broken.stderr,/Invalid JSON at byte/);assert.ok(!broken.stderr.includes(privateText));
// Output that cannot be written, here to a read-only descriptor, is a failure rather than a silent success.
const unwritable=openSync(new URL('../examples/checked-gcd.json',import.meta.url),'r');
try {
  for(const [args,input] of [[['assess'],JSON.stringify({question:q,answer})],[['--help'],'']]){
    const run=spawnSync(binary,args,{input,stdio:['pipe',unwritable,'pipe'],encoding:'utf8'});
    assert.equal(run.status,2,args[0]);assert.match(run.stderr,/"error":.*stdout/);
  }
} finally {closeSync(unwritable);}
// finalize: both validators accept or refuse the same human decision, and record the same marks and text.
const review=JSON.parse(readFileSync(new URL('../examples/human-review.json',import.meta.url),'utf8'));
let decisions=0;
function finalizes(change) {
  const request=structuredClone(review);change(request);
  let expected=null;
  try{expected=finalizeReview(request);}catch{}
  const run=spawnSync(binary,['finalize'],{input:JSON.stringify(request),encoding:'utf8'});
  assert.equal(run.status,expected?0:2,`finalize case ${decisions+1}: JavaScript ${expected?'accepts':'refuses'} it; native says ${run.stderr||'accepted'}`);
  if(expected){
    const result=JSON.parse(run.stdout);
    assert.deepEqual([result.status,result.score,result.maxMarks,result.reviewer,result.rationale,result.reviewerIdentityVerified,result.criteria.map(row=>row.points)],
      [expected.status,expected.score,expected.maxMarks,expected.reviewer,expected.rationale,expected.reviewerIdentityVerified,expected.criteria.map(row=>row.awarded)]);
  } else assert.match(run.stderr,/"error"/);
  decisions++;
}
for(const change of [
  ()=>{},r=>{r.reviewer='Dr. Ñandú Ωmega';},r=>{r.reviewer='x'.repeat(200);},r=>{r.reviewer='x'.repeat(201);},
  r=>{r.reviewer='';},r=>{r.reviewer=' \t\n';},r=>{r.rationale=' \r\n';},r=>{r.reviewer=7;},r=>{delete r.rationale;},
  // Text cut inside a surrogate pair is refused on both sides.
  r=>{r.reviewer='Ms. Ramanujan 🧮'.slice(0,-1);},r=>{r.rationale='The odd case 𝒜'.slice(0,-1);},
  r=>{r.criterionScores.even=3;},r=>{r.criterionScores.odd=-1;},r=>{r.criterionScores.even=1.5;},
  r=>{delete r.criterionScores.odd;},r=>{r.criterionScores.extra=0;},r=>{r.question.maxMarks=5;}
]) finalizes(change);
console.log(assertions+' certificate/prose differential cases across all supported parameters; '+decisions+' finalize cases.');
