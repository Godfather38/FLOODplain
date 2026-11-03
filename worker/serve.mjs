// Dependency-free local HTTP adapter. Wrangler runs the same exported Worker.
import { createServer } from 'node:http';
import worker from './index.js';
const env={PUBLIC_LIVE:process.argv.includes('--live-public')?'true':'false'};
createServer(async(req,res)=>{
  try {
    const response=await worker.fetch(new Request(`http://127.0.0.1:8787${req.url}`,{method:req.method}),env);
    res.writeHead(response.status,Object.fromEntries(response.headers)); res.end(await response.text());
  } catch {res.writeHead(500);res.end('Preview error');}
}).listen(8787,'127.0.0.1',()=>console.log(`Shadow preview http://127.0.0.1:8787/?feed=preview (${env.PUBLIC_LIVE==='true'?'public reads':'synthetic fixtures'})`));
