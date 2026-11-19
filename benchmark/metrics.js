/** Stratum dimensions a human label may annotate. `scoreBand` is derived from the adjudicated total, never supplied. */
export const LABEL_STRATA=['subject','proofType','language'];

const isPlainObject=value=>Boolean(value) && typeof value==='object' && !Array.isArray(value);

function rubricPoints(fixture) {
  const rubric=fixture.question?.rubric;
  return new Map(Array.isArray(rubric)?rubric.filter(c=>c && typeof c.id==='string').map(c=>[c.id,c.points]):[]);
}

// Optional criterion scores are keyed by the fixture's rubric criterion id; each value is an integer in 0..points.
// Predictions may leave a criterion unresolved with null; human labels may omit a criterion but not null it.
function validateCriterionScores(scores,fixture,{allowNull,owner}) {
  if (scores===undefined) return;
  if (!isPlainObject(scores)) throw new TypeError(`${owner} criterionScores must be an object keyed by rubric criterion id.`);
  const points=rubricPoints(fixture);
  for (const [id,value] of Object.entries(scores)) {
    if (!points.has(id)) throw new TypeError(`${owner} criterionScores names unknown criterion ${JSON.stringify(id)}.`);
    if (value===null && allowNull) continue;
    if (!Number.isInteger(value) || value<0 || value>points.get(id)) throw new RangeError(`Invalid ${owner.toLowerCase()} criterion score.`);
  }
}

/** Validates fixtures, predictions and human labels; returns lookup maps. Optional fields are checked only when present. */
export function validateBenchmarkInputs({fixtures,predictions,labels=[]}) {
  const byId=new Map(fixtures.map(f=>[f.id,f]));
  const predicted=new Map();
  for (const p of predictions) {
    if (!p || !byId.has(p.id) || predicted.has(p.id)) throw new TypeError('Predictions need unique existing fixture ids.');
    if (p.suggestedScore !== null && (!Number.isInteger(p.suggestedScore) || p.suggestedScore<0 || p.suggestedScore>byId.get(p.id).question.maxMarks)) throw new RangeError('Invalid suggested score.');
    validateCriterionScores(p.criterionScores,byId.get(p.id),{allowNull:true,owner:'Prediction'});
    if (p.flawDetected!==undefined && typeof p.flawDetected!=='boolean') throw new TypeError('Prediction flawDetected must be a boolean when present.');
    predicted.set(p.id,p);
  }
  const seen=new Set();
  for (const label of labels) {
    if (!label || !byId.has(label.id) || seen.has(label.id)) throw new TypeError('Human labels need unique existing fixture ids.');
    if (label.source !== 'human' || typeof label.reviewer !== 'string' || !label.reviewer.trim() || label.adjudicated !== true) throw new TypeError('Each label needs source:human, reviewer and adjudicated:true.');
    const max=byId.get(label.id).question.maxMarks;
    if (!Number.isInteger(label.score) || label.score<0 || label.score>max) throw new RangeError('Invalid human label score.');
    validateCriterionScores(label.criterionScores,byId.get(label.id),{allowNull:false,owner:'Label'});
    if (label.substantialFlaw!==undefined && typeof label.substantialFlaw!=='boolean') throw new TypeError('Label substantialFlaw must be a boolean when present.');
    if (label.strata!==undefined) {
      if (!isPlainObject(label.strata)) throw new TypeError('Label strata must be an object.');
      for (const [key,value] of Object.entries(label.strata)) {
        if (!LABEL_STRATA.includes(key)) throw new TypeError(`Unknown label stratum ${JSON.stringify(key)}; use ${LABEL_STRATA.join(', ')}.`);
        if (typeof value!=='string' || !value.trim() || value.length>100) throw new TypeError('Label stratum values must be non-empty strings of at most 100 characters.');
      }
    }
    seen.add(label.id);
  }
  return {byId,predicted};
}

export function computeMetrics({fixtures,predictions,labels=[]}) {
  const {predicted}=validateBenchmarkInputs({fixtures,predictions,labels});
  const pairs=[];
  for (const label of labels) {
    const prediction=predicted.get(label.id);
    if (prediction && prediction.suggestedScore !== null) pairs.push({label,prediction,error:prediction.suggestedScore-label.score});
  }
  const offered=[...predicted.values()].filter(p=>p.suggestedScore !== null).length;
  const metrics=pairs.length?{
    comparedCount:pairs.length,meanAbsoluteError:pairs.reduce((s,p)=>s+Math.abs(p.error),0)/pairs.length,
    rootMeanSquareError:Math.sqrt(pairs.reduce((s,p)=>s+p.error*p.error,0)/pairs.length),
    exactAgreement:pairs.filter(p=>p.error===0).length/pairs.length,
    withinOneMark:pairs.filter(p=>Math.abs(p.error)<=1).length/pairs.length,
    meanSignedError:pairs.reduce((s,p)=>s+p.error,0)/pairs.length,
    overgradingRate:pairs.filter(p=>p.error>0).length/pairs.length
  }:null;
  return {fixtureCount:fixtures.length,predictionCount:predicted.size,proposedScoreCount:offered,coverage:fixtures.length?offered/fixtures.length:0,humanLabelCount:labels.length,labelledCoverage:labels.length?pairs.length/labels.length:null,metrics,
    notice:labels.length?'Metrics use caller-supplied human labels. Reviewer identities are not independently verified; these results are not an expert certification.':'No human labels were supplied. Error/accuracy metrics are intentionally omitted. Authored example expectations are not used as ground truth.'};
}
