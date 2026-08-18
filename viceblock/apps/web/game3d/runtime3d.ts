import { Engine } from "@babylonjs/core/Engines/engine";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Scene } from "@babylonjs/core/scene";
import {
  AIM_ASSIST_CONFIG,
  applyReward,
  applyVehicleDamage,
  assistAim,
  assistHint,
  attemptPick,
  copCountForHeat,
  createDirector,
  createHeatState,
  createLockpick,
  createVehicleRuntime,
  ECONOMY_CONFIG,
  fenceValue,
  HEIST_SUNSET,
  lootLabel,
  MISSIONS,
  missionRating,
  nextMission,
  normalizeAngle,
  damageStage,
  performanceMultipliers,
  PLAYER_CONFIG,
  POLICE_CONFIG,
  raceResult,
  recognitionRange,
  shootTire,
  surfaceGrip,
  tickDirector,
  tickHeat,
  tickLockpick,
  tickVehicleExplosion,
  vehicleById,
  VEHICLE_CONFIG,
  weaponById,
  witnessReport,
  WORLD_CONFIG,
  type ContractDef,
  type CrimeKind,
  type DirectorState,
  type HeatState,
  type LockpickState,
  type LootItem,
  type VehicleRuntime,
  type WeaponId,
  type WorldEventDef,
} from "@viceblock/game-core";
import {
  DEFAULT_SETTINGS,
  MAP_H,
  MAP_W,
  sanitizeText,
  TILE,
  type PlayerSave,
  type PresencePlayer,
} from "@viceblock/shared";
import { GameAudio } from "../game/audio";
import { GameInput } from "../game/input";
import type { HudSnapshot } from "../game/hud";
import { blocked, buildSouthside, Cell, cellAt, hideSpotNear, landmarkAt, type Landmark, type WorldData } from "../game/world";
import { buildCity, type CityMeshes } from "./city";

type Quality = "low" | "medium" | "high" | "auto";

interface Actor {
  id: string;
  kind: "civilian" | "named" | "cop";
  name: string;
  x: number;
  z: number;
  heading: number;
  hp: number;
  panic: number;
  mesh: Mesh;
  talk?: string[];
  searchT?: number;
  searchX?: number;
  searchZ?: number;
  /** Seconds left filming the player instead of fleeing. */
  recording?: number;
}

interface CarEntity {
  rt: VehicleRuntime;
  mesh: Mesh;
  smoke: number;
}

interface Tracer {
  mesh: Mesh;
  life: number;
}

interface MissionRuntime {
  id: string;
  step: number;
  raceHits: number;
}

const RACE_CPS = [
  { x: 50 * TILE, z: 65 * TILE },
  { x: 82 * TILE, z: 52 * TILE },
  { x: 36 * TILE, z: 24 * TILE },
  { x: 50 * TILE, z: 65 * TILE },
];

/** Interiors are separate rooms built high above the city grid. */
const INTERIOR_Y = 400;

export class ViceblockRuntime3D {
  canvas: HTMLCanvasElement;
  minimap: HTMLCanvasElement | null = null;
  engine: Engine;
  scene: Scene;
  world: WorldData;
  city: CityMeshes;
  input: GameInput;
  audio: GameAudio;
  camera: FreeCamera;
  hemi: HemisphericLight;
  sun: DirectionalLight;

  playerMesh: Mesh;
  player = {
    x: 0,
    z: 0,
    y: 0,
    vy: 0,
    heading: 0,
    camYaw: 0,
    camPitch: 0.62,
    health: 100,
    armor: 0,
    cash: ECONOMY_CONFIG.starterCash,
    bank: 0,
    xp: 0,
    streetRep: 0,
    vehicleId: null as string | null,
    weapon: "fists" as WeaponId,
    ammo: 36,
    phone: false,
    crate: false,
    grounded: true,
    sprintBoost: 0,
    raceBestMs: 0,
  };

  cars: CarEntity[] = [];
  actors: Actor[] = [];
  cops: Actor[] = [];
  tracers: Tracer[] = [];
  remoteMeshes = new Map<string, { mesh: Mesh; username: string; x: number; z: number }>();

  heat: HeatState = createHeatState();
  mission: MissionRuntime = { id: "fresh-off-the-bus", step: 0, raceHits: 0 };
  completed: string[] = [];
  time = 8.2;
  weather: "clear" | "rain" | "fog" = "clear";
  weatherT = 0;
  shake = 0;
  dialogue: { who: string; line: string; t: number } | null = null;
  toast = "";
  toastT = 0;
  interior: Landmark | null = null;
  saveId = "guest";
  username = "rookie";
  settings = { ...DEFAULT_SETTINGS };
  quality: Quality = "auto";
  lastShot = 1;
  lastFoot = 0;
  persistT = 0;
  running = false;
  aimAssistOn = true;

  // Phase 2 systems
  lockpick: LockpickState | null = null;
  private lockpickCar: CarEntity | null = null;
  private unlocked = new Set<string>();
  loot: LootItem[] = [];
  fenceRep = 0;
  jailLeft = 0;
  private pendingReports: Array<{ t: number; heatAdd: number }> = [];
  private director: DirectorState = createDirector();
  private news = "";
  private newsT = 0;
  private blackout = false;
  private crackdown = false;
  private storm = false;
  private eventCarIds = new Set<string>();
  contract: { def: ContractDef; stage: "pickup" | "drop" } | null = null;
  private surrenderT = 0;
  private gpsT = 0;
  /** Walkable interior state: rooms are built high above the city. */
  private interiorMode: { id: string; returnX: number; returnZ: number } | null = null;
  private martRoom: { cx: number; cz: number; half: number } | null = null;
  private tow: { mesh: Mesh; targetId: string } | null = null;
  private towCooldown = 20;
  private race: { checkpoint: number; t: number; marker: Mesh } | null = null;
  private missionStat = { t: 0, dmg: 0, maxHeat: 0 };
  private fenceOfferT = 0;
  walletNfts = 0;
  private chainCarSpawned = false;
  private pickFireHeld = false;
  private clock = 0;
  /** Car id → clock time until which its alarm blocks another pick attempt. */
  private alarmLockout = new Map<string, number>();

  onHud?: (h: HudSnapshot) => void;
  onPersist?: (s: PlayerSave) => void;
  onMissionComplete?: (missionId: string) => void;
  onContractComplete?: (contractId: string) => void;

