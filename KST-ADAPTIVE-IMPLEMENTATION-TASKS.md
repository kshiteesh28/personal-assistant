# Adaptive understanding implementation tracker

Updated 7 November 2026. Scope: revision 3 plus recorded clarifications. Master coordinated three delegated components: ML kernel, interpreter/coordinator, and learning/storage. All changes remain local.

“Implemented” describes delivered code and listed automated evidence. It does not certify every release requirement. Active release is blocked; see KST-ADAPTIVE-RELEASE-REPORT.md.

| Task | Owner | State | Delivered evidence / remaining work |
|---|---|---|---|
| U01 registry / contracts | ML | Implemented | Fixed 27 labels, 32 rows, bounded feature/model/replay validation, mode validation. |
| U02 extraction / dependency | Interpreter | Implemented, broader semantic coverage pending | chrono-node pinned 2.9.0; explicit spans; AM/PM, timezone/DST, date-follow-up tests. |
| U03 corpus / calibration | ML | Partial; release blocker | Versioned seed and replay, grouped scaffold, distinct negative groups, calibration implementation. Independent development/calibration/test minimums unmet; auto policies disabled. |
| U04 JS PA-I / codecs | ML | Implemented | Deterministic PA-I, PCG, int8 artifacts, corrupt-data and parity tests. |
| U05 native kernel | ML + master | Implemented | arm64 C++17 addon compiled; scoring/training parity; included and signed in app resources; JS fallback. |
| U06 comparisons | ML | Partial; release blocker | Logistic-SGD comparison recorded; fastText unavailable. No production algorithm substitution. |
| U07 extraction / dialogue | Interpreter | Implemented, release coverage pending | Shared pure parser, field questions, bound confirmation, date follow-ups, correction flow, scoped reads, bounded fuzzy suggestions. |
| U08 coordination / recovery | Interpreter + master | Implemented, exhaustive crash trials pending | Operational receipts, child IDs, replay/hash conflict, executor reconciliation, transactional target checks, Stop races, 202 polling. |
| U09 learning store / API | Learning + master | Implemented | Separate bounded SQLite, explicit evidence, correction replacement, previewed templates, anchored matching, settings/feedback/reset routes. |
| U10 training / privacy | Learning | Implemented, exhaustive crash trials pending | Idle worker, atomic cancellation, promotion checks, generation barrier, reset replay, pin-aware retention, rollback and fault tests. |
| U11 clients | Master | Implemented, live hardware validation pending | Dashboard controls; native/browser revisions, pending polling, error recovery; native voice/idle/thermal heartbeat. |
| U12 speech hints | Master | Implemented | Wake phrase and short capability vocabulary, capped at 100; existing final-only speech submission. |
| U13 release validation | Master | Partial; release blocker | Automated regressions, measured classifier/extraction/worker timing and empty-profile allocation. Independent action corpus, full crash matrix, maximum-data resource trials and live voice trials remain. |
| U14 app build / activation | Master | Shadow build completed; activation blocked | Matched 0.5.0 core/native, bundle 12 built and locally signed. Production mode remains shadow. |

## Failure handling

The existing profile owner lock remains authoritative. A surviving native-session sentinel forces JavaScript after lawful owner recovery. Missing/corrupt models use eligible fallback or compatibility commands. Learning errors pause collection; privacy barriers invalidate personal models before deletion. A failed candidate leaves the active pointer intact. Unknown external effects keep a reviewable receipt and are never automatically repeated. Training cancellation is shared atomic state, and shutdown awaits the worker before closing databases.

## Design clarifications made during coding

1. Added paired GET `/api/understanding/preview` for the existing explicit remember workflow. The subsequent remember POST acknowledges the shown live template; replay resolves the original operation before checking expired candidates.
2. Explicitly remembered preferences pin their backing examples beyond 90 days until forgotten. Other evidence expires after 90 days; all count/byte caps continue to apply.
3. Active mode requires a release-readiness report bound to the seed hash. An active request with incomplete evidence becomes shadow and exposes its activation blocker.

No GitHub commits or pushes were performed.

## Continuation evidence

Build12 fixes the reported possessive read/coalesced Stop case. Full coordinator latency, saturated allocated-block budgets, real process crashes, and chronological worker evaluation now have reproducible JSON reports. The release checker binds named gate results to source, seed and evidence hashes. Activation remains blocked by the independent corpus, automatic-policy accuracy, hardware/socket evidence and fastText comparison; see the current release report.
