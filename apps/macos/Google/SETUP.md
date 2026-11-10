# Google native connection setup

KST uses Google's Gmail and Calendar APIs, independently from ChatGPT connectors. No credentials ship in this repository. No Google connection, live send or calendar invitation has been performed by the automated implementation checks.

1. In Google Cloud Console create/select your personal project. Enable **Gmail API** and **Google Calendar API**.
2. Configure OAuth consent for your own account. During development add your account as an explicit test user. Restricted Gmail permissions may require Google verification for distribution; testing-status refresh tokens may expire.
3. Create an OAuth client of type **Desktop app** and download its JSON. Do not choose Web application or supply a web-app client secret.
4. Place the downloaded JSON at the current core profile's `google-client.json`. Default is `~/Library/Application Support/kst-dev/core/google-client.json`. If KST_DATA_DIR is configured, use that profile instead. Create profile directory with mode 0700 and set the file to mode 0600. The file must be a regular file owned by your login user; symlinks are rejected. The committed example is a schema illustration, not a usable credential.
5. Start the newly built native kst app so its supervised core receives the private broker bootstrap on stdin. A manually launched CLI core has no token access.
6. Use the app's Google Connect action; read the requested capability profile and approve the Google consent in your normal browser. Sign in there as `kshiteeshrbharadwaj@gmail.com` if that is the account you want. Enter or approve your passkey only on Google's own sign-in page. KST never requests, reads, stores, or logs a passkey. Default capabilities are Gmail reads and Calendar reads/availability. Adding writes needs a new consent transaction. Exact granted scopes, rather than requested scopes, control available actions.
7. Refresh credentials are stored in macOS login Keychain under a profile-derived `com.kshiteesh.kst.dev.google.*` service. Access tokens stay in RAM. Keep the app bundle/signing identity stable across updates to preserve Keychain/OS authorization behavior.
8. Disconnect through the app: the core first reserves a new durable account generation and cancels old work, then the native broker clears its Keychain account credential and attempts remote revocation. A failed remote revoke is separately displayed; reconnect never resumes pending writes.

## Developer integration

`GoogleAccountBroker(profileURL:)` is an actor. Before launching the owned Node process call `startBroker()`, JSON-encode its `GoogleBrokerBootstrap` and write one newline-delimited bootstrap object to the child's private stdin pipe, then close that pipe. Bootstrap contains `schemaVersion`, `socketPath`, `capability`; never place these in argv/environment/logs. Call `shutdown()` on app termination.

Wire frames use a 4-byte big-endian length then UTF-8 JSON (512 KiB cap, 5-second socket deadline, 8 clients). Each request is `{schemaVersion:1,id,capability,method,params}`; responses are `{id,result}` or `{id,error:{code,message}}`.

- `account.status`: `{}` -> account state/identity/generation/grants/setupRequired/error, never tokens.
- `account.connect`: `{capabilityProfile:{gmailRead,gmailCompose,gmailModify,calendarRead,calendarWrite},generation}` -> AUTHORIZING immediately. Core must durably reserve a strictly newer generation before requesting connection. This supervised-channel command is authorized only by an explicit native/dashboard connection action.
- `account.disconnect`: `{generation}` -> disconnected status and `remoteRevoked` boolean. Core must invalidate old work before calling. It can take up to the native network deadline to report revoke completion.
- `token.get`: `{accountId,accountGeneration,service:"gmail"|"calendar",forceRefresh?:bool}` -> `{accessToken,expiresAt,grantedScopes}`. expiresAt is epoch milliseconds; refresh is single-flight and starts 60 seconds before expiry. forceRefresh=true invalidates the cached token only for the core safe-read retry after a 401; provider writes never retry automatically.
- `envelope.seal`: `{operationId,accountId,accountGeneration,schemaVersion:1,plaintext:<base64>}` -> `{ciphertext:<base64>}`. AES-GCM combined nonce/ciphertext/tag. Metadata is authenticated as sorted-key JSON.
- `envelope.open`: same metadata with `ciphertext` -> `plaintext` base64. Account generation must still be current; failed authentication is an error.
- `input.digest`: `{path,canonicalRequest}` -> HMAC-SHA256 lowercase hex digest. Key stays in Keychain.

Transport validates same-UID Unix peer, random capability, exact field names, duplicate JSON keys and nesting/frame caps. Broker socket is owner-only under a newly created `/private/tmp/kst-UID-random/`. account.connect/disconnect are a deliberate implementation adaptation of the design's supervised command channel; neither is a general URL/auth proxy.

## Validation limits

Pure native policy tests cover callback host/path/state/repetition attacks, requested scopes, capability mismatch, JSON duplicates and depth. Compilation verifies framework/API integration. Live OAuth, Keychain prompts/quit/reopen, token revocation, partial grants and signed updates require the user's Google configuration and a disposable consenting account. Do not mark those cases passed from mocks or compilation.
