# ⚡ Flow-State

An intelligent, proactive AI assistant designed to manage your time, tasks, and well-being. Flow-State goes beyond a simple to-do list by actively observing your schedule, suggesting activities for downtime, and nudging you toward healthy work habits.

## 🚀 Key Features

- **📊 Intelligent Daily Brief**: Start your day with a comprehensive overview of your meetings, top priorities, and a realistically generated schedule.
- **🕒 Proactive Scheduling**: An advanced algorithm that slots tasks into your day based on priority, energy levels, and fixed calendar events (with automated buffers).
- **💬 Interactive Chat & Slash Commands**: Fast, command-driven interaction with smart parameter suggestions for tasks, notes, and reminders.
- **🍦 Downtime Pipeline**: Queue up low-priority or personal activities that Flow-State will suggest whenever an unexpected gap in your schedule appears.
- **🔔 Proactive Nudges**: Configurable wellness, break, and motivation alerts that respect your work hours and current activity.
- **🎙️ Voice Integration**: Local STT (Whisper) and TTS support for hands-free interaction and always-on wake-word detection.
- **🌊 Modern UI**: A sleek, responsive interface with Dark Mode (Ocean) and Light Mode (Apple) support.

## 🛠️ Tech Stack

- **Runtime**: [Bun](https://bun.sh/)
- **Backend**: [ElysiaJS](https://elysiajs.com/)
- **Frontend**: React (Vite)
- **Database**: SQLite (via `bun:sqlite`)
- **Intelligence**: Integrated LLM Copilot & custom scheduling heuristics.

## 📦 Getting Started

### Prerequisites

- [Bun](https://bun.sh/) installed on your machine.
- (Optional) FFmpeg installed if using Voice/Whisper features.

### Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd flow-state
   ```

2. Install dependencies:
   ```bash
   bun install
   ```

3. Setup environment (optional):
   The application will automatically create a `config.json` in the root on first run.

### Running the App

Start both the backend and frontend in development mode:
```bash
bun run dev
```

Visit `http://localhost:5173` to access the dashboard.

## 📖 Documentation

- [User Guide](./USER-GUIDE.md): How to make the most of Flow-State.
- [Changelog](./CHANGELOG.md): Recent features and architectural improvements.
- [Project Architecture](./PROJECT-ARCHITECTURE.md): Deep dive into the system design.

## ⚖️ License

MIT
