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
import type { TextureKit } from "./textures";

/** World units: 1 unit = 1 game pixel of the 2D grid (TILE = 32). */
export const GROUND_Y = 0;

export interface CityMeshes {
  dispose: () => void;
  landmarkTops: Map<string, number>;
  /**
   * Roof height per grid tile, in world units. The mesh builder was the only
   * thing that knew how tall it had made each block, so gameplay could not
   * tell a two-storey shop from a tower: there were no rooftops to stand on
   * and nothing to fire a web at. Zero means open sky above street level,
   * which includes water — you can swing over the bay, just not stand on it.
   */
  tops: Float32Array;
}

function mat(scene: Scene, name: string, hex: string, emissive = 0): StandardMaterial {
  const m = new StandardMaterial(name, scene);
  m.diffuseColor = Color3.FromHexString(hex);
  m.specularColor = new Color3(0.04, 0.04, 0.04);
  if (emissive > 0) m.emissiveColor = Color3.FromHexString(hex).scale(emissive);
  return m;
}

function canvas2d(ctx: ReturnType<DynamicTexture["getContext"]>): CanvasRenderingContext2D {
  return ctx as unknown as CanvasRenderingContext2D;
}

function windowTexture(scene: Scene, name: string, wall: string, lit: string): DynamicTexture {
  const tex = new DynamicTexture(name, { width: 256, height: 512 }, scene, false);
  const ctx = canvas2d(tex.getContext());
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, 256, 512);
  // Brick courses so the wall is not a flat vice-box.
  for (let y = 0; y < 512; y += 8) {
    ctx.fillStyle = y % 16 === 0 ? "rgba(0,0,0,0.16)" : "rgba(255,220,180,0.05)";
    ctx.fillRect(0, y, 256, 1);
  }
  // Ground-floor shop band — every face reads as a street.
  ctx.fillStyle = "#1a1410";
  ctx.fillRect(0, 400, 256, 112);
  ctx.fillStyle = lit;
  ctx.fillRect(12, 416, 70, 80);
  ctx.fillRect(94, 416, 70, 80);
  ctx.fillRect(176, 416, 68, 80);
  ctx.fillStyle = "rgba(255,230,180,0.22)";
  ctx.fillRect(12, 416, 70, 22);
  ctx.fillRect(94, 416, 70, 22);
  ctx.fillRect(176, 416, 68, 22);
  ctx.fillStyle = "#c45a32";
  ctx.fillRect(0, 396, 256, 8);
  const cols = 4;
  const rows = 6;
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
  tex.wrapU = 1;
  tex.wrapV = 1;
  return tex;
}

function asphaltTexture(scene: Scene): DynamicTexture {
  const tex = new DynamicTexture("tex-asphalt", { width: 256, height: 256 }, scene, false);
  const ctx = tex.getContext();
  ctx.fillStyle = "#2a2826";
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) {
    const n = 28 + ((i * 17) % 40);
    ctx.fillStyle = `rgb(${n},${n - 2},${n - 4})`;
    ctx.fillRect((i * 13) % 256, (i * 29) % 256, 2, 2);
  }
  ctx.fillStyle = "rgba(196,160,80,0.35)";
  ctx.fillRect(124, 0, 3, 18);
  ctx.fillRect(124, 36, 3, 18);
  ctx.fillRect(124, 72, 3, 18);
  ctx.fillRect(124, 108, 3, 18);
  ctx.fillRect(124, 144, 3, 18);
  ctx.fillRect(124, 180, 3, 18);
  ctx.fillRect(124, 216, 3, 18);
  tex.update();
  tex.wrapU = 0;
  tex.wrapV = 0;
  return tex;
}

function dirtTexture(scene: Scene): DynamicTexture {
  const tex = new DynamicTexture("tex-dirt", { width: 128, height: 128 }, scene, false);
  const ctx = tex.getContext();
  ctx.fillStyle = "#2c221c";
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 500; i++) {
    const n = 36 + ((i * 11) % 28);
    ctx.fillStyle = `rgb(${n + 8},${n},${n - 6})`;
    ctx.fillRect((i * 17) % 128, (i * 31) % 128, 3, 2);
  }
  tex.update();
  tex.wrapU = 1;
  tex.wrapV = 1;
  return tex;
}

function walkTexture(scene: Scene): DynamicTexture {
  const tex = new DynamicTexture("tex-walk", { width: 128, height: 128 }, scene, false);
  const ctx = tex.getContext();
  const c2 = canvas2d(ctx);
  ctx.fillStyle = "#8a7460";
  ctx.fillRect(0, 0, 128, 128);
  c2.strokeStyle = "rgba(40,28,20,0.28)";
  c2.lineWidth = 2;
  for (let i = 0; i < 128; i += 16) {
    c2.beginPath();
    c2.moveTo(i, 0);
    c2.lineTo(i, 128);
    c2.stroke();
    c2.beginPath();
    c2.moveTo(0, i);
    c2.lineTo(128, i);
    c2.stroke();
  }
  tex.update();
  tex.wrapU = 0;
  tex.wrapV = 0;
  return tex;
}

