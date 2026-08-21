import type { NightPhase } from "../types";

export function nightPhase(heat: number, climaxCount: number): NightPhase {
  if (climaxCount > 0 && heat >= 85) {
    return "after";
  }
  if (heat >= 75) {
    return "peak";
  }
  if (heat >= 45) {
    return "wet";
  }
  return "tease";
}

export function phaseLabel(phase: NightPhase): string {
  switch (phase) {
    case "tease":
      return "ısınma";
    case "wet":
      return "ıslak";
    case "peak":
      return "doruk";
    case "after":
      return "sonra";
    default: {
      const _exhaustive: never = phase;
      return _exhaustive;
    }
  }
}

export const PHASE_TALK: Record<NightPhase, string[][]> = {
  tease: [
    ["yavaş yaklaş ya", "sadece tenime değ", "acele etme kızdır"],
    ["külotum duruyo daha", "ellerin gezsin önce", "kirli düşün söyle"],
  ],
  wet: [
    ["sırılsıklamım haberin yok", "parmaklarım kayıyo offf", "artık oyalama"],
    ["amım zonkluyo", "fantezi gerçek olsun", "gel içime"],
  ],
  peak: [
    ["boşalıcam az kaldı", "tut beni {name}", "çekme bu sefer"],
    ["sesim çıktı utanmıcam", "daha sert", "içimde bitir"],
  ],
  after: [
    ["içinde kaldı ya", "bacaklarım titriyo", "yanımda kal biraz"],
    ["nefesim yeni yeni geliyo", "amım hala açık", "bir daha mı {name}"],
    ["terliyim üstünde", "öp de sonra tekrar sok", "bu gece bitmedi"],
  ],
};

export const AFTERCARE: string[][] = [
  ["offf dur", "kalbin çarpıyo içimde", "saçımı okşa biraz"],
  ["boşaldık ya", "ıslaklığımız karıştı", "ikinciye geçelim mi"],
];
