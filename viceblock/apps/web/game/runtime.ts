import {
  applyReward,
  applyVehicleDamage,
  assistHint,
  copCountForHeat,
  copSpeedForHeat,
  createHeatState,
  createVehicleRuntime,
  explosionRadius,
  HEIST_SUNSET,
  MISSIONS,
  nextMission,
  tickHeat,
  tickVehicleExplosion,
  vehicleById,
  type HeatState,
  type VehicleRuntime,
} from "@viceblock/game-core";
import {
  DEFAULT_SETTINGS,
  MAP_H,
  MAP_W,
  sanitizeText,
  STARTER_CASH,
  TILE,
  type PlayerSave,
  type PresencePlayer,
} from "@viceblock/shared";
import { GameAudio } from "./audio";
import type { HudSnapshot } from "./hud";
import { GameInput } from "./input";
import {
  blocked,
  buildSouthside,
  Cell,
  cellAt,
  hideSpotNear,
  landmarkAt,
  TILE_SIZE,
  type Landmark,
  type WorldData,
} from "./world";

type PedKind = "civilian" | "worker" | "tourist" | "criminal" | "cop" | "gang" | "named";

interface Ped {
  id: string;
  kind: PedKind;
  name: string;
  x: number;
  y: number;
  heading: number;
  speed: number;
  color: string;
  shirt: string;
  panic: number;
  hp: number;
  talk?: string[];
}

interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  fromPlayer: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
}

interface MissionRuntime {
  id: string;
  step: number;
  raceHits: number;
  crate: boolean;
}

interface Remote {
  id: string;
  username: string;
  x: number;
  y: number;
  heading: number;
  inVehicle: boolean;
}

export type { HudSnapshot } from "./hud";

const RACE_CPS = [
  { x: 50 * TILE, y: 65 * TILE },
  { x: 82 * TILE, y: 52 * TILE },
  { x: 36 * TILE, y: 24 * TILE },
  { x: 50 * TILE, y: 65 * TILE },
];

