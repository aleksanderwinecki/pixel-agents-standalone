# Contributing to Pixel Agents

Thanks for your interest in contributing to Pixel Agents! All contributions are welcome — features, bug fixes, documentation improvements, refactors, and more.

This project is licensed under the [MIT License](LICENSE), so your contributions will be too. No CLA or DCO is required.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (LTS recommended)

### Setup

```bash
git clone <this-repo>
cd pixel-agents
npm install
npm run build
npm start
```

The server starts at `http://localhost:3000` and opens your browser.

## Development Workflow

After changing webview code, rebuild with `npm run build`. The server (`npm start`) runs via `tsx` so server changes take effect on restart — no build step needed.

### Project Structure

| Directory | Description |
|---|---|
| `server/` | Express + WebSocket server, hook handler, asset loading |
| `webview-ui/` | React + TypeScript frontend (separate Vite project) |
| `scripts/` | Asset extraction and generation tooling |
| `assets/` | Bundled sprites, catalog, and default layout |

## Code Guidelines

### Constants

**No unused locals or parameters** (`noUnusedLocals` and `noUnusedParameters` are enabled). All magic numbers and strings are centralized — don't add inline constants to source files:

- **Server:** top of `server/server.ts`
- **Webview:** `webview-ui/src/constants.ts`
- **CSS variables:** `webview-ui/src/index.css` `:root` block (`--pixel-*` properties)

### UI Styling

The project uses a pixel art aesthetic. All overlays should use:

- Sharp corners (`border-radius: 0`)
- Solid backgrounds and `2px solid` borders
- Hard offset shadows (`2px 2px 0px`, no blur)
- The FS Pixel Sans font (loaded in `index.css`)

## Submitting a Pull Request

1. Fork the repo and create a feature branch from `main`
2. Make your changes
3. Run the full build to verify everything passes:
   ```bash
   npm run build
   ```
4. Open a pull request against `main` with:
   - A clear description of what changed and why
   - How you tested the changes (steps to reproduce / verify)
   - **Screenshots or GIFs for any UI changes**

## Credits

Forked from [Pixel Agents](https://github.com/pablodelucca/pixel-agents) VS Code extension by [Pablo De Lucca](https://github.com/pablodelucca).

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.
