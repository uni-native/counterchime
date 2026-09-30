# Verification status

Last updated: 2026-09-30 06:55 UTC

- Production build: passed, React/Vite client plus Worker ESM entrypoint
- TypeScript: passed (strict)
- Automated tests: 103/103 passed (latest implementation pass; category breakdown below describes the earlier 90-test baseline)
  - 41 engine tests, including independent reference comparison over 576 small economies
  - 11 session/correction/undo/import/export tests
  -5 static React-render/ID tests (not browser QA)
  - 6 token endpoint access/budget fail-closed checks
  - 21 synthetic offline voice/protocol/audio lifecycle tests
  -6 synthetic session-only key exchange/cleanup tests
- Real AssemblyAI calls: not run; usage up to $1 of existing free credit approved, but no API key or live runtime configured
- Actual speech extraction/correction latency: not measured
- Real browser manual QA: public UI render, timber growth witness, complete replay, manual 3-to-2 correction, bounded negative result, undo and retest verified. Export completion, import, responsive browser behavior and live audio remain unverified.
- Site deployment: succeeded; current public UI at https://counterchime.jackyo.chatgpt.site
- Public Site access: explicitly authorized and enabled2026-09-30 05:59 UTC; offline UI requires no sign-in
- Built Worker request checks: HTML, favicon, AudioWorklet and voice-status routes pass; no provider calls
- SQLite concurrency check:20 parallel budget reservations against limit3 admitted exactly3;17 denied
- npm production dependency audit:0 reported vulnerabilities at verification time

Synthetic protocol tests are not a live voice demonstration. Locally computed witnesses are genuine deterministic engine outputs, not provider-generated results.

The local UI smoke script covers page identity, nonblank render, runtime errors, canonical growth, repair, undo, stale evidence, retest, unreachable loop, three-resource loop, replay, export, disabled voice, mobile overflow, and reload persistence. Its presence does not mean it has run successfully. Status will be updated after a supported preview route is available.

## Focused readiness fixes

- Collision-proof new rule IDs after reload/import resets local revision numbering
- Voice undo now requires a matching base revision, protecting newer manual/import edits
- Unknown voice tool fields are rejected instead of silently dropping unsupported mechanics
- Import stays visible on narrow phones; replay steps have keyboard-operable buttons and an accessible table caption
- Live voice explains disabled/viewer/setup states and exposes a recheck; configured status does not claim successful provider access
- A synchronous session guard prevents duplicate rapid Start clicks; stale-client status callbacks are ignored

Genuine live test plan: live-demo-protocol.md. Live provider and remaining browser QA gates remain open.

## Optional session-only key flow

Protected BYOK implementation passes synthetic tests and read-only security review. No actual API key or live provider call was used. Entry requires normal Sites sign-in, verified site-specific identity allowlisting, D1, HTTPS, exact origin, both enable flags and a two-attempt lifetime budget. All runtime voice settings remain unconfigured/disabled. See session-key-setup.md.

Public visitor-owned key entry is enabled on the hosted demo with an exact-origin HTTPS boundary and two durable five-minute allocations. Stored-key access remains protected, and no stored key is configured. A real provider connection has not yet been verified.
