import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3, Vector4 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
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
  /**
   * How brightly the windows burn, 0 in daylight to 1 after dark. Window
   * light lives in its own texture channel so a wall can stay a wall by day;
   * the runtime owns the clock, so it drives this.
   */
  setNight: (k: number) => void;
  /**
   * Repaints the dome for an hour of the day, and reports the horizon colour
   * so fog and the clear colour can be matched to it. Cheap enough to call
   * every frame — it only redraws when the hour has moved far enough to see.
   */
  setHour: (hour: number, blackout: boolean) => Color3;
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

/**
 * World size of one facade tile. The wall is painted as four window bays
 * across and four floors up, so at 48 units a floor stands 12 units tall —
 * about twice the player. Every building scales its UVs to this, which is
 * what makes a tower read as a tower instead of as a striped box: before
 * this, one facade image was stretched a fixed 8.8 times up every wall
 * whatever its height, and the storefront band baked into it repeated all
 * the way to the roof.
 */
const FACADE_TILE = 48;
const FACADE_PX = 256;
const BAY_PX = FACADE_PX / 4;

type FacadeKind = "brick" | "stucco" | "office" | "curtain";

interface FacadeStyle {
  kind: FacadeKind;
  /** Wall body. */
  wall: string;
  /** Sills, piers, banding — whatever the style picks out against the wall. */
  trim: string;
  /** Daylight glass. */
  glass: string;
  /** What burns behind that glass after dark. */
  lit: string;
}

/** Deterministic hash in [0,1): the city has to look the same every load. */
function hash01(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Lightens (amt > 0) or darkens a colour. Takes its own output back in. */
function tint(colour: string, amt: number): string {
  const parts = colour.startsWith("#")
    ? [1, 2, 3].map((i) => parseInt(colour.substr(i * 2 - 1, 2), 16))
    : (colour.match(/\d+/g) ?? ["0", "0", "0"]).slice(0, 3).map(Number);
  const to = amt >= 0 ? 255 : 0;
  const k = Math.abs(amt);
  const ch = (v: number): number => Math.round((v ?? 0) * (1 - k) + to * k);
  return `rgb(${ch(parts[0] ?? 0)},${ch(parts[1] ?? 0)},${ch(parts[2] ?? 0)})`;
}

/**
 * One window: a recess in the diffuse pass, and a light behind it in the
 * emissive pass. Splitting the two is what lets a wall stay a wall in
 * daylight and light up only at its windows at night — sharing one texture
 * between diffuse and emissive, as this used to, makes whole buildings glow.
 */
function paintWindow(
  d: CanvasRenderingContext2D,
  e: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  s: FacadeStyle,
  seed: number,
): void {
  d.fillStyle = "rgba(0,0,0,0.55)";
  d.fillRect(x - 1.5, y - 1.5, w + 3, h + 3);
  const g = d.createLinearGradient(x, y, x + w * 0.4, y + h);
  g.addColorStop(0, tint(s.glass, 0.22));
  g.addColorStop(0.5, tint(s.glass, -0.3));
  g.addColorStop(1, tint(s.glass, -0.05));
  d.fillStyle = g;
  d.fillRect(x, y, w, h);
  d.fillStyle = "rgba(12,10,9,0.5)";
  d.fillRect(x + w / 2 - 0.5, y, 1, h);
  d.fillRect(x, y + Math.round(h * 0.44), w, 1);
  const blind = hash01(seed) < 0.3 ? 0.2 + hash01(seed * 3) * 0.35 : 0;
  if (blind > 0) {
    d.fillStyle = "rgba(214,200,176,0.55)";
    d.fillRect(x, y, w, h * blind);
  }
  if (hash01(seed * 7 + 5) < 0.72) {
    e.fillStyle = tint(s.lit, hash01(seed * 11) * 0.3 - 0.15);
    e.fillRect(x, y, w, h);
    e.fillStyle = "rgba(0,0,0,0.4)";
    e.fillRect(x + w / 2 - 0.5, y, 1, h);
    e.fillRect(x, y + Math.round(h * 0.44), w, 1);
    if (blind > 0) {
      e.fillStyle = "rgba(0,0,0,0.5)";
      e.fillRect(x, y, w, h * blind);
    }
  }
}

/** Speckle that keeps a flat fill from reading as coloured paper. */
function grain(ctx: CanvasRenderingContext2D, count: number, alpha: number, seed: number, size = FACADE_PX): void {
  for (let i = 0; i < count; i++) {
    const x = hash01(seed + i * 2.1) * size;
    const y = hash01(seed + i * 5.7 + 91) * size;
    ctx.fillStyle = hash01(seed + i) > 0.5 ? `rgba(255,248,235,${alpha})` : `rgba(0,0,0,${alpha * 1.4})`;
    ctx.fillRect(x, y, 1 + hash01(i * 3.3) * 2, 1 + hash01(i * 1.7) * 2);
  }
}

function paintFacade(d: CanvasRenderingContext2D, e: CanvasRenderingContext2D, s: FacadeStyle, seed: number): void {
  d.fillStyle = s.wall;
  d.fillRect(0, 0, FACADE_PX, FACADE_PX);
  switch (s.kind) {
    case "brick": {
      // Courses on an 8px pitch: 32 of them across the tile, so the joint
      // pattern meets itself cleanly where the texture wraps.
      for (let y = 0; y < FACADE_PX; y += 8) {
        d.fillStyle = "rgba(0,0,0,0.2)";
        d.fillRect(0, y, FACADE_PX, 1);
        d.fillStyle = "rgba(255,226,196,0.06)";
        d.fillRect(0, y + 1, FACADE_PX, 1);
        const off = (y / 8) % 2 === 0 ? 0 : 8;
        for (let x = off; x < FACADE_PX; x += 16) {
          d.fillStyle = "rgba(0,0,0,0.14)";
          d.fillRect(x, y, 1, 8);
        }
      }
      grain(d, 260, 0.05, seed);
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
          const x = c * BAY_PX + 17;
          const y = r * BAY_PX + 15;
          d.fillStyle = tint(s.trim, -0.25);
          d.fillRect(x - 4, y - 5, 38, 4);
          paintWindow(d, e, x, y, 30, 36, s, seed + r * 4 + c);
          d.fillStyle = s.trim;
          d.fillRect(x - 4, y + 36, 38, 4);
          d.fillStyle = "rgba(0,0,0,0.22)";
          d.fillRect(x - 4, y + 40, 38, 2);
        }
      }
      break;
    }
    case "stucco": {
      // Miami deco: pastel render, a shadow line at every floor and windows
      // wide enough to read as a strip from across the street.
      grain(d, 320, 0.045, seed);
      for (let r = 0; r < 4; r++) {
        const y = r * BAY_PX;
        d.fillStyle = s.trim;
        d.fillRect(0, y + BAY_PX - 8, FACADE_PX, 4);
        d.fillStyle = "rgba(0,0,0,0.2)";
        d.fillRect(0, y + BAY_PX - 4, FACADE_PX, 2);
        for (let c = 0; c < 4; c++) {
          const x = c * BAY_PX + 11;
          d.fillStyle = "rgba(0,0,0,0.24)";
          d.fillRect(x - 3, y + 14, 48, 5);
          paintWindow(d, e, x, y + 19, 42, 28, s, seed + r * 4 + c + 40);
        }
      }
      break;
    }
    case "office": {
      // Concrete piers with a recessed spandrel: the frame of a mid-century
      // block, which breaks up a skyline otherwise made entirely of brick.
      for (let c = 0; c <= 4; c++) {
        d.fillStyle = tint(s.trim, 0.1);
        d.fillRect(c * BAY_PX - 4, 0, 8, FACADE_PX);
        d.fillStyle = "rgba(0,0,0,0.18)";
        d.fillRect(c * BAY_PX + 4, 0, 2, FACADE_PX);
      }
      grain(d, 220, 0.05, seed);
      for (let r = 0; r < 4; r++) {
        const y = r * BAY_PX;
        d.fillStyle = tint(s.wall, -0.28);
        d.fillRect(0, y + 4, FACADE_PX, 18);
        for (let c = 0; c < 4; c++) {
          paintWindow(d, e, c * BAY_PX + 8, y + 26, 48, 30, s, seed + r * 4 + c + 80);
        }
      }
      break;
    }
    case "curtain": {
      // A glass tower: no wall to speak of, just panels and mullions. Two
      // panels per floor so the grid stays fine at a distance.
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          const x = c * (FACADE_PX / 8);
          const y = r * (FACADE_PX / 8);
          const w = FACADE_PX / 8;
          const v = hash01(seed + r * 8 + c) * 0.34 - 0.17;
          d.fillStyle = tint(s.glass, v);
          d.fillRect(x, y, w, w);
          d.fillStyle = `rgba(255,255,255,${0.03 + hash01(seed + r + c * 3) * 0.07})`;
          d.fillRect(x, y, w, w * 0.3);
          if (hash01(seed * 3 + r * 8 + c) < 0.5) {
            e.fillStyle = tint(s.lit, hash01(seed + r * 3 + c) * 0.3 - 0.2);
            e.fillRect(x + 1, y + 1, w - 2, w - 2);
          }
        }
      }
      for (let i = 0; i <= 8; i++) {
        const p = i * (FACADE_PX / 8);
        d.fillStyle = tint(s.trim, 0);
        d.fillRect(p - 1, 0, 2, FACADE_PX);
        d.fillRect(0, p - 1, FACADE_PX, 2);
      }
      break;
    }
    default: {
      const never: never = s.kind;
      throw new Error(`unhandled facade ${String(never)}`);
    }
  }
}

