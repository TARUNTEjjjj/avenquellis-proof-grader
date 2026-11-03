import http from 'node:http';
import {Readable} from 'node:stream';
import {pathToFileURL} from 'node:url';
import {createRequestHandler} from './service.js';

export function createServer({env=process.env,fetchImpl=globalThis.fetch,publicDeployment=false}={}) {
  const handle=createRequestHandler({env,fetchImpl,publicDeployment});
  return http.createServer(async (req,res)=>{
    try {
      const request=new Request(`http://localhost${req.url}`,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Readable.toWeb(req),duplex:'half'}:{})});
      const response=await handle(request);
      res.writeHead(response.status,Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {if(!res.headersSent)res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Request processing failed.'}));}
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port=Number(process.env.PORT || 4175),host=process.env.HOST || '127.0.0.1';
  const publicDeployment=!['127.0.0.1','localhost','::1'].includes(host);
  if (publicDeployment && (!process.env.EVALUATOR_ACCESS_TOKEN || process.env.EVALUATOR_ACCESS_TOKEN.length < 32)) throw new Error('Public binding requires EVALUATOR_ACCESS_TOKEN (at least 32 characters).');
  createServer({publicDeployment}).listen(port,host,()=>console.log(`Avenquellis proof review API: http://${host}:${port}`));
}
