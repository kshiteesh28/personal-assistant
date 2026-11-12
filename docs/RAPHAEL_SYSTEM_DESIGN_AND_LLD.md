# KST v0.8 ("Raphael / Great Sage" Architecture): System Design, Low-Level Design (LLD) & Implementation Plan

**Target Hardware Profile**: Apple M4 Pro (12-core CPU, 16-core Neural Engine, 24 GB Unified Memory, ~273 GB/s memory bandwidth)  
**Operating Constraints**: 100% On-Device Execution • Zero Cloud APIs • Sub-50ms Routine Latency • Memory Budget <= 350 MB RSS (Standard) / <= 2.2 GB RSS (Optional Deep-Synthesis Burst)  
**Codebase Foundation**: `/Users/kshiteesh/Developer/personal secretary` (`KSTNLU3` C++17 N-API int8 engine + `AppleEcosystemBroker` + `NativeSystemBrokerSocket` + `FoundationModels` 3B)

---

## 1. Executive Vision: Why KST Outperforms Siri for Personal Work

Siri is designed as a broad, stateless, OS-wide consumer utility. By contrast, **J.A.R.V.I.S.** and **Raphael (Lord of Wisdom / Great Sage)** are characterized by four properties that Siri deliberately avoids:
1. **Stateful Work Memory with Provenance**: Raphael does not merely answer isolated queries; it maintains a continuously reconciled model of your active projects, unfinished tasks, terminal build failures, research tabs, skill gaps, and biological energy rhythms.
2. **Autonomous Multi-Skill Synthesis**: When you start a coding session, Raphael knows *which repository* you are in, *which error* broke your last test run, *which Safari/Gemini/ChatGPT thread* you were consulting, and *which Apple Music playlist* puts you into deep flow.
3. **Sub-Millisecond Personalized Adaptation**: Instead of sending data to the cloud or running a heavy 14B LLM that drains battery and throttles your M4 Pro, KST uses a **4-Head Micro-ML Pipeline (`KSTNLU4`)** (~512 KB total footprint, `< 0.4 ms` C++17 SIMD inference) paired with **Apple's zero-additional-RAM on-device FoundationModels 3B** and **Contextual LinUCB / Thompson Sampling bandits** that learn your personal habits locally.
4. **Side-by-Side Co-Pilot Presence**: KST works *alongside* you inside **iTerm2 / Terminal**, **Safari**, **ChatGPT.app**, **Claude.app**, and **Gemini Web/PWA**, reading active context via macOS Accessibility (`AXUIElement`) + AppleScript and injecting structured context blocks or executing verified project recipes with one voice command (`"Notice..."` / `"Report..."`).

---

## 2. Hardware-Aware Resource & Latency Budget (Apple M4 Pro, 24 GB RAM)

Your MacBook Pro has **Apple M4 Pro (12 CPU cores, 24 GB unified memory)**. Because you run heavy local workloads (Xcode/Swift builds, Docker/Node, multiple browser tabs, ChatGPT/Gemini apps), KST must never hog unified memory or cause thermal fan spin.

