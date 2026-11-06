import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {appendFileSync,chmodSync,copyFileSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const meta=JSON.parse(readFileSync(join(root,'edge/build-info.json'),'utf8'));
// The stub SDK reports the pinned version, then fails the compile without writing any output.
for(const [failure,compile] of [['exits with an error','exit 1'],['is killed by a signal','kill -KILL $$']]){
  test(`an em++ build that ${failure} fails and keeps the pinned manifest`,{skip:process.platform==='win32'&&'needs a POSIX shell stub'},()=>{
    const dir=mkdtempSync(join(tmpdir(),'avenquellis-build-edge-'));
    try{
      // build-edge.mjs resolves the repository from its own path, so a copy builds inside the copy.
      for(const path of ['scripts/build-edge.mjs','edge/build-info.json',...Object.keys(meta.sourceFiles),...Object.keys(meta.artifacts).map(name=>'edge/'+name)]){
        mkdirSync(dirname(join(dir,path)),{recursive:true});copyFileSync(join(root,path),join(dir,path));
      }
      appendFileSync(join(dir,'src/json_api.cpp'),'\n// A source change the failed build never compiled.\n');
      const empp=join(dir,'emsdk/upstream/emscripten/em++');mkdirSync(dirname(empp),{recursive:true});
      writeFileSync(empp,`#!/bin/sh\nif [ "$1" = --version ]; then echo 'emcc (Emscripten stub) 6.0.13'; exit 0; fi\n${compile}\n`);chmodSync(empp,0o755);
      const manifest=readFileSync(join(dir,'edge/build-info.json'),'utf8');
      const run=spawnSync(process.execPath,[join(dir,'scripts/build-edge.mjs')],{env:{...process.env,EMSDK:join(dir,'emsdk')},encoding:'utf8'});
      assert.notEqual(run.status,0,'a failed em++ build must fail the script');
      assert.equal(readFileSync(join(dir,'edge/build-info.json'),'utf8'),manifest,'a failed build must not pin new source hashes');
    }finally{rmSync(dir,{recursive:true,force:true});}
  });
}
