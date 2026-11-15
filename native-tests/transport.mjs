import assert from 'node:assert/strict';
import {createServer as httpServer} from 'node:http';
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {once} from 'node:events';
import {createServer} from '../src/server.js';
const binary=process.argv[2];
const input=JSON.parse(readFileSync(new URL('../examples/human-review.json',import.meta.url),'utf8'));
const listen=async service=>{service.listen(0,'127.0.0.1');await once(service,'listening');return 'http://127.0.0.1:'+service.address().port;};
function invoke(action,request,environment={}) {
  const base={...process.env};delete base.AVENQUELLIS_GRADER_URL;delete base.AVENQUELLIS_GRADER_TOKEN;
  const proc=spawn(binary,[action],{env:{...base,NOETHER_GRADER_URL:'',NOETHER_GRADER_TOKEN:'',...environment}});
  let stdout='',stderr='';
  proc.stdout.on('data',b=>stdout+=b);proc.stderr.on('data',b=>stderr+=b);
  proc.stdin.end(JSON.stringify(request));
  return once(proc,'close').then(([code])=>({code,stderr,stdout,value:stdout?JSON.parse(stdout):null}));
}
let simulation='agreement';const modelCalls=[];
const model=httpServer(async(req,res)=>{
  assert.equal(req.url,'/v1/chat/completions');
  let body='';for await(const block of req)body+=block;
  const call=JSON.parse(body);modelCalls.push(call);
  const student=JSON.parse(call.messages[1].content);
  assert.equal(student.submission,input.answer);
  assert.equal(call.response_format.type,'json_schema');
  assert.equal(Object.hasOwn(student,'criterionScores'),false);
  const audit=/Review B:/.test(call.messages[0].content);
  const score=simulation==='disagreement'&&audit?1:2;
  const critique={criterionScores:{even:score,odd:0},rationale:'The even case follows by factoring out 2. The odd case is missing.',
    evidence:[{criterionId:'even',quote:simulation==='invented'&&audit?'absent phrase':input.answer}],gaps:['Odd n is not handled.']};
  res.writeHead(200,{'content-type':'application/json'});
  res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(critique)}}]}));
});
const url=await listen(model);
const token='synthetic-test-access-token-for-loopback';
const service=createServer({env:{EVALUATOR_BASE_URL:url+'/v1',EVALUATOR_MODEL:'scripted-transport-fixture',EVALUATOR_ACCESS_TOKEN:token}});
const endpoint=(await listen(service))+'/evaluate';
const env={NOETHER_GRADER_URL:endpoint,NOETHER_GRADER_TOKEN:token};
const services=[service,model];
try {
  let call=await invoke('review',input,env);
  assert.equal(call.code,0,call.stderr);assert.equal(call.value.score,null);assert.equal(call.value.suggestedScore,2);
  assert.equal(call.value.reviews[0].evidence[0].quote,input.answer);assert.equal(call.value.mode,'backend_review');
  assert.equal(modelCalls.length,2);assert.notEqual(modelCalls[0].messages[0].content,modelCalls[1].messages[0].content);
  assert.equal(modelCalls[0].messages[1].content,modelCalls[1].messages[1].content);
  simulation='disagreement';call=await invoke('review',input,env);
  assert.equal(call.value.suggestedScore,null);assert.deepEqual(call.value.disagreements,['even']);assert.equal(modelCalls.length,4);
  simulation='invented';call=await invoke('review',input,env);
  assert.equal(call.value.suggestedScore,null);assert.deepEqual(call.value.reviews.map(r=>r.score),[2,null]);assert.equal(modelCalls.length,6);
  const unauthorized=await invoke('review',input,{...env,NOETHER_GRADER_TOKEN:'wrong'});
  assert.equal(unauthorized.code,2);assert.match(unauthorized.stderr,/401/);assert.equal(modelCalls.length,6);
  // A wrong token gets a plain 401, also when the same token is set under the other name.
  assert.doesNotMatch(unauthorized.stderr,/takes only/);
  call=await invoke('review',input,{...env,NOETHER_GRADER_TOKEN:'wrong',AVENQUELLIS_GRADER_TOKEN:'wrong'});
  assert.equal(call.code,2);assert.match(call.stderr,/401/);assert.doesNotMatch(call.stderr,/takes only/);assert.equal(modelCalls.length,6);
  // The URL and its token are read as one pair of names. A stale legacy token is never sent to AVENQUELLIS_GRADER_URL,
  // and the 401 names the pairing, since the only token set is under the other name.
  const stale={NOETHER_GRADER_URL:'https://old-service.invalid/evaluate',NOETHER_GRADER_TOKEN:token};
  call=await invoke('review',input,{...stale,AVENQUELLIS_GRADER_URL:endpoint});
  assert.equal(call.code,2);assert.equal(modelCalls.length,6);
  assert.match(call.stderr,/HTTP 401\. AVENQUELLIS_GRADER_URL takes only AVENQUELLIS_GRADER_TOKEN, not the legacy NOETHER_GRADER_TOKEN\./);
  call=await invoke('review',input,{...stale,AVENQUELLIS_GRADER_URL:'https://[::ffff:127.0.0.1]:9/evaluate'});
  assert.equal(call.code,2);assert.match(call.stderr,/require AVENQUELLIS_GRADER_TOKEN/);
  // and AVENQUELLIS_GRADER_TOKEN is never sent to a legacy NOETHER_GRADER_URL left in the environment. On loopback the
  // 401 names the pairing, or it would look like a wrong token although the documented token is set.
  const legacyPairing=/HTTP 401\. The legacy NOETHER_GRADER_URL takes only NOETHER_GRADER_TOKEN; set AVENQUELLIS_GRADER_URL to use AVENQUELLIS_GRADER_TOKEN\./;
  call=await invoke('review',input,{NOETHER_GRADER_URL:endpoint,AVENQUELLIS_GRADER_TOKEN:token});
  assert.equal(call.code,2);assert.match(call.stderr,legacyPairing);assert.equal(modelCalls.length,6);
  call=await invoke('review',input,{NOETHER_GRADER_URL:endpoint,NOETHER_GRADER_TOKEN:'wrong',AVENQUELLIS_GRADER_TOKEN:token});
  assert.equal(call.code,2);assert.match(call.stderr,legacyPairing);assert.equal(modelCalls.length,6);
  // Only a 401 names the pairing; other refusals are not about the token.
  const busy=httpServer((_req,res)=>{res.writeHead(503);res.end('{}');});services.push(busy);
  call=await invoke('review',input,{NOETHER_GRADER_URL:(await listen(busy))+'/evaluate',AVENQUELLIS_GRADER_TOKEN:token});
  assert.equal(call.code,2);assert.match(call.stderr,/HTTP 503/);assert.doesNotMatch(call.stderr,/takes only/);
  call=await invoke('review',input,{NOETHER_GRADER_URL:'https://[::ffff:127.0.0.1]:9/evaluate',AVENQUELLIS_GRADER_TOKEN:token});
  assert.equal(call.code,2);assert.match(call.stderr,/NOETHER_GRADER_URL takes only NOETHER_GRADER_TOKEN/);
  // The new pair works on its own names, whatever the legacy pair still holds.
  call=await invoke('review',input,{...stale,NOETHER_GRADER_TOKEN:'wrong',AVENQUELLIS_GRADER_URL:endpoint,AVENQUELLIS_GRADER_TOKEN:token});
  assert.equal(call.code,0,call.stderr);assert.equal(modelCalls.length,8);
  const remote=await invoke('review',input,{NOETHER_GRADER_URL:'http://example.com/evaluate'});
  assert.equal(remote.code,2);assert.match(remote.stderr,/HTTPS/);
  const human=await invoke('finalize',input);assert.equal(human.value.status,'human_reviewed');assert.equal(human.value.score,2);
  const certificate=JSON.parse(readFileSync(new URL('../examples/checked-gcd.json',import.meta.url)));
  const verified=await invoke('review',certificate);assert.equal(verified.value.status,'verified_certificate');assert.equal(verified.value.score,10);
  // Even an endpoint claiming a final score cannot bypass the native evidence recheck.
  const dishonest=httpServer((_req,res)=>{const row=i=>({reviewer:i,status:'proposal',criterionScores:{even:2,odd:2},rationale:'A claim.',evidence:[{criterionId:'even',quote:input.answer},{criterionId:'odd',quote:'invented'}]});res.end(JSON.stringify({answer:input.answer,questionId:input.question.id,score:4,suggestedScore:4,reviews:[row(1),row(2)]}));});
  services.push(dishonest);const falseUrl=(await listen(dishonest))+'/evaluate';
  call=await invoke('review',input,{NOETHER_GRADER_URL:falseUrl});assert.equal(call.value.suggestedScore,null);assert.equal(call.value.score,null);
  const privateText='SYNTHETIC_PRIVATE_SERVICE_REPLY_SENTINEL';
  const truncated=httpServer((_req,res)=>res.end('{"answer":"'+privateText));services.push(truncated);
  call=await invoke('review',input,{NOETHER_GRADER_URL:(await listen(truncated))+'/evaluate'});
  assert.equal(call.code,2);assert.match(call.stderr,/Invalid JSON at byte/);assert.ok(!call.stderr.includes(privateText));
  console.log('Native CLI → authenticated Avenquellis service → two independent HTTP fixture readings → native evidence/consensus checks passed.');
} finally {
  for(const server of services) {server.closeAllConnections();server.close();}
}
