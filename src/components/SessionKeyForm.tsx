import {useEffect,useRef} from 'react';
import {SessionKeyTokenSource,takeSessionKey} from '../session-key';
import type {VoiceTokenSource} from '../voice';
export function SessionKeyForm({onStart,onError}:{onStart:(source:VoiceTokenSource)=>void;onError:(message:string)=>void}){
 const field=useRef<HTMLInputElement>(null);
 useEffect(()=>{const input=field.current;const clear=()=>{if(input)input.value='';};window.addEventListener('pagehide',clear);return()=>{clear();window.removeEventListener('pagehide',clear);};},[]);
 return <form className="session-key-form" autoComplete="off" onSubmit={event=>{event.preventDefault();if(!field.current)return;let key=takeSessionKey(field.current);try{const source=new SessionKeyTokenSource(key);key='';onStart(source);}catch{onError('Enter a valid API key. The field was cleared and nothing was sent.');}finally{key='';}}}>
 <h3>One-session key entry</h3><p id="session-key-description">Use only your own existing AssemblyAI key. When you personally submit, send it to this app’s server, which exchanges it with AssemblyAI for one temporary voice token. Counterchime does not save or log the key or share it with other visitors. Do not use a key previously exposed in chat. The field clears immediately; do not save it in your browser.</p>
 <label htmlFor="session-key">AssemblyAI API key</label><div><input id="session-key" ref={field} type="password" autoComplete="off" autoCorrect="off" spellCheck={false} maxLength={512} required aria-describedby="session-key-description session-key-budget" data-lpignore="true" data-1p-ignore="true"/><button className="button accent" type="submit">Use key for one voice session</button></div>
 <p id="session-key-budget">Two attempts maximum for testing and recording combined. Each session ends after five minutes. Starting requests microphone access and sends your audio and rulebook to AssemblyAI. Failed starts may consume an attempt.</p>
 </form>;
}
