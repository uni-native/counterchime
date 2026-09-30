/**
 * Counterchime's deterministic, bounded exchange-rule search.
 *
 * A certificate is a reachable path ending in a nonempty self-covering suffix:
 * every resource at the end of that suffix is at least its starting amount,
 * and at least one is greater. Because rules have only nonnegative input
 * requirements, the same suffix remains executable after its gain is added.
 *
 * No unsuccessful result is a claim of global mathematical safety. Exact
 * inventory deduplication keeps a deterministic BFS tree; it does not promise
 * a globally shortest growth cycle or enumerate every possible history.
 */
export const RESOURCES = ['wood', 'stone', 'stars'] as const;
export type Resource = (typeof RESOURCES)[number];
export type Inventory = Record<Resource, number>;
export interface Rule {
  id: string;
  name: string;
  input: Inventory;
  output: Inventory;
}
export interface Scenario {
  title: string;
  initial: Inventory;
  rules: Rule[];
}
export interface Step {
  ruleId: string;
  before: Inventory;
  after: Inventory;
}
export interface SearchLimits {
  maxDepth: number;
  maxStates: number;
  resourceCap: number;
}
export type LimitKind = 'depth' | 'states' | 'resourceCap';
export interface AnalysisResult {
  status: 'found' | 'not_found' | 'limit';
  /** Number of distinct inventory states admitted, including the initial one. */
  explored: number;
  limits: SearchLimits;
  hitLimits: LimitKind[];
  /** Includes the path to the loop. The repeating suffix starts at cycleStart. */
  steps: Step[];
  cycleStart: number | null;
  /** Net gain of the repeating suffix, not its final inventory. */
  gain: Inventory | null;
}
export type ValidationResult =
  | { valid: true; scenario: Scenario }
  | { valid: false; errors: string[] };
export interface ReplayResult {
  valid: boolean;
  final: Inventory;
  errors: string[];
}
export const MAX_RULES = 6;
export const MAX_QUANTITY = 9;
export const DEFAULT_LIMITS: Readonly<SearchLimits> = Object.freeze({
  maxDepth: 8,
  maxStates: 10_000,
  resourceCap: 30,
});

const zero = (): Inventory => ({ wood: 0, stone: 0, stars: 0 });
const copy = (v: Inventory): Inventory => ({ wood: v.wood, stone: v.stone, stars: v.stars });
const key = (v: Inventory): string => `${v.wood},${v.stone},${v.stars}`;
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const has = (v: Record<string, unknown>, name: string): boolean =>
  Object.prototype.hasOwnProperty.call(v, name);

function checkKeys(value: Record<string, unknown>, allowed: readonly string[], path: string, errors: string[]): void {
  for (const name of Object.keys(value)) {
    if (!allowed.includes(name)) errors.push(`${path}.${name} is not a supported field`);
  }
}

