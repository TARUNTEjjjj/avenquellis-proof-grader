/** User-triggered, browser-local WebGPU proof review. No remote inference endpoint is used. */
import {boundedInput, evaluatePreparedReview, reviewerMessages, validateProviderCritique} from './provider.js';

export const DEVICE_MODEL = Object.freeze({
  label: 'Qwen3 1.7B · browser-local experimental review',
  modelId: 'Qwen3-1.7B-q4f16_1-MLC',
  modelRevision: '80b3abcec6c3b3f5355dc0cc99cc4fb578f192bc',
  runtimeVersion: '0.2.87',
  weightBytes: 968001536,
  estimatedDownloadBytes: 990000000,
  estimatedGpuMemoryMB: 2036.66,
  contextWindowTokens: 4096,
  promptVersion: 'noether-device-proof-2026-11-03-v1'
});
const modelBase = `https://huggingface.co/mlc-ai/${DEVICE_MODEL.modelId}/resolve/${DEVICE_MODEL.modelRevision}/`;
const error = (code, message) => Object.assign(new Error(message), {code});

export function deviceModelInfo() {
  return {...DEVICE_MODEL, webgpuExposed: Boolean(globalThis.navigator?.gpu),
    requirements: 'Secure context, WebGPU with shader-f16, about 2 GB of available GPU memory, and about 1 GB for model downloads.'};
}

/** Performs only a local capability check. No model/network request occurs. */
export async function deviceAvailability() {
  if (!globalThis.isSecureContext || !globalThis.navigator?.gpu) return {available: false, reason: 'WebGPU is unavailable in this browser or context.'};
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return {available: false, reason: 'The browser could not obtain a GPU adapter.'};
    if (!adapter.features.has('shader-f16')) return {available: false, reason: 'The GPU adapter lacks shader-f16, which this model requires.'};
    return {available: true, reason: 'A compatible WebGPU adapter is available; memory capacity is checked during model loading.'};
  } catch { return {available: false, reason: 'The browser could not initialize WebGPU.'}; }
}

async function loadDefaultEngine(onProgress) {
  const capability = await deviceAvailability();
  if (!capability.available) throw error('device_unavailable', capability.reason);
  onProgress({phase: 'download', text: 'Preparing the local model. The first run downloads about 1 GB.'});
  try {
    const runtime = await import('./webllm-0.2.87.js');
    const record = runtime.prebuiltAppConfig.model_list.find(r => r.model_id === DEVICE_MODEL.modelId);
    if (!record) throw new Error('Pinned model record is absent.');
    return await runtime.CreateMLCEngine(DEVICE_MODEL.modelId, {
      appConfig: {model_list: [{...record, model: modelBase, model_lib: new URL('./qwen3-1.7b-webgpu.wasm', import.meta.url).href}]},
      initProgressCallback: report => onProgress({phase: 'download', progress: report.progress, text: report.text})
    });
  } catch {
    throw error('model_load_failed', 'The local model could not load. Check download access, browser storage, available GPU memory, and WebGPU support.');
  }
}

