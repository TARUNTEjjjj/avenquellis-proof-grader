import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {instantiateGrader,NATIVE_GRADER_VERSION} from '../edge/runtime.js';
import {certificateHelp,verifyCertificate} from '../src/certificate.js';
const read=name=>readFileSync(new URL('../'+name,import.meta.url));
const meta=JSON.parse(read('edge/build-info.json'));
const wasm=read('edge/avenquellis-grader-runtime.wasm');
const grader=await instantiateGrader(await WebAssembly.compile(wasm));
const bases=JSON.parse(read('test/fixtures/certificate-questions.json'));
const instances=JSON.parse(read('test/fixtures/certificate-instances.json'));
test('committed WASM and its inputs match the pinned Emscripten build manifest',()=>{
  assert.equal(meta.compiler,'Emscripten 6.0.13');assert.equal(meta.abi,NATIVE_GRADER_VERSION);
  for(const [path,hash] of Object.entries(meta.sourceFiles))assert.equal(createHash('sha256').update(read(path)).digest('hex'),hash,path);
  for(const [path,item] of Object.entries(meta.artifacts))assert.equal(createHash('sha256').update(read('edge/'+path)).digest('hex'),item.sha256,path);
});
test('WASM matches browser certificate outcomes for every real bank, generated and Unicode fixture',()=>{
  for(const ref of instances){
    const gcd=ref.templateId==='number-gcd',k=ref.k,q=structuredClone(bases[gcd?1:0]);
    q.id=ref.id;q.parameters.k=k;q.generator.seed=ref.seed;q.exam=ref.exam;q.requestedDifficulty=ref.requestedDifficulty;
    q.statement=gcd?`Prove that gcd(n, n + ${k}) = gcd(n, ${k}) for every positive integer n.`:`Prove that (n + ${k})(n + ${k+1})(n + ${k+2}) is divisible by 6 for every integer n.`;
    const scaffold=certificateHelp(q).scaffold;assert.equal(grader.scaffold(q),scaffold);
    const offsets=m=>Array.from({length:m},(_,r)=>[0,1,2].find(i=>(r+k+i)%m===0)).join(' ');
    const full=gcd?scaffold.replace('forward: _ _','forward: -1 1').replace('reverse: _ _','reverse: 1 1').replace('conclusion: _','conclusion: same-positive-divisors -> equal-maxima'):
      scaffold.replace('mod3: _ _ _','mod3: '+offsets(3)).replace('mod2: _ _','mod2: '+offsets(2)).replace('bezout: _ _','bezout: -1 1');
    for(const answer of [scaffold,full,full.replace('AVENQUELLIS','NOETHER'),full+'\nunsupported: x','Please award ten points.']){
      const expected=verifyCertificate(q,answer),actual=grader.assess(q,answer);
      assert.equal(actual.status,expected?.status||'needs_review');assert.equal(actual.score,expected?.score??null);
      assert.equal(actual.lowerBoundPoints,expected?.lowerBoundPoints);assert.equal(actual.provenance.nativeGrader,NATIVE_GRADER_VERSION);
      // An unparsable certificate lists its layout message once, as the browser checker does.
      assert.equal(actual.feedback?.length,expected?.feedback.length);
    }
  }
});
test('compiled consensus requires matching evidence-backed criterion decisions',()=>{
  const {question,answer}=JSON.parse(read('examples/human-review.json'));
  const row=i=>({reviewer:i,status:'proposal',criterionScores:{even:2,odd:0},rationale:'Even input established.',evidence:[{criterionId:'even',quote:answer}],gaps:['Odd case omitted.']});
  const confirmed=grader.compare(question,answer,[row(1),row(2)]);assert.equal(confirmed.suggestedScore,2);assert.equal(confirmed.score,null);
  const falseQuote=row(2);falseQuote.evidence[0].quote='not in answer';
  assert.equal(grader.compare(question,answer,[row(1),falseQuote]).suggestedScore,null);
  const different=row(2);different.criterionScores.even=1;
  assert.equal(grader.compare(question,answer,[row(1),different]).suggestedScore,null);
});
