import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyze, applyRule, DEFAULT_LIMITS, MAX_QUANTITY, MAX_RULES,
  replayWitness, RESOURCES, validateScenario,
} from '../src/engine.ts';
import type { Inventory, Rule, Scenario, Step } from '../src/engine.ts';

const inv = (wood = 0, stone = 0, stars = 0): Inventory => ({ wood, stone, stars });
const rule = (id: string, input: Inventory, output: Inventory): Rule => ({ id, name: id, input, output });
const scenario = (initial: Inventory, rules: Rule[], title = 'Test economy'): Scenario => ({ title, initial, rules });
const canonical = (): Scenario => scenario(inv(2), [
  rule('sawmill', inv(2), inv(0, 1)),
  rule('market', inv(0, 1), inv(3)),
]);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

function assertCertificate(s: Scenario): void {
  const result = analyze(s);
  assert.equal(result.status, 'found');
  assert.notEqual(result.cycleStart, null);
  assert.ok(result.steps.length > result.cycleStart!);
  assert.equal(replayWitness(s, result.steps, result.cycleStart).valid, true);
  let current = result.steps.at(-1)!.after;
  // A proof is repeatable from its ending state, beyond the original trace.
  for (let iteration = 0; iteration < 3; iteration += 1) {
    for (const step of result.steps.slice(result.cycleStart!)) {
      const next = applyRule(current, s.rules.find(r => r.id === step.ruleId)!);
      assert.notEqual(next, null);
      current = next!;
    }
  }
  const end = result.steps.at(-1)!.after;
  for (const r of RESOURCES) assert.equal(current[r], end[r] + 3 * result.gain![r]);
}

test('exports the intended bounds and resource vocabulary', () => {
  assert.deepEqual(RESOURCES, ['wood', 'stone', 'stars']);
  assert.equal(MAX_QUANTITY, 9);
  assert.equal(MAX_RULES, 6);
  assert.deepEqual(DEFAULT_LIMITS, { maxDepth: 8, maxStates: 10_000, resourceCap: 30 });
  assert.ok(Object.isFrozen(DEFAULT_LIMITS));
});

test('canonical two-trade economy yields an exact repeatable growth witness', () => {
  const s = canonical();
  const result = analyze(s);
  assert.equal(result.status, 'found');
  assert.deepEqual(result.steps, [
    { ruleId: 'sawmill', before: inv(2), after: inv(0, 1) },
    { ruleId: 'market', before: inv(0, 1), after: inv(3) },
  ]);
  assert.equal(result.cycleStart, 0);
  assert.deepEqual(result.gain, inv(1));
  assert.equal(result.explored, 3);
  assert.deepEqual(result.hitLimits, []);
  assertCertificate(s);
});

test('keeps the one-time reachability prefix outside the repeatable suffix', () => {
  const s = canonical();
  s.initial = inv(0, 0, 1);
  s.rules.unshift(rule('unlock', inv(0, 0, 1), inv(2)));
  const result = analyze(s);
  assert.equal(result.status, 'found');
  assert.equal(result.cycleStart, 1);
  assert.deepEqual(result.steps.map(s => s.ruleId), ['unlock', 'sawmill', 'market']);
  assert.deepEqual(result.gain, inv(1));
  assertCertificate(s);
});

test('detects a one-rule growth loop and preserves catalytic inputs', () => {
  const s = scenario(inv(1, 0, 1), [rule('catalyst', inv(1, 0, 1), inv(2, 0, 1))]);
  const result = analyze(s);
  assert.equal(result.status, 'found');
  assert.equal(result.steps.length, 1);
  assert.deepEqual(result.gain, inv(1));
  assertCertificate(s);
});

test('accepts growth in multiple resources, including stars', () => {
  const s = scenario(inv(1), [rule('split', inv(1), inv(1, 1, 1))]);
  const result = analyze(s);
  assert.equal(result.status, 'found');
  assert.deepEqual(result.gain, inv(0, 1, 1));
  assertCertificate(s);
});

test('an inaccessible profitable rule cycle is not a reachable witness', () => {
  const s = canonical();
  s.initial = inv(0, 0, 1);
  const result = analyze(s);
  assert.equal(result.status, 'not_found');
  assert.equal(result.explored, 1);
  assert.deepEqual(result.steps, []);
  assert.equal(result.gain, null);
  assert.equal(result.cycleStart, null);
});

