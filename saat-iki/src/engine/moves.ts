import type { Choice, Message } from "../types";
import { pickUnused } from "./pool";

export type MoveId =
  | "finger"
  | "ride"
  | "behind"
  | "faster"
  | "stay"
  | "cum"
  | "hair"
  | "swallow"
  | "deeper"
  | "breast"
  | "ass"
  | "neck"
  | "sit"
  | "want"
  | "come"
  | "fantasy"
  | "clothes"
  | "tease"
  | "shower"
  | "bed"
  | "again"
  | "hall"
  | "wall"
  | "pillow"
  | "public"
  | "squirt"
  | "lipstick"
  | "rough"
  | "touch";

type Move = {
  id: MoveId;
  pattern: RegExp;
  lines: string[][];
  choices: Choice[];
};

const MOVES: Move[] = [
  {
    id: "bed",
    pattern: /yata[gğ]|yataga|yatak/i,
    lines: [
      ["yatağa çekiyom seni", "bacaklarım açık ıslandım", "üstüme gel hayvan gibi"],
      ["yatağa geçtik ya", "yastığım sırılsıklam", "duş bitti burası yatak sok"],
      ["yüzümü yastığa gömdüm", "kalçam havada {name}", "sok artık durma"],
    ],
    choices: [
      { label: "Sok", text: "içine sok" },
      { label: "Yala", text: "amini yiyim" },
      { label: "Üstüne geç", text: "üstüme geç" },
    ],
  },
  {
    id: "again",
    pattern: /sonra|devam|ileri/i,
    lines: [
      ["şimdi devam", "çekmedim", "daha derine"],
      ["bekletmem ya", "amım açık duruyo", "gel üstüme"],
    ],
    choices: [
      { label: "Sok", text: "içine sok" },
      { label: "Daha hızlı", text: "daha hızlı" },
      { label: "Yala", text: "amini yiyim" },
    ],
  },
  {
    id: "hall",
    pattern: /koridor|holde|asansör|asansor/,
    lines: [
      ["koridorda duvara yapıştır beni", "bacaklarım belinde offf", "kontrolümü kaybedene kadar sik"],
      ["holde kimse yok değil", "etek kaydı haberin yok", "ağzımı kapatma herkes duysun"],
      ["duvar soğuk sırtım açık {name}", "mini eteğimi kaldır sok", "inleyene kadar bırakma"],
    ],
    choices: [
      { label: "Sok", text: "içine sok" },
      { label: "Herkes duysun", text: "herkes duysun sik" },
      { label: "Saçını çek", text: "saçını çek" },
    ],
  },
  {
    id: "pillow",
    pattern: /yastık|yastik|sürtün|surtun/,
    lines: [
      ["yastığıma sürtünüyom ya", "yapış yapış sırılsıklam oldu 🥺", "senin sikin olsa şuan içimde"],
      ["yüzümü yastığa gömdüm", "kalçam havada sürtünüyom", "gel arkadan yapıştır"],
      ["yastık ıslandı {name}", "kendime yetemiyom", "fışkırt da bitsin"],
    ],
    choices: [
      { label: "Fışkırt", text: "fışkırt beni" },
      { label: "Sok", text: "içine sok" },
      { label: "Yala", text: "amini yiyim" },
    ],
  },
  {
    id: "public",
    pattern: /herkes|duysun|sokakta|plaj|denizde|umuma/,
    lines: [
      ["herkes duysun istiyom", "sesimi kesme {name}", "orospu gibi inleyeyim"],
      ["denizde tut beni", "bacaklarım belinde kayıyo", "acıdı tuz ama değdi ya"],
      ["kapı aralık umurumda değil", "komşu duysun", "daha sert vur utanç yok"],
    ],
    choices: [
      { label: "Hayvan gibi", text: "hayvan gibi sik" },
      { label: "Duvara yapıştır", text: "duvara yapıştır" },
      { label: "Sok", text: "içine sok" },
    ],
  },
  {
    id: "squirt",
    pattern: /fışkır|fiskir|squir/,
    lines: [
      ["fışkırt beni offf", "bacaklarım titriyo durma", "yatağı ıslatayım senin için"],
      ["parmakların kıvrılınca aktım", "utanmıcam {name}", "dilini de bas öyle sık"],
      ["boşalıcam fışkırarak", "tut beni bırakma", "hepsini yüzüne istiyom"],
    ],
    choices: [
      { label: "Yala", text: "amini yiyim" },
      { label: "Parmak da", text: "parmak da sok" },
      { label: "Sok", text: "içine sok" },
    ],
  },
  {
    id: "lipstick",
    pattern: /ruj|mini etek|kucağ|kucagina|kucağına/,
    lines: [
      ["kırmızı rujumla kucağına oturdum", "öpüşürken bitsin ruj", "sürtünüyom mini eteğimle"],
      ["etek kaydı {name}", "külot yok haberin yok", "kucağında ıslandım sok artık"],
      ["rujum dudağında kaldı ya", "yalvarıyom bak", "kucağından inmicem sikilmeden"],
    ],
    choices: [
      { label: "Öp", text: "öp beni rujum bitsin" },
      { label: "Sok", text: "içine sok" },
      { label: "Üstüne geç", text: "üstüme geç" },
    ],
  },
  {
    id: "rough",
    pattern: /hayvan|boğazla|orospu|sürtük|aşağıla/,
    lines: [
      ["hayvan gibi sik beni", "tokatla boğazla {name}", "orospu gibi kullan utanç yok"],
      ["sert istiyom nazik değil", "saçımı çek duvara yapıştır", "beni bitir bırakma"],
      ["aşağıla farketmez", "amım zonkluyo böyle konuşunca", "daha kirli söyle sikerken"],
    ],
    choices: [
      { label: "Tokatla", text: "kalçasına tokat at" },
      { label: "Saçını çek", text: "saçını çek" },
      { label: "Sok", text: "içine sok" },
    ],
  },
  {
    id: "touch",
    pattern: /kendime dokun|parmaklarımda|azdırıyo|azdiriyo|elleme|eliyor/,
    lines: [
      ["kendime dokunuyom şuan 🥺", "parmaklarım kayıyo offf", "sen yazınca daha ıslandım"],
      ["azdırıyon {name} duramıyom", "elimi çekmiyom", "gel de sen bitir"],
      ["amım zonkluyo bak", "iki parmak oldu ya", "senin dilin olsa şuan"],
    ],
    choices: [
      { label: "Yala", text: "amini yiyim" },
      { label: "Fışkırt", text: "fışkırt beni" },
      { label: "Sok", text: "içine sok" },
    ],
  },
  {
    id: "finger",
    pattern: /parmak/,
    lines: [
      ["offf parmağın kaydı içeri", "ıslaklığımı sarıyo bak", "bir tane daha koy"],
      ["iki parmak oldu ya", "kalçam oynuyo durduramıycam", "dilini de bas amıma"],
      ["parmakların kıvrılınca sesim çıktı", "bacaklarım titriyo {name}", "çıkarma böyle ez"],
    ],
    choices: [
      { label: "Daha derine", text: "parmağını daha derine sok" },
      { label: "Yala da", text: "yala da durma" },
      { label: "Sok", text: "sikimi içine sok" },
    ],
  },
  {
    id: "ride",
    pattern: /üstüm|üstüne geç|üstüne bin|bin üst/,
    lines: [
      ["üstüne oturdum offf", "sikine binmeyi bayılıyorum", "kalçamı tut böyle inicem"],
      ["dibine kadar aldım ya", "memelerim yüzünde sallanıyo", "ısır uçları inerken"],
      ["seni içimde eziyom {name}", "kendi zevkime kullanıyom", "boşalana kadar inmicem"],
    ],
    choices: [
      { label: "Daha hızlı", text: "daha hızlı sik" },
      { label: "Memelerini em", text: "memelerini em" },
      { label: "İçine boşal", text: "içinde boşal" },
    ],
  },
  {
    id: "behind",
    pattern: /arkadan|arkamı|dogg|arkaya/,
    lines: [
      ["arkamı kaldırdım ya", "yüzüm yastıkta offf", "saçımı çek de vur"],
      ["arkadan girdin kaydı", "sesim yastığa gidiyo", "kalçama tokat at"],
      ["belimi kır {name}", "amım seni yutuyo", "daha derine vur durma"],
    ],
    choices: [
      { label: "Saçını çek", text: "saçını çek" },
      { label: "Tokatla", text: "kalçasına tokat at" },
      { label: "İçine boşal", text: "içinde boşal" },
    ],
  },
  {
    id: "faster",
    pattern: /hızlı|sert\b|vur|sik\b/,
    lines: [
      ["daha sert offf", "hayvan gibi vur", "amım seni sıkıyo bırakmıyo"],
      ["öyle sik yaa", "bacaklarım kilitlendi", "orospu de bana böyle"],
      ["her vuruşta şapırdıyom", "utanmıcam {name} herkes duysun", "boşalcam az kaldı durma"],
    ],
    choices: [
      { label: "Üstüne geç", text: "üstüme geç" },
      { label: "Arkadan", text: "arkadan sik" },
      { label: "İçine boşal", text: "içinde boşal" },
    ],
  },
  {
    id: "stay",
    pattern: /içinde kal|çıkarma|çıkma/,
    lines: [
      ["içimde kal offf", "nabzını amımda hissediyom", "böyle dolu kalayım"],
      ["çıkarma {name}", "seni emiyorum içerde", "kıpırda biraz sadece"],
    ],
    choices: [
      { label: "Daha vur", text: "daha vur" },
      { label: "İçine boşal", text: "içinde boşal" },
      { label: "Bir daha", text: "bir daha içine sok" },
    ],
  },
  {
    id: "cum",
    pattern: /boşal|bosal|içine bırak|üstüne boşal|yüzüme/,
    lines: [
      ["içime bırak offf", "hepsini istiyom {name}", "amımla sıkıyom boşal"],
      ["yüzüme de olur memelerime de", "sadece durma", "yalarım sonra"],
      ["içimde patla", "ben de geldim nerdeyse", "karıştıralım"],
    ],
    choices: [
      { label: "Bir daha", text: "bir daha sik" },
      { label: "Yala", text: "amini yiyim" },
      { label: "Ağzına al", text: "ağzına al" },
    ],
  },
  {
    id: "hair",
    pattern: /saç(ını|imi)?\s*(tut|çek)/,
    lines: [
      ["saçımı çektin offf", "boğazım açıldı", "daha sık ağzına it"],
      ["ellerin saçımda iyi duruyo", "gözlerim doldu ya", "kullan beni böyle"],
    ],
    choices: [
      { label: "Boğazına", text: "boğazına kadar al" },
      { label: "Yut", text: "yut" },
      { label: "Sok", text: "içine sok" },
    ],
  },
  {
    id: "swallow",
    pattern: /\byut\b/,
    lines: [
      ["yutuyom bak offf", "sıcak aktı boğazımdan", "dilimle temizlerim"],
      ["ağzımda patladı ya", "hepsini yuttum {name}", "bir damla kaçırmadım"],
    ],
    choices: [
      { label: "Bir daha", text: "ağzına al bir daha" },
      { label: "Sok", text: "içine sok" },
      { label: "Yala", text: "amini yiyim" },
    ],
  },
  {
    id: "deeper",
    pattern: /derine|boğaz|bogaz/,
    lines: [
      ["boğazıma kadar aldım offf", "gözlerim doldu salmıycam", "burnum tenine değdi"],
      ["nefesim kesildi ya", "tükürük aktı farketmez", "saçımı tut daha it"],
    ],
    choices: [
      { label: "Saçını tut", text: "saçını tut" },
      { label: "Yut", text: "yut" },
      { label: "Sok", text: "içine sok" },
    ],
  },
  {
    id: "breast",
    pattern: /meme|göğüs|gogus|göğs/,
    lines: [
      ["memelerimi ısır offf", "uçları ağzında erisin", "dişle sonra yala"],
      ["ellerin göğsümde sıkıyo", "aralarına koy istersen", "aşağı kayınca sırılsıklam bulursun"],
    ],
    choices: [
      { label: "Em", text: "memelerini em" },
      { label: "Sık", text: "memelerini sık" },
      { label: "Aşağı in", text: "aşağı in yala" },
    ],
  },
  {
    id: "ass",
    pattern: /kalça|kalca|götün|gotun|götünü|popo|tokat/,
    lines: [
      ["kalçamı sıktın offf", "iz bırak farketmez", "parmakların kayıyo arama"],
      ["tokatla {name}", "titredi amım ya", "arkamı kaldırdım hadi"],
    ],
    choices: [
      { label: "Tokatla", text: "kalçasına tokat at" },
      { label: "Arkadan", text: "arkadan sik" },
      { label: "Yala", text: "amini yiyim" },
    ],
  },
  {
    id: "neck",
    pattern: /boyn|ısır|öp/,
    lines: [
      ["boynuma iz bırak offf", "bacaklarım çözüldü ya", "kulağıma söyle ne yapıcan"],
      ["dişin değdi titredim", "külotum kaydı haberin yok", "aşağı in durma"],
    ],
    choices: [
      { label: "Aşağı in", text: "aşağı in yala" },
      { label: "Ağzına al", text: "ağzına al" },
      { label: "Sok", text: "içine sok" },
    ],
  },
  {
    id: "sit",
    pattern: /yüzüne otur|yuzune otur/,
    lines: [
      ["yüzüne oturdum offf", "dilini amıma göm", "nefesin içeri giriyo"],
      ["bacaklarım omzunda", "ıslaklığımı yala {name}", "boşalana kadar kaldırma"],
    ],
    choices: [
      { label: "Yala", text: "durma yala" },
      { label: "Parmak da", text: "parmak da sok" },
      { label: "Sok", text: "içine sok" },
    ],
  },
  {
    id: "want",
    pattern: /istiyorum|istiyom|özledim|kaçır|sikicem|sikecem|sikeyim/,
    lines: [
      ["ben de sırılsıklam istiyom", "amım zonkluyo senin için", "gel de içime göm"],
      ["özletme {name}", "fantezimdesin çıplağım", "yazma da sik"],
    ],
    choices: [
      { label: "Yala", text: "amini yiyim" },
      { label: "Ağzına al", text: "ağzına al" },
      { label: "Sok", text: "içine sok" },
    ],
  },
  {
    id: "come",
    pattern: /\bgel\b|buraya|yanına/,
    lines: [
      ["gelsene offf", "bacaklarım açık seni bekliyo", "kapı kilitli değil"],
      ["yatağa girer girmez ağzına alırım", "sonra üstüne binerim {name}", "sabaha kadar inmem"],
    ],
    choices: [
      { label: "Öperek başla", text: "öp beni sonra aşağı in" },
      { label: "Yala", text: "amini yiyim" },
      { label: "Sok", text: "içine sok" },
    ],
  },
  {
    id: "fantasy",
    pattern: /fantezi kur|hayal et|otel camı|camın önünde|balkon/,
    lines: [
      ["isteğim: koridorda duvar", "etek kalkık sen içimde", "ellerin boğazımda offf"],
      ["duşta duvara yapıştır", "bacağımı kaldır sik", "su aktıkça inleyeyim herkes duysun"],
      ["sabah uyanır uyanmaz sikin sürtünsün", "henüz kahve yok {name}", "önce sen boşal sonra ben"],
    ],
    choices: [
      { label: "Camın önünde", text: "camın önünde arkadan sik" },
      { label: "Duşta", text: "duşta duvara yapıştır" },
      { label: "Sabah", text: "sabah uyanır uyanmaz sik" },
    ],
  },
  {
    id: "clothes",
    pattern: /çıkar|soyun|çıplak|ciplak|külot|kulot|sütyen|sutyen/,
    lines: [
      ["külotumu kaydırdım ya", "ıslak izi bacaklarımda", "parmakların oraya gelsin"],
      ["sütyen yoktu zaten", "memelerim açık offf", "ağzını koy"],
    ],
    choices: [
      { label: "Sık", text: "memelerini sık" },
      { label: "Yala", text: "amini yiyim" },
      { label: "Sok", text: "içine sok" },
    ],
  },
  {
    id: "tease",
    pattern: /yavaş|beklet|alay|kışkırt|kiskirt|tantal|oyal/,
    lines: [
      ["yavaş yaa", "sadece ucuna değdiriyom", "dilenciliğin hoşuma gidiyo"],
      ["bekletiyom {name}", "ıslaklığımı gösterip çekiyom", "yalvarırsan sokarım"],
    ],
    choices: [
      { label: "Yalvar", text: "lütfen sok durma" },
      { label: "Zorla", text: "bekletme içine sok" },
      { label: "Yala", text: "amini yiyim" },
    ],
  },
  {
    id: "shower",
    pattern: /duş|dus|ıslak ten/,
    lines: [
      ["duşta sırılsıklamım", "su kayıyo sırtımdan", "arkamdan gir duvarın dibinde"],
      ["duş başı açık", "ellerin ıslak tenimde", "kaydır beni {name}"],
    ],
    choices: [
      { label: "Arkadan", text: "duşta arkadan sik" },
      { label: "Ağzına al", text: "ağzına al" },
      { label: "Sok", text: "içine sok" },
    ],
  },
  {
    id: "wall",
    pattern: /duvara/,
    lines: [
      ["duvara yapıştır beni", "bacaklarım belinde offf", "kontrolümü kaybedene kadar sik"],
      ["sırtım duvarda {name}", "etek kalkık sok", "ağzımı kapatma inleyeyim"],
    ],
    choices: [
      { label: "Sok", text: "içine sok" },
      { label: "Hayvan gibi", text: "hayvan gibi sik" },
      { label: "Herkes duysun", text: "herkes duysun" },
    ],
  },
];

export function detectMove(input: string): Move | null {
  for (const item of MOVES) {
    if (item.pattern.test(input)) {
      return item;
    }
  }
  return null;
}

export function playMove(input: string, history: Message[], salt: number): string[] | null {
  const move = detectMove(input);
  if (!move) {
    return null;
  }
  return pickUnused(move.lines, history, salt);
}

export function choicesForMove(input: string): Choice[] | null {
  return detectMove(input)?.choices ?? null;
}
