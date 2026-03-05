# Pixel Agents — Standalone

A standalone web app that turns your Claude Code sessions into animated pixel art characters in a virtual office. Fork of [Pixel Agents](https://github.com/pablodelucca/pixel-agents) VS Code extension, adapted to run as a standalone server using Claude Code hooks.

Each Claude Code session you open spawns a character that walks around, sits at desks, and visually reflects what the agent is doing — typing when writing code, reading when searching files, waiting when it needs your attention.

![Pixel Agents screenshot](webview-ui/public/Screenshot.jpg)

## How It Works

Unlike the VS Code extension (which monitors JSONL transcript files), this standalone version uses **Claude Code hooks** — shell commands that Claude Code runs at key lifecycle events. Every tool use, prompt submission, and session transition is reported to the server in real time. No file watching, no process detection, no heuristics.

The hook events:
- **SessionStart** — character spawns
- **UserPromptSubmit** — character activates (starts working)
- **PreToolUse** — status label updates with current tool (e.g., "Reading server.ts")
- **PostToolUse** — tool completes
- **Notification** — permission prompt detected (character shows "Needs approval")
- **Stop** — turn ends, character goes idle
- **SessionEnd** — character removed after 10s grace period (survives context compaction)

## Features

- **One session, one character** — every Claude Code session gets its own animated character
- **Live activity tracking** — characters animate based on what the agent is actually doing
- **Precise permission detection** — uses Notification hook, no timer guessing
- **Office layout editor** — design your office with floors, walls, and furniture
- **Speech bubbles** — visual indicators when an agent needs permission or is waiting
- **Sound notifications** — optional chime when an agent finishes its turn
- **Persistent layouts** — your office design is saved to `~/.pixel-agents/layout.json`
- **Works with any terminal** — not tied to VS Code; works with iTerm, tmux, Alacritty, etc.

## Quick Start

### 1. Build and start the server

```bash
git clone <this-repo>
cd pixel-agents-standalone
npm install
cd webview-ui && npm install && cd ..
npm run build
cd standalone && npm install && npm start
```

The server starts at `http://localhost:3000` and opens your browser automatically.

### 2. Configure Claude Code hooks

Add the following to your `~/.claude/settings.json`. If you already have hooks configured, merge these entries into the existing arrays.

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "~/.pixel-agents/hook.sh"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "~/.pixel-agents/hook.sh"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "~/.pixel-agents/hook.sh"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "~/.pixel-agents/hook.sh"
          }
        ]
      }
    ],
    "Notification": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "~/.pixel-agents/hook.sh"
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "~/.pixel-agents/hook.sh"
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "~/.pixel-agents/hook.sh"
          }
        ]
      }
    ]
  }
}
```

The hook script (`~/.pixel-agents/hook.sh`) is auto-generated when the server starts. It pipes Claude Code's hook event JSON to the server via curl. If you change the port, restart the server to regenerate the script.

### 3. Use Claude Code

Run `claude` in any terminal. Characters appear automatically in the browser.

## Options

```
npm start -- --port 3000    # Change port (default: 3000)
npm start -- --no-open      # Don't auto-open browser
```

## Agent Lifecycle

- **Spawn**: Any hook event (except SessionEnd) from an unknown session creates a new character
- **Active**: PreToolUse/UserPromptSubmit set the character to working state
- **Idle**: Stop hook sets the character to idle (wandering around the office)
- **Permission**: Notification hook with `permission_prompt` shows "Needs approval" bubble
- **Removal**: SessionEnd starts a 10s grace timer. If no activity follows, character despawns. Context compaction fires SessionEnd then immediately restarts — the grace period handles this seamlessly
- **Manual close**: Click a character to select it, then click the X button

## Layout Editor

The built-in editor lets you design your office:

- **Floor** — Full HSB color control
- **Walls** — Auto-tiling walls with color customization
- **Tools** — Select, paint, erase, place, eyedropper, pick
- **Undo/Redo** — 50 levels with Ctrl+Z / Ctrl+Y
- **Export/Import** — Share layouts as JSON files via the Settings modal

### Office Assets

The office tileset is **[Office Interior Tileset (16x16)](https://donarg.itch.io/officetileset)** by **Donarg** ($2 USD on itch.io). It is not included in this repository. To use the full furniture catalog:

```bash
npm run import-tileset
```

The app works without the tileset — you get default characters and a basic layout.

## Tech Stack

- **Server**: Node.js, Express, WebSocket, pngjs
- **Frontend**: React 19, TypeScript, Vite, Canvas 2D
- **Communication**: Claude Code hooks → curl → HTTP POST → WebSocket broadcast

## Differences from VS Code Extension

| | VS Code Extension | Standalone |
|---|---|---|
| Runtime | VS Code webview panel | Browser + Node.js server |
| Agent detection | JSONL file watching + process detection | Claude Code hooks only |
| Permission detection | Timer-based heuristic (7s delay) | Notification hook (instant) |
| Terminal integration | VS Code terminals only | Any terminal emulator |
| Agent creation | "+ Agent" button creates terminal | Run `claude` anywhere |

## Credits

- Original [Pixel Agents](https://github.com/pablodelucca/pixel-agents) by [Pablo De Lucca](https://github.com/pablodelucca)
- Characters based on [Metro City](https://jik-a-4.itch.io/metrocity-free-topdown-character-pack) by JIK-A-4
- Office tileset by [Donarg](https://donarg.itch.io/officetileset)

## License

This project is licensed under the [MIT License](LICENSE).
