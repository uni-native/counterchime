import test from 'node:test';import assert from 'node:assert/strict';import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {Evidence} from '../src/components/Evidence.tsx';import {VoiceWorkbench} from '../src/components/VoiceWorkbench.tsx';import {runAnalysis,newSession} from '../src/session.ts';import {EXAMPLES} from '../src/scenarios.ts';import {freshRuleId} from '../src/rule-id.ts';
const noop=()=>{};
test('offline render: every replay step has a keyboard-operable button and table caption',()=>{
 const state=runAnalysis(newSession(EXAMPLES[0].scenario));const html=renderToStaticMarkup(createElement(Evidence,{receipt:state.receipt,revision:1,replayStep:0,onReplay:noop,onSelectStep:noop,playing:false}));
 assert.match(html,/aria-label="Show starting inventory"/);assert.match(html,/aria-label="Show replay step 1"/);assert.match(html,/aria-label="Show replay step 2"/);assert.match(html,/<caption/);assert.match(html,/\+1 wood/);
});
test('offline render: disabled live voice explains its status and exposes recheck',()=>{
 const html=renderToStaticMarkup(createElement(VoiceWorkbench,{configured:false,status:'idle',detail:'',transcripts:[],onStart:noop,onStop:noop,onLocalCommand:noop,onFixture:noop,setupMessage:'Owner-approved setup and a session budget are required.',checkingVoice:false,onCheckVoice:noop}));
 assert.match(html,/disabled="" aria-describedby="voice-availability"/);assert.match(html,/Owner-approved setup/);assert.match(html,/Recheck voice setup/);assert.match(html,/local parser/);
});
test('fresh IDs avoid every occupied suffix without mutating rule identities',()=>{
 const template=EXAMPLES[0].scenario.rules[0];const rules=['trade-2-3','trade-2-3-2','trade-2-3-3'].map(id=>({...template,id}));assert.equal(freshRuleId(rules,2,3),'trade-2-3-4');assert.equal(rules[0].id,'trade-2-3');
});

test('offline render: one-session key form is absent by default and never has a key value/name',()=>{
 const props={configured:false,status:'idle' as const,detail:'',transcripts:[],onStart:noop,onStop:noop,onLocalCommand:noop,onFixture:noop,setupMessage:'Disabled',checkingVoice:false,onCheckVoice:noop,onKeySession:noop,onKeyError:noop};
 const disabled=renderToStaticMarkup(createElement(VoiceWorkbench,props));assert.doesNotMatch(disabled,/type="password"/);
 const allowed=renderToStaticMarkup(createElement(VoiceWorkbench,{...props,sessionKeyAllowed:true}));assert.match(allowed,/type="password"/);assert.match(allowed,/autoComplete="off"/);assert.doesNotMatch(allowed,/id="session-key"[^>]*(?:name=|value=)/);assert.match(allowed,/Two attempts maximum/);
});
test('offline render: active session-only voice does not falsely say voice is disabled',()=>{
 const html=renderToStaticMarkup(createElement(VoiceWorkbench,{configured:false,sessionKeyAllowed:true,status:'listening',detail:'',transcripts:[],onStart:noop,onStop:noop,onLocalCommand:noop,onFixture:noop,setupMessage:'Authorized',checkingVoice:false,onCheckVoice:noop,onKeySession:noop,onKeyError:noop}));
 assert.doesNotMatch(html,/Live voice is not enabled/);assert.match(html,/End voice session/);assert.doesNotMatch(html,/type="password"/);
});
