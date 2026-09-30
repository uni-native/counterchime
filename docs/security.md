# Security and cost boundary

Live voice is deliberately disabled unless every configured gate passes. Server secrets are read only at runtime and never logged, included in error responses, or imported into the browser bundle. The token endpoint is POST-only, same-origin, non-cacheable, time-limited, and returns only a single-use session token.

## Hosted gate

`VOICE_ACCESS_MODE=sites-protected` is only supported behind Sites' authenticated dispatcher. The request must have an `oai-authenticated-user-id` present in `VOICE_ALLOWED_USER_IDS`; anonymous visitors are denied. The `DB` D1 binding is mandatory. An atomic insert/update reserves one global lifetime token slot before contacting AssemblyAI. `VOICE_MAX_SESSIONS` is capped by code at 2, defaults to zero, and must reflect explicit owner authorization. Every issued token permits at most 300 seconds; the maximum potential duration is session limit × five minutes. A session-count bound is not a dollar-price guarantee.

The budget does not reset on deployment or per-user login. Concurrent calls cannot exceed it. Provider or storage failures fail closed. Failed token minting consumes a slot; changing/resetting the approved budget is an owner action, never automatic. A secondary in-memory burst limit is supplementary only.

The optional one-session key form is protected by the same signed identity allowlist and durable budget. It is disabled by default. Only the user manually enters and submits an existing key; the app never persists it. It exchanges the key server-side for one temporary token. No unprotected key setup endpoint exists. Do not expose this Worker directly on a different hosting platform while trusting Sites headers. For other hosts, replace this boundary with that platform's verified server authentication.

## Local gate

`local-only` works only when the server's canonical request URL is loopback. A bounded process-lifetime counter applies. Restarting the local server resets that counter, so this mode is inappropriate for a hosted/public service. The dev server uses a canonical localhost origin, not a blindly trusted Host header. Explicit ALLOWED_ORIGIN is needed for another development origin.

## Application integrity

Imported JSON has a 100 KB UI bound and strict schema validation. Unknown mechanics, duplicate rule IDs, invalid numbers, and empty input/output trades are rejected. Model calls use the same validator. Duplicate call IDs, interrupted replies, and stale base revisions cannot silently repeat an edit. Prior evidence remains marked outdated after edits. No imported receipt is trusted; evidence is recomputed.

The solver operates only on fictional integer resources. It is not a financial, security, or global game-balance verifier. Search bounds never become game rules; no clamping can invent a witness.

## Privacy

No analytics, third-party font requests, recording uploads, or external actions. Rulebooks persist only on the current device. Browser transcripts are not persisted or exported. Actual voice use transmits microphone audio and rulebook/evidence to AssemblyAI, whose own data policies apply. Stop releases the microphone and scheduled playback. Synthetic tests never call the real provider.
