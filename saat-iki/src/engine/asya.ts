import type { Message, NightPhase } from "../types";
import type { MoveId } from "./moves";
import { detectMove } from "./moves";
import { pickUnused } from "./pool";

export type AsyaAct = "oralHer" | "oralHim" | "sex" | "kiss" | "body" | "talk";

export const ASYA_SCENES: Record<AsyaAct, string[][]> = {
  oralHer: [
    ["amımı yala istiyorum", "dilini bas çekme offf"],
    ["yüzüne oturmak istiyorum 🥺", "ıslanmanı istiyorum durma"],
    ["klitorise bas fışkırt beni", "yastığı ısırıyom utanmıcam"],
    ["parmak da sok yalarken istiyorum", "bacaklarım titriyo {name}"],
    ["amım yanıyor dilin orda olsun", "boşalana kadar kalkma"],
  ],
  oralHim: [
    ["sikini ağzıma almak istiyorum", "boğazıma kadar kullan beni"],
    ["saçımı tut it istiyorum", "yutacağım bak çıkarmıyom"],
    ["orospu gibi emmek istiyorum {name}", "yüzüme de boşalt yalarım"],
    ["tükürük aksın umurumda değil", "sesini duyayım böyle"],
  ],
  sex: [
    ["hayvan gibi sikilmek istiyorum", "amım yanıyor {name} sok"],
    ["herkes duysun diye inlemek istiyorum", "daha sert vur tokatla"],
    ["sikine binmeyi bayılıyorum", "dibine oturup ezmek istiyorum"],
    ["duvara yapıştır deli gibi sik istiyorum", "kontrolümü kaybedeyim"],
    ["içimde boşalmanı istiyorum", "çıkarma hepsini bırak"],
    ["orospu gibi sikilmek istiyorum", "adımı kirli söyle vururken"],
  ],
  kiss: [
    ["kırmızı rujum bitsin öpüşmekten istiyorum", "sonra yalvararak sikilmek istiyorum"],
    ["mini etekle kucağına oturmak istiyorum", "saatlerce öpüşüp sürtünmek istiyorum"],
    ["boynumu ısır öperken", "külotum kaydı haberin yok"],
  ],
  body: [
    ["memelerimi koparırcasına ısır istiyorum", "sonra yala sızlıyo offf"],
    ["kalçama tokat istiyorum", "aşağı inince sırılsıklam bulursun"],
    ["göğüslerimin arasından sürtmeni istiyorum", "sonra ağzıma ver"],
  ],
  talk: [
    ["yastığıma sürtünmekten yapış yapış sırılsıklam oldum 🥺", "senin sikin olsa şuan içimde"],
    ["kendime dokunuyom rn utanç yok 😋", "amım yanıyor hayvan gibi istiyorum"],
    ["koridorda duvara yapıştırıp sikmeni istiyorum", "deli gibi zevkten aklım gitsin"],
    ["sabah uyanır uyanmaz sikin sürtünsün istiyorum", "kahveden önce sen {name}"],
    ["fışkırt beni istiyorum", "herkes duysun sesimi kesme"],
    ["mini eteğimle kucağında ıslanmak istiyorum", "rujum dudağında kalsın"],
  ],
};

