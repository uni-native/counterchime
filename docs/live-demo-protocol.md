# Genuine demonstration and release gate

This is a test plan, not a record of completed live tests. No synthetic event fixture counts as AssemblyAI success.

## Prerequisites

1. Open the public Site and verify the actual rulebook is visible.
2. Enable only the explicitly approved voice mode and durable two-session budget. In optional public BYOK mode, the user personally enters and submits their own existing key in the password field. Never inspect or record the filled field. Stored-key mode remains owner-allowlisted. Never paste a key in chat, screen recordings, URLs, source, or browser storage.
3. Click **Recheck voice setup**. Configuration readiness is not proof of provider access. Confirm the intended key-entry mode is configured before continuing.
4. Use current Chrome/Edge on HTTPS with audible output, microphone permission, and a quiet environment. Do not record credentials, private account pages, or unrelated personal information.

## Three-resource live sequence (recommended)

1. Choose **Three-way arbitrage**. Explain this initial rulebook is a local example: 2 wood → 1 stone → 1 star → 3 wood. Initial inventory is [2,0,0].
2. Start a genuine session through the user-operated key form. Confirm provider connection, microphone indicator, audible reply, and actual transcript before calling it live.
3. Say: “Read all three rules, then test the economy and explain the complete loop.” Verify actual inventories [2,0,0] → [0,1,0] → [0,0,1] → [3,0,0], one extra wood, and replay.
4. Say: “Change the third rule, Timber trade: consume one star and produce two wood instead of three. Keep the first two rules unchanged.” The upsert_rule tool must use index3 and current base_revision, preserving the first two rules. Result must be bounded negative, not proof of balance.
5. Say: “Undo the last change, then replay the growth loop.” Verify restored output3, fresh revision, exact three-step receipt.
6. End voice and confirm microphone/audio cleanup. Retain genuine audio, transcript, rule revision, and exported receipt. No live outcome is claimed until observed.

## Two-minute simpler live sequence

1. Load **The timber exchange**. Confirm initial inventory wood2/stone0/stars0 and rules 2wood→1stone,1stone→3wood. Explain that this initial example is local.
2. Start the voice session. Verify actual session-ready/listening status and a provider-spoken greeting. This is the first point that may count as a real provider connection.
3. Say: “Test the economy.” Check that a genuine tool response produces the on-screen verified +1wood loop and exact inventories [2,0,0]→[0,1,0]→[3,0,0]. Listen for an explanation grounded in those values.
4. While it speaks, say: “Wait. Change the second trade to give two wood instead of three.” Verify scheduled speech stops, only the second output changes, a new rulebook revision appears, and the result says no loop found within limits. It must not say the economy is proven balanced.
5. Say: “Undo that change.” Verify a fresh revision, restored second output3wood, and the +1wood witness. An edit made after a staged undo must be protected by a stale-revision rejection.
6. Say: “Replay the counterexample.” Verify the step display advances through actual inventories.
7. End the session. Check the browser microphone indicator stops and no further agent audio plays. Record actual observed outcome and any failures.

## Offline regression checks in the same browser

- Export the session, change one rule, import that JSON, and confirm rules restore and evidence is freshly recomputed
- Select **The locked star loop**: no reachable growth from its starting inventory
- Select **Three-way arbitrage**: valid three-resource witness
- Add third rule, remove first rule, reload, then add another rule: no duplicate-ID failure
- Tab to replay step buttons, use Enter/Space, and move the range slider with arrow keys
- At390px and320px widths, verify Import/Export remain reachable and the rule editor has no page-wide overflow
- Change a rule manually: old receipt is marked outdated until **Test economy** runs
- Disabled voice must remain clearly identified; local commands must remain labeled as a local parser

## Evidence to retain

Use one continuous recording for the real sequence; keep UI and audio synchronized. Record browser/version, actual time, transcript-to-edit latency, each rule change, interruption behavior, session-end cleanup, and exported JSON. Do not insert simulated provider responses or label a local walkthrough as live speech recognition. If any part fails, report it and rerun only after a concrete fix.

## Remaining release gates

- Remaining public-site responsive/export browser QA
- Real AssemblyAI microphone-to-tool-to-audio validation, including correction and interruption
- Public repository, genuine demo video review, and verified final event submission (coordinated separately)

## Prerecorded synthetic input option

Choose **Prerecorded synthetic test voice** before personally submitting the key. No microphone is requested in this mode. Select the existing Three-way arbitrage economy, then use the four visible utterance buttons one at a time, waiting for actual agent responses. Local Flite-generated audio is streamed in real time through the same AssemblyAI connection and tool pipeline. No sample text is sent as a tool command or inserted as a recognized transcript.

**Export actual test evidence** downloads client-memory JSON containing timestamped real provider transcript/audio events, actual tool results and rulebook snapshots, and disclosed synthetic-input IDs/text. It omits API keys, temporary tokens, resume tokens, and raw session configuration. Received audio is PCM16 little-endian mono24kHz in base64 chunks. It may include interrupted/unplayed output: preserve event timestamps and interruption records when editing a video, rather than blindly concatenating every chunk. This export is evidence data, not a finished screen recording. It is bounded at24MB/10,000events and labels truncation. Nothing is uploaded or persisted server-side. Export before leaving or starting another session.