function grassTexture(scene: Scene): DynamicTexture {
  const tex = new DynamicTexture("tex-grass", { width: 128, height: 128 }, scene, false);
  const ctx = tex.getContext();
  ctx.fillStyle = "#2f5a38";
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 400; i++) {
    ctx.fillStyle = i % 3 === 0 ? "#3a6e42" : "#245030";
    ctx.fillRect((i * 19) % 128, (i * 37) % 128, 3, 5);
  }
  tex.update();
  tex.wrapU = 0;
  tex.wrapV = 0;
  return tex;
}

function skyTexture(scene: Scene): DynamicTexture {
  const tex = new DynamicTexture("tex-sky", { width: 512, height: 512 }, scene, false);
  const ctx = canvas2d(tex.getContext());
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, "#3d6ea8");
  g.addColorStop(0.45, "#7eb6d4");
  g.addColorStop(0.72, "#f2c9a0");
  g.addColorStop(1, "#e09060");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.beginPath();
  ctx.ellipse(140, 200, 70, 22, 0, 0, Math.PI * 2);
  ctx.ellipse(200, 188, 50, 16, 0, 0, Math.PI * 2);
  ctx.ellipse(360, 160, 80, 20, 0, 0, Math.PI * 2);
  ctx.fill();
  tex.update();
  return tex;
}

function shopMat(scene: Scene, name: string, tex: DynamicTexture, glow: Color3): StandardMaterial {
  const m = mat(scene, name, "#2a4050", 0.18);
  m.diffuseTexture = tex;
  m.emissiveTexture = tex;
  m.emissiveColor = glow;
  return m;
}

function dressBuildingKit(
  scene: Scene,
  disposables: Mesh[],
  id: string,
  cx: number,
  cz: number,
  bw: number,
  bd: number,
  height: number,
  shop: StandardMaterial,
  awning: StandardMaterial,
  rail: StandardMaterial,
  neon: StandardMaterial,
): void {
  const faces: Array<{ x: number; z: number; rot: number; w: number }> = [
    { x: cx, z: cz + bd / 2 + 1.3, rot: 0, w: Math.max(12, bw - 8) },
    { x: cx, z: cz - bd / 2 - 1.3, rot: Math.PI, w: Math.max(12, bw - 8) },
    { x: cx + bw / 2 + 1.3, z: cz, rot: Math.PI / 2, w: Math.max(12, bd - 8) },
    { x: cx - bw / 2 - 1.3, z: cz, rot: -Math.PI / 2, w: Math.max(12, bd - 8) },
  ];
  faces.forEach((f, i) => {
    const glass = MeshBuilder.CreateBox(`${id}-g${i}`, { width: f.w, depth: 1.6, height: 12 }, scene);
    glass.position = new Vector3(f.x, 6.2, f.z);
    glass.rotation.y = f.rot;
    glass.material = shop;
    glass.freezeWorldMatrix();
    disposables.push(glass);
    const awn = MeshBuilder.CreateBox(`${id}-a${i}`, { width: f.w * 0.92, depth: 7, height: 1.2 }, scene);
    const ox = Math.sin(f.rot) * 4;
    const oz = Math.cos(f.rot) * 4;
    awn.position = new Vector3(f.x + ox, 13.4, f.z + oz);
    awn.rotation.y = f.rot;
    awn.material = awning;
    awn.freezeWorldMatrix();
    disposables.push(awn);
  });
  // Fire escapes only climb the lower floors; running them the full height of
  // a 340-unit tower put thousands of extra meshes in the scene for detail
  // nobody can see from the street.
  const stories = Math.max(1, Math.min(7, Math.floor((height - 20) / 16)));
  for (let s = 0; s < stories; s++) {
    const plat = MeshBuilder.CreateBox(`${id}-fe${s}`, { width: 7, depth: 3.2, height: 0.7 }, scene);
    plat.position = new Vector3(cx + bw / 2 + 2.2, 20 + s * 16, cz);
    plat.material = rail;
    plat.freezeWorldMatrix();
    disposables.push(plat);
  }
  const sign = MeshBuilder.CreateBox(`${id}-neon`, { width: Math.min(28, bw * 0.45), depth: 1.2, height: 5 }, scene);
  sign.position = new Vector3(cx, Math.min(height - 8, 36), cz + bd / 2 + 1.6);
  sign.material = neon;
  sign.freezeWorldMatrix();
  disposables.push(sign);
}

/**
 * A roof that reads as a roof from above. The building boxes wear their window
 * texture on all six faces, so before this the top of every tower was a sheet
 * of windows — fine when nobody could get up there, wrong now that rooftops
 * are somewhere you land, walk and fight on.
 */
