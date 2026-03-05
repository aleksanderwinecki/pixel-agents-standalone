import { TileType, FurnitureType, TILE_SIZE, Direction } from '../types.js'
import type { TileType as TileTypeVal, OfficeLayout, PlacedFurniture, Seat, FurnitureInstance, FloorColor } from '../types.js'
import { getCatalogEntry } from './furnitureCatalog.js'
import { getColorizedSprite } from '../colorize.js'

/** Convert flat tile array from layout into 2D grid */
export function layoutToTileMap(layout: OfficeLayout): TileTypeVal[][] {
  const map: TileTypeVal[][] = []
  for (let r = 0; r < layout.rows; r++) {
    const row: TileTypeVal[] = []
    for (let c = 0; c < layout.cols; c++) {
      row.push(layout.tiles[r * layout.cols + c])
    }
    map.push(row)
  }
  return map
}

/** Convert placed furniture into renderable FurnitureInstance[] */
export function layoutToFurnitureInstances(furniture: PlacedFurniture[]): FurnitureInstance[] {
  // Pre-compute desk zY per tile so surface items can sort in front of desks
  const deskZByTile = new Map<string, number>()
  for (const item of furniture) {
    const entry = getCatalogEntry(item.type)
    if (!entry || !entry.isDesk) continue
    const deskZY = item.row * TILE_SIZE + entry.sprite.length
    for (let dr = 0; dr < entry.footprintH; dr++) {
      for (let dc = 0; dc < entry.footprintW; dc++) {
        const key = `${item.col + dc},${item.row + dr}`
        const prev = deskZByTile.get(key)
        if (prev === undefined || deskZY > prev) deskZByTile.set(key, deskZY)
      }
    }
  }

  const instances: FurnitureInstance[] = []
  for (const item of furniture) {
    const entry = getCatalogEntry(item.type)
    if (!entry) continue
    const x = item.col * TILE_SIZE
    const y = item.row * TILE_SIZE
    const spriteH = entry.sprite.length
    let zY = y + spriteH

    // Chair z-sorting: ensure characters sitting on chairs render correctly
    if (entry.category === 'chairs') {
      if (entry.orientation === 'back') {
        // Back-facing chairs render IN FRONT of the seated character
        // (the chair back visually occludes the character behind it)
        zY = (item.row + 1) * TILE_SIZE + 1
      } else {
        // All other chairs: cap zY to first row bottom so characters
        // at any seat tile render in front of the chair
        zY = (item.row + 1) * TILE_SIZE
      }
    }

    // Surface items render in front of the desk they sit on
    if (entry.canPlaceOnSurfaces) {
      for (let dr = 0; dr < entry.footprintH; dr++) {
        for (let dc = 0; dc < entry.footprintW; dc++) {
          const deskZ = deskZByTile.get(`${item.col + dc},${item.row + dr}`)
          if (deskZ !== undefined && deskZ + 0.5 > zY) zY = deskZ + 0.5
        }
      }
    }

    // Colorize sprite if this furniture has a color override
    let sprite = entry.sprite
    if (item.color) {
      const { h, s, b: bv, c: cv } = item.color
      sprite = getColorizedSprite(`furn-${item.type}-${h}-${s}-${bv}-${cv}-${item.color.colorize ? 1 : 0}`, entry.sprite, item.color)
    }

    instances.push({ sprite, x, y, zY })
  }
  return instances
}

/** Get all tiles blocked by furniture footprints, optionally excluding a set of tiles.
 *  Skips top backgroundTiles rows so characters can walk through them. */
export function getBlockedTiles(furniture: PlacedFurniture[], excludeTiles?: Set<string>): Set<string> {
  const tiles = new Set<string>()
  for (const item of furniture) {
    const entry = getCatalogEntry(item.type)
    if (!entry) continue
    const bgRows = entry.backgroundTiles || 0
    for (let dr = 0; dr < entry.footprintH; dr++) {
      if (dr < bgRows) continue // skip background rows — characters can walk through
      for (let dc = 0; dc < entry.footprintW; dc++) {
        const key = `${item.col + dc},${item.row + dr}`
        if (excludeTiles && excludeTiles.has(key)) continue
        tiles.add(key)
      }
    }
  }
  return tiles
}

/** Get tiles blocked for placement purposes — skips top backgroundTiles rows per item */
export function getPlacementBlockedTiles(furniture: PlacedFurniture[], excludeUid?: string): Set<string> {
  const tiles = new Set<string>()
  for (const item of furniture) {
    if (item.uid === excludeUid) continue
    const entry = getCatalogEntry(item.type)
    if (!entry) continue
    const bgRows = entry.backgroundTiles || 0
    for (let dr = 0; dr < entry.footprintH; dr++) {
      if (dr < bgRows) continue // skip background rows
      for (let dc = 0; dc < entry.footprintW; dc++) {
        tiles.add(`${item.col + dc},${item.row + dr}`)
      }
    }
  }
  return tiles
}

