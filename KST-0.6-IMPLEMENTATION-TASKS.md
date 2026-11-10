# KST 0.6 implementation and release task tracker

Coordinator: master. Contract: revision 5 of [Google sync and dictation plan](KST-0.6-GOOGLE-SYNC-AND-DICTATION-PLAN.md). Closeout: [release report](KST-0.6-RELEASE-REPORT.md).

The implementation is present in the working tree and builds as an optimized, ad-hoc-signed developer preview. “Code implemented” describes delivered source; “release blocked” describes missing validation or environmental prerequisites. No task below is represented as a completed production release. No GitHub push is authorized by this request.

| ID | Owner / coordination | Implementation state | Release gate / evidence |
|---|---|---|---|
| R01 | Master + Google core | Implemented | Core contract and dialogue tests pass. |
| R02 | Master | Blocked | Audited MIME dependencies need registry access; actual Google Desktop OAuth client configuration is not present. Setup documented. |
| R03 | Google native | Implemented | OAuth/PKCE, identity and scope checks, Keychain credentials, generation barriers, authenticated local broker and encrypted envelopes. No live consent/account validation. |
| R04 | Dictation + master | Implemented | Shared native audio engine, mode coordinator, v2 heartbeat, ML training inhibition and hands-free “start typing” voice handoff. Live capture/latency validation pending. |
| R05 | Dictation | Implemented | AX target lease, nonactivating overlay, secure-field/focus guards. Cross-app live compatibility pending. |
| R06 | Dictation | Implemented | Final-only Unicode insertion, event/readback receipts, bounded cancellation. OS-posted events cannot be retracted; live typing test pending. |
| R07 | Dictation | Implemented with limitations | Configurable shortcut, hands-free voice start, literal iTerm prompt validation and Copy fallback. iTerm requires shell integration and a fresh positive shell-prompt check. Terminal.app is unsupported; required compatibility gate blocks release. |
| R08 | Google core + master | Implemented | Bounded transport, strict wire decoding, durable effect admission and uncertain-write handling; automated tests pass except environment-blocked listener test in full suite. |
| R09 | Google core | Implemented | Gmail metadata/plain-text reads, history cursor and immutable draft/send flow. MIME parsing/composition awaits audited packages and live account. |
| R10 | Google core | Implemented | Calendar synchronization, availability, direct range reads and stale/cursor recovery. Live provider validation pending. |
| R11 | Google core | Implemented | Preview-confirm Gmail actions; separate immutable send proposal and durable receipts. Dependencies and sandbox account block live verification. |
| R12 | Google core | Implemented | Etag-protected event writes and per-child plans. Live provider validation pending. |
| R13 | Google core + master | Implemented | Deterministic dialogue routing before transcript persistence, explicit destination clarifications and request receipts. Dialogue contracts pass. |
| R14 | Master | Implemented | Native settings/status, dashboard previews, bounded nudges, RAM-only receipts and v2 capability handshakes. Dashboard tests pass; live app/provider and permission validation pending. |
| R15 | Master | Preview built | Optimized `kst.app`, bundle version 0.6.0 (17), code-sign verification pass with ad-hoc identity. Stable Developer ID, migration/restore and signed-update validation pending. |
| R16 | Master | Partial; release blocked | Final source-bound automated evidence recorded. Full acceptance/live matrix, resource/latency measurements, audited dependencies, OAuth and stable signing evidence are incomplete. |

## Delegation and ownership

Work was split by disjoint files: `dictation_06` (native capture/insertion/iTerm), `google_native_06` (native OAuth broker and Google dialogue), `google_core_06` (Google runtime/cache/actions/tests), and master (integrations, dashboard, release coordination). Their completed reports are summarized above. The final review found and integrated shared-boundary fixes for Stop acknowledgment, stale capability flags, voice draft-to-send references, long-search deadlines, and disconnected late dashboard receipts.

## Coordinator closeout

Do not activate 0.6 as a production release while any R02/R07/R15/R16 gate is blocked. A local developer can proceed using [`apps/macos/Google/SETUP.md`](apps/macos/Google/SETUP.md), then install and audit the exact MIME packages, provide their own Desktop OAuth client file, and run the live matrix on a Mac with the required permissions and signing identity. See `packages/kst-core/resources/google/release/readiness.json` for the machine-readable gate result and `KST-0.6-RELEASE-REPORT.md` for the detailed evidence and limitations.