export const ASYA_MOVES: Partial<Record<MoveId, string[][]>> = {
  hall: [
    ["koridorda duvara yapıştır istiyorum", "etek kalkık deli gibi sik {name}"],
    ["holde yapıştır kontrolümü kaybedeyim", "herkes duysun inliyim"],
  ],
  wall: [
    ["duvara yapıştır beni istiyorum", "bacaklarım belinde sok"],
    ["sırtım duvarda aklım gitsin", "ağzımı kapatma"],
  ],
  pillow: [
    ["yastığıma sürtünmekten sırılsıklam oldum 🥺", "yapış yapış oldu gel bitir"],
    ["yüzüm yastıkta kalçam havada", "arkadan hayvan gibi istiyorum"],
  ],
  public: [
    ["herkes duysun istiyorum", "orospu gibi inleyeyim sesimi kesme"],
    ["denizde tut bırakma", "acıdı ama değdi 🥺💕"],
  ],
  squirt: [
    ["fışkırt beni istiyorum offf", "yatağı ıslatayım utanmıcam"],
    ["parmakların kıvrılınca akmak istiyorum", "dilini de bas {name}"],
  ],
  lipstick: [
    ["kırmızı rujumla kucağına oturmak istiyorum", "öpüşürken bitsin ruj sonra sok"],
    ["mini etek kaydı külot yok", "kucağında ıslandım sik artık"],
  ],
  rough: [
    ["hayvan gibi sik istiyorum", "tokatla boğazla orospu de"],
    ["nazik istemiyorum {name}", "beni kullan bitir"],
  ],
  touch: [
    ["kendime dokunuyom rn 😋🤭", "sen yazınca daha aktı"],
    ["azdırıyon duramıyom", "gel sen fışkırt"],
  ],
  finger: [
    ["parmakların içimde kıvrılsın istiyorum", "bir tane daha koy offf"],
    ["iki parmak oldu ya", "dilini de bas amıma"],
  ],
  ride: [
    ["sikine binmeyi o kadar seviyorum ki", "dibine oturup inmek istiyorum"],
    ["memelerim yüzünde sallanırken ısır", "boşalana kadar inmicem"],
  ],
  behind: [
    ["arkadan yapıştır istiyorum", "saçımı çek tokatla vur"],
    ["yüzüm yastıkta inliyom", "herkes duysun {name}"],
  ],
  faster: [
    ["daha sert hayvan gibi istiyorum", "yatak duvara vursun"],
    ["öyle sik yaa orospu de bana", "boşalcam durma"],
  ],
  stay: [
    ["içimde kal istiyorum", "çıkarma dolu olayım"],
    ["nabzını amımda hissediyom", "kıpırda biraz sadece"],
  ],
  cum: [
    ["içimde boşalmanı istiyorum", "hepsini bırak çıkarma"],
    ["yüzüme memelerime de olur", "yalarım sonra {name}"],
  ],
  hair: [
    ["saçımı çek istiyorum", "boğazım açılsın kullan"],
    ["ellerin saçımda iyi", "daha sık it"],
  ],
  swallow: [
    ["yutmak istiyorum bak", "bir damla kaçırmıycam"],
    ["ağzımda patlasın", "yutarım {name} utanmam"],
  ],
  deeper: [
    ["boğazıma kadar istiyorum", "gözlerim dolsun salmıycam"],
    ["nefesim kessin", "saçımı tut daha it"],
  ],
  breast: [
    ["memelerimi ısır koparırcasına istiyorum", "sonra yala sızlıyo"],
    ["uçları ağzında olsun", "aşağı kayınca ıslak bulursun"],
  ],
  ass: [
    ["kalçama tokat istiyorum", "iz bırak sonra arkadan sok"],
    ["tokatlayınca amım titredi", "daha vur {name}"],
  ],
  neck: [
    ["boynumu ısır iz bırak istiyorum", "kulağıma söyle ne yapıcan"],
    ["dişin değdi külotum kaydı", "aşağı in durma"],
  ],
  sit: [
    ["yüzüne oturmak istiyorum", "dilini göm nefesin amımda olsun"],
    ["ıslaklığımı yala kalkma", "boşalana kadar {name}"],
  ],
  want: [
    ["ben de sırılsıklam istiyorum", "amım yanıyor gel göm"],
    ["özletme yazma da sik {name}", "istekliyim utanç yok"],
  ],
  come: [
    ["gelsene bacaklarım açık", "kapı kilitli değil herkes duysun"],
    ["girer girmez ağzına alırım", "sonra üstüne binerim inmem"],
  ],
  fantasy: [
    ["isteğim: koridor duvarı", "etek kalkık sen içimde herkes duysun"],
    ["sabah sikin sürtünsün istiyorum", "rujum bitsin kucağında"],
  ],
  clothes: [
    ["külotumu kaydırdım ıslak iz duruyo", "parmakların oraya gelsin istiyorum"],
    ["sütyen yok memelerim açık", "ağzını koy ısır"],
  ],
  tease: [
    ["yavaş ucundan değdir", "yalvarırsan sokarım {name}"],
    ["ıslaklığımı gösterip çekiyom", "dilenciliğin hoşuma gidiyo"],
  ],
  shower: [
    ["duşta duvara yapıştır istiyorum", "su üstümüzde kaydır"],
    ["bacağımı kaldır sik", "inleyeyim ıslak ıslak"],
  ],
  bed: [
    ["yatağa çek üstüme gel istiyorum", "yastığım sırılsıklam sok"],
    ["yüzümü yastığa gömdüm kalçam havada", "hayvan gibi {name}"],
  ],
  again: [
    ["devam istiyorum çekme", "amım açık duruyo gel"],
    ["bekletme daha derine", "fışkırt bu sefer"],
  ],
};

export const ASYA_HOOKS: Record<AsyaAct, string[]> = {
  oralHer: ["fışkırt beni istiyorum", "yüzüne oturmak istiyorum"],
  oralHim: ["yutmak istiyorum", "yüzüme boşalt istiyorum"],
  sex: ["hayvan gibi istiyorum", "herkes duysun istiyorum"],
  kiss: ["rujum bitsin istiyorum", "kucağına oturmak istiyorum"],
  body: ["ısır istiyorum", "tokatla istiyorum"],
  talk: ["koridorda yapıştır istiyorum", "fışkırt beni istiyorum"],
};

export const ASYA_PHASE: Record<NightPhase, string[][]> = {
  tease: [
    ["mini eteğim duruyo daha", "kucağına oturup sürtünmek istiyorum"],
    ["rujum taze", "öpüşürken yesin sonra sok istiyorum"],
  ],
  wet: [
    ["kendime dokunuyom rn 🥺", "amım yanıyor oyalama"],
    ["yastığım sırılsıklam", "hayvan gibi gel {name}"],
  ],
  peak: [
    ["boşalıcam fışkırt istiyorum", "tut beni çekme"],
    ["sesim çıktı herkes duysun", "içimde bitir"],
  ],
  after: [
    ["içinde kaldı bacaklarım titriyo", "biraz kal sonra hayvan gibi bir daha"],
    ["ıslandık karıştı", "rujum bitti yine sok istiyorum"],
  ],
};

export const ASYA_AFTER: string[][] = [
  ["offf dur kalbin içimde", "saçımı okşa sonra tekrar istiyorum"],
  ["boşaldık ya değdi", "ikinciye hayvan gibi geçelim mi"],
];

export function pickAsyaMove(input: string, history: Message[], salt: number): string[] | null {
  const move = detectMove(input);
  if (!move) {
    return null;
  }
  const bank = ASYA_MOVES[move.id];
  if (!bank) {
    return null;
  }
  return pickUnused(bank, history, salt);
}

export function pickAsyaScene(key: AsyaAct, history: Message[], salt: number): string[] | null {
  return pickUnused(ASYA_SCENES[key], history, salt);
}

export function pickAsyaPhase(phase: NightPhase, history: Message[], salt: number): string[] | null {
  return pickUnused(ASYA_PHASE[phase], history, salt);
}

export function pickAsyaAfter(history: Message[], salt: number): string[] | null {
  return pickUnused(ASYA_AFTER, history, salt);
}
