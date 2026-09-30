# Counterchime

**Say the rules. Find the loop. Fix it.**

Counterchime is a voice-driven laboratory for tiny resource-exchange game economies. AssemblyAI's Voice Agent API turns spoken instructions into validated tool calls. A separate deterministic checker finds a reachable, repeatable growth loop and provides exact step-by-step evidence. A spoken correction edits a rule and recomputes the evidence.

## What works without credentials

- Four explicitly local examples: timber growth, neutral exchange, unreachable star-gated growth, and a three-resource loop
- Editable starting inventory and up to six consume/produce rules, including multi-resource rules
- Deterministic bounded analysis and independent certificate replay
- Step-by-step inventory visualization, playback, correction, undo, stale-evidence labeling
- Device-local rulebook persistence, JSON import, and reproducible evidence export
- A deliberately narrow local text parser; it is **not speech recognition or an LLM**

Live voice is disabled by default. The presence of implementation code, synthetic tests, or local fixtures is not evidence of successful live AssemblyAI usage. See [verification status](docs/verification.md).

## Quick start

Requires Node 24 (Node 22 may work but is not the verified runtime).

```sh
npm ci
npm run dev
# http://localhost:5173
npm test
npm run build
```

Use the visible local command `Change the second rule to two wood`, then `undo`. Or edit rule 2's output quantity and click **Test economy**. Manual edits leave the prior certificate visibly outdated until the next test.

`npm run build` creates `dist/client/` and a Cloudflare Worker-compatible `dist/server/index.js`. No credentials are embedded in the client bundle.

## The model, precisely

Resources are `wood`, `stone`, and `stars`. Initial and rule quantities are integers 0–9. Every trade consumes and produces at least one resource. Rules are deterministic, atomic, and repeatable without limit. There is no randomness, cooldown, storage ceiling, turn cost, hidden condition, market demand, or real-money asset.

For an affordable rule, `next = current - input + output` for each resource. The default search admits at most 10,000 distinct inventory states, follows up to eight trades, and only explores quantities up to 30 per resource. The quantity ceiling is an **exploration bound**, not a game rule; states are never clamped.

The search uses a deterministic BFS tree with exact inventory deduplication. It compares each new state with its ancestors. It does not enumerate every history and does not claim a globally shortest cycle. A negative result says only that no witness was found by this bounded search, never that an economy is balanced or globally safe.

A certificate is a reachable prefix followed by a nonempty sequence whose ending inventory dominates its starting inventory componentwise: every resource is recovered and at least one increases. The entire trace is independently replayed before acceptance. Under this narrow monotone model, the same loop is executable again from the larger inventory and gives the same nonnegative gain. A higher total alone is not sufficient: consuming a finite star to gain wood is not repeatable growth.

### Canonical certificate

```
[wood=2, stone=0, stars=0]
  -- consume 2 wood, produce 1 stone --> [0,1,0]
  -- consume 1 stone, produce 3 wood --> [3,0,0]
Net gain per repeat: [1,0,0]
```

## Real voice integration

The browser captures microphone audio with echo cancellation and streams mono PCM16 at 24 kHz via an AudioWorklet. It connects to AssemblyAI with a single-use, 60-second redemption token minted by the server; sessions last at most 300 seconds. Stored server keys never enter client code. The separately authorized, optional one-session form briefly holds a user-entered key in memory, clears its uncontrolled password field synchronously, and submits it only to the same-origin protected exchange endpoint.

The inline session exposes these client-side function tools:

- `get_rulebook`
- `set_initial_inventory`
- `upsert_rule`
- `remove_rule`
- `analyze_economy`
- `undo_last_edit`
- `replay_witness`

Final transcripts are displayed but never parsed into mutations directly. `tool.call` stages an intent. Only its matching completed `reply.done` commits the edit and returns a JSON-string `tool.result`. Interrupted, superseded, and duplicate calls cannot repeat mutations. A base-revision check rejects stale edits. Barge-in stops scheduled audio sources; ending a session stops microphone tracks, closes audio resources, and sends `session.end`.

The model is told to derive findings only from tool-returned evidence, preserve unaffected fields during corrections, and reject unsupported mechanics. Tool arguments are validated locally, regardless of model output.

### Enabling live voice safely

See `.env.example` and [security notes](docs/security.md). An owner must approve usage and configure the server secret out of band. Never paste an API key in chat, commit it, expose it as `VITE_*`, or put it in a URL. The owner may instead manually use the optional protected one-session entry flow described in docs/session-key-setup.md.

