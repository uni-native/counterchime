/** Wire-only types and deterministic tool staging. No browser, network, or app mutations. */
export interface VoiceEvent {
  type: string;
  [key: string]: unknown;
}

export interface StagedToolCall {
  callId: string;
  name: string;
  arguments: Record<string, unknown>;
  replyId: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * AssemblyAI identifies function-call replies as `fc-<call_id>`.
 * A tool.call only stages intent. The matching completed reply.done releases it.
 * The caller must execute the returned calls and send their results synchronously,
 * in this same WebSocket message task, without awaiting any operation.
 *
 * Interrupted, superseded, duplicate, closed, and out-of-order replies cannot
 * replay a mutation. Call IDs remain tombstoned for the whole (five-minute) call.
 */
export class ToolCallState {
  private pending = new Map<string, StagedToolCall>();
  private seenCalls = new Set<string>();
  private retiredReplies = new Set<string>();
  private activeReply: string | null = null;
  private speechStarted = false;
  private closed = false;

  consume(event: VoiceEvent): StagedToolCall[] {
    if (this.closed) return [];
    const replyId = typeof event.reply_id === 'string' ? event.reply_id : undefined;

    if (event.type === 'session.ended' || event.type === 'session.error' || event.type === 'error') {
      this.close();
      return [];
    }

    if (event.type === 'input.speech.started') {
      this.discardPending();
      if (this.activeReply) this.retiredReplies.add(this.activeReply);
      this.activeReply = null;
      this.speechStarted = true;
      return [];
    }

    if (event.type === 'reply.started' && replyId) {
      // A repeated start for the same reply is harmless; a newer reply invalidates
      // old intents instead of letting its completion accidentally commit them.
      if (this.retiredReplies.has(replyId)) return [];
      if (this.activeReply && this.activeReply !== replyId) {
        this.retiredReplies.add(this.activeReply);
      }
      for (const [id, call] of this.pending) {
        if (call.replyId !== replyId) {
          this.retiredReplies.add(call.replyId);
          this.pending.delete(id);
        }
      }
      this.activeReply = replyId;
      this.speechStarted = false;
      return [];
    }

    if (event.type === 'tool.call') {
      const callId = typeof event.call_id === 'string' ? event.call_id : '';
      const name = typeof event.name === 'string' ? event.name : '';
      if (!callId || !name || this.seenCalls.has(callId)) return [];
      this.seenCalls.add(callId);
      const toolReplyId = `fc-${callId}`;
      if (!isRecord(event.arguments) || this.speechStarted || this.retiredReplies.has(toolReplyId)) return [];
      if (replyId && replyId !== toolReplyId) return [];
      if (this.activeReply && this.activeReply !== toolReplyId) return [];
      this.pending.set(callId, { callId, name, arguments: event.arguments, replyId: toolReplyId });
      return [];
    }

    if (event.type !== 'reply.done' || !replyId) return [];
    if (this.retiredReplies.has(replyId)) return [];
    const stale = this.activeReply !== null && this.activeReply !== replyId;
    this.retiredReplies.add(replyId);
    if (event.status !== 'completed') {
      // In particular, interruption cancels every staged intent, never just audio.
      if (!stale) {
        this.discardPending();
        this.activeReply = null;
      }
      return [];
    }
    if (stale || this.speechStarted) return [];

    const committed: StagedToolCall[] = [];
    for (const [id, call] of this.pending) {
      if (call.replyId === replyId) {
        this.pending.delete(id);
        committed.push(call);
      }
    }
    this.activeReply = null;
    return committed;
  }

  close(): void {
    this.discardPending();
    this.closed = true;
    this.activeReply = null;
  }

  private discardPending(): void {
    for (const call of this.pending.values()) this.retiredReplies.add(call.replyId);
    this.pending.clear();
  }
}
