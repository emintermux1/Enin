import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import { MAP_H, MAP_W, TILE } from "@viceblock/shared";
import { Cell, type Landmark, type WorldData } from "../game/world";

/** World units: 1 unit = 1 game pixel of the 2D grid (TILE = 32). */
export const GROUND_Y = 0;

export interface CityMeshes {
  dispose: () => void;
  landmarkTops: Map<string, number>;
}

function mat(scene: Scene, name: string, hex: string, emissive = 0): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = Color3.FromHexString(hex);
  m.specularColor = new Color3(0.05, 0.05, 0.05);
  if (emissive > 0) m.emissiveColor = Color3.FromHexString(hex).scale(emissive);
  return m;
}

export function buildCity(scene: Scene, world: WorldData): CityMeshes {
  const disposables: Mesh[] = [];
  const landmarkTops = new Map<string, number>();

  const ground = MeshBuilder.CreateGround("ground", { width: MAP_W * TILE, height: MAP_H * TILE }, scene);
  ground.position = new Vector3((MAP_W * TILE) / 2, GROUND_Y, (MAP_H * TILE) / 2);
  ground.material = mat(scene, "m-ground", "#4a3628");
  disposables.push(ground);

  // Flat colored tiles for roads / sand / water / courts, merged into row strips.
  const stripMats: Record<number, StandardMaterial> = {
    [Cell.Road]: mat(scene, "m-road", "#35302c"),
    [Cell.Walk]: mat(scene, "m-walk", "#6a5a4a"),
    [Cell.Grass]: mat(scene, "m-grass", "#2f4a34"),
    [Cell.Water]: mat(scene, "m-water", "#2a5a68", 0.15),
    [Cell.Sand]: mat(scene, "m-sand", "#c4a070"),
    [Cell.Alley]: mat(scene, "m-alley", "#2a221c"),
    [Cell.Court]: mat(scene, "m-court", "#8a5a32"),
    [Cell.Dock]: mat(scene, "m-dock", "#4a4034"),
  };

  for (let y = 0; y < MAP_H; y++) {
    let runStart = -1;
    let runCell: Cell = Cell.Dirt;
    for (let x = 0; x <= MAP_W; x++) {
      const c = x < MAP_W ? (world.cells[y * MAP_W + x] as Cell) : Cell.Dirt;
      const isStrip = c !== Cell.Dirt && c !== Cell.Building;
      if (isStrip && runStart === -1) {
        runStart = x;
        runCell = c;
      } else if ((!isStrip || c !== runCell) && runStart !== -1) {
        const w = (x - runStart) * TILE;
        const strip = MeshBuilder.CreateGround(`s-${y}-${runStart}`, { width: w, height: TILE }, scene);
        strip.position = new Vector3(runStart * TILE + w / 2, GROUND_Y + 0.08, y * TILE + TILE / 2);
        strip.material = stripMats[runCell] ?? stripMats[Cell.Road];
        strip.freezeWorldMatrix();
        disposables.push(strip);
        runStart = isStrip ? x : -1;
        runCell = c;
      }
    }
  }

  // Generic building blocks from solid grid (merged per row-rectangle greedily).
  const buildingMat = mat(scene, "m-bld", "#3a2a26");
  const buildingMat2 = mat(scene, "m-bld2", "#4a3630");
  const seen = new Uint8Array(MAP_W * MAP_H);
  const landmarkArea = new Set<number>();
  for (const lm of world.landmarks) {
    for (let j = lm.y; j < lm.y + lm.h; j++) {
      for (let i = lm.x; i < lm.x + lm.w; i++) landmarkArea.add(j * MAP_W + i);
    }
  }

  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const idx = y * MAP_W + x;
      if (seen[idx] || !world.solid[idx] || landmarkArea.has(idx)) continue;
      if ((world.cells[idx] as Cell) !== Cell.Building) {
        seen[idx] = 1;
        continue;
      }
      let w = 1;
      while (x + w < MAP_W && world.solid[idx + w] && !seen[idx + w] && !landmarkArea.has(idx + w) && (world.cells[idx + w] as Cell) === Cell.Building) w++;
      let h = 1;
      outer: while (y + h < MAP_H) {
        for (let i = 0; i < w; i++) {
          const j = (y + h) * MAP_W + x + i;
          if (!world.solid[j] || seen[j] || landmarkArea.has(j) || (world.cells[j] as Cell) !== Cell.Building) break outer;
        }
        h++;
      }
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) seen[(y + j) * MAP_W + x + i] = 1;
      const height = 40 + ((x * 7 + y * 13) % 5) * 22;
      const box = MeshBuilder.CreateBox(`b-${x}-${y}`, { width: w * TILE - 4, depth: h * TILE - 4, height }, scene);
      box.position = new Vector3(x * TILE + (w * TILE) / 2, height / 2, y * TILE + (h * TILE) / 2);
      box.material = (x + y) % 2 ? buildingMat : buildingMat2;
      box.freezeWorldMatrix();
      disposables.push(box);
    }
  }

  // Landmark buildings — distinct colors + floating sign feel via emissive trim.
  for (const lm of world.landmarks) {
    const height = landmarkHeight(lm);
    landmarkTops.set(lm.id, height);
    const box = MeshBuilder.CreateBox(`lm-${lm.id}`, { width: lm.w * TILE - 6, depth: lm.h * TILE - 6, height }, scene);
    box.position = new Vector3(lm.x * TILE + (lm.w * TILE) / 2, height / 2, lm.y * TILE + (lm.h * TILE) / 2);
    box.material = mat(scene, `m-${lm.id}`, landmarkColor(lm.kind), 0.06);
    box.freezeWorldMatrix();
    disposables.push(box);

    const trim = MeshBuilder.CreateBox(`lt-${lm.id}`, { width: lm.w * TILE - 6, depth: lm.h * TILE - 6, height: 3 }, scene);
    trim.position = new Vector3(box.position.x, height + 1.5, box.position.z);
    trim.material = mat(scene, `mt-${lm.id}`, trimColor(lm.kind), 0.65);
    trim.freezeWorldMatrix();
    disposables.push(trim);

    const door = MeshBuilder.CreateBox(`ld-${lm.id}`, { width: 12, depth: 3, height: 16 }, scene);
    door.position = new Vector3(lm.doorX * TILE + TILE / 2, 8, lm.doorY * TILE + 2);
    door.material = mat(scene, `md-${lm.id}`, "#1a1410");
    door.freezeWorldMatrix();
    disposables.push(door);
  }

  // Street props: lamps along main roads.
  const lampMat = mat(scene, "m-lamp", "#2a2622");
  const lampHead = mat(scene, "m-lamphead", "#f0d890", 0.9);
  for (const yTile of [10, 22, 36, 50, 64]) {
    for (let x = 6; x < MAP_W; x += 12) {
      const pole = MeshBuilder.CreateBox(`lp-${x}-${yTile}`, { width: 1.6, depth: 1.6, height: 22 }, scene);
      pole.position = new Vector3(x * TILE, 11, (yTile - 1) * TILE + TILE / 2);
      pole.material = lampMat;
      pole.freezeWorldMatrix();
      disposables.push(pole);
      const head = MeshBuilder.CreateBox(`lh-${x}-${yTile}`, { width: 4, depth: 4, height: 2 }, scene);
      head.position = new Vector3(x * TILE, 22, (yTile - 1) * TILE + TILE / 2);
      head.material = lampHead;
      head.freezeWorldMatrix();
      disposables.push(head);
    }
  }

  scene.clearColor = new Color4(0.42, 0.55, 0.62, 1);

  return {
    landmarkTops,
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  };
}

