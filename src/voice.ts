import { isRecord, ToolCallState, type StagedToolCall, type VoiceEvent } from './voice-protocol';
export type { VoiceEvent } from './voice-protocol';

export type VoiceStatus = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'ending' | 'ended' | 'error';
export interface VoiceTranscript {
  role: 'user' | 'agent';
  /** Full text so far, including for partials: replace by itemId, do not append. */
  text: string;
  final: boolean;
  itemId: string;
  replyId?: string;
  interrupted?: boolean;
}
export interface VoiceCallbacks {
  onStatus(status: VoiceStatus, detail?: string): void;
  onTranscript(entry: VoiceTranscript): void;
  /** Must return synchronously. Invoked only at a matching completed reply.done. */
  onTool(name: string, args: Record<string, unknown>): unknown;
  onEvent?(event: VoiceEvent): void;
}

export interface VoiceTokenSource { getToken(signal:AbortSignal):Promise<string>; discard():void; }

const CONNECT_TIMEOUT_MS = 25_000;
const MAX_SESSION_MS = 5 * 60_000;
const END_TIMEOUT_MS = 1_200;
const MAX_SOCKET_BACKLOG = 64 * 1024;
const MAX_PLAYBACK_SECONDS = 30;

/** Real AssemblyAI Voice Agent connection. There is no demo or simulated mode. */
export class VoiceClient {
  private ws?: WebSocket;
  private tokenSource?:VoiceTokenSource;
  private context?: AudioContext;
  private stream?: MediaStream;
  private source?: MediaStreamAudioSourceNode;
  private capture?: AudioWorkletNode;
  private silentSink?: GainNode;
  private scheduled = new Set<AudioBufferSourceNode>();
  private playbackTime = 0;
  private activeReply?: string;
  private interruptedReplies = new Set<string>();
  private agentPartials = new Map<string, string>();
  private tools = new ToolCallState();
  private abort?: AbortController;
  private connectTimer?: ReturnType<typeof setTimeout>;
  private capTimer?: ReturnType<typeof setTimeout>;
  private endTimer?: ReturnType<typeof setTimeout>;
  private blockedSince = 0;
  private run = 0;
  private running = false;
  private ready = false;
  private ending = false;
  private failure?: string;
  private endDetail?: string;
  private startResolve?: () => void;
  private startReject?: (error: Error) => void;
  private stopPromise?: Promise<void>;
  private stopResolve?: () => void;
  private readonly onPageHide = () => { void this.stop(); };

  constructor(private readonly callbacks: VoiceCallbacks) {}

  /** Call directly from a user click. Resolves at session.ready, rejects on startup failure. */
  start(session: Record<string, unknown>, tokenSource?:VoiceTokenSource): Promise<void> {
    if (this.running || this.ending) {tokenSource?.discard();return Promise.reject(new Error('A voice session is already active.'));}
    if (!isRecord(session) || typeof session.system_prompt !== 'string' || !session.system_prompt.trim() || 'agent_id' in session) {
      tokenSource?.discard();return Promise.reject(new Error('Provide an inline session with a system_prompt and no agent_id.'));
    }
    for (const direction of ['input', 'output']) {
      const settings = session[direction];
      if (isRecord(settings) && isRecord(settings.format) && settings.format.encoding !== 'audio/pcm') {
        tokenSource?.discard();return Promise.reject(new Error('This browser transport requires audio/pcm input and output.'));
      }
    }
    let wireSession: string;
    try { wireSession = JSON.stringify({ type: 'session.update', session }); }
    catch { tokenSource?.discard();return Promise.reject(new Error('The voice session configuration must be JSON-serializable.')); }

    this.tokenSource=tokenSource;
    this.running = true;
    this.ready = false;
    this.ending = false;
    this.failure = undefined;
    this.endDetail = undefined;
    this.tools = new ToolCallState();
    this.agentPartials.clear();
    this.interruptedReplies.clear();
    this.activeReply = undefined;
    this.blockedSince = 0;
    const run = ++this.run;
    this.abort = new AbortController();
    const started = new Promise<void>((resolve, reject) => {
      this.startResolve = resolve;
      this.startReject = reject;
    });
    this.status('connecting', 'Requesting microphone and connecting…');
    window.addEventListener('pagehide', this.onPageHide);
    this.connectTimer = setTimeout(() => this.fail('Voice connection timed out. Check your connection and try again.'), CONNECT_TIMEOUT_MS);
    void this.initialize(run, wireSession).catch((error: unknown) => {
      if (this.isActive(run)) this.fail(this.errorMessage(error));
    });
    return started;
  }