  private unbind: (() => void) | null = null;
  private dragYaw = { active: false, id: -1, lastX: 0, lastY: 0 };
  private matCache = new Map<string, StandardMaterial>();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: false });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.42, 0.55, 0.62, 1);
    this.world = buildSouthside();
    this.city = buildCity(this.scene, this.world);

    this.hemi = new HemisphericLight("hemi", new Vector3(0.2, 1, 0.1), this.scene);
    this.hemi.intensity = 0.85;
    this.sun = new DirectionalLight("sun", new Vector3(-0.4, -1, -0.3), this.scene);
    this.sun.intensity = 0.6;

    this.camera = new FreeCamera("cam", new Vector3(0, 40, -40), this.scene);
    this.camera.minZ = 1;
    this.camera.maxZ = 2600;

    this.player.x = this.world.spawnX;
    this.player.z = this.world.spawnY;

    this.playerMesh = this.makeHumanoid("player", "#c45a32", "#e6c39a");
    this.input = new GameInput();
    this.audio = new GameAudio();
    this.seedWorld();
  }

  attach(): void {
    this.unbind = this.input.attach(this.canvas);
    const down = (e: PointerEvent): void => {
      // Mobile: any direct canvas touch orbits the camera (sticks are separate elements).
      // Desktop: right-drag orbits.
      if (this.input.mobile || e.button === 2) {
        this.dragYaw = { active: true, id: e.pointerId, lastX: e.clientX, lastY: e.clientY };
      }
    };
    const move = (e: PointerEvent): void => {
      if (!this.dragYaw.active || e.pointerId !== this.dragYaw.id) return;
      this.player.camYaw += (e.clientX - this.dragYaw.lastX) * 0.005;
      this.player.camPitch = Math.max(0.25, Math.min(1.15, this.player.camPitch + (e.clientY - this.dragYaw.lastY) * 0.004));
      this.dragYaw.lastX = e.clientX;
      this.dragYaw.lastY = e.clientY;
    };
    const up = (e: PointerEvent): void => {
      if (e.pointerId === this.dragYaw.id) this.dragYaw.active = false;
    };
    const ctx = (e: Event): void => e.preventDefault();
    this.canvas.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    this.canvas.addEventListener("contextmenu", ctx);
    const prevUnbind = this.unbind;
    this.unbind = () => {
      prevUnbind?.();
      this.canvas.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      this.canvas.removeEventListener("contextmenu", ctx);
    };
  }

  detach(): void {
    this.running = false;
    this.unbind?.();
    this.audio.setSiren(false);
    this.engine.stopRenderLoop();
    this.scene.dispose();
    this.engine.dispose();
  }

  async start(): Promise<void> {
    await this.audio.unlock();
    this.audio.setLevels(this.settings);
    if (this.quality === "auto") this.quality = this.input.mobile ? "low" : "high";
    this.applyQuality();
    this.running = true;
    let last = performance.now();
    this.engine.runRenderLoop(() => {
      const now = performance.now();
      const dt = Math.min(0.033, (now - last) / 1000);
      last = now;
      if (this.running) {
        this.update(dt);
        this.scene.render();
        this.drawMinimap();
      }
    });
    window.addEventListener("resize", () => this.engine.resize());
    this.say("Rico Vale", "You walk like you still got a ticket in your pocket. Come find me.");
  }

  applyQuality(): void {
    const scale = this.quality === "low" ? 0.62 : this.quality === "medium" ? 0.8 : 1;
    this.engine.setHardwareScalingLevel(1 / scale / Math.min(2, window.devicePixelRatio || 1));
  }

  setQuality(q: Quality): void {
    this.quality = q === "auto" ? (this.input.mobile ? "low" : "high") : q;
    this.applyQuality();
  }

  applySave(save: PlayerSave): void {
    this.saveId = save.id;
    this.username = sanitizeText(save.username, 20) || "rookie";
    this.player.cash = save.cash;
    this.player.bank = save.bank;
    this.player.xp = save.xp;
    this.player.streetRep = save.streetRep;
    this.player.health = save.health;
    this.player.armor = save.armor;
    this.completed = save.missionsCompleted;
    this.mission.id = save.activeMissionId ?? nextMission(save.missionsCompleted)?.id ?? "fresh-off-the-bus";
    this.settings = { ...DEFAULT_SETTINGS, ...save.settings };
    this.player.raceBestMs = save.raceBestMs ?? 0;
    if (save.inventory.some((i) => i.id === "smg")) this.player.weapon = "smg";
    else if (save.inventory.some((i) => i.id === "pistol")) this.player.weapon = "pistol";
    // Reconnect where you left off, as long as the spot is still walkable.
    if (save.x > 0 && save.y > 0 && !blocked(this.world, save.x, save.y, PLAYER_CONFIG.radius)) {
      this.player.x = save.x;
      this.player.z = save.y;
    }
    this.audio.setLevels(this.settings);
  }

  setRemotes(list: PresencePlayer[]): void {
    const keep = new Set<string>();
    for (const p of list) {
      if (p.id === this.saveId) continue;
      keep.add(p.id);
      let r = this.remoteMeshes.get(p.id);
      if (!r) {
        const mesh = this.makeHumanoid(`remote-${p.id}`, "#3a6a8a", "#c8d8e4");
        r = { mesh, username: sanitizeText(p.username, 16), x: p.x, z: p.y };
        this.remoteMeshes.set(p.id, r);
      }
      r.x = p.x;
      r.z = p.y;
      r.username = sanitizeText(p.username, 16);
    }
    for (const [id, r] of this.remoteMeshes) {
      if (!keep.has(id)) {
        r.mesh.dispose();
        this.remoteMeshes.delete(id);
      }
    }
  }

  snapshot(): PlayerSave {
    return {
      id: this.saveId,
      username: this.username,
      guest: !this.saveId.startsWith("wallet:"),
      cash: this.player.cash,
      bank: this.player.bank,
      xp: this.player.xp,
      level: Math.max(1, Math.floor(1 + Math.sqrt(this.player.xp / 180))),
      streetRep: this.player.streetRep,
      heat: this.heat.level,
      health: this.player.health,
      armor: this.player.armor,
      x: this.player.x,
      y: this.player.z,
      heading: this.player.heading,
      inventory:
        this.player.weapon === "fists"
          ? []
          : [{ id: this.player.weapon, kind: "weapon", name: weaponById(this.player.weapon).name, qty: 1, rarity: this.player.weapon === "smg" ? "rare" : "common" }],
      ownedVehicleIds: [],
      apartmentId: "apartment",
      missionsCompleted: this.completed,
      activeMissionId: this.mission.id,
      collectibles: [],
      achievements: [],
      settings: this.settings,
      raceBestMs: this.player.raceBestMs,
      updatedAt: Date.now(),
    };
  }

  // ------------------------------------------------------------- world seed

  private material(hex: string, emissive = 0): StandardMaterial {
    const key = `${hex}-${emissive}`;
    let m = this.matCache.get(key);
    if (!m) {
      m = new StandardMaterial(`dm-${key}`, this.scene);
      m.diffuseColor = Color3.FromHexString(hex);
      m.specularColor = new Color3(0.08, 0.08, 0.08);
      if (emissive > 0) m.emissiveColor = Color3.FromHexString(hex).scale(emissive);
      this.matCache.set(key, m);
    }
    return m;
  }

  private makeHumanoid(name: string, shirtHex: string, skinHex: string): Mesh {
    const body = MeshBuilder.CreateBox(`${name}-b`, { width: 8, depth: 5, height: 12 }, this.scene);
    body.material = this.material(shirtHex);
    const head = MeshBuilder.CreateBox(`${name}-h`, { width: 6, depth: 6, height: 6 }, this.scene);
    head.material = this.material(skinHex);
    head.position.y = 9.5;
    head.parent = body;
    body.position.y = 7;
    return body;
  }

  private makeCarMesh(name: string, hex: string, isPolice: boolean): Mesh {
    const body = MeshBuilder.CreateBox(`${name}-b`, { width: 30, depth: 16, height: 8 }, this.scene);
    body.material = this.material(hex);
    const cabin = MeshBuilder.CreateBox(`${name}-c`, { width: 14, depth: 13, height: 6 }, this.scene);
    cabin.material = this.material(isPolice ? "#d8e4f0" : "#1a1c20");
    cabin.position = new Vector3(-2, 7, 0);
    cabin.parent = body;
    if (isPolice) {
      const bar = MeshBuilder.CreateBox(`${name}-l`, { width: 6, depth: 10, height: 2 }, this.scene);
      bar.material = this.material("#4a90d8", 0.9);
      bar.position = new Vector3(-2, 11, 0);
      bar.parent = body;
    }
    const lightF = MeshBuilder.CreateBox(`${name}-hf`, { width: 1.5, depth: 12, height: 2 }, this.scene);
    lightF.material = this.material("#f2e6c0", 0.7);
    lightF.position = new Vector3(15, 1, 0);
    lightF.parent = body;
    const lightR = MeshBuilder.CreateBox(`${name}-hr`, { width: 1.5, depth: 12, height: 2 }, this.scene);
    lightR.material = this.material("#c43020", 0.7);
    lightR.position = new Vector3(-15, 1, 0);
    lightR.parent = body;
    body.position.y = 5;
    return body;
  }

  private seedWorld(): void {
    const spots: Array<[string, number, number, number, string, string?]> = [
      ["sparrow", 18 * TILE, 64 * TILE, 0, "#c56b3a"],
      ["sparrow", 38 * TILE, 52 * TILE, 1.5, "#d8c4a0", "sparrow-job"],
      ["ironback", 52 * TILE, 38 * TILE, 0.2, "#6b2d28"],
      ["mirage", 66 * TILE, 52 * TILE, 3.2, "#2f6f78"],
      ["needle", 30 * TILE, 38 * TILE, 0.8, "#1f1a18"],
      ["sparrow", 84 * TILE, 40 * TILE, 4.7, "#8a8f6a"],
      ["ironback", 24 * TILE, 12 * TILE, 0, "#4a3a5a"],
    ];
    for (const [defId, x, z, h, color, id] of spots) {
      const rt = createVehicleRuntime(defId, x, z, h, color, id === "sparrow-job");
      if (id) rt.id = id;
      this.cars.push({ rt, mesh: this.makeCarMesh(rt.id, color, false), smoke: 0 });
    }
    // Traffic
    const roads: Array<[number, number, number]> = [
      [10 * TILE, 11.5 * TILE, 0],
      [40 * TILE, 23.5 * TILE, Math.PI],
      [60 * TILE, 37.5 * TILE, 0],
      [23.5 * TILE, 20 * TILE, Math.PI / 2],
      [51.5 * TILE, 40 * TILE, -Math.PI / 2],
      [81.5 * TILE, 30 * TILE, Math.PI / 2],
    ];
    roads.forEach(([x, z, h], i) => {
      const rt = createVehicleRuntime(i % 2 ? "ironback" : "sparrow", x, z, h, i % 2 ? "#4a3a32" : "#7a5a40");
      rt.id = `traffic-${i}`;
      this.cars.push({ rt, mesh: this.makeCarMesh(rt.id, i % 2 ? "#4a3a32" : "#7a5a40", false), smoke: 0 });
    });

    const named: Array<[string, string, number, number, string, string[]]> = [
      ["rico", "Rico Vale", 29 * TILE, 47 * TILE, "#c45a32", [
        "You drive?",
        "Depends. Is it yours?",
        "Not anymore. Boost the Sparrow by Coral Mart. Maya wants it clean.",
      ]],
      ["maya", "Maya Reyes", 57 * TILE, 61 * TILE, "#e6c39a", [
        "If it still rolls, I can make it mean.",
        "Midnight line is south. Don't be cute with the handbrake.",
      ]],
      ["cupsey", "Cupsey", 27 * TILE, 29 * TILE, "#f0a030", [
        "Charts said Southside goes vertical. I took that personally.",
        "We're so back. Or we never left. Same thing.",
      ]],
      ["ansem", "Ansem", 72 * TILE, 20 * TILE, "#d8d2c4", [
        "Liquidity is just another word for heat.",
        "The mural remembers wallets the news forgets.",
      ]],
      ["marcus", "Marcus Vane", 82 * TILE, 61 * TILE, "#5a6a48", [
        "Crate's in the yard. Fence is theater. Cops ain't.",
      ]],
    ];
    for (const [id, name, x, z, shirt, talk] of named) {
      this.actors.push({
        id,
        kind: "named",
        name,
        x,
        z,
        heading: 0,
        hp: 100,
        panic: 0,
        mesh: this.makeHumanoid(id, shirt, "#e6c39a"),
        talk,
      });
    }
    this.buildMartInterior();

    const colors = ["#c4a07a", "#8a6a54", "#d8c8b0", "#6a4a3a", "#b08870"];
    const count = 36;
    for (let i = 0; i < count; i++) {
      const x = (8 + (i * 17) % 80) * TILE + 10;
      const z = (12 + (i * 11) % 60) * TILE + 10;
      if (blocked(this.world, x, z, 8)) continue;
      this.actors.push({
        id: `c${i}`,
        kind: "civilian",
        name: "local",
        x,
        z,
        heading: Math.random() * 6,
        hp: 30,
        panic: 0,
        mesh: this.makeHumanoid(`c${i}`, colors[i % colors.length] ?? "#c4a07a", "#d8b890"),
      });
    }
  }

  /** A walkable Coral Mart room: shelves, a clerk behind the counter, a till. */
  private buildMartInterior(): void {
    const cx = 43 * TILE;
    const cz = 45 * TILE;
    const half = 96;
    this.martRoom = { cx, cz, half };
    const floor = MeshBuilder.CreateBox("mart-floor", { width: half * 2, depth: half * 2, height: 2 }, this.scene);
    floor.material = this.material("#c8bca4");
    floor.position = new Vector3(cx, INTERIOR_Y - 1, cz);
    const wallMat = this.material("#7a4a38");
    const walls: Array<[number, number, number, number]> = [
      [cx, cz - half, half * 2, 6],
      [cx, cz + half, half * 2, 6],
      [cx - half, cz, 6, half * 2],
      [cx + half, cz, 6, half * 2],
    ];
    walls.forEach(([x, z, w, d], i) => {
      const wall = MeshBuilder.CreateBox(`mart-wall-${i}`, { width: w, depth: d, height: 40 }, this.scene);
      wall.material = wallMat;
      wall.position = new Vector3(x, INTERIOR_Y + 20, z);
    });
    const counter = MeshBuilder.CreateBox("mart-counter", { width: 90, depth: 18, height: 14 }, this.scene);
    counter.material = this.material("#4a5a68");
    counter.position = new Vector3(cx, INTERIOR_Y + 7, cz - half + 34);
    for (let i = 0; i < 3; i++) {
      const shelf = MeshBuilder.CreateBox(`mart-shelf-${i}`, { width: 16, depth: 90, height: 22 }, this.scene);
      shelf.material = this.material(i % 2 ? "#8a6a4a" : "#6a8a5a");
      shelf.position = new Vector3(cx - 50 + i * 50, INTERIOR_Y + 11, cz + 24);
    }
    const clerk = this.makeHumanoid("mart-clerk", "#3a6a4a", "#e6c39a");
    clerk.position = new Vector3(cx, INTERIOR_Y + 7, cz - half + 16);
    const till = MeshBuilder.CreateBox("mart-till", { width: 14, depth: 10, height: 8 }, this.scene);
    till.material = this.material("#2a2c30", 0.2);
    till.position = new Vector3(cx + 34, INTERIOR_Y + 18, cz - half + 34);
  }

  private enterMart(): void {
    if (!this.martRoom) return;
    this.interiorMode = { id: "coral-mart", returnX: this.player.x, returnZ: this.player.z };
    this.player.x = this.martRoom.cx;
    this.player.z = this.martRoom.cz + this.martRoom.half - 24;
    this.player.vehicleId = null;
    this.flash("CORAL MART  ·  counter buys food  ·  the till is a choice");
    this.audio.uiClick();
  }

  private exitInterior(): void {
    if (!this.interiorMode) return;
    this.player.x = this.interiorMode.returnX;
    this.player.z = this.interiorMode.returnZ;
    this.interiorMode = null;
    this.audio.uiClick();
  }

  /** Interior interactions resolve by proximity to furniture spots. */
  private interactInterior(): void {
    if (!this.interiorMode || !this.martRoom) return;
    const { cx, cz, half } = this.martRoom;
    const near = (x: number, z: number, r: number): boolean => Math.hypot(this.player.x - x, this.player.z - z) < r;
    if (near(cx + 34, cz - half + 34, 34)) {
      this.robStore();
      this.exitInterior();
      return;
    }
    if (near(cx, cz - half + 34, 40)) {
      if (this.player.cash >= 15) {
        this.player.cash -= 15;
        this.player.health = Math.min(100, this.player.health + 35);
        this.audio.cash();
        this.flash("HOT MEAL  ·  +35 health  ·  $15");
      } else {
        this.flash("CLERK  ·  fifteen bucks, friend");
      }
      return;
    }
    if (near(cx - 50, cz + 24, 40)) {
      if (this.player.cash >= 8) {
        this.player.cash -= 8;
        this.player.sprintBoost = 30;
        this.audio.cash();
        this.flash("COFFEE  ·  sprint boost 30s  ·  $8");
      } else {
        this.flash("MACHINE  ·  $8, exact change only");
      }
      return;
    }
    if (near(cx, cz + half - 24, 40)) {
      this.exitInterior();
      return;
    }
  }

  private interiorPrompt(): string {
    if (!this.interiorMode || !this.martRoom) return "";
    const { cx, cz, half } = this.martRoom;
    const spots: Array<[number, number, number, string]> = [
      [cx + 34, cz - half + 34, 34, "E  ·  ROB THE TILL"],
      [cx, cz - half + 34, 40, "E  ·  BUY MEAL $15 (+35 hp)"],
      [cx - 50, cz + 24, 40, "E  ·  COFFEE $8 (sprint boost)"],
      [cx, cz + half - 24, 40, "E  ·  LEAVE"],
    ];
    for (const [x, z, r, label] of spots) {
      if (Math.hypot(this.player.x - x, this.player.z - z) < r) return label;
    }
    return "";
  }

  // ---------------------------------------------------------------- update

  private update(dt: number): void {
    this.clock += dt;
    this.time = (this.time + dt * WORLD_CONFIG.hoursPerRealSecond * 3600) % 24;
    this.weatherT += dt;
    if (this.weatherT > WORLD_CONFIG.weatherCycleSeconds) {
      this.weatherT = 0;
      this.weather = this.weather === "clear" ? "rain" : this.weather === "rain" ? "fog" : "clear";
    }
    if (this.storm) this.weather = "rain";
    this.updateDayNight();

    if (this.newsT > 0) this.newsT -= dt;
    else this.news = "";

    // Jail: time stands still for the player; wait it out or post bail.
    if (this.jailLeft > 0) {
      this.jailLeft -= dt;
      if (this.jailLeft <= 0) {
        this.jailLeft = 0;
        this.flash("RELEASED  ·  keep your head down for a minute");
      }
      this.updateCamera(dt);
      this.onHud?.(this.hud());
      return;
    }

    // Lockpicking pauses movement; E (or the mobile action button) attempts the pick.
    if (this.lockpick && this.lockpickCar) {
      this.lockpick = tickLockpick(this.lockpick, dt);
      // Edge-detect fire so a held button cannot burn every pick in one frame.
      const fireHeld = this.input.firing();
      const fireEdge = fireHeld && !this.pickFireHeld;
      this.pickFireHeld = fireHeld;
      if (this.input.consumeInteract() || fireEdge) {
        this.lockpick = attemptPick(this.lockpick, true);
        this.audio.uiClick();
      }
      if (this.lockpick.done) {
        const car = this.lockpickCar;
        if (this.lockpick.success) {
          this.unlocked.add(car.rt.id);
          this.flash("LOCK POPPED  ·  she's yours");
          this.enterCar(car);
        } else if (this.lockpick.alarmed) {
          car.rt.alarmed = true;
          // A blaring alarm keeps the car too hot to touch for a while.
          this.alarmLockout.set(car.rt.id, this.clock + 45);
          this.audio.alarm();
          this.reportCrime("lockpick-alarm", 1);
          this.flash("ALARM  ·  pick snapped, whole block heard it");
        }
        this.lockpick = null;
        this.lockpickCar = null;
      }
      this.updateCamera(dt);
      this.onHud?.(this.hud());
      return;
    }

    // Delayed 911 calls from witnesses.
    this.pendingReports = this.pendingReports.filter((r) => {
      r.t -= dt;
      if (r.t <= 0) {
        this.raiseHeat(r.heatAdd);
        this.flash("911 CALL  ·  units dispatched to your last position");
        return false;
      }
      return true;
    });

    // World director keeps the city unpredictable.
    const tick = tickDirector(this.director, dt);
    this.director = tick.state;
    if (tick.fired) this.applyWorldEvent(tick.fired);
    if (!this.director.active) {
      this.blackout = false;
      this.crackdown = false;
      this.storm = false;
    }

    if (this.fenceOfferT > 0) this.fenceOfferT -= dt;
    this.missionStat.t += dt;
    this.missionStat.maxHeat = Math.max(this.missionStat.maxHeat, this.heat.level);
    this.updateTow(dt);
    this.updateRace(dt);

    if (this.input.radioQueued) {
      this.input.radioQueued = false;
      this.audio.cycleStation();
      this.audio.uiClick();
      this.flash(`RADIO  ·  ${this.audio.stationLabel()}`);
    }
    if (this.input.phoneQueued) {
      this.input.phoneQueued = false;
      this.player.phone = !this.player.phone;
      this.audio.uiClick();
    }
    if (this.input.assistQueued) {
      this.input.assistQueued = false;
      this.flash(assistHint(this.heat.level, this.heat.hiddenTimer, hideSpotNear(this.world, this.player.x, this.player.z)) || "AI ASSIST  ·  follow the trimmed buildings — bright trims are jobs");
    }

    this.updatePlayer(dt);
    this.updateCars(dt);
    this.updateActors(dt);
    this.updateCops(dt);
    this.updateTracers(dt);
    this.updateMissions();
    this.updateCamera(dt);
    this.updateRemotes();

    this.audio.setInVehicle(Boolean(this.player.vehicleId));
    const car = this.cars.find((c) => c.rt.id === this.player.vehicleId);
    this.audio.setEngineSpeed(car ? Math.hypot(car.rt.vx, car.rt.vy) : 0, Boolean(car && !car.rt.exploded));
    this.audio.setSiren(this.heat.level >= 2);
    this.audio.tickSiren(dt);
    // Dynamic music: pursuit switches the sequencer to the tense pattern.
    if (this.heat.level >= 2 && this.audio.station !== "under88" && this.audio.station !== "off") {
      this.audio.setStation("under88");
      this.flash("RADIO  ·  UNDERGROUND 88 cuts in — pursuit mix");
    }

    this.shake = Math.max(0, this.shake - dt * 8);
    if (this.dialogue) {
      this.dialogue.t -= dt;
      if (this.dialogue.t <= 0) this.dialogue = null;
    }
    if (this.toastT > 0) this.toastT -= dt;
    else this.toast = "";

    this.persistT += dt;
    if (this.persistT > WORLD_CONFIG.autosaveSeconds) {
      this.persistT = 0;
      this.onPersist?.(this.snapshot());
    }
    this.onHud?.(this.hud());
  }

  private updateDayNight(): void {
    const t = this.time;
    const day = t > 6.5 && t < 19;
    const dusk = (t > 5 && t <= 6.5) || (t >= 19 && t < 21);
    this.hemi.intensity = this.blackout ? 0.12 : day ? 0.85 : dusk ? 0.5 : 0.28;
    this.sun.intensity = this.blackout ? 0.02 : day ? 0.6 : dusk ? 0.3 : 0.05;
    const sky = this.blackout
      ? new Color4(0.03, 0.03, 0.05, 1)
      : day ? new Color4(0.42, 0.55, 0.62, 1) : dusk ? new Color4(0.62, 0.38, 0.28, 1) : new Color4(0.07, 0.06, 0.1, 1);
    this.scene.clearColor = sky;
    const fog = this.weather === "fog" ? 0.004 : this.weather === "rain" ? 0.0016 : 0.0007;
    this.scene.fogMode = Scene.FOGMODE_EXP2;
    this.scene.fogDensity = fog;
    this.scene.fogColor = new Color3(sky.r, sky.g, sky.b);
  }

  private updatePlayer(dt: number): void {
    if (this.player.vehicleId) {
      if (this.input.consumeInteract()) this.exitVehicle();
      this.playerMesh.setEnabled(false);
      return;
    }
    this.playerMesh.setEnabled(true);
    const axis = this.input.axis();
    if (this.player.sprintBoost > 0) this.player.sprintBoost -= dt;
    const boost = this.player.sprintBoost > 0 && axis.sprint ? 1.18 : 1;
    const speed = (axis.sprint ? PLAYER_CONFIG.sprintSpeed : PLAYER_CONFIG.walkSpeed) * boost * (this.weather === "rain" ? 0.94 : 1);
    // Camera-relative movement.
    const yaw = this.player.camYaw;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    const mx = rx * axis.x + fx * -axis.y;
    const mz = rz * axis.x + fz * -axis.y;
    const mag = Math.hypot(mx, mz);
    if (mag > 0.05) {
      const nx = this.player.x + (mx / mag) * Math.min(1, mag) * speed * dt;
      const nz = this.player.z + (mz / mag) * Math.min(1, mag) * speed * dt;
      if (this.interiorMode && this.martRoom) {
        // Interior collision is the room's walls, not the city grid.
        const { cx, cz, half } = this.martRoom;
        this.player.x = Math.max(cx - half + 12, Math.min(cx + half - 12, nx));
        this.player.z = Math.max(cz - half + 12, Math.min(cz + half - 12, nz));
      } else {
        if (!blocked(this.world, nx, this.player.z, PLAYER_CONFIG.radius)) this.player.x = nx;
        if (!blocked(this.world, this.player.x, nz, PLAYER_CONFIG.radius)) this.player.z = nz;
      }
      this.player.heading = Math.atan2(mz, mx);
      this.lastFoot += dt;
      if (this.lastFoot > (axis.sprint ? 0.22 : 0.32)) {
        this.lastFoot = 0;
        const cell = cellAt(this.world, this.player.x, this.player.z);
        const surface = cell === Cell.Sand ? "sand" : cell === Cell.Grass ? "grass" : cell === Cell.Dock ? "metal" : "concrete";
        this.audio.foot(axis.sprint, surface);
      }
    }
    // Jump
    if (this.input.keys.has("Space") && this.player.grounded) {
      this.player.vy = PLAYER_CONFIG.jumpVelocity;
      this.player.grounded = false;
    }
    if (!this.player.grounded) {
      this.player.vy -= PLAYER_CONFIG.gravity * dt;
      this.player.y += this.player.vy * dt * 10;
      if (this.player.y <= 0) {
        this.player.y = 0;
        this.player.vy = 0;
        this.player.grounded = true;
      }
    }
    if (this.input.consumeInteract()) {
      if (this.interiorMode) this.interactInterior();
      else this.tryInteract();
    }
    if (!this.interiorMode) this.tryFire(dt);
    const elev = this.interiorMode ? INTERIOR_Y : 0;
    this.playerMesh.position.set(this.player.x, elev + 7 + this.player.y, this.player.z);
    this.playerMesh.rotation.y = Math.PI / 2 - this.player.heading;
    if (this.player.health <= 0) this.die();
  }

  private updateCamera(dt: number): void {
    const car = this.cars.find((c) => c.rt.id === this.player.vehicleId);
    const speed = car ? Math.hypot(car.rt.vx, car.rt.vy) : 0;
    const dist = car ? 120 + Math.min(50, speed * 0.25) : 90;
    const pitch = this.player.camPitch;
    // While driving fast, ease the camera behind the velocity vector.
    if (car && speed > 30 && !this.dragYaw.active) {
      const desired = Math.atan2(car.rt.vx, car.rt.vy);
      this.player.camYaw += normalizeAngle(desired - this.player.camYaw) * Math.min(1, dt * 3);
    }
    const elev = this.interiorMode ? INTERIOR_Y : 0;
    const bx = this.player.x - Math.sin(this.player.camYaw) * dist * Math.cos(pitch);
    const bz = this.player.z - Math.cos(this.player.camYaw) * dist * Math.cos(pitch);
    let camY = elev + 20 + Math.sin(pitch) * dist;
    if (this.shake > 0 && this.settings.shake) camY += (Math.random() - 0.5) * this.shake;
    const target = new Vector3(this.player.x, elev + 12 + this.player.y, this.player.z);
    this.camera.position = new Vector3(
      bx + (this.shake > 0 && this.settings.shake ? (Math.random() - 0.5) * this.shake : 0),
      camY,
      bz,
    );
    this.camera.setTarget(target);
  }

  private updateCars(dt: number): void {
    const wet = this.weather === "rain" ? 0.86 : 1;
    for (const car of this.cars) {
      let v = car.rt;
      if (v.exploded) {
        car.mesh.position.y = 2.5;
        continue;
      }
      if (v.health <= 0) {
        const before = v.exploded;
        v = tickVehicleExplosion(v, dt);
        car.rt = v;
        if (v.exploded && !before) this.boom(car);
        continue;
      }
      const def = vehicleById(v.defId);
      const driving = this.player.vehicleId === v.id;
      if (driving) {
        const axis = this.input.axis();
        const throttle = -axis.y;
        const steer = axis.x;
        const spd = Math.hypot(v.vx, v.vy);
        const hand = this.input.keys.has("Space");
        // Component damage + ground surface both shape the handling model.
        const perf = performanceMultipliers(v);
        const cell = cellAt(this.world, v.x, v.y);
        const ground = cell === Cell.Grass ? surfaceGrip("grass") : cell === Cell.Sand ? surfaceGrip("sand") : cell === Cell.Dirt ? surfaceGrip("gravel") : this.weather === "rain" ? surfaceGrip("wet-asphalt") : surfaceGrip("asphalt");
        const grip = ground * perf.grip;
        v.heading += steer * def.handling * grip * (hand ? 2.1 : 1.25) * dt * (0.35 + Math.min(1, spd / 80));
        const acc = throttle * def.acceleration * perf.accel * dt;
        v.vx += Math.cos(v.heading) * acc;
        v.vy += Math.sin(v.heading) * acc;
        const brake = hand ? def.braking * grip : 28;
        v.vx -= v.vx * Math.min(1, brake * 0.004 * dt * 60);
        v.vy -= v.vy * Math.min(1, brake * 0.004 * dt * 60);
        const max = def.topSpeed * 0.55 * wet * perf.top * (0.6 + grip * 0.4);
        // A lockpicked GPS car keeps snitching until it's repainted at the garage.
        if (def.security === "gps" && v.stolen && !v.registered) {
          this.gpsT += dt;
          if (this.gpsT > 12) {
            this.gpsT = 0;
            this.raiseHeat(1);
            this.flash("GPS TRACKER  ·  this car is snitching  ·  Maya can wipe it");
          }
        }
        const s = Math.hypot(v.vx, v.vy);
        if (s > max) {
          v.vx *= max / s;
          v.vy *= max / s;
        }
        const nx = v.x + v.vx * dt;
        const nz = v.y + v.vy * dt;
        if (blocked(this.world, nx, nz, 12)) {
          const crash = s > VEHICLE_CONFIG.crashSpeedThreshold;
          v = applyVehicleDamage(v, crash ? 18 + s * 0.08 : 6, crash);
          v.vx *= -0.2;
          v.vy *= -0.2;
          this.shake = this.settings.shake ? 5 : 0;
          if (v.health <= 0) this.flash("ENGINE  ·  she's gonna go");
        } else {
          v.x = nx;
          v.y = nz;
        }
        this.player.x = v.x;
        this.player.z = v.y;
        this.player.heading = v.heading;
      } else if (v.id.startsWith("traffic-") && !v.stolen) {
        const spd = 70 * wet;
        v.vx = Math.cos(v.heading) * spd;
        v.vy = Math.sin(v.heading) * spd;
        const nx = v.x + v.vx * dt;
        const nz = v.y + v.vy * dt;
        if (blocked(this.world, nx, nz, 12)) v.heading += Math.PI / 2;
        else {
          v.x = nx;
          v.y = nz;
        }
        if (v.x < 0) v.x = MAP_W * TILE - 8;
        if (v.y < 0) v.y = MAP_H * TILE - 8;
        if (v.x > MAP_W * TILE) v.x = 8;
        if (v.y > MAP_H * TILE) v.y = 8;
      }
      car.rt = v;
      car.mesh.position.set(v.x, 5, v.y);
      car.mesh.rotation.y = -v.heading;
      // Visible damage stages: a battered car starts to list.
      const stage = damageStage(v);
      car.mesh.rotation.z = stage === 1 ? 0.03 : stage === 2 ? 0.08 : 0;
      const hpRatio = v.health / def.durability;
      if (hpRatio < VEHICLE_CONFIG.smokeBelow) {
        car.smoke += dt;
        if (car.smoke > 0.2) {
          car.smoke = 0;
          this.spawnPuff(v.x, 10, v.y, hpRatio < VEHICLE_CONFIG.fireBelow ? "#e07030" : "#5a5248");
        }
      }
    }
  }

  private updateActors(dt: number): void {
    const hour = this.time;
    for (const a of this.actors) {
      if (a.kind === "named") {
        a.mesh.position.set(a.x, 7, a.z);
        continue;
      }
      if (a.recording && a.recording > 0) {
        // Filming: stand still, face the player, phone up.
        a.recording -= dt;
        a.heading = Math.atan2(this.player.z - a.z, this.player.x - a.x);
      } else if (a.panic > 0) {
        a.panic -= dt;
        a.x += Math.cos(a.heading) * 90 * dt;
        a.z += Math.sin(a.heading) * 90 * dt;
      } else {
        const wander = hour > 21 || hour < 5 ? 22 : 38;
        a.heading += (Math.random() - 0.5) * 0.4;
        const nx = a.x + Math.cos(a.heading) * wander * dt;
        const nz = a.z + Math.sin(a.heading) * wander * dt;
        if (!blocked(this.world, nx, nz, 7)) {
          a.x = nx;
          a.z = nz;
        } else a.heading += 1.2;
      }
      a.mesh.position.set(a.x, 7, a.z);
      a.mesh.rotation.y = Math.PI / 2 - a.heading;
    }
  }

  private updateCops(dt: number): void {
    // Suspect description: cops recognize the ride they last saw. Switching
    // cars cuts their ID range hard until they re-spot you up close.
    const sight = recognitionRange(this.heat, this.player.vehicleId ? vehicleById(this.currentDefId()).id : "", POLICE_CONFIG.sightRange);
    const seen =
      !this.interiorMode &&
      this.cops.some(
        (c) => Math.hypot(c.x - this.player.x, c.z - this.player.z) < sight && this.lineOpen(c.x, c.z, this.player.x, this.player.z),
      );
    this.heat = tickHeat(this.heat, dt, seen, this.player.x, this.player.z, 0, this.player.vehicleId ? this.currentDefId() : "");
    let want = copCountForHeat(this.heat.level);
    if (this.crackdown && this.heat.level > 0) want = Math.min(5, want + 1);
    while (this.cops.length < want) this.cops.push(this.makeCop());
    while (this.cops.length > want) {
      const c = this.cops.pop();
      c?.mesh.dispose();
    }
    const speed = PLAYER_CONFIG.sprintSpeed * POLICE_CONFIG.footSpeedRatio * (0.9 + this.heat.level * 0.05);
    let nearest = Infinity;
    for (const c of this.cops) {
      let tx: number;
      let tz: number;
      if (seen) {
        tx = this.player.x;
        tz = this.player.z;
        c.searchT = 0;
      } else if (this.heat.hasLastKnown) {
        // Search zone: sweep around the last known position instead of
        // beelining to the player's true location.
        c.searchT = (c.searchT ?? 0) - dt;
        if (c.searchT <= 0 || c.searchX === undefined) {
          c.searchT = 2.2 + Math.random() * 2;
          const ang = Math.random() * Math.PI * 2;
          const r = Math.random() * this.heat.searchRadius;
          c.searchX = this.heat.lastKnownX + Math.cos(ang) * r;
          c.searchZ = this.heat.lastKnownY + Math.sin(ang) * r;
        }
        tx = c.searchX;
        tz = c.searchZ ?? this.heat.lastKnownY;
      } else {
        tx = this.player.x;
        tz = this.player.z;
      }
      const ang = Math.atan2(tz - c.z, tx - c.x);
      c.heading = ang;
      const nx = c.x + Math.cos(ang) * speed * dt;
      const nz = c.z + Math.sin(ang) * speed * dt;
      if (!blocked(this.world, nx, nz, 8)) {
        c.x = nx;
        c.z = nz;
      }
      c.mesh.position.set(c.x, 7, c.z);
      c.mesh.rotation.y = Math.PI / 2 - ang;
      const d = Math.hypot(c.x - this.player.x, c.z - this.player.z);
      nearest = Math.min(nearest, d);
      if (seen && this.heat.level >= POLICE_CONFIG.copShootMinHeat && d < 190 && Math.random() < POLICE_CONFIG.copShootChancePerTick) {
        this.spawnTracer(c.x, 10, c.z, this.player.x, 8, this.player.z);
        if (Math.random() < 0.4) this.hurt(9);
      }
    }
    this.audio.setSirenDistance(Number.isFinite(nearest) ? nearest : 900);

    // Arrest window: cornered on foot with cops in your face.
    const cornered = this.heat.level >= 1 && !this.player.vehicleId && !this.interiorMode && nearest < 34;
    if (this.input.surrenderQueued) {
      this.input.surrenderQueued = false;
      if (cornered) this.arrest("HANDS UP  ·  smart move");
    }
    if (cornered && nearest < 15) {
      this.surrenderT += dt;
      if (this.surrenderT > 2.4) this.arrest("TACKLED  ·  should have kept running");
    } else {
      this.surrenderT = 0;
    }

    this.cops = this.cops.filter((c) => {
      if (c.hp <= 0) {
        c.mesh.dispose();
        return false;
      }
      return true;
    });
  }

  private currentDefId(): string {
    const car = this.cars.find((c) => c.rt.id === this.player.vehicleId);
    return car ? car.rt.defId : "";
  }

  private arrest(msg: string): void {
    this.jailLeft = 40;
    this.surrenderT = 0;
    this.heat = createHeatState();
    // Contraband is confiscated but you keep your cash minus processing.
    this.loot = [];
    this.player.vehicleId = null;
    this.interiorMode = null;
    this.lockpick = null;
    this.lockpickCar = null;
    this.player.cash = Math.max(0, this.player.cash - 60);
    const precinct = this.world.landmarks.find((l) => l.id === "police");
    if (precinct) {
      // Release onto the open road south of the precinct, facing away from
      // the building, so the camera has clear space and the exit is obvious.
      this.player.x = (precinct.doorX + 0.5) * TILE;
      this.player.z = (precinct.doorY + 3.5) * TILE;
      this.player.heading = Math.PI / 2;
      this.player.camYaw = 0;
    }
    this.flash(msg);
    this.audio.wanted();
    this.onPersist?.(this.snapshot());
  }

  /** Bail out of the holding cell early. Called from the jail overlay. */
  payBail(): boolean {
    if (this.jailLeft <= 0 || this.player.cash < 120) return false;
    this.player.cash -= 120;
    this.jailLeft = 0;
    this.flash("BAIL POSTED  ·  walk out clean");
    this.audio.cash();
    return true;
  }

  private makeCop(): Actor {
    const a = Math.random() * Math.PI * 2;
    const d = POLICE_CONFIG.minSpawnDistance + Math.random() * (POLICE_CONFIG.maxSpawnDistance - POLICE_CONFIG.minSpawnDistance);
    const x = Math.max(40, Math.min(MAP_W * TILE - 40, this.player.x + Math.cos(a) * d));
    const z = Math.max(40, Math.min(MAP_H * TILE - 40, this.player.z + Math.sin(a) * d));
    return {
      id: `cop-${Math.random().toString(36).slice(2, 7)}`,
      kind: "cop",
      name: "NSB",
      x,
      z,
      heading: 0,
      hp: 60,
      panic: 0,
      mesh: this.makeHumanoid(`cop-${Math.random().toString(36).slice(2, 5)}`, "#1a2430", "#d8dde4"),
    };
  }

  private updateTracers(dt: number): void {
    this.lastShot += dt;
    this.tracers = this.tracers.filter((t) => {
      t.life -= dt;
      if (t.life <= 0) {
        t.mesh.dispose();
        return false;
      }
      return true;
    });
  }

  private tryFire(dt: number): void {
    void dt;
    const stickFiring = this.input.aimStick.active && Math.hypot(this.input.aimStick.dx, this.input.aimStick.dy) > 0.35;
    const firing = this.input.firing() || stickFiring;
    if (!firing) return;
    const weapon = weaponById(this.player.weapon);
    if (this.lastShot < weapon.fireInterval) return;

    // Fists: a silent close-range swing.
    if (weapon.id === "fists") {
      this.lastShot = 0;
      this.shake = this.settings.shake ? 2 : 0;
      this.audio.foot(true, "metal");
      const cop = this.cops.find((c) => Math.hypot(c.x - this.player.x, c.z - this.player.z) < weapon.range);
      if (cop) {
        cop.hp -= weapon.damage;
        this.reportCrime("assault");
        this.flash("HOOK  ·  connected");
        return;
      }
      const civ = this.actors.find(
        (a) => a.kind === "civilian" && Math.hypot(a.x - this.player.x, a.z - this.player.z) < weapon.range,
      );
      if (civ) {
        civ.panic = 5;
        civ.heading = Math.atan2(civ.z - this.player.z, civ.x - this.player.x);
        this.reportCrime("assault");
        this.flash("SHOVE  ·  they want no part of you");
      }
      return;
    }

    if (this.player.ammo <= 0) {
      this.flash("CLICK  ·  empty  ·  ammo at Red Pump");
      this.lastShot = 0.05;
      return;
    }
    this.lastShot = 0;
    this.player.ammo -= 1;

    const yaw = this.player.camYaw;
    let heading: number;
    if (stickFiring) {
      // Screen-space stick direction mapped onto the camera basis.
      const dx = this.input.aimStick.dx;
      const dy = this.input.aimStick.dy;
      const wx = Math.cos(yaw) * dx + Math.sin(yaw) * -dy;
      const wz = -Math.sin(yaw) * dx + Math.cos(yaw) * -dy;
      heading = Math.atan2(wz, wx);
    } else {
      // Desktop fires along camera forward.
      heading = Math.atan2(Math.cos(yaw), Math.sin(yaw));
    }

    if (this.aimAssistOn) {
      const targets = [
        ...this.cops.map((c) => ({ id: c.id, x: c.x, y: c.z, isPlayer: false })),
        ...[...this.remoteMeshes.entries()].map(([id, r]) => ({ id, x: r.x, y: r.z, isPlayer: true })),
      ];
      const assisted = assistAim(this.player.x, this.player.z, heading, targets, AIM_ASSIST_CONFIG);
      heading = assisted.heading;
    }

    // Weapon spread gives each gun a personality: pistol snaps, SMG sprays.
    heading += (Math.random() - 0.5) * 2 * weapon.spread;
    const range = weapon.range;
    const tx = this.player.x + Math.cos(heading) * range;
    const tz = this.player.z + Math.sin(heading) * range;
    this.spawnTracer(this.player.x, 9, this.player.z, tx, 9, tz);
    // Muzzle flash right off the barrel.
    this.spawnPuff(this.player.x + Math.cos(heading) * 10, 9, this.player.z + Math.sin(heading) * 10, "#f8e080");
    this.audio.gun();
    this.shake = this.settings.shake ? (weapon.id === "smg" ? 1.6 : 3) : 0;
    this.reportCrime("gunfire");
    this.panicNear();

    // Hit test along the ray against cops and cars.
    for (const c of this.cops) {
      if (pointNearSegment(c.x, c.z, this.player.x, this.player.z, tx, tz, 12)) {
        c.hp -= weapon.damage;
        this.spawnPuff(c.x, 10, c.z, "#c43020");
        this.flash("HIT");
        break;
      }
    }
    for (const car of this.cars) {
      if (!car.rt.exploded && pointNearSegment(car.rt.x, car.rt.y, this.player.x, this.player.z, tx, tz, 16)) {
        car.rt = applyVehicleDamage(car.rt, Math.round(weapon.damage * 0.65), false);
        this.spawnPuff(car.rt.x, 8, car.rt.y, "#e8d8a0");
        if (Math.random() < 0.3) {
          car.rt = shootTire(car.rt);
          this.flash("TIRE  ·  shredded, she'll wander now");
        }
        if (car.rt.health <= 0) this.flash("CAR  ·  fuel tank's punching out");
        break;
      }
    }
  }

  private spawnTracer(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const line = MeshBuilder.CreateBox("tr", { width: len, depth: 0.8, height: 0.8 }, this.scene);
    line.material = this.material("#f3e6d2", 0.9);
    line.position = new Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    line.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
    this.tracers.push({ mesh: line, life: 0.08 });
  }

  private spawnPuff(x: number, y: number, z: number, hex: string): void {
    const p = MeshBuilder.CreateBox("puff", { size: 3 + Math.random() * 3 }, this.scene);
    p.material = this.material(hex, 0.4);
    p.position = new Vector3(x + (Math.random() - 0.5) * 6, y + Math.random() * 4, z + (Math.random() - 0.5) * 6);
    this.tracers.push({ mesh: p, life: 0.4 });
  }

  private tryInteract(): void {
    if (!this.player.vehicleId) {
      const car = this.nearestCar(34);
      if (car && !car.rt.exploded) {
        const def = vehicleById(car.rt.defId);
        // Security tiers: cheap cars open right up; nicer rides need a pick.
        if (def.security !== "none" && !this.unlocked.has(car.rt.id) && !car.rt.stolen) {
          const lockedOut = (this.alarmLockout.get(car.rt.id) ?? 0) > this.clock;
          if (lockedOut) {
            this.flash("ALARM RINGING  ·  too hot right now, come back in a minute");
            return;
          }
          this.lockpick = createLockpick(def.security);
          this.lockpickCar = car;
          this.pickFireHeld = this.input.firing();
          const label = def.security === "lock" ? "door lock" : def.security === "immobilizer" ? "immobilizer" : "immobilizer + GPS";
          this.flash(`LOCKED  ·  ${def.name} has ${label}  ·  E when the pin hits the zone`);
          this.audio.uiClick();
          return;
        }
        this.enterCar(car);
        return;
      }
    }
    const named = this.actors.find((a) => a.kind === "named" && Math.hypot(a.x - this.player.x, a.z - this.player.z) < 40);
    if (named?.talk) {
      const line = named.talk[Math.min(named.talk.length - 1, this.mission.step)] ?? named.talk[0];
      this.say(named.name, line ?? "...");
      if (named.id === "rico" && this.mission.id === "fresh-off-the-bus") {
        this.mission.step = Math.max(this.mission.step, 2);
        this.player.phone = true;
      }
      if (named.id === "maya" && this.mission.id === "borrowed-wheels") this.mission.step = Math.max(this.mission.step, 3);
      return;
    }
    const mark = landmarkAt(this.world, this.player.x, this.player.z);
    if (mark) this.useLandmark(mark);
  }

  private useLandmark(mark: Landmark): void {
    if (mark.id === "police") {
      this.flash(this.heat.level > 0 ? "NCPD  ·  bold of you to knock" : "NCPD  ·  nothing for you here, keep moving");
      return;
    }
    if (mark.id === "coral-mart") return this.enterMart();
    if (mark.id === "jewelry") return this.robJewelry();
    if (mark.id === "race-start") return this.startRace();
    if (mark.id === "warehouse") {
      this.player.crate = true;
      this.flash("CARGO  ·  crate lifted");
      this.raiseHeat(1);
      return;
    }
    if (mark.id === "apartment") {
      this.player.health = 100;
      this.heat = createHeatState();
      this.flash("SAFEHOUSE  ·  heat washed");
      return;
    }
    if (mark.id === "maya-garage") {
      const car = this.cars.find((c) => c.rt.id === this.player.vehicleId);
      // Rare event car: Maya buys it outright.
      if (car && this.eventCarIds.has(car.rt.id)) {
        this.eventCarIds.delete(car.rt.id);
        this.player.vehicleId = null;
        car.rt.exploded = true;
        car.mesh.setEnabled(false);
        this.player.cash += 520;
        this.player.streetRep += 8;
        this.audio.cash();
        this.flash("MAYA  ·  $520 for the rare Mirage  ·  don't ask where it goes");
        this.pushNews("Unknown driver delivers a ghost-plate Mirage to a Southside garage.");
        return;
      }
      if (car) {
        const def = vehicleById(car.rt.defId);
        const cost = 40;
        if (this.player.cash >= cost) {
          this.player.cash -= cost;
          car.rt.health = def.durability;
          car.rt.engine = 1;
          car.rt.tires = 1;
          car.rt.burning = false;
          if (car.rt.stolen) {
            car.rt.registered = true;
            this.flash(`MAYA  ·  fixed, papered, GPS wiped  ·  $${cost}`);
          } else {
            this.flash(`MAYA  ·  full workup  ·  $${cost}`);
          }
        } else {
          this.flash("MAYA  ·  no cash, no wrench");
        }
        return;
      }
      this.flash("GARAGE  ·  roll something in and she'll paper it");
      return;
    }
    if (mark.id === "secret-bunker") {
      // The Painted Door is the district fence.
      if (this.loot.length > 0) {
        const paid = fenceValue(this.loot, this.fenceRep);
        const what = this.loot.map((l) => lootLabel(l.origin)).join(", ");
        this.loot = [];
        this.fenceRep += 1;
        this.player.cash += paid;
        this.audio.cash();
        this.flash(`FENCE  ·  ${what}  ·  $${paid} cash, no questions`);
        return;
      }
      // No loot? The fence sells hardware. Double-knock to confirm.
      const smg = weaponById("smg");
      if (this.player.weapon !== "smg" && this.player.cash >= smg.price) {
        if (this.fenceOfferT > 0) {
          this.player.cash -= smg.price;
          this.player.weapon = "smg";
          this.player.ammo = Math.max(this.player.ammo, 90);
          this.fenceOfferT = 0;
          this.audio.cash();
          this.flash(`FENCE  ·  ${smg.name} + 90 rounds  ·  it never happened`);
        } else {
          this.fenceOfferT = 5;
          this.flash(`FENCE  ·  ${smg.name}, $${smg.price}  ·  knock again to take it`);
        }
        return;
      }
      this.flash("PAINTED DOOR  ·  bring something hot and knock twice");
      return;
    }
    if (mark.id === "gas") {
      const car = this.cars.find((c) => c.rt.id === this.player.vehicleId);
      if (car) {
        car.rt.health = vehicleById(car.rt.defId).durability;
        car.rt.burning = false;
        this.player.cash = Math.max(0, this.player.cash - ECONOMY_CONFIG.gasRepairCost);
        this.flash(`PUMP  ·  topped off, $${ECONOMY_CONFIG.gasRepairCost}`);
      } else if (this.player.weapon === "pistol") {
        if (this.player.cash >= 25) {
          this.player.cash -= 25;
          this.player.ammo += 12;
          this.flash("AMMO  ·  +12, $25");
        }
      }
      return;
    }
    this.flash(sanitizeText(mark.name, 28));
  }

  private robStore(): void {
    if (this.completed.includes("easy-money") && this.mission.id !== "easy-money") {
      this.flash("CLERK  ·  cameras remember your face");
      this.raiseHeat(1);
      return;
    }
    // Robbery yields loot with an origin — fence it at the Painted Door.
    this.loot.push({ origin: "store-robbery", value: ECONOMY_CONFIG.martRobbery });
    this.player.weapon = "pistol";
    this.player.ammo = Math.max(this.player.ammo, 24);
    // The clerk always counts as one witness.
    this.reportCrime("robbery", 1);
    this.audio.cash();
    this.audio.wanted();
    this.shake = 6;
    this.flash("CORAL MART  ·  cash bag grabbed  ·  fence it at the Painted Door");
    this.mission.step = Math.max(this.mission.step, 1);
    this.panicNear();
  }

  private robJewelry(): void {
    this.loot.push({ origin: "jewelry", value: ECONOMY_CONFIG.jewelryRobbery });
    this.reportCrime("robbery", 1);
    this.audio.cash();
    this.flash("SUNSET CASES  ·  glass gone  ·  that ice needs a fence");
    if (this.mission.id === "sunset-jewelry") this.mission.step = Math.max(this.mission.step, 3);
    this.panicNear();
  }

  private panicNear(): void {
    let filming = false;
    for (const a of this.actors) {
      if (a.kind === "named") continue;
      if (Math.hypot(a.x - this.player.x, a.z - this.player.z) < 180) {
        // Some locals film the chaos instead of running.
        if (Math.random() < 0.25) {
          a.recording = 5;
          a.panic = 0;
          filming = true;
        } else {
          a.recording = 0;
          a.panic = 4;
          a.heading = Math.atan2(a.z - this.player.z, a.x - this.player.x);
        }
      }
    }
    if (filming && Math.random() < 0.5) this.flash("A LOCAL IS FILMING YOU  ·  that clip is going up tonight");
  }

  private enterCar(car: CarEntity): void {
    this.player.vehicleId = car.rt.id;
    if (!car.rt.stolen) {
      car.rt.stolen = true;
      this.reportCrime("car-theft");
    }
    this.gpsT = 0;
    this.flash(`WHEELS  ·  ${vehicleById(car.rt.defId).name}`);
    this.audio.uiClick();
  }

  /**
   * Crimes only matter if someone sees them. Civilian callers take a few
   * seconds to dial, cops react instantly, and an empty alley stays silent.
   */
  private reportCrime(kind: CrimeKind, minWitnesses = 0): void {
    const witnesses = Math.max(
      minWitnesses,
      this.actors.filter(
        (a) => Math.hypot(a.x - this.player.x, a.z - this.player.z) < 150 && this.lineOpen(a.x, a.z, this.player.x, this.player.z),
      ).length,
    );
    const copSaw = this.cops.some(
      (c) => Math.hypot(c.x - this.player.x, c.z - this.player.z) < POLICE_CONFIG.sightRange && this.lineOpen(c.x, c.z, this.player.x, this.player.z),
    );
    const report = witnessReport(kind, witnesses, copSaw);
    if (!report.reported) {
      if (kind === "car-theft" || kind === "robbery") this.flash("NO WITNESSES  ·  nobody saw a thing");
      return;
    }
    if (report.delay <= 0) {
      this.raiseHeat(report.heatAdd);
    } else if (this.pendingReports.length < 2) {
      this.pendingReports.push({ t: report.delay, heatAdd: report.heatAdd });
      this.flash("WITNESS  ·  someone's dialing 911  ·  move");
    }
  }

  private exitVehicle(): void {
    const car = this.cars.find((c) => c.rt.id === this.player.vehicleId);
    this.player.vehicleId = null;
    if (car) {
      const side = car.rt.heading + Math.PI / 2;
      let ex = car.rt.x + Math.cos(side) * 24;
      let ez = car.rt.y + Math.sin(side) * 24;
      if (blocked(this.world, ex, ez, PLAYER_CONFIG.radius)) {
        ex = car.rt.x - Math.cos(side) * 24;
        ez = car.rt.y - Math.sin(side) * 24;
      }
      if (!blocked(this.world, ex, ez, PLAYER_CONFIG.radius)) {
        this.player.x = ex;
        this.player.z = ez;
      }
      car.rt.vx *= 0.2;
      car.rt.vy *= 0.2;
    }
  }

  private nearestCar(r: number): CarEntity | undefined {
    let best: CarEntity | undefined;
    let d = r;
    for (const c of this.cars) {
      if (c.rt.exploded) continue;
      const n = Math.hypot(c.rt.x - this.player.x, c.rt.y - this.player.z);
      if (n < d) {
        d = n;
        best = c;
      }
    }
    return best;
  }

  private applyWorldEvent(event: WorldEventDef): void {
    this.pushNews(event.headline);
    switch (event.id) {
      case "armored-truck": {
        const rt = createVehicleRuntime("ironback", 40 * TILE, 23.5 * TILE, 0, "#22303e");
        rt.id = `event-truck-${Math.random().toString(36).slice(2, 6)}`;
        rt.health = 420;
        this.eventCarIds.add(rt.id);
        this.cars.push({ rt, mesh: this.makeCarMesh(rt.id, "#22303e", false), smoke: 0 });
        break;
      }
      case "rare-car": {
        const rt = createVehicleRuntime("mirage", 68 * TILE, 11.5 * TILE, 0, "#c8a028");
        rt.id = `event-rare-${Math.random().toString(36).slice(2, 6)}`;
        this.eventCarIds.add(rt.id);
        this.cars.push({ rt, mesh: this.makeCarMesh(rt.id, "#c8a028", false), smoke: 0 });
        this.flash("RUMOR  ·  gold Mirage left near Ansem's mural  ·  Maya pays cash");
        break;
      }
      case "blackout":
        this.blackout = true;
        this.flash("BLACKOUT  ·  Southside just went dark");
        break;
      case "storm":
        this.storm = true;
        this.flash("STORM  ·  roads are slick, grip is gone");
        break;
      case "police-crackdown":
        this.crackdown = true;
        this.flash("CRACKDOWN  ·  extra patrols on every block");
        break;
      case "street-race": {
        const rt = createVehicleRuntime("needle", 50 * TILE, 63 * TILE, 0, "#b03a28");
        rt.id = `event-race-${Math.random().toString(36).slice(2, 6)}`;
        this.cars.push({ rt, mesh: this.makeCarMesh(rt.id, "#b03a28", false), smoke: 0 });
        this.flash("RACE NIGHT  ·  a Needle is waiting at the Midnight Line");
        break;
      }
      default: {
        const _never: never = event.id;
        void _never;
      }
    }
  }

  private pushNews(text: string): void {
    this.news = sanitizeText(text, 90);
    this.newsT = 9;
  }

  private boom(car: CarEntity): void {
    // Armored trucks spill their case when they finally give out.
    if (this.eventCarIds.has(car.rt.id)) {
      this.eventCarIds.delete(car.rt.id);
      if (Math.hypot(this.player.x - car.rt.x, this.player.z - car.rt.y) < 160) {
        this.loot.push({ origin: "armored-truck", value: 400 });
        this.raiseHeat(2);
        this.flash("ARMORED CASE  ·  grabbed  ·  fence it before they fence you");
        this.pushNews("Armored truck hit in Southside. NCPD promises arrests.");
      }
    }
    this.audio.explosion();
    this.shake = this.settings.reduceFlashes ? 4 : 10;
    for (let i = 0; i < 22; i++) {
      this.spawnPuff(car.rt.x, 8 + Math.random() * 14, car.rt.y, i % 2 ? "#f0b040" : "#d84020");
    }
    const wreck = this.material("#2a1c14");
    car.mesh.material = wreck;
    for (const child of car.mesh.getChildMeshes()) child.material = wreck;
    if (this.player.vehicleId === car.rt.id) {
      this.exitVehicle();
      this.hurt(VEHICLE_CONFIG.explosionDamageDriver);
    }
    if (Math.hypot(this.player.x - car.rt.x, this.player.z - car.rt.y) < 70) this.hurt(VEHICLE_CONFIG.explosionDamageNear);
    this.raiseHeat(1);
    this.flash("BOOM  ·  wreck stays in the street");
  }

  private raiseHeat(n: number): void {
    const before = this.heat.level;
    this.heat = tickHeat(this.heat, 0, true, this.player.x, this.player.z, n, this.player.vehicleId ? this.currentDefId() : "");
    if (this.heat.level > before) this.audio.wanted();
  }

  private hurt(n: number): void {
    let left = n;
    if (this.player.armor > 0) {
      const a = Math.min(this.player.armor, left);
      this.player.armor -= a;
      left -= a;
    }
    this.player.health -= left;
    this.missionStat.dmg += left;
    this.shake = 4;
  }

  private die(): void {
    this.player.health = 100;
    this.player.x = this.world.spawnX;
    this.player.z = this.world.spawnY;
    this.player.vehicleId = null;
    this.player.cash = Math.max(0, this.player.cash - PLAYER_CONFIG.respawnMedicalFee);
    this.player.crate = false;
    this.heat = createHeatState();
    this.flash(`COUNTY  ·  $${PLAYER_CONFIG.respawnMedicalFee} medical  ·  street cash lighter`);
    this.onPersist?.(this.snapshot());
  }

  /**
   * Called by the shell after the chain indexer confirms wallet contents.
   * Any verified NFT holder gets the Chainline Mirage parked by the walk-up:
   * a registered (never "stolen"), GPS-clean prestige ride. On-chain
   * ownership is never affected by anything that happens to it in-game.
   */
  setWalletAssets(nftCount: number): void {
    this.walletNfts = nftCount;
    if (nftCount > 0 && !this.chainCarSpawned) {
      this.chainCarSpawned = true;
      const rt = createVehicleRuntime("mirage", 15 * TILE, 65.5 * TILE, 0, "#d8b430", true);
      rt.id = "chainline-mirage";
      rt.registered = true;
      this.cars.push({ rt, mesh: this.makeCarMesh(rt.id, "#d8b430", false), smoke: 0 });
      this.flash("CHAINLINE MIRAGE  ·  your collector ride is parked by the walk-up");
      this.pushNews("A verified collector just rolled into Southside.");
    }
  }

  /** Vault: banked cash survives death and arrest. Called from the phone. */
  bankDeposit(n: number): number {
    const amt = Math.max(0, Math.min(n, this.player.cash));
    this.player.cash -= amt;
    this.player.bank += amt;
    if (amt > 0) this.audio.cash();
    return amt;
  }

  bankWithdraw(n: number): number {
    const amt = Math.max(0, Math.min(n, this.player.bank));
    this.player.bank -= amt;
    this.player.cash += amt;
    if (amt > 0) this.audio.cash();
    return amt;
  }

  /** Called by the shell after the server issues a contract. */
  startContract(def: ContractDef): void {
    this.contract = { def, stage: "pickup" };
    this.say("Burner phone", `${def.title}: ${def.brief}`);
    this.flash(`CONTRACT  ·  ${def.title}  ·  $${def.reward}`);
  }

  private updateContract(): void {
    if (!this.contract) return;
    const { def, stage } = this.contract;
    const targetId = stage === "pickup" ? def.pickupLandmark : def.dropLandmark;
    const mark = this.world.landmarks.find((l) => l.id === targetId);
    if (!mark) return;
    const d = Math.hypot(this.player.x - (mark.doorX + 0.5) * TILE, this.player.z - (mark.doorY + 0.5) * TILE);
    if (d > 50) return;
    if (stage === "pickup") {
      this.contract = { def, stage: "drop" };
      this.audio.uiClick();
      this.flash(`PICKED UP  ·  now get it to the drop`);
    } else {
      this.contract = null;
      // Local feedback now; the server validates and settles the real reward.
      this.player.cash += def.reward;
      this.player.xp += def.xp;
      this.player.streetRep += def.rep;
      this.audio.cash();
      this.flash(`CONTRACT DONE  ·  ${def.title}  ·  $${def.reward}`);
      this.pushNews(`Quiet job finished clean somewhere in Southside. Nobody's talking.`);
      this.onContractComplete?.(def.id);
      this.onPersist?.(this.snapshot());
    }
  }

  private updateMissions(): void {
    this.updateContract();
    const m = nextMission(this.completed);
    if (m && m.id !== this.mission.id && this.completed.includes(this.mission.id)) {
      this.mission = { id: m.id, step: 0, raceHits: 0 };
    }
    if (this.mission.id === "fresh-off-the-bus") {
      const rico = landmarkAt(this.world, this.player.x, this.player.z, 70);
      if (rico?.id === "rico-hideout") this.mission.step = Math.max(this.mission.step, 1);
      if (this.mission.step >= 2) this.complete("fresh-off-the-bus");
    }
    if (this.mission.id === "borrowed-wheels") {
      const maya = landmarkAt(this.world, this.player.x, this.player.z, 60);
      if (this.player.vehicleId === "sparrow-job" && maya?.id === "maya-garage") this.mission.step = Math.max(this.mission.step, 2);
      if (this.mission.step >= 3) this.complete("borrowed-wheels");
    }
    if (this.mission.id === "easy-money" && this.mission.step >= 1 && this.heat.level === 0) this.complete("easy-money");
    if (this.mission.id === "midnight-run") {
      const cp = RACE_CPS[this.mission.raceHits];
      if (cp && Math.hypot(this.player.x - cp.x, this.player.z - cp.z) < 48) {
        this.mission.raceHits += 1;
        this.flash(`CHECKPOINT  ${this.mission.raceHits}/${RACE_CPS.length}`);
      }
      if (this.mission.raceHits >= RACE_CPS.length) this.complete("midnight-run");
    }
    if (this.mission.id === "port-authority") {
      if (this.player.crate) this.mission.step = Math.max(this.mission.step, 2);
      const rico = landmarkAt(this.world, this.player.x, this.player.z, 50);
      if (this.player.crate && rico?.id === "rico-hideout") {
        this.player.crate = false;
        this.complete("port-authority");
      }
    }
    if (this.mission.id === "sunset-jewelry") {
      const near = landmarkAt(this.world, this.player.x, this.player.z, 50);
      if (near?.id === "jewelry") this.mission.step = Math.max(this.mission.step, 1);
      if (this.player.vehicleId) this.mission.step = Math.max(this.mission.step, 2);
      if (this.mission.step >= 3 && near?.id === "apartment") this.complete("sunset-jewelry");
    }
  }

  private complete(id: string): void {
    if (this.completed.includes(id)) return;
    const def = [...MISSIONS, HEIST_SUNSET].find((mm) => mm.id === id);
    if (!def) return;
    this.completed.push(id);
    const r = applyReward(this.player.cash, this.player.xp, this.player.streetRep, def);
    this.player.cash = r.cash;
    this.player.xp = r.xp;
    this.player.streetRep = r.streetRep;
    this.audio.cash();
    const rank = missionRating(this.missionStat.t, 180, this.missionStat.dmg, this.missionStat.maxHeat);
    this.flash(`JOB DONE  ·  ${def.title}  ·  RANK ${rank}  ·  $${def.cash}`);
    if (rank === "S") this.pushNews(`Somebody just ran "${def.title}" flawless. Southside noticed.`);
    this.missionStat = { t: 0, dmg: 0, maxHeat: 0 };
    this.onMissionComplete?.(id);
    const n = nextMission(this.completed);
    this.mission = { id: n?.id ?? id, step: 0, raceHits: 0 };
    this.onPersist?.(this.snapshot());
  }

  /**
   * City services: a tow truck eventually rolls out and hauls wrecks away,
   * so destroyed cars do not litter the streets forever.
   */
  private updateTow(dt: number): void {
    if (this.tow) {
      const wreck = this.cars.find((c) => c.rt.id === this.tow?.targetId);
      if (!wreck) {
        this.tow.mesh.dispose();
        this.tow = null;
        return;
      }
      const t = this.tow.mesh.position;
      const ang = Math.atan2(wreck.rt.y - t.z, wreck.rt.x - t.x);
      t.x += Math.cos(ang) * 95 * dt;
      t.z += Math.sin(ang) * 95 * dt;
      this.tow.mesh.rotation.y = -ang;
      if (Math.hypot(t.x - wreck.rt.x, t.z - wreck.rt.y) < 26) {
        wreck.mesh.dispose();
        this.cars = this.cars.filter((c) => c !== wreck);
        this.tow.mesh.dispose();
        this.tow = null;
        if (Math.hypot(this.player.x - wreck.rt.x, this.player.z - wreck.rt.y) < 420) {
          this.flash("CITY TOW  ·  wreck cleared");
        }
      }
      return;
    }
    this.towCooldown -= dt;
    if (this.towCooldown > 0) return;
    this.towCooldown = 18;
    const wreck = this.cars.find(
      (c) => c.rt.exploded && Math.hypot(c.rt.x - this.player.x, c.rt.y - this.player.z) > 140 && !this.eventCarIds.has(c.rt.id),
    );
    if (!wreck) return;
    const mesh = this.makeCarMesh(`tow-${Math.random().toString(36).slice(2, 6)}`, "#c8a028", false);
    const ang = Math.random() * Math.PI * 2;
    mesh.position = new Vector3(wreck.rt.x + Math.cos(ang) * 500, 5, wreck.rt.y + Math.sin(ang) * 500);
    this.tow = { mesh, targetId: wreck.rt.id };
  }

  /** Repeatable Midnight Line street race, unlocked after the story race. */
  private startRace(): void {
    if (!this.completed.includes("midnight-run")) {
      this.flash("MIDNIGHT LINE  ·  finish Maya's race first");
      return;
    }
    if (this.race) return;
    const marker = MeshBuilder.CreateBox("race-marker", { width: 10, depth: 10, height: 60 }, this.scene);
    marker.material = this.material("#e0a030", 0.8);
    this.race = { checkpoint: 0, t: 0, marker };
    this.flash("RACE  ·  hit the pylons  ·  clock's running");
    this.audio.wanted();
  }

  private updateRace(dt: number): void {
    if (!this.race) return;
    this.race.t += dt;
    const cp = RACE_CPS[this.race.checkpoint];
    if (!cp) {
      this.finishRace();
      return;
    }
    this.race.marker.position.set(cp.x, 30, cp.z);
    this.race.marker.rotation.y += dt * 2;
    if (Math.hypot(this.player.x - cp.x, this.player.z - cp.z) < 48) {
      this.race.checkpoint += 1;
      this.audio.uiClick();
      if (this.race.checkpoint >= RACE_CPS.length) this.finishRace();
      else this.flash(`CHECKPOINT  ${this.race.checkpoint}/${RACE_CPS.length}  ·  ${this.race.t.toFixed(1)}s`);
    }
  }

  private finishRace(): void {
    if (!this.race) return;
    const seconds = this.race.t;
    this.race.marker.dispose();
    this.race = null;
    const result = raceResult(seconds);
    this.player.cash += result.cash;
    const ms = Math.round(seconds * 1000);
    const isRecord = this.player.raceBestMs === 0 || ms < this.player.raceBestMs;
    if (isRecord) this.player.raceBestMs = ms;
    this.audio.cash();
    this.flash(`RACE  ·  ${seconds.toFixed(1)}s  ·  RANK ${result.rank}  ·  $${result.cash}${isRecord ? "  ·  NEW RECORD" : ""}`);
    if (isRecord && result.rank === "S") this.pushNews("Unknown racer breaks the Midnight Line record.");
    this.onPersist?.(this.snapshot());
  }

  private updateRemotes(): void {
    for (const r of this.remoteMeshes.values()) {
      // Smooth toward network position.
      const mesh = r.mesh;
      mesh.position.x += (r.x - mesh.position.x) * 0.2;
      mesh.position.z += (r.z - mesh.position.z) * 0.2;
      mesh.position.y = 7;
    }
  }

  private lineOpen(x0: number, z0: number, x1: number, z1: number): boolean {
    const steps = 8;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (blocked(this.world, x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, 2)) return false;
    }
    return true;
  }

  private say(who: string, line: string): void {
    this.dialogue = { who: sanitizeText(who, 24), line: sanitizeText(line, 140), t: 5.5 };
  }

  private flash(text: string): void {
    this.toast = sanitizeText(text, 80);
    this.toastT = 3.2;
  }

  // ------------------------------------------------------------- debug API

  debugTeleport(spot: "rico" | "mart" | "garage" | "port" | "race"): void {
    const map: Record<string, [number, number]> = {
      rico: [29 * TILE, 49 * TILE],
      mart: [43 * TILE, 49 * TILE],
      garage: [57 * TILE, 63 * TILE],
      port: [82 * TILE, 62 * TILE],
      race: [50 * TILE, 65 * TILE],
    };
    const [x, z] = map[spot] ?? [this.player.x, this.player.z];
    this.player.vehicleId = null;
    this.player.x = x;
    this.player.z = z;
  }

  private debugSpawnToggle = false;
  debugSpawnCar(): void {
    // Alternate an open beater and a locked Mirage so both paths are testable.
    this.debugSpawnToggle = !this.debugSpawnToggle;
    const defId = this.debugSpawnToggle ? "sparrow" : "mirage";
    const color = this.debugSpawnToggle ? "#a05a2c" : "#2f6f78";
    const rt = createVehicleRuntime(defId, this.player.x + 40, this.player.z, 0, color);
    rt.id = `debug-${Math.random().toString(36).slice(2, 6)}`;
    this.cars.push({ rt, mesh: this.makeCarMesh(rt.id, color, false), smoke: 0 });
  }

  debugSetHeat(level: number): void {
    this.heat = createHeatState();
    if (level > 0) this.heat = tickHeat(this.heat, 0, true, this.player.x, this.player.z, level);
  }

  debugGiveWeapon(): void {
    this.player.weapon = "pistol";
    this.player.ammo = 60;
  }

  debugHeal(): void {
    this.player.health = 100;
    this.player.armor = 50;
  }

  // ----------------------------------------------------------------- HUD

  private hud(): HudSnapshot {
    const def = [...MISSIONS, HEIST_SUNSET].find((mm) => mm.id === this.mission.id);
    let obj = def?.objectives[Math.min(this.mission.step, def.objectives.length - 1)]?.label ?? "Explore Southside";
    if (this.contract) {
      obj = this.contract.stage === "pickup" ? `CONTRACT  ·  pickup: ${this.contract.def.brief}` : "CONTRACT  ·  make the drop";
    }
    if (this.race) obj = `RACE  ·  ${this.race.checkpoint}/${RACE_CPS.length}  ·  ${this.race.t.toFixed(1)}s`;
    const mark = landmarkAt(this.world, this.player.x, this.player.z);
    const car = this.nearestCar(34);
    let prompt = "";
    const nearestCop = this.cops.reduce((min, c) => Math.min(min, Math.hypot(c.x - this.player.x, c.z - this.player.z)), Infinity);
    if (this.jailLeft > 0) prompt = "";
    else if (this.interiorMode) prompt = this.interiorPrompt();
    else if (this.lockpick) prompt = "E  ·  PICK when the pin is in the zone";
    else if (this.heat.level >= 1 && !this.player.vehicleId && nearestCop < 34) prompt = "G  ·  SURRENDER (jail beats the morgue)";
    else if (!this.player.vehicleId && car) {
      const carDef = vehicleById(car.rt.defId);
      const locked = carDef.security !== "none" && !this.unlocked.has(car.rt.id) && !car.rt.stolen;
      const lockedOut = (this.alarmLockout.get(car.rt.id) ?? 0) > this.clock;
      prompt = locked ? (lockedOut ? `${carDef.name}  ·  ALARM RINGING` : `E  ·  LOCKPICK ${carDef.name}`) : `E  ·  DRIVE ${carDef.name}`;
    } else if (this.player.vehicleId) prompt = "E  ·  EXIT";
    else if (mark) prompt = `E  ·  ${mark.name}`;
    const drive = this.cars.find((c) => c.rt.id === this.player.vehicleId);
    return {
      cash: this.player.cash,
      bank: this.player.bank,
      heat: this.heat.level,
      health: Math.max(0, Math.round(this.player.health)),
      armor: Math.round(this.player.armor),
      xp: this.player.xp,
      level: Math.max(1, Math.floor(1 + Math.sqrt(this.player.xp / 180))),
      streetRep: this.player.streetRep,
      objective: sanitizeText(obj, 64),
      prompt: sanitizeText(prompt, 48),
      assist: assistHint(this.heat.level, this.heat.hiddenTimer, hideSpotNear(this.world, this.player.x, this.player.z)),
      station: this.audio.stationLabel(),
      musicOn: this.audio.playing,
      wantedFlash: this.heat.level >= 3,
      dayLabel: this.time < 6 ? "DAWN" : this.time < 11 ? "MORNING" : this.time < 17 ? "DAY" : this.time < 20 ? "DUSK" : "NIGHT",
      weather: this.weather,
      inVehicle: Boolean(this.player.vehicleId),
      vehicleHp: drive ? Math.round((drive.rt.health / vehicleById(drive.rt.defId).durability) * 100) : 100,
      dialogue: this.dialogue ? { who: this.dialogue.who, line: this.dialogue.line } : null,
      toast: this.toast,
      phoneOpen: this.player.phone,
      interior: this.interiorMode ? "Coral Mart" : null,
      username: this.username,
      others: this.remoteMeshes.size,
      lockpick: this.lockpick
        ? { pos: this.lockpick.pos, zoneStart: this.lockpick.zoneStart, zoneEnd: this.lockpick.zoneEnd, picksLeft: this.lockpick.picksLeft }
        : null,
      jailLeft: Math.ceil(this.jailLeft),
      news: this.news,
      lootValue: this.loot.reduce((s, l) => s + l.value, 0),
      searchZone: this.heat.level > 0 && this.heat.hiddenTimer > 0.5,
      gamepad: this.input.gamepadOn,
      contractLine: this.contract ? `${this.contract.def.title}  ·  ${this.contract.stage === "pickup" ? "PICKUP" : "DROP"}` : "",
      weapon: weaponById(this.player.weapon).name,
      ammo: this.player.weapon === "fists" ? 0 : this.player.ammo,
      raceBestMs: this.player.raceBestMs,
    };
  }

  private drawMinimap(): void {
    const c = this.minimap;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const s = c.width;
    ctx.fillStyle = "#241c16";
    ctx.fillRect(0, 0, s, s);
    const scale = s / (MAP_W * TILE);
    ctx.fillStyle = "#35302c";
    for (const yTile of [10, 22, 36, 50, 64]) ctx.fillRect(0, yTile * TILE * scale, s, 3 * TILE * scale);
    for (const xTile of [8, 22, 36, 50, 64, 80]) ctx.fillRect(xTile * TILE * scale, 0, 3 * TILE * scale, s);
    ctx.fillStyle = "#e0a030";
    for (const lm of this.world.landmarks) {
      ctx.fillRect(lm.x * TILE * scale, lm.y * TILE * scale, Math.max(2, lm.w * TILE * scale * 0.5), Math.max(2, lm.h * TILE * scale * 0.5));
    }
    ctx.fillStyle = "#6aa0d4";
    for (const cop of this.cops) ctx.fillRect(cop.x * scale - 1.5, cop.z * scale - 1.5, 3, 3);
    if (this.heat.level > 0 && this.heat.hasLastKnown) {
      ctx.strokeStyle = "rgba(106, 160, 212, 0.65)";
      ctx.beginPath();
      ctx.arc(this.heat.lastKnownX * scale, this.heat.lastKnownY * scale, Math.max(4, this.heat.searchRadius * scale), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = "#e6c39a";
    for (const r of this.remoteMeshes.values()) ctx.fillRect(r.x * scale - 1.5, r.z * scale - 1.5, 3, 3);
    ctx.fillStyle = "#c45a32";
    ctx.beginPath();
    ctx.arc(this.player.x * scale, this.player.z * scale, 3.2, 0, Math.PI * 2);
    ctx.fill();
    const yawX = Math.cos(this.player.heading);
    const yawZ = Math.sin(this.player.heading);
    ctx.strokeStyle = "#f3e6d2";
    ctx.beginPath();
    ctx.moveTo(this.player.x * scale, this.player.z * scale);
    ctx.lineTo(this.player.x * scale + yawX * 7, this.player.z * scale + yawZ * 7);
    ctx.stroke();
  }
}

function pointNearSegment(px: number, pz: number, x0: number, z0: number, x1: number, z1: number, r: number): boolean {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len2 = dx * dx + dz * dz;
  if (len2 === 0) return Math.hypot(px - x0, pz - z0) < r;
  let t = ((px - x0) * dx + (pz - z0) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x0 + dx * t), pz - (z0 + dz * t)) < r;
}

export function headingFromCamera(camYaw: number): number {
  return normalizeAngle(Math.atan2(Math.cos(camYaw), Math.sin(camYaw)));
}
