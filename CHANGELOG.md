# 📜 Changelog

All notable changes to the Flow-State project are documented here.

## [2026-03-15] - Documentation & Interface Refinement

### Added
- **Downtime Pipeline**: A new management system and UI for queueing activities during unexpected schedule gaps.
- **Smart Category Suggestions**: Overhauled the chat task-creation tool with hover-based popup menus for Priority, Energy, Task Type, etc.
- **Project Documentation**: Created `README.md`, `USER-GUIDE.md`, and this `CHANGELOG.md`.

### Fixed
- **SSE Stability**: Resolved the "Controller is already closed" error in the EventStream by implementing robust cleanup and heartbeat guards.
- **Task Parsing**: Fixed an issue where chat task metrics (e.g., `priority:1`) were being included in the task title. They are now correctly parsed and applied as properties.
- **UI Pinned Time**: Replaced the numeric "minutes from midnight" input with a standard Time Picker for pinned tasks.
- **Nudge Management**: Added configurable intervals for each nudge type in Settings to prevent over-notification.
- **Scheduler Buffers**: Integrated mandatory meeting buffers (10m pre / 5m post) and "Flex Anchors" (stabilizing gaps) into the scheduling algorithm.

### Changed
- **Chat Suggestion Workflow**: Suggestions now follow a two-tier logic (Category First -> Specific Metric Second) to reduce visual clutter.
- **Downtime Detection**: Updated the `DowntimePipelineService` to scan real daily schedule blocks for imminent gaps >= 15 minutes.

---

## [Initial Foundation] - Core System Implementation

- **Foundation**: Implementation of Tasks, Notes, Reminders, and Calendar repositories.
- **Briefing Engine**: Initial implementation of the Daily Briefing service and schedule designer.
- **Voice Pipeline**: Integration of Whisper STT and TTS services.
- **Cross-Platform Support**: Activity tracking for Windows and cross-platform SQLite persistence.
- **Design System**: Implementation of "Apple Light" and "Ocean Dark" themes.
