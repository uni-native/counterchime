import type {VoiceEvent} from './voice-protocol';
export const TEST_UTTERANCES={test:{label:'Test the three-rule economy',text:'Read all three rules. Test the economy and explain the full growth loop.'},repair:{label:'Repair the third rule',text:'Change the third rule called Timber trade. Consume one star and produce two wood instead of three. Keep the first two rules unchanged. Then test again.'},undo:{label:'Undo the repair',text:'Undo the last change and test the economy again.'},replay:{label:'Replay the counterexample',text:'Replay the counterexample and explain each step briefly.'}} as const;
export type TestUtteranceId=keyof typeof TEST_UTTERANCES;
/** Test-only memory receipt. Never stores complete provider events, tokens, or session configuration. */
export class TestEvidence {
 private started=Date.now();private entries:unknown[]=[];private bytes=0;private truncated=false;
 add(type:string,data:unknown){const entry={offsetMs:Date.now()-this.started,type,data};const size=JSON.stringify(entry).length;if(this.bytes+size>24_000_000||this.entries.length>=10000){this.truncated=true;return;}this.bytes+=size;this.entries.push(entry);}
 provider(event:VoiceEvent){
  const type=event.type;
  if(type==='reply.audio'&&typeof event.data==='string'&&event.data.length<=4_000_000)this.add(type,{pcm16leMono24000Base64:event.data,replyId:typeof event.reply_id==='string'?event.reply_id:null});
  else if(['transcript.user','transcript.agent'].includes(type))this.add(type,{text:typeof event.text==='string'?event.text:'',interrupted:event.interrupted===true});
  else if(type==='reply.done')this.add(type,{status:typeof event.status==='string'?event.status:'unknown'});
  else if(type==='session.ready')this.add(type,{connected:true});
  else if(type==='session.ended')this.add(type,{durationSeconds:typeof event.session_duration_seconds==='number'?event.session_duration_seconds:null});
 }
 export(){return {format:'counterchime-synthetic-input-live-evidence-v1',inputDisclosure:'Prerecorded locally synthesized Flite voice; not a human microphone recording.',outputDisclosure:'Actual received AssemblyAI audio and events, not fabricated responses. Audio chunks may include interrupted or unplayed output; timing and reply.done records must be respected.',createdAt:new Date(this.started).toISOString(),truncated:this.truncated,events:this.entries};}
}