| Tier | Engine / Subsystem | Model / Algorithm | Disk / RAM Footprint | Inference Latency | Role in "Raphael" Architecture |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Tier 0A** | Acoustic & Voice Gate (`VoiceInput.swift`) | VoiceProcessingIO AEC + Spectral Noise Gate + Pitch/Formant Speaker ID + `WakeGate` | `~18 MB RAM` | `< 5 ms` per frame | Zero-CPU wake/standby gate (`"hey kst"`, `"total shut down"`), self-echo immunity, music rejection. |
| **Tier 0B** | Deterministic Reflex Router (`apple/runtime.mjs`) | Temporal & grammar reflex finite-state extractors | `~0 MB` (in-process JS) | `< 1.5 ms` | Instant execution for time, calendar CRUD, reminders, notes, mail drafts, Safari, and Schedule Plan. |
| **Tier 1A** | **Personal Style & Habit Engine (`KSTNLU4` C++17 N-API)** | **Multi-Head Int8 Passive-Aggressive + LinUCB Bandit + FSRS-4.5 Memory Decay** | **`528 KB` binary (`< 2 MB` RSS)** | **`0.18 ms` (NEON SIMD)** | **Intent classification (64 classes), Music/Flow selection, Nudge timing bandit, Learning topic ranker.** |
| **Tier 1B** | Semantic Work-Graph Index (`PersonalMemoryGraph`) | `NLEmbedding.sentenceEmbedding` (512-dim float16) + SQLite FTS5 BM25 | `~12 MB` per 10k records | `1.2 ms` hybrid search | Links projects, tasks, notes, Safari tabs, terminal errors, and AI chat threads with provenance. |
| **Tier 1C** | On-Device Language Synthesis (`LocalIntelligenceBroker.swift`) | Apple `FoundationModels` (`SystemLanguageModel.default` 3B on ANE) | **`0 MB` extra app RAM** (OS-shared ANE) | `~180 ms` TTFT | Natural "Raphael" persona synthesis, multi-tool orchestration, summarizing Safari/AI chats. |
| **Tier 1D** | Optional Deep Code/Math Co-Pilot (`KST_ENABLE_MLX=1`) | MLX-Swift 4-bit `Qwen2.5-Coder-3B-Instruct-4bit` (lazy-loaded on demand, auto-unloaded after 5m idle) | `~1.7 GB` wired *only when active* | `~65 tok/s` on M4 Pro GPU | Offline code refactoring, terminal stack-trace root-cause analysis when zero cloud is used. |

---

## 3. High-Level System Architecture

```
+---------------------------------------------------------------------------------------------------+
|                                   MACOS USER ENVIRONMENT (M4 PRO)                                 |
|  [Apple Calendar/Reminders/Notes/Mail]  [Apple Music]  [Safari / Chrome]  [ChatGPT / Gemini Apps] |
|  [iTerm2 / VS Code / Cursor]            [Siri / Spotlight / Apple Watch via AppIntents]           |
+---------------------------------------------------------------------------------------------------+
                 ^                                        ^                               ^
                 | EventKit / AppleScript                 | AXUIElement / JXA             | AppIntents
                 v                                        v                               v
+---------------------------------------------------------------------------------------------------+
|                           SWIFT NATIVE BROKER & SENSORY LAYER (KstApp)                            |
|  1. Full-Duplex Voice (VoiceProcessingIO + Speaker Formant ID + Barge-In Clause Tracker)          |
|  2. ContextHarvesterActor (10s diff-only poll: Active App, Window Title, Git Branch, Music Track) |
|  3. SidecarBridgeActor (Reads/Injects Context with Gemini, ChatGPT, Claude, Safari, iTerm2)       |
|  4. AppleEcosystemBroker + KstAppIntentsExtension (Siri -> b.sock -> KST Core)                    |
+---------------------------------------------------------------------------------------------------+
                                                 ^
                                                 | Owner-Only Length-Prefixed RPC (`b.sock`)
                                                 v
+---------------------------------------------------------------------------------------------------+
|                         NODE.JS CORE & PERSONAL ML ENGINE (`packages/kst-core`)                   |
|                                                                                                   |
|  +-----------------------------+   +------------------------------+   +------------------------+  |
|  |   Work Record Graph (SQL)   |   |  KSTNLU4 C++17 Native Addon  |   | Raphael Proactive Loop |  |
|  | - Entities + Provenance     |   | - Head 1: 64-Class Intent PA |   | - Ultradian Flow Timer |  |
|  | - Cross-Entity Edges        |   | - Head 2: LinUCB Nudge Bandit|   | - Music DJ Recommender |  |
|  | - FTS5 + 512d ANE Vectors   |   | - Head 3: Music/Flow Bandit  |   | - FSRS-4.5 Curriculum  |  |
|  | - Two-Stage Receipts        |   | - Head 4: Skill Priority Scorer  | - Pre-Meeting Briefs   |  |
|  +-----------------------------+   +------------------------------+   +------------------------+  |
+---------------------------------------------------------------------------------------------------+
```

---

## 4. Deep-Dive Brainstorm: "Jarvis / Raphael" Capabilities

