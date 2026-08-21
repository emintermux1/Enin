import { describe, expect, it } from "vitest";
import { POLICE_CONFIG } from "../src/config";
import { assistHint, copCountForHeat, createHeatState, tickHeat } from "../src/heat";

describe("heat — easy pursuit", () => {
  it("starts at zero", () => {
    expect(createHeatState().level).toBe(0);
  });

  it("crime raises heat by the report amount", () => {
    const h = tickHeat(createHeatState(), 0.016, false, 10, 10, 1);
    expect(h.level).toBe(1);
  });

  it("drops a star after a short hide window at heat 1-2", () => {
    let h = tickHeat(createHeatState(), 0.016, false, 0, 0, 1);
    h = tickHeat(h, 3.3, false, 0, 0, 0);
    expect(h.level).toBe(0);
  });

  it("does not escalate instantly while seen", () => {
    let h = tickHeat(createHeatState(), 0, true, 0, 0, 1);
    h = tickHeat(h, 4, true, 0, 0, 0);
    expect(h.level).toBe(1);
  });

  it("escalates a runner who stays in sight", () => {
    let h = tickHeat(createHeatState(), 0, true, 0, 0, 1);
    h = tickHeat(h, 15, true, 0, 0, 0, "", true);
    expect(h.level).toBe(2);
  });

  it("does not escalate a player who is standing still and taking the arrest", () => {
    let h = tickHeat(createHeatState(), 0, true, 0, 0, 1);
    for (let i = 0; i < 10; i++) h = tickHeat(h, 15, true, 0, 0, 0, "", false);
    expect(h.level).toBe(1);
  });

  it("spawns few cops on low heat", () => {
    expect(copCountForHeat(1)).toBe(1);
    expect(copCountForHeat(2)).toBe(2);
  });

  it("gives assist copy when hiding", () => {
    expect(assistHint(2, 2, false)).toMatch(/heat dropping/i);
  });

  it("takes its cooling and escalation timings from the police tuning, not its own copies", () => {
    // These numbers were written out twice, so retuning the config moved
    // nothing. Nudging the config here must move the behaviour with it.
    const justUnder = POLICE_CONFIG.loseSightSeconds[1] - 0.1;
    let h = tickHeat(createHeatState(), 0.016, false, 0, 0, 1);
    expect(tickHeat(h, justUnder, false, 0, 0, 0).level).toBe(1);
    expect(tickHeat(h, justUnder + 0.2, false, 0, 0, 0).level).toBe(0);

    // Committed out of sight, so the seen clock starts from nothing.
    h = tickHeat(createHeatState(), 0, false, 0, 0, 1);
    expect(h.seenTimer).toBe(0);
    expect(tickHeat(h, POLICE_CONFIG.escalateAfterSeenSeconds - 0.1, true, 0, 0, 0, "", true).level).toBe(1);
    expect(tickHeat(h, POLICE_CONFIG.escalateAfterSeenSeconds + 0.1, true, 0, 0, 0, "", true).level).toBe(2);
  });

  it("stops escalating itself at the level the config caps it to", () => {
    let h = tickHeat(createHeatState(), 0, true, 0, 0, 1);
    for (let i = 0; i < 40; i++) h = tickHeat(h, POLICE_CONFIG.escalateAfterSeenSeconds + 1, true, 0, 0, 0, "", true);
    expect(h.level).toBe(POLICE_CONFIG.maxAutoEscalateLevel);
  });
});
