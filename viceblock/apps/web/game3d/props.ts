import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { TextureKit } from "./textures";

/**
 * Street furniture, built out of parts and merged.
 *
 * Southside puts several hundred bins, benches, hydrants and lamps on its
 * pavements, and each one used to be a single flat-coloured box costing its
 * own draw call. Batching by material inverts that trade: every piece here is
 * six or eight boxes, and the whole city's worth of them still draws in about
 * a dozen calls, because pieces sharing a material are welded into one mesh
 * before anything renders.
 *
 * The cost is that nothing in a batch can move afterwards. That suits street
 * furniture, which is nailed down by definition.
 */
export class PropBatch {
  private readonly buckets = new Map<StandardMaterial, Mesh[]>();

  constructor(private readonly scene: Scene) {}

  /**
   * A box part. `rotY` turns it about its own centre, which is what lets a
   * bench face the road or a frond splay off a trunk.
   */
  box(
    material: StandardMaterial,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    rotY = 0,
    rotZ = 0,
  ): void {
    const m = MeshBuilder.CreateBox("p", { width: w, height: h, depth: d }, this.scene);
    m.position.set(x, y, z);
    m.rotation.set(0, rotY, rotZ);
    this.push(material, m);
  }

  /** A cylinder part, six-sided by default: enough to round off at this scale. */
  cyl(
    material: StandardMaterial,
    h: number,
    top: number,
    bottom: number,
    x: number,
    y: number,
    z: number,
    sides = 8,
  ): void {
    const m = MeshBuilder.CreateCylinder("p", { height: h, diameterTop: top, diameterBottom: bottom, tessellation: sides }, this.scene);
    m.position.set(x, y, z);
    this.push(material, m);
  }

  private push(material: StandardMaterial, mesh: Mesh): void {
    const list = this.buckets.get(material);
    if (list) list.push(mesh);
    else this.buckets.set(material, [mesh]);
  }

  /**
   * Welds every bucket and hands the results over. Merging disposes the parts,
   * so this may only be called once.
   */
  flush(into: Mesh[]): void {
    for (const [material, parts] of this.buckets) {
      const merged = Mesh.MergeMeshes(parts, true, true);
      if (!merged) continue;
      merged.name = `prop-${material.name}`;
      merged.material = material;
      merged.isPickable = false;
      merged.freezeWorldMatrix();
      into.push(merged);
    }
    this.buckets.clear();
  }
}

/**
 * The palette street furniture is drawn from. Held together so the batch has
 * as few materials as possible — every extra one is another draw call for the
 * whole city, not just for the prop that introduced it.
 */
export interface PropKit {
  steel: StandardMaterial;
  darkSteel: StandardMaterial;
  paintedGreen: StandardMaterial;
  paintedRed: StandardMaterial;
  timber: StandardMaterial;
  concrete: StandardMaterial;
  glass: StandardMaterial;
  bark: StandardMaterial;
  leaf: StandardMaterial;
  lamp: StandardMaterial;
  signal: StandardMaterial;
  stop: StandardMaterial;
  go: StandardMaterial;
}

export function propKit(kit: TextureKit, lamp: StandardMaterial, stop: StandardMaterial, go: StandardMaterial): PropKit {
  return {
    steel: kit.material("metal", "#6a6660"),
    darkSteel: kit.material("metal", "#2a2622"),
    paintedGreen: kit.material("metal", "#39543f"),
    paintedRed: kit.material("metal", "#a83a26"),
    timber: kit.material("wood", "#6a4630"),
    concrete: kit.material("concrete", "#736a5e"),
    glass: kit.material("glass", "#26323a"),
    bark: kit.material("bark", "#6a4a32"),
    leaf: kit.material("foliage", "#3d7a4e"),
    lamp,
    signal: kit.material("metal", "#33302c"),
    stop,
    go,
  };
}

