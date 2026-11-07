# Flow-State — Project Structure and Important Aspects

This document describes the **file structure hierarchy** and **important aspects** of the Flow-State project. It answers *where things are* and *what they do* at a file and folder level. Together with `PROJECT-ARCHITECTURE.md`, it contains every detail needed for an agent to re-create the entire application.

---

## 1. Repository structure

### Full directory tree

```
flow-state/
├── package.json                 # Root: workspaces ["packages/*"], scripts dev/server/web/test/lint/format
├── tsconfig.json                # Paths for @secretary/shared, include packages/*/src
├── config.json                  # Runtime config (created at first run if missing; see config section)
├── secretary.db                 # SQLite DB (created by server; path: PROJECT_ROOT or derived)
├── secretary.db-shm, .db-wal   # SQLite WAL files
├── .cache/                      # Copilot LLM cache (copilot-llm-response.json only)
├── backups/                     # DB backups (created by db-backup job); secretary-YYYY-MM-DD.db; retention 7 days
├── migrations/                  # SQL migrations (run in order by server on startup)
│   ├── 001_foundation.sql
│   ├── 002_task_position.sql
│   ├── 003_task_scheduling_params.sql
│   ├── 004_daily_schedules.sql
│   ├── 005_process_optimization.sql
│   ├── 006_downtime_pipeline.sql
│   ├── 007_pinned_time.sql
│   └── 008_task_progress.sql
├── packages/
│   ├── server/                  # Backend API (Elysia, Bun, SQLite)
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── index.ts         # App entry: Elysia, routes, scheduler, event listeners, Swagger /docs
│   │   │   ├── config/          # loadConfig(), ConfigSchema, defaults (TypeBox), logger.ts
│   │   │   ├── db/              # Bun SQLite, runMigrations(), projectRoot/dbPath
│   │   │   ├── middleware/      # auth (Bearer token)
│   │   │   ├── routes/          # config, sse, events, tasks, reminders, notes, brief, chat, export, outlook-calendar, schedule, checklists, weekly-reviews, downtime-pipeline, voice
│   │   │   ├── orchestration/   # intent-parser, command-router, response-formatter
│   │   │   ├── repositories/   # events, tasks, reminders, notes, daily-schedules, checklists, weekly-reviews, downtime-pipeline, activity, integration-cache, base.repository
│   │   │   ├── services/        # calendar, task, reminder, briefing, note, schedule-designer (designSchedule, rescheduleFromNow, slot building, scoring, overflow resolution), copilot-llm, copilot-calendar, outlook-calendar, motivation, productivity, research, meeting-notes, process-optimization, downtime-pipeline, notification, usage-tracking, insights, presentation-detector, import, export
│   │   │   ├── integrations/   # outlook.plugin, loop.plugin, jira.plugin, plugin-registry, base-client
│   │   │   └── scheduler/       # scheduler.ts, event-bus.ts, jobs: reminder-checker (60s), daily-brief-trigger, cache-cleanup, usage-sampler, break-checker, pre-meeting-checker, db-backup, task-deadline-checker, proactive-nudge, check-downtime
│   │   ├── scripts/
│   │   │   ├── setup-whisper.ps1      # One-time: download whisper-bin-x64.zip, extract real whisper-cli.exe + DLLs to bin/, model to models/
│   │   │   ├── query-copilot.ps1      # Copilot LLM: send prompt to M365 Copilot UI, write response to .cache/copilot-llm-response.json
│   │   │   ├── debug-assets.ts
│   │   │   └── test-notifications.ts
│   │   ├── bin/                 # whisper-cli.exe + whisper.dll, ggml.dll, ggml-base.dll, ggml-cpu.dll (from setup-whisper.ps1)
│   │   └── models/              # ggml-base.en.bin (from setup-whisper.ps1)
│   ├── web/                     # Frontend (React, Vite)
│   │   ├── package.json
│   │   ├── index.html           # lang en, viewport, title "Flow-State", #root, script type=module src=/src/main.tsx
│   │   ├── vite.config.ts       # React plugin, serveVadDist (VAD + onnxruntime-web), proxy /api /health /docs to 127.0.0.1:3000, alias @ → ./src, port 5173 strictPort
│   │   ├── public/vad/          # VAD/ONNX assets (copied at buildStart from node_modules)
│   │   └── src/
│   │       ├── main.tsx
│   │       ├── App.tsx          # Router, ChatPanel, NotificationToast, BackgroundVoiceIndicator, ensureAuthToken, useEventStream
│   │       ├── index.css
│   │       ├── pages/           # BriefPage, CalendarPage, TasksPage, RemindersPage, NotesPage, SettingsPage
│   │       ├── components/      # ChatPanel, VoiceButton, HoverPreview, NotificationToast, NudgeMessagesModal, NotificationPreferences, BackgroundVoiceIndicator
│   │       └── services/        # api.ts (fetch helpers, auth), sse.ts (EventSource), voice-engine.ts, voice-tts.ts, useBackgroundVoice, nudge-sound, popups
│   └── shared/                  # Types and API contracts
│       ├── package.json         # exports: ., errors, types, api
│       └── src/
│           ├── index.ts
│           ├── errors.ts
│           ├── types.ts
│           └── api.ts           # ChatRequest, ChatResponse, etc.
```