interface Facade {
  diffuse: DynamicTexture;
  emissive: DynamicTexture;
  material: StandardMaterial;
}

/**
 * Mipmapped: a facade repeated up a tower and then viewed from three streets
 * away samples the full-size image for every pixel without them, which both
 * shimmers and costs fill rate on weak hardware.
 */
function facade(scene: Scene, name: string, s: FacadeStyle, seed: number): Facade {
  const diffuse = new DynamicTexture(`${name}-d`, { width: FACADE_PX, height: FACADE_PX }, scene, true);
  const emissive = new DynamicTexture(`${name}-e`, { width: FACADE_PX, height: FACADE_PX }, scene, true);
  const e = canvas2d(emissive.getContext());
  e.fillStyle = "#000000";
  e.fillRect(0, 0, FACADE_PX, FACADE_PX);
  paintFacade(canvas2d(diffuse.getContext()), e, s, seed);
  for (const t of [diffuse, emissive]) {
    t.hasAlpha = false;
    t.update();
    t.wrapU = 1;
    t.wrapV = 1;
  }
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = new Color3(1, 1, 1);
  material.specularColor = new Color3(0.05, 0.05, 0.06);
  material.diffuseTexture = diffuse;
  material.emissiveTexture = emissive;
  material.emissiveColor = new Color3(0, 0, 0);
  return { diffuse, emissive, material };
}

/**
 * UVs that give a box the same texel density on every face regardless of its
 * proportions. Babylon's box faces come in width/height, depth/height and
 * width/depth pairs, so each pair takes its own repeat count.
 */
function facadeUV(w: number, d: number, h: number): Vector4[] {
  const uw = Math.max(1, Math.round(w / FACADE_TILE));
  const ud = Math.max(1, Math.round(d / FACADE_TILE));
  const uh = Math.max(1, Math.round(h / FACADE_TILE));
  return [
    new Vector4(0, 0, uw, uh),
    new Vector4(0, 0, uw, uh),
    new Vector4(0, 0, ud, uh),
    new Vector4(0, 0, ud, uh),
    new Vector4(0, 0, uw, ud),
    new Vector4(0, 0, uw, ud),
  ];
}

/**
 * One tile of road, TILE units square. The old asphalt was a near-black fill
 * scaled eight times across a strip however wide it was, so on a long avenue
 * one repeat covered a hundred units and the road rendered as a void. Every
 * ground strip now scales its UVs by its own size instead (see `stripUV`),
 * which is what lets this hold detail at any length.
 */
function asphaltTexture(scene: Scene): DynamicTexture {
  const tex = new DynamicTexture("tex-asphalt", { width: 128, height: 128 }, scene, true);
  const ctx = canvas2d(tex.getContext());
  ctx.fillStyle = "#474542";
  ctx.fillRect(0, 0, 128, 128);
  // Aggregate. Two sizes so it does not read as uniform noise.
  for (let i = 0; i < 1400; i++) {
    const n = 52 + hash01(i * 1.7) * 34;
    ctx.fillStyle = `rgba(${n},${n - 2},${n - 5},0.8)`;
    ctx.fillRect(hash01(i * 3.1) * 128, hash01(i * 7.9 + 4) * 128, 1, 1);
  }
  for (let i = 0; i < 220; i++) {
    const n = 30 + hash01(i * 5.3) * 26;
    ctx.fillStyle = `rgba(${n},${n},${n - 2},0.7)`;
    ctx.fillRect(hash01(i * 2.3 + 9) * 128, hash01(i * 6.1 + 2) * 128, 2, 2);
  }
  // Patched repairs, and one short crack. Anything longer or darker turns
  // into a visible scribble stamped on every square of road once the tile
  // repeats down a whole avenue.
  ctx.fillStyle = "rgba(38,37,35,0.22)";
  ctx.fillRect(18, 66, 44, 22);
  ctx.fillRect(88, 12, 26, 30);
  ctx.strokeStyle = "rgba(30,29,28,0.3)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(30, 20);
  ctx.lineTo(38, 46);
  ctx.lineTo(31, 70);
  ctx.stroke();
  tex.update();
  tex.wrapU = 1;
  tex.wrapV = 1;
  return tex;
}

/**
 * UVs scaled to a strip's own size, so a tile of pavement covers the same
 * ground everywhere. Ground meshes come out of Babylon with 0..1 UVs, which
 * on a shared texture means the longer the strip the more stretched it is.
 */
function stripUV(mesh: Mesh, w: number, d: number, per: number): void {
  const uv = mesh.getVerticesData("uv");
  if (!uv) return;
  const su = w / per;
  const sv = d / per;
  for (let i = 0; i < uv.length; i += 2) {
    uv[i] *= su;
    uv[i + 1] *= sv;
  }
  mesh.setVerticesData("uv", uv);
}

function dirtTexture(scene: Scene): DynamicTexture {
  const tex = new DynamicTexture("tex-dirt", { width: 128, height: 128 }, scene, true);
  const ctx = canvas2d(tex.getContext());
  ctx.fillStyle = "#5a4b3c";
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 900; i++) {
    const n = 72 + hash01(i * 2.1) * 40;
    ctx.fillStyle = `rgba(${Math.round(n + 10)},${Math.round(n - 4)},${Math.round(n - 20)},0.7)`;
    ctx.fillRect(hash01(i * 4.7) * 128, hash01(i * 8.3 + 1) * 128, 2, 2);
  }
  for (let i = 0; i < 120; i++) {
    ctx.fillStyle = "rgba(40,33,26,0.35)";
    ctx.fillRect(hash01(i * 6.9 + 3) * 128, hash01(i * 3.1 + 8) * 128, 4, 3);
  }
  tex.update();
  tex.wrapU = 1;
  tex.wrapV = 1;
  return tex;
}

