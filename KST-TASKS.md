# kst implementation tasks

Product name: **kst**. Blueprint: [Jarvis implementation plan](JARVIS-IMPLEMENTATION-PLAN.md).

This is a staged application build. A task is complete only after its implementation and verification are recorded. Live personal databases are not development fixtures. Milestones below preserve earlier verification records; the latest state is milestone 4.

## Milestone 1 — runnable foundation

| ID | Task | Owner | Status | Acceptance |
|---|---|---|---|---|
| KST-001 | Inspect existing app and establish isolated development profile | Coordinator | Complete | Original task/calendar databases untouched |
| KST-002 | Sage Mode eyes logo and project assets | Coordinator | Complete | Generated asset saved in `assets/kst/kst-logo.png` |
| KST-003 | Native menu bar/window, default Apple TTS, singleton, Stop | Native subagent | Development app built and signature verified | Hardware speech validation remains pending |
| KST-004 | Local authenticated core and typed discussion | Core subagent | Implemented; socket validation blocked | Node 22 built-in SQLite; HTTP bind denied by tool sandbox |
| KST-005 | Per-request external approval and failure receipts | Core subagent | Complete for preview | Approve records an unavailable-provider receipt; no outbound call |
| KST-006 | Persistent development state and restart recovery | Core subagent | Complete for scratch domain | Idempotency/restart/corruption tests pass; final native broker pending |
| KST-007 | Local nudge rules with suppression and cooldown | Core subagent | Complete for fixtures | Real activity/calendar collectors remain pending |
| KST-008 | kst dashboard, approval UI, settings, status | Dashboard subagent | Implemented; browser QA pending | Syntax/DOM checks pass; no repeated automatic mutation |
| KST-009 | Unified start/doctor/test commands and handoff | Coordinator | Complete | `scripts/kst.mjs` and `KST-README.md` |
| KST-010 | Integration verification and failure review | Coordinator | Partial; environment gate recorded | Nine core tests + native checks pass; HTTP test blocked by EPERM |

## Following milestones

| ID | Task | Status | Gate |
|---|---|---|---|
| KST-011 | Shared Personal Secretary repositories and data migrations | Implemented through milestone 3 | Shared-write opt-in and verified backups; real source not mutated in development |
| KST-012 | Native Apple STT and configurable wake detector | Implemented through milestone 3 | Hardware permissions/recognition gate remains |
| KST-013 | Multi-turn voice and interruption | Turn-taking lifecycle implemented; hardware gate pending | Full-duplex echo/barge-in remains pending |
| KST-014 | Durable native authority and supervised process locks | Trusted-recipe supervision implemented | Arbitrary detached-code confinement remains excluded |
| KST-015 | iTerm inventory and supervised recipes | Implemented through milestone 3 | OS Automation gate; existing human-pane writes remain disabled |
| KST-016 | Native activity/calendar collectors and real nudges | Implemented through milestone 3 | Hardware notification/activity validation remains |
| KST-017 | ChatGPT/Codex/Claude/web adapters | Implemented through milestone 4 | Live account/authentication, installed Codex policy and browser validation remain |
| KST-018 | Signed distribution, login lifecycle, backup/upgrade | Pending | Fresh-profile install and restore |
| KST-019 | iPhone companion and secure device synchronization | Later | Mac/shared data stable; pairing and remote-job authorization |

## Milestone 2 — source context and native voice

| ID | Work | Owner | Result |
|---|---|---|---|
| KST-020 | Read-only Personal Secretary adapter | Core subagent | Complete: bounded transactional snapshots, explicit approved source, freshness and source failures |
| KST-021 | Source API and typed/spoken read commands | Coordinator | Complete: paired `/api/secretary`; `show secretary tasks/calendar/reminders/notes` |
| KST-022 | Production HTTP handler extraction and no-socket verification | Coordinator | Seven handler tests pass; real socket integration remains environment-blocked |
| KST-023 | Source dashboard and stale/private-data recovery | Dashboard subagent | Complete; five behavioral tests pass, browser visual QA pending |
| KST-024 | Native on-device push-to-talk and follow-up listening | Native subagent | Compiles and lifecycle checks pass; microphone/route/offline validation pending |
| KST-025 | Rebuild and sign the updated Mac bundle | Native subagent | Complete: `apps/macos/build/kst.app` |

