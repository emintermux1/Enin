export interface HudSnapshot {
  cash: number;
  bank: number;
  heat: number;
  health: number;
  armor: number;
  xp: number;
  level: number;
  streetRep: number;
  objective: string;
  prompt: string;
  assist: string;
  station: string;
  musicOn: boolean;
  wantedFlash: boolean;
  dayLabel: string;
  weather: string;
  inVehicle: boolean;
  vehicleHp: number;
  dialogue: { who: string; line: string } | null;
  toast: string;
  phoneOpen: boolean;
  interior: string | null;
  username: string;
  others: number;
  lockpick: { pos: number; zoneStart: number; zoneEnd: number; picksLeft: number } | null;
  jailLeft: number;
  news: string;
  lootValue: number;
  searchZone: boolean;
  gamepad: boolean;
  contractLine: string;
  weapon: string;
  ammo: number;
  raceBestMs: number;
  /** Bearing to the active waypoint relative to the camera (radians), or null. */
  waypointBearing: number | null;
  /** Stunt chain: number of linked near misses and drifts before the window lapses. */
  combo: number;
  comboMultiplier: number;
  comboCash: number;
  /** Speedometer reading in km/h, 0 on foot. */
  speed: number;
  drifting: boolean;
  /** Full-screen failure card shown briefly after dying or being arrested. */
  failure: "wasted" | "busted" | null;
}