### 4.1. Autonomous Skill & Learning Coach ("What to Learn & When")
* **How it works**: Every time you hit a terminal error, search documentation in Safari, ask Gemini/ChatGPT a technical question, or create a note/task, KST extracts **concept tags** (e.g., `Swift 6 Sendable actors`, `ARM64 NEON intrinsics`, `SQLite WAL concurrency`, `Distributed Systems consensus`) into a local `knowledge_skills` table.
* **Spaced Repetition & Mastery Decay (FSRS-4.5)**: Each skill node tracks `proficiency (0.0–1.0)`, `stability_days`, `difficulty`, `last_practiced_ts`, and `project_urgency_weight` (linked to your active project deadlines).
* **Proactive Daily Micro-Briefing**: When you have a 25-minute gap between meetings and your energy state is high, Raphael nudges:
  > *"Report. You have a 30-minute window before your 2:00 PM meeting. Based on yesterday's Swift concurrency build error and your upcoming v0.8 milestone, I recommend a 20-minute deep dive on `TaskGroup cancellation boundaries`. Shall I open your bookmarked Apple Developer guide and start your Deep Work playlist?"*

### 4.2. Biometric-Proxy Acoustic DJ ("What Music to Listen To")
* **Zero-Cloud Acoustic & Productivity Correlation**: KST observes your Apple Music library/playlists alongside your work telemetry (`context_switches_per_min`, `typing_cadence`, `task_type`, `hour_of_day`).
* **Contextual Thompson Sampling Bandit**: KST classifies your current work into 5 cognitive modes:
  1. `DEEP_ARCHITECTURE` (writing complex code/math)
  2. `FAST_EXECUTION` (clearing tasks, UI polish, bug bashes)
  3. `READING_RESEARCH` (reading papers/docs in Safari, talking to Gemini/ChatGPT)
  4. `ADMIN_COMMS` (answering Mail/iMessages, planning schedule)
  5. `RECOVERY_BREAK` (post-90-minute ultradian rest)
* **Automatic Reward Signal**: If KST plays a playlist (e.g., *Lo-Fi Synth*, *Hans Zimmer Instrumental*, *Ambient Focus*) during `DEEP_ARCHITECTURE` and you stay in iTerm/Xcode for 45+ minutes without skipping tracks or pausing, that `(mode, hour_bucket, playlist_id)` arm receives a `+1.0` reward. If you pause or skip within 3 minutes, it receives `-0.5`. Within one week, KST knows your exact sonic trigger for every type of work.

### 4.3. Side-by-Side Co-Pilot for Gemini, ChatGPT, Claude & Safari
* **The Problem**: When you use ChatGPT.app, Claude.app, or Gemini in Safari, you waste time re-explaining your current project, pasting terminal errors, or manually copying action items from the AI chat back into your calendar and task list.
* **The KST Side-by-Side Solution (`SidecarBridgeActor`)**:
  1. **Context Injection ("Brief Gemini / Brief ChatGPT")**: Say *"Hey KST, brief Gemini on my current bug"*. KST snapshots your active git diff summary, the last failing terminal command output, and your active task title, formats a compact `<project_context>` block, and injects it directly into the focused Gemini/ChatGPT prompt box via Accessibility (`AXValue` / clipboard-restore paste) — waiting for you to press Enter.
  2. **Output Harvesting ("Capture this plan")**: Say *"Hey KST, capture the action items from this chat"*. KST reads the active Gemini/ChatGPT response from the window accessibility tree (or Safari DOM), extracts tasks, code snippets, or deadlines, and stages them into your KST Work Graph and Apple Reminders.
  3. **Cross-Model Verification ("Cross-check with local context")**: When an AI suggests a library or command, KST checks your local `package.json` / `Package.swift` and warns you if the suggested dependency isn't installed or conflicts with your repo constraints.

### 4.4. Side-by-Side Terminal & IDE Operator (`iTerm2` / `VS Code` / `Xcode`)
* **Live Terminal Sentinel**: Using iTerm2's AppleScript API (`current session of current window`), KST reads the last 40 lines of visible terminal buffer when a command finishes with a non-zero exit code.
* **Instant Root-Cause & Recipe Staging**:
  * If a test fails, KST parses the file path and line number (`packages/kst-core/src/workspace.mjs:184`), checks `git diff`, and stage-prepares a fix or jump command.
  * You can say *"Open the failing line"* or *"Run the native checks again"*, and KST executes the allowlisted project recipe while keeping a tamper-evident receipt.

