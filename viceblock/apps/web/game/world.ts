import { MAP_H, MAP_W, TILE } from "@viceblock/shared";

export const TILE_SIZE = TILE;

export const enum Cell {
  Dirt = 0,
  Road = 1,
  Walk = 2,
  Building = 3,
  Grass = 4,
  Water = 5,
  Sand = 6,
  Alley = 7,
  Court = 8,
  Dock = 9,
}

export interface Landmark {
  id: string;
  name: string;
  kind:
    | "apartment"
    | "garage"
    | "store"
    | "hideout"
    | "police"
    | "warehouse"
    | "race"
    | "gas"
    | "npc"
    | "secret"
    | "jewelry"
    | "bank";
  x: number;
  y: number;
  w: number;
  h: number;
  doorX: number;
  doorY: number;
  interior: boolean;
  zone: "safe" | "normal" | "high-risk";
}

export interface WorldData {
  cells: Uint8Array;
  solid: Uint8Array;
  landmarks: Landmark[];
  spawnX: number;
  spawnY: number;
}

function idx(x: number, y: number): number {
  return y * MAP_W + x;
}

function fill(cells: Uint8Array, x: number, y: number, w: number, h: number, c: Cell): void {
  for (let j = y; j < y + h; j++) {
    for (let i = x; i < x + w; i++) {
      if (i >= 0 && j >= 0 && i < MAP_W && j < MAP_H) cells[idx(i, j)] = c;
    }
  }
}

function roadH(cells: Uint8Array, y: number): void {
  fill(cells, 0, y, MAP_W, 3, Cell.Road);
  fill(cells, 0, y - 1, MAP_W, 1, Cell.Walk);
  fill(cells, 0, y + 3, MAP_W, 1, Cell.Walk);
}

function roadV(cells: Uint8Array, x: number): void {
  fill(cells, x, 0, 3, MAP_H, Cell.Road);
  fill(cells, x - 1, 0, 1, MAP_H, Cell.Walk);
  fill(cells, x + 3, 0, 1, MAP_H, Cell.Walk);
}

