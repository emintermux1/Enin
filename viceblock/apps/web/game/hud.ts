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
  /** Total rounds carried, magazine included. */
  ammo: number;
  /** Rounds in the magazine and rounds left in reserve. */
  mag: number;
  reserve: number;
  reloading: boolean;
  aiming: boolean;
  /** Crosshair bloom in radians: spread plus whatever recoil has not settled. */
  spread: number;
  hitMarker: "hit" | "kill" | null;
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
  /** What the web-shooters are doing right now. */
  web: "ready" | "aimed" | "swing" | "zip" | "wall" | "air";
  /**
   * What the shot the player is lining up would catch: a swing anchor, only
   * something close enough to zip to, or nothing. A refused web is otherwise
   * indistinguishable from a broken one, and "too close, zip instead" is a
   * different problem from "nothing here is tall enough".
   */
  anchor: "swing" | "zip" | "none";
  /** Height above the street in world units, 0 on the pavement. */
  altitude: number;
  /** Airspeed while swinging, in km/h, so the arc has a number on it. */
  airSpeed: number;
}
