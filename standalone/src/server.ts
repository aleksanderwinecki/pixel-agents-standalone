#!/usr/bin/env node
/**
 * Pixel Agents — Standalone Server (Hooks-based)
 *
 * Uses Claude Code hooks for real-time agent state tracking.
 * No JSONL monitoring, no process detection — just clean hook events.
 *
 * Usage: npm start [-- --port 3000] [-- --no-open]
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'
import express from 'express'
import { createServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { PNG } from 'pngjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '..', '..')

// ─── CLI Args ────────────────────────────────────────────────────

function parseArgs(): { port: number; open: boolean } {
  const args = process.argv.slice(2)
  let port = 3000
  let open = true

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) port = parseInt(args[++i], 10)
    else if (args[i] === '--no-open') open = false
    else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
Pixel Agents Standalone Server

Uses Claude Code hooks for real-time agent tracking.

Usage: npm start [-- options]

Options:
  --port <number> HTTP server port (default: 3000)
  --no-open       Don't auto-open browser
  --help, -h      Show this help
`)
      process.exit(0)
    }
  }
  return { port, open }
}

const config = parseArgs()

// ─── Constants ───────────────────────────────────────────────────

const TOOL_DONE_DELAY_MS = 300
const SESSION_END_GRACE_MS = 10_000  // wait 10s after SessionEnd before removing
const BASH_CMD_MAX = 30
const TASK_DESC_MAX = 40
const PNG_ALPHA = 128
const LAYOUT_DIR = path.join(os.homedir(), '.pixel-agents')
const LAYOUT_FILE = path.join(LAYOUT_DIR, 'layout.json')
const HOOK_SCRIPT_PATH = path.join(LAYOUT_DIR, 'hook.sh')
const CLAUDE_PROJECTS_ROOT = path.join(os.homedir(), '.claude', 'projects')

// ─── Types ───────────────────────────────────────────────────────

interface AgentState {
  id: number
  sessionId: string
  activeToolIds: Map<string, string>      // toolId → toolName
  activeToolStatuses: Map<string, string>  // toolId → status text
  isWaiting: boolean
  permissionSent: boolean
}

// ─── Global State ────────────────────────────────────────────────

const agents = new Map<number, AgentState>()
const sessionIdToAgentId = new Map<string, number>()
let nextAgentId = 1
let nextToolId = 1
const sessionEndTimers = new Map<number, ReturnType<typeof setTimeout>>()
const pendingToolDoneTimers = new Map<number, ReturnType<typeof setTimeout>[]>()
const clients = new Set<WebSocket>()

// Cached assets
let assets: {
  characterSprites: { characters: Array<{ down: string[][][]; up: string[][][]; right: string[][][] }> } | null
  floorTiles: { sprites: string[][][] } | null
  wallTiles: { sprites: string[][][] } | null
  furniture: { catalog: unknown[]; sprites: Record<string, string[][]> }
  defaultLayout: Record<string, unknown> | null
} | null = null

let agentSeats: Record<number, { palette?: number; hueShift?: number; seatId?: string }> = {}
let soundEnabled = true

// ─── Broadcast ───────────────────────────────────────────────────

function broadcast(msg: unknown): void {
  const data = JSON.stringify(msg)
  for (const c of clients) {
    if (c.readyState === WebSocket.OPEN) c.send(data)
  }
}

function sendTo(ws: WebSocket, msg: unknown): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
}

// ─── PNG Helpers ─────────────────────────────────────────────────

function readPixel(data: Buffer, width: number, x: number, y: number): string {
  const idx = (y * width + x) * 4
  const r = data[idx], g = data[idx + 1], b = data[idx + 2], a = data[idx + 3]
  if (a < PNG_ALPHA) return ''
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase()
}

function extractRegion(png: PNG, ox: number, oy: number, w: number, h: number): string[][] {
  const sprite: string[][] = []
  for (let y = 0; y < h; y++) {
    const row: string[] = []
    for (let x = 0; x < w; x++) row.push(readPixel(png.data as unknown as Buffer, png.width, ox + x, oy + y))
    sprite.push(row)
  }
  return sprite
}

// ─── Asset Loading ───────────────────────────────────────────────

function findAssetsDir(): string | null {
  for (const dir of [
    path.join(PROJECT_ROOT, 'dist', 'assets'),
    path.join(PROJECT_ROOT, 'webview-ui', 'public', 'assets'),
  ]) {
    if (fs.existsSync(dir)) return dir
  }
  return null
}

function loadCharacterSprites(assetsDir: string) {
  const charDir = path.join(assetsDir, 'characters')
  if (!fs.existsSync(charDir)) return null
  const characters: Array<{ down: string[][][]; up: string[][][]; right: string[][][] }> = []
  const DIRS = ['down', 'up', 'right'] as const
  for (let i = 0; i < 6; i++) {
    const fp = path.join(charDir, `char_${i}.png`)
    if (!fs.existsSync(fp)) return null
    const png = PNG.sync.read(fs.readFileSync(fp))
    const charData: Record<string, string[][][]> = { down: [], up: [], right: [] }
    for (let d = 0; d < 3; d++) {
      const frames: string[][][] = []
      for (let f = 0; f < 7; f++) {
        frames.push(extractRegion(png, f * 16, d * 32, 16, 32))
      }
      charData[DIRS[d]] = frames
    }
    characters.push(charData as { down: string[][][]; up: string[][][]; right: string[][][] })
  }
  console.log(`  Characters: ${characters.length} loaded`)
  return { characters }
}

function loadFloorTiles(assetsDir: string) {
  const fp = path.join(assetsDir, 'floors.png')
  if (!fs.existsSync(fp)) return null
  const png = PNG.sync.read(fs.readFileSync(fp))
  const sprites: string[][][] = []
  for (let t = 0; t < 7; t++) sprites.push(extractRegion(png, t * 16, 0, 16, 16))
  console.log(`  Floor tiles: ${sprites.length} loaded`)
  return { sprites }
}

function loadWallTiles(assetsDir: string) {
  const fp = path.join(assetsDir, 'walls.png')
  if (!fs.existsSync(fp)) return null
  const png = PNG.sync.read(fs.readFileSync(fp))
  const sprites: string[][][] = []
  for (let mask = 0; mask < 16; mask++) {
    sprites.push(extractRegion(png, (mask % 4) * 16, Math.floor(mask / 4) * 32, 16, 32))
  }
  console.log(`  Wall tiles: ${sprites.length} loaded`)
  return { sprites }
}

function loadFurniture(assetsDir: string) {
  const assetsRoot = path.dirname(assetsDir)
  const catalogPath = path.join(assetsDir, 'furniture', 'furniture-catalog.json')
  if (!fs.existsSync(catalogPath)) return { catalog: [], sprites: {} }
  const catalogData = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'))
  const catalog: unknown[] = catalogData.assets || []
  const sprites: Record<string, string[][]> = {}
  for (const asset of catalog as Array<{ id: string; file: string; width: number; height: number }>) {
    let fp = asset.file
    if (!fp.startsWith('assets/')) fp = `assets/${fp}`
    const assetPath = path.join(assetsRoot, fp)
    if (fs.existsSync(assetPath)) {
      const png = PNG.sync.read(fs.readFileSync(assetPath))
      sprites[asset.id] = extractRegion(png, 0, 0, asset.width, asset.height)
    }
  }
  console.log(`  Furniture: ${Object.keys(sprites).length}/${catalog.length} loaded`)
  return { catalog, sprites }
}

function loadDefaultLayout(assetsDir: string): Record<string, unknown> | null {
  const fp = path.join(assetsDir, 'default-layout.json')
  if (!fs.existsSync(fp)) return null
  console.log(`  Default layout: loaded`)
  return JSON.parse(fs.readFileSync(fp, 'utf-8'))
}

function loadAllAssets() {
  const assetsDir = findAssetsDir()
  if (!assetsDir) {
    console.log('[Assets] No assets directory found — UI will use fallbacks')
    assets = { characterSprites: null, floorTiles: null, wallTiles: null, furniture: { catalog: [], sprites: {} }, defaultLayout: null }
    return
  }
  console.log(`[Assets] Loading from: ${assetsDir}`)
  assets = {
    characterSprites: loadCharacterSprites(assetsDir),
    floorTiles: loadFloorTiles(assetsDir),
    wallTiles: loadWallTiles(assetsDir),
    furniture: loadFurniture(assetsDir),
    defaultLayout: loadDefaultLayout(assetsDir),
  }
}

// ─── Layout Persistence ──────────────────────────────────────────

function readLayout(): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(LAYOUT_FILE)) return null
    return JSON.parse(fs.readFileSync(LAYOUT_FILE, 'utf-8'))
  } catch { return null }
}

function writeLayout(layout: Record<string, unknown>): void {
  try {
    if (!fs.existsSync(LAYOUT_DIR)) fs.mkdirSync(LAYOUT_DIR, { recursive: true })
    const tmp = LAYOUT_FILE + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(layout, null, 2), 'utf-8')
    fs.renameSync(tmp, LAYOUT_FILE)
  } catch (err) {
    console.error('[Layout] Write error:', err)
  }
}

function hasFurnitureCatalog(): boolean {
  return (assets?.furniture.catalog.length ?? 0) > 0
}

function getLayout(): Record<string, unknown> | null {
  const fromFile = readLayout()
  if (fromFile) return fromFile
  if (hasFurnitureCatalog() && assets?.defaultLayout) {
    writeLayout(assets.defaultLayout)
    return assets.defaultLayout
  }
  return null
}

function cancelPendingToolDone(agentId: number): void {
  const timers = pendingToolDoneTimers.get(agentId)
  if (timers) {
    for (const t of timers) clearTimeout(t)
    pendingToolDoneTimers.delete(agentId)
  }
}

// ─── Tool Status Formatting ─────────────────────────────────────

function formatToolStatus(toolName: string, input: Record<string, unknown>): string {
  const base = (p: unknown) => typeof p === 'string' ? path.basename(p) : ''
  switch (toolName) {
    case 'Read': return `Reading ${base(input.file_path)}`
    case 'Edit': return `Editing ${base(input.file_path)}`
    case 'Write': return `Writing ${base(input.file_path)}`
    case 'Bash': {
      const cmd = (input.command as string) || ''
      return `Running: ${cmd.length > BASH_CMD_MAX ? cmd.slice(0, BASH_CMD_MAX) + '\u2026' : cmd}`
    }
    case 'Glob': return 'Searching files'
    case 'Grep': return 'Searching code'
    case 'WebFetch': return 'Fetching web content'
    case 'WebSearch': return 'Searching the web'
    case 'Task': {
      const desc = typeof input.description === 'string' ? input.description : ''
      return desc ? `Subtask: ${desc.length > TASK_DESC_MAX ? desc.slice(0, TASK_DESC_MAX) + '\u2026' : desc}` : 'Running subtask'
    }
    case 'AskUserQuestion': return 'Waiting for your answer'
    case 'EnterPlanMode': return 'Planning'
    case 'NotebookEdit': return 'Editing notebook'
    default: return `Using ${toolName}`
  }
}

// ─── Agent Management ────────────────────────────────────────────

function createAgent(sessionId: string): number {
  const id = nextAgentId++
  const agent: AgentState = {
    id,
    sessionId,
    activeToolIds: new Map(),
    activeToolStatuses: new Map(),
    isWaiting: true,
    permissionSent: false,
  }
  agents.set(id, agent)
  sessionIdToAgentId.set(sessionId, id)
  console.log(`[Agent ${id}] Session ${sessionId.slice(0, 8)}…`)
  broadcast({ type: 'agentCreated', id })
  broadcast({ type: 'agentStatus', id, status: 'waiting' })
  return id
}

function removeAgent(agentId: number): void {
  const agent = agents.get(agentId)
  if (!agent) return
  const endTimer = sessionEndTimers.get(agentId)
  if (endTimer) { clearTimeout(endTimer); sessionEndTimers.delete(agentId) }
  sessionIdToAgentId.delete(agent.sessionId)
  agents.delete(agentId)
  console.log(`[Agent ${agentId}] Removed`)
  broadcast({ type: 'agentClosed', id: agentId })
}

// ─── Claude Code Hooks ──────────────────────────────────────────

function handleHookEvent(body: Record<string, unknown>): void {
  const sessionId = body.session_id as string
  const event = body.hook_event_name as string
  if (!sessionId || !event) return

  let agentId = sessionIdToAgentId.get(sessionId)
  console.log(`[Hook] ${event} session=${sessionId.slice(0, 8)}… agent=${agentId ?? 'new'}`)

  // Auto-create agent on any event except SessionEnd
  if (agentId === undefined && event !== 'SessionEnd') {
    agentId = createAgent(sessionId)
  }

  if (agentId === undefined) return
  const agent = agents.get(agentId)
  if (!agent) return

  // Any non-SessionEnd activity cancels a pending removal (e.g. compaction restart)
  if (event !== 'SessionEnd') {
    const pending = sessionEndTimers.get(agentId)
    if (pending) { clearTimeout(pending); sessionEndTimers.delete(agentId) }
  }

  switch (event) {
    case 'UserPromptSubmit': {
      // New turn — clear previous tool state, activate
      cancelPendingToolDone(agentId)
      if (agent.activeToolIds.size > 0) {
        agent.activeToolIds.clear()
        agent.activeToolStatuses.clear()
        broadcast({ type: 'agentToolsClear', id: agentId })
      }
      agent.isWaiting = false
      agent.permissionSent = false
      broadcast({ type: 'agentStatus', id: agentId, status: 'active' })
      break
    }

    case 'PreToolUse': {
      // Clear any previous tools — only the current tool matters
      cancelPendingToolDone(agentId)
      if (agent.activeToolIds.size > 0) {
        agent.activeToolIds.clear()
        agent.activeToolStatuses.clear()
        broadcast({ type: 'agentToolsClear', id: agentId })
      }

      const toolName = body.tool_name as string || 'Unknown'
      const toolInput = body.tool_input as Record<string, unknown> || {}
      const toolId = `hook-${nextToolId++}`
      const status = formatToolStatus(toolName, toolInput)

      agent.activeToolIds.set(toolId, toolName)
      agent.activeToolStatuses.set(toolId, status)
      agent.isWaiting = false
      agent.permissionSent = false
      broadcast({ type: 'agentStatus', id: agentId, status: 'active' })
      broadcast({ type: 'agentToolStart', id: agentId, toolId, status })
      break
    }

    case 'PostToolUse':
    case 'PostToolUseFailure': {
      const toolName = body.tool_name as string || ''
      // Find oldest matching active tool
      let matchedToolId: string | null = null
      for (const [tid, tn] of agent.activeToolIds) {
        if (tn === toolName) { matchedToolId = tid; break }
      }
      if (matchedToolId) {
        agent.activeToolIds.delete(matchedToolId)
        agent.activeToolStatuses.delete(matchedToolId)
        const tid = matchedToolId
        const aid = agentId
        const timer = setTimeout(() => {
          const timers = pendingToolDoneTimers.get(aid)
          if (timers) {
            const idx = timers.indexOf(timer)
            if (idx !== -1) timers.splice(idx, 1)
            if (timers.length === 0) pendingToolDoneTimers.delete(aid)
          }
          broadcast({ type: 'agentToolDone', id: aid, toolId: tid })
        }, TOOL_DONE_DELAY_MS)
        const existing = pendingToolDoneTimers.get(agentId) || []
        existing.push(timer)
        pendingToolDoneTimers.set(agentId, existing)
      }
      break
    }

    case 'Stop': {
      cancelPendingToolDone(agentId)
      if (agent.activeToolIds.size > 0) {
        agent.activeToolIds.clear()
        agent.activeToolStatuses.clear()
        broadcast({ type: 'agentToolsClear', id: agentId })
      }
      agent.isWaiting = true
      agent.permissionSent = false
      broadcast({ type: 'agentStatus', id: agentId, status: 'waiting' })
      break
    }

    case 'Notification': {
      const notificationType = body.notification_type as string
      if (notificationType === 'permission_prompt') {
        agent.permissionSent = true
        broadcast({ type: 'agentToolPermission', id: agentId })
      }
      break
    }

    case 'SessionEnd': {
      // Grace period: compaction fires SessionEnd then immediately restarts.
      // Wait a bit — if no activity follows, remove the agent.
      const endId = agentId
      const t = setTimeout(() => {
        sessionEndTimers.delete(endId)
        console.log(`[Agent ${endId}] Session ended (no restart after grace period)`)
        removeAgent(endId)
      }, SESSION_END_GRACE_MS)
      sessionEndTimers.set(agentId, t)
      break
    }

    case 'SessionStart':
      // Agent already auto-created above, just waiting for activity.
      break
  }
}

// ─── Hook Setup ─────────────────────────────────────────────────

function setupHookScript(port: number): void {
  try {
    if (!fs.existsSync(LAYOUT_DIR)) fs.mkdirSync(LAYOUT_DIR, { recursive: true })
    const script = `#!/bin/bash
# Pixel Agents hook — forwards Claude Code events to the standalone server.
# Auto-generated on server start. Port: ${port}
curl -s --max-time 2 -X POST "http://localhost:${port}/api/hook" \\
  -H "Content-Type: application/json" \\
  -d @- \\
  >/dev/null 2>&1 || true
`
    fs.writeFileSync(HOOK_SCRIPT_PATH, script, { mode: 0o755 })
  } catch (err) {
    console.error('[Hook] Failed to write hook script:', err)
  }
}

function getHooksConfig(): string {
  const hookEntry = { matcher: '', hooks: [{ type: 'command', command: HOOK_SCRIPT_PATH }] }
  return JSON.stringify({
    hooks: {
      SessionStart: [hookEntry],
      UserPromptSubmit: [hookEntry],
      PreToolUse: [hookEntry],
      PostToolUse: [hookEntry],
      Notification: [hookEntry],
      Stop: [hookEntry],
      SessionEnd: [hookEntry],
    }
  }, null, 2)
}

// ─── Client State Push ───────────────────────────────────────────

function sendInitialState(ws: WebSocket): void {
  if (!assets) return

  if (assets.characterSprites) {
    sendTo(ws, { type: 'characterSpritesLoaded', characters: assets.characterSprites.characters })
  }
  if (assets.floorTiles) {
    sendTo(ws, { type: 'floorTilesLoaded', sprites: assets.floorTiles.sprites })
  }
  if (assets.wallTiles) {
    sendTo(ws, { type: 'wallTilesLoaded', sprites: assets.wallTiles.sprites })
  }
  if (assets.furniture.catalog.length > 0) {
    sendTo(ws, { type: 'furnitureAssetsLoaded', catalog: assets.furniture.catalog, sprites: assets.furniture.sprites })
  }

  sendTo(ws, { type: 'settingsLoaded', soundEnabled })

  // Existing agents
  const agentIds = [...agents.keys()].sort((a, b) => a - b)
  sendTo(ws, { type: 'existingAgents', agents: agentIds, agentMeta: agentSeats })

  // Layout
  const layout = getLayout()
  sendTo(ws, { type: 'layoutLoaded', layout })

  // Re-send current agent statuses
  for (const [agentId, agent] of agents) {
    for (const [toolId, status] of agent.activeToolStatuses) {
      sendTo(ws, { type: 'agentToolStart', id: agentId, toolId, status })
    }
    if (agent.isWaiting) {
      sendTo(ws, { type: 'agentStatus', id: agentId, status: 'waiting' })
    }
    if (agent.permissionSent) {
      sendTo(ws, { type: 'agentToolPermission', id: agentId })
    }
  }
}

// ─── Client Message Handler ──────────────────────────────────────

function handleMessage(ws: WebSocket, raw: string): void {
  let msg: Record<string, unknown>
  try { msg = JSON.parse(raw) } catch { return }

  switch (msg.type) {
    case 'webviewReady':
      sendInitialState(ws)
      break

    case 'saveLayout':
      writeLayout(msg.layout as Record<string, unknown>)
      break

    case 'saveAgentSeats':
      agentSeats = msg.seats as typeof agentSeats
      break

    case 'setSoundEnabled':
      soundEnabled = msg.enabled as boolean
      break

    case 'closeAgent': {
      const id = msg.id as number
      removeAgent(id)
      break
    }

    case 'openClaude':
      console.log('[Server] "Add Agent" clicked — run `claude` in your terminal to create agents')
      break

    case 'focusAgent':
      break

    case 'openSessionsFolder':
      if (fs.existsSync(CLAUDE_PROJECTS_ROOT)) {
        try {
          if (process.platform === 'darwin') execSync(`open "${CLAUDE_PROJECTS_ROOT}"`)
          else if (process.platform === 'linux') execSync(`xdg-open "${CLAUDE_PROJECTS_ROOT}"`)
          else if (process.platform === 'win32') execSync(`explorer "${CLAUDE_PROJECTS_ROOT}"`)
        } catch { /* ignore */ }
      }
      break

    case 'exportLayout': {
      const layout = readLayout()
      if (layout) sendTo(ws, { type: 'downloadLayout', layout })
      break
    }

    case 'importLayout':
      break
  }
}

