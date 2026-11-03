export function computeMetrics({fixtures,predictions,labels=[]}) {
  const byId=new Map(fixtures.map(f=>[f.id,f]));
  const predicted=new Map();
  for (const p of predictions) {
    if (!p || !byId.has(p.id) || predicted.has(p.id)) throw new TypeError('Predictions need unique existing fixture ids.');
    if (p.suggestedScore !== null && (!Number.isInteger(p.suggestedScore) || p.suggestedScore<0 || p.suggestedScore>byId.get(p.id).question.maxMarks)) throw new RangeError('Invalid suggested score.');
    predicted.set(p.id,p);
  }
  const seen=new Set(),pairs=[];
  for (const label of labels) {
    if (!label || !byId.has(label.id) || seen.has(label.id)) throw new TypeError('Human labels need unique existing fixture ids.');
    if (label.source !== 'human' || typeof label.reviewer !== 'string' || !label.reviewer.trim() || label.adjudicated !== true) throw new TypeError('Each label needs source:human, reviewer and adjudicated:true.');
    const max=byId.get(label.id).question.maxMarks;
    if (!Number.isInteger(label.score) || label.score<0 || label.score>max) throw new RangeError('Invalid human label score.');
    seen.add(label.id);
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