function roofDeck(
  scene: Scene,
  id: string,
  cx: number,
  cz: number,
  w: number,
  d: number,
  height: number,
  deck: StandardMaterial,
  vent: StandardMaterial,
): Mesh {
  const root = MeshBuilder.CreateBox(`${id}-deck`, { width: w, depth: d, height: 2.4 }, scene);
  root.position = new Vector3(cx, height + 1.2, cz);
  root.material = deck;
  const box = MeshBuilder.CreateBox(`${id}-vent`, { width: Math.min(16, w * 0.3), depth: Math.min(11, d * 0.3), height: 7 }, scene);
  box.position = new Vector3(cx - w * 0.2, height + 5.4, cz + d * 0.16);
  box.material = vent;
  box.parent = root;
  const stack = MeshBuilder.CreateCylinder(`${id}-stack`, { height: 12, diameter: 4.4, tessellation: 8 }, scene);
  stack.position = new Vector3(cx + w * 0.24, height + 8, cz - d * 0.2);
  stack.material = vent;
  stack.parent = root;
  root.freezeWorldMatrix();
  return root;
}

function shopTexture(scene: Scene, glass: string): DynamicTexture {
  const tex = new DynamicTexture(`tex-shop-${glass}`, { width: 256, height: 128 }, scene, false);
  const ctx = tex.getContext();
  ctx.fillStyle = "#2a2018";
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = glass;
  ctx.fillRect(8, 16, 72, 96);
  ctx.fillRect(92, 16, 72, 96);
  ctx.fillRect(176, 16, 72, 96);
  ctx.fillStyle = "rgba(255,230,180,0.22)";
  ctx.fillRect(8, 16, 72, 28);
  ctx.fillRect(92, 16, 72, 28);
  ctx.fillRect(176, 16, 72, 28);
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

export function buildCity(scene: Scene, world: WorldData, kit: TextureKit): CityMeshes {
  const disposables: Mesh[] = [];
  const textures: DynamicTexture[] = [];
  const landmarkTops = new Map<string, number>();
  const tops = new Float32Array(MAP_W * MAP_H);

  const dirt = dirtTexture(scene);
  textures.push(dirt);
  const ground = MeshBuilder.CreateGround("ground", { width: MAP_W * TILE, height: MAP_H * TILE }, scene);
  ground.position = new Vector3((MAP_W * TILE) / 2, GROUND_Y, (MAP_H * TILE) / 2);
  const groundMat = mat(scene, "m-ground", "#3a2a22");
  groundMat.diffuseTexture = dirt;
  (dirt as Texture).uScale = 24;
  (dirt as Texture).vScale = 20;
  ground.material = groundMat;
  disposables.push(ground);

  const asph = asphaltTexture(scene);
  const walk = walkTexture(scene);
  const grass = grassTexture(scene);
  textures.push(asph, walk, grass);
  const roadMat = mat(scene, "m-road", "#2c2826");
  roadMat.diffuseTexture = asph;
  (asph as Texture).uScale = 8;
  (asph as Texture).vScale = 1;
  const walkMat = mat(scene, "m-walk", "#7a6854");
  walkMat.diffuseTexture = walk;
  const grassMat = mat(scene, "m-grass", "#2a4a30");
  grassMat.diffuseTexture = grass;
  const stripMats: Record<number, StandardMaterial> = {
    [Cell.Road]: roadMat,
    [Cell.Walk]: walkMat,
    [Cell.Grass]: grassMat,
    [Cell.Water]: kit.material("glass", "#1e5a68", 0.28),
    [Cell.Sand]: kit.material("concrete", "#d4b078"),
    [Cell.Alley]: kit.material("concrete", "#241c16"),
    [Cell.Court]: kit.material("concrete", "#9a6230"),
    [Cell.Dock]: kit.material("wood", "#5a4c3c"),
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
  // Twice the courses of windows: the towers are twice as tall as they were.
  (winA as Texture).vScale = 8.8;
  const buildingMat2 = mat(scene, "m-bld2", "#4a3630");
  buildingMat2.diffuseTexture = winB;
  buildingMat2.emissiveTexture = winB;
  buildingMat2.emissiveColor = new Color3(0.24, 0.18, 0.1);
  (winB as Texture).uScale = 2.2;
  (winB as Texture).vScale = 8.8;

  const roofMat = kit.material("concrete", "#3b3733");
  const ventMat = mat(scene, "m-vent", "#6d6a63");
  const parapetMat = mat(scene, "m-parapet", "#2e2724");

  const seen = new Uint8Array(MAP_W * MAP_H);
  const landmarkArea = new Set<number>();
  for (const lm of world.landmarks) {
    for (let j = lm.y; j < lm.y + lm.h; j++) {
      for (let i = lm.x; i < lm.x + lm.w; i++) landmarkArea.add(j * MAP_W + i);
    }
  }

  const acMat = kit.material("metal", "#5a5854");
  const shopTexA = shopTexture(scene, "#3a6078");
  const shopTexB = shopTexture(scene, "#784838");
  const shopTexC = shopTexture(scene, "#2a5a48");
  textures.push(shopTexA, shopTexB, shopTexC);
  const shopGlassA = shopMat(scene, "m-shop-a", shopTexA, new Color3(0.2, 0.28, 0.32));
  const shopGlassB = shopMat(scene, "m-shop-b", shopTexB, new Color3(0.32, 0.18, 0.14));
  const shopGlassC = shopMat(scene, "m-shop-c", shopTexC, new Color3(0.16, 0.3, 0.22));
  const shopMats = [shopGlassA, shopGlassB, shopGlassC];
  const awningCols = [kit.material("canvas", "#c45a32"), kit.material("canvas", "#2a6a78"), kit.material("canvas", "#d8a030")];
  const railMat = kit.material("metal", "#2a2622");
  const neonMats = [
    mat(scene, "m-neon-a", "#e07040", 0.7),
    mat(scene, "m-neon-b", "#40c0d0", 0.7),
    mat(scene, "m-neon-c", "#e8c050", 0.7),
  ];
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
      // A skyline you can swing through. At the old 48-144 the tallest roof was
      // barely five times the player's height, so a line fired from the street
      // hung almost level and every arc scraped the pavement.
      const height = 84 + ((x * 7 + y * 13) % 5) * 52;
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) tops[(y + j) * MAP_W + x + i] = height;
      const bw = w * TILE - 4;
      const bd = h * TILE - 4;
      const cx = x * TILE + (w * TILE) / 2;
      const cz = y * TILE + (h * TILE) / 2;
      const box = MeshBuilder.CreateBox(`b-${x}-${y}`, { width: bw, depth: bd, height }, scene);
      box.position = new Vector3(cx, height / 2, cz);
      box.material = (x + y) % 2 ? buildingMat : buildingMat2;
      box.freezeWorldMatrix();
      disposables.push(box);
      disposables.push(roofDeck(scene, `b-${x}-${y}`, cx, cz, bw - 3, bd - 3, height, roofMat, ventMat));
      // A parapet you can see over the edge of, and land against.
      for (const [pw, pd, ox, oz] of [
        [bw, 2.6, 0, bd / 2 - 1.3],
        [bw, 2.6, 0, -bd / 2 + 1.3],
        [2.6, bd, bw / 2 - 1.3, 0],
        [2.6, bd, -bw / 2 + 1.3, 0],
      ] as Array<[number, number, number, number]>) {
        const wallTop = MeshBuilder.CreateBox(`bp-${x}-${y}-${ox}-${oz}`, { width: pw, depth: pd, height: 4 }, scene);
        wallTop.position = new Vector3(cx + ox, height + 2, cz + oz);
        wallTop.material = parapetMat;
        wallTop.freezeWorldMatrix();
        disposables.push(wallTop);
      }
      const kit = (x + y) % 3;
      dressBuildingKit(scene, disposables, `b-${x}-${y}`, cx, cz, bw, bd, height, shopMats[kit] ?? shopGlassA, awningCols[kit] ?? awningCols[0], railMat, neonMats[kit] ?? neonMats[0]);
      if (((x + y) & 3) === 0) {
        const ac = MeshBuilder.CreateBox(`ac-${x}-${y}`, { width: 10, depth: 14, height: 6 }, scene);
        ac.position = new Vector3(cx + 8, height + 3, cz);
        ac.material = acMat;
        ac.freezeWorldMatrix();
        disposables.push(ac);
      }
    }
  }

  const awningMat = kit.material("canvas", "#c45a32");
  for (const lm of world.landmarks) {
    const height = landmarkHeight(lm);
    landmarkTops.set(lm.id, height);
    for (let j = 0; j < lm.h; j++) {
      for (let i = 0; i < lm.w; i++) {
        const t = (lm.y + j) * MAP_W + lm.x + i;
        if (t >= 0 && t < tops.length && world.solid[t]) tops[t] = height;
      }
    }
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

    // The neon used to be a lit slab covering the whole footprint, which from
    // above turned every landmark into a flat sheet of glowing colour. It is a
    // band round the parapet now, with a real roof inside it.
    const lw = lm.w * TILE - 6;
    const ld = lm.h * TILE - 6;
    const trimMat = mat(scene, `mt-${lm.id}`, trimColor(lm.kind), 0.72);
    const edges: Array<[number, number, number, number]> = [
      [lw, 3, 0, ld / 2 - 1.5],
      [lw, 3, 0, -ld / 2 + 1.5],
      [3, ld, lw / 2 - 1.5, 0],
      [3, ld, -lw / 2 + 1.5, 0],
    ];
    edges.forEach(([w, d, ox, oz], i) => {
      const bar = MeshBuilder.CreateBox(`lt-${lm.id}-${i}`, { width: w, depth: d, height: 4 }, scene);
      bar.position = new Vector3(box.position.x + ox, height + 2, box.position.z + oz);
      bar.material = trimMat;
      bar.freezeWorldMatrix();
      disposables.push(bar);
    });
    disposables.push(roofDeck(scene, `lr-${lm.id}`, box.position.x, box.position.z, lw - 6, ld - 6, height, roofMat, ventMat));

    // Recessed door on the south face — the street the player actually walks.
    const door = MeshBuilder.CreateBox(`ld-${lm.id}`, { width: 16, depth: 4, height: 20 }, scene);
    door.position = new Vector3(lm.doorX * TILE + TILE / 2, 10, lm.doorY * TILE + 3);
    door.material = kit.material("wood", "#3a2820");
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

    dressBuildingKit(
      scene,
      disposables,
      `lmkit-${lm.id}`,
      box.position.x,
      box.position.z,
      lm.w * TILE - 6,
      lm.h * TILE - 6,
      height,
      shopGlassA,
      awningMat,
      railMat,
      neonMats[0] ?? shopGlassA,
    );
  }

  const lampMat = kit.material("metal", "#2a2622");
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
  const trunkMat = kit.material("bark", "#5a3a28");
  const frondMat = kit.material("foliage", "#2f6a48");
  const palmSpots: Array<[number, number]> = [];
  for (let x = 4; x < MAP_W; x += 7) palmSpots.push([x * TILE, 4.2 * TILE]);
  palmSpots.push(
    [28 * TILE, 30 * TILE],
    [78 * TILE, 58 * TILE],
    [16 * TILE, 60 * TILE],
    [46 * TILE, 12 * TILE],
    [14 * TILE, 62.4 * TILE],
    [20 * TILE, 67.2 * TILE],
    [32 * TILE, 62.4 * TILE],
    [48 * TILE, 67.2 * TILE],
    [10 * TILE, 48 * TILE],
    [34 * TILE, 48 * TILE],
    [60 * TILE, 62 * TILE],
  );
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

  const curbMat = kit.material("concrete", "#6a5a4c");
  const zebraMat = mat(scene, "m-zebra", "#e8d8c0", 0.08);
  for (const yTile of [10, 22, 36, 50, 64]) {
    const north = MeshBuilder.CreateBox(`curb-n-${yTile}`, { width: MAP_W * TILE, depth: 1.8, height: 1.2 }, scene);
    north.position = new Vector3((MAP_W * TILE) / 2, 0.6, (yTile - 0.15) * TILE);
    north.material = curbMat;
    north.freezeWorldMatrix();
    disposables.push(north);
    const south = MeshBuilder.CreateBox(`curb-s-${yTile}`, { width: MAP_W * TILE, depth: 1.8, height: 1.2 }, scene);
    south.position = new Vector3((MAP_W * TILE) / 2, 0.6, (yTile + 3.15) * TILE);
    south.material = curbMat;
    south.freezeWorldMatrix();
    disposables.push(south);
  }
  for (const xTile of [8, 22, 36, 50, 64, 80]) {
    for (const yTile of [10, 22, 36, 50, 64]) {
      for (let s = 0; s < 5; s++) {
        const zebra = MeshBuilder.CreateBox(`zw-${xTile}-${yTile}-${s}`, { width: 10, depth: 4, height: 0.25 }, scene);
        zebra.position = new Vector3((xTile + 1.5) * TILE, 0.28, yTile * TILE + 8 + s * 10);
        zebra.material = zebraMat;
        zebra.freezeWorldMatrix();
        disposables.push(zebra);
      }
    }
  }

  const binMat = kit.material("metal", "#3a4a38");
  const hydrantMat = kit.material("metal", "#c45a32");
  const benchMat = kit.material("wood", "#4a3024");
  let prop = 0;
  for (const yTile of [14, 28, 42, 56]) {
    for (let x = 10; x < MAP_W - 4; x += 14) {
      const bin = MeshBuilder.CreateBox(`bin-${prop}`, { width: 6, depth: 4, height: 7 }, scene);
      bin.position = new Vector3(x * TILE, 3.6, yTile * TILE);
      bin.material = binMat;
      bin.freezeWorldMatrix();
      disposables.push(bin);
      const hyd = MeshBuilder.CreateCylinder(`hyd-${prop}`, { height: 5, diameter: 2.4, tessellation: 6 }, scene);
      hyd.position = new Vector3((x + 3) * TILE, 2.6, (yTile + 1) * TILE);
      hyd.material = hydrantMat;
      hyd.freezeWorldMatrix();
      disposables.push(hyd);
      const bench = MeshBuilder.CreateBox(`bench-${prop}`, { width: 12, depth: 3.2, height: 3 }, scene);
      bench.position = new Vector3((x + 6) * TILE, 1.6, (yTile - 1) * TILE);
      bench.material = benchMat;
      bench.freezeWorldMatrix();
      disposables.push(bench);
      prop++;
    }
  }

  dressSpawnStreet(scene, kit, disposables, textures, lampMat, trunkMat, frondMat);
  dressCityStreets(scene, kit, world, disposables, lampMat, lampHead, binMat, hydrantMat, benchMat, curbMat);

  const boardMat = kit.material("plastic", "#c45a32", 0.2);
  const boards: Array<[number, number, number]> = [
    [20 * TILE, 40, 18 * TILE],
    [60 * TILE, 48, 38 * TILE],
    [44 * TILE, 36, 68 * TILE],
    [76 * TILE, 42, 24 * TILE],
  ];
  boards.forEach(([bx, by, bz], i) => {
    const pole = MeshBuilder.CreateBox(`bp-${i}`, { width: 1.8, depth: 1.8, height: by }, scene);
    pole.position = new Vector3(bx, by / 2, bz);
    pole.material = lampMat;
    pole.freezeWorldMatrix();
    disposables.push(pole);
    const face = MeshBuilder.CreateBox(`bf-${i}`, { width: 36, depth: 1.4, height: 16 }, scene);
    face.position = new Vector3(bx, by + 6, bz);
    face.material = boardMat;
    face.freezeWorldMatrix();
    disposables.push(face);
  });

  const skyTex = skyTexture(scene);
  textures.push(skyTex);
  const skyMat = new StandardMaterial("m-sky", scene);
  skyMat.emissiveTexture = skyTex;
  skyMat.diffuseTexture = skyTex;
  skyMat.disableLighting = true;
  skyMat.backFaceCulling = false;
  skyMat.emissiveColor = new Color3(1, 1, 1);
  const sky = MeshBuilder.CreateSphere("sky", { diameter: 4200, segments: 12 }, scene);
  sky.material = skyMat;
  sky.infiniteDistance = true;
  sky.isPickable = false;
  disposables.push(sky);

  scene.clearColor = new Color4(0.55, 0.68, 0.78, 1);

  return {
    landmarkTops,
    tops,
    dispose: () => {
      for (const d of disposables) d.dispose();
      for (const t of textures) t.dispose();
    },
  };
}