/** Deterministic hash in [0,1): the same street has to dress itself the same way every load. */
function hash01(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** A skip: sloped sides, a ribbed body, a lid thrown half back and lifting lugs. */
export function dumpster(b: PropBatch, k: PropKit, x: number, z: number, rot: number, seed: number): void {
  const shell = hash01(seed) < 0.5 ? k.paintedGreen : k.steel;
  b.box(shell, 13, 7, 9, x, 4.5, z, rot);
  for (let i = 0; i < 4; i++) {
    b.box(k.darkSteel, 0.7, 6.6, 9.3, x + Math.cos(rot) * (i * 3.2 - 4.8), 4.5, z - Math.sin(rot) * (i * 3.2 - 4.8), rot);
  }
  b.box(k.darkSteel, 13.4, 0.8, 4.8, x - Math.sin(rot) * 2.1, 8.2, z - Math.cos(rot) * 2.1, rot);
  // The other flap stands open against the back wall, which is the detail
  // that stops a skip reading as a shipping crate.
  b.box(k.darkSteel, 13.4, 0.8, 4.8, x + Math.sin(rot) * 4.4, 10.4, z + Math.cos(rot) * 4.4, rot, 1.15);
  for (const s of [-1, 1]) {
    b.box(k.darkSteel, 1.4, 1.4, 1.4, x + Math.cos(rot) * s * 5.4, 0.7, z - Math.sin(rot) * s * 5.4, rot);
  }
}

/** A shipping crate: planked sides with a stencil band. */
export function crate(b: PropBatch, k: PropKit, x: number, z: number, size: number, seed: number): void {
  const turn = hash01(seed) * 0.8 - 0.4;
  b.box(k.timber, size, size * 0.86, size * 0.9, x, size * 0.43, z, turn);
  for (const s of [-1, 1]) {
    b.box(k.darkSteel, size * 1.04, 0.6, size * 0.94, x, size * (0.43 + s * 0.36), z, turn);
  }
  b.box(k.darkSteel, size * 0.5, 0.5, size * 0.94, x, size * 0.43, z, turn, 0.9);
}

/** A traffic cone with a reflective collar. */
export function cone(b: PropBatch, k: PropKit, x: number, z: number): void {
  b.box(k.paintedRed, 3.4, 0.6, 3.4, x, 0.3, z);
  b.cyl(k.paintedRed, 4.2, 0.7, 2.4, x, 2.4, z, 6);
  b.cyl(k.concrete, 0.9, 1.7, 1.9, x, 2.7, z, 6);
}

/**
 * A street vendor's stall: counter, back shelf, corner posts and a striped
 * canopy over the lot.
 */
export function vendorStall(b: PropBatch, k: PropKit, x: number, z: number, rot: number): void {
  b.box(k.timber, 14, 4.4, 7, x, 3.4, z, rot);
  b.box(k.steel, 14.6, 0.6, 7.6, x, 5.8, z, rot);
  b.box(k.timber, 13, 3.4, 1.2, x - Math.sin(rot) * 2.6, 8, z - Math.cos(rot) * 2.6, rot);
  for (const s of [-1, 1]) {
    b.box(k.darkSteel, 0.9, 12, 0.9, x + Math.cos(rot) * s * 6.6, 6, z - Math.sin(rot) * s * 6.6, rot);
  }
  b.box(k.paintedRed, 16, 0.7, 9, x, 12.2, z, rot, 0.12);
  b.box(k.steel, 16.2, 0.5, 1.4, x + Math.sin(rot) * 4.4, 11.4, z + Math.cos(rot) * 4.4, rot);
}

/** A parked scooter, seen side-on: two wheels, a deck, a seat and a bar. */
export function scooter(b: PropBatch, k: PropKit, x: number, z: number, rot: number): void {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  for (const along of [-3.4, 3.2]) {
    b.cyl(k.darkSteel, 0.9, 4.4, 4.4, x + c * along, 2.2, z - s * along, 8);
  }
  b.box(k.paintedRed, 8, 2.4, 2.6, x, 3.6, z, rot);
  b.box(k.darkSteel, 3.6, 1, 2.4, x - c * 1.2, 5.2, z + s * 1.2, rot);
  b.box(k.darkSteel, 1, 5.4, 1, x + c * 3, 6, z - s * 3, rot, -0.2);
  b.box(k.darkSteel, 1, 0.9, 5, x + c * 3.2, 8.4, z - s * 3.2, rot);
  b.box(k.glass, 0.6, 2.6, 3.4, x + c * 3.8, 8.6, z - s * 3.8, rot, -0.3);
}

/** A wheelie bin: tapered body, ribbed front, hinged lid and two wheels. */
export function bin(b: PropBatch, k: PropKit, x: number, z: number, seed: number): void {
  const turn = hash01(seed) * 0.6 - 0.3;
  const body = hash01(seed * 3) < 0.5 ? k.paintedGreen : k.darkSteel;
  b.box(body, 6.4, 6.6, 4.6, x, 3.6, z, turn);
  b.box(body, 5.4, 0.5, 4.9, x, 5.2, z, turn);
  b.box(body, 5.4, 0.5, 4.9, x, 3.4, z, turn);
  // The lid sits proud of the body and tips back a little, which is most of
  // what tells a bin from a crate at twenty paces.
  b.box(k.darkSteel, 6.9, 0.9, 5.1, x, 7.3, z, turn, -0.09);
  b.box(k.darkSteel, 1.6, 1.6, 1.4, x - 2.4, 0.8, z, turn);
  b.box(k.darkSteel, 1.6, 1.6, 1.4, x + 2.4, 0.8, z, turn);
}

/** A hydrant: flanged base, barrel, domed bonnet and a port each side. */
export function hydrant(b: PropBatch, k: PropKit, x: number, z: number): void {
  b.cyl(k.paintedRed, 0.9, 5.2, 5.6, x, 0.5, z, 8);
  b.cyl(k.paintedRed, 4.4, 2.6, 3.2, x, 3.1, z, 8);
  b.cyl(k.paintedRed, 0.7, 4.2, 4.2, x, 5.5, z, 8);
  b.cyl(k.paintedRed, 1.3, 2.2, 2.8, x, 6.4, z, 8);
  b.box(k.paintedRed, 3.6, 1.5, 1.5, x, 4.2, z);
  b.cyl(k.paintedRed, 0.9, 1.4, 1.4, x, 7.4, z, 6);
}

/** A park bench: slatted seat and back on two cast ends. */
export function bench(b: PropBatch, k: PropKit, x: number, z: number, rot: number): void {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  // Slats run the length of the bench and are set apart across it, so the
  // seat throws a striped shadow instead of reading as one solid plank.
  for (let i = 0; i < 3; i++) {
    const off = (i - 1) * 1.5;
    b.box(k.timber, 12, 0.7, 1.2, x - s * off, 3.2, z + c * off, rot);
  }
  for (let i = 0; i < 2; i++) {
    const lift = 4.6 + i * 1.6;
    b.box(k.timber, 12, 1.2, 0.6, x + s * 1.9, lift, z - c * 1.9, rot, 0.16);
  }
  for (const end of [-5.2, 5.2]) {
    const ex = x + c * end;
    const ez = z + s * end;
    b.box(k.darkSteel, 0.8, 3.2, 5, ex, 1.6, ez, rot);
    b.box(k.darkSteel, 0.8, 4.4, 0.8, ex + s * 1.9, 5, ez - c * 1.9, rot);
  }
}

/** A newspaper box: a body on legs with a glazed front and a handle. */
export function newsBox(b: PropBatch, k: PropKit, x: number, z: number, seed: number): void {
  const turn = hash01(seed) * 1.2 - 0.6;
  const shell = hash01(seed * 7) < 0.5 ? k.paintedRed : k.steel;
  b.box(shell, 4, 5.2, 3.6, x, 4.4, z, turn);
  b.box(k.glass, 3, 2.6, 0.4, x + Math.sin(turn) * 1.9, 5.4, z + Math.cos(turn) * 1.9, turn);
  b.box(k.darkSteel, 3.4, 0.5, 0.6, x + Math.sin(turn) * 1.9, 3.5, z + Math.cos(turn) * 1.9, turn);
  b.box(k.darkSteel, 0.6, 1.9, 0.6, x - 1.4, 0.9, z, turn);
  b.box(k.darkSteel, 0.6, 1.9, 0.6, x + 1.4, 0.9, z, turn);
}

/** A concrete planter with a shrub in it. */
export function planter(b: PropBatch, k: PropKit, x: number, z: number, seed: number): void {
  b.cyl(k.concrete, 3.4, 6.2, 5, x, 1.7, z, 8);
  b.cyl(k.concrete, 0.5, 6.6, 6.6, x, 3.5, z, 8);
  const bushy = 3 + Math.floor(hash01(seed) * 3);
  for (let i = 0; i < bushy; i++) {
    const a = (i / bushy) * Math.PI * 2 + hash01(seed + i) * 0.7;
    const r = 1 + hash01(seed * 3 + i) * 1.4;
    b.box(k.leaf, 3.4, 3, 3.4, x + Math.cos(a) * r, 5 + hash01(seed * 5 + i) * 1.6, z + Math.sin(a) * r, a);
  }
}

/**
 * A street lamp: pole, a swan neck out over the kerb, and a hooded head. The
 * arm is what makes it read as street lighting rather than as a post — light
 * belongs over the road, not over the pavement it stands on.
 */
export function streetLamp(b: PropBatch, k: PropKit, x: number, z: number, reach: number): void {
  const span = Math.abs(reach);
  const dir = Math.sign(reach) || 1;
  b.box(k.darkSteel, 2.6, 0.8, 2.6, x, 0.4, z);
  b.cyl(k.darkSteel, 21, 1.1, 1.9, x, 10.5, z, 6);
  // Three shortening, flattening segments from the pole out to the head. Each
  // one has to start where the last ended or the head hangs in mid-air, which
  // is what a run of lamps built from a fixed fraction of the reach looked
  // like: a row of poles with glowing bars floating beside them.
  const knees = [0.42, 0.34, 0.24];
  const lifts = [1.5, 0.75, 0.2];
  let out = 0;
  for (let i = 0; i < knees.length; i++) {
    const len = span * (knees[i] ?? 0);
    b.box(k.darkSteel, len * 1.08, 1, 1, x + dir * (out + len / 2), 21 + (lifts[i] ?? 0), z, 0, -dir * (0.5 - i * 0.2));
    out += len;
  }
  const hx = x + dir * out;
  b.box(k.darkSteel, 5.4, 1.1, 3.2, hx, 22.4, z);
  b.box(k.lamp, 4.4, 0.9, 2.4, hx, 21.6, z);
}

/** A traffic signal: mast, arm and a three-lens housing hanging off it. */
export function trafficLight(b: PropBatch, k: PropKit, x: number, z: number, reach: number, red: boolean): void {
  b.box(k.signal, 3, 1, 3, x, 0.5, z);
  b.cyl(k.signal, 26, 1.3, 2.1, x, 13, z, 6);
  b.box(k.signal, Math.abs(reach), 1, 1, x + reach / 2, 25.6, z);
  const hx = x + reach;
  b.box(k.signal, 2.6, 7, 2.6, hx, 21.8, z);
  b.box(k.signal, 3.4, 0.6, 3.4, hx, 25.4, z);
  b.box(red ? k.stop : k.signal, 1.6, 1.6, 0.5, hx, 23.9, z + 1.5);
  b.box(k.signal, 1.6, 1.6, 0.5, hx, 21.8, z + 1.5);
  b.box(red ? k.signal : k.go, 1.6, 1.6, 0.5, hx, 19.7, z + 1.5);
  b.box(k.signal, 3.2, 0.4, 1.4, hx, 24.9, z + 1.5, 0, 0.3);
}

/**
 * A palm: a trunk that leans and thickens toward the ground, and fronds that
 * droop rather than stick out flat. Built from segments so the lean is a curve
 * — a straight cylinder with spokes on top reads as a mop, not a tree.
 */
export function palm(b: PropBatch, k: PropKit, x: number, z: number, seed: number): void {
  const lean = hash01(seed) * 0.22 - 0.11;
  const face = hash01(seed * 3) * Math.PI * 2;
  const tall = 24 + hash01(seed * 5) * 12;
  const segments = 5;
  let tx = x;
  let tz = z;
  let ty = 0;
  for (let i = 0; i < segments; i++) {
    const h = tall / segments;
    const t = i / segments;
    const wide = 3.8 - t * 1.8;
    b.cyl(k.bark, h * 1.06, wide - 0.4, wide, tx, ty + h / 2, tz, 6);
    const drift = lean * (t + 0.3) * h;
    tx += Math.cos(face) * drift;
    tz += Math.sin(face) * drift;
    ty += h;
  }
  b.cyl(k.bark, 2, 2.6, 1.6, tx, ty + 0.6, tz, 6);
  const fronds = 7;
  for (let f = 0; f < fronds; f++) {
    const a = (f / fronds) * Math.PI * 2 + hash01(seed * 7) * 1.1;
    const len = 9 + hash01(seed * 11 + f) * 5;
    // Two joints per frond: out and level, then out and down. That bend is
    // the whole silhouette of a palm.
    const midX = tx + Math.cos(a) * len * 0.45;
    const midZ = tz + Math.sin(a) * len * 0.45;
    b.box(k.leaf, len, 0.7, 3.4, midX, ty + 1.4, midZ, a, -0.12);
    const endX = tx + Math.cos(a) * len * 1.05;
    const endZ = tz + Math.sin(a) * len * 1.05;
    b.box(k.leaf, len * 0.8, 0.6, 2.6, endX, ty - 0.6, endZ, a, 0.5);
  }
  for (let i = 0; i < 3; i++) {
    const a = hash01(seed * 13 + i) * Math.PI * 2;
    b.box(k.leaf, 2.4, 2.4, 2.4, tx + Math.cos(a) * 2, ty - 1.4, tz + Math.sin(a) * 2, a);
  }
}