### 4.5. Adaptive Nudge Engine & Ultradian Rhythm Guardian
* **Why Standard Reminders Fail**: Fixed-time reminders interrupt you in the middle of deep flow, causing you to dismiss and forget them.
* **Raphael's Interruptibility Score $I(t) \in [0, 1]$**:
  * KST computes $I(t)$ every 30 seconds from local signals: `inMeeting`, `ttsActive`, `appSwitchDetected` (highest interruptibility right when you switch windows or finish a git commit!), `idleSeconds`, and `ultradianMinutesActive` (90-minute deep work cycle).
  * **Non-Urgent Nudges Wait for Transition Boundaries**: If a learning nudge or break reminder is due while you are deep in code ($I(t) < 0.25$), KST holds it silently and delivers it at the exact moment you switch apps or complete a terminal command ($I(t) > 0.75$).
  * **Explicit Bandit Feedback**: Saying *"Not now"*, *"Good catch"*, or *"Snooze"* updates the per-category LinUCB weights so KST learns when you welcome nudges and when you want silence.

### 4.6. Siri & Apple Watch Symbiosis via `AppIntents`
* Rather than fighting Siri for system-level reach, KST exposes 6 native `AppIntent` shortcuts (`KstScheduleDayIntent`, `KstCaptureTaskIntent`, `KstWhatToLearnIntent`, `KstFlowModeIntent`, `KstBriefExternalAIIntent`, `KstStatusReportIntent`).
* When you raise your Apple Watch or trigger Siri with AirPods, saying *"Siri, ask KST to start deep work"* invokes `KstApp` natively over `b.sock`.

---

## 5. Low-Level Design (LLD)

### 5.1. Work Record & Personal Memory Graph Schema (`migrations/002_raphael_graph.sql`)

All personal data lives in your private SQLite database (`secretary.sqlite` / `apple.sqlite` with `WAL` mode and `0600` permissions).

```sql
-- 1. Unified Work Entities with Provenance & Freshness
CREATE TABLE IF NOT EXISTS work_entities (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('project','task','meeting','reminder','note','decision','skill','ai_thread','terminal_failure')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  priority INTEGER NOT NULL DEFAULT 2,
  source_domain TEXT NOT NULL,         -- 'apple_calendar', 'iterm2', 'safari_gemini', 'chatgpt_app', 'voice', 'local'
  source_uri TEXT,                     -- native eventIdentifier, file:// path, or URL
  confidence REAL NOT NULL DEFAULT 1.0,
  created_ts INTEGER NOT NULL,
  updated_ts INTEGER NOT NULL,
  last_verified_ts INTEGER NOT NULL,
  embedding_f16 BLOB                   -- 512-dim float16 (1024 bytes) from Apple NLEmbedding
);

CREATE INDEX IF NOT EXISTS idx_work_entities_kind_status ON work_entities(kind, status, updated_ts DESC);

-- 2. Typed Directed Edges Connecting Your Work Context
CREATE TABLE IF NOT EXISTS work_edges (
  src_id TEXT NOT NULL,
  dst_id TEXT NOT NULL,
  relation TEXT NOT NULL CHECK(relation IN ('belongs_to','blocks','derived_from','discussed_in','requires_skill','triggered_by')),
  weight REAL NOT NULL DEFAULT 1.0,
  updated_ts INTEGER NOT NULL,
  PRIMARY KEY (src_id, dst_id, relation)
);

-- 3. FSRS-4.5 Skill & Learning Curriculum Tracker
CREATE TABLE IF NOT EXISTS knowledge_skills (
  skill_id TEXT PRIMARY KEY,
  topic TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,              -- 'swift', 'ml_systems', 'distributed_sys', 'security', 'math'
  proficiency REAL NOT NULL DEFAULT 0.3,
  stability_days REAL NOT NULL DEFAULT 1.0,
  difficulty REAL NOT NULL DEFAULT 5.0,
  encounter_count INTEGER NOT NULL DEFAULT 1,
  last_practiced_ts INTEGER NOT NULL,
  next_review_ts INTEGER NOT NULL,
  linked_project_id TEXT,
  recommended_resource_uri TEXT
);

-- 4. Contextual Bandit State (Music DJ + Nudge Timing + Flow Duration)
CREATE TABLE IF NOT EXISTS personal_bandits (
  bandit_domain TEXT NOT NULL,         -- 'music_dj', 'nudge_timing', 'focus_duration'
  arm_id TEXT NOT NULL,                -- e.g., playlist name or nudge action
  dimension INTEGER NOT NULL DEFAULT 16,
  matrix_a_f32 BLOB NOT NULL,          -- 16x16 covariance matrix (1024 bytes)
  vector_b_f32 BLOB NOT NULL,          -- 16x1 reward vector (64 bytes)
  pulls INTEGER NOT NULL DEFAULT 0,
  total_reward REAL NOT NULL DEFAULT 0.0,
  updated_ts INTEGER NOT NULL,
  PRIMARY KEY (bandit_domain, arm_id)
);

-- 5. Diff-Only Context Telemetry Ring Buffer (Capped to 7 days)
CREATE TABLE IF NOT EXISTS context_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  observed_ts INTEGER NOT NULL,
  frontmost_app TEXT NOT NULL,
  window_title_hash TEXT NOT NULL,
  work_mode TEXT NOT NULL,             -- 'DEEP_ARCHITECTURE', 'FAST_EXECUTION', 'READING_RESEARCH', 'ADMIN_COMMS', 'RECOVERY_BREAK'
  git_repo TEXT,
  git_branch TEXT,
  music_playlist TEXT,
  interruptibility_score REAL NOT NULL
);
```