function parkedCar(
  scene: Scene,
  disposables: Mesh[],
  id: string,
  x: number,
  z: number,
  rot: number,
  body: StandardMaterial,
  glass: StandardMaterial,
): void {
  const root = MeshBuilder.CreateBox(`${id}-b`, { width: 22, depth: 10, height: 5.4 }, scene);
  root.position = new Vector3(x, 4.2, z);
  root.rotation.y = rot;
  root.material = body;
  root.freezeWorldMatrix();
  disposables.push(root);
  const cabin = MeshBuilder.CreateBox(`${id}-c`, { width: 10, depth: 8.6, height: 4.2 }, scene);
  const ox = Math.cos(rot) * -3;
  const oz = -Math.sin(rot) * -3;
  cabin.position = new Vector3(x + ox, 8.4, z + oz);
  cabin.rotation.y = rot;
  cabin.material = glass;
  cabin.freezeWorldMatrix();
  disposables.push(cabin);
}

function dressCityStreets(
  scene: Scene,
  kit: TextureKit,
  world: WorldData,
  disposables: Mesh[],
  lampMat: StandardMaterial,
  lampHead: StandardMaterial,
  binMat: StandardMaterial,
  hydrantMat: StandardMaterial,
  benchMat: StandardMaterial,
  curbMat: StandardMaterial,
): void {
  const carCols = [
    kit.material("carPaint", "#c45a32"),
    kit.material("carPaint", "#2a4a68"),
    kit.material("carPaint", "#d8c4a0"),
    kit.material("carPaint", "#3a2a28"),
    kit.material("carPaint", "#6a8a48"),
  ];
  const cabinGlass = kit.material("glass", "#1c2630");
  const lightRed = mat(scene, "m-tl-r", "#c43020", 0.85);
  const lightGo = mat(scene, "m-tl-g", "#2a8a50", 0.35);
  let n = 0;
  for (let y = 2; y < MAP_H; y += 3) {
    for (let x = 2; x < MAP_W; x += 4) {
      if ((world.cells[y * MAP_W + x] as Cell) !== Cell.Walk) continue;
      const px = x * TILE + 16;
      const pz = y * TILE + 16;
      const kind = (x * 5 + y * 3) % 5;
      if (kind === 0) {
        const bin = MeshBuilder.CreateBox(`st-bin-${n}`, { width: 5, depth: 4, height: 7 }, scene);
        bin.position = new Vector3(px, 3.6, pz);
        bin.material = binMat;
        bin.freezeWorldMatrix();
        disposables.push(bin);
      } else if (kind === 1) {
        const hyd = MeshBuilder.CreateCylinder(`st-hyd-${n}`, { height: 5, diameter: 2.2, tessellation: 6 }, scene);
        hyd.position = new Vector3(px, 2.6, pz);
        hyd.material = hydrantMat;
        hyd.freezeWorldMatrix();
        disposables.push(hyd);
      } else if (kind === 2) {
        const bench = MeshBuilder.CreateBox(`st-bench-${n}`, { width: 11, depth: 3, height: 3 }, scene);
        bench.position = new Vector3(px, 1.6, pz);
        bench.material = benchMat;
        bench.freezeWorldMatrix();
        disposables.push(bench);
      } else if (kind === 3) {
        const box = MeshBuilder.CreateBox(`st-news-${n}`, { width: 3.4, depth: 3.4, height: 6 }, scene);
        box.position = new Vector3(px, 3.1, pz);
        box.material = curbMat;
        box.freezeWorldMatrix();
        disposables.push(box);
      } else {
        const pot = MeshBuilder.CreateCylinder(`st-pot-${n}`, { height: 4, diameter: 4.4, tessellation: 6 }, scene);
        pot.position = new Vector3(px, 2.1, pz);
        pot.material = binMat;
        pot.freezeWorldMatrix();
        disposables.push(pot);
        const pole = MeshBuilder.CreateBox(`st-lp-${n}`, { width: 1.4, depth: 1.4, height: 20 }, scene);
        pole.position = new Vector3(px + 8, 10, pz);
        pole.material = lampMat;
        pole.freezeWorldMatrix();
        disposables.push(pole);
        const head = MeshBuilder.CreateBox(`st-lh-${n}`, { width: 4.4, depth: 4.4, height: 1.8 }, scene);
        head.position = new Vector3(px + 8, 20, pz);
        head.material = lampHead;
        head.freezeWorldMatrix();
        disposables.push(head);
      }
      n++;
    }
  }
  const arterials = [10, 22, 36, 50, 64];
  let c = 0;
  for (const yTile of arterials) {
    for (let x = 4; x < MAP_W - 4; x += 7) {
      if (x % 14 < 3) continue;
      parkedCar(scene, disposables, `pk-${c}`, x * TILE, (yTile + 0.32) * TILE, 0, carCols[c % carCols.length] ?? cabinGlass, cabinGlass);
      c++;
    }
  }
  for (const xTile of [8, 22, 36, 50, 64, 80]) {
    for (let y = 6; y < MAP_H - 4; y += 8) {
      if (arterials.some((r) => Math.abs(y - r) < 3)) continue;
      parkedCar(scene, disposables, `pkv-${c}`, (xTile + 0.32) * TILE, y * TILE, Math.PI / 2, carCols[c % carCols.length] ?? cabinGlass, cabinGlass);
      c++;
    }
  }
  let t = 0;
  for (const yTile of arterials) {
    for (const xTile of [8, 22, 36, 50, 64, 80]) {
      const px = (xTile - 0.55) * TILE;
      const pz = (yTile - 0.55) * TILE;
      const pole = MeshBuilder.CreateBox(`tl-${t}`, { width: 1.4, depth: 1.4, height: 26 }, scene);
      pole.position = new Vector3(px, 13, pz);
      pole.material = lampMat;
      pole.freezeWorldMatrix();
      disposables.push(pole);
      const head = MeshBuilder.CreateBox(`tlh-${t}`, { width: 3.2, depth: 2.2, height: 8 }, scene);
      head.position = new Vector3(px, 24, pz);
      head.material = lampMat;
      head.freezeWorldMatrix();
      disposables.push(head);
      const lens = MeshBuilder.CreateBox(`tll-${t}`, { width: 2.2, depth: 1.2, height: 2.2 }, scene);
      lens.position = new Vector3(px, 25.4, pz + 1.4);
      lens.material = t % 3 === 0 ? lightRed : lightGo;
      lens.freezeWorldMatrix();
      disposables.push(lens);
      t++;
    }
  }
}

