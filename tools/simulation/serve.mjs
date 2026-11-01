// Local-only static preview, no application backend and no external requests.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
const root = resolve(process.argv.includes('--app')?'public':'public/simulation');
createServer(async (req,res)=>{
  try {
    const path = decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
    const file = resolve(root, '.' + (path==='/'?'/index.html':path));
    if(!file.startsWith(root+sep)){res.writeHead(403).end();return;}
    const body=await readFile(file);
    res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'})[extname(file)] || 'application/octet-stream','Cache-Control':'no-store'}).end(body);
  } catch { res.writeHead(404).end('Not found'); }
}).listen(8081,'127.0.0.1',()=>console.log(process.argv.includes('--app')?'FLOODplain experimental route assessment: http://127.0.0.1:8081/simulation/routes.html':'Experimental rainfall lab: http://127.0.0.1:8081'));
