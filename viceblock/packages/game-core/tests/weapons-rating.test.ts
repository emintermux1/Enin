import { describe, expect, it } from "vitest";
import { AIM_CONFIG, missionRating, raceResult, reloadAmount, WEAPONS, weaponById, weaponDps } from "../src";

describe("weapons", () => {
  it("no weapon dominates: smg wins dps, pistol wins range and accuracy", () => {
    const pistol = weaponById("pistol");
    const smg = weaponById("smg");
    expect(weaponDps(smg)).toBeGreaterThan(weaponDps(pistol));
    expect(pistol.range).toBeGreaterThan(smg.range);
    expect(pistol.spread).toBeLessThan(smg.spread);
  });

  it("fists are silent and short-range", () => {
    const fists = weaponById("fists");
    expect(fists.noiseRadius).toBe(0);
    expect(fists.range).toBeLessThan(40);
  });

  it("all weapons have positive damage and intervals", () => {
    for (const w of WEAPONS) {
      expect(w.damage).toBeGreaterThan(0);
      expect(w.fireInterval).toBeGreaterThan(0);
    }
  });

  it("every gun holds a magazine and kicks; fists do neither", () => {
    expect(weaponById("fists").magazine).toBe(0);
    expect(weaponById("fists").recoil).toBe(0);
    for (const w of WEAPONS.filter((x) => x.id !== "fists")) {
      expect(w.magazine).toBeGreaterThan(0);
      expect(w.reloadSeconds).toBeGreaterThan(0);
      expect(w.recoil).toBeGreaterThan(0);
    }
  });

  it("the pistol kicks harder per shot but the smg walks further per second", () => {
    const pistol = weaponById("pistol");
    const smg = weaponById("smg");
    expect(pistol.recoil).toBeGreaterThan(smg.recoil);
    expect(smg.recoil / smg.fireInterval).toBeGreaterThan(pistol.recoil / pistol.fireInterval);
  });
});

describe("reloading", () => {
  it("fills the magazine from reserve", () => {
    expect(reloadAmount(12, 0, 40)).toBe(12);
    expect(reloadAmount(12, 5, 40)).toBe(7);
  });

  it("never takes more than the reserve holds", () => {
    expect(reloadAmount(30, 0, 4)).toBe(4);
    expect(reloadAmount(30, 0, 0)).toBe(0);
  });

  it("a full magazine needs nothing, and cannot go negative", () => {
    expect(reloadAmount(12, 12, 40)).toBe(0);
    expect(reloadAmount(12, 15, 40)).toBe(0);
  });

  it("aiming tightens the group and slows the walk", () => {
    expect(AIM_CONFIG.spreadScale).toBeLessThan(1);
    expect(AIM_CONFIG.moveScale).toBeLessThan(1);
    expect(weaponById("smg").spread * AIM_CONFIG.spreadScale).toBeLessThan(weaponById("smg").spread);
  });
});

describe("mission rating", () => {
  it("perfect run ranks S", () => {
    expect(missionRating(60, 120, 0, 0)).toBe("S");
  });

  it("slow damaged high-heat run ranks C", () => {
    expect(missionRating(400, 120, 80, 4)).toBe("C");
  });

  it("middle runs rank between", () => {
    const r = missionRating(150, 120, 20, 2);
    expect(["A", "B"]).toContain(r);
  });

  it("race payouts scale with time", () => {
    expect(raceResult(45).rank).toBe("S");
    expect(raceResult(45).cash).toBeGreaterThan(raceResult(120).cash);
    expect(raceResult(120).rank).toBe("C");
  });
});
