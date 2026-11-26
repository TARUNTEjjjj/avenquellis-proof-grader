import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { certificateHelp, verifyCertificate } from '../src/certificate.js';
import { quadraticWeightedKappa, wilsonInterval } from '../benchmark/stratified.js';

const bases = JSON.parse(readFileSync(new URL('./fixtures/certificate-questions.json', import.meta.url), 'utf8'));
const instances = JSON.parse(readFileSync(new URL('./fixtures/certificate-instances.json', import.meta.url), 'utf8'));

test('exhaustive sound vs adversarial Bézout/residue mutations across all canonical instances', () => {
  for (const ref of instances) {
    const isGcd = ref.templateId === 'number-gcd';
    const base = structuredClone(bases[isGcd ? 1 : 0]);
    const k = ref.k;
    base.id = ref.id;
    base.parameters.k = k;
    base.generator.seed = ref.seed;
    base.exam = ref.exam;
    base.requestedDifficulty = ref.requestedDifficulty;
    base.statement = isGcd
      ? `Prove that gcd(n, n + ${k}) = gcd(n, ${k}) for every positive integer n.`
      : `Prove that (n + ${k})(n + ${k + 1})(n + ${k + 2}) is divisible by 6 for every integer n.`;

    const help = certificateHelp(base);
    assert.ok(help?.scaffold, `Missing scaffold for ${ref.id}`);
    const sc = help.scaffold;

    if (!isGcd) {
      const off = (m) => Array.from({ length: m }, (_, r) => [0, 1, 2].find((j) => (r + k + j) % m === 0)).join(' ');
      const sound = sc
        .replace('mod3: _ _ _', `mod3: ${off(3)}`)
        .replace('mod2: _ _', `mod2: ${off(2)}`)
        .replace('bezout: _ _', 'bezout: -1 1');
      const verified = verifyCertificate(base, sound);
      assert.equal(verified?.status, 'verified_certificate');
      assert.equal(verified?.score, base.maxMarks);

      for (const badBezout of ['0 0', '2 0', '0 2', '3 2', '-2 1']) {
        const broken = sound.replace('bezout: -1 1', `bezout: ${badBezout}`);
        const res = verifyCertificate(base, broken);
        assert.equal(res?.status, 'incomplete_certificate');
        assert.ok((res?.lowerBoundPoints ?? 99) < base.maxMarks);
      }
      for (const altBezout of ['2 -1', '5 -3', '-4 3']) {
        assert.equal(verifyCertificate(base, sound.replace('bezout: -1 1', `bezout: ${altBezout}`))?.score, base.maxMarks);
      }
    } else {
      const sound = sc
        .replace('forward: _ _', 'forward: -1 1')
        .replace('reverse: _ _', 'reverse: 1 1')
        .replace('conclusion: _', 'conclusion: same-positive-divisors -> equal-maxima');
      assert.equal(verifyCertificate(base, sound)?.score, base.maxMarks);
      const swapped = sound.replace('forward: -1 1', 'forward: 1 1');
      assert.equal(verifyCertificate(base, swapped)?.status, 'incomplete_certificate');
    }
  }
});

test('QWK symmetry, bounds [-1, 1], and Wilson interval monotonicity invariants', () => {
  for (let n = 1; n <= 40; n++) {
    for (const c of [0, Math.floor(n / 3), Math.floor((2 * n) / 3), n]) {
      const w = wilsonInterval(c, n);
      assert.ok(w.lower >= 0 && w.lower <= c / n + 1e-12);
      assert.ok(w.upper >= c / n - 1e-12 && w.upper <= 1 + 1e-12);
      assert.ok(w.lower <= w.upper);
    }
  }
  const perfect = [0, 3, 5, 10, 7].map((v) => ({ human: v, predicted: v, max: 10 }));
  assert.equal(quadraticWeightedKappa(perfect).value, 1);

  const mixed = [[1, 2], [4, 3], [8, 9], [10, 8], [2, 1], [6, 6]].map(([h, p]) => ({ human: h, predicted: p, max: 10 }));
  const flipped = mixed.map(({ human, predicted, max }) => ({ human: predicted, predicted: human, max }));
  const q1 = quadraticWeightedKappa(mixed).value;
  const q2 = quadraticWeightedKappa(flipped).value;
  assert.ok(q1 >= -1 && q1 <= 1);
  assert.ok(Math.abs(q1 - q2) < 1e-12, 'QWK must be symmetric between raters');
});