/** First 10 seconds of play happen here — pack the sidewalk so it isn't a tan void. */
function dressSpawnStreet(
  scene: Scene,
  kit: TextureKit,
  disposables: Mesh[],
  textures: DynamicTexture[],
  lampMat: StandardMaterial,
  trunkMat: StandardMaterial,
  frondMat: StandardMaterial,
): void {
  const sx = 16 * TILE + 16;
  const sz = 63 * TILE + 8;
  const rust = kit.material("metal", "#6a3a28");
  const dump = kit.material("metal", "#3a4a32");
  const crate = kit.material("wood", "#8a6238");
  const cone = kit.material("plastic", "#d45a20");
  const steel = kit.material("metal", "#4a4844");
  const neon = mat(scene, "m-spawn-neon", "#e07040", 0.55);
  const muralTex = muralTexture(scene);
  textures.push(muralTex);
  const muralMat = new StandardMaterial("m-spawn-mural", scene);
  muralMat.diffuseTexture = muralTex;
  muralMat.emissiveTexture = muralTex;
  muralMat.emissiveColor = new Color3(0.4, 0.28, 0.18);
  muralMat.specularColor = Color3.Black();

  const mural = MeshBuilder.CreatePlane("spawn-mural", { width: 42, height: 22 }, scene);
  mural.material = muralMat;
  mural.position = new Vector3(sx - 28, 14, sz - 36);
  mural.rotation.y = 0;
  mural.freezeWorldMatrix();
  disposables.push(mural);

  const southside = signTexture(scene, "signtex-southside", "SOUTHSIDE", "#f3e6d2", "#8a2820");
  textures.push(southside);
  const ssMat = new StandardMaterial("m-ss-sign", scene);
  ssMat.diffuseTexture = southside;
  ssMat.emissiveTexture = southside;
  ssMat.emissiveColor = new Color3(0.55, 0.3, 0.2);
  ssMat.specularColor = Color3.Black();
  const ss = MeshBuilder.CreatePlane("spawn-ss", { width: 36, height: 10 }, scene);
  ss.material = ssMat;
  ss.position = new Vector3(sx + 8, 26, sz - 40);
  ss.freezeWorldMatrix();
  disposables.push(ss);

  const props: Array<[string, number, number, number, number, number, number, StandardMaterial]> = [
    ["dump-a", 10, 8, 12, sx + 22, 6, sz + 18, dump],
    ["dump-b", 8, 6, 9, sx - 18, 4.6, sz + 22, rust],
    ["crate-a", 6, 5, 5, sx + 34, 2.6, sz + 6, crate],
    ["crate-b", 5, 4, 4, sx + 40, 2.1, sz + 10, crate],
    ["news", 4, 4, 8, sx - 8, 4, sz + 14, steel],
    ["vendor", 14, 8, 8, sx + 48, 4, sz - 8, rust],
    ["bench-s", 16, 3.4, 3.2, sx - 4, 1.7, sz - 18, crate],
    ["planter", 8, 8, 4, sx + 18, 2, sz - 22, dump],
    ["scooter", 9, 3.2, 4, sx + 56, 2.1, sz + 4, steel],
  ];
  for (const [id, w, d, h, x, y, z, m] of props) {
    const box = MeshBuilder.CreateBox(id, { width: w, depth: d, height: h }, scene);
    box.position = new Vector3(x, y, z);
    box.material = m;
    box.freezeWorldMatrix();
    disposables.push(box);
  }
  for (let i = 0; i < 4; i++) {
    const c = MeshBuilder.CreateCylinder(`cone-${i}`, { height: 4.4, diameterTop: 0.6, diameterBottom: 2.4, tessellation: 6 }, scene);
    c.position = new Vector3(sx + 28 + i * 5, 2.2, sz + 28);
    c.material = cone;
    c.freezeWorldMatrix();
    disposables.push(c);
  }
  for (let i = 0; i < 3; i++) {
    const pole = MeshBuilder.CreateBox(`sp-lamp-${i}`, { width: 1.5, depth: 1.5, height: 24 }, scene);
    pole.position = new Vector3(sx - 20 + i * 28, 12, sz + 8);
    pole.material = lampMat;
    pole.freezeWorldMatrix();
    disposables.push(pole);
    const head = MeshBuilder.CreateBox(`sp-lamph-${i}`, { width: 6, depth: 5, height: 2.2 }, scene);
    head.position = new Vector3(sx - 20 + i * 28, 24, sz + 8);
    head.material = neon;
    head.freezeWorldMatrix();
    disposables.push(head);
  }
  const trunk = MeshBuilder.CreateCylinder("sp-palm", { height: 30, diameterTop: 2.2, diameterBottom: 3.8, tessellation: 6 }, scene);
  trunk.position = new Vector3(sx - 36, 15, sz + 6);
  trunk.material = trunkMat;
  trunk.freezeWorldMatrix();
  disposables.push(trunk);
  for (let f = 0; f < 5; f++) {
    const frond = MeshBuilder.CreateBox(`sp-frond-${f}`, { width: 18, depth: 3.4, height: 1.2 }, scene);
    const ang = (f / 5) * Math.PI * 2;
    frond.position = new Vector3(sx - 36 + Math.cos(ang) * 6, 31, sz + 6 + Math.sin(ang) * 6);
    frond.rotation.y = ang;
    frond.rotation.z = -0.35;
    frond.material = frondMat;
    frond.freezeWorldMatrix();
    disposables.push(frond);
  }
}