/** Four paving slabs square, each one scuffed differently. */
function walkTexture(scene: Scene): DynamicTexture {
  const tex = new DynamicTexture("tex-walk", { width: 128, height: 128 }, scene, true);
  const ctx = canvas2d(tex.getContext());
  ctx.fillStyle = "#3a352f";
  ctx.fillRect(0, 0, 128, 128);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const v = hash01(r * 4 + c) * 26;
      const n = Math.round(128 + v);
      ctx.fillStyle = `rgb(${n},${n - 8},${n - 20})`;
      ctx.fillRect(c * 32 + 1, r * 32 + 1, 30, 30);
      // Worn corner and a chip or two, so the slabs are not stamped copies.
      ctx.fillStyle = `rgba(0,0,0,${0.05 + hash01(r * 7 + c * 3) * 0.09})`;
      ctx.fillRect(c * 32 + 1, r * 32 + 1, 30, 4 + hash01(c * 5 + r) * 10);
      if (hash01(r * 13 + c * 5) < 0.4) {
        ctx.fillStyle = "rgba(60,52,44,0.4)";
        ctx.fillRect(c * 32 + 6 + hash01(c + r) * 16, r * 32 + 8 + hash01(r + c * 2) * 14, 5, 4);
      }
    }
  }
  for (let i = 0; i < 700; i++) {
    const n = 120 + hash01(i * 2.7) * 50;
    ctx.fillStyle = `rgba(${n},${n - 10},${n - 22},0.35)`;
    ctx.fillRect(hash01(i * 3.9) * 128, hash01(i * 8.1 + 3) * 128, 1, 1);
  }
  tex.update();
  tex.wrapU = 1;
  tex.wrapV = 1;
  return tex;
}

function grassTexture(scene: Scene): DynamicTexture {
  const tex = new DynamicTexture("tex-grass", { width: 128, height: 128 }, scene, true);
  const ctx = canvas2d(tex.getContext());
  ctx.fillStyle = "#3e6b40";
  ctx.fillRect(0, 0, 128, 128);
  // Mown bands, then blades over the top: a lawn, not a green rectangle.
  for (let y = 0; y < 128; y += 16) {
    ctx.fillStyle = (y / 16) % 2 === 0 ? "rgba(255,255,220,0.05)" : "rgba(0,0,0,0.07)";
    ctx.fillRect(0, y, 128, 16);
  }
  for (let i = 0; i < 1600; i++) {
    const t = hash01(i * 1.9);
    const g = Math.round(84 + t * 58);
    ctx.fillStyle = `rgba(${Math.round(g * 0.5)},${g},${Math.round(g * 0.48)},0.85)`;
    ctx.fillRect(hash01(i * 4.3) * 128, hash01(i * 9.7 + 5) * 128, 1, 2 + t * 2);
  }
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = "rgba(96,78,44,0.3)";
    ctx.fillRect(hash01(i * 6.1 + 11) * 128, hash01(i * 2.9 + 7) * 128, 4, 3);
  }
  tex.update();
  tex.wrapU = 1;
  tex.wrapV = 1;
  return tex;
}

const SKY_PX = 256;

interface SkyBand {
  zenith: [number, number, number];
  horizon: [number, number, number];
  /** How much of a disc the sun still cuts, and how warm the glow round it. */
  sun: number;
  stars: number;
}

/**
 * The sky through the day. It used to be one fixed noon gradient painted once
 * at load, so midnight looked exactly like midday from anywhere you could see
 * upwards — the only thing the clock touched was a clear colour the dome was
 * covering up.
 */
const SKY_KEYS: ReadonlyArray<readonly [number, SkyBand]> = [
  [0, { zenith: [10, 12, 28], horizon: [26, 26, 48], sun: 0, stars: 1 }],
  [5, { zenith: [26, 30, 62], horizon: [86, 58, 74], sun: 0.15, stars: 0.5 }],
  [6.5, { zenith: [66, 104, 168], horizon: [232, 150, 96], sun: 0.8, stars: 0 }],
  [9, { zenith: [58, 122, 194], horizon: [166, 202, 224], sun: 1, stars: 0 }],
  [15, { zenith: [54, 118, 192], horizon: [178, 208, 226], sun: 1, stars: 0 }],
  [18.5, { zenith: [72, 92, 158], horizon: [236, 146, 84], sun: 0.9, stars: 0 }],
  [20.5, { zenith: [30, 32, 74], horizon: [146, 72, 78], sun: 0.2, stars: 0.4 }],
  [22, { zenith: [12, 14, 32], horizon: [40, 32, 58], sun: 0, stars: 0.9 }],
  [24, { zenith: [10, 12, 28], horizon: [26, 26, 48], sun: 0, stars: 1 }],
];

/**
 * How high the sun stands, 1 at noon down through 0 at the horizon and
 * negative after dark. Sunrise near 5:30, sunset near 18:30. Everything that
 * depends on the time of day reads this, so the sky, the sun's colour and the
 * moment the windows come on all agree with each other.
 */
export function sunElevation(hour: number): number {
  return Math.sin(((((hour % 24) + 24) % 24) - 5.5) / 13 * Math.PI);
}

function skyBandAt(hour: number): SkyBand {
  const t = ((hour % 24) + 24) % 24;
  let lo = SKY_KEYS[0]!;
  let hi = SKY_KEYS[SKY_KEYS.length - 1]!;
  for (let i = 0; i < SKY_KEYS.length - 1; i++) {
    if (t >= SKY_KEYS[i]![0] && t <= SKY_KEYS[i + 1]![0]) {
      lo = SKY_KEYS[i]!;
      hi = SKY_KEYS[i + 1]!;
      break;
    }
  }
  const span = hi[0] - lo[0];
  const k = span > 0 ? (t - lo[0]) / span : 0;
  const mix = (a: number, b: number): number => a + (b - a) * k;
  const tri = (a: [number, number, number], b: [number, number, number]): [number, number, number] => [
    mix(a[0], b[0]),
    mix(a[1], b[1]),
    mix(a[2], b[2]),
  ];
  return {
    zenith: tri(lo[1].zenith, hi[1].zenith),
    horizon: tri(lo[1].horizon, hi[1].horizon),
    sun: mix(lo[1].sun, hi[1].sun),
    stars: mix(lo[1].stars, hi[1].stars),
  };
}