test('zero initial inventory cannot activate trades', () => {
  const s = canonical();
  s.initial = inv();
  assert.equal(analyze(s).status, 'not_found');
});

test('neutral cycles and identity trades are not growth', () => {
  const s = scenario(inv(2), [
    rule('there', inv(2), inv(0, 1)),
    rule('back', inv(0, 1), inv(2)),
    rule('identity', inv(1), inv(1)),
  ]);
  const result = analyze(s);
  assert.equal(result.status, 'not_found');
  assert.equal(result.explored, 2);
  assert.deepEqual(result.hitLimits, []);
});

test('higher total inventory is insufficient when a consumable is lost', () => {
  const s = scenario(inv(2, 0, 1), [
    rule('sawmill', inv(2), inv(0, 1)),
    rule('subsidized-market', inv(0, 1, 1), inv(5)),
  ]);
  const result = analyze(s);
  assert.equal(result.status, 'not_found');
  assert.equal(result.gain, null);
  assert.deepEqual(result.steps, []);
});

test('several finite subsidies still cannot masquerade as repeatable growth', () => {
  const s = scenario(inv(1, 0, 3), [rule('subsidy', inv(1, 0, 1), inv(2))]);
  assert.equal(analyze(s).status, 'not_found');
});

test('componentwise growth cannot be replaced with a favored-resource comparison', () => {
  const s = scenario(inv(1, 1), [rule('trade-away-stone', inv(1, 1), inv(3))]);
  assert.equal(analyze(s).status, 'not_found');
});

test('applyRule is atomic, affordable, nonmutating, and returns a fresh object', () => {
  const r = rule('trade', inv(2), inv(3));
  assert.equal(applyRule(inv(1), r), null);
  const initial = inv(2, 1, 1);
  const snapshot = clone(r);
  const next = applyRule(initial, r);
  assert.deepEqual(next, inv(3, 1, 1));
  assert.deepEqual(initial, inv(2, 1, 1));
  assert.deepEqual(r, snapshot);
  assert.notEqual(next, initial);
});

test('applyRule does not borrow its output to afford the input', () => {
  assert.equal(applyRule(inv(), rule('borrow', inv(1), inv(2))), null);
});

test('applyRule rejects negative, fractional, nonfinite, and oversized quantities', () => {
  const r = rule('ok', inv(1), inv(1));
  for (const value of [-1, 0.5, NaN, Infinity]) {
    assert.throws(() => applyRule(inv(value), r), TypeError);
  }
  assert.throws(() => applyRule(inv(1), rule('big', inv(1), inv(10))), TypeError);
  assert.throws(() => applyRule(inv(Number.MAX_SAFE_INTEGER), rule('overflow', inv(1), inv(2))), RangeError);
});

test('BFS and rule-order tie breaking are deterministic', () => {
  const s = scenario(inv(1), [
    rule('first', inv(1), inv(2)),
    rule('second', inv(1), inv(3)),
  ]);
  const first = analyze(s);
  for (let i = 0; i < 20; i += 1) assert.deepEqual(analyze(s), first);
  assert.equal(first.steps[0].ruleId, 'first');
  assert.equal(analyze({ ...s, rules: [...s.rules].reverse() }).steps[0].ruleId, 'second');
});

test('analysis never mutates the scenario or aliases returned inventories', () => {
  const s = canonical();
  const before = clone(s);
  const a = analyze(s);
  assert.deepEqual(s, before);
  a.steps[0].before.wood = 999;
  a.steps[0].after.stone = 999;
  a.limits.maxDepth = 0;
  assert.deepEqual(s, before);
  assert.deepEqual(analyze(s).steps[0], { ruleId: 'sawmill', before: inv(2), after: inv(0, 1) });
  assert.equal(DEFAULT_LIMITS.maxDepth, 8);
});

test('depth exhaustion is distinct from a completed bounded search', () => {
  const limited = analyze(canonical(), { maxDepth: 1 });
  assert.equal(limited.status, 'limit');
  assert.deepEqual(limited.hitLimits, ['depth']);
  assert.deepEqual(limited.steps, []);
  assert.equal(analyze(canonical(), { maxDepth: 2 }).status, 'found');
  const deadEnd = scenario(inv(1), [rule('one-way', inv(1), inv(0, 1))]);
  assert.equal(analyze(deadEnd, { maxDepth: 1 }).status, 'not_found');
});

