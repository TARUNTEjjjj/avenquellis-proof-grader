import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_WORKERS_AI_MODEL, evaluateProof, readEvaluatorConfig} from '../src/provider.js';
import {createPagesReviewHandler} from '../src/pages.js';
import {createRequestHandler} from '../src/service.js';

const question = {
  id: 'parity-demo', type: 'proof', statement: 'Prove n(n+1) is even for every integer n.', maxMarks: 7,
  rubric: [{id: 'factor', description: 'Identify an even factor.', points: 3}, {id: 'product', description: 'Deduce evenness of the product.', points: 4}]
};
const answer = 'One of two consecutive integers is even, so the product is twice an integer.';
const full = {
  criterionScores: {factor: 3, product: 4}, rationale: 'The factor gives divisibility by two.',
  evidence: [{criterionId: 'factor', quote: 'One of two consecutive integers is even'}, {criterionId: 'product', quote: 'the product is twice an integer'}], gaps: []
};
const makeEnv = run => ({EVALUATOR_PROVIDER: 'workers-ai', AI: {run}});
const request = (body, extra = {}) => new Request('https://example.test/api/proof-review', {
  method: 'POST', headers: {'Content-Type': 'application/json', Origin: 'https://example.test', ...extra}, body: JSON.stringify(body)
});

test('native binding uses raw JSON schema, blind prompts and local evidence checks', async () => {
  const requests = [];
  const env = makeEnv(async (model, input) => {
    requests.push({model, input});
    return {response: requests.length === 1 ? full : JSON.stringify(full)};
  });
  const result = await evaluateProof({question, answer, EVALUATOR_MODEL: 'client-controlled'}, {env, fetchImpl: () => assert.fail('HTTP fallback is forbidden')});
  assert.equal(requests.length, 2);
  assert.equal(requests[0].model, DEFAULT_WORKERS_AI_MODEL);
  assert.equal(requests[0].input.response_format.json_schema.type, 'object');
  assert.equal(requests[0].input.response_format.json_schema.schema, undefined);
  assert.equal(requests[0].input.stream, false);
  assert.notEqual(requests[0].input.messages[0].content, requests[1].input.messages[0].content);
  assert.equal(requests[0].input.messages[1].content, requests[1].input.messages[1].content);
  assert.equal(result.suggestedScore, 7);
  assert.equal(result.score, null);
  assert.equal(result.provenance.provider, 'workers-ai');
  assert.equal(result.uncertainty.calibrated, false);
  assert.deepEqual(result.reviewerScoreRange, {min: 7, max: 7});
  assert.deepEqual(result.criterionProposals[0].reviewers[0].quotes, ['One of two consecutive integers is even']);
});

test('a disputed mark remains unresolved while other matching criterion proposals are visible', async () => {
  let calls = 0;
  const env = makeEnv(async () => ({response: calls++ === 0 ? full : {...full, criterionScores: {factor: 2, product: 4}}}));
  const result = await evaluateProof({question, answer}, {env});
  assert.equal(result.suggestedScore, null);
  assert.equal(result.score, null);
  assert.deepEqual(result.reviewerScoreRange, {min: 6, max: 7});
  assert.deepEqual(result.criterionProposals.map(c => c.agreedPoints), [null, 4]);
  assert.deepEqual(result.criterionProposals[0].reviewers.map(r => r.points), [3, 2]);
  assert.equal(result.uncertainty.kind, 'disagreement');
});

test('binding quota and capacity errors are recognized without exposing raw error text or retrying', async () => {
  for (const [code, expected] of [[3036, 'daily_quota'], [3040, 'provider_busy'], [3007, 'timeout']]) {
    let calls = 0;
    const env = makeEnv(async () => {calls++; throw new Error(`${code} sensitive provider diagnostic`);});
    const result = await evaluateProof({question, answer}, {env});
    assert.equal(calls, 2);
    assert.equal(result.uncertainty.kind, 'insufficient_reviews');
    assert.equal(result.suggestedScore, null);
    assert.equal(result.criterionProposals[0].agreedPoints, null);
    assert.ok(result.reviews.every(r => r.failure.code === expected));
    assert.ok(!JSON.stringify(result).includes('sensitive provider diagnostic'));
  }
});