Local development requires all of: `ENABLE_LIVE_VOICE=true`, a server-only `ASSEMBLYAI_API_KEY`, `VOICE_ACCESS_MODE=local-only`, an explicitly approved `VOICE_MAX_SESSIONS` (1–2), and an exact `ALLOWED_ORIGIN`. Start with `node --env-file=.env --import tsx server/dev.ts` after the owner configures the file. Local session limits are process-lifetime limits and reset when the owner restarts the server.

Hosted live voice is fail-closed: it requires Sites dispatch authentication, an explicit identity allowlist, a durable D1 session-budget table, an exact origin, and the owner-approved session limit. The counter is atomic and global and does not reset on deployment. Failed token requests consume a slot conservatively. Do not expose the Worker directly outside Sites with `sites-protected` mode; forwarded identity headers are trusted only behind the platform dispatcher. Stored-key voice remains owner-only. A separately gated visitor-supplied session-key mode is implemented but is disabled on the hosted demo pending explicit approval; it never accesses the stored owner key.

## Privacy and data flow

Without live voice, rules and analysis run in the browser. Fonts are self-hosted; no analytics are installed. The rulebook saves to this browser's local storage. Exports contain rules and evidence, not transcripts or audio. Imports ignore supplied certificates and recompute results.

Starting live voice sends microphone audio and tool-returned rulebook/evidence to AssemblyAI. Transcripts exist in tab memory only and are not saved by this app. AssemblyAI has its own provider-side retention and processing policies; this app does not claim that the provider saves nothing. Never use private, personal, or production data in a public demonstration.

## Architecture

```
Browser microphone -> AudioWorklet -> AssemblyAI Voice Agent WebSocket
Browser             <- transcript/audio/tool.call <- AssemblyAI
                              |
                       staged + validated tool
                              v
Immutable rulebook revision -> bounded checker -> independent replay
                              |
                       visible/exported certificate

Server: guarded POST /api/voice-token -> AssemblyAI temporary token
        hosted identity allowlist + atomic durable session budget
```

Main modules:

- `src/engine.ts`: validation, trade application, BFS, independent replay
- `src/session.ts`: immutable revisions, undo, evidence export, tool schemas/dispatch
- `src/voice-protocol.ts`: idempotent staged tool state machine
- `src/voice.ts`: real browser audio/network transport
- `public/pcm-capture.js`: streaming resampling and PCM capture
- `server/api.ts`: secret boundary, access/budget checks, temporary token minting
- `src/components/`: rulebook, evidence, and voice UI

## Verification and remaining limitations

Run `npm test` for deterministic engine, session, server, and **synthetic/offline** protocol tests. The small-domain engine suite checks 576 economies against an independent reference. Synthetic transport tests exercise PCM rates, interruption cleanup, timeout, and staged mutations, but do not establish real STT/tool-extraction accuracy.

The UI smoke script is `scripts/ui-smoke.mjs` and requires installed Chromium plus a running local server. This workspace's sandbox currently prevents launching Chromium, so consult [verification status](docs/verification.md) for actual, not inferred, browser and live-voice status.

Bounded search can miss longer or unexplored histories. Spoken instructions may be misunderstood; review visible rules. Only current-revision evidence is valid. Browser microphone permissions require localhost or HTTPS. Five-minute sessions end rather than silently reconnect. Concurrent browser sessions have separate rulebooks.

## Originality, license, and AI assistance

Counterchime's application logic, checker, tests, UI, prompt, and token artwork were created for this project with OpenAI AI coding assistance. No competitor code or game rules were copied. AssemblyAI's public documentation informed protocol integration; their starter source was not copied. The UI concept was generated with OpenAI Image Gen; runtime token glyphs and brand artwork are original inline SVG.

The source license is MIT (see `LICENSE`). Third-party dependencies retain their own licenses, including SIL Open Font License fonts. See `THIRD_PARTY_NOTICES.md` and `docs/dependency-inventory.json`. Source publication was approved by the project owner. Event submission is pending review of the completed demonstration video.

## Official protocol references

- [Browser integration](https://www.assemblyai.com/docs/voice-agents/voice-agent-api/browser-integration)
- [Client-side function tools](https://www.assemblyai.com/docs/voice-agents/voice-agent-api/tools/client-side-tools)
- [Inline configuration](https://www.assemblyai.com/docs/voice-agents/voice-agent-api/session-configuration)
- [Events reference](https://www.assemblyai.com/docs/voice-agents/voice-agent-api/events-reference)

Protocol checked against these pages on 2026-09-30. API behavior can change; live verification is still required.