Coordinator verification: 25 core tests and five dashboard tests pass. The one real-socket test still fails with sandbox `EPERM`; it is retained. Native lifecycle checks pass, including duplicate final transcripts, stale turns, and stopped-session callbacks. The source adapter also returned a fresh read-only snapshot of the existing project database; only status/counts were inspected, with no source record changes. No microphone permissions were requested and no audio was captured during build/testing.

## Milestone 3 — arise and full local secretary workflows

| ID | Task | Owner | Status | Acceptance |
|---|---|---|---|---|
| KST-026 | Default phrase `arise` and actual on-device phrase gate | Native + core | Implemented; hardware gate pending | Exact configurable phrase activates a discussion; no hidden old trigger |
| KST-027 | Calendar/meeting/reminder/task/note workflow service | Core | Implemented and tested | Persistent writes with idempotency, ambiguity clarification, same typed/voice path |
| KST-028 | Planner proposals and daily timeline | Core | Implemented and tested | Conflicts/revisions checked; confirm plan is conversation-scoped; expired proposals refused |
| KST-029 | Due-reminder and meeting notification ledger | Core + native | Implemented; OS delivery gate pending | Restart deduplication, snooze/dismiss; no fake notification delivery claims |
| KST-030 | Real coarse activity observations and nudges | Native + core | Implemented; real-device gate pending | Idle/lock suppression, private metadata, retention/cooldown, actual work checkpoints |
| KST-031 | Supervised project recipes, cancellation and quarantine | Terminal subagent | Implemented for trusted recipes | Real process outcomes, conflicting resources excluded, no uncertain replay; detached-code confinement excluded |
| KST-032 | Explicit iTerm session inventory and owned-job display | Terminal subagent | Implemented; OS Automation gate pending | Explicit observation/new-window viewer; no blind typing into human panes |
| KST-033 | Transparent eye-only logo in app and dashboard | Coordinator + native | Complete | Source alpha zero around/between eyes; transparent aspect-fit ICNS; no tile/distortion |
| KST-034 | Workspace/terminal dashboard and integrated delivery | Coordinator | Implemented; visual QA pending | Snapshot status accurate, pending/stale responses cannot repaint after disconnect |

Wake implementation uses the installed Apple on-device speech engine as a phrase gate. It does not install a general-purpose LLM or a dedicated wake-model pack. Hardware accuracy, offline behavior and armed-mode CPU measurements remain explicit release checks. No microphone is activated by build/test commands.

Coordinator verification: **66 core tests + nine dashboard tests pass**, including real process execution/cancellation, old Stop replay safety, source backups, domain writes, source-compatible statuses/FTS, activity retention, planner expiry/conflicts, notification deduplication, request validation, and private-data clearing. Native wake/session/activity invariant checks pass. The real-socket test remains visibly failing at sandbox `EPERM`; it is not counted as passed. Hardware voice/OS-notification/Automation validation remains pending.

Requested local secretary features are implemented. This does not mean every feature in the original broad PRD is production complete: live provider account setup, external calendar sync/invitations, existing human-pane writes, arbitrary untrusted process confinement, iPhone sync, and full-duplex audio remain unimplemented or gated. These boundaries are also stated in `KST-README.md`.

## Milestone 4 — real approved external help and access validation

