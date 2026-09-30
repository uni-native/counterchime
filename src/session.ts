import {freshRuleId} from './rule-id';
import {analyze, validateScenario, replayWitness, type Scenario, type Inventory} from './engine';
export type Analysis = ReturnType<typeof analyze>;
export interface Receipt { revision:number; scenario:Scenario; result:Analysis; elapsedMs:number; verified:boolean; }
export interface SessionState { scenario:Scenario;revision:number;history:Scenario[];receipt:Receipt|null;latestEdit:string|null; }
export function newSession(scenario:Scenario):SessionState {return {scenario:structuredClone(scenario),revision:1,history:[],receipt:null,latestEdit:null};}
export function commit(state:SessionState,scenario:unknown,latestEdit:string|null=null):SessionState {
 const checked=validateScenario(scenario);if(!checked.valid) throw new Error(checked.errors.join(' '));
 if(JSON.stringify(checked.scenario)===JSON.stringify(state.scenario)) return state;
 return {...state,scenario:checked.scenario,revision:state.revision+1,history:[...state.history,state.scenario].slice(-30),latestEdit};
}
export function undo(state:SessionState):SessionState {
 if(!state.history.length) throw new Error('There is no earlier edit to undo.');
 return {...state,scenario:state.history.at(-1)!,history:state.history.slice(0,-1),revision:state.revision+1,latestEdit:null};
}
export function runAnalysis(state:SessionState):SessionState {
 const start=performance.now();const result=analyze(state.scenario);
 const verified=result.status==='found' && replayWitness(state.scenario,result.steps,result.cycleStart ?? undefined).valid;
 if(result.status==='found' && !verified) throw new Error('The computed witness failed independent replay. It has not been accepted.');
 return {...state,receipt:{revision:state.revision,scenario:structuredClone(state.scenario),result,elapsedMs:performance.now()-start,verified}};
}
export function exportSession(state:SessionState) {
 const receipt=state.receipt;const current=receipt?.revision===state.revision;
 return {format:'counterchime-session',schemaVersion:1,exportedAt:new Date().toISOString(),modelRevision:state.revision,scenario:state.scenario,
 assumptions:['Unlimited deterministic trades','Nonnegative integer resources','No random outcomes, cooldowns, storage caps, or turn costs'],
 evidence:receipt?{...receipt,current,warning:current?null:'This receipt belongs to an earlier rulebook revision.',prefix:receipt.result.steps.slice(0,receipt.result.cycleStart??0),loop:receipt.result.cycleStart===null?[]:receipt.result.steps.slice(receipt.result.cycleStart),loopRuleIds:receipt.result.cycleStart===null?[]:receipt.result.steps.slice(receipt.result.cycleStart).map(s=>s.ruleId)}:null};
}
export function importScenario(data:unknown):Scenario {
 const wrapper=data && typeof data==='object'?data as Record<string,unknown>:{};
 const checked=validateScenario(wrapper.scenario ?? data);if(!checked.valid) throw new Error(checked.errors.join(' '));return checked.scenario;
}
const count={type:'integer',minimum:0,maximum:9};
const inventorySchema={type:'object',properties:{wood:count,stone:count,stars:count},required:['wood','stone','stars'],additionalProperties:false};
const params=(properties:Record<string,unknown>,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const tool=(name:string,description:string,parameters:unknown)=>({type:'function',name,description,parameters,execution_mode:'interactive',timeout_seconds:20});
export const VOICE_TOOLS=[
 tool('get_rulebook','Get current rules, initial inventory, and model revision. Call before editing if the current revision is unknown.',params({})),
 tool('set_initial_inventory','Set the starting inventory when the user explicitly gives starting resources. Omitted resources must be zero. Do not guess missing quantities.',params({inventory:inventorySchema,base_revision:{type:'integer'}})),
 tool('upsert_rule','Add or replace one deterministic consume/produce trade. Index is the visible 1-based rule number. For corrections preserve the other side of the existing trade. Use current revision. Reject unsupported mechanics verbally.',params({index:{type:'integer',minimum:1,maximum:6},name:{type:'string',maxLength:60},input:inventorySchema,output:inventorySchema,base_revision:{type:'integer'}})),
 tool('remove_rule','Remove a rule only when the user asks. Index is the visible 1-based rule number.',params({index:{type:'integer',minimum:1,maximum:6},base_revision:{type:'integer'}})),
 tool('analyze_economy','Run the exact bounded checker when asked to test, find a loop, or explain the economy. All numerical findings MUST come from this result.',params({})),
 tool('undo_last_edit','Undo the most recent rulebook edit when the user asks. Read the current revision first; recompute evidence for the restored state.',params({base_revision:{type:'integer'}})),
 tool('replay_witness','Show the step-by-step replay for the current verified growth finding. Use when the user asks to replay or show the loop.',params({})),
];
export const SYSTEM_PROMPT=`You are Counterchime, a concise voice partner for a tiny game-economy laboratory. Speak naturally in English. Support only three resources: wood, stone, stars, at most six deterministic trades, integer quantities 0 to 9, with nonempty input and output. Trades can repeat unlimited times. There are no random outcomes, cooldowns, turn costs, inventory caps, or hidden conditions. If asked for unsupported mechanics, explain the restriction and ask for a compatible trade. Never silently simplify a mechanic. Never infer an unspecified initial inventory; ask or use the visible rulebook's existing inventory.
Use the tools for ALL edits and analysis. Never invent results or say a change happened without a successful tool result. Call get_rulebook to inspect visible rules and current revision before editing. base_revision must match its latest value; on conflict fetch fresh state. User refers to first/second rules using displayed order. For 'make that two wood, not three', identify the affected last-mentioned output and preserve all other fields; ask if ambiguous. Apply one explicit requested edit at a time. Edits automatically rerun the checker; read its actual result. To create multiple trades, call upsert_rule separately using each returned revision.
Explain a found witness using only exact inventories, rule IDs and gain from tool output. A positive finding proves a repeatable growth loop only under the stated model. A negative result NEVER proves balance, safety, or absence of exploits globally: say no growth loop was found within the displayed bounds. If truncated, explicitly mention the limit. Keep replies one or two sentences. On interruption honor the user's correction. No external actions, real money, gambling or security bypassing. If the user asks for replay or undo use the corresponding tool.`;
export function sessionConfig(){return {system_prompt:SYSTEM_PROMPT,greeting:'Tell me a trade, or ask me to test the rules on screen.',tools:VOICE_TOOLS,input:{format:{encoding:'audio/pcm'},language_codes:['en'],keyterms:['wood','stone','stars','Counterchime'],transcription_prompt:'The speaker is describing numbered game trades and nonnegative integer resource quantities.',turn_detection:{interrupt_response:true}},output:{voice:'alba',format:{encoding:'audio/pcm'}}};}
export function toolAction(state:SessionState,name:string,args:Record<string,unknown>):{state:SessionState;result:unknown;replay?:boolean} {
 const expected:Record<string,readonly string[]>={get_rulebook:[],set_initial_inventory:['inventory','base_revision'],upsert_rule:['index','name','input','output','base_revision'],remove_rule:['index','base_revision'],analyze_economy:[],undo_last_edit:['base_revision'],replay_witness:[]};
 if(expected[name] && Object.keys(args).some(key=>!expected[name].includes(key)))throw new Error('Unsupported tool fields. Only deterministic consume/produce trades are supported; do not simplify extra mechanics.');
 const report=(next:SessionState)=>({state:next,result:{revision:next.revision,rulebook:next.scenario,...(next.receipt?{analysis:next.receipt.result,verified:next.receipt.verified}:{}),limitsWarning:'A negative result is bounded and is not a proof of balance.'}});
 if(name==='get_rulebook') return {state,result:{revision:state.revision,rulebook:state.scenario}};
 if(name==='analyze_economy') return report(runAnalysis(state));
 if(name==='undo_last_edit'){if(args.base_revision!==state.revision)throw new Error('The rulebook changed. Call get_rulebook before undoing the current edit.');return report(runAnalysis(undo(state)));}
 if(name==='replay_witness') {
  const next=state.receipt?.revision===state.revision?state:runAnalysis(state);
  return {...report(next),replay:next.receipt?.result.status==='found'};
 }
 if(!['set_initial_inventory','upsert_rule','remove_rule'].includes(name)) throw new Error('Unknown tool. Read the rulebook and use a supported tool.');
 if(args.base_revision!==state.revision) throw new Error('The rulebook changed. Call get_rulebook and retry using its current revision.');
 const next=structuredClone(state.scenario);let latestEdit:string|null=null;
 if(name==='set_initial_inventory') next.initial=args.inventory as Inventory;
 else {
  const index=args.index;
  if(typeof index!=='number' || !Number.isInteger(index) || index<1 || index>6 || index>next.rules.length+(name==='upsert_rule'?1:0)) throw new Error('Rule number is out of range. Read the rulebook for visible rule numbers.');
  if(name==='remove_rule') next.rules.splice(index-1,1);
  else {latestEdit=next.rules[index-1]?.id || freshRuleId(next.rules,state.revision+1,index);next.rules[index-1]={id:latestEdit,name:args.name as string,input:args.input as Inventory,output:args.output as Inventory};}
 }
 return report(runAnalysis(commit(state,next,latestEdit)));
}
