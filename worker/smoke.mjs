import {createServer} from 'node:http';
import assert from 'node:assert/strict';
import worker from './index.js';
const server=createServer(async(req,res)=>{
  const response=await worker.fetch(new Request('http://localhost'+req.url,{method:req.method}));
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());
});
try {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const response=await fetch(`http://127.0.0.1:${server.address().port}/?feed=preview`);
  assert.equal(response.status,200);assert.equal(response.headers.get('x-floodplain-mode'),'synthetic-fixture');
  const result=await response.json();assert.equal(Object.keys(result.verdicts).length,2);assert.equal(result.inputs.length,20);
  console.log('Loopback HTTP fixture preview passed: two areas, 20 input checks, fixture header.');
} finally {server.close();server.closeAllConnections();}
