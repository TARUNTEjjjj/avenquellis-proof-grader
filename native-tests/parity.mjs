import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {certificateHelp,verifyCertificate} from '../src/certificate.js';

const binary=process.argv[2];
const fixtures=JSON.parse(readFileSync(new URL('../test/fixtures/certificate-questions.json',import.meta.url),'utf8'));
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
  const [minimum,maximum]=index===0?[1,12]:[7,30];
  for(let k=minimum;k<=maximum;k++){
    const q=structuredClone(base);q.parameters.k=k;
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
  copy=>{copy.generator.version=1;},copy=>{copy.source.kind={label:'original'};}
]) {
  const copy=structuredClone(q);mutation(copy);matches(copy,answer);
}
matches(q,answer+'\r');matches(q,answer+'\r\n');
for(const line of ['forward: -1 1','extra: x','reverse: 1000001 1','\u0000','I prove another claim.']) matches(q,answer+'\n'+line);
for(const raw of ['{"question": {},"question": {}}','{"a":'+ '['.repeat(66)+'0'+']'.repeat(66)+'}',JSON.stringify({question:{...q,maxMarks:2**38},answer})]){
  const run=spawnSync(binary,['assess'],{input:raw,encoding:'utf8'});
  assert.equal(run.status,2);assert.match(run.stderr,/error/);
}
console.log(assertions+' certificate/prose differential cases across all supported parameters.');
