export { sanitizeText, looksLikeMarkup } from "./sanitize";

export const GAME_NAME = "VICEBLOCK";
export const CITY_NAME = "Nova City";
export const DISTRICT_NAME = "Southside";
export const STARTER_CASH = 500;
export const TILE = 32;
export const MAP_W = 96;
export const MAP_H = 80;

export type HeatLevel = 0 | 1 | 2 | 3 | 4 | 5;

export type VehicleCategory =
  | "compact"
  | "sedan"
  | "muscle"
  | "sports"
  | "super"
  | "motorcycle"
  | "offroad"
  | "boat";

export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary" | "mythic";

export type MissionObjectiveType =
  | "GO_TO"
  | "TALK_TO"
  | "PICK_UP"
  | "DELIVER"
  | "KILL_TARGET"
  | "ESCAPE_POLICE"
  | "ENTER_VEHICLE"
  | "WIN_RACE"
  | "ROB_LOCATION";

export type ZoneKind = "safe" | "normal" | "high-risk";

export interface Vec2 {
  x: number;
  y: number;
}

export type VehicleSecurityTier = "none" | "lock" | "immobilizer" | "gps";

export interface VehicleStats {
  id: string;
  name: string;
  category: VehicleCategory;
  topSpeed: number;
  acceleration: number;
  handling: number;
  braking: number;
  durability: number;
  traction: number;
  seats: number;
  security: VehicleSecurityTier;
}

export interface MissionDef {
  id: string;
  title: string;
  giver: string;
  summary: string;
  cash: number;
  xp: number;
  streetRep: number;
  objectives: Array<{
    type: MissionObjectiveType;
    label: string;
    targetId?: string;
  }>;
}

export interface PlayerSave {
  id: string;
  username: string;
  guest: boolean;
  wallet?: string;
  cash: number;
  bank: number;
  xp: number;
  level: number;
  streetRep: number;
  heat: HeatLevel;
  health: number;
  armor: number;
  x: number;
  y: number;
  heading: number;
  inventory: InventoryItem[];
  ownedVehicleIds: string[];
  apartmentId: string;
  missionsCompleted: string[];
  activeMissionId?: string;
  collectibles: string[];
  achievements: string[];
  settings: PlayerSettings;
  updatedAt: number;
}

export interface InventoryItem {
  id: string;
  kind: "weapon" | "ammo" | "food" | "armor" | "key" | "material" | "mission" | "collectible" | "cosmetic";
  name: string;
  qty: number;
  rarity: Rarity;
  slot?: number;
}

export interface PlayerSettings {
  master: number;
  music: number;
  radio: number;
  sfx: number;
  ui: number;
  shake: boolean;
  reduceFlashes: boolean;
  showNames: "all" | "friends" | "crew" | "hide";
  uiScale: number;
}

export interface WalletNonce {
  address: string;
  nonce: string;
  expiresAt: number;
  used: boolean;
}

export interface PresencePlayer {
  id: string;
  username: string;
  x: number;
  y: number;
  heading: number;
  inVehicle: boolean;
  updatedAt: number;
}

export interface MarketplaceListing {
  id: string;
  mint: string;
  name: string;
  kind: "vehicle" | "character" | "property" | "cosmetic";
  rarity: Rarity;
  priceSol: number;
  seller: string;
  serial?: number;
  createdAt: number;
  sold: boolean;
}

export const DEFAULT_SETTINGS: PlayerSettings = {
  master: 1,
  music: 0.42,
  radio: 0.5,
  sfx: 0.7,
  ui: 0.55,
  shake: true,
  reduceFlashes: false,
  showNames: "all",
  uiScale: 1,
};

export function levelFromXp(xp: number): number {
  return Math.max(1, Math.floor(1 + Math.sqrt(xp / 180)));
}

export function xpIntoLevel(xp: number): { level: number; into: number; need: number } {
  const level = levelFromXp(xp);
  const prev = (level - 1) * (level - 1) * 180;
  const next = level * level * 180;
  return { level, into: xp - prev, need: next - prev };
}
