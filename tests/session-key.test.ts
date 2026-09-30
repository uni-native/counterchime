/** Synthetic secret-like fixtures only; fetch is replaced before every exchange. */
import test from 'node:test';import assert from 'node:assert/strict';import {api,sessionKeyConfigured,type Env} from '../server/api.ts';import {SessionKeyTokenSource,takeSessionKey} from '../src/session-key.ts';
const FAKE='synthetic-fixture-not-an-api-key';
let identity=0;
function setup(){const owner=`synthetic-owner-${++identity}`;let reservations=0;const env:Env={ENABLE_LIVE_VOICE:'true',ENABLE_SESSION_KEY_INPUT:'true',VOICE_ACCESS_MODE:'sites-protected',VOICE_ALLOWED_USER_IDS:owner,VOICE_MAX_SESSIONS:'2',ALLOWED_ORIGIN:'https://counterchime.example',DB:{prepare(){return{bind(){return{first:async<T>()=>{reservations++;return(reservations<=2?{used:reservations}:null) as T|null;}}}}}}};return{owner,env,reservations:()=>reservations};}
function request(owner:string,body:unknown={apiKey:FAKE},options:{origin?:string;type?:string;raw?:string;url?:string}={}){return new Request(options.url||'https://counterchime.example/api/session-voice-token',{method:'POST',headers:{origin:options.origin||'https://counterchime.example','content-type':options.type||'application/json','oai-authenticated-user-id':owner},body:options.raw??JSON.stringify(body)});}
test('session-only exchange requires all explicit gates and never reads unauthorized payload',async()=>{
 const {env,owner}=setup();let calls=0;const original=globalThis.fetch;globalThis.fetch=async()=>{calls++;throw Error('must not fetch');};
 try{for(const override of [{ENABLE_LIVE_VOICE:'false'},{ENABLE_SESSION_KEY_INPUT:'false'},{VOICE_MAX_SESSIONS:'0'},{VOICE_MAX_SESSIONS:'3'},{VOICE_ALLOWED_USER_IDS:''},{DB:undefined},{VOICE_ACCESS_MODE:'local-only'}]){const res=await api(request(owner),{...env,...override});assert.equal(res?.status,503);assert.ok(!(await res!.text()).includes(FAKE));}assert.equal((await api(request('wrong-owner'),env))?.status,503);assert.equal((await api(request(owner,undefined,{origin:'https://evil.example'}),env))?.status,403);assert.equal(sessionKeyConfigured(env,request(owner,undefined,{url:'http://counterchime.example/api/session-voice-token'})),false);assert.equal(calls,0);}finally{globalThis.fetch=original;}
});
test('session-only exchange rejects malformed/oversized payloads before budget or upstream',async()=>{
 const {env,owner,reservations}=setup();let calls=0;const original=globalThis.fetch;globalThis.fetch=async()=>{calls++;throw Error('must not fetch');};
 try{for(const body of [null,[],{}, {apiKey:4},{apiKey:''},{apiKey:'short'},{apiKey:FAKE,extra:true},{apiKey:'x'.repeat(513)},{apiKey:'\n'+FAKE}]){assert.equal((await api(request(owner,body),env))?.status,400);}assert.equal((await api(request(owner,undefined,{raw:'{invalid-json'}),env))?.status,400);assert.equal((await api(request(owner,undefined,{raw:'x'.repeat(2049)}),env))?.status,400);assert.equal((await api(request(owner,undefined,{type:'text/plain'}),env))?.status,400);assert.equal(calls,0);assert.equal(reservations(),0);}finally{globalThis.fetch=original;}
});
test('synthetic successful exchange uses fixed upstream and caps, returns only temporary token, shares durable budget',async()=>{
 const {env,owner,reservations}=setup();const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async(input,init)=>{calls++;const url=new URL(String(input));assert.equal(url.origin,'https://agents.assemblyai.com');assert.equal(url.pathname,'/v1/token');assert.equal(url.searchParams.get('expires_in_seconds'),'60');assert.equal(url.searchParams.get('max_session_duration_seconds'),'300');assert.equal(new Headers(init?.headers).get('authorization'),`Bearer ${FAKE}`);return new Response(JSON.stringify({token:'synthetic-single-use-token'}));};
 try{for(let i=0;i<2;i++){const res=await api(request(owner),env);assert.equal(res?.status,200);assert.deepEqual(await res!.json(),{token:'synthetic-single-use-token'});assert.equal(res?.headers.get('cache-control'),'no-store');}assert.equal((await api(request(owner),env))?.status,429);assert.equal(calls,2);assert.equal(reservations(),3);assert.equal(env.ASSEMBLYAI_API_KEY,undefined);}finally{globalThis.fetch=original;}
});
test('provider error bodies, exceptions and echoed-key tokens are never returned',async()=>{
 const original=globalThis.fetch;
 try{for(const behavior of ['http','throw','echo']as const){const {env,owner,reservations}=setup();globalThis.fetch=async()=>{if(behavior==='throw')throw new Error(FAKE);return new Response(JSON.stringify(behavior==='echo'?{token:FAKE}:{error:FAKE}),{status:behavior==='http'?401:200});};const res=await api(request(owner),env);assert.equal(res?.status,502);assert.ok(!(await res!.text()).includes(FAKE));assert.equal(reservations(),1);}}finally{globalThis.fetch=original;}
});
test('field clears synchronously; holder posts once and cannot be replayed',async()=>{
 const field={value:FAKE};const value=takeSessionKey(field);assert.equal(field.value,'');const source=new SessionKeyTokenSource(value);const original=globalThis.fetch;let count=0;
 globalThis.fetch=async(input,init)=>{count++;assert.equal(input,'/api/session-voice-token');assert.equal(init?.method,'POST');assert.equal(init?.cache,'no-store');assert.equal(init?.referrerPolicy,'no-referrer');assert.deepEqual(JSON.parse(String(init?.body)),{apiKey:FAKE});return new Response(JSON.stringify({token:'synthetic-token'}));};
 try{assert.equal(await source.getToken(new AbortController().signal),'synthetic-token');await assert.rejects(source.getToken(new AbortController().signal),/cleared/);assert.equal(count,1);}finally{globalThis.fetch=original;}
});
test('discard and failures clear holder and sanitize echoed transport errors',async()=>{
 const cleared=new SessionKeyTokenSource(FAKE);cleared.discard();await assert.rejects(cleared.getToken(new AbortController().signal),/cleared/);
 const field={value:'bad'};assert.throws(()=>new SessionKeyTokenSource(takeSessionKey(field)));assert.equal(field.value,'');
 const original=globalThis.fetch;globalThis.fetch=async()=>{throw new Error(FAKE);};const source=new SessionKeyTokenSource(FAKE);
 try{await assert.rejects(source.getToken(new AbortController().signal),error=>error instanceof Error&&!error.message.includes(FAKE)&&error.message.includes('cleared'));await assert.rejects(source.getToken(new AbortController().signal),/cleared/);}finally{globalThis.fetch=original;}
});
test('explicit public BYOK flag allows only supplied key; stored owner key remains gated',async()=>{
 const {env,reservations}=setup();env.ENABLE_PUBLIC_SESSION_KEY_INPUT='true';env.ASSEMBLYAI_API_KEY='synthetic-stored-owner-key';const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async(_input,init)=>{calls++;assert.equal(new Headers(init?.headers).get('authorization'),`Bearer ${FAKE}`);assert.equal(init?.redirect,'error');return Response.json({token:'synthetic-temporary-token'});};
 try{assert.equal(sessionKeyConfigured(env,request('')),true);const stored=new Request('https://counterchime.example/api/voice-token',{method:'POST',headers:{origin:'https://counterchime.example'}});assert.equal((await api(stored,env))?.status,503);assert.equal((await api(request('',{}),env))?.status,400);assert.equal(calls,0);for(let i=0;i<2;i++)assert.equal((await api(request(''),env))?.status,200);assert.equal((await api(request(''),env))?.status,429);assert.equal(calls,2);assert.equal(reservations(),3);}finally{globalThis.fetch=original;}
});
test('public BYOK cannot bypass required HTTPS, live flag, durable DB, or maximum',()=>{const {env}=setup();env.ENABLE_PUBLIC_SESSION_KEY_INPUT='true';for(const override of [{ENABLE_LIVE_VOICE:'false'},{ENABLE_SESSION_KEY_INPUT:'false'},{DB:undefined},{VOICE_MAX_SESSIONS:'3'},{VOICE_ACCESS_MODE:'local-only'}])assert.equal(sessionKeyConfigured({...env,...override},request('')),false);assert.equal(sessionKeyConfigured(env,request('',undefined,{url:'http://counterchime.example/api/session-voice-token'})),false);});
