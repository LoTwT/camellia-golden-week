import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { chromium } from '/Users/caoyujie/codes/camellia-golden-week/node_modules/playwright/index.mjs';
import { verifyLegacyFirewallSave } from '/Users/caoyujie/codes/camellia-golden-week/scripts/browser/legacy-firewall-save.ts';
const outputDir = '/Users/caoyujie/codes/camellia-golden-week/test-results/firewall-hazards/legacy-v2';
const staticDir = join(outputDir, 'static');
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.wav':'audio/wav', '.woff2':'font/woff2', '.json':'application/json' };
const server=createServer(async(req,res)=>{
  try{
    const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(path.includes('..')) {res.writeHead(400).end();return;}
    const file=join(staticDir,path==='/'?'index.html':path);
    const body=await readFile(file);
    res.writeHead(200,{'Content-Type':mime[extname(file)]??'application/octet-stream','Cache-Control':'no-store'});res.end(body);
  }catch {res.writeHead(404).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'chrome',headless:true});
try { console.log(JSON.stringify(await verifyLegacyFirewallSave({browser,url,outputDir}),null,2)); }
finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
