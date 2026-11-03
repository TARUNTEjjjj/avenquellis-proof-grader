/** Build the optional browser runtime from locked npm packages and a hash-checked model library. */
import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile, copyFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DEVICE_MODEL} from '../src/device.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = resolve(process.argv[2] || join(root, 'build/device-runtime'));
const wasmCommit = '146ed9cd4b4062e967b017fd2291f7106b50599f';
const wasmSha = '363f4dbb789f0518e52295d1f4685d2d61feae4ac4e2a6a95621e4af29450bd7';
const wasmUrl = `https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/${wasmCommit}/web-llm-models/v0_2_87/base/Qwen3-1.7B-q4f16_1_cs1k-webgpu.wasm`;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const packageRoot = join(root, 'node_modules/@mlc-ai/web-llm');
const meta = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
if (meta.version !== DEVICE_MODEL.runtimeVersion) throw new Error('Install the lockfile before building the pinned WebLLM runtime.');
await mkdir(destination, {recursive:true});
const common = {bundle:true, platform:'browser', format:'esm', legalComments:'eof', logLevel:'warning'};
await build({...common, entryPoints:[join(root,'src/device.js')], external:['./webllm-0.2.87.js'], outfile:join(destination,'device.js')});
await build({...common, minify:true, stdin:{contents:"export {CreateMLCEngine,prebuiltAppConfig,hasModelInCache} from '@mlc-ai/web-llm';", resolveDir:root}, outfile:join(destination,'webllm-0.2.87.js')});
const wasmFile = join(destination,'qwen3-1.7b-webgpu.wasm');
let bytes;
try {bytes = await readFile(wasmFile);} catch (e) {if (e.code !== 'ENOENT') throw e;}
if (!bytes || sha(bytes) !== wasmSha) {
  const response = await fetch(wasmUrl, {signal:AbortSignal.timeout(120000)});
  if (!response.ok) throw new Error(`Model library download returned HTTP ${response.status}.`);
  bytes = Buffer.from(await response.arrayBuffer());
  if (sha(bytes) !== wasmSha) throw new Error('Pinned model library hash mismatch.');
  await writeFile(wasmFile, bytes);
}
await copyFile(join(packageRoot,'LICENSE'), join(destination,'LICENSE-WebLLM.txt'));
await copyFile(join(root,'node_modules/loglevel/LICENSE-MIT'), join(destination,'LICENSE-loglevel.txt'));
const source = await readFile(join(packageRoot,'lib/index.js'),'utf8');
const notices = [...new Set((source.match(/\/\*[\s\S]*?\*\//g) || []).filter(s => /copyright|licen[sc]e|notice file|SPDX/i.test(s)))];
await writeFile(join(destination,'THIRD-PARTY-NOTICES.txt'), [
  `WebLLM ${meta.version}, released under Apache License 2.0. See LICENSE-WebLLM.txt.`,
  'The local ES module is a minified bundle of the published package and its loglevel dependency.',
  'The following notices are reproduced from the upstream published JavaScript bundle.',
  ...notices,
  await readFile(join(root,'scripts/NOTICE-Apache-TVM.txt'),'utf8'),
  `The MLC WebGPU model library is the upstream binary at ${wasmUrl}.`,
  `Model weights and tokenizer are downloaded separately from https://huggingface.co/mlc-ai/${DEVICE_MODEL.modelId}/tree/${DEVICE_MODEL.modelRevision}.`,
  'Qwen3 model publisher: Qwen. Model quantization and compilation: MLC AI. See https://huggingface.co/Qwen/Qwen3-1.7B and https://github.com/mlc-ai/mlc-llm.'
].join('\n\n')+'\n');
const assetNames = ['device.js','webllm-0.2.87.js','qwen3-1.7b-webgpu.wasm','LICENSE-WebLLM.txt','LICENSE-loglevel.txt','THIRD-PARTY-NOTICES.txt'];
const assets = [];
for (const name of assetNames) {
  const content = await readFile(join(destination,name));
  assets.push({name,bytes:content.length,sha256:sha(content)});
}
await writeFile(join(destination,'provenance.json'), JSON.stringify({model:DEVICE_MODEL, wasmUrl, wasmCommit, runtimePackage:`@mlc-ai/web-llm@${meta.version}`, assets},null,2)+'\n');
console.log(`Built ${assets.length} pinned device assets in ${destination}. Model weights are fetched only on an explicit review request.`);
