// Development only. The single route to frozen snapshots: it serves public/ and
// dev/geo3d-snapshots/ on this computer. Pages publishes public/ alone, so the
// /__dev/ path does not exist in production.
// Usage: node tools/geo3d-dev-server.mjs [port]
//   http://127.0.0.1:4173/preview/geo3d/                         live data
//   http://127.0.0.1:4173/preview/geo3d/?devSnapshot=gates-pass  frozen data
// GEO3D_LAN=1 also listens on the local network for phone tests; a phone reaches
// it by IP address, which the page treats as live, never as a snapshot.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname,join,normalize,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const types={'.html':'text/html;charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.geojson':'application/geo+json','.png':'image/png','.svg':'image/svg+xml'};
const port=Number(process.argv[2])||4173,host=process.env.GEO3D_LAN?'0.0.0.0':'127.0.0.1';
const local=new Set(['127.0.0.1','::1','::ffff:127.0.0.1']);
createServer(async (request,response)=>{
 const path=decodeURIComponent(new URL(request.url,'http://x').pathname);
 const snapshot=path.startsWith('/__dev/geo3d-snapshots/');
 if(snapshot&&!local.has(request.socket.remoteAddress)){response.writeHead(404).end();return;}
 const base=join(root,snapshot?'dev/geo3d-snapshots':'public');
 let file=normalize(join(base,snapshot?path.slice('/__dev/geo3d-snapshots/'.length):path));
 if(!file.startsWith(base+sep)&&file!==base){response.writeHead(403).end();return;}
 if(path.endsWith('/'))file=join(file,'index.html');
 try{
  const body=await readFile(file);
  response.writeHead(200,{'content-type':types[extname(file)]||'application/octet-stream','cache-control':'no-store'}).end(body);
 }catch{response.writeHead(404).end('Not found');}
}).listen(port,host,()=>console.log(`http://${host}:${port}/preview/geo3d/`));
