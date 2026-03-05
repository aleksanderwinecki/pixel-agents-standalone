# Changelog

## v2.0.0 — Standalone Server

Complete rewrite from VS Code extension to standalone server.

- **Hook-based tracking** — uses Claude Code hooks instead of JSONL file watching
- **Browser UI** — runs in any browser, not tied to VS Code webview
- **WebSocket transport** — real-time server↔client communication
- **Any terminal** — works with iTerm, tmux, Alacritty, etc.
- **Instant permission detection** — Notification hook replaces timer-based heuristic

## Pre-fork (VS Code Extension)

See the original [Pixel Agents](https://github.com/pablodelucca/pixel-agents) repository for VS Code extension changelog.
