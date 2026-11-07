# kst local core and Personal Secretary workspace

Requires Node 22.23 or newer with `node:sqlite`. SQLite is currently an experimental Node API; its runtime warning is expected. The core uses no npm dependencies or local reasoning LLM. External providers still require explicit approval and are not dispatched by this implementation.

```sh
node packages/kst-core/src/server.mjs
node --test packages/kst-core/test/*.test.mjs
```

The default bind is `127.0.0.1:4310`. The starter dashboard is served from `packages/kst-web`. The private scratch profile is `~/Library/Application Support/kst-dev/core`; it does not open Personal Secretary's existing databases. `KST_DATA_DIR` sets a dedicated absolute profile directory, `KST_PORT` changes the local port, `KST_TOKEN` supplies an existing token (24–256 characters), and `KST_WEB_DIR` overrides the static root. Token values are never printed. Paste the contents of the profile's `token` file into the dashboard's pairing field. If supplying `KST_TOKEN`, supply it to the native app too.

## Working domain features

The normal app now uses `secretary.sqlite` inside the private profile, with the actual Personal Secretary foundation schema. Tasks, notes, reminders, calendar events, planning proposals, applied focus blocks, and notifications are persisted. The production conversation route selects this workspace before the old scratch-command engine; the legacy scratch test harness is not a second copy of production task data.

Examples (typed input and native final speech use the same route):

- `add task Review API`; `complete task Review API`; `show tasks`.
- `note Discuss the API contract`; `show notes`.
- `remind me to Review tests in 10 minutes`; `snooze reminder Review tests for 15 minutes`.
- `reschedule reminder Review tests tomorrow at 5 pm`; `cancel reminder Review tests`.
- `schedule meeting Design review tomorrow at 3 pm for 30 minutes`.
- `reschedule meeting Design review tomorrow at 4 pm for 45 minutes`; `cancel meeting Design review`.
- `show calendar`; `show reminders`; `show timeline`.
- `plan my day`, then `confirm plan` in the same conversation, or `apply plan ID`.
- `run tests in kst`; `cancel that command`; `cancel tests in kst`; `show terminals`.

Missing times and meeting durations produce persistent, 90-second clarification slots. Ambiguous am/pm, unsupported dates, duplicate titles, and conflicting meetings do not produce guessed writes. ISO timestamps with an explicit offset are supported. Relative everyday dates use the Mac/core process timezone, shown in the workspace snapshot. Spoken small time numbers and final dictation punctuation are normalized in narrow time contexts; internal title punctuation is retained.

Planning proposes up to eight tasks in 30-minute blocks before 18:00 local time, starting at a future five-minute boundary with a confirmation buffer. Existing meetings and applied focus blocks are avoided. Confirmation rechecks task revisions, meeting conflicts, other applied blocks, and elapsed start times. Applied plans populate this app's `kst_plans` timeline; they do not claim to rewrite the legacy `daily_schedules` planner. Overflow is reported rather than silently scheduled outside the workday.

The single core scheduler checks every 15 seconds while running, persists due-reminder and meeting notices, and reconciles on startup. It also observes actual managed-job receipts for completion/failure notices. Native activity feeds break reminders; unfinished applied focus blocks can produce status-check nudges. Known lock/quiet/meeting state suppresses ordinary nudges. Notification acknowledgement and 15/30/60-minute snoozing persist. Activity samples and only their own idempotency receipts expire after 24 hours; no notification bodies are copied into every activity receipt. Notification bodies age out after 30 days while minimal delivery keys remain to prevent replay. Recurring reminder rules from a connected source are not advanced by this scheduler.

`GET /api/secretary/workspace` returns the local/shared workspace, timeline, plans, and notices. `POST /api/secretary/actions {requestId,action}` accepts the same typed domain actions. `GET /api/notifications`, `POST /api/notifications/:id {requestId,decision,minutes?}`, and `POST /api/activity {requestId,activeMinutes,idleSeconds,locked,inMeeting?,quietHours?,appBundleId?}` feed native integration. All require pairing. The activity reply is compact `{accepted,inMeeting,notificationCount}`; retrieve notice contents separately.

