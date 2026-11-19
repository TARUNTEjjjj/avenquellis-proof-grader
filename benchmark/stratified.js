import {LABEL_STRATA,isPerReviewerCriterionScores,validateBenchmarkInputs} from './metrics.js';

/**
 * Criterion-level and stratified benchmark report (docs/EVALUATION.md step 5).
 * Every estimate carries its sample size; see docs/EVALUATION.md "Stratified report" for the methods and null outcomes.
 */
export const STRATIFIED_REPORT_VERSION=1;
export const SCORE_BANDS=['zero','partial','full'];
export const UNSPECIFIED_STRATUM='unspecified';
export const BOOTSTRAP={replicates:2000,seed:20261119,minimumValidFraction:0.5};
const Z95=1.959963984540054;

export const METHODS={
  confidenceLevel:0.95,
  proportions:'Wilson score interval, z=1.959963984540054, no continuity correction.',
  meansAndKappa:`Percentile bootstrap over cases: ${BOOTSTRAP.replicates} resamples with replacement, mulberry32 PRNG restarted at seed ${BOOTSTRAP.seed} for every interval, cases ordered by id, quantiles by linear interpolation (Hyndman-Fan type 7). Kappa resamples with a zero expected-disagreement denominator are discarded; the interval is null when fewer than ${BOOTSTRAP.minimumValidFraction*100}% of resamples are valid.`,
  weightedKappa:'Cohen\'s kappa with quadratic weights w(i,j)=(i-j)^2/K^2 over integer categories 0..K, K the shared maximum mark. Null when no pairs, when pairs use different maxima, or when expected weighted disagreement is zero.',
  scoreBand:'Derived from the adjudicated human total: zero (0), partial (0 < score < maxMarks), full (score = maxMarks).',
  error:'Signed error = suggested - human. Agreement and error use only labelled cases with a non-null proposal (total) or non-null criterion scores on both sides (criterion).'
};

function mulberry32(seed) {
  let a=seed>>>0;
  return ()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};
}

function quantile(sorted,q) {
  const h=(sorted.length-1)*q,lo=Math.floor(h);
  return lo+1<sorted.length?sorted[lo]+(h-lo)*(sorted[lo+1]-sorted[lo]):sorted[lo];
}

export function wilsonInterval(successes,n,z=Z95) {
  if (!n) return null;
  const p=successes/n,z2=z*z,denominator=1+z2/n;
  const centre=(p+z2/(2*n))/denominator,half=z/denominator*Math.sqrt(p*(1-p)/n+z2/(4*n*n));
  return {lower:Math.max(0,centre-half),upper:Math.min(1,centre+half),method:'wilson'};
}

function proportion(count,n) {
  return {count,n,rate:n?count/n:null,ci95:wilsonInterval(count,n)};
}

/** Percentile bootstrap of statistic(rows); statistic may return null for a degenerate resample. */
export function bootstrapInterval(rows,statistic) {
  if (!rows.length) return null;
  const random=mulberry32(BOOTSTRAP.seed),values=[];
  for (let b=0;b<BOOTSTRAP.replicates;b++) {
    const sample=Array.from(rows,()=>rows[Math.floor(random()*rows.length)]);
    const value=statistic(sample);
    if (value!==null && Number.isFinite(value)) values.push(value);
  }
  if (values.length<BOOTSTRAP.replicates*BOOTSTRAP.minimumValidFraction) return {lower:null,upper:null,method:'bootstrap_percentile',validReplicates:values.length,reason:'degenerate_bootstrap'};
  values.sort((x,y)=>x-y);
  return {lower:quantile(values,0.025),upper:quantile(values,0.975),method:'bootstrap_percentile',validReplicates:values.length};
}

function estimate(rows,statistic) {
  return {n:rows.length,value:rows.length?statistic(rows):null,ci95:bootstrapInterval(rows,statistic)};
}
const meanEstimate=(rows,value)=>estimate(rows,sample=>sample.reduce((s,r)=>s+value(r),0)/sample.length);

/** Returns {value, reason}; value is null when the kappa is undefined. Pairs are {human, predicted, max}. */
export function quadraticWeightedKappa(pairs) {
  if (!pairs.length) return {value:null,reason:'no_compared_pairs'};
  const K=pairs[0].max;
  if (pairs.some(p=>p.max!==K)) return {value:null,reason:'mixed_scales'};
  if (K<1) return {value:null,reason:'degenerate_denominator'};
  const n=pairs.length,human=new Array(K+1).fill(0),predicted=new Array(K+1).fill(0);
  let observed=0;
  for (const p of pairs) {human[p.human]++;predicted[p.predicted]++;observed+=(p.human-p.predicted)**2;}
  let expected=0;
  for (let i=0;i<=K;i++) for (let j=0;j<=K;j++) expected+=human[i]*predicted[j]*(i-j)**2;
  // Both sums share the factor 1/K^2; observed is averaged over n pairs, expected over n^2 marginal products.
  observed/=n;expected/=n*n;
  if (expected===0) return {value:null,reason:'degenerate_denominator'};
  return {value:1-observed/expected,reason:null};
}