/** Map chair orientation to character facing direction */
function orientationToFacing(orientation: string): Direction {
  switch (orientation) {
    case 'front': return Direction.DOWN
    case 'back': return Direction.UP
    case 'left': return Direction.LEFT
    case 'right': return Direction.RIGHT
    default: return Direction.DOWN
  }
}

/** Generate seats from chair furniture.
 *  Facing priority: 1) chair orientation, 2) adjacent desk, 3) forward (DOWN). */
export function layoutToSeats(furniture: PlacedFurniture[]): Map<string, Seat> {
  const seats = new Map<string, Seat>()

  // Build set of all desk tiles
  const deskTiles = new Set<string>()
  for (const item of furniture) {
    const entry = getCatalogEntry(item.type)
    if (!entry || !entry.isDesk) continue
    for (let dr = 0; dr < entry.footprintH; dr++) {
      for (let dc = 0; dc < entry.footprintW; dc++) {
        deskTiles.add(`${item.col + dc},${item.row + dr}`)
      }
    }
  }

  const dirs: Array<{ dc: number; dr: number; facing: Direction }> = [
    { dc: 0, dr: -1, facing: Direction.UP },    // desk is above chair → face UP
    { dc: 0, dr: 1, facing: Direction.DOWN },   // desk is below chair → face DOWN
    { dc: -1, dr: 0, facing: Direction.LEFT },   // desk is left of chair → face LEFT
    { dc: 1, dr: 0, facing: Direction.RIGHT },   // desk is right of chair → face RIGHT
  ]

  // For each chair, every footprint tile becomes a seat.
  // Multi-tile chairs (e.g. 2-tile couches) produce multiple seats.
  for (const item of furniture) {
    const entry = getCatalogEntry(item.type)
    if (!entry || entry.category !== 'chairs') continue

    let seatCount = 0
    for (let dr = 0; dr < entry.footprintH; dr++) {
      for (let dc = 0; dc < entry.footprintW; dc++) {
        const tileCol = item.col + dc
        const tileRow = item.row + dr

        // Determine facing direction:
        // 1) Chair orientation takes priority
        // 2) Adjacent desk direction
        // 3) Default forward (DOWN)
        let facingDir: Direction = Direction.DOWN
        if (entry.orientation) {
          facingDir = orientationToFacing(entry.orientation)
        } else {
          for (const d of dirs) {
            if (deskTiles.has(`${tileCol + d.dc},${tileRow + d.dr}`)) {
              facingDir = d.facing
              break
            }
          }
        }

        // First seat uses chair uid (backward compat), subsequent use uid:N
        const seatUid = seatCount === 0 ? item.uid : `${item.uid}:${seatCount}`
        seats.set(seatUid, {
          uid: seatUid,
          seatCol: tileCol,
          seatRow: tileRow,
          facingDir,
          assigned: false,
        })
        seatCount++
      }
    }
  }

  return seats
}

/** Get the set of tiles occupied by seats (so they can be excluded from blocked tiles) */
export function getSeatTiles(seats: Map<string, Seat>): Set<string> {
  const tiles = new Set<string>()
  for (const seat of seats.values()) {
    tiles.add(`${seat.seatCol},${seat.seatRow}`)
  }
  return tiles
}

/** Default floor colors */
const ROOM_A_COLOR: FloorColor = { h: 35, s: 30, b: 15, c: 0 }    // warm beige
const ROOM_B_COLOR: FloorColor = { h: 210, s: 20, b: 10, c: 0 }   // cool blue-grey
const ROOM_C_COLOR: FloorColor = { h: 25, s: 45, b: 5, c: 10 }    // warm brown
const ROOM_D_EDGE_COLOR: FloorColor = { h: 25, s: 30, b: 10, c: 0 } // warm neutral
const ROOM_D_CARPET_COLOR: FloorColor = { h: 280, s: 40, b: -5, c: 0 } // purple carpet
const DOORWAY_FL_COLOR: FloorColor = { h: 35, s: 25, b: 10, c: 0 } // tan

