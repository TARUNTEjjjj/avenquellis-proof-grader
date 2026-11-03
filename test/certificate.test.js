import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {certificateHelp, verifyCertificate} from '../src/certificate.js';

const [consecutive, gcd] = JSON.parse(await readFile(new URL('./fixtures/certificate-questions.json', import.meta.url), 'utf8'));
const certificate = (question, lines) => ['NOETHER-PROOF/1', `family: ${question.templateId}`, `k: ${question.parameters.k}`, ...lines].join('\n');
const consecutiveAnswer = certificate(consecutive, ['mod3: 0 2 1', 'mod2: 1 2', 'bezout: 5 -3']);
const gcdAnswer = certificate(gcd, ['forward: -1 1', 'reverse: 1 1', 'conclusion: same-positive-divisors -> equal-maxima']);

function checkResult(result, verified, complete = false) {
  assert.deepEqual(result.criteria.map(c => c.verified), verified);
  assert.equal(result.complete, complete);
  const earned = verified.reduce((sum, valid, i) => sum + (valid ? [4, 4, 2][i] : 0), 0);
  assert.equal(result.lowerBoundPoints, earned);
  assert.equal(result.score, complete ? earned : null);
  assert.equal(result.status, complete ? 'verified_certificate' : 'incomplete_certificate');
}

test('complete residue witnesses and noncanonical Bézout pair prove all three criteria', () => {
  checkResult(verifyCertificate(consecutive, consecutiveAnswer), [true, true, true], true);
  checkResult(verifyCertificate(consecutive, consecutiveAnswer.replace('mod2: 1 2', 'mod2: 1 0')), [true, true, true], true);
});

test('a correct Bézout pair cannot compensate for a missing or impossible residue witness', () => {
  for (const row of ['mod3: 0 2', 'mod3: 0 5 1', 'mod3: 0 0 1', 'mod3: 0 -1 1', 'mod3: _ _ _']) {
    checkResult(verifyCertificate(consecutive, consecutiveAnswer.replace('mod3: 0 2 1', row)), [false, true, false]);
  }
  checkResult(verifyCertificate(consecutive, consecutiveAnswer.replace('bezout: 5 -3', 'bezout: 3 2')), [true, true, false]);
});

test('the two gcd identities and explicit final inference yield a complete proof', () => {
  checkResult(verifyCertificate(gcd, gcdAnswer), [true, true, true], true);
  checkResult(verifyCertificate(gcd, gcdAnswer.replace(/\n/g, '\r\n')), [true, true, true], true);
  checkResult(verifyCertificate(gcd, gcdAnswer.replace('same-positive-divisors -> equal-maxima', 'equal maxima')), [true, true, false]);
});

test('an identity that happens to hold at one n cannot prove a universal gcd inclusion', () => {
  // At n=5,k=10, 2n=k is true, but it is not an affine identity for all n.
  checkResult(verifyCertificate(gcd, gcdAnswer.replace('forward: -1 1', 'forward: 2 0')), [false, true, false]);
  // At n=10,k=10, 2n=n+k is also accidentally true.
  checkResult(verifyCertificate(gcd, gcdAnswer.replace('reverse: 1 1', 'reverse: 2 0')), [true, false, false]);
});

test('alternative proofs and unsupported theorem versions stay with prose review', () => {
  assert.equal(verifyCertificate(gcd, gcd.solution), null);
  assert.equal(verifyCertificate(gcd, 'Therefore NOETHER-PROOF/1 is written below.'), null);
  for (const mutate of [
    q => {q.templateId = 'number-descent';}, q => {q.type = 'numeric';}, q => {q.source.kind = 'official-paper';},
    q => {q.statement = q.statement.replace('positive integer n', 'even integer n');}, q => {q.maxMarks = 11;},
    q => {q.rubric[0].points = 3;}, q => {q.rubric[2].description += ' and prove another identity';},
    q => {q.rubric[1].extraRequirement = 'disprove another claim';}, q => {q.id = 'different-template-id';},
    q => {q.generator.version = '0.2.0';}, q => {q.parameters.k = '10';}, q => {q.parameters.extra = 1;}
  ]) {
    const changed = structuredClone(gcd); mutate(changed);
    assert.equal(certificateHelp(changed), null); assert.equal(verifyCertificate(changed, gcdAnswer), null);
  }
});

test('missing fields yield a lower bound while duplicate, mismatched or free-form data receives no certificate score', () => {
  checkResult(verifyCertificate(gcd, certificate(gcd, ['forward: -1 1'])), [true, false, false]);
  for (const text of [gcdAnswer+'\nforward: -1 1', gcdAnswer+'\nI additionally claim that 1=2.', gcdAnswer+'\n__proto__: 7',
    gcdAnswer.replace('family: number-gcd', 'family: number-consecutive'), gcdAnswer.replace('k: 10', 'k: 11'), gcdAnswer+' '.repeat(2050)]) {
    checkResult(verifyCertificate(gcd, text), [false, false, false]);
  }
  for (const pair of ['1.0 1', '1e0 1', 'Infinity 0', '1000001 0']) {
    checkResult(verifyCertificate(gcd, gcdAnswer.replace('reverse: 1 1', `reverse: ${pair}`)), [true, false, false]);
  }
});

test('blank scaffolds expose field names without autofilling proof witnesses', () => {
  for (const question of [consecutive, gcd]) {
    const help = certificateHelp(question);
    assert.equal(help.fields.length, 3);
    checkResult(verifyCertificate(question, help.scaffold), [false, false, false]);
    for (const field of help.fields) assert.match(help.scaffold, new RegExp(`^${field}: _`, 'm'));
  }
});

test('certificate obligations cover the parameter endpoints of both families', () => {
  for (const k of [1, 12]) {
    const q = structuredClone(consecutive); q.parameters.k = k;
    q.statement = `Prove that (n + ${k})(n + ${k+1})(n + ${k+2}) is divisible by 6 for every integer n.`;
    // Use negative representatives, yielding the same congruence classes as nonnegative n.
    const offsets = m => Array.from({length:m}, (_, r) => [0,1,2].find(j => (r-30+k+j)%m === 0)).join(' ');
    const proof = certificate(q, [`mod3: ${offsets(3)}`, `mod2: ${offsets(2)}`, 'bezout: -1 1']);
    checkResult(verifyCertificate(q, proof), [true, true, true], true);
  }
  for (const k of [7, 30]) {
    const q = structuredClone(gcd); q.parameters.k = k;
    q.statement = `Prove that gcd(n, n + ${k}) = gcd(n, ${k}) for every positive integer n.`;
    checkResult(verifyCertificate(q, gcdAnswer.replace('k: 10', `k: ${k}`)), [true, true, true], true);
  }
});
