import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {computeMetrics} from '../benchmark/metrics.js';
import {computeStratifiedReport,quadraticWeightedKappa,wilsonInterval,BOOTSTRAP} from '../benchmark/stratified.js';

const synthetic=JSON.parse(readFileSync(new URL('./fixtures/stratified-metrics-synthetic.json',import.meta.url),'utf8'));
const fixtures=synthetic.cases.map(c=>({id:c.id,category:'synthetic',question:synthetic.question,answer:'Synthetic answer.'}));
const labels=synthetic.cases.map(c=>({id:c.id,source:'human',reviewer:'Synthetic reviewer',adjudicated:true,...c.label}));
const predictions=synthetic.cases.map(c=>({id:c.id,...c.prediction}));
const report=computeStratifiedReport({fixtures,predictions,labels});
const close=(actual,expected,message)=>assert.ok(Math.abs(actual-expected)<5e-7,`${message}: ${actual} != ${expected}`);
const wilson=(estimate,count,n,lower,upper)=>{
  assert.equal(estimate.count,count);assert.equal(estimate.n,n);close(estimate.rate,count/n,'rate');
  close(estimate.ci95.lower,lower,'Wilson lower');close(estimate.ci95.upper,upper,'Wilson upper');
};

test('stratified report reproduces the hand-checked overall total-score values',()=>{
  const {overall}=report;
  assert.deepEqual(overall.counts,{labelled:6,proposed:5,abstained:1,missingPrediction:0});
  wilson(overall.coverage,5,6,0.436497,0.969947);
  assert.equal(overall.total.compared,5);
  close(overall.total.meanAbsoluteError.value,0.4,'MAE');
  close(overall.total.rootMeanSquareError.value,Math.sqrt(0.4),'RMSE');
  close(overall.total.meanSignedError.value,0,'signed');
  wilson(overall.total.exactAgreement,3,5,0.230724,0.882379);
  wilson(overall.total.withinOneMark,5,5,0.565518,1);
  wilson(overall.total.overgradingRate,1,5,0.036224,0.624465);
  close(overall.total.weightedKappa.value,46/51,'kappa');
  assert.equal(overall.total.weightedKappa.reason,null);
});

test('stratified report agrees with the existing total-score metrics',()=>{
  const legacy=computeMetrics({fixtures,predictions,labels}).metrics,total=report.overall.total;
  assert.equal(total.compared,legacy.comparedCount);
  assert.equal(total.meanAbsoluteError.value,legacy.meanAbsoluteError);
  assert.equal(total.rootMeanSquareError.value,legacy.rootMeanSquareError);
  assert.equal(total.exactAgreement.rate,legacy.exactAgreement);
  assert.equal(total.withinOneMark.rate,legacy.withinOneMark);
  assert.equal(total.overgradingRate.rate,legacy.overgradingRate);
});

test('criterion-level agreement and kappa match the hand-checked values',()=>{
  const {pooled,byCriterion}=report.overall.criteria;
  assert.deepEqual(Object.keys(byCriterion),['qa/c1','qa/c2']);
  const c1=byCriterion['qa/c1'],c2=byCriterion['qa/c2'];
  assert.equal(c1.maxPoints,2);assert.equal(c1.labelled,6);assert.equal(c1.compared,6);
  assert.equal(c1.meanAbsoluteError.value,0);assert.deepEqual([c1.meanAbsoluteError.ci95.lower,c1.meanAbsoluteError.ci95.upper],[0,0]);
  assert.equal(c1.weightedKappa.value,1);
  assert.equal(c2.labelled,6);assert.equal(c2.compared,5);
  close(c2.meanAbsoluteError.value,0.4,'c2 MAE');close(c2.weightedKappa.value,2/3,'c2 kappa');
  wilson(c2.exactAgreement,3,5,0.230724,0.882379);
  assert.equal(pooled.compared,11);close(pooled.meanAbsoluteError.value,2/11,'pooled MAE');
  wilson(pooled.exactAgreement,9,11,0.523019,0.948632);
  assert.equal(pooled.weightedKappa,undefined,'kappa is not pooled across criteria with different scales');
});