// Small models cite span IDs rather than retyping mathematical notation. The server-style
// validator receives the exact selected substring. Relevance is still a model judgment.
function sourceSpans(answer) {
  return answer.split('\n').flatMap(line => (line.match(/.{1,280}(?:\s|$)|.{1,280}/gu) || []).map(text => text.trim())).filter(Boolean);
}
function deviceSchema(question, spans) {
  const ids = question.rubric.map(c => c.id);
  return {type: 'object', additionalProperties: false, required: ids,
    properties: Object.fromEntries(question.rubric.map(c => [c.id, {
      type: 'object', additionalProperties: false, required: ['points', 'span', 'reason'], properties: {
        points: {type: 'integer', enum: Array.from({length: c.points + 1}, (_, i) => i)},
        span: {type: 'integer', enum: [-1, ...spans.keys()]}, reason: {type: 'string'}
      }
    }]))};
}
function normalizeDeviceReview(question, answer, spans, output) {
  if (!output || typeof output !== 'object' || Array.isArray(output) || Object.keys(output).length !== question.rubric.length) {
    throw error('invalid_output', 'The local model returned an incomplete rubric.');
  }
  const criterionScores = Object.create(null), evidence = [], gaps = [], notes = [];
  for (const criterion of question.rubric) {
    const row = output[criterion.id];
    if (!row || Object.keys(row).length !== 3 || !['points','span','reason'].every(key => Object.hasOwn(row, key)) ||
        !Number.isInteger(row.span) || row.span < -1 || row.span >= spans.length ||
        typeof row.reason !== 'string' || !row.reason.trim() || row.reason.length > 1500) {
      throw error('invalid_output', 'The local model returned an invalid criterion or evidence span.');
    }
    criterionScores[criterion.id] = row.points;
    if (row.span >= 0) evidence.push({criterionId: criterion.id, quote: spans[row.span]});
    notes.push(`${criterion.id}: ${row.reason}`);
    if (row.points < criterion.points) gaps.push(`${criterion.id}: ${row.reason}`);
  }
  try {
    return validateProviderCritique({question, answer, critique: {criterionScores, evidence, gaps, rationale: notes.join('\n')}});
  } catch {throw error('invalid_output', 'The local model supplied unsupported points or evidence.');}
}

// The prompt a review pass sends: the shared reviewer instructions plus the device protocol, and numbered spans for the answer.
function deviceMessages(question, spans, reviewerIndex) {
  const messages = reviewerMessages(question, '', reviewerIndex);
  messages[0].content += '\nDevice output protocol: return one object per rubric ID with points, span and reason. Select the numbered submission span that supports credit; use -1 when no span supports credit. A positive score requires a real supporting span. Inspect whether the cited passage actually establishes the criterion. Explain a specific mathematical success or logical gap per criterion in one short sentence.';
  messages[1].content = JSON.stringify({question, submissionSpans: spans.map((text, id) => ({id, text}))});
  return messages;
}
// Qwen's tokenizer splits NFC text with this pattern before byte-pair encoding, and each piece becomes at least one
// token. So ordinary text has at least as many tokens as pieces, and the count needs no tokenizer download.
const tokenPieces = /'[sS]|'[tT]|'[rR][eE]|'[vV][eE]|'[mM]|'[lL][lL]|'[dD]|[^\r\n\p{L}\p{N}]?\p{L}+|\p{N}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+/gu;
const promptTokenFloor = messages => messages.reduce((sum, m) => sum + (m.content.normalize('NFC').match(tokenPieces)?.length ?? 0), 0);

// A timed-out GPU request can finish after its caller. Avoid resetting or unloading the same engine while it is
// still generating. Each engine with a running generation maps to a promise that settles once it has stopped.
const pendingGenerations = new WeakMap();
// Resolves when `stopped` settles or after `ms`, whichever comes first.
const stopsWithin = (stopped, ms) => new Promise(resolve => {
  const timer = setTimeout(resolve, ms);
  stopped.then(() => {clearTimeout(timer); resolve();});
});
// An interrupted generation stops at its next decode step. release() waits this long for that and no longer,
// so a runtime that never stops cannot hold the caller for another review deadline.
const RELEASE_WAIT_MS = 5000;
async function reviewPass(engine, input, reviewerIndex, emit, timeoutMs) {
  const {question, submission} = input;
  const spans = sourceSpans(submission);
  const schema = deviceSchema(question, spans);
  const messages = deviceMessages(question, spans, reviewerIndex);
  emit({phase: 'review', reviewer: reviewerIndex + 1, text: `Local review ${reviewerIndex + 1} of 2 is checking the proof.`});
  // The two reviewers see the original submission in separate chats. A single engine runs them serially.
  if (pendingGenerations.has(engine)) throw error('device_busy', 'A previous GPU review is still stopping.');
  let deadline;
  try {
    await engine.resetChat(false);
    const completion = Promise.resolve().then(() => engine.chat.completions.create({
      messages, stream: false, max_tokens: 650, temperature: 0.15, seed: 991 + reviewerIndex,
      response_format: {type: 'json_object', schema: JSON.stringify(schema)}, extra_body: {enable_thinking: false}
    })).finally(() => pendingGenerations.delete(engine));
    pendingGenerations.set(engine, completion.then(() => {}, () => {}));
    const timeout = new Promise((_, reject) => {
      deadline = setTimeout(() => {
        Promise.resolve().then(() => engine.interruptGenerate()).catch(() => {});
        reject(error('device_timeout', 'The local GPU review exceeded its deadline.'));
      }, timeoutMs);
    });
    const response = await Promise.race([completion, timeout]);
    const choice = response?.choices?.[0];
    if (!choice || choice.finish_reason !== 'stop' || typeof choice.message?.content !== 'string') {
      throw error('incomplete_output', 'The local review reached its context, time, or output limit.');
    }
    // WebLLM prepends an empty Qwen thinking block when thinking is explicitly disabled.
    const json = choice.message.content.replace(/^\s*<think>\s*<\/think>\s*/, '');
    return normalizeDeviceReview(question, submission, spans, JSON.parse(json));
  } catch (cause) {
    if (['incomplete_output','invalid_output','device_timeout'].includes(cause?.code)) throw cause;
    throw error('device_review_failed', 'The local runtime could not complete this review within its hardware and context limits.');
  } finally {clearTimeout(deadline);}
}

