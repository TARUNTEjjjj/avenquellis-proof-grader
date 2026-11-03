import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {fixtures as defaults} from './fixtures.js';
import {computeMetrics} from './metrics.js';
import {assessProof} from '../src/index.js';
import {evaluateProof,PROMPT_VERSION} from '../src/provider.js';

const args=process.argv.slice(2),options={};
for (let i=0;i<args.length;i++) {
  const arg=args[i];
  if (['--live','--offline'].includes(arg)) options[arg.slice(2)]=true;
  else if (['--fixtures','--labels','--predictions','--out'].includes(arg) && args[i+1] && !args[i+1].startsWith('--')) options[arg.slice(2)]=args[++i];
  else throw new Error('Usage: node benchmark/run.js [--offline | --live | --predictions file.json] [--fixtures file.json] [--labels file.json] [--out result.json]');
}
if (Number(Boolean(options.live))+Number(Boolean(options.offline))+Number(Boolean(options.predictions))>1) throw new Error('Choose one execution mode.');
const read=async file=>JSON.parse(await readFile(file,'utf8'));
const fixtures=options.fixtures?await read(options.fixtures):defaults;
if (!Array.isArray(fixtures) || !fixtures.length || fixtures.length>500) throw new Error('Fixtures must contain 1–500 records.');
const ids=new Set();
for (const f of fixtures) {if(!f || typeof f.id!=='string' || ids.has(f.id))throw new Error('Fixture ids must be unique strings.');ids.add(f.id);assessProof(f);}
const labels=options.labels?await read(options.labels):[];
computeMetrics({fixtures,predictions:[],labels}); // Validate labels before any paid provider call.
let predictions=[];
if (options.predictions) predictions=await read(options.predictions);
else {
  for (const fixture of fixtures) {
    const result=options.live?await evaluateProof(fixture,{env:process.env}):assessProof(fixture);
    predictions.push({id:fixture.id,category:fixture.category,status:result.status,suggestedScore:result.suggestedScore ?? null,reviewReason:result.reviewReason || 'offline_preparation',reviews:result.reviews || [],provenance:result.provenance || null});
  }
}
const report={generatedAt:new Date().toISOString(),mode:options.live?'live_provider':options.predictions?'provided_predictions':'offline_preparation',promptVersion:PROMPT_VERSION,...computeMetrics({fixtures,predictions,labels}),predictions};
if (options.out) {await mkdir(dirname(options.out),{recursive:true});await writeFile(options.out,JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify(report,null,2));
