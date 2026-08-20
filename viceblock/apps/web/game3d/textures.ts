import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import type { Scene } from "@babylonjs/core/scene";

/**
 * Every prop in Southside used to be a flat-colour box. These painters give
 * each material family a woven, brushed, or grained surface so a car reads as
 * painted steel and a jacket reads as cloth at street distance.
 */
export type Surface =
  | "cloth"
  | "denim"
  | "skin"
  | "hair"
  | "leather"
  | "metal"
  | "rubber"
  | "carPaint"
  | "glass"
  | "wood"
  | "concrete"
  | "plaster"
  | "canvas"
  | "bark"
  | "foliage"
  | "plastic";

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function parse(hex: string): Rgb {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function clamp(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

/** amt > 0 lightens, amt < 0 darkens, in absolute 0-255 steps. */
function shade(base: Rgb, amt: number, alpha = 1): string {
  const r = clamp(base.r + amt);
  const g = clamp(base.g + amt);
  const b = clamp(base.b + amt);
  return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`;
}

const SIZE = 128;

function paintCloth(ctx: CanvasRenderingContext2D, c: Rgb): void {
  ctx.fillStyle = shade(c, 0);
  ctx.fillRect(0, 0, SIZE, SIZE);
  // Woven threads: alternating warp and weft so the fabric catches light.
  for (let i = 0; i < SIZE; i += 3) {
    ctx.fillStyle = shade(c, 9, 0.5);
    ctx.fillRect(i, 0, 1, SIZE);
    ctx.fillStyle = shade(c, -11, 0.5);
    ctx.fillRect(0, i + 1, SIZE, 1);
  }
  ctx.fillStyle = shade(c, -26, 0.75);
  ctx.fillRect(62, 0, 3, SIZE);
  ctx.fillStyle = shade(c, 16, 0.45);
  ctx.fillRect(0, 20, SIZE, 2);
}

function paintDenim(ctx: CanvasRenderingContext2D, c: Rgb): void {
  ctx.fillStyle = shade(c, 0);
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.strokeStyle = shade(c, 20, 0.35);
  ctx.lineWidth = 1;
  for (let i = -SIZE; i < SIZE; i += 4) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + SIZE, SIZE);
    ctx.stroke();
  }
  ctx.fillStyle = shade(c, -30);
  ctx.fillRect(60, 0, 4, SIZE);
  // Contrast stitching down the seam.
  ctx.fillStyle = "rgba(226,196,140,0.7)";
  for (let y = 0; y < SIZE; y += 8) ctx.fillRect(58, y, 2, 4);
}

function paintSkin(ctx: CanvasRenderingContext2D, c: Rgb): void {
  ctx.fillStyle = shade(c, 0);
  ctx.fillRect(0, 0, SIZE, SIZE);
  for (let i = 0; i < 420; i++) {
    ctx.fillStyle = shade(c, i % 3 === 0 ? 7 : -6, 0.35);
    ctx.fillRect((i * 29) % SIZE, (i * 47) % SIZE, 2, 2);
  }
}

function paintHair(ctx: CanvasRenderingContext2D, c: Rgb): void {
  ctx.fillStyle = shade(c, 0);
  ctx.fillRect(0, 0, SIZE, SIZE);
  for (let i = 0; i < SIZE; i += 2) {
    ctx.fillStyle = shade(c, (i % 6 === 0 ? 26 : -8) * 0.9, 0.6);
    ctx.fillRect(i, 0, 1, SIZE);
  }
}

function paintLeather(ctx: CanvasRenderingContext2D, c: Rgb): void {
  ctx.fillStyle = shade(c, 0);
  ctx.fillRect(0, 0, SIZE, SIZE);
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = shade(c, i % 2 ? 14 : -12, 0.45);
    ctx.fillRect((i * 37) % SIZE, (i * 23) % SIZE, 3, 3);
  }
  ctx.fillStyle = shade(c, 22, 0.35);
  ctx.fillRect(0, 96, SIZE, 3);
}

function paintMetal(ctx: CanvasRenderingContext2D, c: Rgb): void {
  ctx.fillStyle = shade(c, 0);
  ctx.fillRect(0, 0, SIZE, SIZE);
  // Brushed streaks plus a rivet line down each panel edge.
  for (let i = 0; i < SIZE; i += 2) {
    ctx.fillStyle = shade(c, ((i * 13) % 9) - 4, 0.6);
    ctx.fillRect(0, i, SIZE, 1);
  }
  ctx.fillStyle = shade(c, -34);
  ctx.fillRect(30, 0, 2, SIZE);
  ctx.fillRect(96, 0, 2, SIZE);
  ctx.fillStyle = shade(c, 30);
  for (let y = 8; y < SIZE; y += 20) {
    ctx.fillRect(28, y, 3, 3);
    ctx.fillRect(94, y, 3, 3);
  }
}

function paintRubber(ctx: CanvasRenderingContext2D, c: Rgb): void {
  ctx.fillStyle = shade(c, 0);
  ctx.fillRect(0, 0, SIZE, SIZE);
  for (let i = 0; i < 300; i++) {
    ctx.fillStyle = shade(c, i % 2 ? 8 : -5, 0.4);
    ctx.fillRect((i * 41) % SIZE, (i * 17) % SIZE, 2, 2);
  }
  // Tread blocks.
  ctx.fillStyle = shade(c, -18);
  for (let y = 0; y < SIZE; y += 12) ctx.fillRect(0, y, SIZE, 5);
  ctx.fillStyle = shade(c, 16, 0.5);
  for (let y = 6; y < SIZE; y += 12) ctx.fillRect(20, y, 12, 3);
}

function paintCarPaint(ctx: CanvasRenderingContext2D, c: Rgb): void {
  const g = ctx.createLinearGradient(0, 0, 0, SIZE);
  g.addColorStop(0, shade(c, 34));
  g.addColorStop(0.45, shade(c, 4));
  g.addColorStop(0.75, shade(c, -14));
  g.addColorStop(1, shade(c, -30));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SIZE, SIZE);
  // Panel gaps and a specular sweep along the shoulder line.
  ctx.fillStyle = shade(c, -46, 0.8);
  ctx.fillRect(42, 0, 2, SIZE);
  ctx.fillRect(90, 0, 2, SIZE);
  ctx.fillStyle = "rgba(255,255,255,0.16)";
  ctx.fillRect(0, 26, SIZE, 6);
  ctx.fillStyle = "rgba(0,0,0,0.14)";
  ctx.fillRect(0, 104, SIZE, 10);
}

function paintGlass(ctx: CanvasRenderingContext2D, c: Rgb): void {
  ctx.fillStyle = shade(c, 0);
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = "rgba(190,220,240,0.30)";
  ctx.fillRect(0, 0, SIZE, 40);
  ctx.fillStyle = "rgba(255,255,255,0.20)";
  ctx.beginPath();
  ctx.moveTo(10, SIZE);
  ctx.lineTo(64, 0);
  ctx.lineTo(88, 0);
  ctx.lineTo(34, SIZE);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = shade(c, -40);
  ctx.fillRect(0, SIZE - 10, SIZE, 10);
}

function paintWood(ctx: CanvasRenderingContext2D, c: Rgb): void {
  ctx.fillStyle = shade(c, 0);
  ctx.fillRect(0, 0, SIZE, SIZE);
  for (let p = 0; p < SIZE; p += 32) {
    ctx.fillStyle = shade(c, -28);
    ctx.fillRect(0, p, SIZE, 2);
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = shade(c, i % 2 ? 15 : -12, 0.4);
      ctx.fillRect((i * 23) % SIZE, p + 4 + (i % 24), 22, 1);
    }
  }
}

function paintConcrete(ctx: CanvasRenderingContext2D, c: Rgb): void {
  ctx.fillStyle = shade(c, 0);
  ctx.fillRect(0, 0, SIZE, SIZE);
  for (let i = 0; i < 520; i++) {
    ctx.fillStyle = shade(c, ((i * 7) % 17) - 8, 0.4);
    ctx.fillRect((i * 31) % SIZE, (i * 53) % SIZE, 2, 2);
  }
  ctx.fillStyle = shade(c, -22, 0.6);
  ctx.fillRect(0, 63, SIZE, 2);
  ctx.fillRect(63, 0, 2, SIZE);
}

function paintPlaster(ctx: CanvasRenderingContext2D, c: Rgb): void {
  ctx.fillStyle = shade(c, 0);
  ctx.fillRect(0, 0, SIZE, SIZE);
  for (let i = 0; i < 180; i++) {
    ctx.fillStyle = shade(c, i % 2 ? 12 : -10, 0.28);
    const s = 6 + (i % 9);
    ctx.fillRect((i * 43) % SIZE, (i * 61) % SIZE, s, s);
  }
  // Water staining near the bottom of the wall.
  ctx.fillStyle = shade(c, -24, 0.35);
  ctx.fillRect(0, SIZE - 22, SIZE, 22);
}

function paintCanvas(ctx: CanvasRenderingContext2D, c: Rgb): void {
  for (let i = 0; i < SIZE; i += 16) {
    ctx.fillStyle = (i / 16) % 2 === 0 ? shade(c, 0) : "#efe3d2";
    ctx.fillRect(i, 0, 16, SIZE);
  }
  ctx.fillStyle = "rgba(0,0,0,0.16)";
  ctx.fillRect(0, SIZE - 12, SIZE, 12);
}

function paintBark(ctx: CanvasRenderingContext2D, c: Rgb): void {
  ctx.fillStyle = shade(c, 0);
  ctx.fillRect(0, 0, SIZE, SIZE);
  for (let y = 0; y < SIZE; y += 9) {
    ctx.fillStyle = shade(c, -24, 0.7);
    ctx.fillRect(0, y, SIZE, 3);
    ctx.fillStyle = shade(c, 18, 0.5);
    ctx.fillRect(0, y + 4, SIZE, 1);
  }
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = shade(c, -14, 0.5);
    ctx.fillRect((i * 37) % SIZE, (i * 19) % SIZE, 4, 8);
  }
}

function paintFoliage(ctx: CanvasRenderingContext2D, c: Rgb): void {
  ctx.fillStyle = shade(c, -14);
  ctx.fillRect(0, 0, SIZE, SIZE);
  for (let i = 0; i < 220; i++) {
    ctx.fillStyle = shade(c, i % 3 === 0 ? 26 : i % 3 === 1 ? 6 : -18, 0.75);
    const x = (i * 29) % SIZE;
    const y = (i * 43) % SIZE;
    ctx.fillRect(x, y, 9, 3);
  }
}

function paintPlastic(ctx: CanvasRenderingContext2D, c: Rgb): void {
  const g = ctx.createLinearGradient(0, 0, SIZE, SIZE);
  g.addColorStop(0, shade(c, 24));
  g.addColorStop(1, shade(c, -18));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.fillRect(0, 40, SIZE, 8);
  ctx.fillRect(0, 84, SIZE, 5);
}

function paint(kind: Surface, ctx: CanvasRenderingContext2D, c: Rgb): void {
  switch (kind) {
    case "cloth":
      return paintCloth(ctx, c);
    case "denim":
      return paintDenim(ctx, c);
    case "skin":
      return paintSkin(ctx, c);
    case "hair":
      return paintHair(ctx, c);
    case "leather":
      return paintLeather(ctx, c);
    case "metal":
      return paintMetal(ctx, c);
    case "rubber":
      return paintRubber(ctx, c);
    case "carPaint":
      return paintCarPaint(ctx, c);
    case "glass":
      return paintGlass(ctx, c);
    case "wood":
      return paintWood(ctx, c);
    case "concrete":
      return paintConcrete(ctx, c);
    case "plaster":
      return paintPlaster(ctx, c);
    case "canvas":
      return paintCanvas(ctx, c);
    case "bark":
      return paintBark(ctx, c);
    case "foliage":
      return paintFoliage(ctx, c);
    case "plastic":
      return paintPlastic(ctx, c);
    default: {
      const _n: never = kind;
      return _n;
    }
  }
}

/** Specular strength per family: steel and glass shine, cloth and bark do not. */
function specular(kind: Surface): number {
  switch (kind) {
    case "carPaint":
      return 0.42;
    case "glass":
      return 0.55;
    case "metal":
      return 0.3;
    case "plastic":
      return 0.24;
    case "leather":
      return 0.12;
    case "cloth":
    case "denim":
    case "skin":
    case "hair":
    case "rubber":
    case "wood":
    case "concrete":
    case "plaster":
    case "canvas":
    case "bark":
    case "foliage":
      return 0.04;
    default: {
      const _n: never = kind;
      return _n;
    }
  }
}

/** Procedural surface materials, cached so a crowd shares one cloth texture. */
export class TextureKit {
  private scene: Scene;
  private cache = new Map<string, StandardMaterial>();
  private textures: DynamicTexture[] = [];

  constructor(scene: Scene) {
    this.scene = scene;
  }

  material(kind: Surface, hex: string, emissive = 0): StandardMaterial {
    const key = `${kind}-${hex}-${emissive}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const tex = new DynamicTexture(`tx-${key}`, { width: SIZE, height: SIZE }, this.scene, false);
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    paint(kind, ctx, parse(hex));
    tex.hasAlpha = false;
    tex.update();
    tex.wrapU = 1;
    tex.wrapV = 1;
    this.textures.push(tex);
    const m = new StandardMaterial(`mx-${key}`, this.scene);
    m.diffuseTexture = tex;
    const spec = specular(kind);
    m.specularColor = new Color3(spec, spec, spec);
    m.specularPower = kind === "carPaint" || kind === "glass" ? 48 : 12;
    if (emissive > 0) {
      m.emissiveTexture = tex;
      m.emissiveColor = Color3.FromHexString(hex).scale(emissive);
    }
    this.cache.set(key, m);
    return m;
  }

  dispose(): void {
    for (const t of this.textures) t.dispose();
    for (const m of this.cache.values()) m.dispose();
    this.textures = [];
    this.cache.clear();
  }
}
