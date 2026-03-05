# Pixel Agents — Compressed Reference

Standalone server with React webview: pixel art office where AI agents (Claude Code sessions) are animated characters, tracked via Claude Code hooks.

## Architecture

```
server/
  server.ts               — Express + WebSocket server, hook handler, asset loading, layout persistence

webview-ui/src/           — React + TypeScript (Vite)
  constants.ts            — All webview magic numbers/strings (grid, animation, rendering, camera, zoom, editor, game logic, notification sound)
  vscodeApi.ts            — WebSocket client (connects to server, dispatches messages to window)
  notificationSound.ts    — Web Audio API chime on agent turn completion, with enable/disable
  App.tsx                 — Composition root, hooks + components + EditActionBar
  hooks/
    useExtensionMessages.ts — Message handler + agent/tool state
    useEditorActions.ts     — Editor state + callbacks
    useEditorKeyboard.ts    — Keyboard shortcut effect
  components/
    BottomToolbar.tsx      — + Agent, Layout toggle, Settings button
    ZoomControls.tsx       — +/- zoom (top-right)
    SettingsModal.tsx      — Centered modal: settings, export/import layout, sound toggle, debug toggle
    DebugView.tsx          — Debug overlay
  office/
    types.ts              — Interfaces (OfficeLayout, FloorColor, Character, etc.) + re-exports constants
    toolUtils.ts          — STATUS_TO_TOOL mapping, extractToolName(), defaultZoom()
    colorize.ts           — Dual-mode color module: Colorize (grayscale→HSL) + Adjust (HSL shift)
    floorTiles.ts         — Floor sprite storage + colorized cache
    wallTiles.ts          — Wall auto-tile: 16 bitmask sprites from walls.png
    sprites/
      spriteData.ts       — Pixel data: characters, furniture, tiles, bubbles
      spriteCache.ts      — SpriteData → offscreen canvas, per-zoom WeakMap cache, outline sprites
    editor/
      editorActions.ts    — Pure layout ops: paint, place, remove, move, rotate, toggleState, canPlace, expandLayout
      editorState.ts      — Imperative state: tools, ghost, selection, undo/redo, dirty, drag
      EditorToolbar.tsx   — React toolbar/palette for edit mode
    layout/
      furnitureCatalog.ts — Dynamic catalog from loaded assets + getCatalogEntry()
      layoutSerializer.ts — OfficeLayout ↔ runtime (tileMap, furniture, seats, blocked)
      tileMap.ts          — Walkability, BFS pathfinding
    engine/
      characters.ts       — Character FSM: idle/walk/type + wander AI
      officeState.ts      — Game world: layout, characters, seats, selection, subagents
      gameLoop.ts         — rAF loop with delta time (capped 0.1s)
      renderer.ts         — Canvas: tiles, z-sorted entities, overlays, edit UI
      matrixEffect.ts     — Matrix-style spawn/despawn digital rain effect
    components/
      OfficeCanvas.tsx    — Canvas, resize, DPR, mouse hit-testing, edit interactions, drag-to-move
      ToolOverlay.tsx     — Activity status label above hovered/selected character + close button

scripts/                  — Asset extraction pipeline
  0-import-tileset.ts     — Interactive CLI wrapper
  1-detect-assets.ts      — Flood-fill asset detection
  2-asset-editor.html     — Browser UI for position/bounds editing
  3-vision-inspect.ts     — Claude vision auto-metadata
  4-review-metadata.html  — Browser UI for metadata review
  5-export-assets.ts      — Export PNGs + furniture-catalog.json
  asset-manager.html      — Unified editor (Stage 2+4 combined)
  generate-walls.js       — Generate walls.png (4×4 grid of 16×32 auto-tile pieces)
  wall-tile-editor.html   — Browser UI for editing wall tile appearance
```

## Core Concepts

**Vocabulary**: Session = Claude Code session (identified by session_id from hooks). Agent = webview character bound 1:1 to a session.

**Server ↔ Webview**: WebSocket at `/ws`. Key messages: `openClaude`, `agentCreated/Closed`, `focusAgent`, `agentToolStart/Done/Clear`, `agentStatus`, `agentToolPermission`, `existingAgents`, `layoutLoaded`, `furnitureAssetsLoaded`, `floorTilesLoaded`, `wallTilesLoaded`, `saveLayout`, `saveAgentSeats`, `exportLayout`, `importLayout`, `settingsLoaded`, `setSoundEnabled`.

**Hook-based tracking**: Claude Code hooks (`~/.claude/settings.json`) fire `~/.pixel-agents/hook.sh` which curls `POST /api/hook` with the event JSON. The server auto-creates agents on first event from unknown sessions.

## Agent Status Tracking

**Hook events**: `SessionStart` (agent created), `UserPromptSubmit` (new turn, clear tools, set active), `PreToolUse` (tool start with status label), `PostToolUse`/`PostToolUseFailure` (tool done, 300ms delay), `Stop` (turn end, set waiting), `Notification` with `permission_prompt` (show permission bubble), `SessionEnd` (10s grace period then remove).

**Grace period**: `SessionEnd` doesn't immediately remove the agent — context compaction fires SessionEnd then immediately restarts. A 10s timer waits; any non-SessionEnd event cancels the timer. Only removes if no activity follows.

**Server state per agent**: `id, sessionId, activeToolIds, activeToolStatuses, isWaiting, permissionSent`.