### Major folders

- **Root**: Monorepo with Bun workspaces; `config.json` and `secretary.db` at project root (or `PROJECT_ROOT`).
- **packages/server**: Backend; Elysia app, SQLite, config, all API routes and background jobs.
- **packages/web**: SPA; Vite dev server on 5173, proxies API to server; React Router, chat, voice, pages.
- **packages/shared**: Shared TypeScript types and API DTOs; no runtime deps.
- **migrations**: Ordered SQL files; applied by `packages/server/src/db/migrations.ts` on startup.

### Key aspects

- **config.json**: Runtime config; created at first run if missing; lives at project root (or path from `CONFIG_PATH` / project root).
- **secretary.db**: SQLite database; path = `process.env.DB_PATH` or `join(projectRoot, "secretary.db")`.
- **.cache/**: Copilot LLM cache only; contains `copilot-llm-response.json`. No Jira, Outlook, Loop, or Copilot calendar; no `copilot-calendar.json`.
- **migrations/**: Exactly 8 files, applied in numeric order by `runMigrations()` in `packages/server/src/db/migrations.ts`. Migrations dir path = `process.env.MIGRATIONS_DIR ?? join(projectRoot, "migrations")`.
- **Scheduler job intervals (ms)**: reminder-checker 60_000; break-checker 60_000 (30 min cooldown); usage-sampler 60_000; pre-meeting-checker 60_000 (1-min window); cache-cleanup 900_000 (purge expired integration_cache); db-backup 86_400_000 (startup + 24 h; BACKUPS_DIR, KEEP_DAYS 7); task-deadline-checker 300_000 (pinned tasks 5–10 min overdue → nudge + OS notification; 1h cleanup); check-downtime 900_000 (proactive only; free-time nudge, 1h cooldown); daily-brief-trigger 60_000 (emit brief.ready when clock matches dailyBriefTime); proactive-nudge 60_000.
- **backups/**: Directory under project root created by db-backup job; contains `secretary-YYYY-MM-DD.db` files; retention 7 days (older files deleted after each run).
- **Schedule API** (see PROJECT-ARCHITECTURE.md §9): POST /api/schedule/generate (designSchedule, optional date), POST /api/schedule/reschedule (rescheduleFromNow, fromMinuteOfDay = now), POST /api/schedule/overflow-action (body: task_id, action "defer"|"trim"|"splittable"|"remove", defer_to?, estimate?).
- **packages/server/bin/**: Contains `whisper-cli.exe` and required DLLs (`whisper.dll`, `ggml.dll`, `ggml-base.dll`, `ggml-cpu.dll`) after running `setup-whisper.ps1`.
- **packages/server/models/**: Contains `ggml-base.en.bin` (Whisper model) after running `setup-whisper.ps1`.
- **packages/web/public/vad/**: VAD/ONNX assets for voice (copied at build from node_modules; Vite also serves `/vad` in dev).

---

## 2. Tech stack and dependencies

### Runtime / framework

- **Bun** for server and tooling (run, test, install).
- **Elysia** for HTTP API (server).
- **React 19** + **Vite 6** for frontend.
- **TypeScript** (strict, ESNext, path aliases for `@secretary/shared`).

### Root package.json

- **workspaces**: `["packages/*"]`
- **Scripts**: `dev` = `concurrently -n server,web -c blue,green "bun run --cwd packages/server dev" "bun run --cwd packages/web dev"`; `server`, `web`, `test`, `lint` (biome), `format`.
- **Dependencies**: `chrono-node`, `concurrently` (dev).

### Server packages/server/package.json

- **Entry**: `src/index.ts`
- **Dependencies**: `elysia`, `@elysiajs/swagger`, `@sinclair/typebox`, `chrono-node`, `classic-level`, `get-windows`, `node-ical`, `node-notifier`, `@secretary/shared` (workspace).
- **Optional**: `keytar`.
- **Dev**: `@biomejs/biome`, `typescript`.

### Web packages/web/package.json

- **Dependencies**: `react`, `react-dom`, `react-router-dom`, `@ricky0123/vad-web`, `@fullcalendar/core`, `@fullcalendar/daygrid`, `@fullcalendar/timegrid`, `@fullcalendar/interaction`, `@fullcalendar/react`, `recharts`, `@secretary/shared`.
- **Dev**: `vite`, `@vitejs/plugin-react`, `typescript`, `@types/react`, `@types/react-dom`.

### Shared packages/shared/package.json

- **No dependencies**; **exports**: `.`, `errors`, `types`, `api`.

### Shared types and errors (exact surface for re-creation)

- **packages/shared/src/errors.ts**: `SecretaryError` (base, code), `ValidationError` (message, details?), `NotFoundError` (message, resource?), `IntegrationError` (message, source?, statusCode?), `AgentError`, `ConfigError`.
- **packages/shared/src/types.ts**: `Event`, `Task` (status todo|done|cancelled, position, time_estimate, energy_level, task_type, is_splittable, progress, etc.), `Reminder`, `Note`, `ScheduleBlock` (type: "task"|"meeting"|"buffer"|"lunch"|"dinner"|"break"|"flex"; task_id?, event_id?, title, energy_band), `OverflowSuggestion` (action "trim"|"defer"|"delegate"|"remove" in types; schedule-designer produces only trim/defer; API overflow-action accepts defer|trim|splittable|remove), `DailySchedule`, `BriefSection`, `Brief`, `IntegrationStatus`, `HealthStatus`, `BriefSectionContent`, `IntegrationPlugin`; `EnergyLevel`, `TaskType` (deep_work|communication|admin|creative|review|meeting_prep|personal|fitness|mental_health), `TimePreference`.
- **packages/shared/src/api.ts**: `EventCreate`, `TaskCreate`, `ReminderCreate`, `NoteCreate`, `ChatRequest`, `ChatActionPerformed`, `ChatResponse`, `ExportPayload`, `ImportRequest`, `ImportConflict`, `ImportResult`.

### Workspace tooling (tsconfig.json)

- **paths**: `@secretary/shared` → `./packages/shared/src/index.ts`, `@secretary/shared/errors` → `./packages/shared/src/errors.ts`, `@secretary/shared/types` → `./packages/shared/src/types.ts`, `@secretary/shared/api` → `./packages/shared/src/api.ts`.
- **include**: `packages/*/src/**/*.ts`, `packages/*/src/**/*.tsx`.
- **exclude**: `node_modules`, `dist`, `build`.

---

## 3. UI / Frontend structure

For detailed UI behavior (SSE handling, theme application, page data flow), see **PROJECT-ARCHITECTURE.md** section 10 (UI layer).

### Entry and shell

- **main.tsx**: Renders `<App />` inside React `StrictMode`; imports `index.css`. Root element: `#root`.
- **App.tsx**: Bootstrap gate (ensureAuthToken); then `BrowserRouter` → `AppContent` + `NotificationToast`. AppContent: `Nav`, `<main>`, chat FAB, `ChatPanel`, `BackgroundVoiceIndicator`. Theme applied via `document.documentElement.dataset.theme` (apple | ocean); synced from config and localStorage `secretary_theme`.

