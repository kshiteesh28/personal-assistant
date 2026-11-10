# Google core v1

Composition entry: `createGoogleRuntime({dataDir,engine,workspace,broker,fetchImpl?,clock?,composer?,parser?})` in `runtime.mjs`. The master HTTP handler must route Google conversation requests before the existing classifier/receipt reservation, call `route(method,path,body)`, include runtime `stop()` in Stop and await `close()` before closing engine/workspace. `status()` is asynchronous and refreshes the native account snapshot. `calendarEvents()` exposes mirror records; `nudgeSnapshot()` fetches bounded expanded instances, only when opted in, and reports incompleteness.

Features start disabled. All Google provider writes require an exact transient preview and confirmation. Mail bodies and prepared MIME are encrypted by the authenticated native broker before operational admission. The existing understanding parent receipt stores only a Google operation reference. Provider writes are serialized through their final/uncertain receipt. A queued confirmation returns 202 with `confirmationQueued=true`; it remains NEEDS_CONFIRMATION until fresh remote checks and durable dispatch admission complete. Stop/disconnect prevents further child writes. No uncertain provider write automatically retries.

`broker-client.mjs` uses the inherited stdin bootstrap `{schemaVersion:1,socketPath,capability}` supplied by the native supervisor. The client never loads Keychain data via a shell. The broker supports the framing and crypto contracts in the design. The Node process retains tokens only transiently in RAM.

Core operations include Gmail live search/plain-text reads, exact literal drafts/replies, immutable prepared sends, frozen message-set label/trash changes; Calendar list/availability, owned timed event create/reschedule/cancel, etag conflicts and deterministic plan children. HTML-only mail, attachments, aliases/Bcc/reply-all and recurring/all-day writes are deliberately rejected. An observed draft edit cancels sending; an edit racing after the final read cannot alter the frozen MIME. Source drafts remain in Gmail.

Conflict override is a two-preview flow: a busy interval produces `preview.conflictOverrideRequired`. POST `operations/:id/allow-conflict` with `{requestId,contextRevision}` creates a new proposal using a server token bound to the exact busy snapshot. It does not send a provider write. The new preview needs normal confirmation. Changing conflicts invalidate the token. Parent plan publishing with a newly conflicting block stops and reports partial receipts; it never silently cancels other events.

Run deterministic coverage with:

```
node --test packages/kst-core/test/google/*.test.mjs
```

Tests inject fake transport/broker/MIME effects and cover real SQLite rollback, encrypted disk envelopes, generations, cursor completeness, stale contexts, idempotence, provider uncertainty, cross-feature namespace guards, Stop between children, serialized effects and frozen-message send races. These tests do not certify an OAuth account connection or live Google behavior. The release plan's live-account, signing, application compatibility and resource gates remain separate.

MIME implementations dynamically import `nodemailer/lib/mail-composer/index.js` and `mailparser` streaming `MailParser`. They return `MIME_SETUP_REQUIRED` if the audited dependencies are absent. There is no ad-hoc MIME fallback or SMTP path. R02 requires real pinned versions, lockfile integrity and an audit before release; the current environment cannot resolve the npm registry. Native desktop Google client configuration is also required before actual OAuth. Do not mark those gates passed merely because injected tests pass.

`resources/google/contracts-v1.json` and `contract-fixtures.json` expose machine-readable schema/fixtures. Runtime validators additionally check UTF-8 byte bounds, ISO date component validity, offset/timezone consistency, cross-field permission rules and provider resource identities. `google-cache.sqlite` is disposable and separate from authoritative `kst.sqlite`; Google records never silently become local tasks/notes.