---

### 5.2. Local ML Pipeline LLD (`KSTNLU4` Multi-Head Engine)

We extend your existing C++17 N-API addon (`packages/kst-core/native/understanding/addon.cc`) and JavaScript fallback (`model.mjs`) from `KSTNLU3` to **`KSTNLU4`** while keeping the exact same zero-dependency compilation (`clang++ -std=c++17 -O3`) and deterministic verification gates.

#### Head 1: 64-Class Sparse Int8 Passive-Aggressive Intent & Slot Router
* **Upgrade from `KSTNLU3`**: Expands `ROWS` from `32` (27 active) to `64` (48 active, 16 reserved) with `DIM = 4096`.
* **New Intent Classes (Indices 27–47)**:
  * `27: calendar.remove`, `28: calendar.reschedule`, `29: reminder.complete`, `30: note.append`
  * `31: learn.recommend` (*"what should I study now?"*, *"give me a learning topic"*)
  * `32: learn.logProgress` (*"mark Swift actors as practiced"*)
  * `33: music.recommendFlow` (*"play music for deep coding"*, *"put on my flow soundtrack"*)
  * `34: coPilot.briefExternalAI` (*"brief Gemini on this bug"*, *"send my terminal context to ChatGPT"*)
  * `35: coPilot.captureFromAI` (*"capture action items from this ChatGPT thread"*)
  * `36: coPilot.explainTerminalError` (*"why did my last build fail?"*)
  * `37: nudge.snoozeContext` (*"hold nudges until I finish this file"*)
  * `38: raphael.dailyBriefing` (*"status report"*, *"morning briefing"*)
* **Binary Artifact Size**: `64 × 4096` int8 weights (`262,144 B`) + scales + headers = **`264,192 B` (`~258 KB`)**.
* **Inference Math (ARM64 NEON SIMD)**:
  $$\hat{y} = \arg\max_{c \in \{0..47\}} s_c \sum_{k=1}^{nnz} W_{c, i_k} \cdot x_k$$
  Executes in **`< 0.12 ms`** on M4 Pro.

#### Head 2: Contextual LinUCB Nudge & Interruptibility Bandit (`nudge-bandit.mjs`)
* **Context Vector $\mathbf{z}_t \in \mathbb{R}^{16}$**:
  1. Bias term ($1.0$)
  2. $\sin(2\pi \cdot \text{hour}/24), \cos(2\pi \cdot \text{hour}/24)$ (Circadian phase)
  3. Ultradian phase: $\min(1.0, \text{continuousActiveMins} / 90)$
  4. App-switch boundary indicator ($\mathbb{I}[\text{secondsSinceAppSwitch} < 15]$)
  5. Terminal state indicator ($\mathbb{I}[\text{lastCommandFinishedWithin30s}]$)
  6. Calendar pressure ($\min(1.0, 60 / \text{minsToNextMeeting})$)
  7. Task urgency ($\text{overdueTaskCount} / 5$)
  8. Current work mode one-hot (5 dims)
  9. Recent dismissal penalty ($\text{dismissalsLast2Hours} / 3$)
  10. Audio state ($\mathbb{I}[\text{musicPlaying}]$)
  11. Battery/thermal nominal indicator