function landmarkHeight(lm: Landmark): number {
  switch (lm.kind) {
    case "police":
      return 58;
    case "warehouse":
      return 44;
    case "apartment":
      return 86;
    case "jewelry":
      return 52;
    case "bank":
      return 96;
    case "garage":
    case "gas":
      return 26;
    case "store":
      return 30;
    case "hideout":
    case "secret":
      return 34;
    case "race":
      return 8;
    case "npc":
      return 14;
    default: {
      const _n: never = lm.kind;
      return _n;
    }
  }
}

function landmarkColor(kind: Landmark["kind"]): string {
  switch (kind) {
    case "apartment":
      return "#8a5344";
    case "garage":
      return "#4a4034";
    case "store":
      return "#6a3030";
    case "hideout":
      return "#3a2a28";
    case "police":
      return "#2a3848";
    case "warehouse":
      return "#4a4638";
    case "race":
      return "#2a2a24";
    case "gas":
      return "#6a2820";
    case "npc":
      return "#4a3a30";
    case "secret":
      return "#2a2228";
    case "jewelry":
      return "#7a4a58";
    case "bank":
      return "#3a4048";
    default: {
      const _n: never = kind;
      return _n;
    }
  }
}

function trimColor(kind: Landmark["kind"]): string {
  switch (kind) {
    case "police":
      return "#4a90d8";
    case "jewelry":
      return "#e890b8";
    case "gas":
      return "#e05030";
    case "store":
      return "#e0a030";
    case "garage":
      return "#90c0d8";
    case "apartment":
      return "#e6c39a";
    case "warehouse":
      return "#a0a878";
    case "race":
      return "#f0e050";
    case "hideout":
      return "#c45a32";
    case "npc":
      return "#d8b878";
    case "secret":
      return "#9070c0";
    case "bank":
      return "#c0c8d8";
    default: {
      const _n: never = kind;
      return _n;
    }
  }
}
