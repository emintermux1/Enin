import { describe, expect, it } from "vitest";
import {
  attemptPick,
  createLockpick,
  tickLockpick,
  witnessReport,
  fenceValue,
  fenceRate,
  generateContract,
  pickEvent,
  tickDirector,
  createDirector,
  createHeatState,
  tickHeat,
  recognitionRange,
  createVehicleRuntime,
  applyVehicleDamage,
  shootTire,
  damageStage,
  performanceMultipliers,
  surfaceGrip,
  WORLD_EVENTS,
} from "../src";
import type { WorldEventId } from "../src";

describe("lockpick", () => {
  it("succeeds when the marker is inside the sweet zone", () => {
    let s = createLockpick("lock", 0.5);
    s = { ...s, pos: (s.zoneStart + s.zoneEnd) / 2 };
    const done = attemptPick(s, true);
    expect(done.done).toBe(true);
    expect(done.success).toBe(true);
    expect(done.alarmed).toBe(false);
  });

  it("burns picks on misses and alarms when they run out", () => {
    let s = createLockpick("immobilizer", 0.5);
    s = { ...s, pos: 0 };
    s = attemptPick(s, true);
    expect(s.done).toBe(false);
    expect(s.picksLeft).toBe(1);
    s = attemptPick(s, true);
    expect(s.done).toBe(true);
    expect(s.success).toBe(false);
    expect(s.alarmed).toBe(true);
  });

  it("marker bounces between 0 and 1", () => {
    let s = createLockpick("gps", 0.3);
    for (let i = 0; i < 500; i++) {
      s = tickLockpick(s, 0.016);
      expect(s.pos).toBeGreaterThanOrEqual(0);
      expect(s.pos).toBeLessThanOrEqual(1);
    }
  });
});

describe("witnesses", () => {
  it("no witnesses, no cop: crime goes unreported", () => {
    const r = witnessReport("car-theft", 0, false, 0.01);
    expect(r.reported).toBe(false);
    expect(r.heatAdd).toBe(0);
  });

  it("cop sight is instant and full severity", () => {
    const r = witnessReport("robbery", 0, true, 0.99);
    expect(r.reported).toBe(true);
    expect(r.delay).toBe(0);
    expect(r.heatAdd).toBe(2);
  });

  it("civilian reports come with a dialing delay", () => {
    const r = witnessReport("robbery", 4, false, 0.1);
    expect(r.reported).toBe(true);
    expect(r.delay).toBeGreaterThanOrEqual(2.5);
  });

  it("a big crowd almost always reports", () => {
    const r = witnessReport("gunfire", 10, false, 0.9);
    expect(r.reported).toBe(true);
  });
});

describe("fence", () => {
  it("pays below face value and improves with rep", () => {
    const items = [
      { origin: "store-robbery" as const, value: 100 },
      { origin: "jewelry" as const, value: 300 },
    ];
    expect(fenceValue(items, 0)).toBe(272);
    expect(fenceRate(6)).toBeGreaterThan(fenceRate(0));
    expect(fenceRate(99)).toBeLessThanOrEqual(0.92);
  });
});

describe("contracts", () => {
  it("generates deterministic contracts from a seed", () => {
    const a = generateContract(0.123);
    const b = generateContract(0.123);
    expect(a).toEqual(b);
    expect(a.reward).toBeGreaterThan(0);
    expect(a.pickupLandmark).not.toBe(a.dropLandmark);
  });

  it("varies with different seeds", () => {
    const ids = new Set(Array.from({ length: 30 }, (_, i) => generateContract(0.017 * (i + 1)).id));
    expect(ids.size).toBeGreaterThan(10);
  });
});

describe("director", () => {
  it("never repeats an event within the block window", () => {
    const history: WorldEventId[] = ["blackout", "storm", "rare-car"];
    for (let roll = 0.01; roll < 1; roll += 0.05) {
      const e = pickEvent(history, roll);
      expect(e).not.toBeNull();
      expect(["blackout", "storm", "rare-car"]).not.toContain(e?.id);
    }
  });

  it("fires after cooldown and tracks history", () => {
    let d = createDirector();
    let fired = null;
    for (let i = 0; i < 600 && !fired; i++) {
      const r = tickDirector(d, 0.5, 0.4);
      d = r.state;
      fired = r.fired;
    }
    expect(fired).not.toBeNull();
    expect(d.active).toBe(fired?.id);
    expect(d.history).toContain(fired?.id);
  });

  it("all events have positive weights and durations", () => {
    for (const e of WORLD_EVENTS) {
      expect(e.weight).toBeGreaterThan(0);
      expect(e.duration).toBeGreaterThan(0);
    }
  });
});

describe("suspect memory", () => {
  it("records the getaway vehicle and shrinks recognition after a swap", () => {
    let h = createHeatState();
    h = tickHeat(h, 0.016, false, 10, 10, 2, "sparrow");
    expect(h.knownVehicle).toBe("sparrow");
    expect(recognitionRange(h, "sparrow", 100)).toBe(100);
    expect(recognitionRange(h, "mirage", 100)).toBeLessThan(50);
  });

  it("search radius grows while hidden and resets at heat 0", () => {
    let h = createHeatState();
    h = tickHeat(h, 0.016, false, 0, 0, 1, "");
    const r0 = h.searchRadius;
    h = tickHeat(h, 2, false, 0, 0, 0, "");
    expect(h.searchRadius).toBeGreaterThan(r0);
    for (let i = 0; i < 40; i++) h = tickHeat(h, 1, false, 0, 0, 0, "");
    expect(h.level).toBe(0);
    expect(h.searchRadius).toBe(0);
    expect(h.knownVehicle).toBe("");
  });
});

describe("vehicle components", () => {
  it("damage stages progress with health", () => {
    let v = createVehicleRuntime("sparrow", 0, 0, 0, "#fff");
    expect(damageStage(v)).toBe(0);
    v = applyVehicleDamage(v, 50, false);
    expect(damageStage(v)).toBe(1);
    v = applyVehicleDamage(v, 40, false);
    expect(damageStage(v)).toBe(2);
  });

  it("engine damage reduces acceleration, tire hits reduce grip", () => {
    let v = createVehicleRuntime("ironback", 0, 0, 0, "#fff");
    const before = performanceMultipliers(v);
    v = applyVehicleDamage(v, 60, false);
    v = shootTire(v);
    const after = performanceMultipliers(v);
    expect(after.accel).toBeLessThan(before.accel);
    expect(after.grip).toBeLessThan(before.grip);
  });

  it("wet asphalt grips less than dry", () => {
    expect(surfaceGrip("wet-asphalt")).toBeLessThan(surfaceGrip("asphalt"));
    expect(surfaceGrip("sand")).toBeLessThan(surfaceGrip("grass"));
  });
});