test('depth zero reports only blocked novel transitions', () => {
  assert.deepEqual(analyze(canonical(), { maxDepth: 0 }).hitLimits, ['depth']);
  const identity = scenario(inv(1), [rule('same', inv(1), inv(1))]);
  assert.equal(analyze(identity, { maxDepth: 0 }).status, 'not_found');
  assert.equal(analyze(scenario(inv(), []), { maxDepth: 0 }).status, 'not_found');
});

test('resource cap is per-resource and prevents an out-of-cap certificate', () => {
  const s = scenario(inv(9), [rule('grow', inv(1), inv(9))]);
  const limited = analyze(s, { resourceCap: 9 });
  assert.equal(limited.status, 'limit');
  assert.deepEqual(limited.hitLimits, ['resourceCap']);
  assert.equal(limited.explored, 1);
  assert.equal(analyze(s, { resourceCap: 17 }).status, 'found');
  const sumAboveCap = scenario(inv(9, 9, 9), []);
  assert.equal(analyze(sumAboveCap, { resourceCap: 9 }).status, 'not_found');
});

test('an initial inventory outside the cap is explicitly limited', () => {
  const result = analyze(canonical(), { resourceCap: 1 });
  assert.equal(result.status, 'limit');
  assert.equal(result.explored, 0);
  assert.deepEqual(result.hitLimits, ['resourceCap']);
});

test('state budget includes the initial and proposed certificate endpoint', () => {
  const limited = analyze(canonical(), { maxStates: 2 });
  assert.equal(limited.status, 'limit');
  assert.equal(limited.explored, 2);
  assert.deepEqual(limited.hitLimits, ['states']);
  assert.equal(analyze(canonical(), { maxStates: 3 }).status, 'found');
  assert.equal(analyze(scenario(inv(1), []), { maxStates: 1 }).status, 'not_found');
});

test('negative reports never contain an invented certificate or global safety claim', () => {
  for (const result of [analyze(scenario(inv(), [])), analyze(canonical(), { maxStates: 1 })]) {
    assert.deepEqual(result.steps, []);
    assert.equal(result.cycleStart, null);
    assert.equal(result.gain, null);
    assert.ok(!('safe' in result));
    assert.ok(!('globallySafe' in result));
  }
});

test('invalid search limits fail explicitly rather than silently changing search', () => {
  for (const options of [
    { maxDepth: -1 }, { maxDepth: 1.5 }, { maxDepth: Infinity },
    { maxStates: 0 }, { maxStates: NaN }, { resourceCap: -1 }, { resourceCap: 1.2 },
  ]) assert.throws(() => analyze(canonical(), options), RangeError);
});

test('replay verifies the exact certificate and optional growth suffix', () => {
  const s = canonical();
  const result = analyze(s);
  assert.deepEqual(replayWitness(s, result.steps, result.cycleStart), { valid: true, final: inv(3), errors: [] });
  assert.deepEqual(replayWitness(s, []), { valid: true, final: inv(2), errors: [] });
  assert.equal(replayWitness(s, [], 0).valid, false);
});

test('replay rejects unknown rules and forged before/after inventories', () => {
  const s = canonical();
  const steps = analyze(s).steps;
  for (const mutate of [
    (a: Step[]) => { a[0].ruleId = 'missing'; },
    (a: Step[]) => { a[0].before.wood += 1; },
    (a: Step[]) => { a[0].after.wood += 1; },
    (a: Step[]) => { a[1].before.stone = 5; },
    (a: Step[]) => { a[1].after.wood = -1; },
  ]) {
    const changed = clone(steps);
    mutate(changed);
    assert.equal(replayWitness(s, changed).valid, false);
  }
});

test('replay rejects unaffordable rules and invalid cycle indices', () => {
  const s = canonical();
  const unaffordable = [{ ruleId: 'market', before: inv(2), after: inv(5) }];
  assert.equal(replayWitness(s, unaffordable).valid, false);
  const steps = analyze(s).steps;
  for (const index of [-1, 0.5, 2, Infinity, NaN]) assert.equal(replayWitness(s, steps, index).valid, false);
  assert.equal(replayWitness(s, steps, 1).valid, false); // stone is consumed in this suffix
});

