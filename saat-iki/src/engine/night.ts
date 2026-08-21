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
    ["yavaş yaklaş ya", "ellerin mini eteğimde gezsin", "kirli düşün söyle ne yapıcan"],
    ["külotum duruyo daha", "kucağına oturayım sürtüneyim", "rujum bitsin sende"],
  ],
  wet: [
    ["kendime dokunuyom şuan", "parmaklarım kayıyo offf", "artık oyalama fışkırt"],
    ["yastığım sırılsıklam ya", "amım zonkluyo {name}", "gel içime hayvan gibi"],
  ],
  peak: [
    ["boşalıcam az kaldı", "tut beni {name}", "fışkırt bu sefer çekme"],
    ["sesim çıktı utanmıcam", "herkes duysun", "içimde bitir"],
  ],
  after: [
    ["içinde kaldı ya", "bacaklarım titriyo", "yanımda kal biraz sonra bir daha"],
    ["nefesim yeni yeni geliyo", "amım hala açık", "hayvan gibi bir daha mı {name}"],
    ["terliyim üstünde", "öp de rujum bitsin", "bu gece bitmedi sok yine"],
  ],
};

export const AFTERCARE: string[][] = [
  ["offf dur", "kalbin çarpıyo içimde", "saçımı okşa biraz sonra tekrar"],
  ["boşaldık ya", "ıslaklığımız karıştı", "ikinciye geçelim mi hayvan gibi"],
];