* **Decision Rule (Disjoint LinUCB)**:
  For each candidate action $a \in \{\text{DELIVER\_NOW}, \text{WAIT\_FOR\_APP\_SWITCH}, \text{DEFER\_30M}, \text{SILENCE}\}$:
  $$p_{t,a} = \hat{\boldsymbol{\theta}}_a^\top \mathbf{z}_t + \alpha \sqrt{\mathbf{z}_t^\top \mathbf{A}_a^{-1} \mathbf{z}_t}$$
  where $\mathbf{A}_a \in \mathbb{R}^{16 \times 16}$ and $\mathbf{b}_a \in \mathbb{R}^{16}$ update online in $O(d^2) = 256$ float operations (`< 0.02 ms`) whenever you accept (`r = +1.0`), ignore (`r = -0.2`), or dismiss (`r = -1.0`) a nudge!

#### Head 3: Acoustic & Flow Playlist Recommender (`music-bandit.mjs`)
* **Algorithm**: Contextual Thompson Sampling over your Apple Music playlists $m \in \mathcal{M}$ conditioned on `(work_mode, circadian_bucket)`:
  * Models reward probability via Beta-Bernoulli / Gaussian-Linear posterior $(\mu_{m,c}, \sigma_{m,c}^2)$.
  * Samples $\tilde{\theta}_{m,c} \sim \mathcal{N}(\mu_{m,c}, \sigma_{m,c}^2)$ and triggers `AppleEcosystemBroker.handleMusic("playPlaylist", playlist: bestArm)`.
  * Automatically records reward from **uninterrupted focus duration** over the next 25 minutes.

#### Head 4: FSRS-4.5 + Deadline Urgency Learning Recommender (`curriculum.mjs`)
* Computes a composite priority score $S(k)$ for every topic $k$ in `knowledge_skills`:
  $$R_k(t) = \left(1 + \frac{19}{81} \cdot \frac{t - t_{\text{last}, k}}{\text{stability}_k}\right)^{-0.5} \quad \text{(Retrievability decay)}$$
  $$S(k) = w_1 (1 - R_k(t)) + w_2 \cdot \text{ProjectUrgency}(k) + w_3 \cdot \text{RecentErrorFreq}(k)$$
* Recommends the top-scoring topic that fits your current free calendar block (e.g., 15 mins vs. 45 mins) and opens the exact local note, bookmarked Safari tab, or interactive quiz prompt.

---

### 5.3. Side-by-Side Co-Pilot Bridge LLD (`SidecarBridge.swift`)

To work side-by-side with **Gemini**, **ChatGPT**, **Claude**, **Safari**, and **iTerm2** without any cloud API keys:

```swift
/// Reads and injects structured work context into active desktop AI & developer apps
/// using macOS Accessibility (`AXUIElement`) and JXA/AppleScript.
actor SidecarBridgeActor {
    enum CompanionTarget: String, Sendable {
        case safariGemini = "safari.gemini"
        case safariChatGPT = "safari.chatgpt"
        case nativeChatGPT = "com.openai.chat"
        case nativeClaude = "com.anthropic.claudefordesktop"
        case iterm2 = "com.googlecode.iterm2"
    }

    /// 1. Extracts visible conversation or terminal buffer from the active companion app
    func readCompanionContext(target: CompanionTarget) async throws -> CompanionSnapshot

    /// 2. Stages a structured <kst_work_context> block into the companion app's input field
    ///    Never auto-submits unless the user explicitly says "and send".
    func injectPromptContext(target: CompanionTarget, markdownBlock: String, autoSubmit: Bool) async throws -> InjectReceipt
}
```

* **Safety Invariant**: `injectPromptContext` places the assembled context into the input area (or system pasteboard preview) and highlights it so you retain 100% visibility before pressing Return.

---

### 5.4. Siri & Apple Watch Integration LLD (`AppIntents.swift`)

Added directly to `apps/macos/Sources/KstApp/KstAppIntents.swift`:

