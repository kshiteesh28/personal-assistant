# kst local dashboard

This first dashboard is served by `packages/kst-core/src/server.mjs` at the same origin as the local API. It needs no frontend packages, build step, remote fonts, or CDN assets.

Start the core using the root development instructions, then open `http://127.0.0.1:4310`. Paste the token from the private development profile's `token` file into **Connect this dashboard**. The browser holds it in page memory only; disconnect or reload clears it. Never put it in a URL or share it.

Implemented interactions:

- Typed conversation with request IDs retained for a manual retry of the same uncertain message.
- Health indicator and safe health-only background polling.
- Approval previews with exact prompt/context and approve/decline controls. Provider adapters are not connected in this milestone; approval records a decision and sends no external request.
- Versioned wake-phrase preference; this does not pretend to reconfigure an absent detector.
- Proactive nudge preview with explicit sample activity, meeting/lock suppression, and cooldown results.
- Stop request on an independent path; late conversation responses cannot reopen a stopped discussion.
- Read-only Personal Secretary task/calendar/reminder context when the core's `KST_SECRETARY_DB` setting explicitly enables it. Freshness is visible; stale cached records are hidden rather than presented as current. Disabled/unavailable sources leave the scratch assistant usable.

The page does not use browser microphone access, browser speech synthesis, automatic service requests, real activity monitoring, or the original Personal Secretary database. Apple speech belongs to the native Mac shell. The roadmap cards describe development milestones rather than measured runtime progress.

Run `node --check packages/kst-web/app.js` and `node --test packages/kst-web/app.test.mjs` from the project root. The behavioral tests use a minimal DOM fixture and mocked responses to check stale-data suppression, disconnect races, approval callbacks, and failure correlation without real browser/network access. They do not replace visual/accessibility or real-device audio checks.

The logo is supplied by the root integration task at `public/kst-logo.png` and served as `/kst-logo.png`.
