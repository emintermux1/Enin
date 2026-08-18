import { describe, expect, it } from "vitest";
import { applyReward, claimMission, spend, startingCash } from "../src/economy";

describe("economy", () => {
  it("guest starts with 500", () => {
    expect(startingCash()).toBe(500);
  });

  it("applies mission rewards without trusting negatives as drains", () => {
    const r = applyReward(500, 0, 0, { cash: 220, xp: 70, streetRep: 8 });
    expect(r.cash).toBe(720);
    expect(r.xp).toBe(70);
    expect(r.streetRep).toBe(8);
  });

  it("rejects duplicate mission claims", () => {
    const first = claimMission([], "easy-money");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = claimMission(first.completed, "easy-money");
    expect(second.ok).toBe(false);
  });

  it("blocks unaffordable spend", () => {
    expect(spend(10, 25)).toBeNull();
    expect(spend(40, 25)).toBe(15);
  });
});