export function createDeviceGrader({loadEngine = loadDefaultEngine, reviewTimeoutMs = 120000} = {}) {
  if (!Number.isSafeInteger(reviewTimeoutMs) || reviewTimeoutMs < 50 || reviewTimeoutMs > 120000) throw new RangeError('Review deadline must be between 50 and 120,000 milliseconds.');
  let engine = null, busy = false;
  async function grade(question, answer, onProgress = () => {}) {
    const prepared = boundedInput({question, answer});
    const spans = sourceSpans(prepared.answer);
    // Size what each review pass sends, including its instructions and span numbering, before any model download.
    // A prompt that provably fills the context window leaves no room for a reply.
    if (prepared.question.rubric.length > 8 || prepared.question.rubric.some(c => c.points > 100) ||
        new TextEncoder().encode(JSON.stringify(prepared)).length > 13000 ||
        [0, 1].some(index => promptTokenFloor(deviceMessages(prepared.question, spans, index)) >= DEVICE_MODEL.contextWindowTokens)) {
      throw error('context_limit', 'This proof and rubric exceed the small local model’s input limit.');
    }
    if (busy) throw error('device_busy', 'A local review is already running.');
    const emit = progress => {try {onProgress(progress);} catch { /* Presentation failures must not invalidate review. */ }};
    busy = true;
    try {
      engine ||= await loadEngine(emit);
      let queue = Promise.resolve();
      const result = await evaluatePreparedReview(prepared, {
        provider: 'browser-webllm', model: DEVICE_MODEL.modelId, promptVersion: DEVICE_MODEL.promptVersion,
        makeReviewer: index => input => {
          const pass = queue.then(() => reviewPass(engine, input, index, emit, reviewTimeoutMs));
          queue = pass.catch(() => {});
          return pass;
        }
      });
      result.provenance.modelRevision = DEVICE_MODEL.modelRevision;
      result.provenance.runtimeVersion = DEVICE_MODEL.runtimeVersion;
      emit({phase: 'complete', text: 'Local reviewers have finished. Check the evidence and any disagreement.'});
      return result;
    } finally {busy = false;}
  }
  return {grade, async release() {
    if (busy) throw error('device_busy', 'Finish the active review before releasing the model.');
    // A timed-out generation can outlive grade(); unloading under it would dispose the engine mid-request.
    // Its deadline interrupted it, so wait for it to stop, but only briefly and never longer than a review deadline.
    const stopping = engine && pendingGenerations.get(engine);
    if (stopping) await stopsWithin(stopping, Math.min(reviewTimeoutMs, RELEASE_WAIT_MS));
    if (busy) throw error('device_busy', 'Finish the active review before releasing the model.');
    if (engine && pendingGenerations.has(engine)) throw error('device_busy', 'A previous GPU review is still stopping.');
    const loaded = engine;
    engine = null;
    if (loaded) await loaded.unload();
  }};
}
const localGrader = createDeviceGrader();
export const gradeOnDevice = localGrader.grade;
export const releaseDeviceModel = localGrader.release;
