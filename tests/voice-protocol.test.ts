/** Synthetic protocol/worklet tests only. These never contact AssemblyAI or request a token. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { ToolCallState, type VoiceEvent } from '../src/voice-protocol';

const call = (id = 'a'): VoiceEvent => ({ type: 'tool.call', call_id: id, name: 'set_scene', arguments: { scene: 'rain' } });
const started = (id = 'a'): VoiceEvent => ({ type: 'reply.started', reply_id: `fc-${id}` });
const done = (id = 'a', status = 'completed'): VoiceEvent => ({ type: 'reply.done', reply_id: `fc-${id}`, status });

test('synthetic: stages an intent; only the matching completed reply releases it', () => {
  const state = new ToolCallState();
  assert.deepEqual(state.consume(started()), []);
  assert.deepEqual(state.consume(call()), []);
  assert.deepEqual(state.consume({ type: 'reply.audio', data: 'AAAA' }), []);
  assert.deepEqual(state.consume(done()), [{ callId: 'a', name: 'set_scene', arguments: { scene: 'rain' }, replyId: 'fc-a' }]);
});

test('synthetic: call before reply.started is safely staged', () => {
  const state = new ToolCallState();
  assert.deepEqual(state.consume(call()), []);
  state.consume(started());
  assert.equal(state.consume(done()).length, 1);
});

test('synthetic: repeated tool.call and reply.done never repeat a mutation', () => {
  const state = new ToolCallState();
  state.consume(started());
  state.consume(call());
  state.consume(call());
  assert.equal(state.consume(done()).length, 1);
  assert.deepEqual(state.consume(done()), []);
  assert.deepEqual(state.consume(call()), []);
  state.consume(started('b'));
  state.consume(call());
  assert.deepEqual(state.consume(done('b')), []);
});

test('synthetic: interrupted reply discards intent permanently', () => {
  const state = new ToolCallState();
  state.consume(started());
  state.consume(call());
  assert.deepEqual(state.consume(done('a', 'interrupted')), []);
  assert.deepEqual(state.consume(done()), []);
  assert.deepEqual(state.consume(call()), []);
});

test('synthetic: speech invalidates intent even if a stale completed event follows', () => {
  const state = new ToolCallState();
  state.consume(started());
  state.consume(call());
  state.consume({ type: 'input.speech.started' });
  assert.deepEqual(state.consume(done()), []);
  state.consume(started('b'));
  state.consume(call('b'));
  assert.equal(state.consume(done('b')).length, 1);
});

test('synthetic: superseding reply prevents stale tool commits', () => {
  const state = new ToolCallState();
  state.consume(started());
  state.consume(call());
  state.consume(started('b'));
  state.consume(call('b'));
  assert.deepEqual(state.consume(done()), []);
  assert.equal(state.consume(done('b')).length, 1);
});

test('synthetic: an old interrupted event does not discard a newer reply intent', () => {
  const state = new ToolCallState();
  state.consume(started('b'));
  state.consume(call('b'));
  state.consume(done('a', 'interrupted'));
  assert.equal(state.consume(done('b')).length, 1);
});

test('synthetic: a late call after completion cannot borrow a later completion', () => {
  const state = new ToolCallState();
  state.consume(started());
  state.consume(done());
  state.consume(call());
  state.consume(started('b'));
  assert.deepEqual(state.consume(done('b')), []);
  assert.deepEqual(state.consume(done()), []);
});

test('synthetic: malformed or unknown reply completion cannot authorize mutations', () => {
  const state = new ToolCallState();
  state.consume(started());
  state.consume(call());
  assert.deepEqual(state.consume({ type: 'reply.done', status: 'completed' }), []);
  assert.deepEqual(state.consume(done('unrelated')), []);
  assert.deepEqual(state.consume(done('a', 'failed')), []);
  assert.deepEqual(state.consume(done()), []);
});

test('synthetic: missing/non-object arguments do not reach application code', () => {
  for (const args of [null, [], 'json', undefined]) {
    const state = new ToolCallState();
    state.consume(started());
    state.consume({ ...call(), arguments: args });
    assert.deepEqual(state.consume(done()), []);
  }
});

test('synthetic: session end, errors, and local close invalidate pending work', () => {
  for (const type of ['session.ended', 'session.error', 'error', 'local']) {
    const state = new ToolCallState();
    state.consume(started());
    state.consume(call());
    if (type === 'local') state.close(); else state.consume({ type });
    assert.deepEqual(state.consume(done()), []);
    state.consume(started('b'));
    state.consume(call('b'));
    assert.deepEqual(state.consume(done('b')), []);
  }
});

interface SyntheticWorklet {
  process(inputs: Float32Array[][]): boolean;
  nextSourcePosition: number;
  chunkSamples: number;
}

function makeWorklet(rate: number): { processor: SyntheticWorklet; chunks: ArrayBuffer[] } {
  const chunks: ArrayBuffer[] = [];
  let Constructor: (new (options: unknown) => SyntheticWorklet) | undefined;
  class FakeAudioWorkletProcessor {
    port = { postMessage: (chunk: ArrayBuffer) => chunks.push(chunk.slice(0)) };
  }
  runInNewContext(readFileSync(new URL('../public/pcm-capture.js', import.meta.url), 'utf8'), {
    AudioWorkletProcessor: FakeAudioWorkletProcessor,
    sampleRate: rate,
    registerProcessor: (_name: string, value: typeof Constructor) => { Constructor = value; },
    ArrayBuffer, DataView, Math,
  });
  assert.ok(Constructor);
  return { processor: new Constructor({ processorOptions: { inputSampleRate: rate } }), chunks };
}

test('synthetic: worklet maintains 24 kHz fractional phase across 44.1 kHz blocks', () => {
  const { processor, chunks } = makeWorklet(44_100);
  const blocks = 400;
  let inputFrames = 0;
  for (let b = 0; b < blocks; b++) {
    const samples = Float32Array.from({ length: 128 }, (_, i) => Math.sin((inputFrames + i) * Math.PI * 2 * 300 / 44_100));
    processor.process([[samples]]);
    inputFrames += samples.length;
  }
  const emitted = chunks.length * 480 + processor.chunkSamples;
  const expected = Math.ceil((inputFrames - 1) * 24_000 / 44_100);
  assert.ok(Math.abs(emitted - expected) <= 1, `emitted ${emitted}; expected approximately ${expected}`);
  // Also check boundary interpolation rather than only the aggregate sample count.
  const values = chunks.flatMap((chunk) => {
    const view = new DataView(chunk);
    return Array.from({ length: 480 }, (_, i) => view.getInt16(i * 2, true) / 32768);
  });
  for (let i = 0; i < values.length; i += 17) {
    const ideal = Math.sin(i * Math.PI * 2 * 300 / 24_000);
    assert.ok(Math.abs(values[i] - ideal) < 0.001);
  }
});

test('synthetic: worklet downmixes channels and emits signed little-endian PCM16', () => {
  const { processor, chunks } = makeWorklet(48_000);
  for (let i = 0; i < 8; i++) processor.process([[new Float32Array(128).fill(-1), new Float32Array(128).fill(0)]]);
  assert.equal(chunks.length, 1);
  const data = new DataView(chunks[0]);
  assert.equal(data.getInt16(0, true), -16_384);
  assert.equal(data.getUint8(0), 0);
  assert.equal(data.getUint8(1), 192);
});

// Synthetic browser doubles exercise cleanup without accessing a microphone,
// asking for permissions, minting a token, or opening a network connection.
import { VoiceClient, type VoiceStatus, type VoiceTranscript } from '../src/voice';

class FakeNode {
  disconnected = false;
  connect(node: FakeNode): FakeNode { return node; }
  disconnect(): void { this.disconnected = true; }
}
class FakeSource extends FakeNode {
  buffer?: { duration: number };
  onended: (() => void) | null = null;
  stopped = false;
  startTime = 0;
  start(time: number): void { this.startTime = time; }
  stop(): void { this.stopped = true; }
}
class FakeCapture extends FakeNode {
  static instances: FakeCapture[] = [];
  onprocessorerror: (() => void) | null = null;
  port = { onmessage: null as ((event: { data: ArrayBuffer }) => void) | null, close() {} };
  constructor() { super(); FakeCapture.instances.push(this); }
}
class FakeContext {
  static instances: FakeContext[] = [];
  state = 'suspended';
  currentTime = 1;
  sampleRate = 44_100;
  destination = new FakeNode();
  sources: FakeSource[] = [];
  audioWorklet = { addModule: async (_url: string) => undefined };
  constructor() { FakeContext.instances.push(this); }
  async resume(): Promise<void> { this.state = 'running'; }
  async close(): Promise<void> { this.state = 'closed'; }
  async decodeAudioData(_bytes:ArrayBuffer){return {duration:2};}
  createMediaStreamSource(): FakeNode { return new FakeNode(); }
  createGain(): FakeNode & { gain: { value: number } } { return Object.assign(new FakeNode(), { gain: { value: 0 } }); }
  createBuffer(_channels: number, length: number, rate: number) {
    const data = new Float32Array(length);
    return { duration: length / rate, getChannelData: () => data };
  }
  createBufferSource(): FakeSource {
    const source = new FakeSource(); this.sources.push(source); return source;
  }
}
class FakeSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: FakeSocket[] = [];
  readyState = 0;
  bufferedAmount = 0;
  sent: VoiceEvent[] = [];
  constructor(public url: URL) { super(); FakeSocket.instances.push(this); }
  send(raw: string): void { this.sent.push(JSON.parse(raw)); }
  open(): void { this.readyState = 1; this.dispatchEvent(new Event('open')); }
  message(event: VoiceEvent): void { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(event) })); }
  close(): void { this.readyState = 3; this.dispatchEvent(new Event('close')); }
}

function browserHarness(options: { delayedMedia?: boolean; tokenFailure?: boolean } = {}) {
  const names = ['window', 'navigator', 'AudioWorkletNode', 'WebSocket', 'fetch'];
  const originals = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  FakeSocket.instances = []; FakeContext.instances = []; FakeCapture.instances = [];
  const track = { stopped: false, stop() { this.stopped = true; }, addEventListener() {} };
  const stream = { getTracks: () => [track] };
  let resolveMedia: (value: typeof stream) => void = () => undefined;
  const media = options.delayedMedia ? new Promise<typeof stream>((resolve) => { resolveMedia = resolve; }) : Promise.resolve(stream);
  const fakeWindow = Object.assign(new EventTarget(), { isSecureContext: true, AudioContext: FakeContext });
  let requestedConstraints: unknown;
  let fetchCount = 0;
  const replacements: Record<string, unknown> = {
    window: fakeWindow,
    navigator: { mediaDevices: { getUserMedia: (constraints: unknown) => { requestedConstraints = constraints; return media; } } },
    AudioWorkletNode: FakeCapture, WebSocket: FakeSocket,
    fetch: async (url: string, init: RequestInit) => {
      fetchCount++;
      assert.equal(url, '/api/voice-token'); assert.equal(init.method, 'POST');
      return new Response(JSON.stringify(options.tokenFailure ? { error: 'API key is not configured.' } : { token: 'synthetic-test-token' }), { status: options.tokenFailure ? 503 : 200 });
    },
  };
  for (const [name, value] of Object.entries(replacements)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  return {
    track, grantMedia: () => resolveMedia(stream),
    constraints: () => requestedConstraints, fetchCount: () => fetchCount,
    restore() { for (const name of names) { const descriptor = originals.get(name); if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); } },
  };
}
const flushSyntheticTasks = () => new Promise<void>((resolve) => setImmediate(resolve));

test('synthetic transport: readiness gate, real stop calls, staged tools, partial/full transcripts, clean end', async () => {
  const harness = browserHarness();
  const statuses: VoiceStatus[] = [];
  const transcripts: VoiceTranscript[] = [];
  let mutations = 0;
  const client = new VoiceClient({ onStatus: (status) => statuses.push(status), onTranscript: (entry) => transcripts.push(entry), onTool: () => { mutations++; return { ok: true }; } });
  try {
    const starting = client.start({ system_prompt: 'Synthetic offline test only.', output: { format: { encoding: 'audio/pcm' } } });
    await flushSyntheticTasks();
    const ws = FakeSocket.instances[0];
    assert.ok(ws);
    assert.equal(ws.url.origin, 'wss://agents.assemblyai.com');
    ws.open();
    assert.equal(ws.sent[0].type, 'session.update');
    const capture = FakeCapture.instances[0];
    capture.port.onmessage?.({ data: new ArrayBuffer(960) });
    assert.equal(ws.sent.length, 1, 'no microphone frames before readiness');
    ws.message({ type: 'session.ready', session_id: 'synthetic-offline' });
    await starting;
    capture.port.onmessage?.({ data: new ArrayBuffer(960) });
    assert.equal(ws.sent[1].type, 'input.audio');
    assert.deepEqual(harness.constraints(), { audio: { echoCancellation: true, noiseSuppression: false, channelCount: 1 } });
    ws.message(started()); ws.message(call());
    assert.equal(mutations, 0);
    ws.message(done());
    assert.equal(mutations, 1);
    assert.equal(ws.sent.at(-1)?.type, 'tool.result');
    assert.equal(ws.sent.at(-1)?.result, '{"ok":true}');
    ws.message(done()); assert.equal(mutations, 1);
    ws.message({ type: 'transcript.user.delta', item_id: 'u', text: 'add' });
    ws.message({ type: 'transcript.user.delta', item_id: 'u', text: 'add rain' });
    ws.message({ type: 'transcript.user', item_id: 'u', text: 'Add rain.' });
    assert.deepEqual(transcripts.map((entry) => [entry.text, entry.final]), [['add', false], ['add rain', false], ['Add rain.', true]]);
    ws.message({ type: 'reply.started', reply_id: 'spoken' });
    ws.message({ type: 'reply.audio', data: btoa('\0'.repeat(4_800)) });
    const playing = FakeContext.instances[0].sources[0];
    assert.equal(playing.stopped, false);
    ws.message({ type: 'reply.done', reply_id: 'spoken', status: 'interrupted' });
    assert.equal(playing.stopped, true, 'interruption cancels the actual scheduled source');
    ws.message({ type: 'reply.started', reply_id: 'more' });
    ws.message({ type: 'reply.audio', data: btoa('\0'.repeat(4_800)) });
    const second = FakeContext.instances[0].sources[1];
    const stopping = client.stop();
    assert.equal(harness.track.stopped, true, 'mic released before waiting for server');
    assert.equal(second.stopped, true);
    assert.equal(ws.sent.at(-1)?.type, 'session.end');
    assert.equal(ws.readyState, FakeSocket.OPEN, 'wait for clean end before closing');
    ws.message({ type: 'session.ended' });
    await stopping;
    assert.equal(ws.readyState, FakeSocket.CLOSED);
    assert.equal(statuses.at(-1), 'ended');
  } finally { await client.stop(); harness.restore(); }
});

test('synthetic transport: token failure releases microphone and closes audio context', async () => {
  const harness = browserHarness({ tokenFailure: true });
  const client = new VoiceClient({ onStatus() {}, onTranscript() {}, onTool() {} });
  try {
    await assert.rejects(client.start({ system_prompt: 'Synthetic offline test only.' }), /API key is not configured/);
    assert.equal(harness.track.stopped, true);
    assert.equal(FakeContext.instances[0].state, 'closed');
    assert.equal(FakeSocket.instances.length, 0);
  } finally { await client.stop(); harness.restore(); }
});

test('synthetic transport: a microphone grant arriving after stop is immediately released', async () => {
  const harness = browserHarness({ delayedMedia: true });
  const client = new VoiceClient({ onStatus() {}, onTranscript() {}, onTool() {} });
  try {
    const result = assert.rejects(client.start({ system_prompt: 'Synthetic offline test only.' }), { name: 'AbortError' });
    await client.stop();
    await result;
    harness.grantMedia();
    await flushSyntheticTasks();
    assert.equal(harness.track.stopped, true);
    assert.equal(harness.fetchCount(), 0);
  } finally { await client.stop(); harness.restore(); }
});

test('synthetic transport: close fallback is bounded when session.ended never arrives', async (t) => {
  const harness = browserHarness();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const client = new VoiceClient({ onStatus() {}, onTranscript() {}, onTool() {} });
  try {
    const start = client.start({ system_prompt: 'Synthetic offline test only.' });
    await flushSyntheticTasks();
    const ws = FakeSocket.instances[0]; ws.open(); ws.message({ type: 'session.ready' }); await start;
    const stopped = client.stop();
    assert.equal(harness.track.stopped, true);
    t.mock.timers.tick(1_200);
    await stopped;
    assert.equal(ws.readyState, FakeSocket.CLOSED);
  } finally { await client.stop(); t.mock.timers.reset(); harness.restore(); }
});

test('synthetic transport: local five-minute cap ends the session and releases the microphone', async (t) => {
  const harness = browserHarness();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const client = new VoiceClient({ onStatus() {}, onTranscript() {}, onTool() {} });
  try {
    const start = client.start({ system_prompt: 'Synthetic offline test only.' });
    await flushSyntheticTasks();
    const ws = FakeSocket.instances[0]; ws.open(); ws.message({ type: 'session.ready' }); await start;
    t.mock.timers.tick(300_000);
    assert.equal(harness.track.stopped, true);
    assert.equal(ws.sent.at(-1)?.type, 'session.end');
    ws.message({ type: 'session.ended' });
  } finally { t.mock.timers.tick(1_200); await client.stop(); t.mock.timers.reset(); harness.restore(); }
});

test('synthetic transport: connect timeout releases resources and rejects startup', async (t) => {
  const harness = browserHarness();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const client = new VoiceClient({ onStatus() {}, onTranscript() {}, onTool() {} });
  try {
    const rejected = assert.rejects(client.start({ system_prompt: 'Synthetic offline test only.' }), /timed out/);
    await flushSyntheticTasks();
    t.mock.timers.tick(25_000);
    await rejected;
    assert.equal(harness.track.stopped, true);
    assert.equal(FakeSocket.instances[0].readyState, FakeSocket.CLOSED);
    assert.equal(FakeContext.instances[0].state, 'closed');
  } finally { t.mock.timers.tick(1_200); await client.stop(); t.mock.timers.reset(); harness.restore(); }
});

test('synthetic transport: one-session token source is discarded on cancellation before microphone grant',async()=>{
 const harness=browserHarness({delayedMedia:true});let discarded=0;let requested=0;
 const source={getToken:async()=>{requested++;return 'synthetic-token';},discard(){discarded++;}};
 const client=new VoiceClient({onStatus(){},onTranscript(){},onTool(){}});
 try{const starting=client.start({system_prompt:'Synthetic offline only.'},source);const rejection=assert.rejects(starting);await client.stop();harness.grantMedia();await rejection;await flushSyntheticTasks();assert.ok(discarded>0);assert.equal(requested,0);assert.equal(harness.fetchCount(),0);assert.equal(harness.track.stopped,true);}finally{await client.stop();harness.restore();}
});
test('synthetic transport: one-session source bypasses stored-key endpoint and is discarded after use',async()=>{
 const harness=browserHarness();let discarded=0;const source={getToken:async()=> 'synthetic-token',discard(){discarded++;}};
 const client=new VoiceClient({onStatus(){},onTranscript(){},onTool(){}});
 try{const starting=client.start({system_prompt:'Synthetic offline only.'},source);await flushSyntheticTasks();const ws=FakeSocket.instances[0];assert.ok(ws);ws.open();ws.message({type:'session.ready'});await starting;assert.equal(harness.fetchCount(),0);assert.ok(discarded>0);const stopping=client.stop();ws.message({type:'session.ended'});await stopping;}finally{await client.stop();harness.restore();}
});
test('synthetic-input mode never requests microphone and records only received evidence',async()=>{
 const harness=browserHarness();const client=new VoiceClient({onStatus(){},onTranscript(){},onTool(){return {actual:true};}});const source={getToken:async()=> 'synthetic-temporary-token',discard(){}};
 try{const started=client.start({system_prompt:'Offline test.'},source,'synthetic-test');await flushSyntheticTasks();const ws=FakeSocket.instances[0];assert.ok(ws);assert.equal(harness.constraints(),undefined);assert.equal(harness.fetchCount(),0);await assert.rejects(client.sendTestUtterance('test'),/Start/);ws.open();ws.message({type:'session.ready',resume_token:'secret-resume'});await started;ws.message({type:'transcript.agent',text:'Actual mocked provider reply'});client.recordRulebook({revision:1});const evidence=JSON.stringify(client.exportTestEvidence());assert.ok(evidence.includes('Actual mocked provider reply'));assert.ok(!evidence.includes('secret-resume'));const stopping=client.stop();ws.message({type:'session.ended'});await stopping;await assert.rejects(client.sendTestUtterance('test'),/Start/);}finally{await client.stop();harness.restore();}
});

test('synthetic sample button sends audio through capture and never directly invokes a tool',async()=>{
 const harness=browserHarness();let tools=0;const client=new VoiceClient({onStatus(){},onTranscript(){},onTool(){tools++;}});
 try{const start=client.start({system_prompt:'Offline test.'},{getToken:async()=> 'synthetic-token',discard(){}},'synthetic-test');await flushSyntheticTasks();const ws=FakeSocket.instances[0];ws.open();ws.message({type:'session.ready'});await start;globalThis.fetch=async input=>{assert.equal(input,'/test-utterances/test.wav');return new Response(new Uint8Array([1,2]));};await client.sendTestUtterance('test');assert.equal(tools,0);assert.equal(FakeContext.instances[0].sources.length,1);await assert.rejects(client.sendTestUtterance('repair'),/Wait/);FakeCapture.instances[0].port.onmessage?.({data:new ArrayBuffer(960)});assert.equal(ws.sent.filter(e=>e.type==='input.audio').length,1);const stopped=client.stop();assert.equal(FakeContext.instances[0].sources[0].stopped,true);ws.message({type:'session.ended'});await stopped;}finally{await client.stop();harness.restore();}
});