function rgb(c: [number, number, number]): string {
  return `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;
}

/**
 * Repaints the dome for an hour. The sphere wraps U round the horizon, so
 * placing the sun by hour along U walks it across the sky over the day.
 */
function paintSky(tex: DynamicTexture, hour: number, blackout: boolean): void {
  const ctx = canvas2d(tex.getContext());
  const b = skyBandAt(hour);
  const dim = blackout ? 0.35 : 1;
  const g = ctx.createLinearGradient(0, 0, 0, SKY_PX);
  g.addColorStop(0, rgb([b.zenith[0] * dim, b.zenith[1] * dim, b.zenith[2] * dim]));
  g.addColorStop(0.55, rgb([
    (b.zenith[0] * 0.35 + b.horizon[0] * 0.65) * dim,
    (b.zenith[1] * 0.35 + b.horizon[1] * 0.65) * dim,
    (b.zenith[2] * 0.35 + b.horizon[2] * 0.65) * dim,
  ]));
  g.addColorStop(1, rgb([b.horizon[0] * dim, b.horizon[1] * dim, b.horizon[2] * dim]));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SKY_PX, SKY_PX);

  if (b.stars > 0.02 && !blackout) {
    for (let i = 0; i < 260; i++) {
      const y = hash01(i * 5.1) * SKY_PX * 0.75;
      const a = b.stars * (0.25 + hash01(i * 2.7) * 0.75) * (1 - y / SKY_PX);
      ctx.fillStyle = `rgba(236,240,255,${a.toFixed(3)})`;
      ctx.fillRect(hash01(i * 3.3) * SKY_PX, y, 1, 1);
    }
  }
  if (b.sun > 0.02) {
    // Noon overhead, sunrise and sunset out at the horizon.
    const sx = (((hour - 5.5) / 13) * SKY_PX * 0.5 + SKY_PX * 0.25) % SKY_PX;
    const sy = SKY_PX * (0.8 - Math.max(0, sunElevation(hour)) * 0.62);
    const glow = ctx.createRadialGradient(sx, sy, 2, sx, sy, SKY_PX * 0.34);
    glow.addColorStop(0, `rgba(255,246,214,${(0.95 * b.sun * dim).toFixed(3)})`);
    glow.addColorStop(0.18, `rgba(255,214,150,${(0.4 * b.sun * dim).toFixed(3)})`);
    glow.addColorStop(1, "rgba(255,200,140,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, SKY_PX, SKY_PX);
  }
  // Cloud banks, thinner and higher the further up the dome they sit.
  for (let i = 0; i < 16; i++) {
    const cx = hash01(i * 7.7) * SKY_PX;
    const cy = SKY_PX * (0.12 + hash01(i * 4.1) * 0.6);
    const w = SKY_PX * (0.08 + hash01(i * 2.3) * 0.16);
    const a = (0.05 + hash01(i * 9.3) * 0.13) * (b.sun * 0.7 + 0.3) * dim;
    ctx.fillStyle = `rgba(250,246,240,${a.toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(cx, cy, w, w * 0.22, 0, 0, Math.PI * 2);
    ctx.ellipse(cx + w * 0.6, cy + w * 0.06, w * 0.6, w * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  tex.update();
}

function skyTexture(scene: Scene): DynamicTexture {
  const tex = new DynamicTexture("tex-sky", { width: SKY_PX, height: SKY_PX }, scene, false);
  paintSky(tex, 12, false);
  return tex;
}

/** How far a wall darkens the pavement it stands on, in world units. */
const CONTACT_REACH = 16;

/**
 * A band of ground hugging one face of a building, dark where it meets the
 * wall and clear at its outer edge. This is the ambient darkening that stops
 * a box of a tower looking pasted onto the street: real shadow maps over a
 * city of this many boxes cost more than the whole rest of the frame on the
 * machines this has to run on.
 *
 * The ramp rides in the vertex colours rather than a texture, so it stays the
 * same width whether the wall is one shopfront or a whole block long.
 */
function contactBand(scene: Scene, len: number, cx: number, cz: number, turn: number): Mesh {
  const band = MeshBuilder.CreateGround("ao", { width: len, height: CONTACT_REACH }, scene);
  const pos = band.getVerticesData("position") ?? [];
  const colours = new Float32Array((pos.length / 3) * 4);
  for (let v = 0; v < pos.length / 3; v++) {
    // Local -Z faces the wall once the band is turned into place.
    colours[v * 4 + 3] = pos[v * 3 + 2]! < 0 ? 0.55 : 0;
  }
  band.setVerticesData(VertexBuffer.ColorKind, colours);
  band.hasVertexAlpha = true;
  band.rotation.y = turn;
  band.position = new Vector3(cx, GROUND_Y + 0.14, cz);
  return band;
}

/** A radial falloff, for the pool a street lamp throws on the pavement. */
function glowTexture(scene: Scene): DynamicTexture {
  const px = 64;
  const tex = new DynamicTexture("tex-glow", { width: px, height: px }, scene, false);
  const ctx = canvas2d(tex.getContext());
  ctx.clearRect(0, 0, px, px);
  const g = ctx.createRadialGradient(px / 2, px / 2, 1, px / 2, px / 2, px / 2);
  g.addColorStop(0, "rgba(255,226,168,0.9)");
  g.addColorStop(0.35, "rgba(255,206,132,0.34)");
  g.addColorStop(1, "rgba(255,190,110,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, px, px);
  tex.hasAlpha = true;
  tex.update();
  return tex;
}

/**
 * The street level of a block: shopfronts, awnings, a fire escape and a sign.
 * Everything picks from its own hash of the building's position, because the
 * previous version gave every block on the map the same green awning at the
 * same height over the same strip of blue glass.
 */
function dressBuildingKit(
  scene: Scene,
  disposables: Mesh[],
  id: string,
  cx: number,
  cz: number,
  bw: number,
  bd: number,
  height: number,
  shops: readonly Facade[],
  awnings: readonly StandardMaterial[],
  rail: StandardMaterial,
  neon: StandardMaterial,
): void {
  const seed = cx * 0.031 + cz * 0.017;
  const faces: Array<{ x: number; z: number; rot: number; w: number }> = [
    { x: cx, z: cz + bd / 2 + 1.3, rot: 0, w: Math.max(12, bw - 8) },
    { x: cx, z: cz - bd / 2 - 1.3, rot: Math.PI, w: Math.max(12, bw - 8) },
    { x: cx + bw / 2 + 1.3, z: cz, rot: Math.PI / 2, w: Math.max(12, bd - 8) },
    { x: cx - bw / 2 - 1.3, z: cz, rot: -Math.PI / 2, w: Math.max(12, bd - 8) },
  ];
  const tall = 11 + Math.round(hash01(seed) * 5);
  faces.forEach((f, i) => {
    const shop = shops[Math.floor(hash01(seed + i * 4.3) * shops.length)] ?? shops[0];
    if (!shop) return;
    const bays = Math.max(1, Math.round(f.w / SHOP_BAY));
    const glass = MeshBuilder.CreateBox(`${id}-g${i}`, {
      width: f.w,
      depth: 1.6,
      height: tall,
      faceUV: [
        new Vector4(0, 0, bays, 1),
        new Vector4(0, 0, bays, 1),
        new Vector4(0, 0, 1, 1),
        new Vector4(0, 0, 1, 1),
        new Vector4(0, 0, bays, 1),
        new Vector4(0, 0, bays, 1),
      ],
    }, scene);
    glass.position = new Vector3(f.x, tall / 2 + 0.2, f.z);
    glass.rotation.y = f.rot;
    glass.material = shop.material;
    glass.freezeWorldMatrix();
    disposables.push(glass);
    // Not every frontage has an awning, and the ones that do do not all run
    // the full width of the block.
    if (hash01(seed + i * 9.7 + 2) < 0.62) {
      const span = f.w * (0.4 + hash01(seed + i * 2.9) * 0.52);
      const awn = MeshBuilder.CreateBox(`${id}-a${i}`, { width: span, depth: 7, height: 1.2 }, scene);
      const ox = Math.sin(f.rot) * 4;
      const oz = Math.cos(f.rot) * 4;
      const slide = (f.w - span) * (hash01(seed + i * 5.1) - 0.5);
      awn.position = new Vector3(f.x + ox + Math.cos(f.rot) * slide, tall + 1.6, f.z + oz - Math.sin(f.rot) * slide);
      awn.rotation.y = f.rot;
      awn.material = awnings[Math.floor(hash01(seed + i * 7.7 + 5) * awnings.length)] ?? awnings[0]!;
      awn.freezeWorldMatrix();
      disposables.push(awn);
    }
  });
  // Fire escapes only climb the lower floors; running them the full height of
  // a 340-unit tower put thousands of extra meshes in the scene for detail
  // nobody can see from the street. They also pick a side rather than always
  // hanging off the east wall.
  if (hash01(seed + 11) < 0.7) {
    const east = hash01(seed + 13) < 0.5;
    const stories = Math.max(1, Math.min(7, Math.floor((height - 20) / 16)));
    const ladders: Mesh[] = [];
    for (let s = 0; s < stories; s++) {
      const plat = MeshBuilder.CreateBox(`${id}-fe${s}`, { width: 7, depth: 3.2, height: 0.7 }, scene);
      plat.position = new Vector3(cx + (east ? bw / 2 + 2.2 : -bw / 2 - 2.2), 20 + s * 16, cz);
      ladders.push(plat);
    }
    const escape = Mesh.MergeMeshes(ladders, true, true);
    if (escape) {
      escape.material = rail;
      escape.freezeWorldMatrix();
      disposables.push(escape);
    }
  }
  if (hash01(seed + 17) < 0.55) {
    const sign = MeshBuilder.CreateBox(`${id}-neon`, { width: Math.min(28, bw * 0.45), depth: 1.2, height: 5 }, scene);
    sign.position = new Vector3(cx, Math.min(height - 8, 26 + hash01(seed + 19) * 22), cz + bd / 2 + 1.6);
    sign.material = neon;
    sign.freezeWorldMatrix();
    disposables.push(sign);
  }
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
  // Scaled to the deck's own size: at a fixed repeat count a block-wide roof
  // stretched one tile of concrete across four hundred units and read as
  // painted card, while a small one turned to moire.
  const uw = Math.max(1, Math.round(w / 26));
  const ud = Math.max(1, Math.round(d / 26));
  const flat = new Vector4(0, 0, uw, ud);
  const root = MeshBuilder.CreateBox(`${id}-deck`, {
    width: w,
    depth: d,
    height: 2.4,
    faceUV: [new Vector4(0, 0, uw, 1), new Vector4(0, 0, uw, 1), new Vector4(0, 0, ud, 1), new Vector4(0, 0, ud, 1), flat, flat],
  }, scene);
  root.position = new Vector3(cx, height + 1.2, cz);
  root.material = deck;
  // A block-wide roof with one vent on it still reads as an empty grey sheet,
  // so the clutter scales with the deck: stair huts, plant and water tanks.
  const cols = Math.max(1, Math.min(3, Math.floor(w / 120)));
  const rows = Math.max(1, Math.min(3, Math.floor(d / 120)));
  let n = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ox = cols === 1 ? -w * 0.16 : -w / 2 + (w / (cols + 1)) * (c + 1);
      const oz = rows === 1 ? d * 0.14 : -d / 2 + (d / (rows + 1)) * (r + 1);
      const pick = (c + r + Math.floor(cx / TILE) + Math.floor(cz / TILE)) % 3;
      // Local to the deck: parenting these at world coordinates threw them a
      // thousand units off the building and left specks hanging in the sky.
      if (pick === 0) {
        const hut = MeshBuilder.CreateBox(`${id}-hut${n}`, { width: Math.min(26, w * 0.3), depth: Math.min(20, d * 0.3), height: 16 }, scene);
        hut.position = new Vector3(ox, 9.2, oz);
        hut.material = deck;
        hut.parent = root;
      } else if (pick === 1) {
        const box = MeshBuilder.CreateBox(`${id}-vent${n}`, { width: Math.min(22, w * 0.3), depth: Math.min(16, d * 0.3), height: 9 }, scene);
        box.position = new Vector3(ox, 5.7, oz);
        box.material = vent;
        box.parent = root;
      } else {
        const tank = MeshBuilder.CreateCylinder(`${id}-tank${n}`, { height: 18, diameter: Math.min(22, w * 0.26), tessellation: 10 }, scene);
        tank.position = new Vector3(ox, 10.2, oz);
        tank.material = vent;
        tank.parent = root;
      }
      n++;
    }
  }
  const stack = MeshBuilder.CreateCylinder(`${id}-stack`, { height: 16, diameter: 5.2, tessellation: 8 }, scene);
  stack.position = new Vector3(w * 0.3, 9.2, -d * 0.3);
  stack.material = vent;
  stack.parent = root;
  root.freezeWorldMatrix();
  return root;
}

/**
 * A lip round the edge of a roof, so you can see where one ends before you
 * walk off it. Merged into a single mesh: four boxes per building across the
 * whole city is a thousand extra draws for one low wall.
 */
function parapetRing(scene: Scene, id: string, cx: number, cz: number, bw: number, bd: number, height: number, material: StandardMaterial): Mesh | null {
  const bars: Mesh[] = [];
  const spec: Array<[number, number, number, number]> = [
    [bw, 2.6, 0, bd / 2 - 1.3],
    [bw, 2.6, 0, -bd / 2 + 1.3],
    [2.6, bd, bw / 2 - 1.3, 0],
    [2.6, bd, -bw / 2 + 1.3, 0],
  ];
  spec.forEach(([w, d, ox, oz], i) => {
    const bar = MeshBuilder.CreateBox(`${id}-${i}`, { width: w, depth: d, height: 4 }, scene);
    bar.position = new Vector3(cx + ox, height + 2, cz + oz);
    bars.push(bar);
  });
  const ring = Mesh.MergeMeshes(bars, true, true);
  if (!ring) return null;
  ring.material = material;
  ring.freezeWorldMatrix();
  return ring;
}

/** World units one shop bay covers along a facade. */
const SHOP_BAY = 26;

/**
 * One shop bay, tiling side to side: half a pier at each edge, a fascia over
 * the top and a stall riser under the glass. Scaled to the wall it runs along
 * (see `SHOP_BAY`), a block-long frontage comes out as a row of shops rather
 * than as the single stretched strip of blue glass it used to be.
 */
function storefront(scene: Scene, name: string, glass: string, fascia: string, seed: number): Facade {
  const px = 128;
  const diffuse = new DynamicTexture(`${name}-d`, { width: px, height: px }, scene, true);
  const emissive = new DynamicTexture(`${name}-e`, { width: px, height: px }, scene, true);
  const d = canvas2d(diffuse.getContext());
  const e = canvas2d(emissive.getContext());
  e.fillStyle = "#000000";
  e.fillRect(0, 0, px, px);
  d.fillStyle = "#26201a";
  d.fillRect(0, 0, px, px);
  // Fascia across the top, with the awning's shadow under it.
  d.fillStyle = fascia;
  d.fillRect(0, 6, px, 22);
  d.fillStyle = "rgba(0,0,0,0.45)";
  d.fillRect(0, 28, px, 5);
  e.fillStyle = tint(fascia, 0.2);
  e.fillRect(0, 8, px, 18);
  // Piers: half at each edge so the bay meets its neighbour cleanly.
  const pier = 7;
  const inner = px - pier * 2;
  const glazedH = 74;
  const top = 36;
  if (hash01(seed) < 0.28) {
    // A doorway instead of a window on some bays.
    d.fillStyle = tint(glass, -0.55);
    d.fillRect(pier, top, inner, glazedH);
    d.fillStyle = tint(fascia, -0.4);
    d.fillRect(pier + inner * 0.3, top + 6, inner * 0.4, glazedH - 6);
    e.fillStyle = tint(glass, 0.35);
    e.fillRect(pier + inner * 0.3, top + 6, inner * 0.4, glazedH - 6);
  } else {
    const g = d.createLinearGradient(pier, top, pier + inner * 0.5, top + glazedH);
    g.addColorStop(0, tint(glass, 0.3));
    g.addColorStop(0.6, tint(glass, -0.3));
    g.addColorStop(1, tint(glass, 0.05));
    d.fillStyle = g;
    d.fillRect(pier, top, inner, glazedH);
    // Stall riser and a mullion, so the glass has a frame round it.
    d.fillStyle = "#1d1814";
    d.fillRect(pier, top + glazedH - 12, inner, 12);
    d.fillRect(pier + inner / 2 - 1, top, 2, glazedH - 12);
    e.fillStyle = tint(glass, 0.4);
    e.fillRect(pier + 2, top + 2, inner - 4, glazedH - 16);
    e.fillStyle = "rgba(0,0,0,0.5)";
    e.fillRect(pier + inner / 2 - 1, top, 2, glazedH - 12);
  }
  d.fillStyle = "#332a22";
  d.fillRect(0, top, pier, glazedH);
  d.fillRect(px - pier, top, pier, glazedH);
  grain(d, 90, 0.05, seed + 3, px);
  for (const t of [diffuse, emissive]) {
    t.hasAlpha = false;
    t.update();
    t.wrapU = 1;
    t.wrapV = 1;
  }
  const material = new StandardMaterial(name, scene);
  material.diffuseColor = new Color3(1, 1, 1);
  material.specularColor = new Color3(0.08, 0.08, 0.09);
  material.diffuseTexture = diffuse;
  material.emissiveTexture = emissive;
  material.emissiveColor = new Color3(0.35, 0.33, 0.3);
  return { diffuse, emissive, material };
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

/**
 * The city's wall palette. Southside is old warehouse brick and deco render
 * at street level with newer glass behind it, so the mix leans that way.
 */
const FACADE_STYLES: readonly FacadeStyle[] = [
  { kind: "brick", wall: "#6b4436", trim: "#c9b39a", glass: "#4a5f6e", lit: "#ffcf82" },
  { kind: "brick", wall: "#7d5a44", trim: "#d8c4a8", glass: "#3f5866", lit: "#ffbe6a" },
  { kind: "brick", wall: "#54453f", trim: "#a89684", glass: "#44596a", lit: "#ffd79a" },
  { kind: "stucco", wall: "#d9c3a4", trim: "#f4ece0", glass: "#4e6f80", lit: "#ffe3ae" },
  { kind: "stucco", wall: "#c9a68f", trim: "#f6e6d6", glass: "#42606f", lit: "#ffd0a0" },
  { kind: "stucco", wall: "#a8c2bd", trim: "#eef6f3", glass: "#3d5d6b", lit: "#cfe6ff" },
  { kind: "office", wall: "#8d8a82", trim: "#b4b0a6", glass: "#3a5566", lit: "#e6f0ff" },
  { kind: "curtain", wall: "#2f4450", trim: "#26333c", glass: "#4b7285", lit: "#dbeaff" },
] as const;

export function buildCity(scene: Scene, world: WorldData, kit: TextureKit): CityMeshes {
  const disposables: Mesh[] = [];
  const textures: DynamicTexture[] = [];
  /** Footprints wanting a contact shadow, and lamps wanting a light pool. */
  const grounded: Array<[number, number, number, number]> = [];
  const lamps: Array<[number, number]> = [];
  /** Neon and signage, with the glow it burns after dark. */
  const glowing: Array<[StandardMaterial, Color3]> = [];
  const landmarkTops = new Map<string, number>();
  const tops = new Float32Array(MAP_W * MAP_H);

  const dirt = dirtTexture(scene);
  textures.push(dirt);
  // Open sea out to the horizon. The land used to stop dead at the last tile,
  // so anyone who reached an edge saw the inside of the sky dome cutting a
  // diagonal through the street; Southside is a waterfront district, so what
  // lies beyond it is the bay.
  const seaMat = mat(scene, "m-sea", "#20505e", 0.06);
  seaMat.specularColor = new Color3(0.3, 0.34, 0.36);
  seaMat.specularPower = 48;
  const sea = MeshBuilder.CreateGround("sea", { width: MAP_W * TILE * 8, height: MAP_H * TILE * 8 }, scene);
  sea.position = new Vector3((MAP_W * TILE) / 2, GROUND_Y - 2.4, (MAP_H * TILE) / 2);
  sea.material = seaMat;
  sea.isPickable = false;
  sea.freezeWorldMatrix();
  disposables.push(sea);

  const ground = MeshBuilder.CreateGround("ground", { width: MAP_W * TILE, height: MAP_H * TILE }, scene);
  ground.position = new Vector3((MAP_W * TILE) / 2, GROUND_Y, (MAP_H * TILE) / 2);
  ground.isPickable = false;
  const groundMat = mat(scene, "m-ground", "#ffffff");
  groundMat.diffuseTexture = dirt;
  (dirt as Texture).uScale = MAP_W / 2;
  (dirt as Texture).vScale = MAP_H / 2;
  ground.material = groundMat;
  disposables.push(ground);

  const asph = asphaltTexture(scene);
  const walk = walkTexture(scene);
  const grass = grassTexture(scene);
  textures.push(asph, walk, grass);
  const roadMat = mat(scene, "m-road", "#ffffff");
  roadMat.diffuseTexture = asph;
  const walkMat = mat(scene, "m-walk", "#ffffff");
  walkMat.diffuseTexture = walk;
  const grassMat = mat(scene, "m-grass", "#ffffff");
  grassMat.diffuseTexture = grass;
  /** World units one repeat of each surface covers. */
  const stripScale: Record<number, number> = {
    [Cell.Road]: TILE,
    [Cell.Walk]: TILE * 0.75,
    [Cell.Grass]: TILE,
    [Cell.Alley]: TILE,
    [Cell.Court]: TILE,
    [Cell.Sand]: TILE * 2,
    [Cell.Dock]: TILE,
    [Cell.Water]: TILE * 3,
  };
  const stripMats: Record<number, StandardMaterial> = {
    [Cell.Road]: roadMat,
    [Cell.Walk]: walkMat,
    [Cell.Grass]: grassMat,
    [Cell.Water]: kit.material("glass", "#1e5a68", 0.28),
    [Cell.Sand]: kit.material("concrete", "#d4b078"),
    // Alleys and courts used to be so dark they read as holes cut in the
    // block rather than as ground you can walk down.
    [Cell.Alley]: kit.material("concrete", "#4c443c"),
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
        stripUV(strip, w, TILE, stripScale[runCell] ?? TILE);
        strip.freezeWorldMatrix();
        disposables.push(strip);
        runStart = isStrip ? x : -1;
        runCell = c;
      }
    }
  }

  // Road markings. A single hairline down the middle of a black strip was the
  // only thing telling you a road was a road; a double centre line with dashed
  // lanes either side is what actually reads as tarmac from head height. All
  // the dashes of one colour merge into a single mesh — one per colour for the
  // whole city rather than a draw call per stripe.
  // Road paint, not light fittings: the emissive these carried put them a
  // clear step brighter than anything can be under a midday sun.
  const yellowMat = mat(scene, "m-line-y", "#a08131");
  const whiteMat = mat(scene, "m-line-w", "#9d9a90");
  const solids: Mesh[] = [];
  const dashes: Mesh[] = [];
  const dash = (x: number, z: number, w: number, d: number): void => {
    const m = MeshBuilder.CreateBox("dash", { width: w, depth: d, height: 0.3 }, scene);
    m.position = new Vector3(x, 0.22, z);
    dashes.push(m);
  };
  const HALF = TILE * 1.5;
  for (const yTile of [10, 22, 36, 50, 64]) {
    const cz = (yTile + 1.5) * TILE;
    for (const off of [-1.4, 1.4]) {
      const line = MeshBuilder.CreateBox("solid", { width: MAP_W * TILE, depth: 1.2, height: 0.3 }, scene);
      line.position = new Vector3((MAP_W * TILE) / 2, 0.22, cz + off);
      solids.push(line);
    }
    for (let x = TILE; x < MAP_W * TILE; x += 26) {
      dash(x, cz - HALF * 0.55, 13, 1.2);
      dash(x, cz + HALF * 0.55, 13, 1.2);
    }
  }
  for (const xTile of [8, 22, 36, 50, 64, 80]) {
    const cx = (xTile + 1.5) * TILE;
    for (const off of [-1.4, 1.4]) {
      const line = MeshBuilder.CreateBox("solid", { width: 1.2, depth: MAP_H * TILE, height: 0.3 }, scene);
      line.position = new Vector3(cx + off, 0.22, (MAP_H * TILE) / 2);
      solids.push(line);
    }
    for (let z = TILE; z < MAP_H * TILE; z += 26) {
      dash(cx - HALF * 0.55, z, 1.2, 13);
      dash(cx + HALF * 0.55, z, 1.2, 13);
    }
  }
  const centre = Mesh.MergeMeshes(solids, true, true);
  if (centre) {
    centre.material = yellowMat;
    centre.freezeWorldMatrix();
    disposables.push(centre);
  }
  const lanes = Mesh.MergeMeshes(dashes, true, true);
  if (lanes) {
    lanes.material = whiteMat;
    lanes.freezeWorldMatrix();
    disposables.push(lanes);
  }

  // Kerbs. Without a lip where the pavement meets the road the two surfaces
  // sit in the same plane and the street reads as a painted floor. One merged
  // mesh per axis keeps the whole city's kerbing down to two draws.
  const kerbMat = mat(scene, "m-kerb", "#6e675d");
  const kerbs: Mesh[] = [];
  const kerbAt = (x: number, z: number, w: number, d: number): void => {
    const m = MeshBuilder.CreateBox("kerb", { width: w, depth: d, height: 2.2 }, scene);
    m.position = new Vector3(x, GROUND_Y + 1.1, z);
    kerbs.push(m);
  };
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if ((world.cells[y * MAP_W + x] as Cell) !== Cell.Walk) continue;
      const px = x * TILE + TILE / 2;
      const pz = y * TILE + TILE / 2;
      const road = (i: number, j: number): boolean =>
        i >= 0 && j >= 0 && i < MAP_W && j < MAP_H && (world.cells[j * MAP_W + i] as Cell) === Cell.Road;
      if (road(x, y + 1)) kerbAt(px, pz + TILE / 2 - 0.7, TILE, 1.4);
      if (road(x, y - 1)) kerbAt(px, pz - TILE / 2 + 0.7, TILE, 1.4);
      if (road(x + 1, y)) kerbAt(px + TILE / 2 - 0.7, pz, 1.4, TILE);
      if (road(x - 1, y)) kerbAt(px - TILE / 2 + 0.7, pz, 1.4, TILE);
    }
  }
  const kerbRing = Mesh.MergeMeshes(kerbs, true, true);
  if (kerbRing) {
    kerbRing.material = kerbMat;
    kerbRing.freezeWorldMatrix();
    disposables.push(kerbRing);
  }

  // Eight walls for the whole city. Enough that no two neighbours match, few
  // enough that the block still draws in a handful of material switches.
  const facades = FACADE_STYLES.map((s, i) => facade(scene, `m-facade-${i}`, s, i * 17 + 3));
  for (const f of facades) textures.push(f.diffuse, f.emissive);

  // Two deck tones so a skyline of roofs is not one flat sheet of grey. The
  // texture has to repeat, or one block-wide roof stretches a single tile of
  // concrete across four hundred units and reads as painted card.
  const roofMats = [kit.material("concrete", "#6d6659"), kit.material("concrete", "#7c7264")];
  for (const m of roofMats) {
    const tex = m.diffuseTexture as Texture | null;
    if (tex) {
      tex.uScale = 1;
      tex.vScale = 1;
      tex.wrapU = 1;
      tex.wrapV = 1;
    }
  }
  const ventMat = mat(scene, "m-vent", "#67615a");
  const parapetMat = mat(scene, "m-parapet", "#6c645a");

  const seen = new Uint8Array(MAP_W * MAP_H);
  const landmarkArea = new Set<number>();
  for (const lm of world.landmarks) {
    for (let j = lm.y; j < lm.y + lm.h; j++) {
      for (let i = lm.x; i < lm.x + lm.w; i++) landmarkArea.add(j * MAP_W + i);
    }
  }

  const acMat = kit.material("metal", "#5a5854");
  const shops = [
    storefront(scene, "m-shop-a", "#3a6078", "#8a3428", 1),
    storefront(scene, "m-shop-b", "#784838", "#2c5a62", 7),
    storefront(scene, "m-shop-c", "#2a5a48", "#b07a24", 13),
    storefront(scene, "m-shop-d", "#4a4258", "#3a5a34", 21),
    storefront(scene, "m-shop-e", "#6a5a3a", "#6a2a4a", 29),
  ] as const;
  for (const s of shops) {
    textures.push(s.diffuse, s.emissive);
    glowing.push([s.material, s.material.emissiveColor.clone()]);
  }
  const awningCols = [
    kit.material("canvas", "#c45a32"),
    kit.material("canvas", "#2a6a78"),
    kit.material("canvas", "#d8a030"),
    kit.material("canvas", "#7a3a52"),
    kit.material("canvas", "#4a6a3a"),
  ];
  const railMat = kit.material("metal", "#2a2622");
  const neonMats = [
    mat(scene, "m-neon-a", "#e07040", 0.7),
    mat(scene, "m-neon-b", "#40c0d0", 0.7),
    mat(scene, "m-neon-c", "#e8c050", 0.7),
  ];
  for (const m of neonMats) glowing.push([m, m.emissiveColor.clone()]);
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
      // A skyline you can swing through, and one that is not a comb. Five
      // fixed heights left every roof line at the same handful of altitudes;
      // rounding a continuous hash to whole floors keeps the variety while
      // still landing on a storey boundary, so the facade never wraps
      // mid-window.
      const r = hash01(x * 31.7 + y * 17.3);
      const floors = 7 + Math.floor(r * r * 26);
      const height = floors * 12;
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) tops[(y + j) * MAP_W + x + i] = height;
      const bw = w * TILE - 4;
      const bd = h * TILE - 4;
      const cx = x * TILE + (w * TILE) / 2;
      const cz = y * TILE + (h * TILE) / 2;
      const style = facades[Math.floor(hash01(x * 5.9 + y * 43.1) * facades.length)] ?? facades[0];
      grounded.push([cx, cz, bw, bd]);
      const box = MeshBuilder.CreateBox(`b-${x}-${y}`, { width: bw, depth: bd, height, faceUV: facadeUV(bw, bd, height) }, scene);
      box.position = new Vector3(cx, height / 2, cz);
      box.material = style.material;
      box.freezeWorldMatrix();
      disposables.push(box);
      // Tall blocks step back near the top. A tower that is one extruded
      // rectangle from pavement to roof is the thing that makes a procedural
      // skyline look procedural.
      let top = height;
      let tw = bw;
      let td = bd;
      if (floors > 20 && Math.min(bw, bd) > 44) {
        const setFloors = 3 + Math.floor(hash01(x * 9.1 + y * 3.7) * 5);
        tw = bw * 0.66;
        td = bd * 0.66;
        top = height + setFloors * 12;
        const cap = MeshBuilder.CreateBox(`bt-${x}-${y}`, { width: tw, depth: td, height: setFloors * 12, faceUV: facadeUV(tw, td, setFloors * 12) }, scene);
        cap.position = new Vector3(cx, height + (setFloors * 12) / 2, cz);
        cap.material = style.material;
        cap.freezeWorldMatrix();
        disposables.push(cap);
        const skirt = parapetRing(scene, `bs-${x}-${y}`, cx, cz, bw, bd, height, parapetMat);
        if (skirt) disposables.push(skirt);
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) tops[(y + j) * MAP_W + x + i] = top;
      }
      disposables.push(roofDeck(scene, `b-${x}-${y}`, cx, cz, tw - 3, td - 3, top, roofMats[(x + y) % 2] ?? roofMats[0], ventMat));
      const parapet = parapetRing(scene, `bp-${x}-${y}`, cx, cz, tw, td, top, parapetMat);
      if (parapet) disposables.push(parapet);
      const kit = (x + y) % 3;
      dressBuildingKit(scene, disposables, `b-${x}-${y}`, cx, cz, bw, bd, height, shops, awningCols, railMat, neonMats[kit] ?? neonMats[0]!);
      if (((x + y) & 3) === 0) {
        const ac = MeshBuilder.CreateBox(`ac-${x}-${y}`, { width: 10, depth: 14, height: 6 }, scene);
        ac.position = new Vector3(cx + 8, top + 3, cz);
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
    // Landmarks keep their own colour so they stay findable from a street
    // away, but they wear the same tiled facade as the rest of the block —
    // stretching one image over a whole tower is what turned them into
    // stacks of coloured bars.
    // The banding takes a washed-out version of the wall, not the sign colour:
    // painting deco stripes in full neon turned each landmark into a stack of
    // bright bars visible from the far side of the map.
    const lmFace = facade(
      scene,
      `m-lm-${lm.id}`,
      { kind: "stucco", wall: landmarkColor(lm.kind), trim: tint(landmarkColor(lm.kind), 0.4), glass: "#3d5a6a", lit: trimColor(lm.kind) },
      lm.x * 13 + lm.y * 7,
    );
    textures.push(lmFace.diffuse, lmFace.emissive);
    facades.push(lmFace);
    const lbw = lm.w * TILE - 6;
    const lbd = lm.h * TILE - 6;
    const box = MeshBuilder.CreateBox(`lm-${lm.id}`, { width: lbw, depth: lbd, height, faceUV: facadeUV(lbw, lbd, height) }, scene);
    box.position = new Vector3(lm.x * TILE + (lm.w * TILE) / 2, height / 2, lm.y * TILE + (lm.h * TILE) / 2);
    box.material = lmFace.material;
    grounded.push([box.position.x, box.position.z, lbw, lbd]);
    box.freezeWorldMatrix();
    disposables.push(box);

    // The neon used to be a lit slab covering the whole footprint, which from
    // above turned every landmark into a flat sheet of glowing colour. It is a
    // band round the parapet now, with a real roof inside it.
    const lw = lm.w * TILE - 6;
    const ld = lm.h * TILE - 6;
    const trimMat = mat(scene, `mt-${lm.id}`, trimColor(lm.kind), 0.55);
    glowing.push([trimMat, trimMat.emissiveColor.clone()]);
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
    disposables.push(roofDeck(scene, `lr-${lm.id}`, box.position.x, box.position.z, lw - 6, ld - 6, height, roofMats[0], ventMat));

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
      shops,
      awningCols,
      railMat,
      neonMats[0]!,
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
  dressCityStreets(scene, kit, world, disposables, lampMat, lampHead, binMat, hydrantMat, benchMat, curbMat, lamps);

  // Contact shadows and lamp pools, each merged into a single mesh. Both are
  // transparent decals laid on the ground: a draw call apiece is affordable,
  // several hundred is not.
  const contactMat = new StandardMaterial("m-contact", scene);
  contactMat.diffuseColor = Color3.Black();
  contactMat.specularColor = Color3.Black();
  contactMat.emissiveColor = Color3.Black();
  contactMat.disableLighting = true;
  contactMat.backFaceCulling = false;
  const patches: Mesh[] = [];
  const R = CONTACT_REACH;
  for (const [cx, cz, w, d] of grounded) {
    patches.push(contactBand(scene, w + R * 2, cx, cz + d / 2 + R / 2, 0));
    patches.push(contactBand(scene, w + R * 2, cx, cz - d / 2 - R / 2, Math.PI));
    patches.push(contactBand(scene, d + R * 2, cx + w / 2 + R / 2, cz, Math.PI / 2));
    patches.push(contactBand(scene, d + R * 2, cx - w / 2 - R / 2, cz, -Math.PI / 2));
  }
  const contact = patches.length > 0 ? Mesh.MergeMeshes(patches, true, true) : null;
  if (contact) {
    contact.material = contactMat;
    contact.hasVertexAlpha = true;
    contact.isPickable = false;
    contact.freezeWorldMatrix();
    disposables.push(contact);
  }

  const glowTex = glowTexture(scene);
  textures.push(glowTex);
  const poolMat = new StandardMaterial("m-pool", scene);
  poolMat.emissiveTexture = glowTex;
  poolMat.opacityTexture = glowTex;
  poolMat.diffuseColor = Color3.Black();
  poolMat.specularColor = Color3.Black();
  poolMat.emissiveColor = new Color3(1, 0.9, 0.72);
  poolMat.disableLighting = true;
  poolMat.backFaceCulling = false;
  poolMat.alpha = 0;
  const poolQuads: Mesh[] = [];
  for (const [lx, lz] of lamps) {
    const q = MeshBuilder.CreateGround("pool", { width: 46, height: 46 }, scene);
    q.position = new Vector3(lx, GROUND_Y + 0.3, lz);
    poolQuads.push(q);
  }
  const pools = poolQuads.length > 0 ? Mesh.MergeMeshes(poolQuads, true, true) : null;
  if (pools) {
    pools.material = poolMat;
    pools.isPickable = false;
    pools.freezeWorldMatrix();
    disposables.push(pools);
  }

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
  let paintedHour = 12;
  let paintedBlackout = false;
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
    setNight: (k: number) => {
      const lit = Math.max(0, Math.min(1, k));
      for (const f of facades) f.material.emissiveColor.set(lit, lit * 0.94, lit * 0.86);
      // Neon still reads in daylight, just as a painted sign rather than a lamp.
      const glow = 0.3 + lit * 0.7;
      for (const [m, base] of glowing) m.emissiveColor.copyFrom(base).scaleInPlace(glow);
      poolMat.alpha = lit * 0.85;
      if (pools) pools.setEnabled(lit > 0.02);
    },
    setHour: (hour, blackout) => {
      if (Math.abs(hour - paintedHour) > 0.12 || blackout !== paintedBlackout) {
        paintedHour = hour;
        paintedBlackout = blackout;
        paintSky(skyTex, hour, blackout);
      }
      const b = skyBandAt(hour);
      const dim = blackout ? 0.35 : 1;
      return new Color3((b.horizon[0] / 255) * dim, (b.horizon[1] / 255) * dim, (b.horizon[2] / 255) * dim);
    },
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
  lamps: Array<[number, number]>,
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
        lamps.push([px + 8, pz]);
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