export class ViceblockRuntime {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  world: WorldData;
  input: GameInput;
  audio: GameAudio;
  player = {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    heading: 0,
    health: 100,
    armor: 0,
    cash: STARTER_CASH,
    bank: 0,
    xp: 0,
    streetRep: 0,
    vehicleId: null as string | null,
    weapon: "fists" as "fists" | "pistol",
    ammo: 36,
    phone: false,
    crate: false,
  };
  vehicles: VehicleRuntime[] = [];
  peds: Ped[] = [];
  cops: Ped[] = [];
  bullets: Bullet[] = [];
  particles: Particle[] = [];
  remotes: Remote[] = [];
  heat: HeatState = createHeatState();
  mission: MissionRuntime = { id: "fresh-off-the-bus", step: 0, raceHits: 0, crate: false };
  completed: string[] = [];
  time = 8.2;
  weather: "clear" | "rain" | "fog" = "clear";
  weatherT = 0;
  camX = 0;
  camY = 0;
  shake = 0;
  dialogue: { who: string; line: string; t: number } | null = null;
  toast = "";
  toastT = 0;
  prompt = "";
  interior: Landmark | null = null;
  saveId = "guest";
  username = "rookie";
  settings = { ...DEFAULT_SETTINGS };
  lastFoot = 0;
  lastShot = 0;
  running = false;
  raf = 0;
  last = 0;
  onHud?: (h: HudSnapshot) => void;
  onPersist?: (s: PlayerSave) => void;
  onMissionComplete?: (missionId: string) => void;
  persistT = 0;
  private unbind: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("no 2d context");
    this.ctx = ctx;
    this.world = buildSouthside();
    this.player.x = this.world.spawnX;
    this.player.y = this.world.spawnY;
    this.input = new GameInput();
    this.audio = new GameAudio();
    this.seedWorld();
  }

  attach(): void {
    this.unbind = this.input.attach(this.canvas);
  }

  detach(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.unbind?.();
    this.audio.setSiren(false);
  }

  async start(): Promise<void> {
    await this.audio.unlock();
    this.audio.setLevels(this.settings);
    this.running = true;
    this.last = performance.now();
    const loop = (now: number): void => {
      if (!this.running) return;
      const dt = Math.min(0.033, (now - this.last) / 1000);
      this.last = now;
      this.update(dt);
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    this.say("Rico Vale", "You walk like you still got a ticket in your pocket. Come here.");
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
    this.player.x = save.x;
    this.player.y = save.y;
    this.completed = save.missionsCompleted;
    this.mission.id = save.activeMissionId ?? nextMission(save.missionsCompleted)?.id ?? "fresh-off-the-bus";
    this.settings = { ...DEFAULT_SETTINGS, ...save.settings };
    this.audio.setLevels(this.settings);
  }

  setRemotes(list: PresencePlayer[]): void {
    this.remotes = list
      .filter((p) => p.id !== this.saveId)
      .slice(0, 80)
      .map((p) => ({
        id: p.id,
        username: sanitizeText(p.username, 16),
        x: p.x,
        y: p.y,
        heading: p.heading,
        inVehicle: p.inVehicle,
      }));
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
      y: this.player.y,
      heading: this.player.heading,
      inventory: this.player.weapon === "pistol" ? [{ id: "pistol", kind: "weapon", name: "Street Pistol", qty: 1, rarity: "common" }] : [],
      ownedVehicleIds: [],
      apartmentId: "apartment",
      missionsCompleted: this.completed,
      activeMissionId: this.mission.id,
      collectibles: [],
      achievements: [],
      settings: this.settings,
      updatedAt: Date.now(),
    };
  }

  private seedWorld(): void {
    const spots: Array<[string, number, number, number, string]> = [
      ["sparrow", 18 * TILE, 64 * TILE, 0, "#c56b3a"],
      ["sparrow", 38 * TILE, 52 * TILE, 1.5, "#d8c4a0"],
      ["ironback", 52 * TILE, 38 * TILE, 0.2, "#6b2d28"],
      ["mirage", 66 * TILE, 52 * TILE, 3.2, "#2f6f78"],
      ["needle", 30 * TILE, 38 * TILE, 0.8, "#1f1a18"],
      ["sparrow", 84 * TILE, 40 * TILE, 4.7, "#8a8f6a"],
    ];
    this.vehicles = spots.map(([id, x, y, h, c]) => createVehicleRuntime(id, x, y, h, c, id !== "needle"));
    this.vehicles[1].stolen = true;
    this.vehicles[1].id = "sparrow-job";

    this.peds = [
      ped("rico", "named", "Rico Vale", 29 * TILE, 47 * TILE, "#3d2a22", "#c45a32", [
        "You drive?",
        "Depends. Is it yours?",
        "Not anymore. Boost the Sparrow by Coral Mart. Maya wants it clean.",
      ]),
      ped("maya", "named", "Maya Reyes", 57 * TILE, 61 * TILE, "#1b1a18", "#e6c39a", [
        "If it still rolls, I can make it mean.",
        "Midnight line is south. Don't be cute with the handbrake.",
      ]),
      ped("cupsey", "named", "Cupsey", 27 * TILE, 29 * TILE, "#2a2018", "#f0a030", [
        "Charts said Southside goes vertical. I took that personally.",
        "We're so back. Or we never left. Same thing.",
      ]),
      ped("ansem", "named", "Ansem", 72 * TILE, 20 * TILE, "#241c28", "#d8d2c4", [
        "Liquidity is just another word for heat.",
        "The mural remembers wallets the news forgets.",
      ]),
      ped("marcus", "named", "Marcus Vane", 82 * TILE, 61 * TILE, "#2c2618", "#5a6a48", [
        "Crate's in the yard. Fence is theater. Cops ain't.",
      ]),
    ];

    const colors = ["#c4a07a", "#8a6a54", "#d8c8b0", "#6a4a3a", "#b08870"];
    for (let i = 0; i < 42; i++) {
      const x = (8 + (i * 17) % 80) * TILE + 10;
      const y = (12 + (i * 11) % 60) * TILE + 10;
      if (blocked(this.world, x, y, 8)) continue;
      this.peds.push(
        ped(`c${i}`, i % 7 === 0 ? "gang" : i % 5 === 0 ? "worker" : "civilian", "local", x, y, "#2a201c", colors[i % colors.length] ?? "#c4a07a"),
      );
    }

    this.spawnTraffic();
  }

  private spawnTraffic(): void {
    const roads = [
      [10 * TILE, 11.5 * TILE, 0],
      [40 * TILE, 23.5 * TILE, Math.PI],
      [60 * TILE, 37.5 * TILE, 0],
      [23.5 * TILE, 20 * TILE, Math.PI / 2],
      [51.5 * TILE, 40 * TILE, -Math.PI / 2],
      [81.5 * TILE, 30 * TILE, Math.PI / 2],
    ];
    const ids = ["sparrow", "ironback", "sparrow", "mirage"] as const;
    roads.forEach(([x, y, h], i) => {
      const v = createVehicleRuntime(ids[i % ids.length] ?? "sparrow", x, y, h, i % 2 ? "#4a3a32" : "#7a5a40");
      v.id = `traffic-${i}`;
      this.vehicles.push(v);
    });
  }

  private update(dt: number): void {
    this.time = (this.time + dt / 240) % 24;
    this.weatherT += dt;
    if (this.weatherT > 90) {
      this.weatherT = 0;
      this.weather = this.weather === "clear" ? "rain" : this.weather === "rain" ? "fog" : "clear";
    }
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
      this.flash(assistHint(this.heat.level, this.heat.hiddenTimer, hideSpotNear(this.world, this.player.x, this.player.y)) || "AI ASSIST  ·  explore, then follow the yellow objective");
    }

    this.updatePlayer(dt);
    this.updateVehicles(dt);
    this.updatePeds(dt);
    this.updateCops(dt);
    this.updateBullets(dt);
    this.updateParticles(dt);
    this.updateMissions();
    this.audio.setInVehicle(Boolean(this.player.vehicleId));
    const v = this.vehicles.find((c) => c.id === this.player.vehicleId);
    this.audio.setEngineSpeed(v ? Math.hypot(v.vx, v.vy) : 0, Boolean(v && !v.exploded));
    this.audio.setSiren(this.heat.level >= 2);
    this.audio.tickSiren(dt);
    this.shake = Math.max(0, this.shake - dt * 8);
    if (this.dialogue) {
      this.dialogue.t -= dt;
      if (this.dialogue.t <= 0) this.dialogue = null;
    }
    if (this.toastT > 0) this.toastT -= dt;
    else this.toast = "";

    this.persistT += dt;
    if (this.persistT > 4) {
      this.persistT = 0;
      this.onPersist?.(this.snapshot());
    }
    this.onHud?.(this.hud());
  }

  private updatePlayer(dt: number): void {
    const axis = this.input.axis();
    if (this.player.vehicleId) {
      if (this.input.consumeInteract()) this.exitVehicle();
      return;
    }
    const speed = (axis.sprint ? 168 : 108) * (this.weather === "rain" ? 0.94 : 1);
    let nx = this.player.x + axis.x * speed * dt;
    let ny = this.player.y + axis.y * speed * dt;
    if (!blocked(this.world, nx, this.player.y, 8)) this.player.x = nx;
    else nx = this.player.x;
    if (!blocked(this.world, this.player.x, ny, 8)) this.player.y = ny;
    if (axis.x || axis.y) {
      this.player.heading = Math.atan2(axis.y, axis.x);
      this.lastFoot += dt;
      if (this.lastFoot > (axis.sprint ? 0.22 : 0.32)) {
        this.lastFoot = 0;
        this.audio.foot(axis.sprint);
      }
    }
    if (this.input.consumeInteract()) this.tryInteract();
    this.tryFire(dt);
    if (this.player.health <= 0) this.die();
  }

  private updateVehicles(dt: number): void {
    const wet = this.weather === "rain" ? 0.86 : 1;
    for (let i = 0; i < this.vehicles.length; i++) {
      let v = this.vehicles[i];
      if (v.exploded) continue;
      if (v.health <= 0) {
        const before = v.exploded;
        v = tickVehicleExplosion(v, dt);
        if (v.exploded && !before) this.boom(v);
        this.vehicles[i] = v;
        continue;
      }
      const driving = this.player.vehicleId === v.id;
      const def = vehicleById(v.defId);
      if (driving) {
        const axis = this.input.axis();
        const throttle = -axis.y;
        const steer = axis.x;
        const spd = Math.hypot(v.vx, v.vy);
        const hand = this.input.keys.has("Space");
        v.heading += steer * def.handling * (hand ? 2.1 : 1.25) * dt * (0.35 + Math.min(1, spd / 80));
        const acc = throttle * def.acceleration * dt;
        v.vx += Math.cos(v.heading) * acc;
        v.vy += Math.sin(v.heading) * acc;
        const brake = (this.input.keys.has("KeyS") && throttle < 0.05) || hand ? def.braking : 28;
        v.vx -= v.vx * Math.min(1, brake * 0.004 * dt * 60);
        v.vy -= v.vy * Math.min(1, brake * 0.004 * dt * 60);
        const max = def.topSpeed * 0.55 * wet;
        const s = Math.hypot(v.vx, v.vy);
        if (s > max) {
          v.vx *= max / s;
          v.vy *= max / s;
        }
        const nx = v.x + v.vx * dt;
        const ny = v.y + v.vy * dt;
        if (blocked(this.world, nx, ny, 12)) {
          const crash = s > 70;
          v = applyVehicleDamage(v, crash ? 18 + s * 0.08 : 6, crash);
          v.vx *= -0.2;
          v.vy *= -0.2;
          this.shake = this.settings.shake ? 5 : 0;
          if (v.exploded || v.health <= 0) this.flash("ENGINE  ·  she's gonna go");
        } else {
          v.x = nx;
          v.y = ny;
        }
        this.player.x = v.x;
        this.player.y = v.y;
        this.player.heading = v.heading;
        if (s > 40) this.particles.push(pt(v.x - Math.cos(v.heading) * 12, v.y - Math.sin(v.heading) * 12, 0, 0, 0.25, "#3a3028", 3));
      } else if (v.id.startsWith("traffic-") && !v.stolen) {
        const spd = 70 * wet;
        v.vx = Math.cos(v.heading) * spd;
        v.vy = Math.sin(v.heading) * spd;
        const nx = v.x + v.vx * dt;
        const ny = v.y + v.vy * dt;
        if (blocked(this.world, nx, ny, 12) || cellAt(this.world, nx, ny) !== Cell.Road) {
          v.heading += Math.PI / 2;
        } else {
          v.x = nx;
          v.y = ny;
        }
        if (v.x < 0) v.x = MAP_W * TILE - 8;
        if (v.y < 0) v.y = MAP_H * TILE - 8;
        if (v.x > MAP_W * TILE) v.x = 8;
        if (v.y > MAP_H * TILE) v.y = 8;
      }
      if (v.burning) this.particles.push(pt(v.x, v.y, (Math.random() - 0.5) * 10, -20, 0.4, "#e07030", 5));
      this.vehicles[i] = v;
    }
  }

  private updatePeds(dt: number): void {
    const hour = this.time;
    for (const p of this.peds) {
      if (p.kind === "named") continue;
      if (p.panic > 0) {
        p.panic -= dt;
        p.x += Math.cos(p.heading) * 90 * dt;
        p.y += Math.sin(p.heading) * 90 * dt;
        continue;
      }
      const wander = hour > 21 || hour < 5 ? 22 : 38;
      p.heading += (Math.random() - 0.5) * 0.4;
      const nx = p.x + Math.cos(p.heading) * wander * dt;
      const ny = p.y + Math.sin(p.heading) * wander * dt;
      if (!blocked(this.world, nx, ny, 7)) {
        p.x = nx;
        p.y = ny;
      } else p.heading += 1.2;
    }
  }

  private updateCops(dt: number): void {
    const seen = this.cops.some((c) => Math.hypot(c.x - this.player.x, c.y - this.player.y) < 210 && this.lineOpen(c.x, c.y, this.player.x, this.player.y));
    this.heat = tickHeat(this.heat, dt, seen, this.player.x, this.player.y, 0);
    const want = copCountForHeat(this.heat.level);
    while (this.cops.length < want) this.cops.push(this.makeCop());
    while (this.cops.length > want) this.cops.pop();
    for (const c of this.cops) {
      const tx = this.heat.hasLastKnown ? this.heat.lastKnownX : this.player.x;
      const ty = this.heat.hasLastKnown ? this.heat.lastKnownY : this.player.y;
      const ang = Math.atan2(ty - c.y, tx - c.x);
      c.heading = ang;
      const spd = copSpeedForHeat(this.heat.level, true);
      const nx = c.x + Math.cos(ang) * spd * dt;
      const ny = c.y + Math.sin(ang) * spd * dt;
      if (!blocked(this.world, nx, ny, 8)) {
        c.x = nx;
        c.y = ny;
      }
      const d = Math.hypot(c.x - this.player.x, c.y - this.player.y);
      if (this.heat.level >= 2 && d < 190 && this.lastShot > 0.7) {
        if (Math.random() < 0.012) this.spawnBullet(c.x, c.y, this.player.x, this.player.y, false, 0.42);
      }
    }
  }

  private makeCop(): Ped {
    const a = Math.random() * Math.PI * 2;
    const d = 260 + Math.random() * 180;
    return ped(
      `cop-${Math.random().toString(36).slice(2, 7)}`,
      "cop",
      "NSB",
      this.player.x + Math.cos(a) * d,
      this.player.y + Math.sin(a) * d,
      "#1a2430",
      "#d8dde4",
    );
  }

  private updateBullets(dt: number): void {
    this.lastShot += dt;
    const next: Bullet[] = [];
    for (const b of this.bullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (blocked(this.world, b.x, b.y, 2)) {
        this.particles.push(pt(b.x, b.y, 0, 0, 0.2, "#e8dcc8", 2));
        continue;
      }
      if (b.fromPlayer) {
        for (const c of this.cops) {
          if (Math.hypot(c.x - b.x, c.y - b.y) < 12) {
            c.hp -= 34;
            this.raiseHeat(1);
            b.life = 0;
          }
        }
        for (const v of this.vehicles) {
          if (!v.exploded && Math.hypot(v.x - b.x, v.y - b.y) < 16) {
            const nv = applyVehicleDamage(v, 22, false);
            Object.assign(v, nv);
            if (v.health <= 0) this.flash("CAR  ·  fuel tank's punching out");
            b.life = 0;
          }
        }
      } else if (Math.hypot(this.player.x - b.x, this.player.y - b.y) < 12) {
        this.hurt(12);
        b.life = 0;
      }
      if (b.life > 0) next.push(b);
    }
    this.bullets = next;
    this.cops = this.cops.filter((c) => c.hp > 0);
  }

  private updateParticles(dt: number): void {
    this.particles = this.particles.filter((p) => {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      return p.life > 0;
    });
  }

  private tryFire(dt: number): void {
    void dt;
    const firing = this.input.fire || (this.input.aimStick.active && Math.hypot(this.input.aimStick.dx, this.input.aimStick.dy) > 0.35);
    if (!firing || this.player.weapon !== "pistol") return;
    if (this.lastShot < 0.18) return;
    if (this.player.ammo <= 0) {
      this.flash("CLICK  ·  empty");
      this.lastShot = 0.05;
      return;
    }
    this.lastShot = 0;
    this.player.ammo -= 1;
    let tx = this.player.x + Math.cos(this.player.heading) * 80;
    let ty = this.player.y + Math.sin(this.player.heading) * 80;
    if (this.input.aimStick.active) {
      tx = this.player.x + this.input.aimStick.dx * 120;
      ty = this.player.y + this.input.aimStick.dy * 120;
    } else {
      const w = this.worldToScreen(this.player.x, this.player.y);
      tx = this.player.x + (this.input.mx - w.x);
      ty = this.player.y + (this.input.my - w.y);
    }
    this.spawnBullet(this.player.x, this.player.y, tx, ty, true, 1);
    this.audio.gun();
    this.shake = this.settings.shake ? 3 : 0;
    this.raiseHeat(1);
    this.panicNear();
  }

  private spawnBullet(x: number, y: number, tx: number, ty: number, fromPlayer: boolean, acc: number): void {
    const a = Math.atan2(ty - y, tx - x) + (Math.random() - 0.5) * (1 - acc) * 0.5;
    this.bullets.push({
      x,
      y,
      vx: Math.cos(a) * 520,
      vy: Math.sin(a) * 520,
      life: 0.55,
      fromPlayer,
    });
  }

  private tryInteract(): void {
    if (!this.player.vehicleId) {
      const car = this.nearestVehicle(28);
      if (car && !car.exploded) {
        this.player.vehicleId = car.id;
        car.stolen = true;
        this.flash(`WHEELS  ·  ${vehicleById(car.defId).name}`);
        this.audio.uiClick();
        if (this.mission.id === "borrowed-wheels" && car.id === "sparrow-job") this.mission.step = Math.max(this.mission.step, 1);
        return;
      }
    }
    const mark = landmarkAt(this.world, this.player.x, this.player.y);
    const named = this.peds.find((p) => p.kind === "named" && Math.hypot(p.x - this.player.x, p.y - this.player.y) < 36);
    if (named?.talk) {
      const line = named.talk[Math.min(named.talk.length - 1, this.mission.step)] ?? named.talk[0];
      this.say(named.name, line ?? "...");
      if (named.id === "rico" && this.mission.id === "fresh-off-the-bus") this.mission.step = Math.max(this.mission.step, 2);
      if (named.id === "rico" && this.mission.step >= 2 && this.mission.id === "fresh-off-the-bus") this.player.phone = true;
      if (named.id === "maya" && this.mission.id === "borrowed-wheels") this.mission.step = Math.max(this.mission.step, 3);
      return;
    }
    if (mark) this.useLandmark(mark);
  }

  private useLandmark(mark: Landmark): void {
    if (mark.id === "coral-mart") {
      this.robStore();
      return;
    }
    if (mark.id === "jewelry") {
      this.robJewelry();
      return;
    }
    if (mark.id === "warehouse") {
      this.player.crate = true;
      this.mission.crate = true;
      this.flash("CARGO  ·  crate lifted");
      this.raiseHeat(1);
      return;
    }
    if (mark.id === "apartment") {
      this.interior = mark;
      this.player.health = 100;
      this.heat = tickHeat(this.heat, 10, false, this.player.x, this.player.y, 0);
      this.heat.level = 0;
      this.flash("SAFEHOUSE  ·  heat washed, wardrobe later");
      return;
    }
    if (mark.id === "maya-garage") {
      this.interior = mark;
      if (this.player.vehicleId) this.flash("GARAGE  ·  not yours until she papers it");
      return;
    }
    if (mark.id === "gas") {
      const v = this.vehicles.find((c) => c.id === this.player.vehicleId);
      if (v) {
        v.health = vehicleById(v.defId).durability;
        v.burning = false;
        this.player.cash = Math.max(0, this.player.cash - 20);
        this.flash("PUMP  ·  topped off, $20");
      }
      return;
    }
    if (mark.interior) {
      this.interior = mark;
      this.flash(sanitizeText(mark.name, 28));
    }
  }

  private robStore(): void {
    if (this.completed.includes("easy-money") && this.mission.id !== "easy-money") {
      this.flash("CLERK  ·  cameras remember your face");
      this.raiseHeat(1);
      return;
    }
    this.player.cash += 180;
    this.player.weapon = "pistol";
    this.player.ammo = Math.max(this.player.ammo, 24);
    this.raiseHeat(2);
    this.audio.cash();
    this.audio.wanted();
    this.shake = 6;
    this.flash("CORAL MART  ·  till's open  ·  cops incoming, they're slow");
    this.mission.step = Math.max(this.mission.step, 1);
    this.panicNear();
  }

  private robJewelry(): void {
    this.player.cash += 420;
    this.raiseHeat(2);
    this.audio.cash();
    this.flash("SUNSET CASES  ·  glass gone  ·  move");
    if (this.mission.id === "sunset-jewelry") this.mission.step = Math.max(this.mission.step, 3);
    this.panicNear();
  }

  private panicNear(): void {
    for (const p of this.peds) {
      if (p.kind === "named") continue;
      if (Math.hypot(p.x - this.player.x, p.y - this.player.y) < 180) {
        p.panic = 4;
        p.heading = Math.atan2(p.y - this.player.y, p.x - this.player.x);
      }
    }
  }

  private exitVehicle(): void {
    const v = this.vehicles.find((c) => c.id === this.player.vehicleId);
    this.player.vehicleId = null;
    if (v) {
      this.player.x = v.x + Math.cos(v.heading + 1.2) * 18;
      this.player.y = v.y + Math.sin(v.heading + 1.2) * 18;
    }
  }

  private nearestVehicle(r: number): VehicleRuntime | undefined {
    let best: VehicleRuntime | undefined;
    let d = r;
    for (const v of this.vehicles) {
      if (v.exploded) continue;
      const n = Math.hypot(v.x - this.player.x, v.y - this.player.y);
      if (n < d) {
        d = n;
        best = v;
      }
    }
    return best;
  }

  private boom(v: VehicleRuntime): void {
    this.audio.explosion();
    this.shake = this.settings.reduceFlashes ? 4 : 10;
    const r = explosionRadius(v.defId);
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      this.particles.push(pt(v.x, v.y, Math.cos(a) * 90, Math.sin(a) * 90, 0.55, i % 2 ? "#f0b040" : "#d84020", 8));
    }
    if (this.player.vehicleId === v.id) {
      this.exitVehicle();
      this.hurt(28);
    }
    if (Math.hypot(this.player.x - v.x, this.player.y - v.y) < r) this.hurt(18);
    this.raiseHeat(1);
    this.flash("BOOM  ·  wreck stays in the street");
  }

  private raiseHeat(n: number): void {
    const before = this.heat.level;
    this.heat = tickHeat(this.heat, 0, true, this.player.x, this.player.y, n);
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
    this.shake = 4;
  }

  private die(): void {
    this.player.health = 100;
    this.player.x = this.world.spawnX;
    this.player.y = this.world.spawnY;
    this.player.vehicleId = null;
    this.player.cash = Math.max(0, this.player.cash - 80);
    this.player.crate = false;
    this.heat = createHeatState();
    this.flash("COUNTY  ·  $80 medical  ·  street cash lighter");
  }

  private updateMissions(): void {
    const m = nextMission(this.completed);
    if (m && m.id !== this.mission.id && this.completed.includes(this.mission.id)) {
      this.mission = { id: m.id, step: 0, raceHits: 0, crate: false };
    }
    if (this.mission.id === "fresh-off-the-bus") {
      const rico = landmarkAt(this.world, this.player.x, this.player.y, 70);
      if (rico?.id === "rico-hideout") this.mission.step = Math.max(this.mission.step, 1);
      if (this.mission.step >= 2) this.complete("fresh-off-the-bus");
    }
    if (this.mission.id === "borrowed-wheels") {
      const maya = landmarkAt(this.world, this.player.x, this.player.y, 60);
      if (this.player.vehicleId === "sparrow-job" && maya?.id === "maya-garage") this.mission.step = Math.max(this.mission.step, 2);
      if (this.mission.step >= 3) this.complete("borrowed-wheels");
    }
    if (this.mission.id === "easy-money") {
      if (this.mission.step >= 1 && this.heat.level === 0) this.complete("easy-money");
    }
    if (this.mission.id === "midnight-run") {
      const cp = RACE_CPS[this.mission.raceHits];
      if (cp && Math.hypot(this.player.x - cp.x, this.player.y - cp.y) < 48) {
        this.mission.raceHits += 1;
        this.flash(`CHECKPOINT  ${this.mission.raceHits}/${RACE_CPS.length}`);
      }
      if (this.mission.raceHits >= RACE_CPS.length) this.complete("midnight-run");
    }
    if (this.mission.id === "port-authority") {
      if (this.player.crate) this.mission.step = Math.max(this.mission.step, 2);
      const rico = landmarkAt(this.world, this.player.x, this.player.y, 50);
      if (this.player.crate && rico?.id === "rico-hideout") {
        this.player.crate = false;
        this.complete("port-authority");
      }
    }
    if (this.mission.id === "sunset-jewelry") {
      const jew = landmarkAt(this.world, this.player.x, this.player.y, 50);
      if (jew?.id === "jewelry") this.mission.step = Math.max(this.mission.step, 1);
      if (this.player.vehicleId) this.mission.step = Math.max(this.mission.step, 2);
      const home = landmarkAt(this.world, this.player.x, this.player.y, 50);
      if (this.mission.step >= 3 && home?.id === "apartment") this.complete("sunset-jewelry");
    }
  }

  private complete(id: string): void {
    if (this.completed.includes(id)) return;
    const def = [...MISSIONS, HEIST_SUNSET].find((m) => m.id === id);
    if (!def) return;
    this.completed.push(id);
    const r = applyReward(this.player.cash, this.player.xp, this.player.streetRep, def);
    this.player.cash = r.cash;
    this.player.xp = r.xp;
    this.player.streetRep = r.streetRep;
    this.audio.cash();
    this.flash(`JOB DONE  ·  ${def.title}  ·  $${def.cash}`);
    this.onMissionComplete?.(id);
    const n = nextMission(this.completed);
    this.mission = { id: n?.id ?? id, step: 0, raceHits: 0, crate: false };
    this.onPersist?.(this.snapshot());
  }

  private lineOpen(x0: number, y0: number, x1: number, y1: number): boolean {
    const steps = 8;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (blocked(this.world, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 2)) return false;
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

  private hud(): HudSnapshot {
    const def = [...MISSIONS, HEIST_SUNSET].find((m) => m.id === this.mission.id);
    const obj = def?.objectives[Math.min(this.mission.step, def.objectives.length - 1)]?.label ?? "Explore Southside";
    const mark = landmarkAt(this.world, this.player.x, this.player.y);
    const car = this.nearestVehicle(28);
    let prompt = "";
    if (!this.player.vehicleId && car) prompt = `E  ·  ${car.exploded ? "WRECK" : "DRIVE"} ${vehicleById(car.defId).name}`;
    else if (this.player.vehicleId) prompt = "E  ·  EXIT";
    else if (mark) prompt = `E  ·  ${mark.name}`;
    const v = this.vehicles.find((c) => c.id === this.player.vehicleId);
    return {
      cash: this.player.cash,
      bank: this.player.bank,
      heat: this.heat.level,
      health: this.player.health,
      armor: this.player.armor,
      xp: this.player.xp,
      level: Math.max(1, Math.floor(1 + Math.sqrt(this.player.xp / 180))),
      streetRep: this.player.streetRep,
      objective: sanitizeText(obj, 64),
      prompt: sanitizeText(prompt, 48),
      assist: assistHint(this.heat.level, this.heat.hiddenTimer, hideSpotNear(this.world, this.player.x, this.player.y)),
      station: this.audio.stationLabel(),
      musicOn: this.audio.playing,
      wantedFlash: this.heat.level >= 3,
      dayLabel: this.time < 6 ? "DAWN" : this.time < 11 ? "MORNING" : this.time < 17 ? "DAY" : this.time < 20 ? "DUSK" : "NIGHT",
      weather: this.weather,
      inVehicle: Boolean(this.player.vehicleId),
      vehicleHp: v ? Math.round((v.health / vehicleById(v.defId).durability) * 100) : 100,
      dialogue: this.dialogue,
      toast: this.toast,
      phoneOpen: this.player.phone,
      interior: this.interior ? sanitizeText(this.interior.name, 28) : null,
      username: this.username,
      others: this.remotes.length,
      lockpick: null,
      jailLeft: 0,
      news: "",
      lootValue: 0,
      searchZone: false,
      gamepad: false,
      contractLine: "",
      weapon: this.player.weapon === "pistol" ? "Street Pistol" : "Fists",
      ammo: this.player.ammo,
      raceBestMs: 0,
      waypointBearing: null,
    };
  }

  private worldToScreen(x: number, y: number): { x: number; y: number } {
    return { x: x - this.camX, y: y - this.camY };
  }

  private draw(): void {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const ctx = this.ctx;
    const v = this.vehicles.find((c) => c.id === this.player.vehicleId);
    const spd = v ? Math.hypot(v.vx, v.vy) : 0;
    const zoom = 1 + Math.min(0.12, spd / 900);
    this.camX = this.player.x - w / (2 * zoom);
    this.camY = this.player.y - h / (2 * zoom);
    if (this.shake && this.settings.shake) {
      this.camX += (Math.random() - 0.5) * this.shake;
      this.camY += (Math.random() - 0.5) * this.shake;
    }

    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = skyColor(this.time);
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.scale(zoom, zoom);
    ctx.translate(-this.camX, -this.camY);
    this.drawTiles(w, h);
    this.drawLandmarks();
    for (const p of this.particles) this.drawParticle(p);
    for (const car of this.vehicles) this.drawCar(car);
    for (const p of this.peds) this.drawPed(p, false);
    for (const c of this.cops) this.drawPed(c, true);
    for (const r of this.remotes) this.drawRemote(r);
    if (!this.player.vehicleId) this.drawPlayer();
    for (const b of this.bullets) {
      ctx.fillStyle = "#f3e6d2";
      ctx.fillRect(b.x - 2, b.y - 2, 4, 4);
    }
    if (this.weather === "rain") this.drawRain();
    ctx.restore();

    this.drawHudChrome(w, h);
    if (this.interior) this.drawInterior(w, h);
  }

  private drawTiles(viewW: number, viewH: number): void {
    const ctx = this.ctx;
    const x0 = Math.max(0, Math.floor(this.camX / TILE_SIZE) - 1);
    const y0 = Math.max(0, Math.floor(this.camY / TILE_SIZE) - 1);
    const x1 = Math.min(MAP_W, x0 + Math.ceil(viewW / TILE_SIZE) + 3);
    const y1 = Math.min(MAP_H, y0 + Math.ceil(viewH / TILE_SIZE) + 3);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const c = this.world.cells[y * MAP_W + x] as Cell;
        const px = x * TILE_SIZE;
        const py = y * TILE_SIZE;
        ctx.fillStyle = tileColor(c, x, y, this.time);
        ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
        if (c === Cell.Road && y % 12 < 3 && x % 2 === 0) {
          ctx.fillStyle = "#c4b48a";
          ctx.fillRect(px + 14, py + 14, 6, 2);
        }
        if (c === Cell.Walk) {
          ctx.fillStyle = "#8a7a68";
          ctx.fillRect(px + 2, py + 2, 2, 2);
        }
      }
    }
  }

  private drawLandmarks(): void {
    const ctx = this.ctx;
    for (const m of this.world.landmarks) {
      const px = m.x * TILE;
      const py = m.y * TILE;
      ctx.fillStyle = buildingColor(m.kind, this.time);
      ctx.fillRect(px + 4, py + 4, m.w * TILE - 8, m.h * TILE - 16);
      ctx.fillStyle = "#1a1410";
      ctx.fillRect(px + 8, py + 10, 6, 8);
      ctx.fillRect(px + 18, py + 10, 6, 8);
      ctx.fillStyle = "#3a2418";
      ctx.fillRect(m.doorX * TILE + 8, m.doorY * TILE - 10, 10, 16);
      ctx.fillStyle = "#f3e6d2";
      ctx.font = "10px monospace";
      ctx.fillText(m.name, px + 6, py + 2);
    }
  }

  private drawCar(v: VehicleRuntime): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(v.x, v.y);
    ctx.rotate(v.heading);
    if (v.exploded) {
      ctx.fillStyle = "#2a1c14";
      ctx.fillRect(-14, -8, 28, 16);
      ctx.fillStyle = "#4a2a18";
      ctx.fillRect(-8, -6, 10, 8);
      ctx.restore();
      return;
    }
    ctx.fillStyle = v.color;
    ctx.fillRect(-16, -9, 32, 18);
    ctx.fillStyle = "#1a1c20";
    ctx.fillRect(2, -7, 10, 14);
    ctx.fillStyle = v.health < 40 ? "#3a2010" : "#2a3038";
    ctx.fillRect(-6, -6, 8, 12);
    ctx.fillStyle = "#f2e6c0";
    ctx.fillRect(14, -7, 3, 5);
    ctx.fillRect(14, 2, 3, 5);
    ctx.fillStyle = "#c43020";
    ctx.fillRect(-16, -6, 2, 4);
    ctx.fillRect(-16, 2, 2, 4);
    if (v.burning) {
      ctx.fillStyle = "#f07820";
      ctx.fillRect(-4, -12, 5, 6);
    }
    ctx.restore();
  }

  private drawPed(p: Ped, cop: boolean): void {
    const ctx = this.ctx;
    ctx.fillStyle = "#1a1210";
    ctx.fillRect(p.x - 5, p.y + 6, 10, 3);
    ctx.fillStyle = p.shirt;
    ctx.fillRect(p.x - 5, p.y - 4, 10, 10);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - 4, p.y - 12, 8, 8);
    if (cop) {
      ctx.fillStyle = "#d8e4f0";
      ctx.fillRect(p.x - 5, p.y - 14, 10, 3);
    }
    if (p.kind === "named") {
      ctx.fillStyle = "#f3e6d2";
      ctx.font = "9px monospace";
      ctx.fillText(p.name, p.x - 16, p.y - 16);
    }
  }

  private drawPlayer(): void {
    const ctx = this.ctx;
    const p = this.player;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.heading);
    ctx.fillStyle = "#1a1210";
    ctx.fillRect(-5, 6, 10, 3);
    ctx.fillStyle = "#c45a32";
    ctx.fillRect(-5, -4, 10, 10);
    ctx.fillStyle = "#e6c39a";
    ctx.fillRect(-4, -12, 8, 8);
    ctx.fillStyle = "#2a2018";
    ctx.fillRect(-4, -14, 8, 3);
    ctx.restore();
  }

  private drawRemote(r: Remote): void {
    const ctx = this.ctx;
    ctx.fillStyle = "#5aa0c4";
    ctx.fillRect(r.x - 5, r.y - 4, 10, 10);
    ctx.fillStyle = "#f3e6d2";
    ctx.font = "9px monospace";
    if (this.settings.showNames !== "hide") ctx.fillText(r.username || "player", r.x - 14, r.y - 12);
  }

  private drawParticle(p: Particle): void {
    const a = Math.max(0, p.life / p.max);
    this.ctx.fillStyle = p.color;
    this.ctx.globalAlpha = a;
    this.ctx.fillRect(p.x, p.y, p.size, p.size);
    this.ctx.globalAlpha = 1;
  }

  private drawRain(): void {
    const ctx = this.ctx;
    ctx.strokeStyle = "rgba(210,220,230,0.28)";
    const x0 = this.camX;
    const y0 = this.camY;
    for (let i = 0; i < 80; i++) {
      const x = x0 + ((i * 73 + this.time * 800) % 900);
      const y = y0 + ((i * 47 + this.time * 1400) % 700);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 3, y + 10);
      ctx.stroke();
    }
  }

  private drawHudChrome(w: number, h: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(20,14,10,0.55)";
    ctx.fillRect(14, h - 92, 132, 78);
    this.drawMinimap(22, h - 84, 116);
  }

  private drawMinimap(x: number, y: number, s: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = "#241c16";
    ctx.fillRect(x, y, s, s);
    const scale = s / (MAP_W * TILE);
    ctx.fillStyle = "#c45a32";
    ctx.fillRect(x + this.player.x * scale - 2, y + this.player.y * scale - 2, 4, 4);
    ctx.fillStyle = "#6aa0d4";
    for (const c of this.cops) ctx.fillRect(x + c.x * scale - 1, y + c.y * scale - 1, 2, 2);
    ctx.fillStyle = "#e6c39a";
    for (const r of this.remotes) ctx.fillRect(x + r.x * scale - 1, y + r.y * scale - 1, 2, 2);
  }

  private drawInterior(w: number, h: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(18,12,10,0.88)";
    ctx.fillRect(w * 0.18, h * 0.16, w * 0.64, h * 0.58);
    ctx.strokeStyle = "#c45a32";
    ctx.strokeRect(w * 0.18, h * 0.16, w * 0.64, h * 0.58);
    ctx.fillStyle = "#f3e6d2";
    ctx.font = "20px sans-serif";
    ctx.fillText(this.interior?.name ?? "INTERIOR", w * 0.22, h * 0.24);
    ctx.font = "13px sans-serif";
    ctx.fillStyle = "#c4b49a";
    ctx.fillText("Wardrobe  ·  locker  ·  trophies  ·  E to leave", w * 0.22, h * 0.3);
    if (this.input.consumeInteract()) this.interior = null;
  }
}

