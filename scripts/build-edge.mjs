import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sdk=process.env.EMSDK;
if(!sdk)throw new Error('Set EMSDK to the official installed Emscripten 6.0.13 SDK root.');
const env={...process.env,EM_CONFIG:join(sdk,'.emscripten')};
const empp=join(sdk,'upstream/emscripten/em++');
const version=spawnSync(empp,['--version'],{encoding:'utf8',env});
if(version.status!==0||!/\b6\.0\.13\b/.test(version.stdout))throw new Error('Emscripten 6.0.13 is required.');
const out=join(root,'edge');
mkdirSync(out,{recursive:true});
const source=['src/grader.cpp','src/certificate.cpp','src/json_api.cpp','wasm/bridge.cpp'];
const args=['-std=c++20','-Oz','-fexceptions','-Iinclude','-Isrc','-Ithird_party',...source,'--no-entry',
  '-sMODULARIZE=1','-sEXPORT_ES6=1','-sEXPORT_NAME=createVeyraGrader','-sENVIRONMENT=web,worker',
  '-sEXPORTED_FUNCTIONS=_malloc,_free,_veyra_grader_run,_veyra_grader_output_length,_veyra_grader_clear',
  '-sEXPORTED_RUNTIME_METHODS=HEAPU8','-sALLOW_MEMORY_GROWTH=1','-sINITIAL_MEMORY=16777216','-sMAXIMUM_MEMORY=67108864',
  '-sSTACK_SIZE=1048576','-sFILESYSTEM=0','-sDYNAMIC_EXECUTION=0','-o','edge/veyra-grader-runtime.js'];
const build=spawnSync(empp,args,{cwd:root,env,stdio:'inherit'});if(build.error)throw build.error;if(build.status)process.exit(build.status);
const artifacts={};
for(const name of ['veyra-grader-runtime.js','veyra-grader-runtime.wasm']){
  const bytes=readFileSync(join(out,name));artifacts[name]={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
}
const sourceFiles={};
for(const name of [...source,'src/json_api.hpp','include/noether/grader/grader.hpp','third_party/nlohmann/json.hpp']){
  sourceFiles[name]=createHash('sha256').update(readFileSync(join(root,name))).digest('hex');
}
writeFileSync(join(out,'build-info.json'),JSON.stringify({abi:'veyra-grader-wasm/1',compiler:'Emscripten 6.0.13',args,sourceFiles,artifacts},null,2)+'\n');
