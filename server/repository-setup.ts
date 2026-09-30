import {readSessionKey} from './api';
const fail=(code:string,status:number,stage:string,upstreamStatus?:number)=>json({code,stage,...(upstreamStatus?{upstreamStatus}:{})},status);
const REPOSITORY='https://github.com/uni-native/counterchime';
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
const validRepo=(value:unknown)=>{if(!value||typeof value!=='object')return false;const r=value as Record<string,unknown>;return typeof r.full_name==='string'&&r.full_name.toLowerCase()==='uni-native/counterchime'&&r.private===false&&typeof r.html_url==='string'&&r.html_url.toLowerCase()===REPOSITORY;};
/** User-operated, fixed-action credential relay. No credential or upstream body is returned or retained. */
export async function repositorySetup(request:Request):Promise<Response>{
 const url=new URL(request.url);
 if(request.method!=='POST')return fail('METHOD',405,'request');
 if(url.protocol!=='https:'||request.headers.get('origin')!==url.origin||request.headers.get('sec-fetch-site')==='cross-site')return fail('ORIGIN',403,'request');
 let key='';let stage='input';
 try{try{key=await readSessionKey(request);}catch{return fail('INPUT',400,'input');}
  const call=(path:'/user'|'/repos/uni-native/counterchime'|'/user/repos',method='GET')=>fetch(`https://api.github.com${path}`,{method,redirect:'error',headers:{Authorization:`Bearer ${key}`,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2026-03-10','User-Agent':'Counterchime-Repository-Setup'},signal:AbortSignal.timeout(12000),...(method==='POST'?{body:JSON.stringify({name:'counterchime',description:'A voice-driven game-economy laboratory with replay-verified growth counterexamples.',private:false,auto_init:false})}:{})});
  stage='account';const user=await call('/user');if(!user.ok)return fail(user.status===401?'TOKEN_REJECTED':user.status===403?'PERMISSION':'UPSTREAM',403,stage,user.status);
  const identity=await user.json() as {login?:unknown};if(identity.login!=='uni-native')return fail('ACCOUNT_MISMATCH',403,stage);
  stage='lookup';const existing=await call('/repos/uni-native/counterchime');
  if(existing.ok){if(!validRepo(await existing.json()))return fail('EXISTING_MISMATCH',409,stage);return json({url:REPOSITORY,created:false});}
  if(existing.status!==404)return fail(existing.status===401?'TOKEN_REJECTED':existing.status===403?'PERMISSION':'UPSTREAM',502,stage,existing.status);
  stage='create';const created=await call('/user/repos','POST');
  if(created.status!==201)return fail(created.status===401?'TOKEN_REJECTED':created.status===403?'PERMISSION':created.status===422?'VALIDATION':'UPSTREAM',502,stage,created.status);
  if(!validRepo(await created.json()))return fail('UNEXPECTED_RESULT',502,stage);
  return json({url:REPOSITORY,created:true});
 }catch{return fail('NETWORK_OR_RESPONSE',502,stage);}
 finally{key='';} // JavaScript strings cannot be securely zeroized.
}
