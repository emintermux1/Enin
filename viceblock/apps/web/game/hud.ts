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
}
