# Optional session-only key setup

Disabled by default. This mode does not store an AssemblyAI key in server environment variables, a database, browser storage, React state, URLs, HTML attributes, exported sessions, or app logs. It still transmits the key to this app's server and then AssemblyAI, and must be personally entered and submitted by the owner after explicit approval.

## Required server configuration

Keep `DB` bound to the existing D1 budget database. Its migration is already deployed. Configure these non-secret values only after usage authorization:

- `VOICE_ACCESS_MODE=sites-protected`
- `VOICE_ALLOWED_USER_IDS=<exact site-scoped authenticated owner ID>`
- `ALLOWED_ORIGIN=https://counterchime.jackyo.chatgpt.site`
- `VOICE_MAX_SESSIONS=2`
- `ENABLE_LIVE_VOICE=true`
- `ENABLE_SESSION_KEY_INPUT=true`

No `ASSEMBLYAI_API_KEY` environment value is needed for this optional flow. The stored-key path remains a separate option.

Owner sign-in alone does **not** enable voice. The Sites account UUID from management access policies must not be assumed to equal the site-scoped authenticated ID. After ordinary ChatGPT sign-in, `/api/voice-status` returns only the current signed-in viewer's non-secret `viewerId`; the UI shows it under **Owner setup identity**. Verify this is the owner and copy the exact value into the server allowlist. Public/anonymous visitors receive no form and cannot mint tokens. If the Site is public, the **Owner sign-in for voice setup** link starts the supported top-level Sites sign-in flow; public offline access does not grant paid voice access.

Runtime setting changes need a normal deployment to apply. Do not weaken the allowlist or use a bypass token to avoid normal sign-in.

## User handoff

1. Owner opens the app, signs in normally, and is explicitly allowlisted after identity verification
2. Owner clicks **Recheck voice setup** and sees **One-session key entry**
3. Stop all agent screenshots/DOM inspection while the credential field may contain a key
4. Owner manually enters an existing key into the password field and personally presses **Use key for one voice session**; do not save it in a password manager/browser
5. The field clears synchronously. The key is held only until microphone permission and exchange, then references are dropped; cancellation/failure also discards the holder. The owner grants microphone access if desired
6. Resume agent inspection only after the owner reports completion and the field is empty/session state is visible. Never inspect network request bodies, input values, browser memory, clipboard, or credentials

The browser sends a same-origin HTTPS POST with a bounded JSON body. The server validates identity, both enable flags, HTTPS, exact origin, content type, payload shape, and the durable budget before contacting AssemblyAI. The server never relays provider error bodies or raw exception messages. A minted token has a60-second redemption window and300-second maximum session duration. The key is never sent in the WebSocket URL; only the single-use token is.

JavaScript immutable strings and platform request buffers cannot be securely zeroized. Counterchime clears the input, drops its references, and avoids intentional persistence/logging; it cannot promise removal from browser/OS/provider infrastructure memory or provider logs. No recording should include credentials or account screens.

## Approved test budget

For the current owner-approved maximum$1 of existing free credits, code enforces a hard maximum of two lifetime token allocations, shared by stored-key and one-session-key paths. Both testing and recording count; failed requests consume a slot. No automatic reconnect, resume, replenishment, reset, recharge, or upgrade.

Official pricing verified2026-09-30: managed Voice Agent API $4.50/hour, billed per second, including managed STT/LLM/TTS. Two300-second sessions cost$0.75. Even reserving a30-second billable disconnection grace window for each gives$0.825. Reserve$0.45 per attempt ($0.90 total) as a conservative allowance; provider rounding/start boundaries are not exhaustively documented, so this is not a provider-enforced dollar quota. End cleanly with session.end. Count any prior test usage against the same authorized total before enabling.

Sources:
- https://www.assemblyai.com/pricing/
- https://www.assemblyai.com/docs/voice-agents/voice-agent-api/events-reference
- https://www.assemblyai.com/docs/voice-agents/voice-agent-api/api-spec/generate-voice-agent-token

## Verification boundary

Automated exchange tests replace fetch with synthetic fixtures. They do not consume API credits or establish live provider access. Real microphone→AssemblyAI→tool→audio validation remains required after the user handoff.

## Optional public, visitor-owned key mode

`ENABLE_PUBLIC_SESSION_KEY_INPUT=true` may be configured only after explicit owner approval of this separate mode. It allows a visitor to manually submit their own key without a ChatGPT login. It never reads or falls back to `ASSEMBLYAI_API_KEY`, and the stored-key endpoint remains owner-allowlisted. All other gates remain required: `ENABLE_LIVE_VOICE=true`, `ENABLE_SESSION_KEY_INPUT=true`, `VOICE_ACCESS_MODE=sites-protected`, exact `ALLOWED_ORIGIN`, D1 binding, and `VOICE_MAX_SESSIONS=2`. The atomic lifetime budget is shared by both paths. Anonymous visitors could exhaust the two allocations with their own supplied keys; they cannot obtain the stored owner key. No automatic retries or budget reset. Defaults remain disabled. Runtime flags must be explicitly configured and redeployed.
