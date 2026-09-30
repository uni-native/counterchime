import {api,type Env} from './api';
// The build injects only public client artifacts, never environment values.
declare const __STATIC_ASSETS__:Record<string,{body:string;type:string}>;
export default {async fetch(request:Request,env:Env){
 const response=await api(request,env);if(response)return response;
 if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});
 const url=new URL(request.url);const key=url.pathname==='/'?'/index.html':url.pathname;
 const asset=__STATIC_ASSETS__[key];if(!asset)return new Response('Not found',{status:404});
 const raw=atob(asset.body);const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
 return new Response(request.method==='HEAD'?null:bytes,{headers:{'Content-Type':asset.type,...(key==='/repository-setup.html'?{'Content-Security-Policy':"frame-ancestors 'none'",'X-Frame-Options':'DENY'}:{}),'Cache-Control':key.startsWith('/assets/')?'public, max-age=31536000, immutable':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Permissions-Policy':'microphone=(self), camera=(), geolocation=()'}});
}};