test('replay accepts a neutral trace but rejects it as a growth certificate', () => {
  const s = scenario(inv(1), [rule('same', inv(1), inv(1))]);
  const steps = [{ ruleId: 'same', before: inv(1), after: inv(1) }];
  assert.equal(replayWitness(s, steps).valid, true);
  assert.equal(replayWitness(s, steps, 0).valid, false);
});

test('replay catches consumable false positives independently of the search', () => {
  const s = scenario(inv(1, 0, 1), [rule('spend-star', inv(1, 0, 1), inv(3))]);
  const steps = [{ ruleId: 'spend-star', before: inv(1, 0, 1), after: inv(3) }];
  assert.equal(replayWitness(s, steps).valid, true);
  assert.equal(replayWitness(s, steps, 0).valid, false);
});

test('replay returns the last verified inventory after a broken trace', () => {
  const s = canonical();
  const steps = analyze(s).steps;
  steps[1].after = inv(99);
  const result = replayWitness(s, steps);
  assert.equal(result.valid, false);
  assert.deepEqual(result.final, inv(0, 1));
});

test('valid JSON import round-trips, trims labels, and clones nested values', () => {
  const input = JSON.parse(JSON.stringify(canonical()));
  input.title = '  Example  ';
  input.rules[0].id = ' sawmill ';
  input.rules[0].name = '  Sawmill  ';
  const result = validateScenario(input);
  assert.equal(result.valid, true);
  if (!result.valid) return;
  assert.equal(result.scenario.title, 'Example');
  assert.equal(result.scenario.rules[0].id, 'sawmill');
  assert.equal(result.scenario.rules[0].name, 'Sawmill');
  result.scenario.initial.wood = 9;
  assert.equal(input.initial.wood, 2);
  const roundTrip = validateScenario(JSON.parse(JSON.stringify(canonical())));
  assert.ok(roundTrip.valid);
  assert.equal(analyze(roundTrip.scenario).status, 'found');
});

test('empty rule sets and all-zero initial inventory are valid imports', () => {
  assert.equal(validateScenario(scenario(inv(), [])).valid, true);
});

test('rejects invalid JSON shapes and unsupported fields', () => {
  for (const value of [null, [], 'scenario', 12, {}, { ...canonical(), extra: true }]) {
    assert.equal(validateScenario(value).valid, false);
  }
  for (const mutate of [
    (s: any) => { s.title = ''; },
    (s: any) => { s.initial = []; },
    (s: any) => { delete s.initial.stars; },
    (s: any) => { s.initial.gold = 0; },
    (s: any) => { s.rules = {}; },
    (s: any) => { s.rules[0] = null; },
    (s: any) => { s.rules[0].name = ' '; },
    (s: any) => { s.rules[0].id = 1; },
    (s: any) => { s.rules[0].extra = true; },
    (s: any) => { s.rules[0].input = { wood: 2, stone: 0 }; },
  ]) {
    const s = clone(canonical());
    mutate(s);
    assert.equal(validateScenario(s).valid, false, JSON.stringify(s));
  }
});