function checkInventory(value: unknown, path: string, max: number, errors: string[]): value is Inventory {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object with wood, stone, and stars`);
    return false;
  }
  const start = errors.length;
  checkKeys(value, RESOURCES, path, errors);
  for (const resource of RESOURCES) {
    const amount = value[resource];
    if (!has(value, resource) || typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0 || amount > max) {
      errors.push(`${path}.${resource} must be an integer from 0 to ${max}`);
    }
  }
  return errors.length === start;
}

function checkRule(value: unknown, path: string, errors: string[]): value is Rule {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return false;
  }
  const start = errors.length;
  checkKeys(value, ['id', 'name', 'input', 'output'], path, errors);
  for (const field of ['id', 'name'] as const) {
    if (!has(value, field) || typeof value[field] !== 'string' || value[field].trim().length === 0) {
      errors.push(`${path}.${field} must be a nonempty string`);
    }
  }
  for (const side of ['input', 'output'] as const) {
    if (checkInventory(value[side], `${path}.${side}`, MAX_QUANTITY, errors)) {
      if (!RESOURCES.some(resource => (value[side] as Inventory)[resource] > 0)) {
        errors.push(`${path}.${side} must contain at least one positive quantity`);
      }
    }
  }
  return errors.length === start;
}

/** Validate untrusted parsed JSON. Does not coerce strings or mutate the input. */
export function validateScenario(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { valid: false, errors: ['Scenario must be an object'] };
  checkKeys(value, ['title', 'initial', 'rules'], 'Scenario', errors);
  if (!has(value, 'title') || typeof value.title !== 'string' || value.title.trim().length === 0) {
    errors.push('Scenario.title must be a nonempty string');
  }
  checkInventory(value.initial, 'Scenario.initial', MAX_QUANTITY, errors);
  if (!Array.isArray(value.rules)) {
    errors.push('Scenario.rules must be an array');
  } else {
    if (value.rules.length > MAX_RULES) errors.push(`Scenario.rules must contain no more than ${MAX_RULES} rules`);
    const ids = new Set<string>();
    for (let index = 0; index < value.rules.length; index += 1) {
      const rule = value.rules[index];
      checkRule(rule, `Scenario.rules[${index}]`, errors);
      if (isRecord(rule) && typeof rule.id === 'string') {
        const id = rule.id.trim();
        if (ids.has(id)) errors.push(`Scenario.rules[${index}].id must be unique`);
        ids.add(id);
      }
    }
  }
  if (errors.length) return { valid: false, errors };
  const scenario = value as unknown as Scenario;
  return {
    valid: true,
    scenario: {
      title: scenario.title.trim(),
      initial: copy(scenario.initial),
      rules: scenario.rules.map(rule => ({
        id: rule.id.trim(),
        name: rule.name.trim(),
        input: copy(rule.input),
        output: copy(rule.output),
      })),
    },
  };
}

function checkedScenario(value: unknown): Scenario {
  const validation = validateScenario(value);
  if (!validation.valid) throw new TypeError(validation.errors.join('; '));
  return validation.scenario;
}

function applyUnchecked(inventory: Inventory, rule: Rule): Inventory | null {
  if (RESOURCES.some(resource => inventory[resource] < rule.input[resource])) return null;
  const next = zero();
  for (const resource of RESOURCES) {
    next[resource] = inventory[resource] - rule.input[resource] + rule.output[resource];
    if (!Number.isSafeInteger(next[resource])) throw new RangeError('Inventory exceeds safe integer precision');
  }
  return next;
}

/** Apply a trade atomically. null means its complete input cannot be afforded. */
export function applyRule(inventory: Inventory, rule: Rule): Inventory | null {
  const errors: string[] = [];
  checkInventory(inventory, 'Inventory', Number.MAX_SAFE_INTEGER, errors);
  checkRule(rule, 'Rule', errors);
  if (errors.length) throw new TypeError(errors.join('; '));
  return applyUnchecked(inventory, rule);
}

function growth(from: Inventory, to: Inventory): Inventory | null {
  const gain = zero();
  let positive = false;
  for (const resource of RESOURCES) {
    gain[resource] = to[resource] - from[resource];
    if (gain[resource] < 0) return null;
    if (gain[resource] > 0) positive = true;
  }
  return positive ? gain : null;
}

function checkedLimits(options: Partial<SearchLimits>): SearchLimits {
  const limits = { ...DEFAULT_LIMITS, ...options };
  for (const name of ['maxDepth', 'maxStates', 'resourceCap'] as const) {
    if (!Number.isSafeInteger(limits[name]) || limits[name] < (name === 'maxStates' ? 1 : 0)) {
      throw new RangeError(`${name} must be a safe integer >= ${name === 'maxStates' ? 1 : 0}`);
    }
  }
  return limits;
}

interface SearchNode {
  inventory: Inventory;
  parent: number | null;
  ruleId: string | null;
  depth: number;
}

function trace(nodes: SearchNode[], index: number, ruleId: string, after: Inventory): Step[] {
  const steps: Step[] = [{ ruleId, before: copy(nodes[index].inventory), after: copy(after) }];
  let node = nodes[index];
  while (node.parent !== null) {
    const parent = nodes[node.parent];
    steps.push({ ruleId: node.ruleId!, before: copy(parent.inventory), after: copy(node.inventory) });
    node = parent;
  }
  return steps.reverse();
}

/**
 * BFS in the user's rule order. Ancestors are compared nearest first. A found
 * witness is exact and repeatable; a negative result is only a bounded search
 * result. Per-resource caps apply to every admitted inventory, including the
 * start. A boundary is reported only when it actually prevents exploration.
 */
export function analyze(scenario: Scenario, options: Partial<SearchLimits> = {}): AnalysisResult {
  const validated = checkedScenario(scenario);
  const limits = checkedLimits(options);
  const hit = new Set<LimitKind>();
  const result = (status: AnalysisResult['status'], explored: number, steps: Step[] = [], cycleStart: number | null = null, gain: Inventory | null = null): AnalysisResult => ({
    status,
    explored,
    limits: { ...limits },
    hitLimits: (['depth', 'states', 'resourceCap'] as const).filter(name => hit.has(name)),
    steps,
    cycleStart,
    gain,
  });
  if (RESOURCES.some(resource => validated.initial[resource] > limits.resourceCap)) {
    hit.add('resourceCap');
    return result('limit', 0);
  }
  const nodes: SearchNode[] = [{ inventory: validated.initial, parent: null, ruleId: null, depth: 0 }];
  const seen = new Set([key(validated.initial)]);
  for (let head = 0; head < nodes.length; head += 1) {
    const current = nodes[head];
    for (const rule of validated.rules) {
      const next = applyUnchecked(current.inventory, rule);
      if (next === null) continue;
      const nextKey = key(next);
      const novel = !seen.has(nextKey);
      if (current.depth >= limits.maxDepth) {
        if (novel) hit.add('depth');
        continue;
      }
      if (RESOURCES.some(resource => next[resource] > limits.resourceCap)) {
        hit.add('resourceCap');
        continue;
      }
      if (novel && nodes.length >= limits.maxStates) {
        hit.add('states');
        continue;
      }
      // A repeated inventory may still close a growth witness along this path,
      // so compare ancestors before deduplicating the successor.
      for (let ancestor: number | null = head; ancestor !== null; ancestor = nodes[ancestor].parent) {
        const gain = growth(nodes[ancestor].inventory, next);
        if (gain !== null) {
          return result('found', nodes.length + (novel ? 1 : 0), trace(nodes, head, rule.id, next), nodes[ancestor].depth, gain);
        }
      }
      if (novel) {
        seen.add(nextKey);
        nodes.push({ inventory: next, parent: head, ruleId: rule.id, depth: current.depth + 1 });
      }
    }
  }
  return result(hit.size ? 'limit' : 'not_found', nodes.length);
}

/**
 * Independently replay every claimed before/after inventory. If cycleStart is
 * supplied, also require a nonempty componentwise-growth suffix. On failure,
 * final is the last inventory successfully verified, never an invented state.
 */
export function replayWitness(scenario: Scenario, steps: readonly Step[], cycleStart?: number | null): ReplayResult {
  const validation = validateScenario(scenario);
  if (!validation.valid) return { valid: false, final: zero(), errors: validation.errors };
  let current = copy(validation.scenario.initial);
  const fail = (message: string): ReplayResult => ({ valid: false, final: copy(current), errors: [message] });
  if (!Array.isArray(steps)) return fail('Witness steps must be an array');
  const rules = new Map(validation.scenario.rules.map(rule => [rule.id, rule]));
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    if (!isRecord(step)) return fail(`Step ${index + 1} must be an object`);
    const errors: string[] = [];
    checkKeys(step, ['ruleId', 'before', 'after'], `Step ${index + 1}`, errors);
    if (!checkInventory(step.before, `Step ${index + 1}.before`, Number.MAX_SAFE_INTEGER, errors)
      || !checkInventory(step.after, `Step ${index + 1}.after`, Number.MAX_SAFE_INTEGER, errors)
      || errors.length) return fail(errors.join('; '));
    if (key(step.before) !== key(current)) return fail(`Step ${index + 1} does not start at the current inventory`);
    const rule = typeof step.ruleId === 'string' ? rules.get(step.ruleId) : undefined;
    if (!rule) return fail(`Step ${index + 1} refers to an unknown rule`);
    const next = applyUnchecked(current, rule);
    if (next === null) return fail(`Step ${index + 1} cannot afford the rule's input`);
    if (key(step.after) !== key(next)) return fail(`Step ${index + 1} has an incorrect resulting inventory`);
    current = next;
  }
  if (cycleStart !== undefined && cycleStart !== null) {
    if (!Number.isSafeInteger(cycleStart) || cycleStart < 0 || cycleStart >= steps.length) {
      return fail('Cycle start must identify a step in a nonempty witness');
    }
    if (!growth(steps[cycleStart].before, current)) return fail('Cycle must preserve every resource and strictly increase at least one');
  }
  return { valid: true, final: copy(current), errors: [] };
}
