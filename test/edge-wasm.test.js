import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {instantiateGrader,NATIVE_GRADER_VERSION} from '../edge/runtime.js';
import {certificateHelp,verifyCertificate} from '../src/certificate.js';
import {validateCritique} from '../src/index.js';
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
// edge/source-commit.txt names the commit the module was compiled from. It must stay checkable from any full clone.
const root=fileURLToPath(new URL('../',import.meta.url));
const git=(args,encoding)=>spawnSync('git',['-C',root,...args],{encoding,maxBuffer:1<<26});
const checkout=git(['rev-parse','--show-toplevel','--is-shallow-repository'],'utf8');
const [top,shallow]=checkout.status===0?checkout.stdout.trim().split('\n'):[];
test('the recorded source commit is in the history and holds the manifest sources',
  {skip:!top||realpathSync(top)!==realpathSync(root)?'not a git checkout of this repository':shallow!=='false'&&'needs the full git history'},()=>{
  const commit=read('edge/source-commit.txt').toString('utf8').trim();
  assert.match(commit,/^[0-9a-f]{40}$/);
  assert.equal(git(['merge-base','--is-ancestor',commit,'HEAD']).status,0,`${commit} is not in the history of HEAD`);
  for(const [path,hash] of Object.entries(meta.sourceFiles)){
    const blob=git(['cat-file','blob',`${commit}:${path}`]);
    assert.equal(blob.status,0,`${path} is missing from ${commit}`);
    assert.equal(createHash('sha256').update(blob.stdout).digest('hex'),hash,path);
  }
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
test('JS critique validation and compiled compare accept the same evidence-backed readings',()=>{
  const {question,answer}=JSON.parse(read('examples/human-review.json'));
  const cite=(criterionId,quote)=>({criterionId,quote});
  for(const [even,odd,evidence] of [[2,0,[cite('even','n=2k')]],[2,0,[]],[2,2,[cite('even','n=2k')]],[0,0,[]],
    [1,2,[cite('even','n=2k'),cite('odd','a multiple of 2')]],[2,0,[cite('odd','n=2k')]],[0,0,[cite('even','not in the answer')]]]){
    const critique={criterionScores:{even,odd},rationale:'Checked against the rubric.',evidence,gaps:[]};
    let valid=true;try{validateCritique({question,answer,critique});}catch{valid=false;}
    const native=grader.compare(question,answer,[1,2].map(reviewer=>({reviewer,status:'proposal',...critique}))).reviews.map(r=>r.status==='proposal');
    assert.deepEqual(native,[valid,valid],JSON.stringify(critique));
  }
});
