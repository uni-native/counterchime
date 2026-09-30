import test from 'node:test';import assert from 'node:assert/strict';
import {newSession,runAnalysis,commit,undo,toolAction,exportSession,importScenario} from '../src/session.ts';import {EXAMPLES} from '../src/scenarios.ts';import {localCommand} from '../src/local-command.ts';
const fresh=()=>runAnalysis(newSession(EXAMPLES[0].scenario));
test('voice correction changes one output and returns recomputed evidence',()=>{const before=fresh();const after=toolAction(before,'upsert_rule',{index:2,name:'Timber trade',input:{wood:0,stone:1,stars:0},output:{wood:2,stone:0,stars:0},base_revision:1}).state;assert.equal(after.revision,2);assert.equal(after.receipt?.result.status,'not_found');assert.deepEqual(after.scenario.rules[0],before.scenario.rules[0]);assert.equal(before.scenario.rules[1].output.wood,3);});
test('manual edits retain evidence but mark a distinct revision; undo restores',()=>{const before=fresh();const changed=structuredClone(before.scenario);changed.rules[1].output.wood=2;const after=commit(before,changed);assert.equal(after.receipt?.revision,1);assert.equal(after.revision,2);const restored=runAnalysis(undo(after));assert.deepEqual(restored.scenario,before.scenario);assert.equal(restored.revision,3);assert.equal(restored.receipt?.result.status,'found');});
test('no-op edit does not add revision or history',()=>{const before=fresh();assert.equal(commit(before,before.scenario),before);});
test('stale voice mutations rejected without changes',()=>{const before=fresh();assert.throws(()=>toolAction(before,'remove_rule',{index:1,base_revision:0}),/changed/);assert.equal(before.scenario.rules.length,2);});
test('invalid and unknown tool intents fail without state mutation',()=>{const before=fresh();assert.throws(()=>toolAction(before,'unsupported',{}));assert.throws(()=>toolAction(before,'upsert_rule',{index:6,base_revision:1}));assert.throws(()=>toolAction(before,'set_initial_inventory',{inventory:{wood:-1,stone:0,stars:0},base_revision:1}));assert.deepEqual(before.scenario,EXAMPLES[0].scenario);});
test('local repair/test/undo is explicit deterministic parser',()=>{let state=fresh();state=localCommand(state,'Change the second rule to two wood').state;assert.equal(state.receipt?.result.status,'not_found');state=localCommand(state,'undo').state;assert.equal(state.receipt?.result.status,'found');assert.throws(()=>localCommand(state,'play a random game'),/local parser/);});
test('export receipt round-trips and flags stale certificates',()=>{const state=fresh();const exported=exportSession(state);assert.equal(exported.evidence?.verified,true);assert.equal(exported.evidence?.loop.length,2);assert.equal(exported.evidence?.current,true);assert.deepEqual(importScenario(JSON.parse(JSON.stringify(exported))),state.scenario);const changed=structuredClone(state.scenario);changed.initial.wood=3;assert.equal(exportSession(commit(state,changed)).evidence?.current,false);});
test('import does not trust supplied receipt or unsupported mechanics',()=>{assert.throws(()=>importScenario({scenario:{...EXAMPLES[0].scenario,cooldown:3}}));const value=importScenario({scenario:EXAMPLES[0].scenario,evidence:{verified:true,anything:'untrusted'}});assert.deepEqual(value,EXAMPLES[0].scenario);});

test('new rule IDs remain unique after delete and reload reset revisions',()=>{
 let state=fresh();const newTrade={index:3,name:'Extra',input:{wood:1,stone:0,stars:0},output:{wood:0,stone:1,stars:0},base_revision:state.revision};
 state=toolAction(state,'upsert_rule',newTrade).state;
 state=toolAction(state,'remove_rule',{index:1,base_revision:state.revision}).state;
 state=newSession(state.scenario); // Same rulebook, new browser session/revision.
 const existingIds=state.scenario.rules.map(rule=>rule.id);
 state=toolAction(state,'upsert_rule',{...newTrade,base_revision:state.revision}).state;
 assert.equal(new Set(state.scenario.rules.map(rule=>rule.id)).size,3);
 assert.deepEqual(state.scenario.rules.slice(0,2).map(rule=>rule.id),existingIds);
});
test('tool dispatch rejects extra mechanics rather than silently dropping them',()=>{
 const state=fresh();assert.throws(()=>toolAction(state,'upsert_rule',{index:2,name:'Unsupported',input:{wood:0,stone:1,stars:0},output:{wood:3,stone:0,stars:0},base_revision:1,cooldown:5}),/Unsupported tool fields/);
 assert.throws(()=>toolAction(state,'analyze_economy',{randomness:true}),/Unsupported tool fields/);
 assert.equal(state.revision,1);
});
test('voice undo rejects a stale revision and preserves the newer edit',()=>{
 const before=fresh();const changed=structuredClone(before.scenario);changed.rules[1].output.wood=2;const current=commit(before,changed);
 assert.throws(()=>toolAction(current,'undo_last_edit',{base_revision:before.revision}),/changed/);
 assert.throws(()=>toolAction(current,'undo_last_edit',{}),/changed/);
 assert.equal(current.scenario.rules[1].output.wood,2);
 const undone=toolAction(current,'undo_last_edit',{base_revision:current.revision}).state;
 assert.equal(undone.scenario.rules[1].output.wood,3);
});
test('three-resource voice repair targets third rule and undo restores exact witness',()=>{const before=runAnalysis(newSession(EXAMPLES.find(x=>x.id==='three')!.scenario));assert.equal(before.receipt?.result.status,'found');const fixed=toolAction(before,'upsert_rule',{index:3,name:'Timber trade',input:{wood:0,stone:0,stars:1},output:{wood:2,stone:0,stars:0},base_revision:before.revision}).state;assert.deepEqual(fixed.scenario.rules.slice(0,2),before.scenario.rules.slice(0,2));assert.equal(fixed.receipt?.result.status,'not_found');const restored=toolAction(fixed,'undo_last_edit',{base_revision:fixed.revision}).state;assert.equal(restored.receipt?.result.status,'found');assert.equal(exportSession(restored).evidence?.loop.length,3);});