**Layout persistence**: `~/.pixel-agents/layout.json` (atomic write via `.tmp` + rename). Default layout loaded from `assets/default-layout.json` on first run.

## Office UI

**Rendering**: Game state in imperative `OfficeState` class (not React state). Pixel-perfect: zoom = integer device-pixels-per-sprite-pixel (1x–10x). No `ctx.scale(dpr)`. Default zoom = `Math.round(2 * devicePixelRatio)`. Z-sort all entities by Y. Pan via middle-mouse drag (`panRef`). **Camera follow**: `cameraFollowId` smoothly centers camera on the followed agent; set on agent click, cleared on deselection or manual pan.

**UI styling**: Pixel art aesthetic — sharp corners (`borderRadius: 0`), solid backgrounds (`#1e1e2e`), `2px solid` borders, hard offset shadows (`2px 2px 0px #0a0a14`, no blur). CSS variables in `index.css` `:root` (`--pixel-bg`, `--pixel-border`, `--pixel-accent`, etc.). Pixel font: FS Pixel Sans.

**Characters**: FSM states — active (pathfind to seat, typing/reading animation by tool type), idle (wander randomly with BFS, return to seat for rest). 4-directional sprites, left = flipped right. Tool animations: typing (Write/Edit/Bash/Task) vs reading (Read/Grep/Glob/WebFetch). Sitting offset: characters shift down 6px when in TYPE state. **Diverse palette assignment**: `pickDiversePalette()` picks from least-used palette(s). First 6 agents each get a unique skin; beyond 6, skins repeat with random hue shift (45–315°).

**Spawn/despawn effect**: Matrix-style digital rain animation (0.3s). Restored agents (`existingAgents`) use `skipSpawnEffect: true` to appear instantly.

**Sub-agents**: Negative IDs (from -1 down). Created on `agentToolStart` with "Subtask:" prefix. Same palette + hueShift as parent. Not persisted.

**Speech bubbles**: Permission ("..." amber dots) stays until clicked/cleared. Waiting (green checkmark) auto-fades 2s.

**Sound notifications**: Two-note chime (E5 → E6) via Web Audio API on waiting bubble. Toggled via Settings modal.

**Seats**: Derived from chair furniture. `layoutToSeats()` creates seats at every footprint tile of every chair. Click character → select → click seat → reassign.

## Layout Editor

Toggle via "Layout" button. Tools: SELECT, Floor paint, Wall paint, Erase, Furniture place, Furniture pick (eyedropper), Eyedropper (floor).

**Floor**: 7 patterns from `floors.png`, colorizable via HSBC sliders (Colorize mode). **Walls**: Auto-tiling, HSBC color, click/drag toggle. **Furniture**: Ghost preview, R rotates, T toggles state, HSBC color per-item. **Undo/Redo**: 50-level, Ctrl+Z/Y. **Grid expansion**: Ghost border for growing grid (max 64×64).

**Layout model**: `{ version: 1, cols, rows, tiles: TileType[], furniture: PlacedFurniture[], tileColors?: FloorColor[] }`.

## Asset System

**Loading**: Server loads PNGs from `dist/assets/` (fallback: `webview-ui/public/assets/`). PNG → pngjs → SpriteData (2D hex array, alpha≥128). Sent to webview via WebSocket on connect.

**Catalog**: `furniture-catalog.json` — id, name, label, category, footprint, isDesk, canPlaceOnWalls, groupId?, orientation?, state?, canPlaceOnSurfaces?, backgroundTiles?. **Rotation groups**: shared `groupId`, editor shows 1 per group. **State groups**: on/off toggle pairs. **Auto-state**: electronics swap to ON when agent faces nearby desk.

**Character sprites**: 6 PNGs (`assets/characters/char_0.png`–`char_5.png`). Each 112×96: 7 frames × 16px, 3 directions × 32px. Frame order: walk1-3, type1-2, read1-2. Left = flipped right. **Load order**: characters → floors → walls → furniture → layout.

## Condensed Lessons

- Delay `agentToolDone` 300ms to prevent React batching from hiding brief active states
- PNG→SpriteData: pngjs for RGBA buffer, alpha threshold 128
- OfficeCanvas selection changes are imperative (`editorState.selectedFurnitureUid`); must call `onEditorSelectionChange()` to trigger React re-render
- Grace period on SessionEnd is essential — context compaction fires SessionEnd then immediately restarts
- Hook script must be regenerated when port changes (auto-done on server start)
- `curl --max-time 2` in hook script prevents Claude Code from hanging if server is down

## Build & Dev

```sh
npm install && npm run build && npm start
```

Build: webview (Vite) + asset copy. Server runs via `tsx` (no separate compile step).

## TypeScript Constraints

- No `enum` (`erasableSyntaxOnly`) — use `as const` objects
- `import type` required for type-only imports (`verbatimModuleSyntax`)
- `noUnusedLocals` / `noUnusedParameters`

## Constants

All magic numbers and strings are centralized:

- **Server**: constants are at the top of `server/server.ts`
- **Webview**: `webview-ui/src/constants.ts` — grid/layout sizes, animation speeds, rendering, camera, zoom, editor, game logic
- **CSS styling**: `webview-ui/src/index.css` `:root` — `--pixel-*` custom properties
- **Canvas overlay colors** live in webview constants (used in canvas 2D context, not CSS)
- `webview-ui/src/office/types.ts` re-exports grid/layout constants from `constants.ts`
