import { describe, expect, it } from "vitest";
import { applyAuthoritativeReward, claimServerMission, consumeNonce, createGuest, issueNonce } from "../lib/store";

describe("session + rewards", () => {
  it("creates a guest with 500 cash", () => {
    const { player, token } = createGuest("rico-fan");
    expect(token.length).toBeGreaterThan(10);
    expect(player.cash).toBe(500);
    expect(player.guest).toBe(true);
  });

  it("rejects duplicate mission claims", () => {
    const { player } = createGuest("double");
    expect(claimServerMission(player.id, "easy-money")).toBe(true);
    expect(claimServerMission(player.id, "easy-money")).toBe(false);
  });

  it("applies server cash only as integers", () => {
    const { player } = createGuest("bank");
    const next = applyAuthoritativeReward(player.id, 220, 70, 8);
    expect(next?.cash).toBe(720);
  });
});

describe("wallet nonce", () => {
  it("cannot be reused", () => {
    const rec = issueNonce("FakeWalletAddress111111111111111111111111");
    expect(consumeNonce(rec.address, rec.nonce)).toBe(true);
    expect(consumeNonce(rec.address, rec.nonce)).toBe(false);
  });
});