test('substantial-flaw recall counts only flawed labels with an explicit detection signal',()=>{
  const flaw=report.overall.substantialFlaw;
  assert.equal(flaw.annotated,6);assert.equal(flaw.flawed,4);assert.equal(flaw.withoutDetectionSignal,1);
  wilson(flaw.recall,2,3,0.20766,0.938508);
  wilson(flaw.overgradedWhenProposed,1,3,0.061492,0.79234);
});

test('strata partition labels and define null outcomes for empty or degenerate populations',()=>{
  const {subject,proofType,language,scoreBand}=report.strata;
  assert.deepEqual(Object.keys(subject),['algebra','geometry']);
  close(subject.algebra.total.weightedKappa.value,0.8,'algebra kappa');
  close(subject.geometry.total.weightedKappa.value,12/13,'geometry kappa');
  wilson(subject.geometry.coverage,2,3,0.20766,0.938508);
  assert.deepEqual(Object.keys(language),['en','fr']);
  assert.deepEqual(Object.keys(proofType),['direct','induction','unspecified']);
  const unspecified=proofType.unspecified;
  assert.deepEqual(unspecified.counts,{labelled:1,proposed:0,abstained:1,missingPrediction:0});
  assert.equal(unspecified.total.meanAbsoluteError.value,null);assert.equal(unspecified.total.meanAbsoluteError.ci95,null);
  assert.equal(unspecified.total.exactAgreement.rate,null);assert.equal(unspecified.total.exactAgreement.ci95,null);
  assert.equal(unspecified.total.weightedKappa.reason,'no_compared_pairs');
  assert.deepEqual(Object.keys(scoreBand),['zero','partial','full']);
  assert.equal(scoreBand.zero.total.compared,1);
  assert.deepEqual([scoreBand.zero.total.weightedKappa.value,scoreBand.zero.total.weightedKappa.reason],[null,'degenerate_denominator']);
  assert.equal(scoreBand.full.total.weightedKappa.value,0);
  // An empty score band is still reported, with zero counts and null estimates.
  const allFull=computeStratifiedReport({fixtures:fixtures.slice(0,1),predictions:predictions.slice(0,1),labels:labels.slice(0,1)});
  const empty=allFull.strata.scoreBand.zero;
  assert.deepEqual(empty.counts,{labelled:0,proposed:0,abstained:0,missingPrediction:0});
  assert.equal(empty.coverage.rate,null);assert.equal(empty.coverage.ci95,null);
  assert.equal(empty.substantialFlaw.recall.rate,null);
  assert.deepEqual(empty.criteria,{pooled:empty.criteria.pooled,byCriterion:{}});
});

test('absent labels and absent predictions have defined outcomes',()=>{
  assert.equal(computeStratifiedReport({fixtures,predictions,labels:[]}),null);
  const noPredictions=computeStratifiedReport({fixtures,predictions:[],labels});
  assert.deepEqual(noPredictions.overall.counts,{labelled:6,proposed:0,abstained:0,missingPrediction:6});
  assert.equal(noPredictions.overall.coverage.rate,0);
  assert.equal(noPredictions.overall.substantialFlaw.withoutDetectionSignal,4);
  assert.equal(noPredictions.overall.substantialFlaw.recall.rate,null);
  // Labels without criterion scores, flaw annotations or strata still produce a total-score report.
  const bare=computeStratifiedReport({fixtures,predictions,labels:labels.map(({id,score,source,reviewer,adjudicated})=>({id,score,source,reviewer,adjudicated}))});
  assert.deepEqual(bare.overall.criteria.byCriterion,{});
  assert.equal(bare.overall.substantialFlaw.annotated,0);
  assert.deepEqual(Object.keys(bare.strata.subject),['unspecified']);
});

