# kst — local Mac secretary

kst combines a native Mac voice interface, a persistent secretary workspace, supervised project jobs, and local proactive notifications. The default configurable wake phrase is **arise**. Output uses one default Apple voice. There is no local reasoning LLM or automatic hosted-model/web request.

## Open the app

Open `apps/macos/build/kst.app`. This locally signed development bundle contains configured paths to the current project and installed Node runtime. It starts its own local core when needed, attaches to an existing healthy core, and limits restart attempts. Moving the repository or Node runtime requires rebuilding the app.

1. Choose **Arm wake phrase** and grant microphone/speech permission.
2. Say **arise**, followed by a request, or give your request after the listening acknowledgement.
3. Continue speaking between replies without repeating the phrase. The microphone pauses while kst speaks.
4. “We're done” returns to armed mode. **Stop** disarms and requests cancellation of foreground managed jobs.
5. Choose **Enable activity & nudges** to opt into coarse app/idle observations and native notification permission.

The armed phrase gate runs Apple's on-device speech recognizer, discards ambient text in RAM, and requires on-device recognition. It is not a dedicated low-power keyword model. Unsupported recognition or permission/audio errors stop listening. No extra engine/model picker or voice downloads are included.

Actual microphone accuracy, offline behavior, echo, CPU/battery use, and notification delivery still need validation on your Mac. Build/tests never activate the microphone or request permissions. The app uses turn-taking audio; simultaneous voice interruption of its speech is not claimed.

## Secretary commands

Voice and typed requests enter the same validated, persisted command path. Missing or ambiguous dates, titles, durations, and targets produce clarification.

| Say or type | Behavior |
|---|---|
| “Add task review the API” | Save a task |
| “Complete task review the API” | Complete the exact matching task |
| “Note check the deployment settings” | Save a note and update local full-text search |
| “Remind me to stretch in ten minutes” | Persist a timed reminder |
| “Snooze reminder stretch for 15 minutes” | Snooze an identified reminder |
| “Reschedule reminder stretch tomorrow at 5 pm” | Change its time |
| “Cancel reminder stretch” | Dismiss it and clear outstanding notices |
| “Schedule meeting design review tomorrow at 3 pm for 30 minutes” | Create a calendar entry after conflict checks |
| “Reschedule meeting design review tomorrow at 4 pm for 45 minutes” | Update that meeting |
| “Cancel meeting design review” | Remove the exact matching meeting |
| “Show tasks / notes / reminders / calendar / timeline” | Read current workspace records |
| “Plan my day” | Propose focus blocks around meetings |
| “Confirm plan” | Revalidate and apply this conversation's proposal |
| “Cancel request” | Discard pending clarification or plan approval |
| “Run tests in kst” | Start the reviewed app self-test recipe |
| “Cancel that command” | Cancel the unique active owned job; clarify if ambiguous |
| “Cancel tests in kst” | Cancel that project's owned test job |
| “Show terminals” | Explicitly request iTerm inventory |

Dates without AM/PM, ambiguous entities, conflicts, stale plans, and expired clarification are rejected or clarified. A plan never applies silently. Calendar entries are local/shared Personal Secretary records; sending invitations or syncing an external calendar account is not implemented by these commands.

## Data and Personal Secretary integration

By default, records live under `~/Library/Application Support/kst-dev/core`. The canonical secretary database is `secretary.sqlite`, using Personal Secretary's foundation tables. The legacy scratch capture and operational databases remain separate operational state.

To view the existing project data read-only, run:

```sh
cd "/Users/kshiteesh/Developer/personal secretary"
KST_SECRETARY_DB="/Users/kshiteesh/Developer/personal secretary/flowstate.db" node scripts/kst.mjs start
```

To use that source as the editable secretary workspace, explicitly enable shared writes:

```sh
KST_SECRETARY_DB="/Users/kshiteesh/Developer/personal secretary/flowstate.db" KST_SECRETARY_WRITE=1 node scripts/kst.mjs start
```

The shared-write path must create and verify a consistent SQLite backup before adding its ledgers or modifying source records. Tests exercise that on disposable source databases. No shared source writes were performed during development. Reminder status values and note search indexing follow the existing schema.

The dashboard distinguishes the active workspace from the optional bounded read-only source snapshot. Shared plans use `kst_plans` for their timeline; they do not pretend to update the old `daily_schedules` UI. A bounded snapshot cannot prove complete calendar availability.

## Proactive nudges

Opt-in native observations contain app bundle ID, active/idle intervals, and session lock state. They do not contain keystrokes, screenshots, window titles, or page text.

