import {handleResources} from './resources.js';
import http from 'node:http';
import {realpathSync} from 'node:fs';
import {createRequire} from 'node:module';
import {Readable} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {createRequestHandler} from './service.js';

export function createServer({env=process.env,fetchImpl=globalThis.fetch,publicDeployment=false}={}) {
  const handle=createRequestHandler({env,fetchImpl,publicDeployment});
  return http.createServer(async (req,res)=>{
    try {
      if (await handleResources(req, res)) return;
      const request=new Request(`http://localhost${req.url}`,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Readable.toWeb(req),duplex:'half'}:{})});
      const response=await handle(request);
      res.writeHead(response.status,Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {if(!res.headersSent)res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Request processing failed.'}));}
  });
}
// Node loads the entry script by its real path and also finds it without the .js extension, while
// process.argv[1] keeps the path as typed (a `current` release link, macOS /tmp). Resolve it the same way,
// or a symlinked launch would skip startup and exit 0 without listening or logging.
function isEntryScript() {
  try {return realpathSync(createRequire(import.meta.url).resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));}
  catch {return false;}
}
if (process.argv[1] && isEntryScript()) {
  const port=Number(process.env.PORT || 4175),host=process.env.HOST || '127.0.0.1';
  const publicDeployment=!['127.0.0.1','localhost','::1'].includes(host);
  if (publicDeployment && (!process.env.EVALUATOR_ACCESS_TOKEN || process.env.EVALUATOR_ACCESS_TOKEN.length < 32)) throw new Error('Public binding requires EVALUATOR_ACCESS_TOKEN (at least 32 characters).');
  createServer({publicDeployment}).listen(port,host,()=>console.log(`Avenquellis proof review API: http://${host}:${port}`));
}
