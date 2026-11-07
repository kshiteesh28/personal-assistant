# kst native Mac shell

This development build provides a menu-bar app, typed multi-turn core conversation, explicit-start local speech input, configurable voice activation, default Apple speech output, native app/idle activity collection, visual notification delivery, a singleton lock, independent Stop, and supervised local-core recovery. Microphone use begins only after the user chooses Start listening or Arm wake phrase and approves the OS permissions.

## Local speech input

The current adapter uses `SFSpeechRecognizer` for one fixed `en-US` locale with both `supportsOnDeviceRecognition` checked and `requiresOnDeviceRecognition = true`. It refuses unsupported/unavailable local recognition and does not fall back to an online service. SpeechAnalyzer is a later replacement after its macOS26 streaming/asset path is tested; this build does not install a second speech engine or any reasoning model.

Click **Start listening** to open a discussion. After microphone and Speech permissions are granted, the app shows a partial transcript. It requests finalization after 1.5 seconds without a changed recognition result, or when you click **Finish turn**. Only a verified final result is sent to the same core conversation route as typed input. Partial results are never executed. You can say “stop listening” or “end conversation” during a listening turn, or use the always-available native Stop control.

Choose **Arm wake phrase** to stay armed for the shared configured phrase (initially `arise`). This is a continuous on-device Apple speech transcript gate, not a trained low-power Porcupine/keyword detector. It matches whole words/phrases, preserves a command spoken after the phrase, and continues the conversation without repeated activation. “End conversation” or discussion inactivity returns an armed session to wake checking; “stop listening”, “disarm”, the native Stop control, locking, and errors disarm it completely. Nonmatching ambient transcripts stay in temporary RAM, are not displayed or sent to the core, and are discarded between bounded recognition turns. No always-on permission is assumed: arm it explicitly after launching or unlocking. Real battery/CPU cost and wake accuracy need hardware measurement.

The microphone pauses while a reply is spoken and resumes after the synthesis completion callback. The UI labels this **turn-taking mode**; simultaneous speech/barge-in is not implemented. Stop, lock/session deactivation, route changes, recognition/permission errors, and uncertain core results close capture. An idle discussion closes after 45 seconds without recognized speech. A nonempty turn exceeding 45 seconds is rejected instead of executing truncated text; finalization has a five-second deadline. PCM audio is passed directly to Apple's on-device request and is never recorded to a file.

Build/invariant checks never request permission or start a microphone. Real microphone accuracy, offline behavior, echo, privacy and hardware playback have not been validated in this coding environment. Run those tests manually in the signed bundle before treating voice input as ready for daily use. A missing local language asset produces an explicit unavailable state; typed input remains usable.

Build and package with the Apple Command Line Tools (full Xcode is not needed for this slice):

```sh
bash apps/macos/build-app.sh
open apps/macos/build/kst.app
```

The generated bundle is a development/debug build. If `iconutil` cannot access its image service in the build environment, the script uses a deterministic PNG-backed ICNS container via the already-required Node runtime. It preserves the generated logo and performs no image generation requests. The bundle includes that logo and is verified with local ad-hoc code signing.

The packaged development app records absolute project-core and Node paths in `Info.plist`. When its loopback health check fails, it starts that configured core. An already healthy core is attached to and never killed by this app. Owned-core startup/recovery is limited to three delayed attempts per app session; missing paths or execution denial are shown clearly. Rebuild the app after moving the project or Node runtime. This local developer bundle depends on those paths; a portable runtime distribution remains future packaging work.

The default endpoint is `http://127.0.0.1:4310`; the client accepts only loopback HTTP and refuses all redirects. `KST_CORE_URL` overrides the endpoint, `KST_DATA_DIR` overrides the core's data directory, and `KST_TOKEN` optionally supplies its pairing token. Otherwise the native app reads `~/Library/Application Support/kst-dev/core/token`. `KST_CORE_ENTRY` and `KST_NODE_PATH` override supervised runtime paths. Launch via the executable from a terminal when using environment overrides; Finder does not inherit an arbitrary terminal environment.

No response is automatically resubmitted on timeout, because it could have been accepted before the connection was lost. The same pending typed request retains its request ID for a manual retry within this app session. Stop cancels local waiting and speech immediately, and requests `/api/stop` to revoke core pending work. It cannot undo an already accepted write. Stop/restart clears the local pending request; check core receipts before submitting the same operation again. Discussion display is bounded to 80 messages.

Native speech-output preferences live at `~/Library/Application Support/kst-dev/native/settings.json`. The stable lock file is `native.lock` in the same directory. Do not unlink it while the app runs. Wake settings load from the shared core and are saved using revision-checked `/api/settings`. Shared revisions refresh with health checks. Changing the phrase recycles armed capture and invalidates old callbacks; an ongoing discussion can finish before returning to the new phrase. Native Save disarms capture and asks you to arm again. Press Retry to fetch the current revision after an edit conflict.

## Activity and nudges

**Enable activity & nudges** explicitly opts into a coarse active-app bundle ID and idle/lock sampler, and requests visual OS-notification permission. Samples go to authenticated local `/api/activity` every 30 seconds. They contain active minutes, idle seconds, lock state, and app bundle ID; they include no window titles, screenshots, keystrokes, page contents, or microphone text. Five minutes idle, locking, sleep, or missing sampling intervals reset the active bout. This measures observed computer use, not attention or the full Apple Screen Time database.

The core owns meeting/reminder/task scheduling. The native client polls its `/api/notifications` feed, delivers stable IDs once, persists delivery deduplication, and sends user Dismiss/Snooze actions to the core. Native notices are visual and do not open listening or trigger speech. Lock state suppresses native delivery. **Pause nudges** stops collection and polling. OS Focus permissions and core calendar/quiet-hour rules further govern delivery. Notification actions that fail to save produce a visible warning. Sensor collection and notification permission were not activated during automated checks.

Tests:

```sh
swift run --disable-sandbox --package-path apps/macos KstNativeChecks
```

The `--disable-sandbox` option is a SwiftPM compiler workaround for nested sandbox environments. It does not request elevated privileges or turn off operating-system protections for kst. The dependency-free native invariant executable covers lock exclusion, endpoint restriction, and settings roundtrip/corruption because this installed Command Line Tools distribution lacks XCTest and working Swift Testing macros. This app is locally ad-hoc signed; Developer ID signing, notarization, launch-at-login, hardware speech playback validation, output-route privacy handling, and production packaging remain gated work. Session deactivation stops current speech and discussion.

Closing the window leaves the menu-bar app available; Quit kst stops native speech/collection and requests shutdown only for a core it launched. It leaves attached cores alone. There is no local reasoning LLM or automatic external model access. Explicit external commands go through the core's per-request approval path; see [external service setup](../../packages/kst-core/EXTERNAL-SERVICES.md). Recent completed provider results appear visually; say “show external results” to hear them. Native settings use atomic saves and owner-only filesystem permissions; they do not depend on protected-data attributes being available on the Mac volume.
