/** Server-only AssemblyAI credential boundary. Never import this module in src/. */
export interface BudgetDB { prepare(sql:string):{bind(...values:unknown[]):{first<T>():Promise<T|null>}}; }
export interface Env {
 ASSEMBLYAI_API_KEY?:string; ENABLE_LIVE_VOICE?:string; ALLOWED_ORIGIN?:string;
 ENABLE_SESSION_KEY_INPUT?:string; ENABLE_PUBLIC_SESSION_KEY_INPUT?:string;
 VOICE_ACCESS_MODE?:string; VOICE_ALLOWED_USER_IDS?:string; VOICE_MAX_SESSIONS?:string; DB?:BudgetDB;
}
const bursts=new Map<string,{at:number;count:number}>();let localSessions=0;
const maximum=(env:Env)=>{const n=Number(env.VOICE_MAX_SESSIONS);return Number.isInteger(n)&&n>0&&n<=2?n:0;};
const loopback=(host:string)=>['localhost','127.0.0.1','[::1]'].includes(host);
function access(request:Request,env:Env):{allowed:boolean;identity:string}{
 const url=new URL(request.url);
 if(env.VOICE_ACCESS_MODE==='local-only'&&loopback(url.hostname))return {allowed:true,identity:'local'};
 if(env.VOICE_ACCESS_MODE!=='sites-protected'||!env.DB)return {allowed:false,identity:''};
 // Only Sites dispatch may supply these authenticated headers. No direct Worker exposure.
 const identity=request.headers.get('oai-authenticated-user-id')||'';
 const allowlist=(env.VOICE_ALLOWED_USER_IDS||'').split(',').map(x=>x.trim()).filter(Boolean);
 return {allowed:identity.length>0&&allowlist.includes(identity),identity};
}
const enabled=(env:Env,request:Request)=>env.ENABLE_LIVE_VOICE==='true'&&maximum(env)>0&&access(request,env).allowed;
export const voiceConfigured=(env:Env,request?:Request)=>Boolean(request&&enabled(env,request)&&env.ASSEMBLYAI_API_KEY);
export const sessionKeyConfigured=(env:Env,request:Request)=>env.ENABLE_LIVE_VOICE==='true'&&maximum(env)>0&&env.ENABLE_SESSION_KEY_INPUT==='true'&&env.VOICE_ACCESS_MODE==='sites-protected'&&Boolean(env.DB)&&new URL(request.url).protocol==='https:'&&(access(request,env).allowed||env.ENABLE_PUBLIC_SESSION_KEY_INPUT==='true');
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
export async function readSessionKey(request:Request):Promise<string>{
 if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')throw new Error('invalid');
 const length=Number(request.headers.get('content-length')||0);if(length>2048)throw new Error('invalid');
 if(!request.body)throw new Error('invalid');const reader=request.body.getReader();let size=0;const chunks:Uint8Array[]=[];
 try{for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>2048){await reader.cancel();throw new Error('invalid');}chunks.push(chunk.value);}}
 finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;chunk.fill(0);}
 let text='';let parsed:unknown;try{text=new TextDecoder().decode(bytes);parsed=JSON.parse(text);}finally{bytes.fill(0);text='';}
 if(typeof parsed!=='object'||parsed===null||Array.isArray(parsed)||Object.keys(parsed).length!==1||!Object.hasOwn(parsed,'apiKey'))throw new Error('invalid');
 const record=parsed as {apiKey:unknown};const key=record.apiKey;record.apiKey='';
 if(typeof key!=='string'||!/^[\x21-\x7e]{16,512}$/.test(key))throw new Error('invalid');return key;
}
async function reserve(request:Request,env:Env):Promise<Response|null>{
 const {identity}=access(request,env);const now=Date.now();for(const[id,b]of bursts)if(now-b.at>600_000)bursts.delete(id);
 const bucket=bursts.get(identity)||{at:now,count:0};if(bucket.count>=3&&now-bucket.at<600_000)return json({error:'Session burst limit reached. Try again in ten minutes.'},429);
 bucket.count++;bursts.set(identity,bucket);
 // Shared across stored-key and one-session-key paths. Failed minting burns a slot.
 if(env.VOICE_ACCESS_MODE==='sites-protected'){
  const reserved=await env.DB!.prepare("INSERT INTO voice_budget (id, used) VALUES ('global', 1) ON CONFLICT(id) DO UPDATE SET used = used + 1 WHERE used < ? RETURNING used").bind(maximum(env)).first<{used:number}>();
  if(!reserved)return json({error:'The owner-approved voice session budget is exhausted.'},429);
 }else{if(localSessions>=maximum(env))return json({error:'The local voice session budget is exhausted.'},429);localSessions++;}
 return null;
}
async function mintToken(apiKey:string):Promise<Response>{
 const upstream=new URL('https://agents.assemblyai.com/v1/token');upstream.searchParams.set('expires_in_seconds','60');upstream.searchParams.set('max_session_duration_seconds','300');
 const response=await fetch(upstream,{headers:{Authorization:`Bearer ${apiKey}`},signal:AbortSignal.timeout(12000),redirect:'error'});
 if(!response.ok)return json({error:'AssemblyAI could not start a session. Check the key and account access.'},502);
 const value=await response.json() as {token?:unknown};
 if(typeof value.token!=='string'||!value.token||value.token.length>8192||value.token.includes(apiKey))return json({error:'AssemblyAI returned an invalid token response.'},502);
 return json({token:value.token});
}
export async function api(request:Request,env:Env):Promise<Response|null>{
 const url=new URL(request.url);
 if(url.pathname==='/api/setup-repository')return json({code:'SETUP_CLOSED'},410);
 if(url.pathname==='/api/voice-status')return json({configured:voiceConfigured(env,request),sessionKeyAllowed:sessionKeyConfigured(env,request),provider:'AssemblyAI Voice Agent API',maxSessionSeconds:300,
  // This non-secret site-scoped ID enables exact allowlisting after normal sign-in.
  viewerId:request.headers.get('oai-authenticated-user-id')||null});
 const sessionKey=url.pathname==='/api/session-voice-token';
 if(url.pathname!=='/api/voice-token'&&!sessionKey)return null;
 if(request.method!=='POST')return json({error:'Use POST.'},405);
 const origin=request.headers.get('origin');const allowedOrigin=env.ALLOWED_ORIGIN||url.origin;
 if(!origin||origin!==allowedOrigin||request.headers.get('sec-fetch-site')==='cross-site')return json({error:'Same-origin requests only.'},403);
 if(sessionKey?!sessionKeyConfigured(env,request):!voiceConfigured(env,request))return json({error:'Live voice is not enabled for this session. Local examples and manual rules remain available.'},503);
 let apiKey='';
 try{
  if(sessionKey){try{apiKey=await readSessionKey(request);}catch{return json({error:'Enter a valid API key using the session-only form.'},400);}}
  else apiKey=env.ASSEMBLYAI_API_KEY!;
  const blocked=await reserve(request,env);if(blocked)return blocked;
  return await mintToken(apiKey);
 }catch{return json({error:'Voice service or budget storage unavailable. Please do not retry until the owner checks the remaining budget.'},502);}
 finally{apiKey='';} // Drop our reference. JavaScript strings cannot be securely zeroized.
}
