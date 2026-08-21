import { Engine } from "@babylonjs/core/Engines/engine";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Scene } from "@babylonjs/core/scene";
import {
  AIM_ASSIST_CONFIG,
  AIM_CONFIG,
  applyReward,
  applyVehicleDamage,
  collisionDamage,
  COLLISION_CONFIG,
  assistAim,
  assistHint,
  attemptPick,
  copCarsForHeat,
  copCountForHeat,
  comboMultiplier,
  createDirector,
  createHeatState,
  createLockpick,
  createThrill,
  createVehicleRuntime,
  driftValue,
  ECONOMY_CONFIG,
  fenceValue,
  HEIST_SUNSET,
  hitStopSeconds,
  impactShake,
  isDrifting,
  lootLabel,
  maxSpeedFor,
  MISSIONS,
  missionRating,
  nearMissValue,
  nextMission,
  normalizeAngle,
  damageStage,
  performanceMultipliers,
  PLAYER_CONFIG,
  POLICE_CONFIG,
  raceResult,
  normalizeAngleTo,
  pedestrianImpact,
  PURSUIT_CONFIG,
  pursuitInput,
  reloadAmount,
  recognitionRange,
  resolveCarCollision,
  scoreStunt,
  shootTire,
  SPIDER_CONFIG,
  anchorUsable,
  initialLength,
  lineCeiling,
  reelToCeiling,
  releaseSwing,
  stepAirborne,
  stepSwing,
  stepZip,
  speedCameraDistance,
  speedFov,
  speedoKmh,
  stepCar,
  surfaceGrip,
  tickDirector,
  tickHeat,
  tickLockpick,
  tickThrill,
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
  type ImpactKind,
  type LockpickState,
  type LootItem,
  type SwingState,
  type ThrillState,
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
import { GameAudio, type StationId } from "../game/audio";
import { GameInput } from "../game/input";
import type { HudSnapshot } from "../game/hud";
import { blocked, buildSouthside, Cell, cellAt, hideSpotNear, landmarkAt, type Landmark, type WorldData } from "../game/world";
import { buildCity, type CityMeshes } from "./city";
import { TextureKit, type Surface } from "./textures";

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
  /** Seconds a cop has gone without seeing the suspect, before breaking off. */
  lostT?: number;
  /** A cop who has given up: walks off the job instead of trailing the player. */
  quit?: boolean;
  /** Seconds left filming the player instead of fleeing. */
  recording?: number;
  /** Seconds since this one went down; the body lies there, then is cleared. */
  dead?: number;
  /** Thrown by a car: velocity that decays over the next moment. */
  flungX?: number;
  flungZ?: number;
}

interface CarEntity {
  rt: VehicleRuntime;
  mesh: Mesh;
  smoke: number;
  /** Seconds until this car can take collision damage again. */
  bump: number;
  /** Seconds a traffic car has spent going nowhere, before it is recycled. */
  stuck?: number;
}

interface Tracer {
  mesh: Mesh;
  life: number;
  /** Set on debris — casings, sparks, blood — that arcs and lands. */
  fall?: { vy: number; vx: number; vz: number };
  /** Cleared until the effect has survived one render. */
  seen?: boolean;
}

/** Height of a standing actor's hands: where muzzle flashes and tracers live. */
const GUN_Y = 12;

/** How far you can step up, and how far a ledge can be below your feet. */
const LEDGE_STEP = 14;

/**
 * How far the camera can be swung and how close it can be pulled. The old
 * limits let the view move through about thirty degrees, which is why looking
 * up at a building or down at the street was impossible.
 */
const CAMERA = {
  /** Slightly below level: enough to look up at rooftops and sky. */
  minPitch: -0.32,
  /** Near enough to straight down for a tactical view of a junction. */
  maxPitch: 1.45,
  minZoom: 0.45,
  maxZoom: 2.2,
  /** Never let the lens drop under the pavement at low angles. */
  minHeight: 16,
  /** Seconds a manual look is respected before a moving car recentres the view. */
  manualLookHold: 3,
};

function clampPitch(p: number): number {
  return Math.max(CAMERA.minPitch, Math.min(CAMERA.maxPitch, p));
}

/**
 * The world used to advance by at most 33ms per rendered frame, so anything
 * under 30fps ran in slow motion: at 15fps a car took twice as long to reach
 * the same corner and the controls felt like treacle. Time is now consumed in
 * fixed steps, several per frame when the renderer is behind, which keeps the
 * physics stable without tying the speed of the world to the frame rate.
 */
/**
 * Collision half-width for a car against buildings. The old value of 12 made
 * the box wider than the lane markings allow, so cars caught on kerbs that
 * looked clear on screen.
 */
const CAR_RADIUS = 9;

const SIM = {
  stepSeconds: 1 / 60,
  /** Ceiling on catch-up work per frame: 13fps still runs at full speed. */
  maxStepsPerFrame: 8,
  /** Anything longer is a stall or a backgrounded tab; do not simulate it. */
  maxFrameSeconds: 0.25,
};

interface MissionRuntime {
  id: string;
  step: number;
  raceHits: number;
  /** Whether police ever showed up, for objectives that ask you to lose them. */
  chased?: boolean;
  /** One-shot nudge when an objective's precondition has not happened yet. */
  hinted?: boolean;
}

const RACE_CPS = [
  { x: 50 * TILE, z: 65 * TILE },
  { x: 82 * TILE, z: 52 * TILE },
  { x: 36 * TILE, z: 24 * TILE },
  { x: 50 * TILE, z: 65 * TILE },
];

/** Interiors are separate rooms built high above the city grid. */
/**
 * Interiors sit in the sky, hidden from the street by visibility toggles. With
 * the skyline now reaching 344 units, 400 was close enough that towers poked
 * into shot through the shop floor.
 */
const INTERIOR_Y = 900;

/**
 * A walkable room behind a landmark door. Everything is keyed off the mesh
 * name prefix, which is what lets a room be hidden until you are standing in
 * it — a camera pulled right back over the street would otherwise catch the
 * furniture hanging in the sky.
 */
interface InteriorRoom {
  id: string;
  name: string;
  prefix: string;
  cx: number;
  cz: number;
  half: number;
  meshes: AbstractMesh[];
  /** Where the player is put down on entry, relative to the room centre. */
  entryZ: number;
}

type SpotKind = "rob" | "meal" | "coffee" | "vest" | "leave" | "bar" | "tip" | "vip" | "dance";

/** What a night at the Malibu costs, and what it buys. */
const CLUB = {
  cover: 25,
  drink: 12,
  tip: 20,
  vip: 150,
  /** Tips that still earn rep in one visit — after that you are just spending. */
  paidTips: 3,
  tipRep: 2,
  vipRep: 8,
  vipXp: 40,
  /** Seconds the player keeps dancing after hitting the floor. */
  danceSeconds: 7,
  danceCooldown: 20,
  danceXp: 6,
};

/** A body on the club floor: stage dancer, bartender, DJ or punter. */
interface ClubDancer {
  mesh: Mesh;
  /** 0-2 pick a dance; 3 is the standing-still-behind-a-counter bob. */
  style: number;
  phase: number;
  baseY: number;
  baseRotY: number;
}

interface InteriorSpot {
  x: number;
  z: number;
  r: number;
  color: string;
  tag: string;
  prompt: string;
  kind: SpotKind;
}

export class ViceblockRuntime3D {
  canvas: HTMLCanvasElement;
  minimap: HTMLCanvasElement | null = null;
  engine: Engine;
  scene: Scene;
  world: WorldData;
  city: CityMeshes;
  tex: TextureKit;
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
    /** Rounds in the magazine; the rest of `ammo` is what is left in a pocket. */
    mag: 0,
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
  /** Seconds of near-freeze left; sells an impact better than a louder sound. */
  private hitStop = 0;
  private thrill: ThrillState = createThrill();
  private driftTime = 0;
  private civilianSeq = 0;
  private copCarSeq = 0;
  /** Full-screen failure card: the moment needs to land, not scroll past in a toast. */
  private failure: "wasted" | "busted" | null = null;
  private failureT = 0;
  private nearMissCooldown = new Map<string, number>();
  private baseFov = 1.08;
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
  /** Distance to the closest officer still working the case, last tick. */
  private copGap = Infinity;
  /** The line currently being hung from, in world units. */
  private web: { x: number; y: number; z: number; length: number } | null = null;
  private webMesh: Mesh | null = null;
  private webSplat: Mesh | null = null;
  /** Velocity while off the ground: swinging, falling or thrown. */
  private flight = { vx: 0, vy: 0, vz: 0 };
  /** Stuck to a wall: which way the wall lies, and how long you have hung there. */
  private cling: { dir: number; t: number } | null = null;
  /** The anchor currently being winched toward, while a zip is in flight. */
  private zipTo: { x: number; y: number; z: number } | null = null;
  private swingT = 0;
  private airT = 0;
  private webCooldown = 0;
  private webWarned = false;
  private splatT = 0;
  /** Where a web would land right now, for the reticle. */
  private anchorPreview: { x: number; y: number; z: number } | null = null;
  private gpsT = 0;
  /** Walkable interior state: rooms are built high above the city. */
  private interiorMode: { id: string; returnX: number; returnZ: number } | null = null;
  /** Every walkable room, keyed by the landmark you walk in through. */
  private rooms = new Map<string, InteriorRoom>();
  private clubDancers: ClubDancer[] = [];
  private clubTiles: Array<{ mat: StandardMaterial; phase: number }> = [];
  private clubWashes: Array<{ mesh: Mesh; mat: StandardMaterial; phase: number }> = [];
  private clubBall: Mesh | null = null;
  /** Per-visit club state: tips already paid rep, whether VIP has been bought. */
  private clubVisit = { tips: 0, vip: false };
  /** Seconds of player dancing left, and the clock time of the last payout. */
  private danceT = 0;
  private lastDance = -99;
  /** The station playing before the club took the decks over. */
  private preClubStation: StationId | null = null;
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
  private beaconMesh: Mesh | null = null;
  private hudAcc = 0;
  private lastHudKey = "";

  onHud?: (h: HudSnapshot) => void;
  onPersist?: (s: PlayerSave) => void;
  onMissionComplete?: (missionId: string) => void;
  onContractComplete?: (contractId: string) => void;