function ped(
  id: string,
  kind: PedKind,
  name: string,
  x: number,
  y: number,
  color: string,
  shirt: string,
  talk?: string[],
): Ped {
  return { id, kind, name, x, y, heading: Math.random() * 6, speed: 30, color, shirt, panic: 0, hp: kind === "cop" ? 60 : 30, talk };
}

function pt(x: number, y: number, vx: number, vy: number, life: number, color: string, size: number): Particle {
  return { x, y, vx, vy, life, max: life, color, size };
}

function skyColor(t: number): string {
  if (t < 6) return "#1a1520";
  if (t < 8) return "#c46a48";
  if (t < 17) return "#7eafc2";
  if (t < 19.5) return "#d4784a";
  return "#141018";
}

function tileColor(c: Cell, x: number, y: number, t: number): string {
  const dusk = t > 18 || t < 6;
  switch (c) {
    case Cell.Dirt:
      return (x + y) % 2 ? "#5a4030" : "#4a3628";
    case Cell.Road:
      return dusk ? "#2a2624" : "#35302c";
    case Cell.Walk:
      return "#6a5a4a";
    case Cell.Building:
      return "#3a2a26";
    case Cell.Grass:
      return "#2f4a34";
    case Cell.Water:
      return dusk ? "#1a2a38" : "#2a5a68";
    case Cell.Sand:
      return "#c4a070";
    case Cell.Alley:
      return "#2a221c";
    case Cell.Court:
      return "#8a5a32";
    case Cell.Dock:
      return "#4a4034";
    default: {
      const _n: never = c;
      return _n;
    }
  }
}

function buildingColor(kind: Landmark["kind"], t: number): string {
  const night = t > 19 || t < 6;
  switch (kind) {
    case "apartment":
      return night ? "#5a3a32" : "#8a5344";
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
      return night ? "#4a3040" : "#7a4a58";
    case "bank":
      return "#3a4048";
    default: {
      const _n: never = kind;
      return _n;
    }
  }
}