test('Workers AI malformed output, excess fields and fabricated evidence yield no score', async () => {
  for (const output of [{response: 'plain text'}, {}, {response: {...full, certified: true}},
    {response: {...full, evidence: [{criterionId: 'factor', quote: 'fabricated'}]}}, {response: 'x'.repeat(70000)}]) {
    const env = makeEnv(async () => output);
    const result = await evaluateProof({question, answer}, {env});
    assert.equal(result.suggestedScore, null);
    assert.equal(result.score, null);
    assert.equal(result.reviewerScoreRange, null);
  }
});

test('binding timeout releases caller but counts still-running upstream requests against concurrency', async () => {
  const releases = [];
  const env = {...makeEnv(() => new Promise(resolve => releases.push(() => resolve({response: full})))), EVALUATOR_TIMEOUT_MS: '50'};
  const [a, b] = await Promise.all([evaluateProof({question, answer}, {env}), evaluateProof({question, answer}, {env})]);
  assert.equal(a.reviews[0].failure.code, 'timeout');
  assert.equal(b.reviews[0].failure.code, 'timeout');
  assert.equal(releases.length, 4);
  const overflow = await evaluateProof({question, answer}, {env});
  assert.ok(overflow.reviews.every(r => r.failure.code === 'provider_busy'));
  releases.forEach(finish => finish());
});

test('enabled binding requires a documented allowlisted model and never reads an HTTP key', () => {
  assert.throws(() => readEvaluatorConfig({EVALUATOR_PROVIDER: 'workers-ai'}), /binding/);
  assert.throws(() => readEvaluatorConfig({...makeEnv(() => {}), EVALUATOR_MODEL: '@cf/not-supported'}), /supported/);
  assert.equal(readEvaluatorConfig({...makeEnv(() => {}), EVALUATOR_MODEL: '@cf/meta/llama-3.1-8b-instruct'}).model, '@cf/meta/llama-3.1-8b-instruct');
  assert.equal(readEvaluatorConfig(makeEnv(() => {})).apiKey, undefined);
});

test('Pages route resolves server-owned theorem and reserves quota before both calls', async () => {
  const operations = [];
  const env = makeEnv(async (_model, input) => {
    operations.push('infer');
    assert.equal(JSON.parse(input.messages[1].content).question.statement, question.statement);
    return {response: full};
  });
  const onRequest = createPagesReviewHandler({
    resolveQuestion: async ({questionId, reference}) => {operations.push('resolve'); assert.equal(reference.seed, 'demo'); return questionId === question.id ? question : null;},
    admit: async ({question: canonical}) => {operations.push('admit'); assert.equal(canonical.id, question.id);return true;}
  });
  const response = await onRequest({request: request({questionId: question.id, answer, reference: {seed: 'demo'}}), env});
  assert.deepEqual(operations, ['resolve', 'admit', 'infer', 'infer']);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal((await response.json()).suggestedScore, 7);
});

test('browser cannot inject a rubric, bypass a quota decision, or use an unresolved question', async () => {
  const env = makeEnv(() => assert.fail('No inference expected'));
  const body = {questionId: question.id, answer};
  const blocked = createPagesReviewHandler({resolveQuestion: () => question, admit: () => Response.json({error: 'Daily limit reached.'}, {status: 429})});
  assert.equal((await blocked({request: request({...body, question}), env})).status, 400);
  assert.equal((await blocked({request: request(body, {Origin: 'https://other.example'}), env})).status, 403);
  assert.equal((await blocked({request: request(body), env})).status, 429);
  assert.equal((await blocked({request: request(body), env: {}})).status, 503);
  const missing = createPagesReviewHandler({resolveQuestion: () => null, admit: () => assert.fail('No quota reservation expected')});
  assert.equal((await missing({request: request(body), env})).status, 404);
});

test('protected Worker health and evaluate routes also recognize a native binding', async () => {
  const token = 'worker-service-token-at-least-32-characters';
  const env = {...makeEnv(async () => ({response: full})), EVALUATOR_ACCESS_TOKEN: token};
  const handle = createRequestHandler({env, publicDeployment: true});
  const health = await handle(new Request('https://example.test/health'));
  assert.equal((await health.json()).evaluatorConfigured, true);
  const response = await handle(new Request('https://example.test/evaluate', {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`}, body: JSON.stringify({question, answer})}));
  assert.equal((await response.json()).suggestedScore, 7);
});
