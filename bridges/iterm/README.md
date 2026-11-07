# kst terminal bridge

The first bridge provides explicit, authenticated read-only iTerm inventory. It uses the installed application's scripting dictionary through `/usr/bin/osascript -l JavaScript inventory.js`. It does not launch iTerm, read scrollback, or send text/Enter/Control-C. The OS may ask for Automation permission when you explicitly request inventory; unit tests never invoke it. The preferred official Python API was not installed in the inspected environment, and this implementation does not download dependencies.

Managed execution is implemented by `packages/kst-core/src/terminal.mjs`. It runs reviewed fixed argv recipes as owned local process groups, without a shell or inherited credentials. Configure exact projects on the server, for example:

```json
[
  {
    "id": "api",
    "label": "API project",
    "root": "/absolute/path/to/approved/project",
    "recipes": [
      {
        "id": "test",
        "executable": "/absolute/path/to/bun",
        "args": ["test"],
        "timeoutMs": 120000
      }
    ]
  }
]
```

Only `git-status` (fixed `/usr/bin/git status --short --branch`) and the explicitly reviewed `test` recipe are accepted. Save this reviewed array in a private JSON file and configure its absolute path with `KST_PROJECTS_FILE` on the server. This is server configuration, not a transcript or arbitrary HTTP executable/argument input. Running a project's tests runs that project's code with the current user's permissions; enable only projects/recipes you have reviewed. This initial runner is not a general security sandbox. It does not activate coding-agent or network access.

The service holds conservative exclusive project resources for the full process-group lifetime. A private SQLite journal records request IDs, prepared/running/outcome state and bounded output. Atomic resource directories persist across an abrupt core exit; the next instance reports unknown/quarantined ownership and refuses automatic replay. Resource locks do not expire based on a timer. A live or uncertain service owner blocks takeover. Inspect receipts and actual processes before manually archiving stale owner/resource records; never remove a live owner's records.

`projects.example.json` is a concrete opt-in configuration for this laptop. It enables fixed Git status and the terminal fixture suite only, with an exact Node path and fixed test filename. Inspect it, then set `KST_PROJECTS_FILE` to its absolute path before starting the core. No recipe runs during setup. Update executable/project paths for another Mac. Root identity and shared Git common-directory resources are locked, so aliases and worktrees cannot start conflicting cooperating jobs.

Cancellation sends SIGTERM to an owned live process group, then may escalate to SIGKILL while the original child is still owned. The resource is released only after the group has disappeared. If descendants survive the leader, the outcome remains unknown and the project stays quarantined. Detached/remote work is not claimed stopped. The full native supervisor/capability/fencing architecture from the PRD remains a later hardening milestone.

The verified boundary is the original local process group. Code that deliberately detaches into another process group can escape that boundary; ordinary Node process APIs cannot reliably prove the absence of such descendants after reparenting. Therefore this milestone supports trusted reviewed recipes only and does not claim confinement of arbitrary commands or cancellation of escaped work. Such workloads require a separately validated sandbox/supervisor before admission.

Existing-pane command entry remains disabled: a shell-prompt flag does not prove an empty editing buffer, safe target, shell identity, or absence of human takeover. Managed jobs report real exit evidence and can be explicitly displayed in a new iTerm window as described below.

## Managed-job display

An explicit **Show job in iTerm** action can now create a new iTerm window for an existing managed job. The command uses only fixed absolute Node/client paths, a validated job UUID, an explicit `http://127.0.0.1:PORT` core URL, and the private token-file path. Every argument is POSIX-quoted. The token value never appears in the command line, JavaScript request, or receipt output. No text is sent to an existing session.

The display client reads its private owned token file without following symlinks, polls the authenticated local terminal-status endpoint, selects only the requested job, and prints bounded output plus the actual status. It strips terminal escape/control sequences from untrusted process output. It is a read-only receipt display: live output appears only when the core has persisted it, and closing the display does not cancel the job. Press Enter after completion to close the display.

This action may launch iTerm and trigger the normal macOS Automation permission prompt. It never runs automatically. If permission is denied or the local token file is unavailable, the API reports unavailable. A timeout/unreadable acknowledgement reports unknown because a window may already exist; inspect iTerm before retrying. Environment-only authentication without a matching private token file cannot use this display client.