### Routing (React Router)

| Path | Component | Purpose |
|------|-----------|---------|
| / | BriefPage | Daily brief: events, tasks, schedule blocks, overflow, reminders |
| /calendar | CalendarPage | FullCalendar (dayGrid, timeGrid, interaction); local events CRUD; create/edit/view modals |
| /tasks | TasksPage | Task list; create/edit modals; drag reorder; priority/energy/type/estimate; SSE refresh |
| /reminders | RemindersPage | Reminder list; create/edit; snooze; SSE refresh |
| /notes | NotesPage | Notes list; search; create/edit; link to tasks; SSE refresh |
| /settings | SettingsPage | Config: theme, notifications, proactive, voice (wake word, TTS, test), nudge appearance, export/import |

### Pages (packages/web/src/pages/)

- **BriefPage**: Date from URL `?date` or today; `<input type="date">`; GET /api/brief/:date; BRIEF_LIST_CAP 5; overlap warning (overlappingEventIds); "Generate schedule" POST /api/schedule/generate; ScheduleTimeline with Start/Complete/progress for task blocks, critical overflow alert; block styles BLOCK_STYLE, TASK_TYPE_STYLE (and ocean); HoverPreview.
- **CalendarPage**: Fetches GET /api/events?start=&end= (required) and GET /api/outlook/calendar?start=&end= in parallel; merges local + Outlook events (Outlook events have source "outlook", distinct styling); FullCalendar dayGrid, timeGrid, interaction; event click → view/edit; slot select → create; POST /api/events/parse-text for natural-language event creation; on data.changed entity "event" refetches.
- **TasksPage**: GET /api/tasks; todo list with native HTML5 drag-and-drop reorder (drag-handle, ordered_ids = todo order); PUT /api/tasks/reorder body `{ ordered_ids: string[] }`; priority badges (High/Medium/Low), energy dot, task type; ESTIMATE_CHIPS 15m–4h; form defaults time_estimate 30, energy_level medium, task_type deep_work; create/edit modal; PATCH progress; SSE data.changed refetch.
- **RemindersPage**: GET /api/reminders (optional query status); list with snooze/dismiss; create/edit modal; SSE refetch.
- **NotesPage**: GET /api/notes (q = FTS search, fallback LIKE; linked_event_id); create/edit; link tasks (getByIdWithTaskLinks); SSE refetch.
- **SettingsPage**: GET/PATCH /api/config; theme dropdown (apple, ocean); notification toggles; proactive toggles; voice (wake word, TTS, test mic, status); nudge appearance (position, colors, font, sound); export/import.