```swift
import AppIntents

@available(macOS 14.0, *)
struct KstRaphaelBriefingIntent: AppIntent {
    static var title: LocalizedStringResource = "Ask KST for Work & Learning Briefing"
    static var description = IntentDescription("Returns your next focus block, recommended learning topic, and calendar summary from KST.")
    static var openAppWhenRun: Bool = false

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let reply = try await KstLocalLoopbackClient.shared.converse("raphael daily briefing")
        return .result(dialog: IntentDialog(stringLiteral: reply))
    }
}

@available(macOS 14.0, *)
struct KstStartFlowSessionIntent: AppIntent {
    static var title: LocalizedStringResource = "Start KST Deep Work Flow Session"
    @Parameter(title: "Focus Topic") var topic: String?
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let reply = try await KstLocalLoopbackClient.shared.converse("start flow session on \(topic ?? "current project")")
        return .result(dialog: IntentDialog(stringLiteral: reply))
    }
}
```

---

## 6. Phased Implementation Plan & Verification Matrix

### Phase 1: Durable Work Graph & Provenance Engine (`packages/kst-core/src/graph.mjs`)
* **Deliverables**:
  * Add `migrations/002_raphael_graph.sql` (`work_entities`, `work_edges`, `knowledge_skills`, `personal_bandits`, `context_snapshots`).
  * Implement `WorkGraphService` in `packages/kst-core/src/graph.mjs` with automatic entity linking across tasks, meetings, reminders, notes, and terminal/AI sessions.
  * Add native 512-dim sentence embedding generation in `AppleEcosystemBroker.swift` using `NaturalLanguage.NLEmbedding.sentenceEmbedding(for: .english)` (`0 MB` extra download, built into macOS).
* **Acceptance Gate**: Querying any project or task returns its linked meetings, notes, source provenance, freshness timestamp, and top-3 semantically related records in `< 3 ms`.

### Phase 2: `KSTNLU4` Multi-Head Local ML Pipeline (`packages/kst-core/src/understanding/`)
* **Deliverables**:
  * Upgrade `registry.mjs`, `model.mjs`, and `addon.cc` to 64 classes (`KSTNLU4`) while maintaining backwards compatibility with `KSTNLU3` seed tests.
  * Create `packages/kst-core/src/understanding/bandits.mjs` implementing the 16-dim Disjoint LinUCB Nudge Bandit and Contextual Thompson Sampling Music Bandit.
  * Create `packages/kst-core/src/understanding/curriculum.mjs` implementing FSRS-4.5 retrievability decay + project deadline urgency ranking.
* **Acceptance Gate**: `0.2 ms` native C++ inference, deterministic PCG32 replay, and mathematical convergence verification on simulated user reward trajectories.

### Phase 3: Side-by-Side Co-Pilot (`Gemini`, `ChatGPT`, `Claude`, `Safari`, `iTerm2`)
* **Deliverables**:
  * Create `apps/macos/Sources/KstApp/SidecarBridge.swift` for reading/injecting context across Safari (`gemini.google.com`, `chatgpt.com`), native `ChatGPT.app` / `Claude.app` (`AXUIElement`), and `iTerm2` sessions.
  * Add voice commands in `apple/runtime.mjs`:
    * *"brief Gemini / ChatGPT on my current task"*
    * *"capture tasks from this chat"*
    * *"explain my last terminal error"*
    * *"what should I learn right now?"*
    * *"play music for deep work"*
* **Acceptance Gate**: End-to-end voice command reads active iTerm2 error + git branch and stages a formatted prompt into Safari/ChatGPT in `< 150 ms`.

### Phase 4: Proactive Ultradian Nudge Loop & Siri `AppIntents`
* **Deliverables**:
  * Upgrade `workspace.tick()` and `ContextHarvesterActor` to compute real-time Interruptibility Score $I(t)$ and dispatch proactive nudges only at natural window-switch or command-completion boundaries.
  * Add `KstAppIntents.swift` exposing `AppShortcutsProvider` phrases to Siri, Spotlight, and Apple Watch.
  * Add "Raphael Mode" concise analytical voice persona toggle in `LocalIntelligenceBroker.swift`.
* **Acceptance Gate**: Zero mid-typing interruptions when $I(t) < 0.3$; immediate delivery within 5 seconds of a window switch or git commit; all `KstNativeChecks` and core test suites pass 100%.
