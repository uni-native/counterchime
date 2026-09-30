import {SessionKeyForm} from './SessionKeyForm';
import type {VoiceTokenSource} from '../voice';
import {useState} from 'react';
import type {VoiceStatus,VoiceTranscript} from '../voice';
import {Icon} from './Icon';
const activeStatuses=['connecting','listening','thinking','speaking','ending'];
export function VoiceWorkbench({configured,status,detail,transcripts,onStart,onStop,onLocalCommand,onFixture,setupMessage,checkingVoice,onCheckVoice,sessionKeyAllowed=false,viewerId=null,onKeySession,onKeyError}:{sessionKeyAllowed?:boolean;viewerId?:string|null;onKeySession?:(source:VoiceTokenSource)=>void;onKeyError?:(message:string)=>void;setupMessage:string;checkingVoice:boolean;onCheckVoice:()=>void;configured:boolean;status:VoiceStatus;detail:string;transcripts:VoiceTranscript[];onStart:()=>void;onStop:()=>void;onLocalCommand:(s:string)=>void;onFixture:()=>void}){
 const [command,setCommand]=useState('');const active=activeStatuses.includes(status);
 return <section className="voice-workbench" aria-labelledby="voice-heading"><div className="section-heading"><h2 id="voice-heading"><span>03 /</span> Talk to the rulebook</h2><span className={`voice-status ${active?'active':''}`}><span/>{active?status:'Voice offline'}</span></div>
 <div className="voice-main"><div className="voice-control"><span className="mic-symbol"><Icon name="mic" size={30}/></span><button className={`button ${active?'primary':'accent'}`} onClick={active?onStop:onStart} disabled={(!active&&(!configured||checkingVoice))||status==='ending'} aria-describedby="voice-availability"><Icon name={active?'stop':'mic'} size={17}/>{active?'End voice session':'Start voice session'}</button><p>{configured||sessionKeyAllowed||active?'AssemblyAI Voice Agent API · five-minute sessions':'Live voice is not enabled.'}<br/>{configured||sessionKeyAllowed||active?'Audio and rulebook go to AssemblyAI.':'Local examples work now.'}</p></div>
 <form className="local-command" onSubmit={e=>{e.preventDefault();onLocalCommand(command);setCommand('');}}><label htmlFor="local-command">Or type a command <span>(local parser)</span></label><div><input id="local-command" value={command} onChange={e=>setCommand(e.target.value)} placeholder="Change the second rule to two wood" autoComplete="off"/><button className="button" disabled={!command.trim()}>Apply</button></div></form></div>
 <div className="voice-availability"><p id="voice-availability" role="status">{setupMessage}</p>{!active&&<button className="text-button" onClick={onCheckVoice} disabled={checkingVoice}>{checkingVoice?'Checking…':'Recheck voice setup'}</button>}</div>
 {sessionKeyAllowed&&!active&&onKeySession&&onKeyError&&<SessionKeyForm onStart={onKeySession} onError={onKeyError}/>}
 {!active&&!viewerId&&!sessionKeyAllowed&&<p className="owner-signin"><a href="/signin-with-chatgpt?return_to=%2F" target="_top">Owner sign-in for voice setup</a><span> · Local examples require no sign-in</span></p>}
 {!active&&viewerId&&<details className="owner-setup"><summary>Owner setup identity</summary><p>This site-specific signed-in identity must be explicitly allowlisted before voice can be enabled.</p><code>{viewerId}</code></details>}
 <div className="voice-footnote"><p>{active?'You can interrupt the agent. Partial speech never changes a rule. End the session to release your microphone.':'No simulated speech recognition. The local parser supports “test”, “undo”, and “change the second rule to two wood”.'}</p><button className="text-button" onClick={onFixture}>Load local demo ↗</button></div>
 {detail&&<p className="voice-detail" role="status">{detail}</p>}
 {transcripts.length>0&&<div className="transcript-log" aria-label="Voice transcript" aria-live="polite">{transcripts.map((entry,i)=><div key={`${entry.itemId}-${i}`} className={!entry.final?'partial':''}><span>{entry.role==='user'?'You':'Counterchime'}</span><p>{entry.text}{!entry.final?' …':''}{entry.interrupted&&<small> (interrupted)</small>}</p></div>)}</div>}
 </section>;
}