## Optional shared-source writes

Read-only source access remains the default when `KST_SECRETARY_DB` is selected. Shared writes require **both** that explicit approved source path and `KST_SECRETARY_WRITE=1` at server startup. Before creating any auxiliary ledger or mutating a source table, the workspace creates a consistent `VACUUM INTO` backup inside the private profile and verifies its integrity and expected tables. Backup failure prevents writable startup. The source and sidecars must be regular, owned files; expected filenames and approved root restrictions remain in force.

Shared domain mutations and their idempotency receipts commit in the same source transaction. Notes update `notes_fts` in that transaction when available; completion updates existing task progress, and reminder states retain the legacy enum. Tests exercise source-write behavior only with disposable fixtures. No live Personal Secretary database was modified during implementation. This is an explicit connection mode, not automatic migration or cloud synchronization.

## Managed project jobs

The default approved project is `kst` itself with a fixed Node test recipe. It runs only on explicit request. `KST_PROJECTS_FILE` can replace that list with a reviewed JSON project configuration; no arbitrary transcript is evaluated as shell code. See `bridges/iterm/projects.example.json` and the terminal tests. Existing iTerm inventory is an explicit `POST /api/terminal/inventory`; `POST /api/terminal/jobs/:id/show` opens a known job's output client in a new iTerm window, without typing into your existing pane.

Stop persists the exact owned job IDs before requesting cancellation outside SQL transactions. Replaying the same Stop targets its original jobs and cannot cancel a newly started workload. Unverified cancellation remains unknown rather than reported as stopped. Async shutdown waits for terminal cleanup before releasing the core owner lock.

## Read-only Personal Secretary integration

An explicit server-side `KST_SECRETARY_DB` selection enables the read-only adapter. By default it is off. Select exactly `flowstate.db` or `secretary.db` directly under this project directory. The adapter's `allowedRoots` option lets server code select a different approved fixture/project directory; HTTP clients cannot submit arbitrary filesystem paths. Symlinks in the filename, ancestors or database sidecars are rejected.

`createSecretaryAdapter({sourcePath,allowedRoots?,now?,maxRows?,staleAfterMs?}).snapshot()` reads tasks, notes, reminders and calendar events through Node SQLite's `readOnly:true`, `query_only=ON`, and one read transaction. The supported columns are taken from the existing foundation migration and repository code. It does not run source migrations, insert/update/delete source records, copy a database, or claim to make backups. SQLite may perform its ordinary WAL shared-memory/locking bookkeeping; domain tables are strictly read-only.

The snapshot is `{status,source,observedAt,lastSuccessAt,staleAgeMs,data,limits,error?}`. `data` contains `tasks`, `notes`, `reminders`, and `calendar` arrays. All retain source record IDs; no second domain store is populated. Each successful refresh sees committed source changes. `source` identifies the product and filename without exposing the full path. Dates are ISO strings converted from the source's millisecond timestamps. Note bodies are bounded to 2,000 characters, titles to 500 characters, and each collection to 100 rows by default (maximum 500). `limits.truncated` names collections with additional rows.

States are `disabled`, `fresh`, `stale`, and `unavailable`. A busy source can return the last successful in-memory snapshot, explicitly marked stale, for at most 60 seconds. An older cache, inaccessible/corrupt source, incompatible schema, or rejected path returns empty data with a sanitized error. Cache data is not persisted to kst's database. `observedAt` means when the source was checked; `lastSuccessAt` identifies the actual snapshot age. Never use a stale or truncated snapshot as complete authoritative calendar availability or to authorize actions.

Run adapter tests with `node --test packages/kst-core/test/secretary.test.mjs` from the project root. Nine tests exercise the actual foundation schema using disposable files, unchanged source contents, source edits (including committed WAL data), limits, path restrictions, missing/corrupt/schema-invalid sources, busy-source aging, and invalid date handling. No live source database is read by this suite.

