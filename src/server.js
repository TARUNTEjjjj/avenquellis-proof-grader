import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {assessProof, finalizeReview, gradingSources} from './index.js';

export function createServer() {
  return http.createServer(async (req,res) => {
    res.setHeader('Content-Type','application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options','nosniff');
    const origin = req.headers.origin;
    const allowed = process.env.ALLOWED_ORIGIN || 'http://localhost:4173';
    if (origin && origin !== allowed) {res.writeHead(403); res.end(JSON.stringify({error:'Origin not allowed.'})); return;}
    if (origin) {res.setHeader('Access-Control-Allow-Origin',allowed); res.setHeader('Vary','Origin');}
    if (req.method === 'OPTIONS') {res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers','Content-Type'); res.writeHead(204); res.end(); return;}
    if (req.method === 'GET' && req.url === '/health') {res.end(JSON.stringify({service:'noether-proof-grader',mode:'human-review-workflow',sources:gradingSources})); return;}
    if (req.method !== 'POST' || !['/assess','/review'].includes(req.url)) {res.writeHead(404); res.end(JSON.stringify({error:'Not found.'})); return;}
    if (String(req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase() !== 'application/json') {res.writeHead(415); res.end(JSON.stringify({error:'Use application/json.'})); return;}
    try {
      const chunks = []; let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 100000) {res.writeHead(413); res.end(JSON.stringify({error:'Request too large.'})); return;}
        chunks.push(chunk);
      }
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const result = req.url === '/assess' ? assessProof(input) : finalizeReview(input);
      res.end(JSON.stringify(result));
    } catch (error) {res.writeHead(400); res.end(JSON.stringify({error:error.message}));}
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 4175);
  createServer().listen(port,'127.0.0.1',() => console.log(`Noether proof review API: http://127.0.0.1:${port}`));
}
