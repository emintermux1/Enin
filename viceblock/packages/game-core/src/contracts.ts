/**
 * Replayable contracts: hand-authored templates with randomized parameters.
 * The server generates and validates them; the client only renders steps.
 */
export type ContractType = "recovery" | "delivery" | "cargo-theft";

export interface ContractDef {
  id: string;
  type: ContractType;
  title: string;
  brief: string;
  /** Landmark ids in the Southside world where the steps happen. */
  pickupLandmark: string;
  dropLandmark: string;
  reward: number;
  xp: number;
  rep: number;
  /** Seconds allowed; 0 = untimed. */
  timeLimit: number;
}

/** Southside landmark ids where the steps happen. */
const PICKUPS = ["jewelry", "warehouse", "gas"] as const;
const DROPS = ["maya-garage", "secret-bunker", "apartment"] as const;

const LANDMARK_NAMES: Record<string, string> = {
  jewelry: "Sunset Cases",
  warehouse: "Pier 9",
  gas: "Red Pump",
  "maya-garage": "Maya's Garage",
  "secret-bunker": "the Painted Door",
  apartment: "the walk-up",
};

interface Template {
  type: ContractType;
  title: string;
  brief: string;
  baseReward: number;
  xp: number;
  rep: number;
  timeLimit: number;
}

const TEMPLATES: Template[] = [
  {
    type: "recovery",
    title: "Repo Run",
    brief: "A client wants their car back. Grab any ride near {pickup} and park it at {drop}.",
    baseReward: 220,
    xp: 60,
    rep: 4,
    timeLimit: 0,
  },
  {
    type: "delivery",
    title: "No Questions Asked",
    brief: "Pick up a package at {pickup} and drop it at {drop}. Don't open it.",
    baseReward: 180,
    xp: 50,
    rep: 3,
    timeLimit: 150,
  },
  {
    type: "cargo-theft",
    title: "Dock Skim",
    brief: "Lift the marked cargo near {pickup}, lose any attention, fence it at {drop}.",
    baseReward: 300,
    xp: 80,
    rep: 6,
    timeLimit: 0,
  },
];

function pick<T>(arr: readonly T[], roll: number): T {
  return arr[Math.floor(roll * arr.length) % arr.length];
}

export function generateContract(seed: number): ContractDef {
  const r1 = fract(seed * 12.9898);
  const r2 = fract(seed * 78.233);
  const r3 = fract(seed * 43.31);
  const tpl = pick(TEMPLATES, r1);
  const pickup = pick(PICKUPS, r2);
  const drop = pick(DROPS, r3);
  const bonus = Math.round(r3 * 80);
  return {
    id: `ct-${Math.floor(seed * 1e9).toString(36)}`,
    type: tpl.type,
    title: tpl.title,
    brief: tpl.brief.replace("{pickup}", LANDMARK_NAMES[pickup] ?? pickup).replace("{drop}", LANDMARK_NAMES[drop] ?? drop),
    pickupLandmark: pickup,
    dropLandmark: drop,
    reward: tpl.baseReward + bonus,
    xp: tpl.xp,
    rep: tpl.rep,
    timeLimit: tpl.timeLimit,
  };
}

function fract(n: number): number {
  return n - Math.floor(n);
}