The local scheduler creates due-reminder and upcoming-meeting notices. Actual activity can trigger a break suggestion; applied focus blocks and real job receipts can generate checkpoint or job-attention notices. Ordinary nudges respect known meetings, lock/idle/quiet state, cooldowns, and hourly limits. Native delivery deduplicates IDs and supports dismiss/snooze.

Activity records and their idempotency receipts expire after 24 hours. Notification bodies are cleaned after 30 days while minimal delivery keys remain for deduplication. Mutating command receipts remain to prevent accidental replay. Raw audio and ambient transcripts are not recorded.

## Terminal and iTerm

The built-in `kst` project exposes a reviewed fixed-argument self-test recipe. Configure additional trusted projects through `KST_PROJECTS_FILE`; see `bridges/iterm/projects.example.json`.

Jobs have persistent receipts, bounded output, canonical project/Git resource ownership, deadlines, cancellation, and conservative crash quarantine. Tests verify real child-process outcomes. Ordinary process-group supervision cannot confine arbitrary code that fully detaches; only trusted reviewed recipes belong in this executor.

**Read iTerm sessions** is explicit and may request OS Automation permission. A known job's **Show in a new iTerm window** opens a receipt viewer in a new window with a fixed command. No raw transcript or token value becomes shell input. Existing human-pane writes stay disabled until reliable prompt/ownership handling is implemented.

## Dashboard and external services

The local dashboard is `http://127.0.0.1:4310`. Native voice/typed requests pair automatically through the private local token file. The browser dashboard currently requires entering that token; it keeps it only in page memory, never a URL.

ChatGPT/Codex/Claude requests show the exact prompt and context before use. Say “ask chatgpt explain …”, “ask claude …”, or “ask codex …”, then “approve external request” or “decline external request”. Approval belongs to that discussion, expires after five minutes, and cannot be replayed against a newer request. Configured adapters execute approved requests; unconfigured ones report blocked. There is no automatic fallback or retry after an uncertain outcome.

Say “search web …” or “browse web …” to open Google Search in a new visible Chrome Incognito window without an approval prompt. kst sends the query in the search URL, then leaves browsing to you: it does not fetch, summarize, or return page contents. Chrome must be installed. Incognito reduces Chrome's local browsing history; Google still receives the search query.

OpenAI requires `KST_OPENAI_API_KEY` and `KST_OPENAI_MODEL`. Claude requires `KST_ANTHROPIC_API_KEY` and `KST_CLAUDE_MODEL`. These adapters send only the approved prompt, with no local files/history/audio, and use your API billing. The ChatGPT label does not imply access to a ChatGPT subscription. Start the core from a terminal with the variables already set; a Finder launch does not inherit your shell exports. Never put keys in committed project files.

Codex requires `KST_CODEX_ENABLED=1`, an absolute `KST_CODEX_PATH`, an absolute `KST_CODEX_PROJECT` pointing to a specific reviewed project, and your normal CLI authentication. Its read-only agent can send files it reads in that scope to its model. It must pass an offline scope probe before model execution; unsupported profiles fail closed. Antigravity has no adapter.

Provider results appear in the dashboard and native discussion. Say “show external results” to hear them. Stop interrupts local waiting, but cannot retract a request a provider already received. Approved prompts, bounded response text, and receipts persist locally; they are not automatically erased at the end of a discussion. No live model call was made during development. See [external service setup and contracts](packages/kst-core/EXTERNAL-SERVICES.md) for limits and validation gates.

iPhone synchronization, external calendar-account synchronization/invitations, unrestricted computer control, production distribution signing, and full-duplex audio remain outside the delivered local feature set.

## Build, test, and recover

Requires the installed Node 22.23+ runtime and Swift command-line tools. Node's built-in SQLite API is experimental; its warning is expected.

```sh
node scripts/kst.mjs doctor
node scripts/kst.mjs test
node scripts/kst.mjs package-mac
```

Current coordinator verification: 88 core tests and 11 dashboard behavior tests pass; native lifecycle/wake/activity invariants pass. One real-socket integration test still fails with sandbox `EPERM` when binding localhost. The production request handler is separately tested without sockets. Run the full suite in your ordinary terminal to validate the socket path; it has not been marked as passing here. Provider transport tests use synthetic keys and mock HTTP/processes; real account authentication and the installed Codex scope profile remain live validation gates.

Startup refuses corrupt or ambiguously owned profiles. Never delete a live ownership record or infer stopped work from a timeout alone. Review exact process/job evidence before archiving a stale lock. Unknown work remains quarantined. Stop receipts capture job IDs, so replaying an old Stop cannot cancel newer jobs.

The app quits only its owned core; attached cores remain under their original owner. Detailed tasks and remaining release gates are recorded in [KST-TASKS.md](KST-TASKS.md). The transparent logo and generation/edit prompt are in [assets/kst/README.md](assets/kst/README.md).
