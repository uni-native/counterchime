import {useCallback,useEffect,useRef,useState} from 'react';
import {validateScenario,type Scenario} from './engine';
import {EXAMPLES,copyScenario} from './scenarios';
import {commit,undo,newSession,runAnalysis,exportSession,importScenario,toolAction,sessionConfig,type SessionState} from './session';
import {VoiceClient,type VoiceStatus,type VoiceTranscript,type VoiceTokenSource} from './voice';
import {localCommand} from './local-command';
import {Brand,Icon} from './components/Icon';
import {Rulebook} from './components/Rulebook';
import {Evidence} from './components/Evidence';
import {VoiceWorkbench} from './components/VoiceWorkbench';
const STORAGE='counterchime-rulebook-v1';
function initialState(){
 try {const saved=localStorage.getItem(STORAGE);if(saved){const validated=validateScenario(JSON.parse(saved));if(validated.valid)return runAnalysis(newSession(validated.scenario));}}catch{/* A blocked or malformed local store never prevents the app opening. */}
 return runAnalysis(newSession(copyScenario(EXAMPLES[0].scenario)));
}
export default function App(){
 const [state,setState]=useState<SessionState>(initialState);const stateRef=useRef(state);
 const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);const [replayStep,setReplayStep]=useState(0);const [playing,setPlaying]=useState(false);
 const [configured,setConfigured]=useState(false);const [sessionKeyAllowed,setSessionKeyAllowed]=useState(false);const [viewerId,setViewerId]=useState<string|null>(null);const [setupMessage,setSetupMessage]=useState('Checking live voice availability…');const [checkingVoice,setCheckingVoice]=useState(true);const voiceActive=useRef(false);const [voiceStatus,setVoiceStatus]=useState<VoiceStatus>('idle');const [voiceDetail,setVoiceDetail]=useState('');const [transcripts,setTranscripts]=useState<VoiceTranscript[]>([]);
 const voice=useRef<VoiceClient|null>(null);const file=useRef<HTMLInputElement>(null);
 const adopt=useCallback((next:SessionState)=>{stateRef.current=next;setState(next);setPlaying(false);setReplayStep(0);},[]);
 const act=useCallback((operation:()=>void)=>{try{operation();setMessage('');}catch(error){setMessage(error instanceof Error?error.message:'Something went wrong. Your rulebook was kept.');}},[]);
 useEffect(()=>{try{localStorage.setItem(STORAGE,JSON.stringify(state.scenario));}catch{setMessage('Browser storage is unavailable. Export your session to keep this rulebook.');}},[state.scenario]);
 const checkVoice=useCallback(async(signal?:AbortSignal)=>{setCheckingVoice(true);try{const response=await fetch('/api/voice-status',{signal,cache:'no-store'});if(!response.ok)throw new Error('unavailable');const value=await response.json();if(signal?.aborted)return;setConfigured(value.configured===true);setSessionKeyAllowed(value.sessionKeyAllowed===true);setViewerId(typeof value.viewerId==='string'?value.viewerId:null);setSetupMessage(value.sessionKeyAllowed===true?'One-session entry for your own key is available below. No key is saved; two attempts maximum.':value.configured===true?'Server configured. Connecting will verify provider access.':'Live voice is disabled for this deployment or viewer. Owner-approved setup and a session budget are required.');}catch{if(signal?.aborted)return;setConfigured(false);setSessionKeyAllowed(false);setSetupMessage('Could not check the voice service. Local rules and examples still work.');}finally{if(!signal?.aborted)setCheckingVoice(false);}},[]);
 useEffect(()=>{const controller=new AbortController();void checkVoice(controller.signal);return()=>controller.abort();},[checkVoice]);
 useEffect(()=>()=>{void voice.current?.stop();},[]);
 useEffect(()=>{if(!playing)return;const length=state.receipt?.result.steps.length||0;const timer=setInterval(()=>setReplayStep(n=>{if(n>=length){setPlaying(false);return n;}return n+1;}),1000);return()=>clearInterval(timer);},[playing,state.receipt]);
 const test=()=>{setBusy(true);setTimeout(()=>{act(()=>adopt(runAnalysis(stateRef.current)));setBusy(false);},30);};
 const edit=(scenario:Scenario,id?:string)=>act(()=>adopt(commit(stateRef.current,scenario,id)));
 const example=(id:string)=>act(()=>{const item=EXAMPLES.find(x=>x.id===id);if(item)adopt(runAnalysis(commit(stateRef.current,copyScenario(item.scenario))));});
 const startVoice=async(tokenSource?:VoiceTokenSource)=>{
  if(voiceActive.current||(!configured&&!tokenSource)||Boolean(tokenSource&&!sessionKeyAllowed)){tokenSource?.discard();return;}voiceActive.current=true;setVoiceDetail('');setTranscripts([]);
  const client=new VoiceClient({onStatus:(status,detail)=>{if(voice.current!==client)return;setVoiceStatus(status);if(['ended','error','idle'].includes(status))voiceActive.current=false;if(detail)setVoiceDetail(detail);},onTranscript:entry=>setTranscripts(previous=>{const index=previous.findIndex(x=>x.itemId===entry.itemId&&x.role===entry.role);if(index<0)return [...previous,entry].slice(-30);return previous.map((x,i)=>i===index?entry:x);}),onEvent:event=>{if(event.type==='session.ended'&&typeof event.session_duration_seconds==='number')setVoiceDetail(`Session ended after ${event.session_duration_seconds.toFixed(1)} seconds. Microphone released.`);},onTool:(name,args)=>{
   try{const response=toolAction(stateRef.current,name,args);adopt(response.state);if(response.replay)setPlaying(true);return response.result;}catch(error){return {error:error instanceof Error?error.message:'Rule update failed.'};}
  }});voice.current=client;
  try{await client.start(sessionConfig(),tokenSource);}catch(error){if(voice.current===client){voiceActive.current=false;setVoiceStatus('error');setVoiceDetail(error instanceof Error?error.message:'Voice connection failed.');}}
 };
 const download=()=>act(()=>{const data=JSON.stringify(exportSession(stateRef.current),null,2);const url=URL.createObjectURL(new Blob([data],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`counterchime-v${stateRef.current.revision}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
 const loadFile=async(selected:File|undefined)=>{if(!selected)return;if(selected.size>100_000){setMessage('Please choose a Counterchime JSON file smaller than 100 KB.');return;}try{const data=JSON.parse(await selected.text());adopt(runAnalysis(commit(stateRef.current,importScenario(data))));setMessage('');}catch(error){setMessage(error instanceof Error?error.message:'Could not read this session.');}if(file.current)file.current.value='';};
 return <><header className="app-header"><a href="/" aria-label="Counterchime home"><Brand/></a><nav aria-label="Session actions"><button className="text-button import-button" onClick={()=>file.current?.click()}>Import</button><input hidden ref={file} type="file" accept=".json,application/json" onChange={e=>void loadFile(e.target.files?.[0])}/><button className="button" onClick={download}><Icon name="export"/>Export session</button></nav></header>
 <main><div className="intro"><h1>Find the loop. Fix the rules.</h1><p>Speak a tiny game economy. Replay the exact trade that breaks it.</p></div>
 {message&&<div role="alert" className="notice"><span>{message}</span><button className="text-button" onClick={()=>setMessage('')} aria-label="Dismiss message">×</button></div>}
 <div className="workspace"><Rulebook scenario={state.scenario} revision={state.revision} latestEdit={state.latestEdit} onChange={edit} onExample={example} onRun={test} onUndo={()=>act(()=>adopt(runAnalysis(undo(stateRef.current))))} canUndo={state.history.length>0} busy={busy}/><Evidence receipt={state.receipt} revision={state.revision} replayStep={replayStep} playing={playing} onReplay={()=>{if(playing)setPlaying(false);else{setReplayStep(0);setPlaying(true);}}} onSelectStep={n=>{setPlaying(false);setReplayStep(n);}}/></div>
 <VoiceWorkbench sessionKeyAllowed={sessionKeyAllowed} viewerId={viewerId} onKeySession={source=>void startVoice(source)} onKeyError={setVoiceDetail} setupMessage={setupMessage} checkingVoice={checkingVoice} onCheckVoice={()=>void checkVoice()} configured={configured} status={voiceStatus} detail={voiceDetail} transcripts={transcripts} onStart={()=>void startVoice()} onStop={()=>void voice.current?.stop()} onLocalCommand={text=>act(()=>{const next=localCommand(stateRef.current,text);adopt(next.state);})} onFixture={()=>example('timber')}/>
 <footer><span>Built for small imaginary economies. No real assets or transactions.</span><span>Rules save on this device · transcripts are not saved</span></footer></main></>;
}