## Delivered

- Persistent workspace tasks, notes, reminders, meetings, planning and timeline through typed/native speech commands described above.
- Native voice configuration defaults to `arise`. The Mac app owns on-device speech recognition and activation; the core does not install a separate wake model.
- ChatGPT, Claude and Codex requests require per-request approval. “Search web QUERY” opens Google Search in a visible Chrome Incognito window without approval; kst does not read or return the page contents.
- SQLite transactions persist domain state and request idempotency in one commit. Conflicting reuse of a request ID is rejected. Operational queues and scratch data have bounded capacities.
- Native activity/local calendar/job state feed persistent proactive notifications; fixture-only nudge evaluation remains separately available for testing.

## API

Only `/health` and static dashboard assets are public. `/api/*` requires `Authorization: Bearer <token>`. Host and Origin are restricted to the listening loopback origin. Mutations require JSON; unknown fields and malformed input are rejected.

- `GET /api/status` → `{app,mode,generation,settings,capabilities,jobs,approvals,nudges,tasks,notes}`.
- `GET /api/settings`, `PATCH /api/settings {expectedRevision,wakePhrase}` → settings. Includes `revision`, `wakePhrase`, `voice:'system-default'`, `localReasoning:false`, `externalApproval:'every-request'`.
- `POST /api/conversation {requestId,text,conversationId?}` → `{reply,conversationId,job?,approval?}`. Request IDs must contain 8–128 letters/numbers/underscores/hyphens.
- `GET /api/approvals`, `POST /api/approvals/:id {decision:'approve'|'deny',revision}` → `{approval,dispatched:false,message}`. Initial revision 1, expires in five minutes. Replays/stale revisions fail.
- `GET /api/jobs`, `POST /api/stop {requestId}` → stop receipt with captured `jobIds` and actual cancellation outcomes in `jobs`. Stop invalidates pending approvals and dialogue; retrying targets the original jobs only.
- `POST /api/nudges/evaluate {now:ISO,activity:{activeMinutes,locked,inMeeting,quietHours}}` → `{nudges,source:'fixture',suppressed}`.

Errors return `{error:{code,message,retryable}}` with appropriate HTTP status. No credentials or detailed internal exceptions are returned.

## Failure recovery

An exclusive `owner.lock` prevents two cores writing the same profile even when configured on different ports. SIGINT/SIGTERM closes SQLite and removes only the lock bearing this process's nonce. A crash intentionally leaves the lock behind. Do not infer stale ownership from a timeout/PID alone; verify the recorded owner is gone and archive the exact lock file before restarting. No automatic stale-lock reclamation is implemented.

After restart, interrupted jobs become `unknown` and are quarantined; pending approvals expire. There is no retry path that can rerun an uncertain effect. Corrupt/unsupported state fails startup; no automatic reset or data deletion. Preserve the profile, investigate the error, and restore a verified backup into a separate directory. The terminal module supports bounded approved recipes and conservative ownership; it is not unrestricted shell control or the final native execution broker.

Shutdown is graceful for ordinary signals. Native speech/audio has its own Stop path in the Mac app, so a broken core cannot keep speech running. General migration/restore tooling, arbitrary app/browser control, cloud calendar connectors, recurring-reminder expansion, iPhone synchronization and actual external AI adapters remain follow-up work.

## Current verification

The portable workspace, real HTTP-handler, read-only-source, and terminal suites pass 48 tests, including actual managed-process execution/cancellation and crash quarantine. Run `node --test packages/kst-core/test/workspace.test.mjs packages/kst-core/test/http-handler.test.mjs packages/kst-core/test/secretary.test.mjs packages/kst-core/test/terminal.test.mjs`. The separate real-socket integration test in `core.test.mjs` cannot bind `127.0.0.1` in this tool sandbox (`EPERM`); its failure is visible and it must be rerun from a normal local terminal. Portable handler tests exercise the actual request handler without pretending to verify socket listening or hardware permissions.
