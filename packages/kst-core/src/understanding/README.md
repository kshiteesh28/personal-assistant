# Adaptive understanding developer guide

The production algorithm is feature-hashed multiclass Passive-Aggressive I with int8 deployment, a C++17 Node-API 9 addon, and a compatible JavaScript fallback. Swift keeps Apple on-device recognition and the single default Apple voice.

## Build and verify

From the repository root:

```sh
npm run kst:ml:build
npm run kst:ml:test
node --test packages/kst-core/test/*.test.mjs
node --test packages/kst-web/app.test.mjs
swift run --disable-sandbox --package-path apps/macos KstNativeChecks
npm run kst:package-mac
```

No new model, paid inference service, Python runtime, or additional voice download is needed. Build uses the installed clang++ and Node headers. Set `KST_NODE_INCLUDE` to the directory containing the supported runtime's `node_api.h` if headers are not adjacent to Node. The native build currently targets macOS 14+ arm64. Missing addon uses the same artifact through JavaScript.

## Rollout

`KST_UNDERSTANDING_MODE=off|shadow|active` defaults to `shadow`. Off and shadow preserve the existing execution path. Shadow produces bounded aggregate comparisons, with no personal feedback collection or training. Asking for active mode without a valid release-readiness report falls back to shadow with an explicit activation reason in authenticated status. UI learning settings do not override rollout gates.

The current packaged seed is development scaffolding. `resources/understanding/seed-manifest.json` and `evaluation-report.json` record measured counts, actual performance and outstanding evidence. Automatic classifier policies are disabled. Synthetic repeated paraphrases are not independent release cases. Do not mark the feature released by editing a boolean: complete section 23 of the design, generate a report bound to the seed SHA-256, and review the full integration results.

## Files and ownership

- `registry.mjs`, `features.mjs`, `model.mjs`, `replay.mjs`: fixed contracts, sparse feature codec, reference arithmetic and model format.
- `extraction.mjs`, `interpreter.mjs`: pure text/date/field parsing and critical fixture evaluation.
- `dialogue.mjs`, `ledger.mjs`, `coordinator.mjs`: bounded live discussion, original request receipts, executor admission and recovery.
- `storage.mjs`, `learning.mjs`, `training-worker.mjs`: compact personal data, explicit feedback, idle training and atomic promotion/privacy changes.
- `runtime.mjs`: profile lifecycle, seed/runtime loading, release gate and service integration.

Runtime personal data is under the private application profile, never the repository. Personal storage limits exclude existing secretary records and the operational request ledger; status reports resource accounting separately. Original action payloads can be present in that existing operational ledger for durable replay. Learning reset erases learning data, not secretary records or operation receipts.

## Failure recovery

Keep the profile owner lock authoritative. Never automatically remove a live or unverifiable owner lock. An unclean native session leaves `understanding-native-session.json`; after lawful profile recovery it forces JavaScript fallback. Re-enable native execution only by explicitly reviewing the failed run and removing that sentinel with the core stopped. The app does not guess that an old PID is safe.

Learning I/O errors pause learning rather than discard user records. A privacy generation barrier invalidates old personal models before cleanup. An uncertain browser/provider dispatch retains its request receipt and is not automatically repeated. Training cancellation uses a shared atomic flag; lifecycle close awaits the worker before closing databases.

## Review surfaces

The paired dashboard exposes learning enable/promotion pause, status, corrections, confirmed expression previews, forgetting, idle training, rollback and reset. These routes retain bearer authentication and loopback host/origin validation. The native app carries context revisions, reports voice/thermal/idle state, and preserves pending request IDs during network failures. Only final speech transcripts reach the conversation API.
ëŽ