### Shared components (packages/web/src/components/)

- **ChatPanel**: Sliding panel; message list (user/assistant); slash command menu (SLASH_COMMANDS); task params (TASK_PARAMS) with Tab cycle; input + send; VoiceButton; copy on assistant messages; nudge messages with action buttons; listens for BG_VOICE_COMMAND_EVENT; sendChatMessage → optional TTS.
- **VoiceButton**: Toggle mic; VoiceEngine (wakeWord, transcribe); states: idle, listening, transcribing, speaking; tooltip with wake word.
- **HoverPreview**: EventPreview, TaskPreview, ReminderPreview, NotePreview — show on hover for calendar/task/reminder/note items.
- **NotificationToast**: useEventStream; reminder.due and secretary.nudge → toasts; position from nudgeAppearance; playNudgeSound; category labels; auto-dismiss for wellness/break.
- **NudgeMessagesModal**: Edit nudge message pools (wellness, break, checkin, motivation); used in Settings.
- **NotificationPreferences**: Notification toggles UI in Settings.
- **BackgroundVoiceIndicator**: Small indicator when always-on voice is listening (useBackgroundVoice state).

### Themes and styling (packages/web/src/index.css)

- **Design system**: CSS custom properties in `:root` — font-sans, font-mono; colors (bg, surface, text-primary/secondary, accent, green, orange, red, purple); spacing (--space-xs through --space-4xl); radius, shadows, transitions; --nav-height, --content-max-width, --content-narrow.
- **Theme apple**: Default light (--color-bg #fbfbfd, --color-accent #0071e3, etc.).
- **Theme ocean**: `[data-theme="ocean"]` — dark navy (--color-bg #0b1d3a, --color-surface #122a4e, --color-accent #00b4d8); overrides for .nav, .chat-panel, .voice-btn, .modal, inputs, etc.
- **Key class names**: .nav, .nav-link, .nav-link.active, .main-content, .chat-fab, .chat-fab-badge, .chat-panel, .chat-input-row, .voice-btn, .voice-btn--listening, .voice-btn--transcribing, .voice-btn--speaking, .voice-btn-wrap, .voice-status, .skip-link; modal .modal, .modal-overlay; toast position classes.

### Keyboard shortcuts (App.tsx and ChatPanel)

| Key | Action |
|-----|--------|
| Ctrl+K / Cmd+K | Toggle chat panel open/close |
| Ctrl+N / Cmd+N | Navigate to /tasks with openCreate |
| / | Open chat panel (when focus not in input/textarea) |
| Escape | Close chat panel |
| / in chat | Open slash command menu; Arrow Up/Down navigate; Enter select |
| Tab (in chat with /task) | Cycle next task param value |