  private unbind: (() => void) | null = null;
  private dragYaw = { active: false, id: -1, lastX: 0, lastY: 0 };
  /** Live pointers, so a second finger can pinch instead of fighting the orbit. */
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchGap = 0;
  /** Boom-length multiplier: wheel on desktop, pinch on mobile. */
  camZoom = 1;
  /** Clock time of the last manual look, so driving does not snatch the view back. */
  private lookedAt = -99;
  /** Real time owed to the simulation, paid off in fixed steps. */
  private simDebt = 0;
  private perf = { low: 0, dropped: false };
  /** Upward camera kick from firing, worked off over the next moments. */
  private recoil = 0;
  /** Pitch to apply on the next camera update, cleared once consumed. */
  private recoilStep = 0;
  /** The part of the accumulated kick the shooter rides back down. */
  private recoilPitch = 0;
  private lastFired = -99;
  private aiming = false;
  private reloadT = 0;
  /** Clock time of the last confirmed hit, and whether it put someone down. */
  private hitMark = { at: -99, kill: false };
  private shownWeapon: WeaponId | null = null;
  /** Bullet holes, scorch and blood left on the world, oldest recycled first. */
  private marks: Mesh[] = [];
  private matCache = new Map<string, StandardMaterial>();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: false });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.42, 0.55, 0.62, 1);
    // Nothing in the game picks with the mouse or relies on per-frame material
    // recompiles; both cost real time in a scene this dense.
    this.scene.skipPointerMovePicking = true;
    this.scene.blockMaterialDirtyMechanism = true;
    this.world = buildSouthside();
    this.tex = new TextureKit(this.scene);
    this.city = buildCity(this.scene, this.world, this.tex);

    this.hemi = new HemisphericLight("hemi", new Vector3(0.2, 1, 0.1), this.scene);
    this.hemi.intensity = 0.95;
    this.sun = new DirectionalLight("sun", new Vector3(-0.4, -1, -0.3), this.scene);
    this.sun.intensity = 0.78;

    this.camera = new FreeCamera("cam", new Vector3(0, 40, -40), this.scene);
    this.camera.minZ = 2;
    this.camera.maxZ = 4200;
    this.camera.fov = 1.08;

    this.player.x = this.world.spawnX;
    this.player.z = this.world.spawnY;

    // Red over blue, lenses, gloves: you are the one in the city who can catch
    // a building, so you should not look like the people on the pavement.
    this.playerMesh = this.makeHumanoid("player", "#c4202c", "#e6c39a", "#1d3a8f", true);
    this.playerMesh.position.set(this.player.x, 0, this.player.z);
    this.input = new GameInput();
    this.audio = new GameAudio();
    this.seedWorld();
  }

  attach(): void {
    this.unbind = this.input.attach(this.canvas);
    const down = (e: PointerEvent): void => {
      // Mobile: any direct canvas touch orbits the camera (sticks are separate
      // elements) and a second finger turns the gesture into a pinch zoom.
      // Desktop: either button drags to orbit, wheel zooms.
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size > 1) {
        this.dragYaw.active = false;
        this.pinchGap = this.pointerGap();
        return;
      }
      if (this.input.mobile || e.button === 2 || e.button === 0) {
        this.dragYaw = { active: true, id: e.pointerId, lastX: e.clientX, lastY: e.clientY };
      }
    };
    const move = (e: PointerEvent): void => {
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size > 1) {
        const gap = this.pointerGap();
        if (this.pinchGap > 0 && gap > 0) this.zoomBy((this.pinchGap - gap) * 0.006);
        this.pinchGap = gap;
        return;
      }
      if (!this.dragYaw.active || e.pointerId !== this.dragYaw.id) return;
      const sens = this.settings.lookSensitivity;
      this.player.camYaw += (e.clientX - this.dragYaw.lastX) * 0.005 * sens;
      const dy = (e.clientY - this.dragYaw.lastY) * 0.005 * sens * (this.settings.invertLook ? -1 : 1);
      this.player.camPitch = clampPitch(this.player.camPitch + dy);
      this.lookedAt = this.clock;
      this.dragYaw.lastX = e.clientX;
      this.dragYaw.lastY = e.clientY;
    };
    const up = (e: PointerEvent): void => {
      this.pointers.delete(e.pointerId);
      this.pinchGap = 0;
      if (e.pointerId === this.dragYaw.id) this.dragYaw.active = false;
    };
    const wheel = (e: WheelEvent): void => {
      e.preventDefault();
      this.zoomBy(e.deltaY * 0.0012);
    };
    const ctx = (e: Event): void => e.preventDefault();
    this.canvas.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    this.canvas.addEventListener("wheel", wheel, { passive: false });
    this.canvas.addEventListener("contextmenu", ctx);
    const onResize = (): void => this.engine.resize();
    window.addEventListener("resize", onResize);
    const prevUnbind = this.unbind;
    this.unbind = () => {
      prevUnbind?.();
      this.canvas.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      this.canvas.removeEventListener("wheel", wheel);
      this.canvas.removeEventListener("contextmenu", ctx);
      window.removeEventListener("resize", onResize);
    };
    let last = performance.now();
    this.engine.runRenderLoop(() => {
      const now = performance.now();
      // Real elapsed time, capped only against the tab having been asleep.
      const frame = Math.min(SIM.maxFrameSeconds, (now - last) / 1000);
      last = now;
      if (this.running) {
        this.updateEffects(frame);
        this.stepSim(frame);
        this.scene.render();
        this.drawMinimap();
        return;
      }
      const dt = Math.min(SIM.stepSeconds, frame);
      this.clock += dt;
      this.time = 15.4;
      this.updateDayNight();
      this.updateCars(dt);
      // Do not wander civilians on the title screen — they walk onto spawn
      // and sit inside the player the second you tap Enter.
      const ox = this.world.spawnX + Math.sin(this.clock * 0.13) * 210;
      const oz = this.world.spawnY + Math.cos(this.clock * 0.13) * 210;
      this.camera.position.set(ox, 92, oz);
      this.camera.setTarget(new Vector3(this.world.spawnX + 50, 16, this.world.spawnY - 10));
      this.scene.render();
    });
  }

  detach(): void {
    this.running = false;
    this.unbind?.();
    this.audio.setSiren(false);
    this.engine.stopRenderLoop();
    this.tex.dispose();
    this.scene.dispose();
    this.engine.dispose();
  }

  async start(): Promise<void> {
    await this.audio.unlock();
    this.audio.setLevels(this.settings);
    if (this.quality === "auto") this.quality = this.input.mobile ? "medium" : "high";
    this.applyQuality();
    this.time = 15.4;
    // Face Rico so the first shot is a street, a hideout trim, and a 3/4 face.
    const ricoX = 29.5 * TILE;
    const ricoZ = 49.2 * TILE;
    this.player.heading = Math.atan2(ricoZ - this.player.z, ricoX - this.player.x);
    this.player.camYaw = this.player.heading - Math.PI / 2 + 0.42;
    this.player.camPitch = 0.28;
    this.playerMesh.rotation.y = -this.player.heading;
    this.evictCrowd(110);
    this.snapCamera();
    this.running = true;
    this.say("Rico Vale", "You walk like you still got a ticket in your pocket. Follow the gold pillar — that's me.");
  }

  applyQuality(): void {
    const scale = this.quality === "low" ? 0.68 : this.quality === "medium" ? 0.85 : 1;
    this.engine.setHardwareScalingLevel(1 / scale / Math.min(1.5, window.devicePixelRatio || 1));
  }

  setQuality(q: Quality): void {
    this.quality = q === "auto" ? (this.input.mobile ? "low" : "high") : q;
    this.applyQuality();
    // A manual choice ends the automatic one, in both directions.
    this.perf = { low: 0, dropped: true };
  }

  /**
   * Drops render resolution once, if the machine plainly cannot hold a playable
   * frame rate. Cars stay just as quick either way now that the simulation runs
   * on its own clock, but a stuttering picture still reads as a slow car.
   */
  private updatePerf(dt: number): void {
    if (this.perf.dropped) return;
    const fps = this.engine.getFps();
    if (!Number.isFinite(fps) || fps <= 0) return;
    this.perf.low = fps < 42 ? this.perf.low + dt : 0;
    if (this.perf.low < 4) return;
    this.perf.dropped = true;
    const next = this.quality === "high" ? "medium" : "low";
    this.quality = next;
    this.applyQuality();
    this.flash(`PERFORMANCE  ·  dropped to ${next.toUpperCase()}  ·  change it in MENU > QUALITY`);
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
    this.mission.step = save.missionStep ?? 0;
    if (save.inventory.some((i) => i.id === "smg")) this.player.weapon = "smg";
    else if (save.inventory.some((i) => i.id === "pistol")) this.player.weapon = "pistol";
    if (this.player.weapon !== "fists") {
      this.player.ammo = save.ammo ?? 0;
      this.player.mag = 0;
      this.refillMagazine();
    }
    if (this.player.health <= 0) this.player.health = 100;
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
      ammo: this.player.ammo,
      missionStep: this.mission.step,
      updatedAt: Date.now(),
    };
  }

  // ------------------------------------------------------------- world seed

  private pinNameplate(parent: Mesh, title: string): void {
    const tex = new DynamicTexture(`np-${parent.name}`, { width: 256, height: 64 }, this.scene, false);
    const ctx = tex.getContext();
    ctx.fillStyle = "#1a1410";
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = "#f3e6d2";
    ctx.font = "bold 28px Impact, sans-serif";
    const t2 = ctx as unknown as CanvasRenderingContext2D;
    t2.textAlign = "center";
    t2.textBaseline = "middle";
    ctx.fillText(title.slice(0, 16).toUpperCase(), 128, 32);
    tex.update();
    const mat = new StandardMaterial(`npmat-${parent.name}`, this.scene);
    mat.diffuseTexture = tex;
    mat.emissiveTexture = tex;
    mat.emissiveColor = new Color3(0.7, 0.6, 0.45);
    mat.specularColor = Color3.Black();
    const plate = MeshBuilder.CreatePlane(`np-${parent.name}`, { width: 28, height: 7 }, this.scene);
    plate.material = mat;
    plate.position.y = 28;
    plate.billboardMode = 2;
    plate.parent = parent;
    plate.isPickable = false;
  }

  /** One call for every impact: freeze, shake, and shove the combo along. */
  private impact(kind: ImpactKind): void {
    if (this.settings.shake) this.shake = Math.max(this.shake, impactShake(kind));
    if (!this.settings.reduceFlashes) this.hitStop = Math.max(this.hitStop, hitStopSeconds(kind));
  }

  /** Stunt payouts land as cash plus a combo toast. */
  private bankStunt(base: number, label: string): void {
    const scored = scoreStunt(this.thrill, base);
    if (scored.payout <= 0) return;
    this.thrill = scored.state;
    this.player.cash += scored.payout;
    const mult = comboMultiplier(scored.state.combo - 1);
    this.audio.uiClick();
    this.flash(`${label}  ·  +$${scored.payout}${mult > 1 ? `  ·  x${mult.toFixed(1)}` : ""}`);
  }

  private surface(kind: Surface, hex: string, emissive = 0): StandardMaterial {
    return this.tex.material(kind, hex, emissive);
  }

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

  /**
   * The red half of the suit. Flat red at this scale is a red box, so the
   * webbing is drawn in: radials out of one corner and rings across them, the
   * pattern that says whose costume this is even from a rooftop away.
   */
  private webbedMaterial(hex: string): StandardMaterial {
    const key = `webbed-${hex}`;
    const hit = this.matCache.get(key);
    if (hit) return hit;
    const size = 128;
    const tex = new DynamicTexture(`webtex-${hex}`, { width: size, height: size }, this.scene, true);
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    ctx.fillStyle = hex;
    ctx.fillRect(0, 0, size, size);
    const base = Color3.FromHexString(hex);
    const ink = new Color3(base.r * 0.32, base.g * 0.3, base.b * 0.42);
    ctx.strokeStyle = `rgb(${Math.round(ink.r * 255)},${Math.round(ink.g * 255)},${Math.round(ink.b * 255)})`;
    ctx.lineWidth = 1.6;
    ctx.lineCap = "round";
    const spokes = 9;
    for (let i = 0; i < spokes; i++) {
      const a = (i / (spokes - 1)) * (Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * size * 1.5, Math.sin(a) * size * 1.5);
      ctx.stroke();
    }
    for (let r = 16; r < size * 1.5; r += 17) {
      // Strands sag between spokes, which is what stops this reading as a target.
      ctx.beginPath();
      for (let i = 0; i < spokes - 1; i++) {
        const a0 = (i / (spokes - 1)) * (Math.PI / 2);
        const a1 = ((i + 1) / (spokes - 1)) * (Math.PI / 2);
        const mid = (a0 + a1) / 2;
        ctx.moveTo(Math.cos(a0) * r, Math.sin(a0) * r);
        ctx.quadraticCurveTo(Math.cos(mid) * r * 0.86, Math.sin(mid) * r * 0.86, Math.cos(a1) * r, Math.sin(a1) * r);
      }
      ctx.stroke();
    }
    tex.update();
    const m = new StandardMaterial(key, this.scene);
    m.diffuseTexture = tex;
    m.specularColor = new Color3(0.1, 0.1, 0.12);
    this.matCache.set(key, m);
    return m;
  }

  private faceMaterial(skinHex: string): StandardMaterial {
    const key = `face-${skinHex}`;
    const hit = this.matCache.get(key);
    if (hit) return hit;
    const tex = new DynamicTexture(`facetex-${skinHex}`, { width: 128, height: 128 }, this.scene, false);
    const ctx = tex.getContext() as unknown as CanvasRenderingContext2D;
    ctx.fillStyle = skinHex;
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = "#1a1410";
    ctx.fillRect(22, 28, 28, 8);
    ctx.fillRect(78, 28, 28, 8);
    ctx.fillStyle = "#f7f2ea";
    ctx.beginPath();
    ctx.ellipse(36, 52, 13, 16, 0, 0, Math.PI * 2);
    ctx.ellipse(92, 52, 13, 16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1c1410";
    ctx.beginPath();
    ctx.ellipse(36, 54, 6, 8, 0, 0, Math.PI * 2);
    ctx.ellipse(92, 54, 6, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f7f2ea";
    ctx.beginPath();
    ctx.ellipse(38, 51, 2.2, 2.2, 0, 0, Math.PI * 2);
    ctx.ellipse(94, 51, 2.2, 2.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#8a4030";
    ctx.beginPath();
    ctx.ellipse(64, 92, 16, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = skinHex;
    ctx.fillRect(48, 84, 32, 6);
    tex.hasAlpha = false;
    tex.update();
    const m = new StandardMaterial(key, this.scene);
    m.diffuseTexture = tex;
    m.emissiveTexture = tex;
    m.emissiveColor = new Color3(0.35, 0.28, 0.22);
    m.specularColor = Color3.Black();
    this.matCache.set(key, m);
    return m;
  }

  /**
   * `masked` swaps the face, hair and bare hands for a hood with lenses and
   * gloves — the same body, wearing a suit rather than a shirt.
   */
  private makeHumanoid(name: string, shirtHex: string, skinHex: string, pantsHex = "#2a2420", masked = false): Mesh {
    const root = MeshBuilder.CreateBox(`${name}-root`, { width: 0.4, depth: 0.4, height: 0.4 }, this.scene);
    root.isVisible = false;
    // Red webbing over head, chest, gloves and boots; the blue takes the limbs.
    // Split that way the silhouette is a costume rather than a red block.
    const red = masked ? this.webbedMaterial(shirtHex) : this.surface("cloth", shirtHex);
    const blue = masked ? this.surface("cloth", pantsHex) : this.surface("cloth", shirtHex);
    const torso = MeshBuilder.CreateBox(`${name}-t`, { width: 7.2, depth: 4.6, height: 9.2 }, this.scene);
    torso.material = red;
    torso.position.y = 13.2;
    torso.parent = root;
    const neck = MeshBuilder.CreateCylinder(`${name}-nk`, { height: 1.8, diameter: 2.2, tessellation: 8 }, this.scene);
    neck.material = masked ? red : this.surface("skin", skinHex);
    neck.position.y = 18.4;
    neck.parent = root;
    const head = MeshBuilder.CreateBox(`${name}-h`, { width: 5.2, depth: 5.2, height: 5.4 }, this.scene);
    head.material = masked ? red : this.surface("skin", skinHex);
    head.position.y = 21.4;
    head.parent = root;
    if (masked) {
      // Two big lenses and a spider on the chest: the whole silhouette of the
      // costume at this scale is the mask, so it has to read from behind.
      for (const s of [1, -1]) {
        const lens = MeshBuilder.CreateBox(`${name}-lens${s}`, { width: 0.5, depth: 2.3, height: 1.7 }, this.scene);
        lens.material = this.material("#f2f4f8", 0.42);
        lens.position.set(2.62, 21.8, 1.25 * s);
        lens.rotation.x = 0.22 * s;
        lens.parent = root;
        const rim = MeshBuilder.CreateBox(`${name}-rim${s}`, { width: 0.42, depth: 2.7, height: 2.1 }, this.scene);
        rim.material = this.material("#14161c", 0.05);
        rim.position.set(2.56, 21.8, 1.25 * s);
        rim.rotation.x = 0.22 * s;
        rim.parent = root;
      }
      // A spider on the chest and a bigger one across the back, because from
      // behind is how you see this character for most of a swing.
      // The torso is 7.2 across, so these sit just proud of its faces at 3.6;
      // buried in the middle of the box they render as nothing at all.
      for (const [x, w, s] of [
        [3.72, 3, 1],
        [-3.72, 4.2, -1],
      ] as const) {
        const body = MeshBuilder.CreateBox(`${name}-emblem${s}`, { width: 0.4, depth: w * 0.42, height: w }, this.scene);
        body.material = this.material("#14161c", 0.05);
        body.position.set(x, 14.4, 0);
        body.parent = root;
        for (const side of [1, -1]) {
          const legs = MeshBuilder.CreateBox(`${name}-emblem-leg${s}${side}`, { width: 0.38, depth: w * 0.86, height: 0.36 }, this.scene);
          legs.material = this.material("#14161c", 0.05);
          legs.position.set(x, 14.4 + w * 0.26 * side, 0);
          legs.parent = root;
        }
      }
      const belt = MeshBuilder.CreateBox(`${name}-belt`, { width: 7.4, depth: 4.8, height: 1.1 }, this.scene);
      belt.material = this.surface("cloth", pantsHex);
      belt.position.y = 9;
      belt.parent = root;
    } else {
      const face = MeshBuilder.CreatePlane(`${name}-face`, { width: 5.1, height: 5.3 }, this.scene);
      face.material = this.faceMaterial(skinHex);
      face.position.set(2.65, 21.4, 0);
      face.rotation.y = Math.PI / 2;
      face.parent = root;
      const brow = MeshBuilder.CreateBox(`${name}-brow`, { width: 1.1, depth: 3.8, height: 0.55 }, this.scene);
      brow.material = this.surface("hair", "#1a1410");
      brow.position.set(2.5, 22.7, 0);
      brow.parent = root;
      const eyeWhiteL = MeshBuilder.CreateSphere(`${name}-ewl`, { diameter: 1.35, segments: 8 }, this.scene);
      eyeWhiteL.material = this.material("#f4efe6", 0.18);
      eyeWhiteL.position.set(2.55, 21.65, 1.2);
      eyeWhiteL.parent = root;
      const eyeWhiteR = MeshBuilder.CreateSphere(`${name}-ewr`, { diameter: 1.35, segments: 8 }, this.scene);
      eyeWhiteR.material = this.material("#f4efe6", 0.18);
      eyeWhiteR.position.set(2.55, 21.65, -1.2);
      eyeWhiteR.parent = root;
      const pupilL = MeshBuilder.CreateSphere(`${name}-pl`, { diameter: 0.72, segments: 6 }, this.scene);
      pupilL.material = this.material("#14110e", 0.08);
      pupilL.position.set(3.15, 21.6, 1.2);
      pupilL.parent = root;
      const pupilR = MeshBuilder.CreateSphere(`${name}-pr`, { diameter: 0.72, segments: 6 }, this.scene);
      pupilR.material = this.material("#14110e", 0.08);
      pupilR.position.set(3.15, 21.6, -1.2);
      pupilR.parent = root;
      const nose = MeshBuilder.CreateBox(`${name}-nose`, { width: 1.1, depth: 1.15, height: 1.35 }, this.scene);
      nose.material = this.surface("skin", skinHex);
      nose.position.set(2.85, 20.85, 0);
      nose.parent = root;
      const mouth = MeshBuilder.CreateBox(`${name}-mouth`, { width: 0.55, depth: 2.1, height: 0.45 }, this.scene);
      mouth.material = this.material("#6a3028", 0.06);
      mouth.position.set(2.7, 19.85, 0);
      mouth.parent = root;
      const hair = MeshBuilder.CreateBox(`${name}-hair`, { width: 5.5, depth: 5.5, height: 2 }, this.scene);
      hair.material = this.surface("hair", "#1a1410");
      hair.position.y = 24.4;
      hair.parent = root;
      const hairBack = MeshBuilder.CreateBox(`${name}-hb`, { width: 1.2, depth: 5.3, height: 3.4 }, this.scene);
      hairBack.material = this.surface("hair", "#1a1410");
      hairBack.position.set(-2.2, 22.6, 0);
      hairBack.parent = root;
      const earL = MeshBuilder.CreateBox(`${name}-el`, { width: 1.1, depth: 1.4, height: 2 }, this.scene);
      earL.material = this.surface("skin", skinHex);
      earL.position.set(0, 21.4, 2.9);
      earL.parent = root;
      const earR = MeshBuilder.CreateBox(`${name}-er`, { width: 1.1, depth: 1.4, height: 2 }, this.scene);
      earR.material = this.surface("skin", skinHex);
      earR.position.set(0, 21.4, -2.9);
      earR.parent = root;
    }
    const armL = MeshBuilder.CreateBox(`${name}-al`, { width: 2.1, depth: 2.2, height: 8.6 }, this.scene);
    armL.material = blue;
    armL.position.set(0, 13.4, 3.8);
    armL.parent = root;
    const armR = MeshBuilder.CreateBox(`${name}-ar`, { width: 2.1, depth: 2.2, height: 8.6 }, this.scene);
    armR.material = blue;
    armR.position.set(0, 13.4, -3.8);
    armR.parent = root;
    const handL = MeshBuilder.CreateBox(`${name}-hl`, { width: 1.8, depth: 1.8, height: 1.8 }, this.scene);
    handL.material = masked ? red : this.surface("skin", skinHex);
    handL.position.set(0, 8.6, 3.8);
    handL.parent = root;
    const handR = MeshBuilder.CreateBox(`${name}-hr`, { width: 1.8, depth: 1.8, height: 1.8 }, this.scene);
    handR.material = masked ? red : this.surface("skin", skinHex);
    handR.position.set(0, 8.6, -3.8);
    handR.parent = root;
    const legL = MeshBuilder.CreateBox(`${name}-ll`, { width: 2.8, depth: 2.6, height: 8 }, this.scene);
    legL.material = this.surface("denim", pantsHex);
    legL.position.set(0, 4.1, 1.7);
    legL.parent = root;
    const legR = MeshBuilder.CreateBox(`${name}-lr`, { width: 2.8, depth: 2.6, height: 8 }, this.scene);
    legR.material = this.surface("denim", pantsHex);
    legR.position.set(0, 4.1, -1.7);
    legR.parent = root;
    // Boots come up the shin on a costume, so the masked one gets a taller,
    // red block where the others get a flat shoe.
    const bootH = masked ? 3.4 : 1.4;
    const bootMat = masked ? red : this.surface("leather", "#1a1410");
    const shoeL = MeshBuilder.CreateBox(`${name}-sl`, { width: 3.6, depth: 2.7, height: bootH }, this.scene);
    shoeL.material = bootMat;
    shoeL.position.set(0.6, bootH / 2, 1.7);
    shoeL.parent = root;
    const shoeR = MeshBuilder.CreateBox(`${name}-sr`, { width: 3.6, depth: 2.7, height: bootH }, this.scene);
    shoeR.material = bootMat;
    shoeR.position.set(0.6, bootH / 2, -1.7);
    shoeR.parent = root;
    const shadow = MeshBuilder.CreateCylinder(`${name}-sh`, { diameter: 11, height: 0.35, tessellation: 10 }, this.scene);
    shadow.material = this.material("#0c0a08", 0);
    shadow.position.y = 0.16;
    shadow.parent = root;
    // Hands hold something: the guns hang off the right arm so they follow the
    // aim pose instead of floating beside the body.
    const pistol = this.makeGunMesh(`${name}-gun-pistol`, "pistol");
    pistol.parent = armR;
    pistol.position.set(1.6, -4.6, 0);
    pistol.setEnabled(false);
    const smg = this.makeGunMesh(`${name}-gun-smg`, "smg");
    smg.parent = armR;
    smg.position.set(2.2, -4.6, 0);
    smg.setEnabled(false);
    root.metadata = { armL, armR, legL, legR, pistol, smg, shadow };
    return root;
  }

  /**
   * Hand weapons, built from the same box vocabulary as everything else: a
   * slide over a grip for the pistol, a receiver with a magazine, stock and
   * sight for the SMG. The barrel points along +x, which is the actor's
   * forward, so a muzzle flash can be pinned to the end of it.
   */
  private makeGunMesh(name: string, kind: "pistol" | "smg"): Mesh {
    const root = MeshBuilder.CreateBox(`${name}-r`, { size: 0.3 }, this.scene);
    root.isVisible = false;
    const steel = this.surface("metal", "#2a2e34", 0.05);
    const grip = this.surface("plastic", "#17141a");
    let n = 0;
    const part = (w: number, d: number, h: number, x: number, y: number, z: number, mat: StandardMaterial): void => {
      const m = MeshBuilder.CreateBox(`${name}-${n++}`, { width: w, depth: d, height: h }, this.scene);
      m.material = mat;
      m.position.set(x, y, z);
      m.parent = root;
    };
    if (kind === "pistol") {
      part(4.6, 1.1, 1.5, 0.6, 0.9, 0, steel);
      part(1.4, 1, 2.4, -0.9, -0.5, 0, grip);
      part(1.2, 0.9, 0.7, 2.6, 0.4, 0, steel);
      part(0.5, 0.5, 0.6, 2.2, 1.8, 0, steel);
    } else {
      part(6.4, 1.3, 1.8, 1.2, 0.9, 0, steel);
      part(1.5, 1.1, 2.6, -0.4, -0.7, 0, grip);
      part(1.2, 1, 2.8, 1.4, -0.8, 0, grip);
      part(2.6, 0.8, 0.8, 4.6, 0.9, 0, steel);
      part(2.4, 1, 1.2, -2.4, 1.1, 0, grip);
      part(0.7, 0.5, 0.8, 3.4, 2, 0, steel);
    }
    return root;
  }

  /** Shows the weapon the actor is actually carrying, or empties their hands. */
  private showWeapon(mesh: Mesh, weapon: WeaponId): void {
    const meta = mesh.metadata as { pistol?: Mesh; smg?: Mesh } | undefined;
    meta?.pistol?.setEnabled(weapon === "pistol");
    meta?.smg?.setEnabled(weapon === "smg");
  }

  /**
   * Levels the gun arm at whatever the actor is facing, with a kick that
   * decays. Without this the weapon hangs at the hip and a firefight looks
   * like two people standing near each other.
   */
  private poseAim(mesh: Mesh, aiming: boolean, kick: number): void {
    const meta = mesh.metadata as { armL?: Mesh; armR?: Mesh } | undefined;
    if (!meta?.armR) return;
    // +90 degrees about z swings the hand end of the arm to the front, which is
    // where the barrel and the muzzle flash need to be.
    const want = aiming ? Math.PI / 2 + kick : 0;
    meta.armR.rotation.z = meta.armR.rotation.z + (want - meta.armR.rotation.z) * 0.4;
    meta.armR.rotation.x = 0;
    if (meta.armL) {
      // The support hand comes up too, but not all the way: one-handed grip.
      const wantL = aiming ? 0.9 : 0;
      meta.armL.rotation.z = meta.armL.rotation.z + (wantL - meta.armL.rotation.z) * 0.3;
      if (aiming) meta.armL.rotation.x *= 0.5;
    }
  }

  /** A fist thrown and pulled back, so bare-handed hits are readable too. */
  private posePunch(mesh: Mesh, since: number): void {
    if (since > 0.3) return;
    const meta = mesh.metadata as { armR?: Mesh } | undefined;
    if (!meta?.armR) return;
    // Out fast, back slower: a jab rather than a wave.
    const t = since < 0.1 ? since / 0.1 : 1 - (since - 0.1) / 0.2;
    meta.armR.rotation.x = -1.7 * t;
  }

  private poseWalk(mesh: Mesh, moving: boolean, sprint: boolean): void {
    const meta = mesh.metadata as { armL?: Mesh; armR?: Mesh; legL?: Mesh; legR?: Mesh } | undefined;
    if (!meta?.armL || !meta.armR || !meta.legL || !meta.legR) return;
    const swing = moving ? Math.sin(this.clock * (sprint ? 14 : 9)) * 0.7 : 0;
    meta.armL.rotation.x = swing;
    meta.armR.rotation.x = -swing;
    meta.legL.rotation.x = -swing * 0.65;
    meta.legR.rotation.x = swing * 0.65;
  }

  /**
   * In the air: one arm up the line, the other trailing, legs tucked on the way
   * up and kicked out over the top of an arc. Walking animation on a body
   * three hundred units above the street looked like a bug.
   */
  private poseSling(mesh: Mesh): void {
    const meta = mesh.metadata as { armL?: Mesh; armR?: Mesh; legL?: Mesh; legR?: Mesh } | undefined;
    if (!meta?.armL || !meta.armR || !meta.legL || !meta.legR) return;
    if (this.cling) {
      // Spread on the wall, one hand reaching up the brickwork.
      const reach = Math.sin(this.clock * 6) * 0.3;
      meta.armR.rotation.x = -2.4 + reach;
      meta.armL.rotation.x = -2.4 - reach;
      meta.legL.rotation.x = 0.5 - reach;
      meta.legR.rotation.x = 0.5 + reach;
      return;
    }
    const rising = this.flight.vy > 0;
    const tuck = rising ? 1 : 0.25;
    meta.armR.rotation.x = this.web ? -2.6 : -1.5;
    meta.armL.rotation.x = this.web ? -0.5 : -1.2;
    meta.legL.rotation.x = -tuck + Math.sin(this.clock * 3) * 0.12;
    meta.legR.rotation.x = -tuck * 0.4 - Math.sin(this.clock * 3) * 0.12;
  }

  /**
   * Cars used to be one paint-coloured slab with a glass slab on top, which is
   * why they read as untextured boxes. Each one is now built from real panels
   * — bonnet, cabin, boot, bumpers, grille, lamps, plate, mirrors, rims — and
   * the silhouette follows the vehicle class, so a Sahin sedan, a muscle car
   * and a wedge sports car are told apart at a glance.
   */
  private makeCarMesh(name: string, hex: string, isPolice: boolean, defId = "sparrow"): Mesh {
    const root = MeshBuilder.CreateBox(`${name}-root`, { width: 0.4, depth: 0.4, height: 0.4 }, this.scene);
    root.isVisible = false;
    let n = 0;
    const box = (w: number, d: number, h: number, x: number, y: number, z: number, mat: StandardMaterial): Mesh => {
      const m = MeshBuilder.CreateBox(`${name}-p${n++}`, { width: w, depth: d, height: h }, this.scene);
      m.material = mat;
      m.position.set(x, y, z);
      m.parent = root;
      return m;
    };
    if (defId === "needle") return this.makeBikeMesh(name, hex, root, box);

    const paint = this.surface("carPaint", hex);
    const glass = this.surface("glass", isPolice ? "#40607e" : "#16202a");
    const trim = this.surface("metal", "#20242a", 0.05);
    const chrome = this.surface("metal", "#b8bcc4", 0.12);
    const sedan = defId === "sahin";
    const muscle = defId === "ironback";
    const sports = defId === "mirage";

    // Class silhouette: nose length, cabin position and how low it all sits.
    const noseLen = sports ? 12 : muscle ? 13 : sedan ? 11 : 9;
    const bootLen = sedan ? 9 : muscle ? 8 : sports ? 7 : 5;
    const cabinLen = 30 - noseLen - bootLen;
    const cabinX = 15 - noseLen - cabinLen / 2;
    const sill = sports ? 4.2 : 4.8;
    const roofH = sports ? 4 : sedan ? 5.4 : 4.8;
    const noseY = sports ? sill + 1.6 : sill + 2.4;

    box(30, 15, 1.6, 0, sill - 1.2, 0, trim);
    box(30, 15.2, 4.4, 0, sill + 1.4, 0, paint);
    box(noseLen, 14.6, sports ? 1.8 : 2.6, 15 - noseLen / 2, noseY + 1.6, 0, paint);
    box(bootLen, 14.6, sedan ? 3.4 : 2.6, -15 + bootLen / 2, sill + 4.4, 0, paint);
    // Cabin: glass band under a painted roof, plus pillars so it is not a fishbowl.
    box(cabinLen, 14.2, roofH, cabinX, sill + 3.6 + roofH / 2, 0, glass);
    box(cabinLen - (sports ? 3 : 1.5), 14.4, 1.4, cabinX - (sports ? 1 : 0), sill + 3.9 + roofH, 0, paint);
    box(1.6, 14.4, roofH, cabinX + cabinLen / 2, sill + 3.6 + roofH / 2, 0, paint);
    box(1.6, 14.4, roofH, cabinX - cabinLen / 2, sill + 3.6 + roofH / 2, 0, paint);
    // Door shut lines and a shoulder crease down each flank.
    box(0.8, 15.4, 3.6, cabinX + cabinLen / 2 - 1, sill + 1.6, 0, trim);
    box(0.8, 15.4, 3.6, cabinX - cabinLen / 2 + 1, sill + 1.6, 0, trim);
    box(26, 15.6, 0.8, -1, sill + 3.2, 0, trim);
    // Bumpers, grille, lamps and a plate at each end.
    box(1.8, 15.2, 3, 15.4, sill - 0.4, 0, sedan ? chrome : trim);
    box(1.8, 15.2, 3, -15.4, sill - 0.4, 0, sedan ? chrome : trim);
    box(1.4, 8, 2.4, 15.1, sill + 2.4, 0, trim);
    box(5, 2.6, 0.9, 15.6, sill - 0.4, 0, chrome);
    box(5, 2.6, 0.9, -15.6, sill - 0.4, 0, chrome);
    const lamp = this.material("#f6ecd0", 0.85);
    const tail = this.material("#d03a22", 0.8);
    const lampD = sedan ? 3.2 : 4.2;
    for (const z of [5.2, -5.2]) {
      box(1.2, lampD, sedan ? 2.6 : 2, 15.2, sill + 2.4, z, lamp);
      box(1.2, lampD + 0.6, 2.4, -15.2, sill + 2.4, z, tail);
    }
    // Mirrors on stalks, because a car with none looks unfinished up close.
    for (const z of [7.6, -7.6]) box(2.2, 1.8, 1.6, cabinX + cabinLen / 2 - 1, sill + 4.6, z, trim);
    if (muscle) box(6, 8, 1.2, 8, sill + 5.4, 0, trim);
    if (sports) box(3.4, 12, 1, -14, sill + 7.2, 0, trim);
    if (sedan) box(1, 15, 1.2, -15.2, sill + 6.2, 0, chrome);
    if (isPolice) {
      const bar = box(6, 11, 2, cabinX, sill + 5.4 + roofH, 0, this.material("#101418"));
      bar.parent = root;
      box(2.4, 4, 1.8, cabinX, sill + 5.6 + roofH, 3.4, this.material("#4a90d8", 0.95));
      box(2.4, 4, 1.8, cabinX, sill + 5.6 + roofH, -3.4, this.material("#d84040", 0.95));
    }
    const tyre = this.surface("rubber", "#15120f");
    const rim = this.surface("metal", sports ? "#c8ccd2" : "#8e9298", 0.1);
    const wheels: Mesh[] = [];
    for (const [wx, wz] of [
      [10, 7.4],
      [10, -7.4],
      [-10, 7.4],
      [-10, -7.4],
    ] as const) {
      const wheel = MeshBuilder.CreateCylinder(`${name}-w${wheels.length}`, { height: 3.4, diameter: sports ? 6 : 6.4, tessellation: 10 }, this.scene);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(wx, sports ? 2.9 : 3.1, wz);
      wheel.material = tyre;
      wheel.parent = root;
      const hub = MeshBuilder.CreateCylinder(`${name}-r${wheels.length}`, { height: 0.6, diameter: sports ? 3.6 : 3.8, tessellation: 10 }, this.scene);
      hub.material = rim;
      hub.position.z = wz > 0 ? 1.8 : -1.8;
      hub.rotation.x = Math.PI / 2;
      hub.parent = wheel;
      wheels.push(wheel);
    }
    const shadow = MeshBuilder.CreateCylinder(`${name}-sh`, { diameter: 28, height: 0.35, tessellation: 10 }, this.scene);
    shadow.material = this.material("#0c0a08");
    shadow.position.y = 0.18;
    shadow.parent = root;
    root.metadata = { wheels };
    return root;
  }

  /** The Needle is a bike, not a saloon with the roof painted on. */
  private makeBikeMesh(
    name: string,
    hex: string,
    root: Mesh,
    box: (w: number, d: number, h: number, x: number, y: number, z: number, mat: StandardMaterial) => Mesh,
  ): Mesh {
    const paint = this.surface("carPaint", hex);
    const trim = this.surface("metal", "#22262c", 0.06);
    const chrome = this.surface("metal", "#c0c4cc", 0.14);
    box(16, 4.2, 3.4, 0, 7.4, 0, paint);
    box(6, 4.6, 2.2, -3, 10.2, 0, this.surface("leather", "#191512"));
    box(5, 3.4, 4, 6.4, 9.4, 0, paint);
    box(1.6, 9, 1.2, 5.6, 11.4, 0, chrome);
    box(2, 3, 2, 8.4, 9.6, 0, this.material("#f6ecd0", 0.85));
    box(1.6, 3, 1.6, -8.4, 9, 0, this.material("#d03a22", 0.8));
    box(8, 3.6, 3.6, 1, 5.6, 0, trim);
    const tyre = this.surface("rubber", "#15120f");
    const wheels: Mesh[] = [];
    for (const wx of [8, -8]) {
      const wheel = MeshBuilder.CreateCylinder(`${name}-w${wheels.length}`, { height: 2.4, diameter: 9.4, tessellation: 12 }, this.scene);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(wx, 4.7, 0);
      wheel.material = tyre;
      wheel.parent = root;
      const hub = MeshBuilder.CreateCylinder(`${name}-r${wheels.length}`, { height: 2.6, diameter: 4.6, tessellation: 10 }, this.scene);
      hub.material = chrome;
      hub.rotation.x = Math.PI / 2;
      hub.parent = wheel;
      wheels.push(wheel);
    }
    const shadow = MeshBuilder.CreateCylinder(`${name}-sh`, { diameter: 16, height: 0.35, tessellation: 10 }, this.scene);
    shadow.material = this.material("#0c0a08");
    shadow.position.y = 0.18;
    shadow.parent = root;
    root.metadata = { wheels };
    return root;
  }

  private seedWorld(): void {
    const spots: Array<[string, number, number, number, string, string?]> = [
      ["sparrow", 22 * TILE, 65.2 * TILE, 0, "#c45a32"],
      ["sparrow", 38 * TILE, 52 * TILE, 1.5, "#d8c4a0", "sparrow-job"],
      ["ironback", 52 * TILE, 38 * TILE, 0.2, "#6b2d28"],
      ["mirage", 66 * TILE, 52 * TILE, 3.2, "#2f6f78"],
      ["needle", 30 * TILE, 38 * TILE, 0.8, "#1f1a18"],
      ["sparrow", 84 * TILE, 40 * TILE, 4.7, "#8a8f6a"],
      ["ironback", 24 * TILE, 12 * TILE, 0, "#4a3a5a"],
      ["sahin", 34 * TILE, 65.4 * TILE, 0, "#d8d2c4"],
      ["sahin", 58 * TILE, 45.4 * TILE, Math.PI, "#3a5a8a"],
      ["sahin", 20 * TILE, 30 * TILE, Math.PI / 2, "#8a2f28"],
    ];
    for (const [defId, x, z, h, color, id] of spots) {
      const rt = createVehicleRuntime(defId, x, z, h, color, id === "sparrow-job");
      if (id) rt.id = id;
      this.cars.push({ rt, mesh: this.makeCarMesh(rt.id, color, false, defId), smoke: 0, bump: 0 });
    }
    // Traffic
    const roads: Array<[number, number, number]> = [
      [10 * TILE, 11.5 * TILE, 0],
      [40 * TILE, 23.5 * TILE, Math.PI],
      [60 * TILE, 37.5 * TILE, 0],
      [23.5 * TILE, 20 * TILE, Math.PI / 2],
      [51.5 * TILE, 40 * TILE, -Math.PI / 2],
      [81.5 * TILE, 30 * TILE, Math.PI / 2],
      [28 * TILE, 65.4 * TILE, 0],
      [44 * TILE, 65.4 * TILE, Math.PI],
      [70 * TILE, 65.4 * TILE, 0],
      [9.4 * TILE, 58 * TILE, Math.PI / 2],
      [23.4 * TILE, 48 * TILE, -Math.PI / 2],
    ];
    // Mixed traffic, weighted to the cheap saloon everyone's uncle drives.
    const trafficKinds = ["sahin", "sparrow", "sahin", "ironback", "sahin", "sparrow", "sahin", "mirage"];
    const trafficColors = ["#d8d2c4", "#7a5a40", "#3a5a8a", "#4a3a32", "#8a2f28", "#8a8f6a", "#c8c2b0", "#2f6f78"];
    roads.forEach(([x, z, h], i) => {
      const defId = trafficKinds[i % trafficKinds.length];
      const color = trafficColors[i % trafficColors.length];
      const rt = createVehicleRuntime(defId, x, z, h, color);
      rt.id = `traffic-${i}`;
      this.cars.push({ rt, mesh: this.makeCarMesh(rt.id, color, false, defId), smoke: 0, bump: 0 });
    });

    const named: Array<[string, string, number, number, string, string[]]> = [
      ["rico", "Rico Vale", 29.5 * TILE, 49.2 * TILE, "#c45a32", [
        "You drive?",
        "Depends. Is it yours?",
        "Not anymore. Boost the Sparrow by Coral Mart. Maya wants it clean.",
      ]],
      ["maya", "Maya Reyes", 57.5 * TILE, 63.2 * TILE, "#e6c39a", [
        "If it still rolls, I can make it mean.",
        "Midnight line is south. Don't be cute with the handbrake.",
      ]],
      ["cupsey", "Cupsey", 27.5 * TILE, 30.2 * TILE, "#f0a030", [
        "Charts said Southside goes vertical. I took that personally.",
        "We're so back. Or we never left. Same thing.",
      ]],
      ["ansem", "Ansem", 72.5 * TILE, 21.2 * TILE, "#d8d2c4", [
        "Liquidity is just another word for heat.",
        "The mural remembers wallets the news forgets.",
      ]],
      ["marcus", "Marcus Vane", 82.5 * TILE, 63.2 * TILE, "#5a6a48", [
        "Crate's in the yard. Fence is theater. Cops ain't.",
      ]],
    ];
    for (const [id, name, x, z, shirt, talk] of named) {
      const mesh = this.makeHumanoid(id, shirt, "#e6c39a");
      mesh.position.set(x, 0, z);
      this.pinNameplate(mesh, name);
      this.actors.push({
        id,
        kind: "named",
        name,
        x,
        z,
        heading: 0,
        hp: 100,
        panic: 0,
        mesh,
        talk,
      });
    }
    this.buildMartInterior();
    this.buildMalibuInterior();
    this.dressClubDoor();

    const count = 52;
    for (let i = 0; i < count; i++) {
      const x = (8 + (i * 17) % 80) * TILE + 10;
      const z = (12 + (i * 11) % 60) * TILE + 10;
      if (blocked(this.world, x, z, 8)) continue;
      if (Math.hypot(x - this.world.spawnX, z - this.world.spawnY) < 160) continue;
      this.addCivilian(x, z);
    }
  }

  private addCivilian(x: number, z: number): void {
    const colors = ["#c4a07a", "#8a6a54", "#d8c8b0", "#6a4a3a", "#b08870"];
    const id = `c${this.civilianSeq++}`;
    const actor: Actor = {
      id,
      kind: "civilian",
      name: "local",
      x,
      z,
      heading: Math.random() * 6,
      hp: 30,
      panic: 0,
      mesh: this.makeHumanoid(id, colors[this.civilianSeq % colors.length] ?? "#c4a07a", "#d8b890"),
    };
    actor.mesh.position.set(x, 0, z);
    this.actors.push(actor);
  }

  /** Keeps the streets populated after the crowd thins from violence. */
  private replaceCivilian(): void {
    for (let tries = 0; tries < 20; tries++) {
      const x = Math.random() * MAP_W * TILE;
      const z = Math.random() * MAP_H * TILE;
      if (blocked(this.world, x, z, 8)) continue;
      // Out of sight: nobody should watch a local pop into existence.
      if (Math.hypot(x - this.player.x, z - this.player.z) < 320) continue;
      this.addCivilian(x, z);
      return;
    }
  }

  /**
   * Floor, four walls and a lid: the shell every interior room needs. The
   * shell carries its own glow because the sun does not reach a room parked
   * above the city — without it a night-time interior is a black void.
   */
  private buildRoomShell(
    prefix: string,
    cx: number,
    cz: number,
    half: number,
    floorHex: string,
    wallHex: string,
    ceilingHex: string,
    height = 90,
    lit = 0.3,
  ): void {
    const floor = MeshBuilder.CreateBox(`${prefix}floor`, { width: half * 2, depth: half * 2, height: 2 }, this.scene);
    floor.material = this.surface("concrete", floorHex, lit * 0.8);
    floor.position = new Vector3(cx, INTERIOR_Y - 1, cz);
    const wallMat = this.surface("plaster", wallHex, lit);
    const walls: Array<[number, number, number, number]> = [
      [cx, cz - half, half * 2, 6],
      [cx, cz + half, half * 2, 6],
      [cx - half, cz, 6, half * 2],
      [cx + half, cz, 6, half * 2],
    ];
    walls.forEach(([x, z, w, d], i) => {
      const wall = MeshBuilder.CreateBox(`${prefix}wall-${i}`, { width: w, depth: d, height }, this.scene);
      wall.material = wallMat;
      wall.position = new Vector3(x, INTERIOR_Y + height / 2, z);
    });
    // Without a lid the room reads as a doll's house floating over the city.
    const ceiling = MeshBuilder.CreateBox(`${prefix}ceiling`, { width: half * 2, depth: half * 2, height: 3 }, this.scene);
    ceiling.material = this.surface("plaster", ceilingHex, lit * 0.6);
    ceiling.position = new Vector3(cx, INTERIOR_Y + height, cz);
  }

  /** Emissive material for neon, dance-floor tiles and spot discs. */
  private glow(name: string, hex: string, alpha = 1): StandardMaterial {
    const m = new StandardMaterial(name, this.scene);
    m.emissiveColor = Color3.FromHexString(hex);
    m.diffuseColor = Color3.Black();
    m.specularColor = Color3.Black();
    m.disableLighting = true;
    m.alpha = alpha;
    return m;
  }

  /**
   * A light beam, not a lump of coloured plastic: additive blending means the
   * cone only ever brightens what is behind it, which is how light behaves.
   */
  private beam(name: string, hex: string, alpha: number): StandardMaterial {
    const m = this.glow(name, hex, alpha);
    m.alphaMode = Engine.ALPHA_ADD;
    m.backFaceCulling = false;
    return m;
  }

  /** The club's name in neon, painted straight onto the stage's back wall. */
  private signWall(name: string): StandardMaterial {
    const tex = new DynamicTexture(`${name}-tex`, { width: 512, height: 192 }, this.scene, false);
    const ctx = tex.getContext();
    const c2d = ctx as unknown as CanvasRenderingContext2D;
    ctx.fillStyle = "#2e0a24";
    ctx.fillRect(0, 0, 512, 192);
    ctx.fillStyle = "#57123f";
    for (let i = 0; i < 8; i++) ctx.fillRect(0, i * 24, 512, 12);
    c2d.textAlign = "center";
    c2d.textBaseline = "middle";
    ctx.fillStyle = "#ff4aa8";
    ctx.font = "bold 96px Impact, Arial Black, sans-serif";
    ctx.fillText("MALIBU", 256, 82);
    ctx.fillStyle = "#4ad8c8";
    ctx.font = "bold 44px Impact, Arial Black, sans-serif";
    ctx.fillText("C L U B", 256, 148);
    tex.update();
    // A box face maps the texture upside down and mirrored; spin it back.
    tex.wAng = Math.PI;
    const mat = new StandardMaterial(name, this.scene);
    mat.diffuseTexture = tex;
    mat.emissiveTexture = tex;
    mat.emissiveColor = new Color3(1, 0.9, 0.98);
    mat.specularColor = Color3.Black();
    mat.disableLighting = true;
    return mat;
  }

  /** Collects a room's meshes by prefix and registers it, hidden. */
  private registerRoom(room: Omit<InteriorRoom, "meshes">): void {
    const meshes = this.scene.meshes.filter((m) => m.name.startsWith(room.prefix));
    const full: InteriorRoom = { ...room, meshes };
    this.rooms.set(room.id, full);
    for (const m of meshes) m.setEnabled(false);
  }

  /** A walkable Coral Mart room: shelves, a clerk behind the counter, a till. */
  private buildMartInterior(): void {
    const cx = 43 * TILE;
    const cz = 45 * TILE;
    const half = 96;
    this.buildRoomShell("mart-", cx, cz, half, "#c8bca4", "#7a4a38", "#4a2e26", 90, 0.34);
    const counter = MeshBuilder.CreateBox("mart-counter", { width: 90, depth: 18, height: 14 }, this.scene);
    counter.material = this.surface("metal", "#4a5a68");
    counter.position = new Vector3(cx, INTERIOR_Y + 7, cz - half + 34);
    for (let i = 0; i < 3; i++) {
      const shelf = MeshBuilder.CreateBox(`mart-shelf-${i}`, { width: 16, depth: 90, height: 22 }, this.scene);
      shelf.material = this.surface("wood", i % 2 ? "#8a6a4a" : "#6a8a5a");
      shelf.position = new Vector3(cx - 50 + i * 50, INTERIOR_Y + 11, cz + 24);
    }
    const clerk = this.makeHumanoid("mart-clerk", "#3a6a4a", "#e6c39a");
    clerk.position = new Vector3(cx, INTERIOR_Y, cz - half + 16);
    const till = MeshBuilder.CreateBox("mart-till", { width: 14, depth: 10, height: 8 }, this.scene);
    till.material = this.surface("metal", "#2a2c30", 0.2);
    till.position = new Vector3(cx + 34, INTERIOR_Y + 18, cz - half + 34);
    this.buildSpotMarkers("mart-", this.spotsFor("coral-mart", { cx, cz, half }));
    // The room sits high above the city so the street cannot see into it, but a
    // camera pulled right back could still catch it hanging in the sky.
    this.registerRoom({ id: "coral-mart", name: "Coral Mart", prefix: "mart-", cx, cz, half, entryZ: half - 24 });
  }

  /**
   * The Malibu Club floor: a lit stage with poles and dancers, a pulsing dance
   * floor with a crowd on it, a bar, a DJ, and a VIP booth in the corner. The
   * room is deliberately bigger than the mart — there has to be somewhere to
   * walk to once you are inside.
   */
  private buildMalibuInterior(): void {
    const cx = 43 * TILE;
    const cz = 59 * TILE;
    const half = 168;
    const P = "club-";
    this.buildRoomShell(P, cx, cz, half, "#241730", "#4a2a56", "#1e1228", 108, 0.5);
    // Neon coving on the side walls: a dark club still needs walls you can see,
    // otherwise the room reads as a black void with furniture floating in it.
    for (const side of [-1, 1]) {
      for (const [i, y] of [30, 70].entries()) {
        const cove = MeshBuilder.CreateBox(`${P}cove-${side}-${i}`, { width: 4, depth: half * 1.8, height: 3 }, this.scene);
        cove.material = this.glow(`${P}m-cove-${side}-${i}`, i ? "#8a4aff" : "#4ad8c8", 0.9);
        cove.position = new Vector3(cx + side * (half - 5), INTERIOR_Y + y, cz);
      }
    }
    const rearCove = MeshBuilder.CreateBox(`${P}cove-rear`, { width: half * 1.9, depth: 4, height: 3 }, this.scene);
    rearCove.material = this.glow(`${P}m-cove-rear`, "#ff2f9a", 0.9);
    rearCove.position = new Vector3(cx, INTERIOR_Y + 84, cz + half - 5);

    // Stage: raised deck at the back, two poles, three dancers on it.
    const stageZ = cz - half + 54;
    const stage = MeshBuilder.CreateBox(`${P}stage`, { width: 190, depth: 78, height: 14 }, this.scene);
    stage.material = this.surface("wood", "#2e1424");
    stage.position = new Vector3(cx, INTERIOR_Y + 7, stageZ);
    const stageLip = MeshBuilder.CreateBox(`${P}stage-lip`, { width: 190, depth: 3, height: 3 }, this.scene);
    stageLip.material = this.glow(`${P}m-lip`, "#ff2f9a");
    stageLip.position = new Vector3(cx, INTERIOR_Y + 15, stageZ + 39);
    // A lit back wall behind the stage, with the club's name burned into it:
    // without it the dancers are silhouettes against a dark room and the eye
    // has nothing to land on.
    const backdrop = MeshBuilder.CreateBox(`${P}backdrop`, { width: 190, depth: 4, height: 76 }, this.scene);
    backdrop.material = this.signWall(`${P}m-backdrop`);
    backdrop.position = new Vector3(cx, INTERIOR_Y + 40, stageZ - 42);
    // Strip lights hug the edges of the wall so they frame the name, not cover it.
    for (const side of [-1, 1]) {
      const strip = MeshBuilder.CreateBox(`${P}stage-strip-${side}`, { width: 5, depth: 2, height: 62 }, this.scene);
      strip.material = this.glow(`${P}m-strip-${side}`, side < 0 ? "#4ad8c8" : "#ff2f9a", 0.95);
      strip.position = new Vector3(cx + side * 88, INTERIOR_Y + 44, stageZ - 38);
    }
    // Two hard spots pinning the poles, so the stage is plainly the main event.
    for (let i = 0; i < 2; i++) {
      const spot = MeshBuilder.CreateCylinder(
        `${P}stage-spot-${i}`,
        { height: 64, diameterTop: 8, diameterBottom: 40, tessellation: 10 },
        this.scene,
      );
      spot.material = this.beam(`${P}m-stage-spot-${i}`, "#ffd8ec", 0.14);
      spot.isPickable = false;
      spot.position = new Vector3(cx + (i === 0 ? -52 : 52), INTERIOR_Y + 60, stageZ);
    }
    const poleMat = this.surface("metal", "#d8d0c0", 0.6);
    for (let i = 0; i < 2; i++) {
      const px = cx + (i === 0 ? -52 : 52);
      const pole = MeshBuilder.CreateCylinder(`${P}pole-${i}`, { height: 94, diameter: 4, tessellation: 10 }, this.scene);
      pole.material = poleMat;
      pole.position = new Vector3(px, INTERIOR_Y + 61, stageZ);
      const dancer = this.makeHumanoid(`${P}dancer-${i}`, i === 0 ? "#ff3f8e" : "#39d8d0", "#e6c39a", "#1c1420");
      dancer.position = new Vector3(px + 15, INTERIOR_Y + 14, stageZ);
      dancer.rotation.y = Math.PI;
      this.addClubDancer(dancer, i, i * 1.7);
    }
    const lead = this.makeHumanoid(`${P}dancer-2`, "#f0d060", "#8a6a54", "#241626");
    lead.position = new Vector3(cx, INTERIOR_Y + 14, stageZ - 12);
    lead.rotation.y = Math.PI;
    this.addClubDancer(lead, 2, 0.8);

    // Dance floor: a checker of emissive tiles that the update loop cycles.
    const tileSize = 26;
    for (let gz = 0; gz < 5; gz++) {
      for (let gx = 0; gx < 5; gx++) {
        const t = MeshBuilder.CreateBox(`${P}tile-${gz}-${gx}`, { width: tileSize, depth: tileSize, height: 1.4 }, this.scene);
        const m = this.glow(`${P}tile-mat-${gz}-${gx}`, "#301840", 0.95);
        t.material = m;
        t.isPickable = false;
        t.position = new Vector3(cx + (gx - 2) * (tileSize + 2), INTERIOR_Y + 0.4, cz + (gz - 2) * (tileSize + 2) + 4);
        this.clubTiles.push({ mat: m, phase: (gx * 3 + gz * 5) % 8 });
      }
    }

    // Mirror ball over the floor, plus four coloured wash lights on the truss.
    const ball = MeshBuilder.CreateSphere(`${P}ball`, { diameter: 22, segments: 6 }, this.scene);
    ball.material = this.surface("metal", "#cfd6e0", 0.9);
    ball.position = new Vector3(cx, INTERIOR_Y + 90, cz + 4);
    this.clubBall = ball;
    const washHexes = ["#ff2f9a", "#4ad8c8", "#f0c040", "#8a4aff"];
    washHexes.forEach((hex, i) => {
      const ang = (i / washHexes.length) * Math.PI * 2;
      const beam = MeshBuilder.CreateCylinder(
        `${P}wash-${i}`,
        { height: 76, diameterTop: 6, diameterBottom: 54, tessellation: 10 },
        this.scene,
      );
      const m = this.beam(`${P}wash-mat-${i}`, hex, 0.1);
      beam.material = m;
      beam.isPickable = false;
      beam.position = new Vector3(cx + Math.cos(ang) * 74, INTERIOR_Y + 62, cz + Math.sin(ang) * 60);
      beam.rotation.z = Math.cos(ang) * 0.22;
      beam.rotation.x = Math.sin(ang) * 0.22;
      this.clubWashes.push({ mesh: beam, mat: m, phase: i * 1.4 });
    });

    // Bar along the west wall: counter, bottle shelf, bartender, stools.
    const barX = cx - half + 40;
    const bar = MeshBuilder.CreateBox(`${P}bar`, { width: 26, depth: 150, height: 24 }, this.scene);
    bar.material = this.surface("wood", "#40202e");
    bar.position = new Vector3(barX, INTERIOR_Y + 12, cz + 10);
    const barTop = MeshBuilder.CreateBox(`${P}bar-top`, { width: 32, depth: 154, height: 2.4 }, this.scene);
    barTop.material = this.glow(`${P}m-bartop`, "#4ad8c8", 0.9);
    barTop.position = new Vector3(barX, INTERIOR_Y + 25, cz + 10);
    const shelf = MeshBuilder.CreateBox(`${P}bar-shelf`, { width: 10, depth: 140, height: 44 }, this.scene);
    shelf.material = this.surface("wood", "#2a1620");
    shelf.position = new Vector3(barX - 22, INTERIOR_Y + 34, cz + 10);
    const bottleHexes = ["#e0b040", "#7ad080", "#e06060", "#70b0e0", "#d090e0"];
    for (let i = 0; i < 14; i++) {
      const b = MeshBuilder.CreateCylinder(`${P}bottle-${i}`, { height: 9, diameter: 3.2, tessellation: 6 }, this.scene);
      b.material = this.glow(`${P}bottle-mat-${i}`, bottleHexes[i % bottleHexes.length] ?? "#e0b040", 0.85);
      b.position = new Vector3(barX - 22, INTERIOR_Y + 60, cz - 58 + i * 9);
    }
    const tender = this.makeHumanoid(`${P}tender`, "#1c1c22", "#c4a07a", "#12121a");
    tender.position = new Vector3(barX - 12, INTERIOR_Y, cz + 10);
    tender.rotation.y = -Math.PI / 2;
    this.addClubDancer(tender, 3, 2.4);
    for (let i = 0; i < 4; i++) {
      const stool = MeshBuilder.CreateCylinder(`${P}stool-${i}`, { height: 16, diameter: 11, tessellation: 8 }, this.scene);
      stool.material = this.surface("metal", "#3a2a34");
      stool.position = new Vector3(barX + 26, INTERIOR_Y + 8, cz - 40 + i * 30);
    }

    // DJ booth in the far corner, speakers stacked either side.
    const djX = cx + half - 52;
    const booth = MeshBuilder.CreateBox(`${P}dj`, { width: 54, depth: 22, height: 26 }, this.scene);
    booth.material = this.surface("metal", "#241a2c");
    booth.position = new Vector3(djX, INTERIOR_Y + 13, cz - half + 46);
    const deck = MeshBuilder.CreateBox(`${P}dj-deck`, { width: 50, depth: 18, height: 2 }, this.scene);
    deck.material = this.glow(`${P}m-deck`, "#8a4aff", 0.9);
    deck.position = new Vector3(djX, INTERIOR_Y + 27, cz - half + 46);
    const dj = this.makeHumanoid(`${P}dj-guy`, "#8a4aff", "#8a6a54", "#1a1420");
    dj.position = new Vector3(djX, INTERIOR_Y, cz - half + 62);
    dj.rotation.y = Math.PI;
    this.addClubDancer(dj, 3, 1.1);
    for (let i = 0; i < 2; i++) {
      const stack = MeshBuilder.CreateBox(`${P}speaker-${i}`, { width: 20, depth: 18, height: 52 }, this.scene);
      stack.material = this.surface("plastic", "#15121a");
      stack.position = new Vector3(djX + (i ? 42 : -42), INTERIOR_Y + 26, cz - half + 46);
      const cone = MeshBuilder.CreateCylinder(`${P}speaker-cone-${i}`, { height: 2, diameter: 13, tessellation: 10 }, this.scene);
      cone.material = this.surface("plastic", "#2a2430");
      cone.rotation.x = Math.PI / 2;
      cone.position = new Vector3(djX + (i ? 42 : -42), INTERIOR_Y + 34, cz - half + 36);
    }

    // VIP booth: a roped-off corner with a curved bench and a low table.
    const vipX = cx + half - 56;
    const vipZ = cz + 52;
    const vipFloor = MeshBuilder.CreateBox(`${P}vip-floor`, { width: 96, depth: 88, height: 4 }, this.scene);
    vipFloor.material = this.surface("cloth", "#4a1030");
    vipFloor.position = new Vector3(vipX, INTERIOR_Y + 1.5, vipZ);
    for (let i = 0; i < 3; i++) {
      const bench = MeshBuilder.CreateBox(`${P}vip-bench-${i}`, { width: 30, depth: 16, height: 16 }, this.scene);
      bench.material = this.surface("leather", "#7a1840");
      bench.position = new Vector3(vipX - 30 + i * 30, INTERIOR_Y + 11, vipZ - 32);
    }
    const table = MeshBuilder.CreateCylinder(`${P}vip-table`, { height: 12, diameter: 30, tessellation: 12 }, this.scene);
    table.material = this.surface("metal", "#2a1c26");
    table.position = new Vector3(vipX, INTERIOR_Y + 7, vipZ);
    const bucket = MeshBuilder.CreateCylinder(`${P}vip-bucket`, { height: 10, diameter: 12, tessellation: 10 }, this.scene);
    bucket.material = this.glow(`${P}m-bucket`, "#f0c040", 0.9);
    bucket.position = new Vector3(vipX, INTERIOR_Y + 18, vipZ);
    for (let i = 0; i < 4; i++) {
      const post = MeshBuilder.CreateCylinder(`${P}rope-post-${i}`, { height: 22, diameter: 5, tessellation: 8 }, this.scene);
      post.material = this.glow(`${P}m-post-${i}`, "#f0c040", 0.9);
      post.position = new Vector3(vipX - 48 + i * 4, INTERIOR_Y + 11, vipZ - 44 + i * 30);
    }

    // Punters: a few standing at the rail, a few moving on the floor.
    const crowd: Array<[number, number, string, string]> = [
      [cx - 46, cz - 40, "#d84a6a", "#c4a07a"],
      [cx + 40, cz - 34, "#4a90d8", "#8a6a54"],
      [cx - 20, cz + 46, "#d8a040", "#e6c39a"],
      [cx + 26, cz + 40, "#7ad080", "#6a4a3a"],
      [cx - 70, cz - 60, "#b070e0", "#c4a07a"],
      [cx + 74, cz - 8, "#e07050", "#8a6a54"],
    ];
    crowd.forEach(([x, z, shirt, skin], i) => {
      const p = this.makeHumanoid(`${P}punter-${i}`, shirt, skin, "#221a26");
      p.position = new Vector3(x, INTERIOR_Y, z);
      p.rotation.y = Math.atan2(cz - half + 54 - z, cx - x);
      this.addClubDancer(p, i % 3, i * 0.9);
    });

    this.buildSpotMarkers(P, this.spotsFor("malibu-club", { cx, cz, half }));
    this.registerRoom({ id: "malibu-club", name: "Malibu Club", prefix: P, cx, cz, half, entryZ: half - 30 });
  }

  /**
   * The street side of the Malibu: a lit awning, a roped queue and a bouncer
   * who is clearly not going anywhere. Without this the club is just another
   * door on a block of doors.
   */
  private dressClubDoor(): void {
    const mark = this.world.landmarks.find((l) => l.id === "malibu-club");
    if (!mark) return;
    const dx = (mark.doorX + 0.5) * TILE;
    const dz = (mark.doorY + 0.5) * TILE;
    const carpet = MeshBuilder.CreateBox("clubdoor-carpet", { width: 34, depth: 44, height: 0.8 }, this.scene);
    carpet.material = this.surface("cloth", "#7a1030");
    carpet.position = new Vector3(dx, 0.6, dz + 16);
    const glow = MeshBuilder.CreateBox("clubdoor-glow", { width: 30, depth: 2, height: 2.4 }, this.scene);
    glow.material = this.glow("clubdoor-glow-mat", "#ff2f9a");
    glow.position = new Vector3(dx, 25, dz + 3);
    // Uplighters either side of the door, so the entrance glows after dark.
    for (const side of [-1, 1]) {
      const wash = MeshBuilder.CreateCylinder(
        `clubdoor-wash-${side}`,
        { height: 22, diameterTop: 16, diameterBottom: 4, tessellation: 8 },
        this.scene,
      );
      wash.material = this.beam(`clubdoor-wash-mat-${side}`, "#ff2f9a", 0.16);
      wash.isPickable = false;
      wash.position = new Vector3(dx + side * 15, 11, dz + 2);
    }
    // Two ropes down the sides of the carpet, four posts holding them up.
    for (const side of [-1, 1]) {
      for (const along of [6, 34]) {
        const post = MeshBuilder.CreateCylinder(`clubdoor-post-${side}-${along}`, { height: 18, diameter: 3, tessellation: 8 }, this.scene);
        post.material = this.glow(`clubdoor-post-mat-${side}-${along}`, "#f0c040", 0.95);
        post.position = new Vector3(dx + side * 21, 9, dz + along);
      }
      const rope = MeshBuilder.CreateBox(`clubdoor-rope-${side}`, { width: 1.6, depth: 28, height: 1.6 }, this.scene);
      rope.material = this.surface("cloth", "#8a1030");
      rope.position = new Vector3(dx + side * 21, 14, dz + 20);
    }
    // A lit facade panel above the awning: the street should read "club" from
    // the far pavement, not only once you are standing on the carpet.
    const facade = MeshBuilder.CreateBox("clubdoor-sign", { width: 88, depth: 2, height: 24 }, this.scene);
    facade.material = this.signWall("clubdoor-sign-mat");
    facade.position = new Vector3(dx, 36, dz + 1);
    const bouncer = this.makeHumanoid("clubdoor-bouncer", "#14141a", "#6a4a3a", "#101018");
    bouncer.position = new Vector3(dx + 18, 0, dz + 8);
    bouncer.rotation.y = -Math.PI / 2;
    // Two hopefuls in the queue, so the door reads as somewhere worth being.
    const queue: Array<[number, number, string, string]> = [
      [dx - 16, dz + 26, "#d84a6a", "#c4a07a"],
      [dx - 6, dz + 38, "#4a90d8", "#8a6a54"],
    ];
    queue.forEach(([x, z, shirt, skin], i) => {
      const g = this.makeHumanoid(`clubdoor-guest-${i}`, shirt, skin, "#221a26");
      g.position = new Vector3(x, 0, z);
      g.rotation.y = Math.PI / 2;
    });
  }

  /** Records where a body stands so its dance can be an offset from it. */
  private addClubDancer(mesh: Mesh, style: number, phase: number): void {
    this.clubDancers.push({ mesh, style, phase, baseY: mesh.position.y, baseRotY: mesh.rotation.y });
  }

  /** A lit disc and a floating tag for every place E does something. */
  private buildSpotMarkers(prefix: string, spots: InteriorSpot[]): void {
    spots.forEach((spot, i) => {
      const disc = MeshBuilder.CreateCylinder(`${prefix}spot-${i}`, { diameter: 34, height: 1.6, tessellation: 14 }, this.scene);
      disc.material = this.glow(`${prefix}spot-mat-${i}`, spot.color, 0.85);
      disc.isPickable = false;
      disc.position = new Vector3(spot.x, INTERIOR_Y + 1, spot.z);
      const label = MeshBuilder.CreatePlane(`${prefix}spot-lbl-${i}`, { width: 40, height: 10 }, this.scene);
      const ltex = new DynamicTexture(`${prefix}spot-lt-${i}`, { width: 256, height: 64 }, this.scene, false);
      const lctx = ltex.getContext();
      lctx.fillStyle = "#120e0c";
      lctx.fillRect(0, 0, 256, 64);
      lctx.fillStyle = spot.color;
      lctx.font = "bold 30px Impact, sans-serif";
      const lt = lctx as unknown as CanvasRenderingContext2D;
      lt.textAlign = "center";
      lt.textBaseline = "middle";
      lctx.fillText(spot.tag, 128, 32);
      ltex.update();
      const lmat = new StandardMaterial(`${prefix}spot-lm-${i}`, this.scene);
      lmat.diffuseTexture = ltex;
      lmat.emissiveTexture = ltex;
      lmat.emissiveColor = new Color3(0.8, 0.7, 0.5);
      lmat.specularColor = Color3.Black();
      label.material = lmat;
      // Above head height: at eye level the plate sits in the player's face.
      label.position = new Vector3(spot.x, INTERIOR_Y + 34, spot.z);
      label.billboardMode = 7;
      label.isPickable = false;
    });
  }

  private showInterior(on: boolean): void {
    const room = this.interiorMode ? this.rooms.get(this.interiorMode.id) : null;
    if (!room) return;
    for (const m of room.meshes) m.setEnabled(on);
  }

  /** Shared interior spots — discs, prompts, and E-actions must agree. */
  private spotsFor(id: string, room: { cx: number; cz: number; half: number }): InteriorSpot[] {
    const { cx, cz, half } = room;
    if (id === "malibu-club") {
      return [
        { x: cx, z: cz - half + 92, r: 44, color: "#ff4aa8", tag: "TIP", prompt: `E  ·  TIP THE STAGE $${CLUB.tip}`, kind: "tip" },
        { x: cx - half + 52, z: cz + 10, r: 40, color: "#4ad8c8", tag: "BAR", prompt: `E  ·  DRINK $${CLUB.drink} (+25 hp)`, kind: "bar" },
        { x: cx + half - 56, z: cz + 52, r: 42, color: "#f0c040", tag: "VIP", prompt: `E  ·  VIP BOOTH $${CLUB.vip}`, kind: "vip" },
        { x: cx, z: cz + 4, r: 46, color: "#a060ff", tag: "DANCE", prompt: "E  ·  GET ON THE FLOOR", kind: "dance" },
        { x: cx, z: cz + half - 26, r: 40, color: "#f3e6d2", tag: "EXIT", prompt: "E  ·  LEAVE", kind: "leave" },
      ];
    }
    return [
      { x: cx + 34, z: cz - half + 56, r: 36, color: "#d84020", tag: "ROB", prompt: "E  ·  ROB THE TILL", kind: "rob" },
      { x: cx, z: cz - half + 56, r: 36, color: "#7aa874", tag: "MEAL", prompt: "E  ·  BUY MEAL $15 (+35 hp)", kind: "meal" },
      { x: cx - 74, z: cz + 24, r: 36, color: "#c49a6a", tag: "COFFEE", prompt: "E  ·  COFFEE $8 (sprint boost)", kind: "coffee" },
      { x: cx + 74, z: cz + 24, r: 36, color: "#6aa0d4", tag: "VEST", prompt: "E  ·  VEST $150 (+60 armor)", kind: "vest" },
      { x: cx, z: cz + half - 24, r: 40, color: "#f3e6d2", tag: "EXIT", prompt: "E  ·  LEAVE", kind: "leave" },
    ];
  }

  private activeRoom(): InteriorRoom | null {
    return this.interiorMode ? (this.rooms.get(this.interiorMode.id) ?? null) : null;
  }

  private activeSpots(): InteriorSpot[] {
    const room = this.activeRoom();
    if (!room) return [];
    return this.spotsFor(room.id, room);
  }

  /**
   * The door of the Malibu. The bouncer takes a cover charge and turns away
   * anyone the police are actively looking for — a club is not a hiding place.
   */
  private enterClub(): void {
    if (this.heat.level >= 2) {
      this.say("BOUNCER", "Sirens two streets away and you want a table? Walk on.");
      this.audio.uiClick();
      return;
    }
    if (this.player.cash < CLUB.cover) {
      this.say("BOUNCER", `Cover is $${CLUB.cover}. Come back when the night's been kinder.`);
      this.audio.uiClick();
      return;
    }
    this.player.cash -= CLUB.cover;
    this.audio.cash();
    this.clubVisit = { tips: 0, vip: false };
    this.danceT = 0;
    this.enterInterior("malibu-club");
    this.preClubStation = this.audio.station;
    if (this.audio.station !== "off") this.audio.setStation("palm");
    this.audio.setVenue(true);
    this.flash(`MALIBU CLUB  ·  cover $${CLUB.cover}  ·  bar, stage, VIP booth`);
    this.say("BOUNCER", "Hands to yourself, tip the stage, don't start anything.");
  }

  /** A small camera kick for moments that are felt rather than hit. */
  private pulse(amount: number): void {
    if (this.settings.shake) this.shake = Math.max(this.shake, amount);
  }

  private clubDrink(): void {
    if (this.player.cash < CLUB.drink) {
      this.say("BARTENDER", `House pour is $${CLUB.drink}, friend. Cash only.`);
      return;
    }
    this.player.cash -= CLUB.drink;
    this.player.health = Math.min(100, this.player.health + 25);
    this.audio.cash();
    this.flash(`HOUSE POUR  ·  +25 health  ·  $${CLUB.drink}`);
  }

  private clubTip(): void {
    if (this.player.cash < CLUB.tip) {
      this.say("DANCER", "Empty pockets don't get eye contact, sugar.");
      return;
    }
    this.player.cash -= CLUB.tip;
    this.audio.cash();
    this.pulse(0.9);
    // The room only respects the first few notes: after that you are a mark.
    if (this.clubVisit.tips < CLUB.paidTips) {
      this.clubVisit.tips += 1;
      this.player.streetRep += CLUB.tipRep;
      this.player.xp += 10;
      this.flash(`TIPPED THE STAGE  ·  +${CLUB.tipRep} street rep  ·  $${CLUB.tip}`);
    } else {
      this.flash(`TIPPED THE STAGE  ·  $${CLUB.tip}  ·  the room has stopped counting`);
    }
  }

  private clubVip(): void {
    if (this.clubVisit.vip) {
      this.say("HOST", "Your table is already open. Enjoy it.");
      return;
    }
    if (this.player.cash < CLUB.vip) {
      this.say("HOST", `The booth runs $${CLUB.vip}. The rail is free.`);
      return;
    }
    this.player.cash -= CLUB.vip;
    this.clubVisit.vip = true;
    this.player.health = 100;
    this.player.armor = Math.min(100, this.player.armor + 20);
    this.player.streetRep += CLUB.vipRep;
    this.player.xp += CLUB.vipXp;
    this.audio.cash();
    this.pulse(1.4);
    this.flash(`VIP BOOTH  ·  +${CLUB.vipRep} rep  ·  +${CLUB.vipXp} xp  ·  $${CLUB.vip}`);
    this.say("HOST", "Southside knows your face after tonight. Spend like that again.");
  }

  private clubDance(): void {
    this.danceT = CLUB.danceSeconds;
    if (this.clock - this.lastDance < CLUB.danceCooldown) {
      this.flash("ON THE FLOOR  ·  the crowd has seen this one already");
      return;
    }
    this.lastDance = this.clock;
    this.player.xp += CLUB.danceXp;
    this.pulse(0.8);
    this.flash(`ON THE FLOOR  ·  +${CLUB.danceXp} xp  ·  the crowd opens up`);
  }

  /** Lights, bodies and the mirror ball — only ticked while you are inside. */
  private updateClub(dt: number): void {
    if (this.interiorMode?.id !== "malibu-club") return;
    const t = this.clock;
    for (const d of this.clubDancers) this.poseDance(d, t);
    // The floor runs a four-colour chase locked to the same beat the dancers
    // use, and every few bars the whole grid slams to one colour — a chase
    // alone just permutes the same palette and reads as a static floor.
    const beat = Math.floor(t * 2.2);
    const palette = ["#ff2f9a", "#4ad8c8", "#f0c040", "#8a4aff"];
    const unison = Math.floor(beat / 6) % 3 === 2;
    for (const tile of this.clubTiles) {
      const hex = palette[(beat + (unison ? 0 : tile.phase)) % palette.length] ?? "#ff2f9a";
      const lift = unison ? 0.5 + 0.85 * Math.abs(Math.sin(t * 6.6)) : 0.55 + 0.45 * Math.abs(Math.sin(t * 4.4 + tile.phase));
      tile.mat.emissiveColor = Color3.FromHexString(hex).scale(lift);
    }
    for (const w of this.clubWashes) {
      w.mat.alpha = 0.07 + 0.09 * Math.abs(Math.sin(t * 2.6 + w.phase));
      w.mesh.rotation.y += dt * 0.9;
    }
    if (this.clubBall) this.clubBall.rotation.y += dt * 1.4;
    if (this.danceT > 0) this.danceT = Math.max(0, this.danceT - dt);
  }

  /**
   * Dancing is a bounce, a hip turn and arms that do not hang: enough motion
   * that a room full of these reads as a full club and not a waxwork museum.
   */
  private poseDance(d: ClubDancer, t: number): void {
    const meta = d.mesh.metadata as { armL?: Mesh; armR?: Mesh; legL?: Mesh; legR?: Mesh } | undefined;
    if (!meta) return;
    const beat = t * 3.6 + d.phase;
    const s = Math.sin(beat);
    const bounce = Math.abs(Math.sin(beat));
    if (d.style === 3) {
      // Behind a counter: a nod and a shoulder, nothing that leaves the spot.
      d.mesh.position.y = d.baseY + bounce * 0.7;
      d.mesh.rotation.y = d.baseRotY + s * 0.12;
      if (meta.armL) meta.armL.rotation.x = s * 0.35;
      if (meta.armR) meta.armR.rotation.x = -s * 0.35;
      return;
    }
    d.mesh.position.y = d.baseY + bounce * (d.style === 0 ? 1.1 : 1.9);
    // Style 0 works the pole and turns around it; the rest sway on the spot.
    d.mesh.rotation.y = d.style === 0 ? d.baseRotY + t * 0.85 : d.baseRotY + s * 0.42;
    if (meta.armL) {
      meta.armL.rotation.z = (d.style === 0 ? 2.1 : 1.2) + s * 0.35;
      meta.armL.rotation.x = s * 0.6;
    }
    if (meta.armR) {
      meta.armR.rotation.z = (d.style === 0 ? -2.1 : -1.2) + s * 0.35;
      meta.armR.rotation.x = -s * 0.6;
    }
    if (meta.legL) meta.legL.rotation.x = s * 0.3;
    if (meta.legR) meta.legR.rotation.x = -s * 0.3;
  }

  private enterInterior(id: string): void {
    const room = this.rooms.get(id);
    if (!room) return;
    this.interiorMode = { id, returnX: this.player.x, returnZ: this.player.z };
    this.showInterior(true);
    this.player.x = room.cx;
    this.player.z = room.cz + room.entryZ;
    this.player.vehicleId = null;
    this.audio.uiClick();
  }

  private exitInterior(): void {
    if (!this.interiorMode) return;
    const club = this.interiorMode.id === "malibu-club";
    // Step out a clear stride onto the pavement with the camera left in the
    // street looking back at the frontage. Landing flush against the door with
    // the boom behind the player buries the lens in the building.
    const door = this.landmarkDoor(this.interiorMode.id);
    if (door) {
      this.player.x = door.x;
      this.player.z = door.z + TILE * 1.15;
      this.player.heading = -Math.PI / 2;
      this.player.camYaw = Math.PI;
    } else {
      this.player.x = this.interiorMode.returnX;
      this.player.z = this.interiorMode.returnZ;
    }
    this.clearInterior();
    if (club) this.flash("MALIBU CLUB  ·  back out on the strip");
    this.audio.uiClick();
  }

  /**
   * Tears the room down without moving the player: used when something else
   * has already decided where they end up, such as being arrested.
   */
  private clearInterior(): void {
    if (!this.interiorMode) return;
    this.showInterior(false);
    if (this.interiorMode.id === "malibu-club") {
      this.audio.setVenue(false);
      if (this.preClubStation && this.audio.station === "palm") this.audio.setStation(this.preClubStation);
      this.preClubStation = null;
    }
    this.interiorMode = null;
    this.danceT = 0;
  }

  /** Interior interactions resolve by proximity to the same spots the discs use. */
  private interactInterior(): void {
    if (!this.interiorMode) return;
    const spot = this.activeSpots().find((s) => Math.hypot(this.player.x - s.x, this.player.z - s.z) < s.r);
    if (!spot) return;
    switch (spot.kind) {
      case "rob":
        this.robStore();
        this.exitInterior();
        return;
      case "bar":
        this.clubDrink();
        return;
      case "tip":
        this.clubTip();
        return;
      case "vip":
        this.clubVip();
        return;
      case "dance":
        this.clubDance();
        return;
      case "meal":
        if (this.player.cash >= 15) {
          this.player.cash -= 15;
          this.player.health = Math.min(100, this.player.health + 35);
          this.audio.cash();
          this.flash("HOT MEAL  ·  +35 health  ·  $15");
        } else {
          this.flash("CLERK  ·  fifteen bucks, friend");
        }
        return;
      case "coffee":
        if (this.player.cash >= 8) {
          this.player.cash -= 8;
          this.player.sprintBoost = 30;
          this.audio.cash();
          this.flash("COFFEE  ·  sprint boost 30s  ·  $8");
        } else {
          this.flash("MACHINE  ·  $8, exact change only");
        }
        return;
      case "vest":
        if (this.player.armor >= 95) {
          this.flash("CLERK  ·  you're already wearing one");
        } else if (this.player.cash >= 150) {
          this.player.cash -= 150;
          this.player.armor = Math.min(100, this.player.armor + 60);
          this.audio.cash();
          this.flash("KEVLAR VEST  ·  +60 armor  ·  $150");
        } else {
          this.flash("CLERK  ·  vest is $150, no layaway");
        }
        return;
      case "leave":
        this.exitInterior();
        return;
      default: {
        const _n: never = spot.kind;
        return _n;
      }
    }
  }

  private interiorPrompt(): string {
    if (!this.interiorMode) return "";
    for (const s of this.activeSpots()) {
      if (Math.hypot(this.player.x - s.x, this.player.z - s.z) < s.r) return s.prompt;
    }
    return "Walk onto a labeled disc";
  }

  // ---------------------------------------------------------------- update

  /**
   * Consumes real elapsed time in fixed steps so the world keeps its own pace
   * whatever the renderer manages. The leftover is carried to the next frame.
   */
  private stepSim(frame: number): void {
    this.simDebt = Math.min(this.simDebt + frame, SIM.stepSeconds * SIM.maxStepsPerFrame);
    let steps = 0;
    while (this.simDebt >= SIM.stepSeconds && steps < SIM.maxStepsPerFrame) {
      this.simDebt -= SIM.stepSeconds;
      steps++;
      this.update(SIM.stepSeconds);
    }
    // A frame shorter than one step still needs the camera to track the world.
    if (steps === 0) this.updateCamera(frame);
  }

  private update(rawDt: number): void {
    // Hit stop runs on real time; everything else crawls while it lasts.
    let dt = rawDt;
    if (this.hitStop > 0) {
      this.hitStop = Math.max(0, this.hitStop - rawDt);
      dt = rawDt * 0.14;
    }
    this.clock += dt;
    this.time = (this.time + dt * WORLD_CONFIG.hoursPerRealSecond * 3600) % 24;
    this.weatherT += dt;
    if (this.weatherT > WORLD_CONFIG.weatherCycleSeconds) {
      this.weatherT = 0;
      this.weather = this.weather === "clear" ? "rain" : this.weather === "rain" ? "fog" : "clear";
    }
    if (this.storm) this.weather = "rain";
    this.updateDayNight();
    this.updatePerf(dt);

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

    this.updateBeacon();
    this.updateClub(dt);
    this.updatePlayer(dt);
    this.updateCars(dt);
    this.updateActors(dt);
    this.updateCops(dt);
    this.lastShot += dt;
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

    // Checked here rather than inside the on-foot branch: a player shot to
    // pieces behind the wheel used to simply keep driving at zero health.
    if (this.player.health <= 0 && this.jailLeft <= 0) this.die();
    if (this.failureT > 0) this.failureT -= dt;
    else this.failure = null;

    this.updateThrill(dt);
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
    this.hudAcc += dt;
    const hud = this.hud();
    const key = `${hud.cash}|${hud.health}|${hud.armor}|${hud.prompt}|${hud.objective}|${hud.toast}|${hud.heat}|${hud.lockpick?.pos.toFixed(2) ?? ""}|${Math.round((hud.waypointBearing ?? 0) * 8)}|${hud.phoneOpen}|${hud.jailLeft}|${hud.combo}|${Math.round(hud.speed / 4)}`;
    if (this.lockpick || this.hudAcc > 0.07 || key !== this.lastHudKey) {
      this.hudAcc = 0;
      this.lastHudKey = key;
      this.onHud?.(hud);
    }
  }

  private updateDayNight(): void {
    const t = this.time;
    const day = t > 6.5 && t < 19;
    const dusk = (t > 5 && t <= 6.5) || (t >= 19 && t < 21);
    this.hemi.intensity = this.blackout ? 0.28 : day ? 1.28 : dusk ? 0.9 : 0.58;
    this.sun.intensity = this.blackout ? 0.08 : day ? 1.2 : dusk ? 0.62 : 0.22;
    const sky = this.blackout
      ? new Color4(0.05, 0.05, 0.08, 1)
      : day ? new Color4(0.48, 0.68, 0.86, 1) : dusk ? new Color4(0.72, 0.48, 0.36, 1) : new Color4(0.12, 0.11, 0.18, 1);
    this.scene.clearColor = sky;
    const fog = this.weather === "fog" ? 0.00028 : this.weather === "rain" ? 0.00016 : 0.00007;
    this.scene.fogMode = Scene.FOGMODE_EXP2;
    this.scene.fogDensity = fog;
    this.scene.fogColor = new Color3(sky.r, sky.g, sky.b);
  }

  private updatePlayer(dt: number): void {
    if (this.player.vehicleId) {
      if (this.input.consumeInteract()) this.exitVehicle();
      this.playerMesh.setEnabled(false);
      // Getting into a car with the sights up must not leave the camera stuck
      // in the aimed pose for the rest of the drive.
      this.aiming = false;
      return;
    }
    this.playerMesh.setEnabled(true);
    const axis = this.input.axis();
    this.updateWeapon(dt);
    if (this.player.sprintBoost > 0) this.player.sprintBoost -= dt;
    const boost = this.player.sprintBoost > 0 && axis.sprint ? 1.18 : 1;
    const aimDrag = this.aiming ? AIM_CONFIG.moveScale : 1;
    const speed =
      (axis.sprint ? PLAYER_CONFIG.sprintSpeed : PLAYER_CONFIG.walkSpeed) * boost * aimDrag * (this.weather === "rain" ? 0.94 : 1);
    // Camera-relative movement.
    const yaw = this.player.camYaw;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    const mx = rx * axis.x + fx * -axis.y;
    const mz = rz * axis.x + fz * -axis.y;
    const mag = Math.hypot(mx, mz);
    // Off the ground the player is a projectile on a rope, not a walker: the
    // web takes the step and reports back whether the ground rules still apply.
    const airborne = this.updateTraversal(dt, axis);
    if (!airborne && mag > 0.05) {
      const nx = this.player.x + (mx / mag) * Math.min(1, mag) * speed * dt;
      const nz = this.player.z + (mz / mag) * Math.min(1, mag) * speed * dt;
      const inside = this.activeRoom();
      if (inside) {
        // Interior collision is the room's walls, not the city grid.
        const { cx, cz, half } = inside;
        this.player.x = Math.max(cx - half + 12, Math.min(cx + half - 12, nx));
        this.player.z = Math.max(cz - half + 12, Math.min(cz + half - 12, nz));
      } else {
        if (!this.airSolid(nx, this.player.z, this.player.y)) this.player.x = nx;
        if (!this.airSolid(this.player.x, nz, this.player.y)) this.player.z = nz;
        // Carry walking speed into the air, so stepping off a roof is a leap
        // rather than a stone dropping straight down.
        this.flight.vx = (mx / mag) * speed;
        this.flight.vz = (mz / mag) * speed;
      }
      if (!this.aiming) this.player.heading = Math.atan2(mz, mx);
      this.lastFoot += dt;
      if (this.lastFoot > (axis.sprint ? 0.22 : 0.32)) {
        this.lastFoot = 0;
        const cell = cellAt(this.world, this.player.x, this.player.z);
        const surface = cell === Cell.Sand ? "sand" : cell === Cell.Grass ? "grass" : cell === Cell.Dock ? "metal" : "concrete";
        this.audio.foot(axis.sprint, surface);
      }
    }
    if (this.input.consumeInteract()) {
      if (this.interiorMode) this.interactInterior();
      else this.tryInteract();
    }
    if (!this.interiorMode) this.tryFire(dt);
    const elev = this.interiorMode ? INTERIOR_Y : 0;
    const bob = mag > 0.05 && this.player.grounded ? Math.abs(Math.sin(this.clock * (axis.sprint ? 14 : 9))) * 1.1 : 0;
    // Stand off the brickwork a little, or the tilted body sinks half of
    // itself into the facade it is holding.
    const hug = this.cling ? -6 : 0;
    this.playerMesh.position.set(
      this.player.x + Math.cos(this.cling?.dir ?? 0) * hug,
      elev + this.player.y + bob,
      this.player.z + Math.sin(this.cling?.dir ?? 0) * hug,
    );
    // A contact shadow makes no sense on a body in mid-air.
    const shadow = (this.playerMesh.metadata as { shadow?: Mesh } | undefined)?.shadow;
    shadow?.setEnabled(this.player.grounded && !this.cling);
    if (this.cling) {
      // Belly to the brickwork. Standing bolt upright while sliding up a wall
      // read as levitating, not climbing.
      this.playerMesh.rotationQuaternion = Quaternion.RotationYawPitchRoll(-this.player.heading, -0.62, 0);
    } else {
      this.playerMesh.rotationQuaternion = null;
      this.playerMesh.rotation.y = -this.player.heading;
    }
    if (mag > 0.05) this.danceT = 0;
    if (airborne) {
      this.poseSling(this.playerMesh);
    } else if (this.danceT > 0) {
      // Standing still on the club floor after hitting E: dance, don't idle.
      this.poseDance({ mesh: this.playerMesh, style: 1, phase: 0, baseY: elev, baseRotY: -this.player.heading }, this.clock);
    } else {
      this.poseWalk(this.playerMesh, mag > 0.05, axis.sprint);
      if (this.armed()) this.poseAim(this.playerMesh, this.aiming || this.clock - this.lastFired < 0.7, this.recoil * 3);
      else this.posePunch(this.playerMesh, this.clock - this.lastFired);
    }
    this.separateFromBodies();
  }

  // -------------------------------------------------------- web-slinging
  //
  // The city is 96x80 tiles of grid, and until now gameplay only ever asked it
  // one question: is this square solid? That is enough to walk around a block
  // and nothing else. Roof heights come out of the mesh builder now, so the
  // same grid can answer where a wall ends, what you are standing on, and what
  // is high enough to hang a line from.

  /** Roof height at a world position: 0 for open sky, Infinity off the map. */
  private topAt(x: number, z: number): number {
    const tx = Math.floor(x / TILE);
    const tz = Math.floor(z / TILE);
    if (tx < 0 || tz < 0 || tx >= MAP_W || tz >= MAP_H) return Number.POSITIVE_INFINITY;
    return this.city.tops[tz * MAP_W + tx] ?? 0;
  }

  /** The four corners and the middle of the player's footprint. */
  private footprint(x: number, z: number, rad: number): Array<[number, number]> {
    return [
      [x - rad, z - rad],
      [x + rad, z - rad],
      [x - rad, z + rad],
      [x + rad, z + rad],
      [x, z],
    ];
  }

  /**
   * Whether a body of the player's size is inside something at this height.
   * At street level the old 2D answer still stands, which keeps water, kerbs
   * and map edges behaving exactly as they did; above it, only the part of a
   * building below its roof is in the way.
   */
  private airSolid(x: number, z: number, y: number, rad = PLAYER_CONFIG.radius): boolean {
    if (y <= LEDGE_STEP) return blocked(this.world, x, z, rad);
    for (const [px, pz] of this.footprint(x, z, rad)) if (y < this.topAt(px, pz) - LEDGE_STEP) return true;
    return false;
  }

  /**
   * Whether the thing in the way here is a building you can hold onto. Off the
   * map every column reads as infinitely solid, and a wall with no top is a
   * wall you climb forever, so the boundary stays a limit rather than a route.
   * A shoulder clips the corner of a tower more often than the chest hits it
   * square on, so this asks the whole footprint, same as the collision did.
   */
  private climbable(x: number, z: number, y: number, rad = PLAYER_CONFIG.radius): boolean {
    for (const [px, pz] of this.footprint(x, z, rad)) {
      const top = this.topAt(px, pz);
      if (Number.isFinite(top) && y < top - LEDGE_STEP) return true;
    }
    return false;
  }

  /** The surface under the player's feet: a rooftop if they are over one. */
  private supportY(x: number, z: number, y: number, rad = PLAYER_CONFIG.radius): number {
    let best = 0;
    for (const [px, pz] of this.footprint(x, z, rad)) {
      const top = this.topAt(px, pz);
      if (!Number.isFinite(top) || top <= 0) continue;
      if (top <= y + LEDGE_STEP && top > best) best = top;
    }
    return best;
  }

  /**
   * The nearest thing worth webbing, looking where the camera looks. A narrow
   * cone rather than a single ray, because a line that only attaches to what
   * is dead ahead makes the city feel like it is refusing you.
   */
  private findAnchor(rise: number = SPIDER_CONFIG.minAnchorRise): { x: number; y: number; z: number } | null {
    const base = headingFromCamera(this.player.camYaw);
    let best: { x: number; y: number; z: number } | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const off of [0, 0.2, -0.2, 0.42, -0.42, 0.68, -0.68, 0.98, -0.98]) {
      const dir = base + off;
      const cos = Math.cos(dir);
      const sin = Math.sin(dir);
      // Everything a shot passes over has to be lower than the last, or it is
      // behind a wall you cannot see through. Marching on rather than stopping
      // at the first block is what lets you web the tower over the corner shop.
      let overShoulder = 0;
      for (let d = 30; d <= SPIDER_CONFIG.maxRange; d += 9) {
        const x = this.player.x + cos * d;
        const z = this.player.z + sin * d;
        const top = this.topAt(x, z);
        if (!Number.isFinite(top)) break;
        if (top <= overShoulder) continue;
        overShoulder = top;
        // Just under the parapet, so the line reads as caught on the edge.
        const y = top - 7;
        if (!anchorUsable(this.player.x, this.player.y, this.player.z, x, y, z, rise)) continue;
        const score = d + Math.abs(off) * 260;
        if (score < bestScore) {
          bestScore = score;
          best = { x, y, z };
        }
        break;
      }
    }
    return best;
  }

  private fireWeb(): void {
    const a = this.findAnchor();
    if (!a) {
      // The reticle and the readout already say there is nothing to catch, so
      // a toast in the middle of the screen only covers the city up.
      this.webCooldown = 0.3;
      if (!this.webWarned) {
        this.webWarned = true;
        this.audio.uiClick();
      }
      return;
    }
    this.webWarned = false;
    this.web = { x: a.x, y: a.y, z: a.z, length: initialLength(this.player.x, this.player.y, this.player.z, a.x, a.y, a.z) };
    this.swingT = 0;
    if (this.player.grounded) {
      // Stepping off into the first swing needs a throw: from a standstill the
      // line has no arc to work with and just tips you over.
      const toward = Math.atan2(a.z - this.player.z, a.x - this.player.x);
      this.flight.vy = Math.max(this.flight.vy, SPIDER_CONFIG.launchLift);
      this.flight.vx += Math.cos(toward) * SPIDER_CONFIG.launchSpeed;
      this.flight.vz += Math.sin(toward) * SPIDER_CONFIG.launchSpeed;
      this.player.grounded = false;
      this.player.y = Math.max(this.player.y, 2);
    }
    this.cling = null;
    this.audio.thwip();
    this.showSplat(a);
  }

  private releaseWeb(): void {
    if (!this.web) return;
    const s = releaseSwing({ x: this.player.x, y: this.player.y, z: this.player.z, ...this.flight });
    this.flight = { vx: s.vx, vy: s.vy, vz: s.vz };
    this.web = null;
    this.swingT = 0;
    this.webCooldown = 0.12;
    this.webSplat?.setEnabled(false);
  }

  /** A yank straight to whatever you are looking at: the way onto a roof. */
  private zipToAnchor(): void {
    if (this.interiorMode || this.player.vehicleId) return;
    const a = this.findAnchor(24);
    if (!a) {
      this.audio.uiClick();
      return;
    }
    // The line catches on the lip, but the point of a zip is to end up on the
    // roof, so the winch aims at the deck above it. Stopping level with the
    // parapet leaves you hanging in the air just short of the building.
    const top = this.topAt(a.x, a.z);
    this.zipTo = Number.isFinite(top) && top > 0 ? { x: a.x, y: top + 14, z: a.z } : a;
    this.web = null;
    this.cling = null;
    this.player.grounded = false;
    this.player.y = Math.max(this.player.y, 2);
    this.audio.thwip();
    this.showSplat(a);
    this.pulse(0.6);
  }

  /**
   * One step of everything that happens off the pavement. Returns true when
   * the walking code should stand down for this step.
   */
  private updateTraversal(dt: number, axis: { x: number; y: number; sprint: boolean }): boolean {
    if (this.interiorMode) {
      this.dropLine();
      this.player.y = 0;
      this.player.grounded = true;
      return false;
    }
    if (this.webCooldown > 0) this.webCooldown -= dt;
    this.fadeSplat(dt);
    this.anchorPreview = this.findAnchor();

    if (this.input.consumeZip()) this.zipToAnchor();
    const wantWeb = this.input.webbing();
    if (!wantWeb) this.webWarned = false;
    // Not off a wall: a line fired the instant you land on one would peel you
    // straight back off it, over and over. Space is how you leave a wall.
    if (wantWeb && !this.web && !this.cling && this.webCooldown <= 0) this.fireWeb();
    else if (!wantWeb && this.web) this.releaseWeb();

    const jump = this.input.keys.has("Space");
    if (jump && this.cling) {
      const away = this.cling.dir + Math.PI;
      this.flight = { vx: Math.cos(away) * SPIDER_CONFIG.wallJump, vy: SPIDER_CONFIG.wallJump, vz: Math.sin(away) * SPIDER_CONFIG.wallJump };
      this.cling = null;
      this.player.grounded = false;
      this.audio.foot(true, "concrete");
    } else if (jump && this.player.grounded && !this.web) {
      this.player.grounded = false;
      this.flight.vy = PLAYER_CONFIG.jumpVelocity * 10;
    }

    if (this.player.grounded && !this.web && !this.cling) {
      this.flight.vy = 0;
      this.airT = 0;
      this.swingT = 0;
      // Walked off a ledge: no jump, no web, just air under your feet.
      const support = this.supportY(this.player.x, this.player.z, this.player.y);
      if (this.player.y - support > LEDGE_STEP) this.player.grounded = false;
      else this.player.y = support;
      this.drawLine();
      return this.player.grounded ? false : true;
    }

    if (this.cling) {
      this.updateCling(dt, axis);
      this.drawLine();
      return true;
    }

    const state: SwingState = { x: this.player.x, y: this.player.y, z: this.player.z, ...this.flight };
    const input = { lean: -axis.y, steer: axis.x, reel: axis.sprint };
    let next: SwingState;
    if (this.zipTo) {
      const out = stepZip(state, this.zipTo, dt);
      if (out.arrived) {
        this.zipTo = null;
        // Arriving is the end of the pull. Carrying the winch speed through it
        // throws you clean over the parapet you just climbed to.
        out.state.vx = 0;
        out.state.vy = 0;
        out.state.vz = 0;
      }
      this.airT += dt;
      this.settleFlight(out.state);
      // Hitting the wall or topping out ends the pull; otherwise you would be
      // winched into the brickwork you are already holding.
      if (this.cling || this.player.grounded) this.zipTo = null;
      this.drawLine();
      return true;
    }
    if (this.web) {
      // Shorten an over-long line toward what the drop below it can take, so a
      // shot fired from the street climbs into an arc instead of ploughing one.
      const ground = this.supportY(this.player.x, this.player.z, 0);
      this.web = reelToCeiling(this.web, lineCeiling(this.web.y, ground), dt);
      const out = stepSwing(state, this.web, input, this.player.heading, dt);
      next = out.state;
      this.web = out.line;
      this.swingT += dt;
    } else {
      next = stepAirborne(state, input, this.player.heading, dt);
    }
    this.airT += dt;
    this.settleFlight(next);
    this.drawLine();
    return true;
  }

  /** Move to where the step wants to go, minus whatever the city is in the way of. */
  private settleFlight(next: SwingState): void {
    const y = Math.max(0, next.y);
    let hitDir: number | null = null;
    let hitFace: [number, number] | null = null;
    if (!this.airSolid(next.x, this.player.z, y)) this.player.x = next.x;
    else {
      hitDir = next.vx > 0 ? 0 : Math.PI;
      hitFace = [next.x, this.player.z];
      next.vx = 0;
    }
    if (!this.airSolid(this.player.x, next.z, y)) this.player.z = next.z;
    else {
      hitDir = next.vz > 0 ? Math.PI / 2 : -Math.PI / 2;
      hitFace = [this.player.x, next.z];
      next.vz = 0;
    }

    const support = this.supportY(this.player.x, this.player.z, Math.max(this.player.y, y));
    if (next.vy <= 0 && y <= support + 1) {
      this.land(support, next);
      return;
    }
    this.player.y = y;
    this.flight = { vx: next.vx, vy: next.vy, vz: next.vz };
    // Face where you are going; a swinger who keeps staring north looks broken.
    if (Math.hypot(next.vx, next.vz) > 30) this.player.heading = Math.atan2(next.vz, next.vx);
    // Hit a wall with air under you: stick to it. That is the difference
    // between a building being an obstacle and a building being a route.
    if (hitDir !== null && hitFace && this.climbable(hitFace[0], hitFace[1], y) && this.player.y > 14) {
      // A line still attached leaves you pinned against the brickwork with
      // nowhere to swing, so the wall takes over from the rope.
      if (this.web) {
        this.web = null;
        this.swingT = 0;
        this.webCooldown = 0.12;
        this.webSplat?.setEnabled(false);
      }
      this.cling = { dir: hitDir, t: 0 };
      this.flight = { vx: 0, vy: 0, vz: 0 };
      this.audio.foot(false, "concrete");
    }
  }

  private land(support: number, state: SwingState): void {
    const drop = Math.abs(state.vy);
    this.player.y = support;
    this.player.grounded = true;
    this.player.vy = 0;
    this.flight = { vx: 0, vy: 0, vz: 0 };
    this.cling = null;
    if (this.web) this.releaseWeb();
    if (this.airT > 0.4) {
      this.audio.foot(true, "concrete");
      if (drop > 260) {
        this.pulse(Math.min(1.4, drop / 420));
        for (let i = 0; i < 4; i++) this.spawnPuff(this.player.x, support + 3, this.player.z, "#c8c0b0");
      }
    }
    this.airT = 0;
  }

  /** Hanging on a wall: climb it, sidle along it, or top out onto the roof. */
  private updateCling(dt: number, axis: { x: number; y: number; sprint: boolean }): void {
    if (!this.cling) return;
    this.cling.t += dt;
    const climb = SPIDER_CONFIG.climbSpeed * (axis.sprint ? 1.5 : 1);
    this.player.y = Math.max(0, this.player.y + -axis.y * climb * dt);
    const side = this.cling.dir + Math.PI / 2;
    const sx = this.player.x + Math.cos(side) * axis.x * climb * dt;
    const sz = this.player.z + Math.sin(side) * axis.x * climb * dt;
    if (!this.airSolid(sx, sz, this.player.y)) {
      this.player.x = sx;
      this.player.z = sz;
    }
    this.player.heading = this.cling.dir;

    // Topped out: pull yourself over the parapet instead of hovering at it.
    const fx = this.player.x + Math.cos(this.cling.dir) * (PLAYER_CONFIG.radius + 10);
    const fz = this.player.z + Math.sin(this.cling.dir) * (PLAYER_CONFIG.radius + 10);
    const top = this.topAt(fx, fz);
    if (Number.isFinite(top) && top > 0 && this.player.y >= top - LEDGE_STEP) {
      if (!this.airSolid(fx, fz, top + 2)) {
        this.player.x = fx;
        this.player.z = fz;
        this.player.y = top;
        this.player.grounded = true;
        this.cling = null;
        this.audio.foot(true, "concrete");
        return;
      }
    }
    if (this.player.y <= 0.5) {
      this.player.y = 0;
      this.player.grounded = true;
      this.cling = null;
    }
    // Sidled off the end of the wall, or onto the edge of the map: nothing
    // left to hold either way.
    if ((!this.airSolid(fx, fz, this.player.y) || !this.climbable(fx, fz, this.player.y)) && this.player.y > 4) {
      this.cling = null;
      this.player.grounded = false;
    }
  }

  /** The rope itself, plus the splat where it caught. */
  private drawLine(): void {
    if (!this.webMesh) {
      // A rope, not a ribbon. The line runs past the camera on most swings, so
      // anything thicker than this fills half the screen with white.
      const m = MeshBuilder.CreateBox("web-line", { width: 0.5, height: 0.5, depth: 1 }, this.scene);
      m.material = this.material("#ffffff", 0.55);
      m.isPickable = false;
      m.applyFog = false;
      this.webMesh = m;
    }
    const line: { x: number; y: number; z: number } | null = this.web ?? this.zipTo;
    if (!line) {
      this.webMesh.setEnabled(false);
      return;
    }
    const hand = new Vector3(this.player.x, this.player.y + 26, this.player.z);
    const anchor = new Vector3(line.x, line.y, line.z);
    const span = Vector3.Distance(hand, anchor);
    this.webMesh.setEnabled(true);
    this.webMesh.position = Vector3.Center(hand, anchor);
    this.webMesh.lookAt(anchor);
    this.webMesh.scaling.z = span;
  }

  /** Ages the splat left by a zip, which otherwise sat on the wall forever. */
  private fadeSplat(dt: number): void {
    if (this.web || this.zipTo || !this.webSplat?.isEnabled()) return;
    this.splatT -= dt;
    if (this.splatT <= 0) this.webSplat.setEnabled(false);
  }

  private showSplat(a: { x: number; y: number; z: number }): void {
    this.splatT = 1.1;
    if (!this.webSplat) {
      // A patch of web stuck to the brickwork, not the white sugar cube this
      // used to be: flat, turned to face the shooter, and only lightly lit.
      const m = MeshBuilder.CreateBox("web-splat", { width: 8, height: 8, depth: 1.4 }, this.scene);
      m.material = this.material("#e8e8ea", 0.3);
      m.isPickable = false;
      m.applyFog = false;
      this.webSplat = m;
    }
    this.webSplat.setEnabled(true);
    this.webSplat.position.set(a.x, a.y, a.z);
    this.webSplat.lookAt(new Vector3(this.player.x, this.player.y + 20, this.player.z));
  }

  /** Drop everything: used by interiors, arrest and death. */
  private dropLine(): void {
    this.web = null;
    this.zipTo = null;
    this.cling = null;
    this.flight = { vx: 0, vy: 0, vz: 0 };
    this.swingT = 0;
    this.airT = 0;
    this.anchorPreview = null;
    this.webMesh?.setEnabled(false);
    this.webSplat?.setEnabled(false);
  }

  private armed(): boolean {
    return this.player.weapon !== "fists";
  }

  /**
   * Everything that makes the gun feel like an object: which one is in hand,
   * whether it is up, the magazine, the reload, and the kick working itself
   * out of the camera between shots.
   */
  private updateWeapon(dt: number): void {
    if (this.shownWeapon !== this.player.weapon) {
      this.shownWeapon = this.player.weapon;
      this.showWeapon(this.playerMesh, this.player.weapon);
      this.reloadT = 0;
      // Switching to a gun you already carry should not need a dry click first.
      this.refillMagazine();
    }
    this.aiming = this.armed() && this.input.aiming();
    // Aiming turns the body to the camera, which is what you are shooting along.
    if (this.aiming) this.player.heading = Math.atan2(Math.cos(this.player.camYaw), Math.sin(this.player.camYaw));
    if (this.input.consumeReload()) this.beginReload();
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        this.reloadT = 0;
        this.finishReload();
        this.audio.uiClick();
      }
    }
    this.recoil = Math.max(0, this.recoil - this.recoil * AIM_CONFIG.recoilRecovery * dt - dt * 0.02);
  }

  /** Title-screen wander parks civilians on spawn; kick them out on enter. */
  private evictCrowd(radius: number): void {
    for (const a of this.actors) {
      if (a.kind === "named") continue;
      const d = Math.hypot(a.x - this.player.x, a.z - this.player.z);
      if (d >= radius) continue;
      for (let k = 0; k < 8; k++) {
        const ang = (k / 8) * Math.PI * 2 + this.clock;
        const nx = this.player.x + Math.cos(ang) * (radius + 50);
        const nz = this.player.z + Math.sin(ang) * (radius + 50);
        if (!blocked(this.world, nx, nz, 8)) {
          a.x = nx;
          a.z = nz;
          a.mesh.position.set(nx, 0, nz);
          break;
        }
      }
    }
  }

  private separateFromBodies(): void {
    // Nobody on the pavement can shove a player who is thirty units above it,
    // and hiding them would make the crowd blink out as you swing over.
    const overhead = this.player.y > 24;
    for (const a of [...this.actors, ...this.cops]) {
      if (overhead) {
        a.mesh.setEnabled(true);
        continue;
      }
      // A cop has to be able to get his hands on you, or a foot chase has no
      // ending: held at a civilian's arm's length he could never make the
      // arrest and simply walked behind the player forever.
      const min = a.kind === "cop" ? POLICE_CONFIG.grabRange : this.player.vehicleId ? 28 : 24;
      const dx = a.x - this.player.x;
      const dz = a.z - this.player.z;
      const d = Math.hypot(dx, dz);
      a.mesh.setEnabled(d >= min - 6);
      if (d < 0.2 || d >= min) continue;
      const push = (min - d) / Math.max(0.2, d);
      if (a.kind === "named") {
        const nx = this.player.x - dx * push;
        const nz = this.player.z - dz * push;
        if (!blocked(this.world, nx, this.player.z, PLAYER_CONFIG.radius)) this.player.x = nx;
        if (!blocked(this.world, this.player.x, nz, PLAYER_CONFIG.radius)) this.player.z = nz;
      } else {
        a.x += dx * push;
        a.z += dz * push;
        a.heading = Math.atan2(dz, dx);
        a.mesh.position.set(a.x, 0, a.z);
      }
    }
    for (const r of this.remoteMeshes.values()) {
      const d = Math.hypot(r.x - this.player.x, r.z - this.player.z);
      r.mesh.setEnabled(d >= 22);
    }
  }

  private pointerGap(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  /** Positive pulls the camera out, negative pushes it in. */
  zoomBy(delta: number): void {
    this.camZoom = Math.max(CAMERA.minZoom, Math.min(CAMERA.maxZoom, this.camZoom + delta));
    this.lookedAt = this.clock;
  }

  /** Back to the default shoulder view, for when the player has tied it in knots. */
  resetCamera(): void {
    this.camZoom = 1;
    this.player.camPitch = 0.5;
    this.player.camYaw = this.player.heading - Math.PI / 2;
    this.lookedAt = -99;
  }

  /**
   * The furthest the camera can sit behind the player with nothing solid in
   * between. Walks the boom in from the requested length in short steps.
   */
  private clearCameraDistance(want: number): number {
    // Start close. Beginning the walk at 40 meant that when the only clear air
    // was nearer than that — flat against a wall, say — the boom gave up and
    // parked inside the building anyway.
    const min = Math.min(18, want);
    let last = min;
    for (let d = min; d <= want; d += 12) {
      const p = this.cameraPlace(d);
      // Height-aware: over the rooftops the boom has clear air behind it, and
      // the flat 2D test used to jam it against buildings the player had
      // already climbed past.
      if (this.airSolid(p.x, p.z, p.y - 6, 10)) return last;
      last = d;
    }
    return want;
  }

  private cameraPlace(dist: number): { x: number; z: number; y: number } {
    const pitch = this.player.camPitch;
    const elev = this.interiorMode ? INTERIOR_Y : 0;
    const yaw = this.player.camYaw;
    const backX = -Math.sin(yaw) * dist * Math.cos(pitch);
    const backZ = -Math.cos(yaw) * dist * Math.cos(pitch);
    // The shoulder offset closes up as the view goes overhead, where an
    // off-centre camera just looks like a mistake.
    const side = 34 * Math.max(0, 1 - Math.max(0, pitch - 0.8) / 0.65);
    // Altitude is part of where the camera goes now. Tied to the ground, the
    // boom stayed in the street while the player was three hundred units up a
    // tower, filming the underside of their own feet.
    const air = this.interiorMode ? 0 : this.player.y;
    const place = {
      x: this.player.x + backX + Math.cos(yaw) * side,
      z: this.player.z + backZ - Math.sin(yaw) * side,
      y: Math.max(elev + air + CAMERA.minHeight, elev + air + 26 + Math.sin(pitch) * dist),
    };
    const room = this.activeRoom();
    if (room) {
      // Indoors the boom has to stay in the room, or it swings out through a
      // wall and films the shop hanging in mid-air over the city.
      const edge = room.half - 14;
      place.x = Math.max(room.cx - edge, Math.min(room.cx + edge, place.x));
      place.z = Math.max(room.cz - edge, Math.min(room.cz + edge, place.z));
      place.y = Math.min(elev + 78, place.y);
    }
    return place;
  }

  /**
   * What the lens looks at. Below the normal shoulder angle the aim point
   * climbs instead of the camera sinking into the tarmac, so dragging down
   * tilts the view up the face of the towers rather than into the kerb.
   */
  private cameraTarget(elev: number): Vector3 {
    const lift = Math.max(0, 0.3 - this.player.camPitch) * 120;
    return new Vector3(this.player.x, elev + 20 + this.player.y + lift, this.player.z);
  }

  private snapCamera(): void {
    const p = this.cameraPlace((this.player.vehicleId ? 165 : 175) * this.camZoom);
    this.camera.position.set(p.x, p.y, p.z);
    this.camera.setTarget(this.cameraTarget(this.interiorMode ? INTERIOR_Y : 0));
  }

  /**
   * Rewards the driving nobody asked you to do: shaving past traffic and
   * pedestrians, and holding a slide. Both feed one combo that lapses if you
   * settle down, so the loop pushes you to keep the car moving badly on purpose.
   */
  private updateThrill(dt: number): void {
    const lapse = tickThrill(this.thrill, dt);
    this.thrill = lapse.state;
    if (lapse.lapsed && lapse.lapsed.combo >= 3) {
      this.flash(`RUN CLEAR  ·  x${lapse.lapsed.combo} chain  ·  $${lapse.lapsed.cash} banked`);
    }
    for (const [id, t] of this.nearMissCooldown) {
      const left = t - dt;
      if (left <= 0) this.nearMissCooldown.delete(id);
      else this.nearMissCooldown.set(id, left);
    }

    const car = this.cars.find((c) => c.rt.id === this.player.vehicleId);
    if (!car || car.rt.exploded) {
      this.driftTime = 0;
      return;
    }
    const v = car.rt;
    const speed = Math.hypot(v.vx, v.vy);

    if (isDrifting(speed, Math.cos(v.heading), Math.sin(v.heading), v.vx, v.vy)) {
      this.driftTime += dt;
    } else if (this.driftTime > 0) {
      this.bankStunt(driftValue(this.driftTime, this.heat.level), "DRIFT");
      this.driftTime = 0;
    }

    for (const other of this.cars) {
      if (other === car || other.rt.exploded) continue;
      if (this.nearMissCooldown.has(other.rt.id)) continue;
      const d = Math.hypot(other.rt.x - v.x, other.rt.y - v.y);
      const value = nearMissValue(speed, d - 12, this.heat.level);
      if (value <= 0) continue;
      this.nearMissCooldown.set(other.rt.id, 1.5);
      this.bankStunt(value, "NEAR MISS");
    }
    for (const a of this.actors) {
      if (this.nearMissCooldown.has(a.id)) continue;
      const d = Math.hypot(a.x - v.x, a.z - v.y);
      const value = nearMissValue(speed, d - 8, this.heat.level);
      if (value <= 0) continue;
      this.nearMissCooldown.set(a.id, 2);
      a.panic = Math.max(a.panic, 2.5);
      this.bankStunt(Math.round(value * 1.3), "SIDEWALK KISS");
    }
  }

  private updateCamera(dt: number): void {
    const car = this.cars.find((c) => c.rt.id === this.player.vehicleId);
    const speed = car ? Math.hypot(car.rt.vx, car.rt.vy) : 0;
    const def = car ? vehicleById(car.rt.defId) : null;
    const topSpeed = def
      ? Math.max(1, maxSpeedFor({ acceleration: def.acceleration, topSpeed: def.topSpeed, handling: def.handling, braking: def.braking, grip: 1, power: 1 }))
      : 1;
    // Sighting up pulls the camera in over the shoulder.
    // A swing reads as fast only if the lens gives it room, so the boom opens
    // out with airspeed the same way it does with a car.
    const air = this.player.grounded || this.player.vehicleId ? 0 : Math.min(150, Math.hypot(this.flight.vx, this.flight.vz) * 0.32);
    let dist = (car ? speedCameraDistance(165, speed, topSpeed) : 175 + air) * this.camZoom * (this.aiming ? AIM_CONFIG.zoomScale : 1);
    // The lens opens as you wind the car out, so speed reads on screen, and
    // closes down over the sights, which is what selling "aiming" takes when
    // the shoulder camera has a wall behind it and cannot pull in.
    const wantFov = car ? speedFov(this.baseFov, speed, topSpeed) : this.baseFov * (this.aiming ? 0.76 : 1);
    this.camera.fov += (wantFov - this.camera.fov) * Math.min(1, dt * 2.5);
    if (this.input.consumeResetView()) this.resetCamera();
    const stick = this.input.look();
    if (stick.x !== 0 || stick.y !== 0) {
      const sens = this.settings.lookSensitivity * dt * 2.6;
      this.player.camYaw += stick.x * sens;
      this.player.camPitch += stick.y * sens * (this.settings.invertLook ? -1 : 1);
      this.lookedAt = this.clock;
    }
    // Recoil kicks the aim up and settles back: the camera itself climbs, so a
    // held burst walks off target and has to be pulled down.
    const settle = Math.min(this.recoilPitch, this.recoilPitch * 7 * dt);
    this.recoilPitch -= settle;
    this.player.camPitch = clampPitch(this.player.camPitch - this.recoilStep + settle);
    this.recoilStep = 0;
    // A car swings the view back behind it, but only once the player has
    // stopped looking around — it used to snatch the camera back instantly.
    const looking = this.dragYaw.active || this.clock - this.lookedAt < CAMERA.manualLookHold;
    if (car && speed > 30 && !looking) {
      const desired = Math.atan2(car.rt.vx, car.rt.vy);
      this.player.camYaw += normalizeAngle(desired - this.player.camYaw) * Math.min(1, dt * 3);
    }
    // On a wall the boom has to end up out over the street. Left alone it
    // pointed straight into the brickwork the player was holding, and the
    // whole screen filled with the inside of the building.
    if (this.cling && !looking) {
      const want = normalizeAngle(Math.PI / 2 - this.cling.dir);
      this.player.camYaw += normalizeAngle(want - this.player.camYaw) * Math.min(1, dt * 2.6);
    }
    const elev = this.interiorMode ? INTERIOR_Y : 0;
    // Pull the camera in until the line back from the player is clear. Lifting
    // it over the obstacle instead, as this used to, parks the lens inside the
    // roof of whatever you drove past and fills the screen with its underside.
    if (!this.interiorMode) dist = this.clearCameraDistance(dist);
    const p = this.cameraPlace(dist);
    if (this.shake > 0 && this.settings.shake) {
      p.x += (Math.random() - 0.5) * this.shake;
      p.y += (Math.random() - 0.5) * this.shake;
      p.z += (Math.random() - 0.5) * this.shake;
    }
    const desired = new Vector3(p.x, p.y, p.z);
    this.camera.position = Vector3.Lerp(this.camera.position, desired, 1 - Math.pow(0.00008, dt));
    this.camera.setTarget(this.cameraTarget(elev));
    const camD = Vector3.Distance(this.camera.position, new Vector3(this.player.x, elev + this.player.y + 20, this.player.z));
    this.playerMesh.setEnabled(!this.player.vehicleId && camD > 26);
  }

  /**
   * Moves a car and lets it slide along whatever it clips. The old code threw
   * away the whole move the moment either axis touched geometry, so brushing a
   * kerb stopped the car dead and kept damaging it while you held the throttle
   * — which read as "the car will not drive". Only a square-on hit stops you.
   */
  private advanceCar(v: VehicleRuntime, dt: number): { hit: boolean; headOn: boolean; speed: number } {
    const speed = Math.hypot(v.vx, v.vy);
    const nx = v.x + v.vx * dt;
    const nz = v.y + v.vy * dt;
    const r = CAR_RADIUS;
    // A car shunted into a wall by a crash used to sit there grinding itself to
    // death with the throttle pinned. If it is already overlapping, walk it out.
    if (blocked(this.world, v.x, v.y, r)) {
      this.unstickCar(v);
      return { hit: false, headOn: false, speed };
    }
    if (!blocked(this.world, nx, nz, r)) {
      v.x = nx;
      v.y = nz;
      return { hit: false, headOn: false, speed };
    }
    if (!blocked(this.world, nx, v.y, r)) {
      v.x = nx;
      v.vy *= -0.12;
      return { hit: true, headOn: false, speed };
    }
    if (!blocked(this.world, v.x, nz, r)) {
      v.y = nz;
      v.vx *= -0.12;
      return { hit: true, headOn: false, speed };
    }
    v.vx *= -0.2;
    v.vy *= -0.2;
    return { hit: true, headOn: true, speed };
  }

  /** Steps a trapped car toward the nearest clear ground and stops it dead. */
  private unstickCar(v: VehicleRuntime): void {
    v.vx = 0;
    v.vy = 0;
    for (let step = 14; step <= 84; step += 14) {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const x = v.x + Math.cos(a) * step;
        const z = v.y + Math.sin(a) * step;
        if (!blocked(this.world, x, z, CAR_RADIUS)) {
          v.x = x;
          v.y = z;
          return;
        }
      }
    }
  }

  private updateCars(dt: number): void {
    const wet = this.weather === "rain" ? 0.86 : 1;
    for (const car of this.cars) {
      let v = car.rt;
      if (car.bump > 0) car.bump = Math.max(0, car.bump - dt);
      if (v.exploded) {
        car.mesh.position.y = 0.4;
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
        const hand = this.input.keys.has("Space");
        // Component damage + ground surface both shape the handling model.
        const perf = performanceMultipliers(v);
        const cell = cellAt(this.world, v.x, v.y);
        const ground = cell === Cell.Grass ? surfaceGrip("grass") : cell === Cell.Sand ? surfaceGrip("sand") : cell === Cell.Dirt ? surfaceGrip("gravel") : this.weather === "rain" ? surfaceGrip("wet-asphalt") : surfaceGrip("asphalt");
        const drive = stepCar(
          { heading: v.heading, vx: v.vx, vy: v.vy },
          { throttle: -axis.y, steer: axis.x, handbrake: hand },
          {
            acceleration: def.acceleration,
            topSpeed: def.topSpeed * wet,
            handling: def.handling,
            braking: def.braking,
            grip: ground * perf.grip,
            power: perf.accel,
          },
          dt,
        );
        v.heading = drive.heading;
        v.vx = drive.vx;
        v.vy = drive.vy;
        // A lockpicked GPS car keeps snitching until it's repainted at the garage.
        if (def.security === "gps" && v.stolen && !v.registered) {
          this.gpsT += dt;
          if (this.gpsT > 12) {
            this.gpsT = 0;
            this.raiseHeat(1);
            this.flash("GPS TRACKER  ·  this car is snitching  ·  Maya can wipe it");
          }
        }
        const move = this.advanceCar(v, dt);
        // A scrape along a wall costs paint; only a square-on hit is a crash.
        if (move.headOn && car.bump <= 0) {
          const crash = move.speed > VEHICLE_CONFIG.crashSpeedThreshold;
          car.bump = VEHICLE_CONFIG.bumpCooldownSeconds;
          v = applyVehicleDamage(v, collisionDamage(move.speed), crash);
          if (crash) {
            this.impact("crash");
            this.driftTime = 0;
          } else if (this.settings.shake) {
            this.shake = Math.max(this.shake, 2);
          }
          if (v.health <= 0) this.flash("ENGINE  ·  she's gonna go");
        }
        this.player.x = v.x;
        this.player.z = v.y;
        this.player.heading = v.heading;
      } else if (v.id.startsWith("cop-car-") && !v.stolen) {
        const chased = this.cars.find((c) => c.rt.id === this.player.vehicleId);
        const input = pursuitInput(
          { x: v.x, y: v.y, heading: v.heading, vx: v.vx, vy: v.vy },
          { x: this.player.x, y: this.player.z, vx: chased?.rt.vx ?? 0, vy: chased?.rt.vy ?? 0 },
        );
        const drive = stepCar(
          { heading: v.heading, vx: v.vx, vy: v.vy },
          input,
          {
            acceleration: def.acceleration,
            topSpeed: def.topSpeed * wet,
            handling: def.handling,
            braking: def.braking,
            grip: this.weather === "rain" ? surfaceGrip("wet-asphalt") : surfaceGrip("asphalt"),
            power: performanceMultipliers(v).accel,
          },
          dt,
        );
        v.heading = drive.heading;
        v.vx = drive.vx;
        v.vy = drive.vy;
        const move = this.advanceCar(v, dt);
        if (move.headOn) {
          // Cruisers clout walls in the chase; they take it like the player does.
          if (car.bump <= 0) {
            car.bump = VEHICLE_CONFIG.bumpCooldownSeconds;
            v = applyVehicleDamage(v, collisionDamage(move.speed), false);
          }
          // Pick a side to peel off toward instead of grinding the wall.
          v.heading = normalizeAngleTo(v.heading + Math.PI / 3);
        }
      } else if (v.id.startsWith("traffic-") && !v.stolen) {
        v.heading = this.trafficHeading(v);
        // Queue behind whatever is in front instead of shunting it down the road.
        const spd = this.laneBlockedAhead(v) ? 0 : 70 * wet;
        v.vx = Math.cos(v.heading) * spd;
        v.vy = Math.sin(v.heading) * spd;
        const nx = v.x + v.vx * dt;
        const nz = v.y + v.vy * dt;
        const moved = !blocked(this.world, nx, nz, CAR_RADIUS);
        if (moved) {
          v.x = nx;
          v.y = nz;
        }
        // A car wedged against a wall or stuck behind something parked would
        // otherwise sit there for the rest of the session; move it on.
        car.stuck = moved && spd > 0 ? 0 : (car.stuck ?? 0) + dt;
        if (car.stuck > 6) this.relocateTraffic(car);
      }
      car.rt = v;
      car.mesh.position.set(v.x, 0, v.y);
      car.mesh.rotation.y = -v.heading;
      const wheels = (car.mesh.metadata as { wheels?: Mesh[] } | undefined)?.wheels;
      const spin = Math.hypot(v.vx, v.vy) * dt * 0.12;
      if (wheels) for (const w of wheels) w.rotation.x += spin;
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
    this.collideCars();
    this.runDownPedestrians();
  }

  /**
   * Traffic keeps to tarmac. It used to drive dead straight, turn ninety
   * degrees into whatever it hit, and teleport across the map at the edges;
   * now it takes junctions and turns back at the waterfront like everyone else.
   */
  private trafficHeading(v: VehicleRuntime): number {
    const onRoad = (h: number, dist: number): boolean => {
      const px = v.x + Math.cos(h) * dist;
      const pz = v.y + Math.sin(h) * dist;
      if (blocked(this.world, px, pz, CAR_RADIUS)) return false;
      return cellAt(this.world, px, pz) === Cell.Road;
    };
    const straight = normalizeAngleTo(v.heading);
    const left = normalizeAngleTo(straight - Math.PI / 2);
    const right = normalizeAngleTo(straight + Math.PI / 2);
    // At a junction with room to turn, sometimes take it, so the streets are
    // not a set of fixed loops.
    if (onRoad(straight, 26)) {
      const turning = Math.random() < 0.004 && onRoad(left, 34) ? left : Math.random() < 0.004 && onRoad(right, 34) ? right : straight;
      return turning;
    }
    if (onRoad(left, 30)) return left;
    if (onRoad(right, 30)) return right;
    // Off the tarmac — shunted there by a crash, most likely. Carry on while
    // the way is clear rather than flip-flopping on the spot looking for a road.
    if (!blocked(this.world, v.x + Math.cos(straight) * 26, v.y + Math.sin(straight) * 26, 12)) return straight;
    return normalizeAngleTo(straight + Math.PI / 2);
  }

  /**
   * True when something is close in front worth stopping for: the car you are
   * queueing behind, or a person about to be under the wheels. Oncoming cars
   * are deliberately excluded — two cars nose to nose would both wait forever.
   */
  private laneBlockedAhead(v: VehicleRuntime): boolean {
    const fx = Math.cos(v.heading);
    const fz = Math.sin(v.heading);
    for (const other of this.cars) {
      if (other.rt.id === v.id || other.rt.exploded) continue;
      const dx = other.rt.x - v.x;
      const dz = other.rt.y - v.y;
      if (Math.hypot(dx, dz) > 34) continue;
      if (fx * dx + fz * dz <= 6) continue;
      const oncoming = Math.cos(other.rt.heading) * fx + Math.sin(other.rt.heading) * fz < -0.3;
      if (!oncoming) return true;
    }
    for (const a of this.actors) {
      if (a.dead !== undefined) continue;
      const dx = a.x - v.x;
      const dz = a.z - v.y;
      if (Math.hypot(dx, dz) > 26) continue;
      if (fx * dx + fz * dz > 4) return true;
    }
    return false;
  }

  /** Drop a jammed traffic car back onto open road, out of the player's sight. */
  private relocateTraffic(car: CarEntity): void {
    for (let tries = 0; tries < 24; tries++) {
      const x = Math.random() * MAP_W * TILE;
      const z = Math.random() * MAP_H * TILE;
      if (cellAt(this.world, x, z) !== Cell.Road) continue;
      if (blocked(this.world, x, z, 14)) continue;
      if (Math.hypot(x - this.player.x, z - this.player.z) < 400) continue;
      car.rt.x = x;
      car.rt.y = z;
      car.rt.heading = Math.round(Math.random() * 4) * (Math.PI / 2);
      car.rt.vx = 0;
      car.rt.vy = 0;
      car.stuck = 0;
      return;
    }
    car.stuck = 0;
  }

  /** Mass from durability: a wrecking ball of a muscle car shoves a compact. */
  private carMass(v: VehicleRuntime): number {
    return vehicleById(v.defId).durability * 12;
  }

  private collideCars(): void {
    for (let i = 0; i < this.cars.length; i++) {
      const a = this.cars[i];
      if (!a || a.rt.exploded) continue;
      for (let j = i + 1; j < this.cars.length; j++) {
        const b = this.cars[j];
        if (!b || b.rt.exploded) continue;
        const hit = resolveCarCollision(
          { x: a.rt.x, y: a.rt.y, vx: a.rt.vx, vy: a.rt.vy, mass: this.carMass(a.rt) },
          { x: b.rt.x, y: b.rt.y, vx: b.rt.vx, vy: b.rt.vy, mass: this.carMass(b.rt) },
        );
        if (!hit) continue;
        a.rt.vx = hit.a.vx;
        a.rt.vy = hit.a.vy;
        b.rt.vx = hit.b.vx;
        b.rt.vy = hit.b.vy;
        // Push the pair apart so they cannot settle inside each other.
        const push = hit.depth / 2 + 0.1;
        a.rt.x -= hit.nx * push;
        a.rt.y -= hit.ny * push;
        b.rt.x += hit.nx * push;
        b.rt.y += hit.ny * push;
        if (hit.damageA <= 0 && hit.damageB <= 0) continue;
        a.rt = applyVehicleDamage(a.rt, hit.damageA, hit.closing > VEHICLE_CONFIG.crashSpeedThreshold);
        b.rt = applyVehicleDamage(b.rt, hit.damageB, hit.closing > VEHICLE_CONFIG.crashSpeedThreshold);
        this.spawnPuff((a.rt.x + b.rt.x) / 2, 8, (a.rt.y + b.rt.y) / 2, "#e8d8a0");
        const mine = this.player.vehicleId === a.rt.id || this.player.vehicleId === b.rt.id;
        if (mine) {
          this.impact(hit.closing > VEHICLE_CONFIG.crashSpeedThreshold ? "crash" : "hit");
          this.driftTime = 0;
          this.panicNear();
        }
      }
    }
  }

  private runDownPedestrians(): void {
    for (const car of this.cars) {
      if (car.rt.exploded) continue;
      const speed = Math.hypot(car.rt.vx, car.rt.vy);
      if (speed < 12) continue;
      const mine = this.player.vehicleId === car.rt.id;
      for (const a of this.actors) {
        if (a.dead !== undefined) continue;
        const d = Math.hypot(a.x - car.rt.x, a.z - car.rt.y);
        if (d > COLLISION_CONFIG.carRadius + COLLISION_CONFIG.pedestrianRadius) continue;
        const hit = pedestrianImpact(speed, a.hp);
        const dir = Math.atan2(car.rt.vy, car.rt.vx);
        a.flungX = Math.cos(dir) * hit.knockback;
        a.flungZ = Math.sin(dir) * hit.knockback;
        if (hit.damage <= 0) {
          a.panic = Math.max(a.panic, 4);
          a.heading = dir;
          continue;
        }
        this.hitActor(a, hit.damage, "vehicle", mine);
      }
    }
  }

  private updateActors(dt: number): void {
    const hour = this.time;
    let cleared = 0;
    for (const a of this.actors) {
      if (a.dead !== undefined) {
        a.dead += dt;
        // Face down where they fell, still sliding a little from the impact.
        a.flungX = (a.flungX ?? 0) * Math.max(0, 1 - dt * 4);
        a.flungZ = (a.flungZ ?? 0) * Math.max(0, 1 - dt * 4);
        a.x += a.flungX * dt;
        a.z += a.flungZ * dt;
        a.mesh.position.set(a.x, 3, a.z);
        a.mesh.rotation.x = Math.PI / 2;
        continue;
      }
      if (a.kind === "named") {
        a.mesh.position.set(a.x, 0, a.z);
        continue;
      }
      if (a.flungX !== undefined || a.flungZ !== undefined) {
        // Clipped but alive: stumble along the bonnet's direction first.
        const fx = (a.flungX ?? 0) * Math.max(0, 1 - dt * 5);
        const fz = (a.flungZ ?? 0) * Math.max(0, 1 - dt * 5);
        a.x += fx * dt;
        a.z += fz * dt;
        a.flungX = Math.hypot(fx, fz) < 2 ? undefined : fx;
        a.flungZ = Math.hypot(fx, fz) < 2 ? undefined : fz;
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
        // Give the player room. Rejecting steps that came near them made a
        // pedestrian circle you instead of walking on, which reads as being
        // followed by a stranger who will not leave.
        const gap = Math.hypot(a.x - this.player.x, a.z - this.player.z);
        if (gap < 46) {
          const away = Math.atan2(a.z - this.player.z, a.x - this.player.x);
          a.heading += normalizeAngle(away - a.heading) * Math.min(1, dt * 2.4);
        }
        const nx = a.x + Math.cos(a.heading) * wander * dt;
        const nz = a.z + Math.sin(a.heading) * wander * dt;
        if (!blocked(this.world, nx, nz, 7)) {
          a.x = nx;
          a.z = nz;
        } else a.heading += 1.2;
      }
      a.mesh.position.set(a.x, 0, a.z);
      a.mesh.rotation.y = -a.heading;
      this.poseWalk(a.mesh, a.panic <= 0 && !a.recording, false);
    }

    this.actors = this.actors.filter((a) => {
      if (a.dead === undefined || a.dead < 26) return true;
      a.mesh.dispose();
      cleared++;
      return false;
    });
    for (let i = 0; i < cleared; i++) this.replaceCivilian();
  }

  /**
   * One way in for every kind of harm done to a person. Killing someone is a
   * homicide the neighbourhood can report, which is what makes a crowd
   * something to think about rather than scenery.
   */
  private hitActor(a: Actor, damage: number, cause: "gun" | "fists" | "vehicle", byPlayer: boolean): void {
    if (a.dead !== undefined) return;
    if (a.kind === "named") {
      // Story contacts are needed alive; they take the hint and back off.
      a.panic = 4;
      a.heading = Math.atan2(a.z - this.player.z, a.x - this.player.x);
      if (byPlayer) this.flash(`${a.name.toUpperCase()}  ·  you need me alive, genius`);
      return;
    }
    a.hp -= damage;
    a.recording = 0;
    if (a.hp > 0) {
      a.panic = 5;
      a.heading = Math.atan2(a.z - this.player.z, a.x - this.player.x);
      if (byPlayer && cause !== "fists") this.reportCrime(cause === "vehicle" ? "hit-and-run" : "gunfire");
      return;
    }
    a.dead = 0;
    a.hp = 0;
    this.spawnPuff(a.x, 9, a.z, "#8a1c14");
    if (byPlayer) {
      this.impact("kill");
      this.reportCrime("homicide");
      this.flash(cause === "vehicle" ? "HIT AND RUN  ·  somebody is dialing 911" : "BODY  ·  that one is not getting up");
      this.pushNews("Southside: another body on the pavement. NCPD asking for witnesses.");
    }
    this.panicNear();
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
    const heatBefore = this.heat.level;
    // Running is what raises the stakes. Being looked at while you stand in
    // the street used to climb the wanted level on its own, which turned one
    // careless moment into a growing escort that never went home.
    const resisting = Boolean(this.player.vehicleId) || this.copGap > 90;
    this.heat = tickHeat(this.heat, dt, seen, this.player.x, this.player.z, 0, this.player.vehicleId ? this.currentDefId() : "", resisting);
    if (heatBefore > 0 && this.heat.level === 0) {
      this.flash("EVADED  ·  they lost you  ·  lay low");
      this.audio.uiClick();
    }
    let want = copCountForHeat(this.heat.level);
    if (this.crackdown && this.heat.level > 0) want = Math.min(5, want + 1);
    while (this.cops.length < want) this.cops.push(this.makeCop());
    while (this.cops.length > want) {
      // Retire whoever is furthest away: popping the list could delete the cop
      // standing in front of you, who then vanished mid-stride.
      let far = 0;
      for (let i = 1; i < this.cops.length; i++) {
        const a = this.cops[i];
        const b = this.cops[far];
        if (a && b && Math.hypot(a.x - this.player.x, a.z - this.player.z) > Math.hypot(b.x - this.player.x, b.z - this.player.z)) far = i;
      }
      this.cops[far]?.mesh.dispose();
      this.cops.splice(far, 1);
    }
    this.updatePoliceCars();
    const speed = PLAYER_CONFIG.sprintSpeed * POLICE_CONFIG.footSpeedRatio * (0.9 + this.heat.level * 0.05);
    let nearest = Infinity;
    for (const c of this.cops) {
      // Patience runs out. A cop who has not laid eyes on the suspect for a
      // while stops hunting and walks off, instead of trailing you across the
      // city on a hunch he can never act on.
      if (seen) {
        c.lostT = 0;
        c.quit = false;
      } else {
        c.lostT = (c.lostT ?? 0) + dt;
        if (c.lostT > POLICE_CONFIG.giveUpSeconds && !c.quit) {
          c.quit = true;
          c.searchX = undefined;
        }
      }
      let tx: number;
      let tz: number;
      if (c.quit) {
        // Off the job: head away from the suspect until he is out of the area.
        c.searchT = (c.searchT ?? 0) - dt;
        if (c.searchX === undefined || c.searchT <= 0) {
          c.searchT = 4;
          const away = Math.atan2(c.z - this.player.z, c.x - this.player.x) + (Math.random() - 0.5) * 0.8;
          c.searchX = c.x + Math.cos(away) * 420;
          c.searchZ = c.z + Math.sin(away) * 420;
        }
        tx = c.searchX;
        tz = c.searchZ ?? c.z;
      } else if (seen) {
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
        // No idea where you are: patrol the block rather than walking a
        // straight line to coordinates nobody reported.
        c.searchT = (c.searchT ?? 0) - dt;
        if (c.searchX === undefined || c.searchT <= 0) {
          c.searchT = 3 + Math.random() * 3;
          const ang = Math.random() * Math.PI * 2;
          c.searchX = c.x + Math.cos(ang) * 260;
          c.searchZ = c.z + Math.sin(ang) * 260;
        }
        tx = c.searchX;
        tz = c.searchZ ?? c.z;
      }
      const ang = Math.atan2(tz - c.z, tx - c.x);
      c.heading = ang;
      const nx = c.x + Math.cos(ang) * speed * dt;
      const nz = c.z + Math.sin(ang) * speed * dt;
      if (!blocked(this.world, nx, nz, 8)) {
        c.x = nx;
        c.z = nz;
      }
      c.mesh.position.set(c.x, 0, c.z);
      c.mesh.rotation.y = -ang;
      this.poseWalk(c.mesh, true, this.heat.level >= 2);
      const d = Math.hypot(c.x - this.player.x, c.z - this.player.z);
      if (!c.quit) nearest = Math.min(nearest, d);
      const drawn = !c.quit && this.heat.level >= POLICE_CONFIG.copShootMinHeat && d < 260;
      this.poseAim(c.mesh, drawn, 0);
      if (!c.quit && seen && this.heat.level >= POLICE_CONFIG.copShootMinHeat && d < 190 && Math.random() < POLICE_CONFIG.copShootChancePerTick) {
        // Their shots read the same way yours do: flash, tracer, brass.
        const at = Math.atan2(this.player.z - c.z, this.player.x - c.x);
        const mx = c.x + Math.cos(at) * 9;
        const mz = c.z + Math.sin(at) * 9;
        this.spawnMuzzleFlash(mx, GUN_Y, mz, at);
        this.spawnTracer(mx, GUN_Y, mz, this.player.x, GUN_Y - 2, this.player.z);
        this.spawnCasing(mx, GUN_Y, mz, at);
        this.audio.gun();
        if (Math.random() < 0.4) {
          this.hurt(9);
          this.spawnBlood(this.player.x, 10, this.player.z, at);
        } else {
          this.spawnSparks(this.player.x + Math.cos(at) * 8, 4, this.player.z + Math.sin(at) * 8, at);
        }
      }
    }
    this.audio.setSirenDistance(Number.isFinite(nearest) ? nearest : 900);

    // Arrest window: cornered on foot with cops in your face. A cruiser pulling
    // up counts too, otherwise a car chase that ends on foot has no ending.
    const cruiser = this.cars.reduce(
      (min, c) =>
        c.rt.id.startsWith("cop-car-") && !c.rt.stolen && !c.rt.exploded
          ? Math.min(min, Math.hypot(c.rt.x - this.player.x, c.rt.y - this.player.z))
          : min,
      Infinity,
    );
    nearest = Math.min(nearest, cruiser);
    const cornered = this.heat.level >= 1 && !this.player.vehicleId && !this.interiorMode && nearest < 34;
    if (this.input.surrenderQueued) {
      this.input.surrenderQueued = false;
      if (cornered) this.arrest("HANDS UP  ·  smart move");
    }
    if (cornered && nearest < POLICE_CONFIG.grabRange + 4) {
      this.surrenderT += dt;
      if (this.surrenderT > 2.4) this.arrest("TACKLED  ·  should have kept running");
    } else {
      this.surrenderT = 0;
    }
    this.copGap = nearest;

    this.cops = this.cops.filter((c) => {
      const d = Math.hypot(c.x - this.player.x, c.z - this.player.z);
      // Dead, walked out of the district, or off the job and clear of you.
      if (c.hp <= 0 || d > POLICE_CONFIG.leashDistance || (c.quit && d > 420)) {
        c.mesh.dispose();
        return false;
      }
      return true;
    });
  }

  /**
   * Cruisers on the street scale with the wanted level. Anything the player
   * has commandeered is left alone — a stolen patrol car is the player's now.
   */
  private updatePoliceCars(): void {
    const want = copCarsForHeat(this.heat.level);
    const active = this.cars.filter((c) => c.rt.id.startsWith("cop-car-") && !c.rt.stolen && !c.rt.exploded);
    for (const c of active) {
      const far = Math.hypot(c.rt.x - this.player.x, c.rt.y - this.player.z) > PURSUIT_CONFIG.despawnDistance;
      if (!far && active.length <= want) continue;
      if (this.player.vehicleId === c.rt.id) continue;
      if (active.length > want || far) {
        c.mesh.dispose();
        this.cars = this.cars.filter((x) => x !== c);
      }
    }
    const live = this.cars.filter((c) => c.rt.id.startsWith("cop-car-") && !c.rt.stolen && !c.rt.exploded).length;
    for (let i = live; i < want; i++) this.spawnPoliceCar();
  }

  private spawnPoliceCar(): void {
    for (let tries = 0; tries < 24; tries++) {
      const ang = Math.random() * Math.PI * 2;
      const d = PURSUIT_CONFIG.spawnDistance * (0.8 + Math.random() * 0.5);
      const x = this.player.x + Math.cos(ang) * d;
      const z = this.player.z + Math.sin(ang) * d;
      if (x < 40 || z < 40 || x > MAP_W * TILE - 40 || z > MAP_H * TILE - 40) continue;
      // Cruisers must arrive on tarmac, not inside somebody's kitchen.
      if (cellAt(this.world, x, z) !== Cell.Road) continue;
      const rt = createVehicleRuntime("ironback", x, z, Math.atan2(this.player.z - z, this.player.x - x), "#22303e");
      rt.id = `cop-car-${this.copCarSeq++}`;
      rt.registered = true;
      this.cars.push({ rt, mesh: this.makeCarMesh(rt.id, "#22303e", true, "ironback"), smoke: 0, bump: 0 });
      return;
    }
  }

  private currentDefId(): string {
    const car = this.cars.find((c) => c.rt.id === this.player.vehicleId);
    return car ? car.rt.defId : "";
  }

  /**
   * Where should the player be heading right now? Contracts win, then the
   * active mission objective (npc/pickup targets alias to their buildings).
   * Races render their own checkpoints, so they yield no waypoint here.
   */
  private waypointPos(): { x: number; z: number } | null {
    if (this.race) return null;
    if (this.contract) {
      const id = this.contract.stage === "pickup" ? this.contract.def.pickupLandmark : this.contract.def.dropLandmark;
      return this.landmarkDoor(id);
    }
    const def = [...MISSIONS, HEIST_SUNSET].find((m) => m.id === this.mission.id);
    if (!def) return null;
    const target = def.objectives[Math.min(this.mission.step, def.objectives.length - 1)]?.targetId ?? "";
    const actor = this.actors.find((a) => a.id === target);
    if (actor) return { x: actor.x, z: actor.z };
    // Car objectives point at the car: the job Sparrow had no marker at all,
    // and "steal a getaway car" pointed at nothing.
    const wanted = this.cars.find((c) => c.rt.id === target && !c.rt.exploded);
    if (wanted) return { x: wanted.rt.x, z: wanted.rt.y };
    if (target === "getaway") {
      const nearest = this.cars
        .filter((c) => !c.rt.exploded && !c.rt.stolen && c.rt.id !== this.player.vehicleId)
        .sort(
          (a, b) =>
            Math.hypot(a.rt.x - this.player.x, a.rt.y - this.player.z) - Math.hypot(b.rt.x - this.player.x, b.rt.y - this.player.z),
        )[0];
      if (nearest) return { x: nearest.rt.x, z: nearest.rt.y };
    }
    const alias: Record<string, string> = {
      rico: "rico-hideout",
      phone: "rico-hideout",
      maya: "maya-garage",
      cargo: "warehouse",
      race: "race-start",
    };
    const id = alias[target] ?? target;
    return id ? this.landmarkDoor(id) : null;
  }

  private landmarkDoor(id: string): { x: number; z: number } | null {
    const lm = this.world.landmarks.find((l) => l.id === id);
    return lm ? { x: (lm.doorX + 0.5) * TILE, z: (lm.doorY + 0.5) * TILE } : null;
  }

  /** A soft light pillar over the current objective so it reads at street level. */
  private updateBeacon(): void {
    const wp = this.interiorMode ? null : this.waypointPos();
    if (!wp) {
      this.beaconMesh?.setEnabled(false);
      return;
    }
    if (!this.beaconMesh) {
      const m = MeshBuilder.CreateCylinder("waypoint-beacon", { diameter: 36, height: 320, tessellation: 10 }, this.scene);
      const mat = new StandardMaterial("waypoint-beacon-mat", this.scene);
      mat.emissiveColor = Color3.FromHexString("#f0b040");
      mat.diffuseColor = Color3.Black();
      mat.disableLighting = true;
      mat.alpha = 0.3;
      m.material = mat;
      m.isPickable = false;
      // Fog and night lighting must never swallow the objective marker.
      m.applyFog = false;
      this.beaconMesh = m;
    }
    this.beaconMesh.setEnabled(true);
    this.beaconMesh.position.set(wp.x, 150, wp.z);
    (this.beaconMesh.material as StandardMaterial).alpha = 0.26 + 0.1 * Math.sin(this.clock * 3);
  }

  private arrest(msg: string): void {
    this.jailLeft = 40;
    this.surrenderT = 0;
    this.heat = createHeatState();
    // The officers who booked you are off the case: leaving them alive meant a
    // squad still jogging toward the precinct when you walked back out.
    for (const c of this.cops) c.mesh.dispose();
    this.cops = [];
    this.copGap = Infinity;
    this.player.y = 0;
    this.player.grounded = true;
    this.dropLine();
    // Contraband is confiscated but you keep your cash minus processing.
    this.loot = [];
    this.player.vehicleId = null;
    this.clearInterior();
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
    this.failure = "busted";
    this.failureT = 3.2;
    this.flash(msg);
    this.audio.uiClick();
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
    // Officers arrive where the police think the suspect is. Anchoring the
    // spawn on the player meant a fresh cop popped into being behind you even
    // when the last report put you on the other side of town.
    const hunting = this.heat.hasLastKnown && this.heat.hiddenTimer > 2;
    const ax = hunting ? this.heat.lastKnownX : this.player.x;
    const az = hunting ? this.heat.lastKnownY : this.player.z;
    // Behind the camera by preference: nobody should watch a policeman fade in.
    const back = headingFromCamera(this.player.camYaw) + Math.PI;
    let x = ax;
    let z = az;
    for (let tries = 0; tries < 14; tries++) {
      const a = tries < 10 ? back + (Math.random() - 0.5) * 1.6 : Math.random() * Math.PI * 2;
      const d = POLICE_CONFIG.minSpawnDistance + Math.random() * (POLICE_CONFIG.maxSpawnDistance - POLICE_CONFIG.minSpawnDistance);
      x = Math.max(40, Math.min(MAP_W * TILE - 40, ax + Math.cos(a) * d));
      z = Math.max(40, Math.min(MAP_H * TILE - 40, az + Math.sin(a) * d));
      if (!blocked(this.world, x, z, 8)) break;
    }
    const cop: Actor = {
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
    this.showWeapon(cop.mesh, "pistol");
    return cop;
  }

  /**
   * Ages muzzle flashes, tracers and debris on real time, once per rendered
   * frame and before the frame is drawn. Running this inside the fixed
   * simulation step meant a flash could be born and disposed between two
   * renders on a slow machine, so the gun fired but nothing was ever seen.
   */
  private updateEffects(frame: number): void {
    const dt = Math.min(0.1, frame);
    this.tracers = this.tracers.filter((t) => {
      // Everything gets at least one frame on screen before it starts ageing.
      if (!t.seen) {
        t.seen = true;
        return true;
      }
      t.life -= dt;
      if (t.life <= 0) {
        t.mesh.dispose();
        return false;
      }
      if (t.fall) {
        t.fall.vy -= 150 * dt;
        t.mesh.position.x += t.fall.vx * dt;
        t.mesh.position.y = Math.max(0.4, t.mesh.position.y + t.fall.vy * dt);
        t.mesh.position.z += t.fall.vz * dt;
        t.mesh.rotation.z += dt * 9;
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
      this.lastFired = this.clock;
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
        (a) => a.dead === undefined && Math.hypot(a.x - this.player.x, a.z - this.player.z) < weapon.range,
      );
      if (civ) {
        this.hitActor(civ, weapon.damage, "fists", true);
        this.reportCrime("assault");
        if (civ.dead === undefined) this.flash("SHOVE  ·  they want no part of you");
      }
      return;
    }

    if (this.reloadT > 0) return;
    if (this.player.mag <= 0) {
      if (this.player.ammo > 0) {
        this.beginReload();
        return;
      }
      this.flash("CLICK  ·  dry  ·  ammo at Red Pump");
      this.lastShot = 0.05;
      return;
    }
    this.lastShot = 0;
    this.player.mag -= 1;

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

    // Aiming tightens the group; spraying from the hip should cost you.
    const spread = weapon.spread * (this.aiming ? AIM_CONFIG.spreadScale : 1);
    heading += (Math.random() - 0.5) * 2 * spread;
    // A wall stops a bullet. It never used to: rounds flew through blocks and
    // killed people on the far side of a building.
    const wall = this.shotStop(this.player.x, this.player.z, heading, weapon.range);
    const tx = this.player.x + Math.cos(heading) * wall;
    const tz = this.player.z + Math.sin(heading) * wall;

    const mx = this.player.x + Math.cos(heading) * 9;
    const mz = this.player.z + Math.sin(heading) * 9;
    // Fire from wherever the player actually is: mid-swing the muzzle used to
    // flash down at street level while the shooter was over the rooftops.
    const gy = GUN_Y + this.player.y;
    this.spawnMuzzleFlash(mx, gy, mz, heading);
    this.spawnTracer(mx, gy, mz, tx, gy, tz);
    this.spawnCasing(mx, gy, mz, heading);
    this.audio.gun();
    this.recoil += weapon.recoil;
    this.recoilStep += weapon.recoil;
    // Most of the kick settles by itself; what is left is the climb the
    // player has to ride down, which is what makes a long burst cost you.
    this.recoilPitch += weapon.recoil * 0.7;
    this.lastFired = this.clock;
    if (this.settings.shake) this.shake = weapon.id === "smg" ? 1.6 : 3;
    this.reportCrime("gunfire");
    this.panicNear();

    // One bullet, one victim: whatever stands closest along the ray takes it,
    // so a body between you and a car actually stops the round.
    let best: { d: number; hit: () => void } | null = null;
    const consider = (x: number, z: number, radius: number, hit: () => void): void => {
      if (!pointNearSegment(x, z, this.player.x, this.player.z, tx, tz, radius)) return;
      const d = Math.hypot(x - this.player.x, z - this.player.z);
      if (!best || d < best.d) best = { d, hit };
    };
    for (const c of this.cops) {
      consider(c.x, c.z, 12, () => {
        c.hp -= weapon.damage;
        this.spawnBlood(c.x, 10, c.z, heading);
        this.impact(c.hp <= 0 ? "kill" : "hit");
        this.markHit(c.hp <= 0);
        this.flash(c.hp <= 0 ? "DOWN  ·  that one's staying down" : "HIT");
        if (c.hp <= 0) {
          // Shooting an officer is the one crime the city never shrugs off.
          this.raiseHeat(2);
          this.pushNews("Officer down in Southside. Every unit is rolling.");
        }
      });
    }
    for (const a of this.actors) {
      if (a.dead !== undefined) continue;
      consider(a.x, a.z, 11, () => {
        this.spawnBlood(a.x, 10, a.z, heading);
        const fatal = a.hp - weapon.damage <= 0 && a.kind !== "named";
        this.markHit(fatal);
        this.hitActor(a, weapon.damage, "gun", true);
      });
    }
    for (const car of this.cars) {
      if (car.rt.exploded) continue;
      consider(car.rt.x, car.rt.y, 16, () => {
        car.rt = applyVehicleDamage(car.rt, Math.round(weapon.damage * 0.65), false);
        this.spawnSparks(car.rt.x, 8, car.rt.y, heading);
        this.markHit(false);
        if (Math.random() < 0.3) {
          car.rt = shootTire(car.rt);
          this.flash("TIRE  ·  shredded, she'll wander now");
        }
        if (car.rt.health <= 0) this.flash("CAR  ·  fuel tank's punching out");
      });
    }
    const target = best as { hit: () => void } | null;
    if (target) target.hit();
    else if (wall < weapon.range) {
      // Nothing in the way but the building: chip it and leave a hole behind.
      this.spawnSparks(tx, GUN_Y, tz, heading + Math.PI);
      this.leaveMark(tx - Math.cos(heading) * 1.5, GUN_Y, tz - Math.sin(heading) * 1.5, "#12100e", 7, false);
    }
  }

  /** Distance the round travels before a building stops it. */
  private shotStop(x: number, z: number, heading: number, range: number): number {
    const step = 7;
    const cx = Math.cos(heading);
    const cz = Math.sin(heading);
    for (let d = step; d <= range; d += step) {
      if (blocked(this.world, x + cx * d, z + cz * d, 1)) return Math.max(step, d - step / 2);
    }
    return range;
  }

  private beginReload(): void {
    const weapon = weaponById(this.player.weapon);
    if (weapon.magazine <= 0 || this.reloadT > 0) return;
    if (this.player.ammo <= 0 || this.player.mag >= weapon.magazine) return;
    this.reloadT = weapon.reloadSeconds;
    this.audio.uiClick();
    this.flash(`RELOADING  ·  ${weapon.name}`);
  }

  private finishReload(): void {
    const weapon = weaponById(this.player.weapon);
    const take = reloadAmount(weapon.magazine, this.player.mag, this.player.ammo);
    this.player.mag += take;
    this.player.ammo -= take;
  }

  /** Tops the magazine straight up, for pickups and shop purchases. */
  private refillMagazine(): void {
    const weapon = weaponById(this.player.weapon);
    if (weapon.magazine <= 0) return;
    const take = reloadAmount(weapon.magazine, this.player.mag, this.player.ammo);
    this.player.mag += take;
    this.player.ammo -= take;
  }

  private markHit(kill: boolean): void {
    this.hitMark = { at: this.clock, kill };
  }

  private spawnTracer(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const line = MeshBuilder.CreateBox("tr", { width: len, depth: 0.5, height: 0.5 }, this.scene);
    line.material = this.material("#ffe9a8", 1);
    line.position = new Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    line.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
    this.tracers.push({ mesh: line, life: 0.06 });
  }

  /** The bright flare off the barrel that tells you the gun went off. */
  private spawnMuzzleFlash(x: number, y: number, z: number, heading: number): void {
    const flash = MeshBuilder.CreateBox("mz", { width: 7, depth: 2.6, height: 2.6 }, this.scene);
    flash.material = this.material("#fff0b4", 1);
    flash.position = new Vector3(x + Math.cos(heading) * 3, y, z + Math.sin(heading) * 3);
    flash.rotation.y = -heading;
    this.tracers.push({ mesh: flash, life: 0.05 });
    const glow = MeshBuilder.CreateBox("mzg", { size: 4.4 }, this.scene);
    glow.material = this.material("#f8a83c", 0.9);
    glow.position = new Vector3(x, y, z);
    this.tracers.push({ mesh: glow, life: 0.07 });
  }

  /**
   * Brass out of the ejection port, so firing leaves something behind. Sized
   * for a camera 150 units away rather than for realism: at true scale the
   * casing is a single pixel and may as well not exist.
   */
  private spawnCasing(x: number, y: number, z: number, heading: number): void {
    const side = heading + Math.PI / 2;
    const c = MeshBuilder.CreateBox("cs", { width: 3.2, depth: 1.3, height: 1.3 }, this.scene);
    c.material = this.surface("metal", "#e8c058", 0.35);
    c.position = new Vector3(x + Math.cos(side) * 4, y - 1, z + Math.sin(side) * 4);
    c.rotation.y = -heading;
    this.tracers.push({ mesh: c, life: 1.6, fall: { vy: 12, vx: Math.cos(side) * 18, vz: Math.sin(side) * 18 } });
  }

  private spawnSparks(x: number, y: number, z: number, heading: number): void {
    for (let i = 0; i < 5; i++) {
      const a = heading + (Math.random() - 0.5) * 1.6;
      const s = MeshBuilder.CreateBox("sp", { size: 2.2 + Math.random() * 1.8 }, this.scene);
      s.material = this.material(i % 2 ? "#ffd27a" : "#fff4d8", 1);
      s.position = new Vector3(x, y + (Math.random() - 0.3) * 3, z);
      this.tracers.push({
        mesh: s,
        life: 0.4 + Math.random() * 0.3,
        fall: { vy: 14 + Math.random() * 16, vx: Math.cos(a) * 40, vz: Math.sin(a) * 40 },
      });
    }
    this.spawnPuff(x, y, z, "#cfc7b6");
  }

  private spawnBlood(x: number, y: number, z: number, heading: number): void {
    for (let i = 0; i < 6; i++) {
      const a = heading + (Math.random() - 0.5) * 1.1;
      const s = MeshBuilder.CreateBox("bl", { size: 2 + Math.random() * 2.2 }, this.scene);
      s.material = this.material("#8e1c14", 0.25);
      s.position = new Vector3(x, y + (Math.random() - 0.5) * 5, z);
      this.tracers.push({
        mesh: s,
        life: 0.5 + Math.random() * 0.3,
        fall: { vy: 8 + Math.random() * 12, vx: Math.cos(a) * 30, vz: Math.sin(a) * 30 },
      });
    }
    this.leaveMark(x + Math.cos(heading) * 6, 0.4, z + Math.sin(heading) * 6, "#5e120c", 11);
  }

  /**
   * Leaves a flat patch on the ground or wall: bullet holes and blood that
   * stay put, so a firefight is still readable once the shooting stops. The
   * pool is capped, oldest recycled first.
   */
  private leaveMark(x: number, y: number, z: number, hex: string, size: number, onGround = true): void {
    const m = MeshBuilder.CreateBox(
      `mk${this.marks.length}`,
      onGround ? { width: size, depth: size, height: 0.4 } : { size: size * 0.5 },
      this.scene,
    );
    m.material = this.material(hex);
    m.position = new Vector3(x, onGround ? Math.max(0.35, y - 1) : y, z);
    m.rotation.y = Math.random() * Math.PI;
    this.marks.push(m);
    if (this.marks.length > 48) this.marks.shift()?.dispose();
  }

  private spawnPuff(x: number, y: number, z: number, hex: string): void {
    const p = MeshBuilder.CreateBox("puff", { size: 3 + Math.random() * 3 }, this.scene);
    p.material = this.material(hex, 0.4);
    p.position = new Vector3(x + (Math.random() - 0.5) * 6, y + Math.random() * 4, z + (Math.random() - 0.5) * 6);
    this.tracers.push({ mesh: p, life: 0.4 });
  }

  private nearestNamed(r: number): Actor | undefined {
    let best: Actor | undefined;
    let bestD = r;
    for (const a of this.actors) {
      if (a.kind !== "named") continue;
      const d = Math.hypot(a.x - this.player.x, a.z - this.player.z);
      if (d < bestD) {
        bestD = d;
        best = a;
      }
    }
    return best;
  }

  private talkTo(named: Actor): void {
    const line = named.talk?.[Math.min(named.talk.length - 1, this.mission.step)] ?? named.talk?.[0] ?? "...";
    this.say(named.name, line);
    if (named.id === "rico" && this.mission.id === "fresh-off-the-bus") {
      this.mission.step = Math.max(this.mission.step, 2);
      this.player.phone = true;
    }
    if (named.id === "maya" && this.mission.id === "borrowed-wheels") this.mission.step = Math.max(this.mission.step, 3);
  }

  private tryInteract(): void {
    // Everything here is decided on a flat map. Three hundred units up on a
    // rooftop you are still "next to" the shop below, and E would walk you
    // into it through the floor.
    if (!this.player.grounded || this.player.y > LEDGE_STEP) {
      this.audio.uiClick();
      return;
    }
    if (!this.player.vehicleId) {
      const named = this.nearestNamed(52);
      if (named?.talk) {
        this.talkTo(named);
        return;
      }
      const car = this.nearestCar(34);
      if (car && !car.rt.exploded) {
        const def = vehicleById(car.rt.defId);
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
    const mark = landmarkAt(this.world, this.player.x, this.player.z);
    if (mark) this.useLandmark(mark);
  }

  private useLandmark(mark: Landmark): void {
    if (mark.id === "police") {
      this.flash(this.heat.level > 0 ? "NCPD  ·  bold of you to knock" : "NCPD  ·  nothing for you here, keep moving");
      return;
    }
    if (mark.id === "rico-hideout") {
      const rico = this.actors.find((a) => a.id === "rico");
      if (rico) this.talkTo(rico);
      return;
    }
    if (mark.id === "coral-mart") {
      this.enterInterior("coral-mart");
      this.flash("CORAL MART  ·  counter buys food  ·  the till is a choice");
      return;
    }
    if (mark.id === "malibu-club") return this.enterClub();
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
          this.refillMagazine();
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
      } else if (this.player.weapon !== "fists") {
        // Any gun can restock here — SMG boxes are just bigger.
        const rounds = this.player.weapon === "smg" ? 30 : 12;
        if (this.player.cash >= 25) {
          this.player.cash -= 25;
          this.player.ammo += rounds;
          this.refillMagazine();
          this.audio.cash();
          this.flash(`AMMO  ·  +${rounds}, $25`);
        } else {
          this.flash("PUMP  ·  ammo box is $25, friend");
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
    this.refillMagazine();
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
    this.player.y = 0;
    this.player.grounded = true;
    this.dropLine();
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
        (a) =>
          a.dead === undefined &&
          Math.hypot(a.x - this.player.x, a.z - this.player.z) < 150 &&
          this.lineOpen(a.x, a.z, this.player.x, this.player.z),
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
        this.cars.push({ rt, mesh: this.makeCarMesh(rt.id, "#22303e", false, "ironback"), smoke: 0, bump: 0 });
        break;
      }
      case "rare-car": {
        const rt = createVehicleRuntime("mirage", 68 * TILE, 11.5 * TILE, 0, "#c8a028");
        rt.id = `event-rare-${Math.random().toString(36).slice(2, 6)}`;
        this.eventCarIds.add(rt.id);
        this.cars.push({ rt, mesh: this.makeCarMesh(rt.id, "#c8a028", false, "mirage"), smoke: 0, bump: 0 });
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
        this.cars.push({ rt, mesh: this.makeCarMesh(rt.id, "#b03a28", false, "needle"), smoke: 0, bump: 0 });
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
    this.impact("explosion");
    for (let i = 0; i < 22; i++) {
      this.spawnPuff(car.rt.x, 8 + Math.random() * 14, car.rt.y, i % 2 ? "#f0b040" : "#d84020");
    }
    const wreck = this.surface("metal", "#2a1c14");
    car.mesh.material = wreck;
    for (const child of car.mesh.getChildMeshes()) child.material = wreck;
    if (this.player.vehicleId === car.rt.id) {
      this.exitVehicle();
      this.hurt(VEHICLE_CONFIG.explosionDamageDriver);
    }
    if (Math.hypot(this.player.x - car.rt.x, this.player.z - car.rt.y) < 70) this.hurt(VEHICLE_CONFIG.explosionDamageNear);
    // A fireball in the street is not something a crowd stands around for.
    for (const a of this.actors) {
      const d = Math.hypot(a.x - car.rt.x, a.z - car.rt.y);
      if (d < 60) this.hitActor(a, Math.round(70 - d), "vehicle", false);
    }
    this.panicNear();
    this.raiseHeat(1);
    this.flash("BOOM  ·  wreck stays in the street");
  }

  private raiseHeat(n: number): void {
    const before = this.heat.level;
    this.heat = tickHeat(this.heat, 0, true, this.player.x, this.player.z, n, this.player.vehicleId ? this.currentDefId() : "");
    if (this.heat.level > before) {
      this.audio.wanted();
      this.impact("wanted");
    }
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
    this.impact("hit");
  }

  private die(): void {
    this.player.health = 100;
    this.player.armor = 0;
    this.player.x = this.world.spawnX;
    this.player.z = this.world.spawnY;
    this.player.y = 0;
    this.player.grounded = true;
    this.dropLine();
    this.player.vehicleId = null;
    this.player.cash = Math.max(0, this.player.cash - PLAYER_CONFIG.respawnMedicalFee);
    this.player.crate = false;
    // Contraband does not survive a trip through the county morgue either.
    const lost = this.loot.reduce((s, l) => s + l.value, 0);
    this.loot = [];
    this.heat = createHeatState();
    this.failure = "wasted";
    this.failureT = 3.2;
    this.impact("explosion");
    this.flash(
      lost > 0
        ? `COUNTY  ·  $${PLAYER_CONFIG.respawnMedicalFee} medical  ·  $${lost} of hot goods gone`
        : `COUNTY  ·  $${PLAYER_CONFIG.respawnMedicalFee} medical  ·  street cash lighter`,
    );
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
      this.cars.push({ rt, mesh: this.makeCarMesh(rt.id, "#d8b430", false, "mirage"), smoke: 0, bump: 0 });
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
      // The objective list starts at "steal the Sparrow": sitting in it is the
      // step, not a silent prerequisite of the delivery.
      if (this.player.vehicleId === "sparrow-job") this.mission.step = Math.max(this.mission.step, 1);
      const maya = landmarkAt(this.world, this.player.x, this.player.z, 60);
      if (this.player.vehicleId === "sparrow-job" && maya?.id === "maya-garage") this.mission.step = Math.max(this.mission.step, 2);
      if (this.mission.step >= 3) this.complete("borrowed-wheels");
    }
    if (this.mission.id === "easy-money") {
      // "Lose the cops" needs cops to have existed. Robbing an empty store with
      // nobody watching used to complete the mission the instant the till opened.
      if (this.heat.level >= 1) this.mission.chased = true;
      if (this.mission.step >= 1 && !this.mission.chased && !this.mission.hinted) {
        this.mission.hinted = true;
        this.flash("NOBODY CALLED IT IN  ·  make some noise, then lose them");
      }
      if (this.mission.step >= 1 && this.mission.chased && this.heat.level === 0) this.complete("easy-money");
    }
    if (this.mission.id === "midnight-run") {
      const cp = RACE_CPS[this.mission.raceHits];
      if (cp && Math.hypot(this.player.x - cp.x, this.player.z - cp.z) < 48) {
        this.mission.raceHits += 1;
        // Keep the objective line in step with the checkpoints being hit.
        this.mission.step = 1;
        this.flash(`CHECKPOINT  ${this.mission.raceHits}/${RACE_CPS.length}`);
      }
      if (this.mission.raceHits >= RACE_CPS.length) this.complete("midnight-run");
    }
    if (this.mission.id === "port-authority") {
      const yard = landmarkAt(this.world, this.player.x, this.player.z, 90);
      if (yard?.id === "warehouse") this.mission.step = Math.max(this.mission.step, 1);
      if (this.player.crate) this.mission.step = Math.max(this.mission.step, 2);
      const rico = landmarkAt(this.world, this.player.x, this.player.z, 50);
      if (this.player.crate && rico?.id === "rico-hideout") {
        this.player.crate = false;
        this.mission.step = 3;
        this.flash("CRATE DROPPED  ·  now shake anyone who followed you");
      }
      // The last objective is to leave clean, so heat has to be gone.
      if (this.mission.step >= 3 && this.heat.level === 0) this.complete("port-authority");
    }
    if (this.mission.id === "sunset-jewelry") {
      const near = landmarkAt(this.world, this.player.x, this.player.z, 50);
      if (near?.id === "jewelry") this.mission.step = Math.max(this.mission.step, 1);
      // A getaway car is one you took, not the taxi you were already sitting in.
      const ride = this.cars.find((c) => c.rt.id === this.player.vehicleId);
      if (ride?.rt.stolen) this.mission.step = Math.max(this.mission.step, 2);
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
    const mesh = this.makeCarMesh(`tow-${Math.random().toString(36).slice(2, 6)}`, "#c8a028", false, "ironback");
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
      mesh.position.y = 0;
      const d = Math.hypot(r.x - this.player.x, r.z - this.player.z);
      mesh.setEnabled(d >= 22);
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
  debugSpawnCar(defId = this.debugSpawnToggle ? "sparrow" : "mirage"): void {
    // Alternate an open beater and a locked Mirage so both paths are testable.
    this.debugSpawnToggle = !this.debugSpawnToggle;
    const color = defId === "sahin" ? "#d8d2c4" : this.debugSpawnToggle ? "#a05a2c" : "#2f6f78";
    // On the player's own tile: anywhere else risks dropping the car inside a
    // wall, where it is pinned and cannot pull away.
    const rt = createVehicleRuntime(defId, this.player.x, this.player.z, this.player.heading, color);
    rt.id = `debug-${Math.random().toString(36).slice(2, 6)}`;
    rt.stolen = true;
    this.cars.push({ rt, mesh: this.makeCarMesh(rt.id, color, false, defId), smoke: 0, bump: 0 });
    // This menu exists to get a stranded player moving, so hand them the keys.
    this.unlocked.add(rt.id);
    this.player.vehicleId = rt.id;
    this.flash(`UNSTUCK  ·  ${vehicleById(defId).name} is yours, go`);
  }

  debugSetHeat(level: number): void {
    this.heat = createHeatState();
    if (level > 0) this.heat = tickHeat(this.heat, 0, true, this.player.x, this.player.z, level);
  }

  debugGiveWeapon(id: WeaponId = "pistol"): void {
    this.player.weapon = id;
    this.player.ammo = 60;
    this.player.mag = 0;
    this.refillMagazine();
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
      // Compact: the full brief lives in the dialogue; the HUD names the stop.
      const targetId = this.contract.stage === "pickup" ? this.contract.def.pickupLandmark : this.contract.def.dropLandmark;
      const name = this.world.landmarks.find((l) => l.id === targetId)?.name ?? targetId;
      obj = `CONTRACT  ·  ${this.contract.stage === "pickup" ? "pickup" : "drop"}: ${name}`;
    }
    if (this.race) obj = `RACE  ·  ${this.race.checkpoint}/${RACE_CPS.length}  ·  ${this.race.t.toFixed(1)}s`;
    const wp = this.waypointPos();
    if (wp && !this.race) {
      const meters = Math.round(Math.hypot(this.player.x - wp.x, this.player.z - wp.z) * 0.31);
      if (meters > 12) obj += `  ·  ${meters}m`;
    }
    // Nothing on the pavement is within reach from the air or a rooftop.
    const onFoot = this.player.grounded && this.player.y <= LEDGE_STEP;
    const mark = onFoot ? landmarkAt(this.world, this.player.x, this.player.z) : null;
    const car = onFoot ? this.nearestCar(34) : null;
    let prompt = "";
    const nearestCop = this.cops.reduce((min, c) => Math.min(min, Math.hypot(c.x - this.player.x, c.z - this.player.z)), Infinity);
    if (this.jailLeft > 0) prompt = "";
    else if (this.interiorMode) prompt = this.interiorPrompt();
    else if (this.lockpick) prompt = "E  ·  PICK when the pin is in the zone";
    else if (this.heat.level >= 1 && !this.player.vehicleId && nearestCop < 34) prompt = "G  ·  SURRENDER (jail beats the morgue)";
    else if (!this.player.vehicleId && this.nearestNamed(52)) {
      const who = this.nearestNamed(52);
      prompt = who ? `E  ·  TALK TO ${who.name.toUpperCase()}` : "";
    } else if (!this.player.vehicleId && car) {
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
      objective: sanitizeText(obj, 96),
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
      interior: this.activeRoom()?.name ?? null,
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
      ammo: this.player.weapon === "fists" ? 0 : this.player.ammo + this.player.mag,
      mag: this.armed() ? this.player.mag : 0,
      reserve: this.armed() ? this.player.ammo : 0,
      reloading: this.reloadT > 0,
      aiming: this.aiming,
      // Crosshair bloom: what the gun is actually doing, not a fixed dot.
      spread: this.armed()
        ? weaponById(this.player.weapon).spread * (this.aiming ? AIM_CONFIG.spreadScale : 1) + this.recoil * 1.6
        : 0,
      hitMarker: this.clock - this.hitMark.at < 0.3 ? (this.hitMark.kill ? "kill" : "hit") : null,
      raceBestMs: this.player.raceBestMs,
      waypointBearing: wp
        ? normalizeAngle(Math.atan2(wp.x - this.player.x, wp.z - this.player.z) - this.player.camYaw)
        : null,
      combo: this.thrill.combo,
      comboMultiplier: comboMultiplier(this.thrill.combo),
      comboCash: this.thrill.pending,
      speed: drive ? speedoKmh(Math.hypot(drive.rt.vx, drive.rt.vy)) : 0,
      drifting: this.driftTime > 0,
      failure: this.failure,
      web: this.zipTo
        ? "zip"
        : this.web
          ? "swing"
          : this.cling
            ? "wall"
            : !this.player.grounded && !this.player.vehicleId
              ? "air"
              : this.anchorPreview && !this.player.vehicleId
                ? "aimed"
                : "ready",
      altitude: this.player.vehicleId ? 0 : Math.round(this.player.y),
      airSpeed: this.player.grounded || this.player.vehicleId ? 0 : speedoKmh(Math.hypot(this.flight.vx, this.flight.vz)),
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
    const wp = this.waypointPos();
    if (wp) {
      const pulse = 5 + Math.sin(this.clock * 4) * 2;
      ctx.strokeStyle = "#f0b040";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(wp.x * scale, wp.z * scale, pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#f0b040";
      ctx.fillRect(wp.x * scale - 1.5, wp.z * scale - 1.5, 3, 3);
      ctx.lineWidth = 1;
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

  /** Full district map with labels for the phone's map app. */
  drawMapCanvas(c: HTMLCanvasElement): void {
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const s = c.width;
    const scale = s / (MAP_W * TILE);
    ctx.fillStyle = "#1c1512";
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = "#38322c";
    for (const yTile of [10, 22, 36, 50, 64]) ctx.fillRect(0, yTile * TILE * scale, s, 3 * TILE * scale);
    for (const xTile of [8, 22, 36, 50, 64, 80]) ctx.fillRect(xTile * TILE * scale, 0, 3 * TILE * scale, s);
    ctx.font = "8px monospace";
    for (const lm of this.world.landmarks) {
      const x = lm.x * TILE * scale;
      const y = lm.y * TILE * scale;
      ctx.fillStyle = "#e0a030";
      ctx.fillRect(x, y, Math.max(3, lm.w * TILE * scale * 0.6), Math.max(3, lm.h * TILE * scale * 0.6));
      ctx.fillStyle = "#d8c4ae";
      ctx.fillText(lm.name.slice(0, 14), Math.min(x, s - 60), Math.max(8, y - 2));
    }
    const wp = this.waypointPos();
    if (wp) {
      ctx.strokeStyle = "#e0a030";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(wp.x * scale, wp.z * scale, 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1;
    }
    ctx.fillStyle = "#6aa0d4";
    for (const cop of this.cops) ctx.fillRect(cop.x * scale - 2, cop.z * scale - 2, 4, 4);
    ctx.fillStyle = "#c45a32";
    ctx.beginPath();
    ctx.arc(this.player.x * scale, this.player.z * scale, 4, 0, Math.PI * 2);
    ctx.fill();
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
