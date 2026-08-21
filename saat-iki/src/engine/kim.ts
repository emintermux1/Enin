import type { Message, NightPhase } from "../types";
import type { MoveId } from "./moves";
import { detectMove } from "./moves";
import { pickUnused } from "./pool";

export type KimAct = "oralHer" | "oralHim" | "sex" | "kiss" | "body" | "talk";

export const KIM_SCENES: Record<KimAct, string[][]> = {
  oralHer: [
    ["mm orası çok hassas {name}", "yavaş yala utanıyorum ama çekme"],
    ["yüzüne oturayım mı 🥺", "doğalım tadım değişik değil inş"],
    ["klitorise öyle basınca sesim çıkıyo", "kamerasız şimdi sadece sen"],
    ["ıslandım dilinde kayıyo", "parmak da koy yavaş"],
  ],
  oralHim: [
    ["ağzıma alıyom bak utandım biraz", "güzel kokuyo mm"],
    ["yavaş emiyorum sonra derin", "saçımı tut ama nazik başla"],
    ["gözlerime bak {name}", "yutmaya çalışıyom kaçırmıycam"],
  ],
  sex: [
    ["içime yavaş gir offf", "alışıyom sonra boz beni"],
    ["mm evet orası", "doğal bırak tempo bende biraz"],
    ["üstündeyim utanıyom sallanırken", "tut kalçamı {name}"],
    ["daha derine olabilirim", "çekimdeki gibi değil bu gerçek"],
  ],
  kiss: [
    ["öp beni yavaş rujum doğal", "sonra boynuma in 🥺"],
    ["öperken sürtünüyom farkında mısın", "mini tişörtüm kaydı"],
  ],
  body: [
    ["memelerim küçük ama çok hassas", "uçlarını yavaş yala"],
    ["belimi gezdir ellerinle", "aşağı inince ıslak bulursun doğal"],
  ],
  talk: [
    ["çekim bitti kamera kapalı", "hâlâ titreşiyorum {name} 🥺"],
    ["üstümde tişört var külot yok", "doğalım makyaj az utandım"],
    ["oyundan çıktım aklım sende kaldı", "konuşalım mı yoksa ellerin konuşsun"],
    ["azgınım ama yavaş başla", "sonra bozulurum haberin olsun"],
  ],
};

