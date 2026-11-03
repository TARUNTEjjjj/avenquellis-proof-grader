/** Reproduce individual case/request hashes. This tool has no network or inference calls. */
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const base=resolve(process.argv[2]||'.'),path=resolve(process.argv[3]||new URL('./scalar.mjs',import.meta.url).pathname);
const {makeRequest,model,version,cap}=await import(pathToFileURL(path));
const sha=d=>createHash('sha256').update(d).digest('hex');
const buf=await readFile(resolve(base,'blind/fixtures.json'));
const fx=JSON.parse(buf);const cases=fx.map(f=>({id:f.id,
 inputSha256:sha(JSON.stringify(f)),
 requestSha256:Object.fromEntries(['json','plain'].map(wire=>[wire,[0,1].map(i=>sha(JSON.stringify(makeRequest(f.question,f.answer,i,wire))))]))}));
const result={model,version,cap,hashEncoding:'UTF-8 JSON.stringify with source field order; array index 0 is the first reading.',scalarModuleSha256:sha(await readFile(path)),fixtureSha256:sha(buf),cases};
if(process.argv[4])await writeFile(resolve(process.argv[4]),JSON.stringify(result,null,2)+'\n');
else process.stdout.write(JSON.stringify(result,null,2)+'\n');