function muralTexture(scene: Scene): DynamicTexture {
  const tex = new DynamicTexture("tex-mural", { width: 512, height: 256 }, scene, false);
  const ctx = canvas2d(tex.getContext());
  ctx.fillStyle = "#2a1c18";
  ctx.fillRect(0, 0, 512, 256);
  ctx.fillStyle = "#c45a32";
  ctx.fillRect(0, 0, 512, 36);
  ctx.fillStyle = "#e8b060";
  ctx.font = "bold 64px Impact, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("NOVA CITY", 256, 88);
  ctx.fillStyle = "#f3e6d2";
  ctx.font = "bold 36px Impact, sans-serif";
  ctx.fillText("SOUTHSIDE NEVER SLEEPS", 256, 160);
  ctx.fillStyle = "#6a8a48";
  ctx.fillRect(24, 200, 80, 36);
  ctx.fillStyle = "#4a90d8";
  ctx.fillRect(216, 204, 70, 32);
  ctx.fillStyle = "#c45a32";
  ctx.fillRect(400, 200, 88, 36);
  tex.update();
  return tex;
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
    case "club":
      return 40;
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
    case "club":
      return "#2e1c34";
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
    case "club":
      return "#ff4aa8";
    default: {
      const _n: never = kind;
      return _n;
    }
  }
}