export const KIM_MOVES: Partial<Record<MoveId, string[][]>> = {
  hall: [
    ["koridorda yavaş yapıştır", "sesim çıkmasın derken çıkar 🥺"],
    ["duvara yasla öp sonra sok", "çekim değil bu ev"],
  ],
  wall: [
    ["duvara yasla beni", "bacağımı kaldır yavaş gir"],
  ],
  pillow: [
    ["yastığa sürtünüyodum utandım", "yapış yapış oldu gel sen yap"],
    ["yüzüm yastıkta kalçam sende", "yavaş sonra sert"],
  ],
  public: [
    ["herkes duymasın diye fısıldıyom", "ama inliyorum kesemiyom"],
    ["utangaçım ya ama istiyorum", "sessiz olamıycam {name}"],
  ],
  squirt: [
    ["fışkırırsam utanıcam", "yine de istiyorum durma"],
    ["o noktaya basınca aklım gidiyo", "tut beni 🥺"],
  ],
  lipstick: [
    ["doğal glossum bitsin öpüşmekten", "kucağına oturuyom mini şort"],
    ["kucağında ıslandım haberin yok", "yavaş sürtünelim"],
  ],
  rough: [
    ["önce yavaş sonra hayvan gibi", "bozulmamı istiyosan söyle"],
    ["nazik başla sonra boz", "cutie kalmam {name}"],
  ],
  touch: [
    ["kendime dokunuyom rn utandım", "sen yazınca daha aktı"],
    ["çekimden kalma ıslaklığım duruyo", "elimi çekmiyom"],
  ],
  finger: [
    ["parmağın yavaş kaydı offf", "bir tane daha alışkınım"],
    ["kıvır orda mm", "dilini de koy doğalım"],
  ],
  ride: [
    ["üstüne geçeyim mi utanıyom", "yavaş binecem sonra hızlanırım"],
    ["dibine oturdum mm", "kalçamı tut sallanıyom"],
  ],
  behind: [
    ["arkadan yavaş gir", "yüzümü yastığa gömerim ses çıkmasın"],
    ["belimi tut {name}", "tempo senin sonra boz"],
  ],
  faster: [
    ["daha hızlı olabilirim alıştım", "sesim çıkıyo utanma bende yok artık"],
    ["evet öyle mm", "doğal bırak çekim pozı yok"],
  ],
  stay: [
    ["içimde kal biraz", "nabzını hissediyom güzel"],
    ["çıkarma ısındım", "öp de öyle kal"],
  ],
  cum: [
    ["içimde bırakabilirsin", "istiyorum utansam da"],
    ["yüzüme de olur yavaşça", "yalarım bak cute kalmıyo"],
  ],
  hair: [
    ["saçımı yavaş çek", "auburnın dağılsın umurumda değil"],
    ["tut ama koparma", "gözlerime bak öyle kullan"],
  ],
  swallow: [
    ["yutmaya çalışıyom mm", "kaçırmıycam söz"],
    ["sıcak aktı utandım", "güzel aslında"],
  ],
  deeper: [
    ["daha derine alıyom", "gözlerim doluyo duruyorum"],
    ["nefes alıp devam", "saçımı tut nazik"],
  ],
  breast: [
    ["küçükler biliyorum", "ama uçları çok sızlıyo yala"],
    ["dişleme yavaş", "hassasım {name}"],
  ],
  ass: [
    ["kalçama yavaş tokat", "titredim ya"],
    ["iz bırak farketmez", "doğal tenim kızarır"],
  ],
  neck: [
    ["boynumu öp ısır yavaş", "orası zayıf noktam"],
    ["kulağıma söyle ne yapıcan", "ürkütme sonra boz"],
  ],
  sit: [
    ["yüzüne oturayım utanıyom", "dilini yavaş koy"],
    ["ıslaklığımı yala {name}", "çekimdeki gibi poz vermicem doğal"],
  ],
  want: [
    ["ben de istiyorum utansam da", "gel yavaş sonra delirt"],
    ["özledim ellerini", "kamera yok sadece sen"],
  ],
  come: [
    ["gelsene tişörtüm açık", "kapı kilitli bu sefer"],
    ["yanıma uzan önce öp", "sonra ne olursa"],
  ],
  fantasy: [
    ["fantezim yavaş başlayıp bozulmak", "doğal ışık kamera yok"],
    ["sabah uyanınca sürtünmeni istiyorum", "makyajsız öp"],
  ],
  clothes: [
    ["tişörtü çıkardım külot zaten yoktu", "doğalım bak"],
    ["üstüm kaydı memelerim açık", "utanıyom gülme"],
  ],
  tease: [
    ["beklet beni biraz", "yalvarınca veririm"],
    ["yavaş ucundan", "cutie duruyom daha"],
  ],
  shower: [
    ["duşta sırılsıklamım", "duvara yasla yavaş"],
    ["su kayıyo saçımdan", "öp öyle gir"],
  ],
  bed: [
    ["yatağa gel çarşaf dağınık", "üstümde sadece tişört"],
    ["yanıma uzan {name}", "ellerin konuşsun"],
  ],
  again: [
    ["devam edelim mi ısındım", "daha derine alıştım"],
    ["çekme şimdi", "bozuluyom güzel"],
  ],
};

export const KIM_HOOKS: Record<KimAct, string[]> = {
  oralHer: ["yüzüne oturayım mı", "yavaş yala istiyorum"],
  oralHim: ["daha derin mi", "yutayım mı"],
  sex: ["daha sert mi yoksa böyle mi", "içimde kalayım mı"],
  kiss: ["boynuma ineyim mi", "kucağına oturayım mı"],
  body: ["uçlarını emeyim mi", "aşağı ineyim mi"],
  talk: ["ellerinle mi devam", "çekimden kalma ıslaklığım duruyo"],
};

export const KIM_PHASE: Record<NightPhase, string[][]> = {
  tease: [
    ["yavaş yaklaş", "tişörtüm duruyo daha 🥺"],
    ["öp önce", "doğal başlayalım"],
  ],
  wet: [
    ["ıslandım haberin yok", "oyalama artık yavaş gir"],
    ["kendime dokunuyodum utandım", "sen devam et {name}"],
  ],
  peak: [
    ["boşalıcam sesim çıkmasın derken", "tut beni"],
    ["mm duramıyom", "içimde bitir istersen"],
  ],
  after: [
    ["nefesim yeni geliyo", "saçımı okşa makyajsızım"],
    ["ıslaklığımız karıştı", "bir daha yavaş mı"],
  ],
};

export const KIM_AFTER: string[][] = [
  ["offf dur kalbin hızlı", "yanımda kal konuşalım biraz"],
  ["boşaldık utandım güzeldi", "su getireyim sonra yine"],
];

export function pickKimMove(input: string, history: Message[], salt: number): string[] | null {
  const move = detectMove(input);
  if (!move) {
    return null;
  }
  const bank = KIM_MOVES[move.id];
  if (!bank) {
    return null;
  }
  return pickUnused(bank, history, salt);
}

export function pickKimScene(key: KimAct, history: Message[], salt: number): string[] | null {
  return pickUnused(KIM_SCENES[key], history, salt);
}

export function pickKimPhase(phase: NightPhase, history: Message[], salt: number): string[] | null {
  return pickUnused(KIM_PHASE[phase], history, salt);
}

export function pickKimAfter(history: Message[], salt: number): string[] | null {
  return pickUnused(KIM_AFTER, history, salt);
}
