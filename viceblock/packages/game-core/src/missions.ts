import type { MissionDef } from "@viceblock/shared";

export const MISSIONS: MissionDef[] = [
  {
    id: "fresh-off-the-bus",
    title: "Fresh Off The Bus",
    giver: "Rico Vale",
    summary: "Find Rico. Take the phone. Learn the block.",
    cash: 80,
    xp: 40,
    streetRep: 2,
    objectives: [
      { type: "GO_TO", label: "Walk to Rico's hideout", targetId: "rico-hideout" },
      { type: "TALK_TO", label: "Talk to Rico", targetId: "rico" },
      { type: "PICK_UP", label: "Pick up the starter phone", targetId: "phone" },
    ],
  },
  {
    id: "borrowed-wheels",
    title: "Borrowed Wheels",
    giver: "Rico Vale",
    summary: "Boost a Sparrow and roll it to Maya.",
    cash: 220,
    xp: 70,
    streetRep: 8,
    objectives: [
      { type: "ENTER_VEHICLE", label: "Steal the parked Sparrow", targetId: "sparrow-job" },
      { type: "DELIVER", label: "Deliver it to Maya's garage", targetId: "maya-garage" },
      { type: "TALK_TO", label: "Talk to Maya", targetId: "maya" },
    ],
  },
  {
    id: "easy-money",
    title: "Easy Money",
    giver: "Rico Vale",
    summary: "Hit Coral Mart. Cops will come. They are slow. Lose them.",
    cash: 480,
    xp: 110,
    streetRep: 16,
    objectives: [
      { type: "ROB_LOCATION", label: "Rob Coral Mart", targetId: "coral-mart" },
      { type: "ESCAPE_POLICE", label: "Lose the cops (heat 0)", targetId: "heat" },
    ],
  },
  {
    id: "midnight-run",
    title: "Midnight Run",
    giver: "Maya Reyes",
    summary: "Illegal three-checkpoint sprint. First or nothing.",
    cash: 640,
    xp: 140,
    streetRep: 22,
    objectives: [
      { type: "GO_TO", label: "Reach the race line", targetId: "race-start" },
      { type: "WIN_RACE", label: "Hit all checkpoints", targetId: "race" },
    ],
  },
  {
    id: "port-authority",
    title: "Port Authority",
    giver: "Marcus Vane",
    summary: "Slip the fence, lift the crate, vanish.",
    cash: 900,
    xp: 200,
    streetRep: 30,
    objectives: [
      { type: "GO_TO", label: "Sneak into the warehouse yard", targetId: "warehouse" },
      { type: "PICK_UP", label: "Steal the cargo crate", targetId: "cargo" },
      { type: "DELIVER", label: "Drop the crate at Rico's", targetId: "rico-hideout" },
      { type: "ESCAPE_POLICE", label: "Clear heat if they spotted you", targetId: "heat" },
    ],
  },
];

export const HEIST_SUNSET: MissionDef = {
  id: "sunset-jewelry",
  title: "The Sunset Jewelry Job",
  giver: "Rico Vale",
  summary: "Prototype heist — scout, wheels, cases, safehouse.",
  cash: 2400,
  xp: 420,
  streetRep: 55,
  objectives: [
    { type: "GO_TO", label: "Scout Sunset & Vine cases", targetId: "jewelry" },
    { type: "ENTER_VEHICLE", label: "Steal a getaway car", targetId: "getaway" },
    { type: "ROB_LOCATION", label: "Smash the cases", targetId: "jewelry" },
    { type: "GO_TO", label: "Reach the safehouse", targetId: "apartment" },
  ],
};

export function missionById(id: string): MissionDef | undefined {
  return [...MISSIONS, HEIST_SUNSET].find((m) => m.id === id);
}

export function nextMission(completed: string[]): MissionDef | undefined {
  if (!completed.includes("fresh-off-the-bus")) return MISSIONS[0];
  if (!completed.includes("borrowed-wheels")) return MISSIONS[1];
  if (!completed.includes("easy-money")) return MISSIONS[2];
  if (!completed.includes("midnight-run")) return MISSIONS[3];
  if (!completed.includes("port-authority")) return MISSIONS[4];
  if (!completed.includes("sunset-jewelry")) return HEIST_SUNSET;
  return undefined;
}