| ID | Task | Owner | Status | Acceptance |
|---|---|---|---|---|
| KST-035 | Shared-source effective-access preflight | Coordinator | Implemented and tested | Check source, sidecars and parent before backup; no unnecessary same-UID requirement for explicitly imported source; symlinks rejected |
| KST-036 | OpenAI/Claude prompt-only adapters | Coordinator | Implemented; live account gate | Explicit model/key, exact approved text, no tools/history/files, fixed deadlines/output bounds |
| KST-037 | Bounded read-only Codex adapter | Coordinator | Implemented; installed-policy gate | Specific project scope, offline canary probe before model use, no writes/tool network/web search, no bypass flags |
| KST-038 | Chrome Incognito search handoff | Coordinator | Implemented; browser validation pending | No approval; opens a new visible Incognito window; no result fetching or return |
| KST-039 | External request ledger and approval replay safety | Coordinator | Implemented and tested | Scope/config hash, discussion-bound decisions, one operation at a time, no retry/fallback, late-result/cancel/restart uncertainty |
| KST-040 | Provider results in dashboard/native discussion | Coordinator | Implemented and tested/compiled | Plain text, safe disconnect handling, explicit spoken result request, visual background results |
| KST-041 | Setup contract, development app 0.4.1 and release checks | Coordinator | Packaged development build; live gates remain | Configuration/limitations in `EXTERNAL-SERVICES.md`; no live billable calls or microphone activation |

Latest verification: **88 core tests and 11 dashboard tests pass**, plus native invariant checks. The one real-socket integration test still fails at sandbox `listen EPERM` and remains in the suite. External tests use synthetic keys and fixture transports/processes. The real Personal Secretary source passed a non-mutating effective-access check despite its different UID; it was not opened for writing. Native voice accuracy/offline behavior, notifications, Automation, real provider authentication, Codex scope enforcement and browser handoff require real-device validation. The app is a locally signed development build, not a notarized distribution release.

Final native settings review reproduced a protected-data attribute permission failure on an otherwise writable volume. Atomic saves now rely on the private directory and owner-only file mode; the native checks verify the saved mode as well as roundtrip/corruption behavior.

## Failure handling contract

- Display unavailable adapters as unavailable. Never invent successful speech recognition, terminal execution, calendar synchronization, or provider responses.
- Core unavailability leaves the native Stop and UI available; retry only safe health checks automatically.
- User requests have stable IDs. After uncertain acknowledgement, reuse the request ID or reconcile; do not create a new command by automatic retry.
- External use requires a concrete approval each time. A failed/unconfigured service remains failed, with no automatic provider switching.
- Persist enough job status for restart reconciliation; in-flight work becomes unknown/quarantined until proven resolved.
- Keep state directories private; credentials never appear in URLs or routine logs. Reject untrusted HTTP origins and oversized/malformed payloads.
- Keep logs bounded, exclude raw audio and secrets, and surface actionable errors with correlation IDs.
- Stop accepting work during shutdown; close listening/output and settle or quarantine owned jobs before releasing ownership.

## Environment findings

Node and Swift command-line tools are available. Full Xcode and Bun are absent. Homebrew writes are blocked in this environment and the shell cannot resolve the runtime-download host. The first core therefore uses installed Node with no external package dependencies; the existing Bun application remains the domain-integration target for the next milestone.

## Verification record

- Coordinator ran core tests: **9 pass, 1 fails at the environment's localhost `listen` permission boundary (`EPERM`)**. The HTTP integration test is retained and reports failure; it has not been skipped or reclassified as passing.
- Coordinator ran `swift run --disable-sandbox KstNativeChecks`: passes endpoint, wake validation, settings persistence/corruption, and singleton checks. Native subagent also verified the debug app build.
- Dashboard subagent checked JavaScript syntax, 43 unique DOM IDs, and 25 literal ID references. Browser interaction and visual QA remain pending a reachable running core.
- The logo route mismatch was caught during integration review and corrected with an exact static asset alias.
- Additional review corrected prototype-key request IDs, stale callbacks after Stop/disconnect, native manual-retry IDs, and duplicate wake-setting ownership.
- Release-build symbol tooling encounters sandbox restrictions. This milestone packages a debug development app; distribution signing/notarization and real audio validation are not complete.
- Coordinator verified `apps/macos/build/kst.app`: ARM64 executable, ICNS logo present, local code signature verification succeeds. No microphone permission or live personal-data access was requested during verification.
