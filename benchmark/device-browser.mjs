/** Run blind browser-local inference with an installed Chrome and an isolated persistent profile. */
import {createServer} from 'node:http';
import {readFile, writeFile, rename, mkdir} from 'node:fs/promises';
import {basename, dirname, resolve} from 'node:path';
import {chromium} from 'playwright-core';
import {DEVICE_MODEL} from '../src/device.js';

const flags = Object.create(null);
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i];
  if (key === '--resume') {flags.resume = true; continue;}
  if (!['--fixtures','--assets','--profile','--out','--port','--chrome','--limit'].includes(key) || !process.argv[i + 1]) throw new Error(`Invalid option: ${key}`);
  flags[key.slice(2)] = process.argv[++i];
}
for (const key of ['fixtures','assets','profile','out']) if (!flags[key]) throw new Error(`Provide --${key}.`);
const port = Number(flags.port || 48173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port.');
const limit = Number(flags.limit || 500);
if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Use a limit of 1–500 fixtures.');
const input = JSON.parse(await readFile(flags.fixtures, 'utf8')).slice(0, limit);
const ids = new Set();
for (const record of input) {
  if (typeof record.id !== 'string' || ids.has(record.id) || typeof record.answer !== 'string' || !record.question) throw new Error('Invalid fixture record.');
  ids.add(record.id);
}
const records = [];
if (flags.resume) {
  try {records.push(...JSON.parse(await readFile(flags.out, 'utf8')));} catch (e) {if (e.code !== 'ENOENT') throw e;}
  if (records.some(r => !ids.has(r.id) || r.modelRevision !== DEVICE_MODEL.modelRevision || r.promptVersion !== DEVICE_MODEL.promptVersion)) {
    throw new Error('Existing predictions are from another dataset, model or prompt.');
  }
}
if (new Set(records.map(r => r.id)).size !== records.length) throw new Error('Duplicate saved prediction ID.');
// A device that could not load never ran the model, so its row is no abstention. Older runs saved such rows
// before aborting. Retry those cases; each saved row stays until its case completes and replaces it.
const deviceFailed = r => r.reviewReason === 'model_load_failed' || r.reviewReason === 'device_unavailable';
const seen = new Set(records.filter(r => !deviceFailed(r)).map(r => r.id));
// Only reviewer results show that the model has loaded: gradeOnDevice returns them only after the load. A row
// refused before the load (context_limit) or cut off by the harness deadline has none.
const hasReviews = r => Array.isArray(r.failureCodes);
let reviewStarted = false;
await mkdir(dirname(resolve(flags.out)), {recursive: true});
const assets = resolve(flags.assets);
const files = new Set(['device.js','webllm-0.2.87.js','qwen3-1.7b-webgpu.wasm']);
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (path === '/') {response.writeHead(200, {'Content-Type':'text/html'});response.end('<title>Noether local proof benchmark</title>');return;}
    const file = basename(path);
    if (path !== '/device-runtime/' + file || !files.has(file)) {response.writeHead(404);response.end();return;}
    const bytes = await readFile(resolve(assets, file));
    response.writeHead(200, {'Content-Type': file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript'});
    response.end(bytes);
  } catch {response.writeHead(500);response.end();}
});
await new Promise((ok, fail) => {server.once('error', fail);server.listen(port, '127.0.0.1', ok);});
let browser;
try {
  browser = await chromium.launchPersistentContext(resolve(flags.profile), {
    executablePath: flags.chrome || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
    args: ['--enable-unsafe-webgpu', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])]
  });
  let page;
  async function freshPage() {
    page = await browser.newPage();
  page.on('console', message => {if (message.type() === 'error') console.error('browser:', message.text().slice(0, 250));});
  await page.exposeFunction('reportProgress', progress => {
    if (progress.phase === 'review') reviewStarted = true;
    if (progress.phase !== 'download' || !progress.progress || progress.progress >= 1) console.log(progress.text);
  });
  await page.goto(`http://127.0.0.1:${port}/`);
  }
  await freshPage();
  const capability = await page.evaluate(async () => (await import('/device-runtime/device.js')).deviceAvailability());
  if (!capability.available) throw new Error(capability.reason);
  const retried = records.length - seen.size;
  console.log(`WebGPU ready. ${input.length} selected cases, ${seen.size} already saved${retried ? `, ${retried} saved device failure(s) to retry` : ''}.`);
  for (const record of input) {
    if (seen.has(record.id)) continue;
    const start = Date.now();
    // Pass only theorem, approved rubric and candidate submission. Human targets stay outside browser inference.
    let timer, recycle = false;
    const inference = page.evaluate(async ({question, answer}) => {
      try {
        const {gradeOnDevice} = await import('/device-runtime/device.js');
        const r = await gradeOnDevice(question, answer, window.reportProgress);
        return {status:r.status, suggestedScore:r.suggestedScore, reviewReason:r.reviewReason,
          reviewerScores:r.reviews.map(v=>v.status==='proposal'?v.score:null),
          criterionScores:r.reviews.map(v=>v.status==='proposal'?v.criterionScores:null),
          failureCodes:r.reviews.map(v=>v.failure?.code || null)};
      } catch (e) {return {status:'needs_review', suggestedScore:null, reviewReason:e.code || 'device_error', reviewerScores:[null,null], criterionScores:[null,null]};}
    }, {question: record.question, answer: record.answer});
    // This timer runs outside Chrome. It still fires if a GPU/runtime abort wedges the page.
    const externalDeadline = new Promise((_, reject) => {
      // Until the model has loaded once, a case may include its download: no review has started in this run
      // and no saved row has reviewer results.
      const timeout = reviewStarted || records.some(hasReviews) ? 5 * 60000 : 35 * 60000;
      timer = setTimeout(() => reject(new Error('browser_runtime_timeout')), timeout);
    });
    let result;
    try { result = await Promise.race([inference, externalDeadline]); }
    catch (cause) {
      recycle = true;
      result = {status:'needs_review', suggestedScore:null, reviewReason:cause.message==='browser_runtime_timeout'?'browser_runtime_timeout':'browser_runtime_failure', reviewerScores:[null,null], criterionScores:[null,null]};
    } finally { clearTimeout(timer); }
    // The model never attempted a case its device could not load. Stop before saving it, so --resume retries it.
    if (deviceFailed(result)) {
      throw new Error(`Device could not initialize (${result.reviewReason}) on ${record.id}. Diagnose before continuing; --resume retries this unsaved case.`);
    }
    const row = {...result, id:record.id, milliseconds:Date.now()-start, modelId:DEVICE_MODEL.modelId,
      modelRevision:DEVICE_MODEL.modelRevision, runtimeVersion:DEVICE_MODEL.runtimeVersion,promptVersion:DEVICE_MODEL.promptVersion};
    const saved = records.findIndex(r => r.id === row.id);
    if (saved < 0) records.push(row); else records[saved] = row;
    await writeFile(flags.out+'.tmp', JSON.stringify(records,null,2)+'\n');
    await rename(flags.out+'.tmp', flags.out);
    console.log(`${records.length}/${input.length} ${row.id}: ${row.suggestedScore ?? 'review'} [${row.reviewerScores.join(', ')}] ${row.milliseconds}ms`);
    if (recycle) {
      await page.close({runBeforeUnload:false}).catch(() => {});
      await freshPage();
    }
  }
} finally {if (browser) await browser.close();server.close();}
