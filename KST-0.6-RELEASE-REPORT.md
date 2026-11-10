# KST 0.6 Google sync and dictation implementation report

Date: 2026-11-08  
Version: `0.6.0-preview.1` (bundle build `17`)  
Source SHA-256: `38fd3feda4bc2811c09e39e7dacc8fd3b3716bc69e8299ef4267fdc547378f29`  
Release readiness: **BLOCKED**

## Delivered

The working tree now contains the 0.6 preview implementation described by the [design plan](KST-0.6-GOOGLE-SYNC-AND-DICTATION-PLAN.md). Google OAuth and token handling live in a native macOS broker with PKCE, Keychain credentials, generation checks, a local authenticated socket, and encrypted payload envelopes. The core adds strict request validation, bounded transport and cache behavior, Gmail and Calendar read/sync flows, explicit previews for writes, durable operation receipts, and no automatic replay when a provider outcome is uncertain. Natural language Google requests route through deterministic rules; ambiguous destination, time, account context, recipients, or targets ask a question. Google reads and actions do not require an external LLM.

Dictation shares the existing Apple speech path, wake configuration, male voice and rate. A mode coordinator arbitrates assistant, dictation and TTS; dictation only inserts finalized speech into a verified foreground target. It uses Accessibility-selected text where available, bounded Unicode key events otherwise, focus/secure-field checks, an overlay, Stop acknowledgement, and event receipts. It does not use clipboard paste. iTerm requires an explicit Automation grant, iTerm shell integration and a fresh positive shell-prompt check; its adapter does not read scrollback or type shell commands. A configurable shortcut and Copy fallback are included. Core runtime-state v2 excludes dictation phases from adaptive-model training.

The native settings and web dashboard include opt-in/status, selected Google capabilities, sync freshness, literal preview rendering and confirmation, bounded nudge status, and transient request receipts. Dictation remains off until enabled. After its wake listener is armed, KST now hands off from an active assistant discussion to dictation for explicit voice commands “start typing”, “start typing for me”, “begin typing”, “start dictation”, or “begin dictation”. In an idle wake state, say the configured wake phrase first, for example “arise, start typing”. The target is announced and only subsequent finalized speech is inserted. Google remains disconnected until a Desktop OAuth client is configured and the user explicitly connects it.

## Verification performed

- Full Node suite before the hands-free voice-command change: **292 tests, 291 passed, 1 blocked by the execution environment**. The existing HTTP pairing/listener test cannot bind `127.0.0.1` because the environment returns `listen EPERM`. The failure and raw TAP output are preserved; it is not counted as a pass. The hands-free command change compiled afterward; the full suites were not rerun after that native routing change.
- Google and release integration subset: **78/78 passed**.
- Web dashboard suite: **11/11 passed**.
- Native invariant/policy executable: passed using `swift run --disable-sandbox --package-path apps/macos KstNativeChecks`. `swift test` is not the configured native test runner.
- Optimized macOS app build: passed. Bundle is `apps/macos/build/kst.app`, version `0.6.0`, build `17`, channel `preview.1`.
- `codesign --verify --deep --strict apps/macos/build/kst.app`: passed for the current ad-hoc signature.
- `git diff --check`: passed at closeout.

The source-bound machine results and logs are in [`packages/kst-core/resources/google/release`](packages/kst-core/resources/google/release/readiness.json). The automated runner reports `releaseReady:false`; its automated logs are stale for the hands-free voice-command source change and must be refreshed. The plan now tracks 83 end-to-end cases; none should be marked as a live pass without case-specific evidence. Automated fakes and policy tests are deliberately not presented as live end-to-end acceptance evidence. The task report files live in that directory's `tasks/` folder.

## Blockers to activation and release

1. **MIME dependencies:** Gmail raw MIME parsing/composition requires the specified `nodemailer` MailComposer and streaming `mailparser`. The registry could not resolve (`ENOTFOUND registry.npmjs.org`), and Bun is not installed to regenerate the existing lock. The manifest intentionally has no invented versions or integrity hashes. Gmail body parsing, draft composition and send remain unavailable with `MIME_SETUP_REQUIRED` until exact versions are installed, audited and locked. Metadata reads and non-MIME functionality remain implemented.
2. **Google connection:** no Desktop OAuth client JSON or consented disposable test account was supplied. No Google account was connected and no real provider request, draft, email, or event write was made. Follow [`apps/macos/Google/SETUP.md`](apps/macos/Google/SETUP.md) to configure a local owner-only client file and test account.
3. **Signing and migration:** no valid Developer ID identity is installed. The preview is ad-hoc signed; it has not been tested through a signed update, quit/reopen permission persistence, or data migration/restore.
4. **Live dictation compatibility:** microphone capture, Accessibility permissions, focus transitions, readback receipts, Chrome Gmail, Google Docs, TextEdit and iTerm were not exercised interactively. Already-posted OS key events cannot be withdrawn by Stop, although subsequent chunks are cancelled when Stop/focus loss is detected.
5. **Terminal.app:** unsupported because the adapter has no verified positive shell-prompt signal. Since Terminal.app is a required target in the plan, this prevents final 0.6 release. iTerm-only support does not satisfy that acceptance gate.
6. **Performance and failure matrix:** native/core RSS, idle CPU, warm mode-switch and insertion p50/p95/max, long-running sync, sleep/offline recovery, crash points, actual live OAuth refresh and account-disconnect races remain unmeasured.
7. **Restricted local networking:** the current execution environment denied the loopback HTTP and Unix socket harness binds. The broker and HTTP handler logic has automated coverage, but live socket transport could not be exercised here.

## Continue from this state

1. Configure a Google Desktop OAuth client and a disposable account using the linked setup guide.
2. In an environment with npm registry access, install and audit exact compatible MIME package versions and update the lockfile. Keep the dependency manifest and source-bound release evidence in sync.
3. Run the release check on the target Mac with local loopback/socket access, microphone and Accessibility permissions, and a valid Developer ID signing identity. Execute every scenario in plan section 27 with source/build-bound logs.
4. Resolve Terminal.app prompt detection safely or explicitly revise the product's required-target contract before claiming release readiness. Do not silently advertise unverified typing.
5. Complete compatibility and resource/latency tests, then regenerate evidence and require the machine readiness checker to report true before describing this as a production release.

No GitHub push or PR was made for this work. The pre-existing local tree contains other unfinished changes; this implementation left them intact and was not committed.