test('rejects invalid quantity types and bounds on every inventory location', () => {
  for (const invalid of [-1, 10, 0.5, '2', null, false, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    for (const location of ['initial', 'input', 'output']) {
      const s = clone(canonical()) as any;
      const target = location === 'initial' ? s.initial : s.rules[0][location];
      target.wood = invalid;
      assert.equal(validateScenario(s).valid, false, `${location}: ${String(invalid)}`);
    }
  }
});

test('rejects all-zero rule inputs and outputs while accepting zero components', () => {
  for (const r of [rule('free', inv(), inv(1)), rule('burn', inv(1), inv()), rule('empty', inv(), inv())]) {
    assert.equal(validateScenario(scenario(inv(), [r])).valid, false);
  }
  assert.equal(validateScenario(canonical()).valid, true);
});

test('rejects duplicate rule IDs, including duplicates after trimming', () => {
  for (const id of ['sawmill', ' sawmill ']) {
    const s = canonical();
    s.rules[1].id = id;
    assert.equal(validateScenario(s).valid, false);
  }
});

test('allows six rules and rejects a seventh', () => {
  const rules = Array.from({ length: 7 }, (_, i) => rule(String(i), inv(1), inv(1)));
  assert.equal(validateScenario(scenario(inv(1), rules.slice(0, 6))).valid, true);
  assert.equal(validateScenario(scenario(inv(1), rules)).valid, false);
});

test('analyze rejects invalid scenarios rather than producing a misleading result', () => {
  const s = canonical();
  s.rules[0].input.wood = -1;
  assert.throws(() => analyze(s), TypeError);
  assert.equal(replayWitness(s, []).valid, false);
});

test('prototype-inherited resource fields are not accepted as JSON data', () => {
  const s = canonical();
  s.initial = Object.create(inv(2));
  assert.equal(validateScenario(s).valid, false);
});

// Exhaustive finite-domain checks supplement the named regressions above.
// Enumerate every two-rule economy where an input is one wood or one stone,
// and output is one or two wood or stone, from all 0..2 initial amounts.
test('exhaustive small economies: every found witness replays and repeats exactly', () => {
  const sides = [inv(1), inv(2), inv(0, 1), inv(0, 2)];
  const possibilities: Rule[] = [];
  for (const input of [inv(1), inv(0, 1)]) {
    for (const output of sides) possibilities.push(rule('template', input, output));
  }
  function exhaustiveReference(s: Scenario): boolean {
    const paths: Inventory[][] = [[s.initial]];
    for (let i = 0; i < paths.length; i += 1) {
      const path = paths[i];
      if (path.length > 4) continue;
      const before = path.at(-1)!;
      for (const r of s.rules) {
        if (RESOURCES.some(k => before[k] < r.input[k])) continue;
        const after = inv();
        for (const k of RESOURCES) after[k] = before[k] - r.input[k] + r.output[k];
        if (path.some(ancestor => RESOURCES.every(k => after[k] >= ancestor[k]) && RESOURCES.some(k => after[k] > ancestor[k]))) return true;
        paths.push([...path, after]);
      }
    }
    return false;
  }
  let found = 0;
  let checked = 0;
  for (const a of possibilities) for (const b of possibilities) {
    for (let wood = 0; wood <= 2; wood += 1) for (let stone = 0; stone <= 2; stone += 1) {
      const s = scenario(inv(wood, stone), [{ ...a, id: 'a' }, { ...b, id: 'b' }]);
      const result = analyze(s, { maxDepth: 4, maxStates: 1000, resourceCap: 12 });
      assert.equal(result.status === 'found', exhaustiveReference(s), JSON.stringify(s));
      assert.ok(result.explored <= 1000);
      assert.ok(result.steps.length <= 4);
      if (result.status === 'found') {
        found += 1;
        assert.equal(replayWitness(s, result.steps, result.cycleStart).valid, true, JSON.stringify(s));
        let current = result.steps.at(-1)!.after;
        for (const step of result.steps.slice(result.cycleStart!)) {
          current = applyRule(current, s.rules.find(r => r.id === step.ruleId)!)!;
          assert.ok(current);
        }
        for (const r of RESOURCES) assert.equal(current[r], result.steps.at(-1)!.after[r] + result.gain![r]);
      } else {
        assert.equal(result.gain, null);
        assert.equal(result.cycleStart, null);
      }
      checked += 1;
    }
  }
  assert.equal(checked, 576);
  assert.ok(found > 100);
});


test('a valid certificate still wins when a different branch hits a cap', () => {
  const s = scenario(inv(1), [
    rule('too-large', inv(1), inv(9)),
    rule('within-cap', inv(1), inv(2)),
  ]);
  const result = analyze(s, { resourceCap: 5 });
  assert.equal(result.status, 'found');
  assert.deepEqual(result.hitLimits, ['resourceCap']);
  assert.deepEqual(result.steps.map(step => step.ruleId), ['within-cap']);
  assert.equal(replayWitness(s, result.steps, result.cycleStart).valid, true);
});

test('sparse rule arrays are rejected instead of causing a search crash', () => {
  const s = canonical();
  s.rules = new Array(2);
  assert.equal(validateScenario(s).valid, false);
  assert.throws(() => analyze(s), TypeError);
});
