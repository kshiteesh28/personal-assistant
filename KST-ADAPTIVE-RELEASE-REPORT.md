## Latest evaluation update

The held-out set now contains 551 audited requests (387 supported actions and 164 unsupported/non-command requests). The unchanged seed scores 368/387 (95.09%) on supported actions and 505/551 (91.65%) overall. Twenty-one new behavior checks pass. Exact split-overlap exclusions and per-case readable predictions are retained in the JSON report. See KST-EXPANDED-TEST-REPORT.md. These measurements supersede the older smaller-set accuracy numbers below; release coverage minima remain unmet.

# Local activation update — user requested

The user explicitly requested ML activation despite the unfinished release gates. A private local preview activation is configured; this does not mark the release gates as passed. Model-selected actions continue to require interpretation confirmation, automatic model-only read/web policies remain disabled, and external AI approvals remain in force. Learning retains only explicitly confirmed evidence.

The current app is build16. The running older core must restart normally to load the setting. Automatic restart was rejected by the tool environment with `kill EPERM`; no lock was removed. After restarting, “status” reports “ML understanding is active.”

# KST adaptive understanding release report

Application: **0.5.0 (12)**. Decision: **shadow mode; activation blocked by unmet evidence**.

## Changes completed in this continuation

- Fixed the reported spoken request: “show my tasks” now works through the compatibility parser. A coalesced bounded read followed by “stop” cancels the turn locally; note/search payloads containing the word stop remain data. Native and HTTP regression checks pass.
- Added a full coordinator benchmark, including durable receipts, policy, dialogue and authoritative lookups.
- Added saturation and process-crash tests: full personal storage, overlapping candidate/journal allocation, eleven ENOSPC boundaries and four abrupt process exits.
- Added a chronological evaluation through the actual bounded learning service, idle scheduler, worker and promotion gates. Future test labels are never exposed to training.
- Added integrated conformance cases using the shipped seed and fake external executors. Critical worker fixtures now evaluate the real coordinator and effects, rather than only the pure parser.
- Replaced duplicate feature padding with distinct raw command constructions. Classifier evaluation now uses the same preclassification masking pipeline as production.
- Added release commands and source/seed/evidence hashes. Missing, changed or incomplete evidence cannot authorize activation. An authorized activation writes a private configuration for the next normal core start.

## Current measurements

- Core: 192 tests, 191 passed. One socket test fails with the environment's `listen EPERM`; handler integration tests pass. Dashboard: 11/11 passed. Native invariant checks pass.
- Full coordinator worst p95: **0.411 ms**, five runs of 10,000 requests, including bounded reads, negative requests and clarifications. Excludes speech/TTS and external executor latency.
- Saturated profile: **256 examples, 32 preferences, 65,536 bytes** of personal payload. Allocated steady data **585,728 bytes**, peak **806,912 bytes**, including seed/replay, personal models, candidate and full SQLite journal. Both remain within the design caps.
- Chronological stream: **324 feedback events, 32 worker attempts**. Untouched test score 132/142 before and 132/142 afterward. No improvement is claimed.
- Independent in-domain diagnostic test: **74/78 (94.87%)**. This is below the 95% target and uses only three test constructions per action, so minimum release coverage remains unmet.
- Packaged action corpus: 40 train / 10 calibration constructions per action; development target remains 120/40/80 with 500 independent out-of-scope tests. All automatic classifier policies remain disabled until calibration and release precision gates pass.

## Machine-checked gates

| Gate | Result |
|---|---|
| corpus | INCOMPLETE / BLOCKED |
| accuracy | INCOMPLETE / BLOCKED |
| automatic-policy | INCOMPLETE / BLOCKED |
| conformance | INCOMPLETE / BLOCKED |
| adaptation | PASS |
| storage-privacy | PASS |
| voice-parity | INCOMPLETE / BLOCKED |
| performance | PASS |
| regressions | INCOMPLETE / BLOCKED |
| hardware | INCOMPLETE / BLOCKED |
| classifier-comparison | INCOMPLETE / BLOCKED |

The conformance catalog records 29 of 31 scenarios passing in component/integration checks. T20 and T30 still need live voice responsiveness and extended armed-mode trials. A real user voice trial returned the compatibility fallback message; this prompted the build-12 command/Stop fixes. That failed trial is not counted as passing hardware evidence.

## Work still required for activation

1. Complete the independent train/calibration/test corpus and full field/action equality checks; meet 95% accuracy and automatic-read/web precision/OOS targets.
2. Complete the fastText development comparison. No binary is installed, and no model or paid API was downloaded.
3. Repeat live Mac validation with build12: wake, request, spoken reply, Stop, armed training interruption, Chrome display and configured terminal/provider behavior. Clear the socket test in an ordinary Mac execution environment.
4. Re-run the evidence commands after changes. A passing report must remain bound to the current source, seed and evidence hashes.

## Commands and activation

```sh
npm run kst:release:check
npm run kst:release:activate
```

The activation command runs checks and refuses activation while any required gate is incomplete. On success it writes `understanding-activation.json` into the private core profile; the next normal core start uses active mode only while all matching release evidence remains valid. Existing profile owner locks remain authoritative. No running core is killed by the activation command.

The rebuilt app is `apps/macos/build/kst.app`. Quit and reopen it normally to load build12 and restart its owned core. No GitHub push occurred.

Raw evidence: `resources/understanding/{release-readiness,release-corpus-report,adaptation-report,storage-release-report,conformance-report,coordinator-benchmark,regression-report}.json` under `packages/kst-core`.
