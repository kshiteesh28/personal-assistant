# Approved external help

kst keeps its secretary, wake, speech output, planner, and nudge rules local. It has no local reasoning LLM. External help is an explicit operation, never a fallback for an unrecognized local command.

## Setup

Run `node scripts/kst.mjs start` from the repository with these optional environment variables already set. Do not paste credentials into voice commands, URLs, the dashboard token field, or committed files.

| Service | Required configuration | Authorized context |
|---|---|---|
| ChatGPT label / OpenAI API | `KST_OPENAI_API_KEY`, `KST_OPENAI_MODEL` | Exact approved prompt only; uses API billing |
| Claude API | `KST_ANTHROPIC_API_KEY`, `KST_CLAUDE_MODEL` | Exact approved prompt only; uses API billing |
| Codex CLI | `KST_CODEX_ENABLED=1`, absolute `KST_CODEX_PATH`, absolute specific `KST_CODEX_PROJECT` | Approved prompt plus project files read by the scoped agent; existing CLI account authentication |
| Web | Google Chrome installed on macOS | New visible Incognito window; no approval and no result reading |
| Antigravity | Unavailable | Nothing sent |

Use a model your API account supports; kst does not silently choose or migrate a model. Credentials stay in the core process environment and outbound authorization headers. Native supervision forwards only the named configuration variables when it launches its own core. A Finder-launched app does not acquire shell exports. Launching an explicitly configured core first lets the app attach to it. There is no credential-entry UI or Keychain integration in this development release.

## Pipeline

1. “Ask chatgpt explain …” or the equivalent Claude/Codex command creates a proposal. It records service, exact prompt, destination, model/scope, discussion, expiry and configuration fingerprint. No provider transport runs yet.
2. kst discloses the context and asks. The dashboard presents the same request. Say “approve external request” or “decline external request” in that discussion; multiple pending requests require selecting one in the dashboard.
3. Approval changes once, with a revision check. Each spoken decision records its original target before execution. Closing a discussion revokes its pending proposals; Stop revokes all pending proposals.
4. “Search web …” and “browse web …” bypass provider approvals. kst asks macOS to open Google Search in a new visible Chrome Incognito window. The query is included in the URL. kst does not retrieve or display web results.
5. The external ledger records an admitted AI job before transport. It rechecks expiry and configuration. Changed credentials/model/project configuration require a new proposal. Missing setup produces a blocked receipt, with no fallback.
6. One external AI operation may run at a time. Nothing is queued for delayed sharing. The HTTP approval response returns promptly with a durable receipt; local clients poll the receipt, never retry the provider request.
7. AI success requires provider text or a verified CLI exit/result event. Truncation is partial; connection loss, interrupted work and cancellation are uncertain. Restart marks interrupted receipts unknown and never repeats them.

## API contracts

OpenAI uses `POST https://api.openai.com/v1/responses` with an explicitly configured model, the approved `input`, `store:false`, and `max_output_tokens:1024`. No tools, prior response IDs, files, history, or audio are supplied. Text comes from message `output_text` blocks. `store:false` is an API setting, not a promise of zero provider retention; provider account policies still apply. See [OpenAI text generation](https://developers.openai.com/api/docs/guides/text) and [conversation state](https://developers.openai.com/api/docs/guides/conversation-state).

Claude uses `POST https://api.anthropic.com/v1/messages`, bearer authorization, the documented `anthropic-version:2026-10-21` header, an explicit model, a single user message, and `max_tokens:1024`. Only text blocks become results; returned tool calls are never executed. See [Claude Messages API](https://platform.claude.com/docs/en/api/messages/create). These contracts were checked against official documentation on November 7, 2026; update the adapters and contract tests together when adopting future API changes.

## Codex confinement

The adapter rejects root/home scopes, ancestors of home, scopes containing kst's private external profile, and project/ancestor `.codex/config.toml` files. It binds approval to canonical executable/project identities. It launches without a shell, sends the prompt on stdin, and never includes the prompt or credentials in argv.

Before any model invocation, an offline `codex sandbox` probe must read the selected project directory and fail to read a non-secret canary in kst's private profile. A wrong token, failed sandbox, unsupported policy or timeout prevents model execution. The canary is removed after the probe. This verifies these boundaries, not every possible filesystem path; live sandbox validation is still required on the installed CLI.

The agent uses a named `kst-read` filesystem policy: root denied, minimal runtime read access, selected project read-only, selected secret/config paths denied, tool network disabled. User configuration is ignored for execution; hooks, plugins, apps, browser/computer tools and other optional integrations are disabled, MCP configuration is empty, and web search is disabled. It does not pass legacy `--sandbox`, which would override named profiles. Managed restrictions remain in effect. See [Codex permissions](https://learn.chatgpt.com/docs/permissions).

Read-only prevents writes; readable project content can still leave via the model. Review the chosen project's contents before approving a Codex job. This adapter is for bounded read-only analysis; it does not grant arbitrary writes or silently delegate follow-up commands.

## Limits, storage and failure behavior

- API deadline: 45 seconds. Codex: 120 seconds including its probe. Browser handoff: 10 seconds.
- Provider/process output is bounded to 1 MiB before parsing. Stored response text is capped at 16,000 characters; truncation is labelled partial. Clients list the latest 100 receipts.
- The private SQLite ledger retains receipt identities to prevent replay. Approved prompts are in the engine's request/approval records; results persist in the external ledger. Closing a conversation does not delete them. There is no session deletion UI yet. Files use local filesystem permissions, not app-level encryption.
- Non-2xx HTTP errors are failed. Lost connections, malformed results, deadlines and interrupted execution can be unknown because the provider may already have processed the request. There are no automatic provider retries, model switches, or repeated billable calls.
- Stop aborts transport and terminates owned CLI process groups with a bounded kill escalation. It cannot retract transmitted information or prove remote cancellation. Late results cannot overwrite an unknown receipt.
- Provider errors exclude raw response bodies and credentials. UI output uses plain text. Background results are visual; speaking results requires an explicit user request.
- Browser opening only reports whether macOS accepted the Chrome launch. It does not claim a page loaded or research was verified.

## Validation gates

Contract tests use synthetic credentials, mock HTTP responses and fixture child processes. They cover expired/configuration-changed approvals, duplicate/replayed decisions, discussion isolation, output bounds, partial results, blocked admission, cancellation races, scope-probe refusal and restart uncertainty. No live model request, credential discovery or provider login occurred during development.

Before everyday use, validate an ordinary-terminal core startup/socket, real account/model access with a deliberately approved small request, the installed Codex CLI's restricted profile and network/secret denial behavior, default-browser handoff, and voice approval accuracy. Keep the adapter disabled if those checks fail. Hardware voice validation is independent of successful API fixtures.