test('weighted kappa reports mixed scales and degenerate denominators as null',()=>{
  assert.deepEqual(quadraticWeightedKappa([]),{value:null,reason:'no_compared_pairs'});
  assert.deepEqual(quadraticWeightedKappa([{human:1,predicted:1,max:2},{human:1,predicted:1,max:3}]),{value:null,reason:'mixed_scales'});
  assert.deepEqual(quadraticWeightedKappa([{human:2,predicted:2,max:2},{human:2,predicted:2,max:2}]),{value:null,reason:'degenerate_denominator'});
  assert.deepEqual(quadraticWeightedKappa([{human:0,predicted:0,max:0}]),{value:null,reason:'degenerate_denominator'});
  // Perfect disagreement on opposite extremes: observed 1, expected 1/2 (weights scaled by K^2), kappa -1.
  assert.equal(quadraticWeightedKappa([{human:0,predicted:2,max:2},{human:2,predicted:0,max:2}]).value,-1);
  assert.equal(wilsonInterval(0,0),null);
});

test('bootstrap intervals are deterministic and bracket the point estimate on synthetic data',()=>{
  const again=computeStratifiedReport({fixtures:[...fixtures].reverse(),predictions:[...predictions].reverse(),labels:[...labels].reverse()});
  assert.deepEqual(again,report,'input order and repeated runs do not change the report');
  for (const metric of ['meanAbsoluteError','rootMeanSquareError','meanSignedError','weightedKappa']) {
    const estimate=report.overall.total[metric];
    assert.equal(estimate.ci95.method,'bootstrap_percentile');
    assert.ok(estimate.ci95.validReplicates<=BOOTSTRAP.replicates);
    assert.ok(estimate.ci95.lower<=estimate.value && estimate.value<=estimate.ci95.upper,`${metric} interval`);
  }
});

test('optional criterion, flaw and stratum fields are validated',()=>{
  const run=(p,l)=>()=>computeStratifiedReport({fixtures,predictions:p,labels:l});
  assert.throws(run([{...predictions[0],criterionScores:{c9:1}}],labels),/unknown criterion/);
  assert.throws(run([{...predictions[0],criterionScores:{c1:3}}],labels),/criterion score/);
  assert.throws(run(predictions,[{...labels[0],criterionScores:{c1:null}}]),/criterion score/);
  assert.throws(run([{...predictions[0],flawDetected:'yes'}],labels),/flawDetected/);
  assert.throws(run(predictions,[{...labels[0],substantialFlaw:1}]),/substantialFlaw/);
  assert.throws(run(predictions,[{...labels[0],strata:{country:'x'}}]),/Unknown label stratum/);
  assert.throws(run(predictions,[{...labels[0],strata:{subject:''}}]),/non-empty/);
  assert.throws(()=>computeMetrics({fixtures,predictions,labels:[{...labels[0],criterionScores:[]}]}),/criterionScores/);
});

test('benchmark CLI adds the stratified report only on request',()=>{
  const dir=mkdtempSync(join(tmpdir(),'avenquellis-stratified-'));
  try {
    const save=(name,rows)=>{const file=join(dir,name);writeFileSync(file,JSON.stringify(rows));return file;};
    const args=['--fixtures',save('fixtures.json',fixtures),'--predictions',save('predictions.json',predictions),'--labels',save('labels.json',labels)];
    const cli=(...extra)=>{const run=spawnSync(process.execPath,[fileURLToPath(new URL('../benchmark/run.js',import.meta.url)),...args,...extra],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);return JSON.parse(run.stdout);};
    const plain=cli(),stratified=cli('--stratified');
    assert.equal('stratified' in plain,false);
    const {generatedAt:_a,...plainRest}=plain,{generatedAt:_b,stratified:extra,...stratifiedRest}=stratified;
    assert.deepEqual(stratifiedRest,plainRest);
    assert.deepEqual(extra,JSON.parse(JSON.stringify(report)));
  } finally {rmSync(dir,{recursive:true,force:true});}
});