/** Create the default office layout — 4 rooms with 20 seats */
export function createDefaultLayout(): OfficeLayout {
  const W = TileType.WALL
  const F1 = TileType.FLOOR_1
  const F2 = TileType.FLOOR_2
  const F3 = TileType.FLOOR_3
  const F4 = TileType.FLOOR_4

  const COLS = 28
  const ROWS = 16

  const tiles = new Array<TileTypeVal>(COLS * ROWS).fill(W)
  const tileColors = new Array<FloorColor | null>(COLS * ROWS).fill(null)

  function fill(c1: number, r1: number, c2: number, r2: number, tile: TileTypeVal, color: FloorColor) {
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) {
        tiles[r * COLS + c] = tile
        tileColors[r * COLS + c] = color
      }
    }
  }
  function set(c: number, r: number, tile: TileTypeVal, color: FloorColor) {
    tiles[r * COLS + c] = tile
    tileColors[r * COLS + c] = color
  }

  // Room A — Main Office (top-left)
  fill(1, 1, 13, 7, F1, ROOM_A_COLOR)
  // Room B — Conference Room (top-right)
  fill(15, 1, 26, 7, F2, ROOM_B_COLOR)
  // Room C — Dev Lab (bottom-left)
  fill(1, 9, 13, 14, F2, ROOM_C_COLOR)
  // Room D — Lounge (bottom-right): neutral edges + carpet center
  fill(15, 9, 26, 14, F1, ROOM_D_EDGE_COLOR)
  fill(17, 10, 24, 13, F3, ROOM_D_CARPET_COLOR)

  // Doorways — vertical wall at col 14
  for (const r of [4, 5]) set(14, r, F4, DOORWAY_FL_COLOR)
  for (const r of [11, 12]) set(14, r, F4, DOORWAY_FL_COLOR)
  // Doorways — horizontal wall at row 8
  for (const c of [5, 6]) set(c, 8, F4, DOORWAY_FL_COLOR)
  for (const c of [21, 22]) set(c, 8, F4, DOORWAY_FL_COLOR)

  const furniture: PlacedFurniture[] = [
    // ═══ Room A — Main Office (top-left) ═══
    // Desk cluster 1
    { uid: 'a-desk-1', type: FurnitureType.DESK, col: 2, row: 2 },
    { uid: 'a-ch-1a', type: FurnitureType.CHAIR, col: 1, row: 3 },
    { uid: 'a-ch-1b', type: FurnitureType.CHAIR, col: 4, row: 2 },
    { uid: 'a-ch-1c', type: FurnitureType.CHAIR, col: 3, row: 4 },
    // Desk cluster 2
    { uid: 'a-desk-2', type: FurnitureType.DESK, col: 8, row: 2 },
    { uid: 'a-ch-2a', type: FurnitureType.CHAIR, col: 7, row: 3 },
    { uid: 'a-ch-2b', type: FurnitureType.CHAIR, col: 10, row: 2 },
    { uid: 'a-ch-2c', type: FurnitureType.CHAIR, col: 9, row: 4 },
    // Desk cluster 3
    { uid: 'a-desk-3', type: FurnitureType.DESK, col: 5, row: 5 },
    { uid: 'a-ch-3a', type: FurnitureType.CHAIR, col: 4, row: 6 },
    { uid: 'a-ch-3b', type: FurnitureType.CHAIR, col: 7, row: 6 },
    // Decor
    { uid: 'a-plant-1', type: FurnitureType.PLANT, col: 1, row: 1 },
    { uid: 'a-plant-2', type: FurnitureType.PLANT, col: 13, row: 1 },
    { uid: 'a-shelf-1', type: FurnitureType.BOOKSHELF, col: 12, row: 2 },
    { uid: 'a-lamp-1', type: FurnitureType.LAMP, col: 1, row: 7 },

    // ═══ Room B — Conference Room (top-right) ═══
    { uid: 'b-desk-1', type: FurnitureType.DESK, col: 19, row: 3 },
    { uid: 'b-ch-1a', type: FurnitureType.CHAIR, col: 18, row: 3 },
    { uid: 'b-ch-1b', type: FurnitureType.CHAIR, col: 21, row: 4 },
    { uid: 'b-ch-1c', type: FurnitureType.CHAIR, col: 19, row: 2 },
    { uid: 'b-ch-1d', type: FurnitureType.CHAIR, col: 20, row: 5 },
    { uid: 'b-wb-1', type: FurnitureType.WHITEBOARD, col: 16, row: 1 },
    { uid: 'b-wb-2', type: FurnitureType.WHITEBOARD, col: 23, row: 1 },
    { uid: 'b-plant-1', type: FurnitureType.PLANT, col: 15, row: 1 },
    { uid: 'b-plant-2', type: FurnitureType.PLANT, col: 26, row: 1 },
    { uid: 'b-plant-3', type: FurnitureType.PLANT, col: 26, row: 7 },
    { uid: 'b-lamp-1', type: FurnitureType.LAMP, col: 15, row: 7 },

    // ═══ Room C — Dev Lab (bottom-left) ═══
    // Desk cluster 4
    { uid: 'c-desk-1', type: FurnitureType.DESK, col: 2, row: 10 },
    { uid: 'c-ch-1a', type: FurnitureType.CHAIR, col: 1, row: 10 },
    { uid: 'c-ch-1b', type: FurnitureType.CHAIR, col: 4, row: 11 },
    { uid: 'c-ch-1c', type: FurnitureType.CHAIR, col: 3, row: 12 },
    // Desk cluster 5
    { uid: 'c-desk-2', type: FurnitureType.DESK, col: 8, row: 10 },
    { uid: 'c-ch-2a', type: FurnitureType.CHAIR, col: 7, row: 10 },
    { uid: 'c-ch-2b', type: FurnitureType.CHAIR, col: 10, row: 11 },
    { uid: 'c-ch-2c', type: FurnitureType.CHAIR, col: 9, row: 12 },
    // Decor
    { uid: 'c-pc-1', type: FurnitureType.PC, col: 5, row: 9 },
    { uid: 'c-pc-2', type: FurnitureType.PC, col: 11, row: 9 },
    { uid: 'c-shelf-1', type: FurnitureType.BOOKSHELF, col: 12, row: 10 },
    { uid: 'c-lamp-1', type: FurnitureType.LAMP, col: 1, row: 14 },
    { uid: 'c-plant-1', type: FurnitureType.PLANT, col: 13, row: 9 },

    // ═══ Room D — Lounge (bottom-right) ═══
    { uid: 'd-desk-1', type: FurnitureType.DESK, col: 19, row: 11 },
    { uid: 'd-ch-1a', type: FurnitureType.CHAIR, col: 18, row: 11 },
    { uid: 'd-ch-1b', type: FurnitureType.CHAIR, col: 21, row: 12 },
    { uid: 'd-ch-1c', type: FurnitureType.CHAIR, col: 20, row: 10 },
    { uid: 'd-cooler', type: FurnitureType.COOLER, col: 26, row: 9 },
    { uid: 'd-plant-1', type: FurnitureType.PLANT, col: 15, row: 9 },
    { uid: 'd-plant-2', type: FurnitureType.PLANT, col: 26, row: 14 },
    { uid: 'd-plant-3', type: FurnitureType.PLANT, col: 15, row: 14 },
    { uid: 'd-lamp-1', type: FurnitureType.LAMP, col: 16, row: 12 },
  ]

  return { version: 1, cols: COLS, rows: ROWS, tiles, tileColors, furniture }
}

