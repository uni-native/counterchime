import type {VoiceTokenSource} from './voice';
/** Clear the actual uncontrolled field synchronously, including invalid input. */
export function takeSessionKey(field:{value:string}):string {const value=field.value;field.value='';return value.trim();}
/** One-use, memory-only holder. Never pass its value to React state or logs. */
export class SessionKeyTokenSource implements VoiceTokenSource {
 private value:string;
 constructor(value:string){if(!/^[\x21-\x7e]{16,512}$/.test(value))throw new Error('Enter a valid API key. It has not been sent.');this.value=value;}
 discard():void{this.value='';}
 async getToken(signal:AbortSignal):Promise<string>{
  if(!this.value)throw new Error('The session key was cleared. Enter it again for a new session.');
  let body=JSON.stringify({apiKey:this.value});this.discard();
  try{
   const pending=fetch('/api/session-voice-token',{method:'POST',credentials:'same-origin',cache:'no-store',referrerPolicy:'no-referrer',signal,headers:{'Content-Type':'application/json',Accept:'application/json'},body});
   body='';const response=await pending;
   if(!response.ok)throw new Error(response.status===429?'The approved voice session budget or burst limit is exhausted.':'The session could not start. Check access, setup, and the key with the owner.');
   const payload:unknown=await response.json();
   if(!payload||typeof payload!=='object'||typeof(payload as {token?:unknown}).token!=='string'||!(payload as {token:string}).token||(payload as {token:string}).token.length>8192)throw new Error('Invalid token response.');
   return(payload as {token:string}).token;
  }catch(error){
   // Never surface network/provider messages: they could echo submitted data.
   if(signal.aborted)throw new Error('Voice start cancelled. The session key was cleared.');
   if(error instanceof Error&&error.message==='The approved voice session budget or burst limit is exhausted.')throw error;
   throw new Error('The session could not start. The key was cleared; check the remaining budget before retrying.');
  }finally{body='';this.discard();}
 }
}