// ─── HTTP + WebSocket Server ─────────────────────────────────────

function startServer(): void {
  loadAllAssets()

  const webviewDir = path.join(PROJECT_ROOT, 'dist', 'webview')
  if (!fs.existsSync(webviewDir)) {
    console.error(`\n[Error] Webview build not found at: ${webviewDir}`)
    console.error('Run this first:')
    console.error('  cd webview-ui && npm install && npm run build')
    console.error('')
    process.exit(1)
  }

  const app = express()

  // Hook endpoint — receives events from Claude Code hooks
  app.post('/api/hook', express.json({ limit: '10mb' }), (req, res) => {
    handleHookEvent(req.body as Record<string, unknown>)
    res.json({ ok: true })
  })

  // Serve webview static files
  app.use(express.static(webviewDir))

  // Fallback to index.html for SPA routing
  app.get('/{*splat}', (_req, res) => {
    res.sendFile(path.join(webviewDir, 'index.html'))
  })

  const server = createServer(app)
  const wss = new WebSocketServer({ server, path: '/ws' })

  wss.on('connection', (ws) => {
    clients.add(ws)
    console.log(`[WS] Client connected (${clients.size} total)`)

    ws.on('message', (data) => handleMessage(ws, data.toString()))
    ws.on('close', () => {
      clients.delete(ws)
      console.log(`[WS] Client disconnected (${clients.size} total)`)
    })
  })

  // Write hook script with current port
  setupHookScript(config.port)

  server.listen(config.port, () => {
    const url = `http://localhost:${config.port}`
    console.log('')
    console.log('  Pixel Agents Standalone')
    console.log('  ========================')
    console.log(`  UI:        ${url}`)
    console.log(`  Hook API:  ${url}/api/hook`)
    console.log('')
    console.log('  Agents appear automatically when hooks are configured.')
    console.log('  Run "claude" in any terminal to see characters!')
    console.log('')
    console.log('  Add to ~/.claude/settings.json (merge with existing hooks):')
    console.log('')
    console.log(getHooksConfig())
    console.log('')

    if (config.open) {
      try {
        if (process.platform === 'darwin') execSync(`open "${url}"`)
        else if (process.platform === 'linux') execSync(`xdg-open "${url}"`)
        else if (process.platform === 'win32') execSync(`start "${url}"`)
      } catch { /* ignore */ }
    }
  })

  // Graceful shutdown
  const cleanup = () => {
    console.log('\n[Server] Shutting down...')
    for (const id of [...agents.keys()]) removeAgent(id)
    server.close()
    process.exit(0)
  }
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)
}

startServer()
