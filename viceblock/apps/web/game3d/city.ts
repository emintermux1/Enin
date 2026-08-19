import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import type { Texture } from "@babylonjs/core/Materials/Textures/texture";
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
  m.specularColor = new Color3(0.04, 0.04, 0.04);
  if (emissive > 0) m.emissiveColor = Color3.FromHexString(hex).scale(emissive);
  return m;
}

function windowTexture(scene: Scene, name: string, wall: string, lit: string): DynamicTexture {
  const tex = new DynamicTexture(name, { width: 256, height: 512 }, scene, false);
  const ctx = tex.getContext();
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, 256, 512);
  // Recessed bands so the wall doesn't read as a flat cube.
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  for (let y = 0; y < 512; y += 64) ctx.fillRect(0, y + 52, 256, 6);
  const cols = 4;
  const rows = 8;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const on = ((c * 7 + r * 13) % 5) !== 1;
      ctx.fillStyle = on ? lit : "#14100e";
      ctx.fillRect(18 + c * 60, 18 + r * 62, 28, 34);
      if (on) {
        ctx.fillStyle = "rgba(255,230,160,0.18)";
        ctx.fillRect(18 + c * 60, 18 + r * 62, 28, 10);
      }
    }
  }
  tex.hasAlpha = false;
  tex.update();
  tex.wrapU = 0;
  tex.wrapV = 0;
  return tex;
}

function signTexture(scene: Scene, name: string, title: string, ink: string, paper: string): DynamicTexture {
  const tex = new DynamicTexture(name, { width: 512, height: 128 }, scene, false);
  const ctx = tex.getContext();
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = ink;
  ctx.fillRect(0, 0, 10, 128);
  ctx.fillRect(502, 0, 10, 128);
  ctx.font = "bold 52px Impact, sans-serif";
  const ink2 = ctx as unknown as CanvasRenderingContext2D;
  ink2.textAlign = "center";
  ink2.textBaseline = "middle";
  ctx.fillStyle = ink;
  ctx.fillText(title.slice(0, 18).toUpperCase(), 256, 64);
  tex.hasAlpha = false;
  tex.update();
  return tex;
}

