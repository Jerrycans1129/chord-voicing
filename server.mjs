import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {networkInterfaces} from 'node:os';
const files = {'/':'index.html','/index.html':'index.html','/style.css':'style.css','/app.js':'app.js','/theory.js':'theory.js','/pwa.js':'pwa.js','/sw.js':'sw.js','/manifest.webmanifest':'manifest.webmanifest','/icon-192.png':'icon-192.png','/icon-512.png':'icon-512.png'};
const types = {html:'text/html',css:'text/css',js:'text/javascript',webmanifest:'application/manifest+json',png:'image/png'};
const port = Number(process.env.PORT || 8000);
http.createServer(async (req,res) => {
  const file = files[new URL(req.url,'http://localhost').pathname];
  if (!file) {res.writeHead(404);res.end('Not found');return;}
  try {const data=await readFile(new URL(`./dist/${file}`,import.meta.url));res.writeHead(200,{'Content-Type':`${types[file.split('.').pop()]}; charset=utf-8`,'Cache-Control':'no-store'});res.end(data);} catch {res.writeHead(500);res.end('Unable to read application');}
}).listen(port,'0.0.0.0',()=>{
  console.log(`Local: http://localhost:${port}`);
  for(const [name,addresses] of Object.entries(networkInterfaces())) for(const a of addresses||[]) if(a.family==='IPv4'&&!a.internal&&name.startsWith('en')) console.log(`LAN (${name}): http://${a.address}:${port}`);
});