export function buildSouthside(): WorldData {
  const cells = new Uint8Array(MAP_W * MAP_H);
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const n = ((x * 13 + y * 7) ^ (x * y)) & 7;
      cells[idx(x, y)] = n === 0 ? Cell.Grass : Cell.Dirt;
    }
  }

  fill(cells, 0, 0, MAP_W, 6, Cell.Sand);
  fill(cells, 0, 0, MAP_W, 3, Cell.Water);

  for (const y of [10, 22, 36, 50, 64]) roadH(cells, y);
  for (const x of [8, 22, 36, 50, 64, 80]) roadV(cells, x);

  fill(cells, 25, 26, 8, 8, Cell.Court);
  fill(cells, 78, 54, 16, 18, Cell.Dock);
  fill(cells, 82, 68, 12, 8, Cell.Water);

  const blocks: Array<[number, number, number, number]> = [
    [12, 14, 8, 6],
    [26, 14, 8, 6],
    [40, 14, 8, 6],
    [54, 14, 8, 6],
    [68, 14, 10, 6],
    [12, 27, 8, 7],
    [40, 27, 8, 7],
    [54, 27, 8, 7],
    [68, 27, 10, 7],
    [12, 41, 8, 7],
    [26, 41, 8, 7],
    [40, 41, 8, 7],
    [54, 41, 8, 7],
    [68, 41, 10, 7],
    [12, 55, 8, 7],
    [26, 55, 8, 7],
    [40, 55, 8, 7],
    [54, 55, 8, 7],
    [12, 69, 8, 8],
    [26, 69, 8, 8],
    [40, 69, 8, 8],
    [54, 69, 8, 8],
  ];
  for (const [x, y, w, h] of blocks) fill(cells, x, y, w, h, Cell.Building);

  fill(cells, 27, 28, 2, 6, Cell.Alley);
  fill(cells, 41, 42, 2, 6, Cell.Alley);
  fill(cells, 55, 56, 2, 6, Cell.Alley);
  fill(cells, 15, 42, 2, 6, Cell.Alley);

  const landmarks: Landmark[] = [
    lm("apartment", "Walk-up 14B", "apartment", 12, 55, 8, 7, 15, 62, true, "safe"),
    lm("rico-hideout", "Rico's Hideout", "hideout", 26, 41, 8, 7, 29, 48, true, "normal"),
    lm("coral-mart", "Coral Mart", "store", 40, 41, 8, 7, 43, 48, true, "normal"),
    lm("gas", "Red Pump Gas", "gas", 54, 41, 8, 7, 57, 48, false, "normal"),
    lm("maya-garage", "Maya's Garage", "garage", 54, 55, 8, 7, 57, 62, true, "safe"),
    lm("court", "Chain Court", "npc", 25, 26, 8, 8, 28, 34, false, "normal"),
    lm("police", "Southside Precinct", "police", 68, 27, 10, 7, 72, 34, true, "safe"),
    lm("warehouse", "Pier 9 Warehouse", "warehouse", 80, 54, 10, 8, 82, 62, true, "high-risk"),
    lm("race-start", "Midnight Line", "race", 48, 64, 6, 3, 50, 65, false, "normal"),
    lm("jewelry", "Sunset Cases", "jewelry", 40, 27, 8, 7, 43, 34, true, "normal"),
    lm("secret-bunker", "Painted Door", "secret", 12, 41, 8, 7, 13, 47, true, "normal"),
    lm("cupsey", "Cupsey's Corner", "npc", 26, 27, 3, 3, 27, 29, false, "normal"),
    lm("ansem", "Ansem's Mural", "npc", 68, 14, 10, 6, 72, 20, false, "normal"),
  ];

  const solid = new Uint8Array(MAP_W * MAP_H);
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    solid[i] = c === Cell.Building || c === Cell.Water ? 1 : 0;
  }
  for (const mark of landmarks) {
    const dx = mark.doorX;
    const dy = mark.doorY;
    if (dx >= 0 && dy >= 0 && dx < MAP_W && dy < MAP_H) {
      cells[idx(dx, dy)] = Cell.Walk;
      solid[idx(dx, dy)] = 0;
      if (dy + 1 < MAP_H) {
        cells[idx(dx, dy + 1)] = Cell.Walk;
        solid[idx(dx, dy + 1)] = 0;
      }
    }
  }

  return {
    cells,
    solid,
    landmarks,
    spawnX: 16 * TILE + 16,
    spawnY: 63 * TILE + 8,
  };
}

function lm(
  id: string,
  name: string,
  kind: Landmark["kind"],
  x: number,
  y: number,
  w: number,
  h: number,
  doorX: number,
  doorY: number,
  interior: boolean,
  zone: Landmark["zone"],
): Landmark {
  return { id, name, kind, x, y, w, h, doorX, doorY, interior, zone };
}

export function cellAt(world: WorldData, px: number, py: number): Cell {
  const x = Math.floor(px / TILE);
  const y = Math.floor(py / TILE);
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return Cell.Building;
  return world.cells[idx(x, y)] as Cell;
}

export function blocked(world: WorldData, px: number, py: number, rad: number): boolean {
  const pts: Array<[number, number]> = [
    [px - rad, py - rad],
    [px + rad, py - rad],
    [px - rad, py + rad],
    [px + rad, py + rad],
    [px, py],
  ];
  for (const [x, y] of pts) {
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return true;
    if (world.solid[idx(tx, ty)]) return true;
  }
  return false;
}

export function landmarkAt(world: WorldData, px: number, py: number, reach = 38): Landmark | undefined {
  const tx = px / TILE;
  const ty = py / TILE;
  return world.landmarks.find((m) => {
    const cx = m.doorX + 0.5;
    const cy = m.doorY + 0.5;
    return Math.hypot(tx - cx, ty - cy) * TILE < reach;
  });
}

export function hideSpotNear(world: WorldData, px: number, py: number): boolean {
  const c = cellAt(world, px, py);
  if (c === Cell.Alley) return true;
  const mark = landmarkAt(world, px, py, 50);
  return Boolean(mark && (mark.kind === "garage" || mark.kind === "apartment" || mark.kind === "hideout"));
}
