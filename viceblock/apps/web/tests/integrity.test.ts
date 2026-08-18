import { describe, expect, it } from "vitest";
import { generateContract } from "@viceblock/game-core";
import {
  activeContractSeed,
  applyAuthoritativeReward,
  auditTail,
  completeContract,
  createGuest,
  issueContract,
  resetStoreForTests,
  sessionPlayer,
} from "../lib/store";

describe("save integrity across restart", () => {
  it("player keeps exactly the rewarded balance after a simulated server restart", () => {
    const { player, token } = createGuest("integrity");
    applyAuthoritativeReward(player.id, 1000, 0, 0, "test", "integrity-1");
    // Simulated crash + restart: memory wiped, state reloaded from disk.
    resetStoreForTests();
    const reloaded = sessionPlayer(token);
    expect(reloaded?.cash).toBe(500 + 1000);
  });
});

describe("contract idempotency", () => {
  it("issues one active contract and pays exactly once", () => {
    const { player } = createGuest("contractor");
    const c1 = issueContract(player.id);
    const c2 = issueContract(player.id);
    expect(c1?.id).toBe(c2?.id);

    const active = activeContractSeed(player.id);
    expect(active).not.toBeNull();
    const def = generateContract(active!.seed);

    expect(completeContract(player.id, active!.id, def.reward, def.xp, def.rep)).toBe(true);
    // Replay: same contract id must be rejected, no double credit.
    expect(completeContract(player.id, active!.id, def.reward, def.xp, def.rep)).toBe(false);

    const p = sessionPlayer("");
    void p;
  });

  it("rejects a forged contract id", () => {
    const { player } = createGuest("forger");
    issueContract(player.id);
    expect(completeContract(player.id, "ct-forged", 99999, 0, 0)).toBe(false);
  });
});

describe("audit log", () => {
  it("records every reward with reason and reference", () => {
    const { player } = createGuest("auditee");
    applyAuthoritativeReward(player.id, 42, 1, 1, "test-reason", "ref-abc");
    const tail = auditTail(10);
    const entry = tail.find((e) => e.playerId === player.id && e.ref === "ref-abc");
    expect(entry).toBeDefined();
    expect(entry?.amount).toBe(42);
    expect(entry?.reason).toBe("test-reason");
  });
});