function kappaEstimate(pairs) {
  const point=quadraticWeightedKappa(pairs);
  if (point.reason==='mixed_scales' || point.reason==='no_compared_pairs') return {n:pairs.length,...point,ci95:null};
  return {n:pairs.length,...point,ci95:bootstrapInterval(pairs,sample=>quadraticWeightedKappa(sample).value)};
}

function agreement(pairs,{includeKappa}) {
  const errors=pairs.map(p=>p.predicted-p.human);
  const summary={
    compared:pairs.length,
    meanAbsoluteError:meanEstimate(pairs,p=>Math.abs(p.predicted-p.human)),
    rootMeanSquareError:estimate(pairs,sample=>Math.sqrt(sample.reduce((s,p)=>s+(p.predicted-p.human)**2,0)/sample.length)),
    meanSignedError:meanEstimate(pairs,p=>p.predicted-p.human),
    exactAgreement:proportion(errors.filter(e=>e===0).length,pairs.length),
    withinOneMark:proportion(errors.filter(e=>Math.abs(e)<=1).length,pairs.length),
    overgradingRate:proportion(errors.filter(e=>e>0).length,pairs.length)
  };
  if (includeKappa) summary.weightedKappa=kappaEstimate(pairs);
  return summary;
}

function scoreBand(score,max) {return score===0?'zero':score===max?'full':'partial';}

function population(cases) {
  const proposed=cases.filter(c=>c.prediction && c.prediction.suggestedScore!==null);
  const abstained=cases.filter(c=>c.prediction && c.prediction.suggestedScore===null).length;
  const totalPairs=proposed.map(c=>({id:c.id,human:c.label.score,predicted:c.prediction.suggestedScore,max:c.max}));
  const byCriterion=new Map();
  for (const c of cases) for (const [criterionId,human] of Object.entries(c.label.criterionScores ?? {})) {
    const key=`${c.questionId}/${criterionId}`;
    if (!byCriterion.has(key)) byCriterion.set(key,{labelled:0,pairs:[],maxima:new Set()});
    const scores=c.prediction?.criterionScores,entry=byCriterion.get(key);
    const predicted=isPerReviewerCriterionScores(scores)?undefined:scores?.[criterionId];
    entry.labelled++;entry.maxima.add(c.criterionMax.get(criterionId));
    if (Number.isInteger(predicted)) entry.pairs.push({id:c.id,human,predicted,max:c.criterionMax.get(criterionId)});
  }
  const criteria={},pooled=[];
  for (const key of [...byCriterion.keys()].sort()) {
    const entry=byCriterion.get(key);pooled.push(...entry.pairs);
    criteria[key]={maxPoints:entry.maxima.size===1?[...entry.maxima][0]:null,labelled:entry.labelled,coverage:proportion(entry.pairs.length,entry.labelled),...agreement(entry.pairs,{includeKappa:true})};
  }
  const flawed=cases.filter(c=>c.label.substantialFlaw===true);
  const signalled=flawed.filter(c=>typeof c.prediction?.flawDetected==='boolean');
  const flawedProposed=flawed.filter(c=>c.prediction && c.prediction.suggestedScore!==null);
  return {
    counts:{labelled:cases.length,proposed:proposed.length,abstained,missingPrediction:cases.length-proposed.length-abstained},
    coverage:proportion(proposed.length,cases.length),
    total:agreement(totalPairs,{includeKappa:true}),
    criteria:{pooled:agreement(pooled,{includeKappa:false}),byCriterion:criteria},
    substantialFlaw:{
      annotated:cases.filter(c=>typeof c.label.substantialFlaw==='boolean').length,
      flawed:flawed.length,
      withoutDetectionSignal:flawed.length-signalled.length,
      recall:proportion(signalled.filter(c=>c.prediction.flawDetected).length,signalled.length),
      overgradedWhenProposed:proportion(flawedProposed.filter(c=>c.prediction.suggestedScore>c.label.score).length,flawedProposed.length)
    }
  };
}

/** Builds the stratified report, or returns null when no human labels were supplied. */
export function computeStratifiedReport({fixtures,predictions,labels=[]}) {
  const {byId,predicted}=validateBenchmarkInputs({fixtures,predictions,labels});
  if (!labels.length) return null;
  const cases=labels.map(label=>{
    const fixture=byId.get(label.id),max=fixture.question.maxMarks;
    return {id:label.id,label,prediction:predicted.get(label.id),max,questionId:fixture.question.id ?? fixture.id,
      criterionMax:new Map((fixture.question.rubric ?? []).map(c=>[c.id,c.points])),
      strata:{...Object.fromEntries(LABEL_STRATA.map(k=>[k,label.strata?.[k] ?? UNSPECIFIED_STRATUM])),scoreBand:scoreBand(label.score,max)}};
  }).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  const strata={};
  for (const dimension of [...LABEL_STRATA,'scoreBand']) {
    const levels=dimension==='scoreBand'?SCORE_BANDS:[...new Set(cases.map(c=>c.strata[dimension]))].sort();
    strata[dimension]=Object.fromEntries(levels.map(level=>[level,population(cases.filter(c=>c.strata[dimension]===level))]));
  }
  return {version:STRATIFIED_REPORT_VERSION,methods:METHODS,overall:population(cases),strata};
}
