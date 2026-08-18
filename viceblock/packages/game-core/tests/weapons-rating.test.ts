import { describe, expect, it } from "vitest";
import { missionRating, raceResult, WEAPONS, weaponById, weaponDps } from "../src";

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
