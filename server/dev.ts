import {createServer} from 'node:http';
import {createServer as createViteServer} from 'vite';
import {api} from './api.ts';
const port=Number(process.env.PORT || 5173);
const vite=await createViteServer({server:{middlewareMode:true}});
const server=createServer(async(req,res)=>{
 try {
  const url=new URL(req.url || '/',`http://localhost:${port}`);
  if(url.pathname.startsWith('/api/')) {
   const headers=new Headers(); for(const [k,v] of Object.entries(req.headers)) if(v) headers.set(k,Array.isArray(v)?v.join(','):v);
   const answer=await api(new Request(url,{method:req.method,headers}),process.env);
   const response=answer || new Response('Not found',{status:404});
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());return;
  }
  vite.middlewares(req,res);
 } catch {res.writeHead(500);res.end('Request failed');}
});
server.listen(port,'0.0.0.0',()=>console.log(`Counterchime local preview: http://localhost:${port}`));