export function buildCity(scene: Scene, world: WorldData): CityMeshes {
  const disposables: Mesh[] = [];
  const textures: DynamicTexture[] = [];
  const landmarkTops = new Map<string, number>();

  const ground = MeshBuilder.CreateGround("ground", { width: MAP_W * TILE, height: MAP_H * TILE }, scene);
  ground.position = new Vector3((MAP_W * TILE) / 2, GROUND_Y, (MAP_H * TILE) / 2);
  ground.material = mat(scene, "m-ground", "#3a2a22");
  disposables.push(ground);

  const stripMats: Record<number, StandardMaterial> = {
    [Cell.Road]: mat(scene, "m-road", "#2c2826"),
    [Cell.Walk]: mat(scene, "m-walk", "#7a6854"),
    [Cell.Grass]: mat(scene, "m-grass", "#2a4a30"),
    [Cell.Water]: mat(scene, "m-water", "#1e5a68", 0.22),
    [Cell.Sand]: mat(scene, "m-sand", "#d4b078"),
    [Cell.Alley]: mat(scene, "m-alley", "#241c16"),
    [Cell.Court]: mat(scene, "m-court", "#9a6230"),
    [Cell.Dock]: mat(scene, "m-dock", "#5a4c3c"),
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

  // Center lines — one long strip per arterial so the streets read as streets.
  const lineMat = mat(scene, "m-line", "#c4a050", 0.15);
  for (const yTile of [10, 22, 36, 50, 64]) {
    const line = MeshBuilder.CreateBox(`hline-${yTile}`, { width: MAP_W * TILE, depth: 1.4, height: 0.3 }, scene);
    line.position = new Vector3((MAP_W * TILE) / 2, 0.22, (yTile + 1.5) * TILE);
    line.material = lineMat;
    line.freezeWorldMatrix();
    disposables.push(line);
  }
  for (const xTile of [8, 22, 36, 50, 64, 80]) {
    const line = MeshBuilder.CreateBox(`vline-${xTile}`, { width: 1.4, depth: MAP_H * TILE, height: 0.3 }, scene);
    line.position = new Vector3((xTile + 1.5) * TILE, 0.22, (MAP_H * TILE) / 2);
    line.material = lineMat;
    line.freezeWorldMatrix();
    disposables.push(line);
  }

  const winA = windowTexture(scene, "tex-win-a", "#3a2a26", "#f0c878");
  const winB = windowTexture(scene, "tex-win-b", "#4a3630", "#e8b868");
  textures.push(winA, winB);
  const buildingMat = mat(scene, "m-bld", "#3a2a26");
  buildingMat.diffuseTexture = winA;
  buildingMat.emissiveTexture = winA;
  buildingMat.emissiveColor = new Color3(0.28, 0.22, 0.12);
  (winA as Texture).uScale = 2.2;
  (winA as Texture).vScale = 4.4;
  const buildingMat2 = mat(scene, "m-bld2", "#4a3630");
  buildingMat2.diffuseTexture = winB;
  buildingMat2.emissiveTexture = winB;
  buildingMat2.emissiveColor = new Color3(0.24, 0.18, 0.1);
  (winB as Texture).uScale = 2.2;
  (winB as Texture).vScale = 4.4;

  const seen = new Uint8Array(MAP_W * MAP_H);
  const landmarkArea = new Set<number>();
  for (const lm of world.landmarks) {
    for (let j = lm.y; j < lm.y + lm.h; j++) {
      for (let i = lm.x; i < lm.x + lm.w; i++) landmarkArea.add(j * MAP_W + i);
    }
  }

  const acMat = mat(scene, "m-ac", "#5a5854");
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
      const height = 48 + ((x * 7 + y * 13) % 5) * 24;
      const box = MeshBuilder.CreateBox(`b-${x}-${y}`, { width: w * TILE - 4, depth: h * TILE - 4, height }, scene);
      box.position = new Vector3(x * TILE + (w * TILE) / 2, height / 2, y * TILE + (h * TILE) / 2);
      box.material = (x + y) % 2 ? buildingMat : buildingMat2;
      box.freezeWorldMatrix();
      disposables.push(box);
      // Rooftop junk so the skyline isn't a flat lid.
      if (((x + y) & 3) === 0) {
        const ac = MeshBuilder.CreateBox(`ac-${x}-${y}`, { width: 10, depth: 14, height: 6 }, scene);
        ac.position = new Vector3(box.position.x + 8, height + 3, box.position.z);
        ac.material = acMat;
        ac.freezeWorldMatrix();
        disposables.push(ac);
      }
    }
  }

  const awningMat = mat(scene, "m-awn", "#c45a32", 0.12);
  for (const lm of world.landmarks) {
    const height = landmarkHeight(lm);
    landmarkTops.set(lm.id, height);
    const win = windowTexture(scene, `tex-${lm.id}`, landmarkColor(lm.kind), trimColor(lm.kind));
    textures.push(win);
    const wall = mat(scene, `m-${lm.id}`, landmarkColor(lm.kind), 0.04);
    wall.diffuseTexture = win;
    wall.emissiveTexture = win;
    wall.emissiveColor = Color3.FromHexString(trimColor(lm.kind)).scale(0.22);
    (win as Texture).uScale = Math.max(1.4, lm.w * 0.45);
    (win as Texture).vScale = Math.max(2.2, height / 28);
    const box = MeshBuilder.CreateBox(`lm-${lm.id}`, { width: lm.w * TILE - 6, depth: lm.h * TILE - 6, height }, scene);
    box.position = new Vector3(lm.x * TILE + (lm.w * TILE) / 2, height / 2, lm.y * TILE + (lm.h * TILE) / 2);
    box.material = wall;
    box.freezeWorldMatrix();
    disposables.push(box);

    const trim = MeshBuilder.CreateBox(`lt-${lm.id}`, { width: lm.w * TILE - 6, depth: lm.h * TILE - 6, height: 4 }, scene);
    trim.position = new Vector3(box.position.x, height + 2, box.position.z);
    trim.material = mat(scene, `mt-${lm.id}`, trimColor(lm.kind), 0.72);
    trim.freezeWorldMatrix();
    disposables.push(trim);

    // Recessed door on the south face — the street the player actually walks.
    const door = MeshBuilder.CreateBox(`ld-${lm.id}`, { width: 16, depth: 4, height: 20 }, scene);
    door.position = new Vector3(lm.doorX * TILE + TILE / 2, 10, lm.doorY * TILE + 3);
    door.material = mat(scene, `md-${lm.id}`, "#120e0c", 0.05);
    door.freezeWorldMatrix();
    disposables.push(door);

    const awning = MeshBuilder.CreateBox(`la-${lm.id}`, { width: 28, depth: 14, height: 1.6 }, scene);
    awning.position = new Vector3(lm.doorX * TILE + TILE / 2, 22, lm.doorY * TILE + 10);
    awning.material = awningMat;
    awning.freezeWorldMatrix();
    disposables.push(awning);

    const signTex = signTexture(scene, `signtex-${lm.id}`, lm.name, "#1a1410", trimColor(lm.kind));
    textures.push(signTex);
    const signMat = new StandardMaterial(`sign-${lm.id}`, scene);
    signMat.diffuseTexture = signTex;
    signMat.emissiveTexture = signTex;
    signMat.emissiveColor = new Color3(0.55, 0.45, 0.3);
    signMat.specularColor = Color3.Black();
    const sign = MeshBuilder.CreatePlane(`ls-${lm.id}`, { width: 56, height: 14 }, scene);
    sign.material = signMat;
    sign.position = new Vector3(lm.doorX * TILE + TILE / 2, 24, lm.doorY * TILE + 12);
    sign.rotation.y = 0;
    sign.freezeWorldMatrix();
    disposables.push(sign);
  }

  const lampMat = mat(scene, "m-lamp", "#2a2622");
  const lampHead = mat(scene, "m-lamphead", "#f0d890", 0.95);
  for (const yTile of [10, 22, 36, 50, 64]) {
    for (let x = 6; x < MAP_W; x += 12) {
      const pole = MeshBuilder.CreateBox(`lp-${x}-${yTile}`, { width: 1.6, depth: 1.6, height: 22 }, scene);
      pole.position = new Vector3(x * TILE, 11, (yTile - 1) * TILE + TILE / 2);
      pole.material = lampMat;
      pole.freezeWorldMatrix();
      disposables.push(pole);
      const head = MeshBuilder.CreateBox(`lh-${x}-${yTile}`, { width: 5, depth: 5, height: 2 }, scene);
      head.position = new Vector3(x * TILE, 22, (yTile - 1) * TILE + TILE / 2);
      head.material = lampHead;
      head.freezeWorldMatrix();
      disposables.push(head);
    }
  }

  // Palms along the water and a few courtyards — cheap silhouette, big read.
  const trunkMat = mat(scene, "m-trunk", "#5a3a28");
  const frondMat = mat(scene, "m-frond", "#2f6a48", 0.08);
  const palmSpots: Array<[number, number]> = [];
  for (let x = 4; x < MAP_W; x += 7) palmSpots.push([x * TILE, 4.2 * TILE]);
  palmSpots.push([28 * TILE, 30 * TILE], [78 * TILE, 58 * TILE], [16 * TILE, 60 * TILE], [46 * TILE, 12 * TILE]);
  for (let i = 0; i < palmSpots.length; i++) {
    const [px, pz] = palmSpots[i] ?? [0, 0];
    const trunk = MeshBuilder.CreateCylinder(`pt-${i}`, { height: 28, diameterTop: 2.2, diameterBottom: 3.6, tessellation: 6 }, scene);
    trunk.position = new Vector3(px, 14, pz);
    trunk.material = trunkMat;
    trunk.freezeWorldMatrix();
    disposables.push(trunk);
    for (let f = 0; f < 5; f++) {
      const frond = MeshBuilder.CreateBox(`pf-${i}-${f}`, { width: 16, depth: 3.2, height: 1.2 }, scene);
      const ang = (f / 5) * Math.PI * 2;
      frond.position = new Vector3(px + Math.cos(ang) * 6, 29, pz + Math.sin(ang) * 6);
      frond.rotation.y = ang;
      frond.rotation.z = -0.35;
      frond.material = frondMat;
      frond.freezeWorldMatrix();
      disposables.push(frond);
    }
  }

  scene.clearColor = new Color4(0.42, 0.55, 0.62, 1);

  return {
    landmarkTops,
    dispose: () => {
      for (const d of disposables) d.dispose();
      for (const t of textures) t.dispose();
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