  /** Releases the microphone immediately; waits at most 1.2 s for session.ended. */
  stop(detail?: string): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    if (!this.running && !this.ws) return Promise.resolve();
    this.ending = true;
    this.ready = false;
    this.endDetail = detail;
    this.tools.close();
    this.abort?.abort();
    this.tokenSource?.discard();this.tokenSource=undefined;
    clearTimeout(this.connectTimer);
    clearTimeout(this.capTimer);
    this.rejectStart(new DOMException('Voice start was cancelled.', 'AbortError'));
    this.releaseAudio();
    if (!this.failure) this.status('ending', detail);
    this.stopPromise = new Promise<void>((resolve) => { this.stopResolve = resolve; });
    const waiting = this.stopPromise;
    const ws = this.ws;
    if (ws?.readyState === WebSocket.OPEN) {
      // Send synchronously, including pagehide; never await before session.end.
      try {
        ws.send(JSON.stringify({ type: 'session.end' }));
        this.endTimer = setTimeout(() => this.finish(), END_TIMEOUT_MS);
      } catch { this.finish(); }
    } else {
      this.finish();
    }
    return waiting;
  }

  private async initialize(run: number, wireSession: string): Promise<void> {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone access requires HTTPS or localhost in a supported browser.');
    }
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) throw new Error('This browser does not support Web Audio.');
    const context = new AudioContextClass(); // Default rate retains Firefox echo cancellation.
    this.context = context;
    if (!context.audioWorklet) throw new Error('This browser does not support microphone AudioWorklets.');
    // Start both permission and audio activation in the original click task.
    const resume = context.resume();
    const media = navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, channelCount: 1 } })
      .then((stream) => {
        if (this.isActive(run)) this.stream = stream;
        else stream.getTracks().forEach((track) => track.stop());
        return stream;
      });
    const [, , stream] = await Promise.all([resume, context.audioWorklet.addModule('/pcm-capture.js'), media]);
    if (!this.isActive(run)) return;
    const capture = new AudioWorkletNode(context, 'counterchime-pcm', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
      channelCount: 1, channelCountMode: 'explicit',
      processorOptions: { inputSampleRate: context.sampleRate },
    });
    this.capture = capture;
    capture.onprocessorerror = () => this.fail('Microphone audio processing stopped. Please start a new call.');
    capture.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      if (this.isActive(run)) this.sendAudio(event.data);
    };
    this.source = context.createMediaStreamSource(stream);
    this.silentSink = context.createGain();
    this.silentSink.gain.value = 0;
    this.source.connect(capture).connect(this.silentSink).connect(context.destination);
    for (const track of stream.getTracks()) {
      track.addEventListener('ended', () => {
        if (this.isActive(run)) this.fail('Microphone access ended. Please start a new call.');
      });
    }
    let token:string;
    if(this.tokenSource){
      const source=this.tokenSource;
      try{token=await source.getToken(this.abort!.signal);}finally{source.discard();this.tokenSource=undefined;}
    }else{
      const response=await fetch('/api/voice-token',{method:'POST',credentials:'same-origin',cache:'no-store',signal:this.abort?.signal,headers:{Accept:'application/json'}});
      if(!this.isActive(run))return;
      const payload:unknown=await response.json().catch(()=>null);
      if(!response.ok)throw new Error(isRecord(payload)&&typeof payload.error==='string'?payload.error:`Voice token request failed (${response.status}).`);
      if(!isRecord(payload)||typeof payload.token!=='string'||!payload.token)throw new Error('The voice token endpoint did not return a token.');
      token=payload.token;
    }
    if(!this.isActive(run))return;
    const url = new URL('wss://agents.assemblyai.com/v1/ws');
    url.searchParams.set('token', token);
    token='';
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.addEventListener('open', () => {
      if (!this.isActive(run)) { ws.close(); return; }
      try {
        ws.send(wireSession);
        this.capTimer = setTimeout(() => { void this.stop('Five-minute session limit reached. Start a new call to continue.'); }, MAX_SESSION_MS);
      } catch { this.fail('Could not configure the voice connection.'); }
    });
    ws.addEventListener('message', (event: MessageEvent) => {
      if (this.ws !== ws || this.run !== run) return;
      try {
        if (typeof event.data !== 'string') throw new Error('Received an unsupported voice event.');
        const message: unknown = JSON.parse(event.data);
        if (!isRecord(message) || typeof message.type !== 'string') throw new Error('Received a malformed voice event.');
        this.receive(message as VoiceEvent);
      } catch (error) { this.fail(this.errorMessage(error)); }
    });
    ws.addEventListener('error', () => {
      if (this.ws === ws && !this.ending) this.fail('Could not connect to AssemblyAI. Check the server API key and your network.');
    });
    ws.addEventListener('close', () => {
      if (this.ws !== ws || this.run !== run) return;
      if (!this.ending) {
        this.failure = 'Voice connection closed. Start a new call to reconnect.';
        this.rejectStart(new Error(this.failure));
        this.status('error', this.failure);
      }
      this.finish();
    });
  }

  private receive(event: VoiceEvent): void {
    if (event.type === 'session.ended') {
      this.callbacks.onEvent?.(event);
      this.finish();
      return;
    }
    if (this.ending) return;
    if (event.type === 'session.error' || event.type === 'error') {
      const message = typeof event.message === 'string' ? event.message : 'The voice service reported an error.';
      this.fail(message);
      return;
    }
    const calls = this.tools.consume(event);
    // IMPORTANT: No await, microtask, timer, or deferred effect may appear between
    // completed reply.done and these handler/result pairs.
    for (const call of calls) {
      if (!this.ready || this.ending || this.ws?.readyState !== WebSocket.OPEN) break;
      this.commitTool(call);
    }
    switch (event.type) {
      case 'session.ready': {
        if (this.ready) break;
        this.ready = true;
        clearTimeout(this.connectTimer);
        if (typeof event.expires_at === 'number') {
          clearTimeout(this.capTimer);
          const remaining = Math.max(0, Math.min(MAX_SESSION_MS, event.expires_at * 1000 - Date.now()));
          this.capTimer = setTimeout(() => { void this.stop('Five-minute session limit reached. Start a new call to continue.'); }, remaining);
        }
        this.status('listening', 'Microphone is live');
        this.startResolve?.();
        this.startResolve = undefined;
        this.startReject = undefined;
        break;
      }
      case 'input.speech.started': this.status('listening'); break;
      case 'input.speech.stopped': this.status('thinking'); break;
      case 'reply.started':
        this.activeReply = typeof event.reply_id === 'string' ? event.reply_id : undefined;
        this.status('thinking');
        break;
      case 'reply.audio':
        if (this.ready && typeof event.data === 'string' && (!this.activeReply || !this.interruptedReplies.has(this.activeReply))) {
          this.playAudio(event.data);
          this.status('speaking');
        }
        break;
      case 'reply.done':
        if (event.status === 'interrupted') {
          if (typeof event.reply_id === 'string') this.interruptedReplies.add(event.reply_id);
          this.cancelPlayback();
        }
        if (this.scheduled.size === 0) this.status('listening');
        break;
      case 'transcript.user.delta': case 'transcript.user':
      case 'transcript.agent.delta': case 'transcript.agent':
        this.transcript(event);
        break;
    }
    this.callbacks.onEvent?.(event);
  }

  private commitTool(call: StagedToolCall): void {
    let result: string;
    let isError = false;
    try {
      const value = this.callbacks.onTool(call.name, call.arguments);
      if (isRecord(value) && typeof value.then === 'function') throw new Error('Tool handlers must return synchronously.');
      result = JSON.stringify(value === undefined ? null : value);
      if (typeof result !== 'string') throw new Error('Tool result is not JSON-serializable.');
      isError = isRecord(value) && typeof value.error === 'string';
    } catch (error) {
      isError = true;
      result = JSON.stringify({ error: this.errorMessage(error) });
    }
    if (!this.ending && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'tool.result', call_id: call.callId, result, is_error: isError }));
    }
  }

  private transcript(event: VoiceEvent): void {
    const role = event.type.startsWith('transcript.user') ? 'user' : 'agent';
    const final = !event.type.endsWith('.delta');
    const replyId = typeof event.reply_id === 'string' ? event.reply_id : undefined;
    const itemId = typeof event.item_id === 'string' ? event.item_id : replyId ?? `${role}-current`;
    let text = typeof event.text === 'string' ? event.text : '';
    const key = replyId ?? itemId;
    if (role === 'agent' && !final && typeof event.delta === 'string') {
      const prior = this.agentPartials.get(key) ?? '';
      // Word events normally omit separating spaces; preserve supplied whitespace
      // and punctuation when the service emits token-level deltas.
      const delta = event.delta;
      const separator = prior && !/\s$/.test(prior) && !/^[\s.,!?;:’')\]]/.test(delta) ? ' ' : '';
      text = prior + separator + delta;
      this.agentPartials.set(key, text);
    }
    if (final) this.agentPartials.delete(key);
    this.callbacks.onTranscript({ role, text, final, itemId, replyId, interrupted: event.interrupted === true });
  }

  private sendAudio(buffer: ArrayBuffer): void {
    const ws = this.ws;
    if (!this.ready || this.ending || !ws || ws.readyState !== WebSocket.OPEN) return;
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength === 0 || buffer.byteLength > 8_192) return;
    if (ws.bufferedAmount > MAX_SOCKET_BACKLOG) {
      if (!this.blockedSince) {
        this.blockedSince = performance.now();
        this.callbacks.onEvent?.({ type: 'client.audio_backpressure', message: 'Dropping microphone frames rather than building stale audio.' });
      }
      if (performance.now() - this.blockedSince > 2_000) this.fail('The connection is too slow to stream live audio. Please try again.');
      return; // No application-level audio queue.
    }
    this.blockedSince = 0;
    try {
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      ws.send(JSON.stringify({ type: 'input.audio', audio: btoa(binary) }));
    } catch { this.fail('Microphone audio could not be sent. Please start a new call.'); }
  }

  private playAudio(encoded: string): void {
    const context = this.context;
    if (!context || context.state === 'closed') return;
    if (encoded.length > 4 * 1024 * 1024) throw new Error('Voice audio chunk exceeds the safe playback limit.');
    const raw = atob(encoded);
    if (raw.length % 2 !== 0) throw new Error('The voice service sent malformed PCM audio.');
    if (!raw.length) return;
    const duration = raw.length / 2 / 24_000;
    if (Math.max(0, this.playbackTime - context.currentTime) + duration > MAX_PLAYBACK_SECONDS) {
      throw new Error('Voice playback fell too far behind. Please start a new call.');
    }
    const buffer = context.createBuffer(1, raw.length / 2, 24_000);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < channel.length; i++) {
      const unsigned = raw.charCodeAt(i * 2) | (raw.charCodeAt(i * 2 + 1) << 8);
      channel[i] = (unsigned >= 0x8000 ? unsigned - 0x10000 : unsigned) / 32768;
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    this.scheduled.add(source);
    source.onended = () => {
      source.disconnect();
      this.scheduled.delete(source);
      if (this.scheduled.size === 0 && this.ready && !this.ending) this.status('listening');
    };
    this.playbackTime = Math.max(context.currentTime + 0.01, this.playbackTime);
    source.start(this.playbackTime);
    this.playbackTime += buffer.duration;
  }

  private cancelPlayback(): void {
    for (const source of this.scheduled) {
      source.onended = null;
      try { source.stop(); } catch { /* Already ended. */ }
      source.disconnect();
    }
    this.scheduled.clear();
    this.playbackTime = this.context?.currentTime ?? 0;
  }

  private releaseAudio(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
    this.cancelPlayback();
    if (this.capture) {
      this.capture.port.onmessage = null;
      this.capture.onprocessorerror = null;
      this.capture.port.close();
      this.capture.disconnect();
    }
    this.source?.disconnect();
    this.silentSink?.disconnect();
    this.capture = undefined;
    this.source = undefined;
    this.silentSink = undefined;
    const context = this.context;
    this.context = undefined;
    if (context && context.state !== 'closed') void context.close().catch(() => undefined);
  }

  private fail(message: string): void {
    if (this.ending || !this.running) return;
    this.failure = message;
    this.rejectStart(new Error(message));
    this.status('error', message);
    void this.stop();
  }

  private finish(): void {
    clearTimeout(this.connectTimer);
    clearTimeout(this.capTimer);
    clearTimeout(this.endTimer);
    this.ready = false;
    this.ending = true;
    this.tools.close();
    this.abort?.abort();
    this.tokenSource?.discard();this.tokenSource=undefined;
    this.releaseAudio();
    this.rejectStart(new Error(this.failure ?? 'The voice session ended before it was ready.'));
    const ws = this.ws;
    this.ws = undefined;
    if (ws && ws.readyState < WebSocket.CLOSING) {
      try { ws.close(1000, 'Session ended'); } catch { /* Socket already closing. */ }
    }
    window.removeEventListener('pagehide', this.onPageHide);
    this.running = false;
    this.ending = false;
    this.run += 1; // Late microphone grants and old socket events cannot revive it.
    if (!this.failure) this.status('ended', this.endDetail);
    this.stopResolve?.();
    this.stopResolve = undefined;
    this.stopPromise = undefined;
  }

  private isActive(run: number): boolean { return this.run === run && this.running && !this.ending; }
  private rejectStart(error: Error): void {
    this.startReject?.(error);
    this.startReject = undefined;
    this.startResolve = undefined;
  }
  private status(status: VoiceStatus, detail?: string): void {
    try { this.callbacks.onStatus(status, detail); } catch { /* UI status callbacks must not prevent cleanup. */ }
  }
  private errorMessage(error: unknown): string {
    if (error instanceof DOMException && error.name === 'NotAllowedError') return 'Microphone permission was denied. Allow microphone access to start a voice call.';
    return error instanceof Error ? error.message : 'The voice connection failed. Please try again.';
  }
}