/** Serialize layout to JSON string */
export function serializeLayout(layout: OfficeLayout): string {
  return JSON.stringify(layout)
}

/** Deserialize layout from JSON string, migrating old tile types if needed */
export function deserializeLayout(json: string): OfficeLayout | null {
  try {
    const obj = JSON.parse(json)
    if (obj && obj.version === 1 && Array.isArray(obj.tiles) && Array.isArray(obj.furniture)) {
      return migrateLayout(obj as OfficeLayout)
    }
  } catch { /* ignore parse errors */ }
  return null
}

/**
 * Ensure layout has tileColors. If missing, generate defaults based on tile types.
 * Exported for use by message handlers that receive layouts over the wire.
 */
export function migrateLayoutColors(layout: OfficeLayout): OfficeLayout {
  return migrateLayout(layout)
}

/**
 * Migrate old layouts that use legacy tile types (TILE_FLOOR=1, WOOD_FLOOR=2, CARPET=3, DOORWAY=4)
 * to the new pattern-based system. If tileColors is already present, no migration needed.
 */
function migrateLayout(layout: OfficeLayout): OfficeLayout {
  if (layout.tileColors && layout.tileColors.length === layout.tiles.length) {
    return layout // Already migrated
  }

  // Check if any tiles use old values (1-4) — these map directly to FLOOR_1-4
  // but need color assignments
  const tileColors: Array<FloorColor | null> = []
  for (const tile of layout.tiles) {
    switch (tile) {
      case 0: // WALL
        tileColors.push(null)
        break
      case 1: // was TILE_FLOOR → FLOOR_1 beige
        tileColors.push(ROOM_A_COLOR)
        break
      case 2: // was WOOD_FLOOR → FLOOR_2 brown
        tileColors.push(ROOM_C_COLOR)
        break
      case 3: // was CARPET → FLOOR_3 purple
        tileColors.push(ROOM_D_CARPET_COLOR)
        break
      case 4: // was DOORWAY → FLOOR_4 tan
        tileColors.push(DOORWAY_FL_COLOR)
        break
      default:
        // New tile types (5-7) without colors — use neutral gray
        tileColors.push(tile > 0 ? { h: 0, s: 0, b: 0, c: 0 } : null)
    }
  }

  return { ...layout, tileColors }
}
