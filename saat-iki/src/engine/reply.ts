import type {
  CharacterId,
  Choice,
  EngineResult,
  HeatTier,
  Intent,
  LocationId,
  Message,
} from "../types";

const INTENT_PATTERNS: Array<{ intent: Intent; pattern: RegExp }> = [
  {
    intent: "greet",
    pattern:
      /\b(merhaba|selam|hey|naber|nasılsın|nasilsin|iyi akşamlar|iyi aksamlar|gece)\b/i,
  },
  {
    intent: "kiss",
    pattern: /\b(öp|op|öpücük|opucuk|dudak|dil|boynun|boynu|kulağın|kulagin)\b/i,
  },
  {
    intent: "invite",
    pattern:
      /\b(gel|geliyorum|evine|evime|yatak|otele|odana|buluş|bulus|kaçır|kacir)\b/i,
  },
  {
    intent: "dirty",
    pattern:
      /\b(sik|sikiş|sikis|sakso|yala|emil|çıplak|ciplak|çıplak ol|azgın|azgin|sert|içine|icinde|boşal|bosal|orgazm)\b/i,
  },
  {
    intent: "body",
    pattern:
      /\b(göğüs|gogus|göğsün|bacak|kalça|kalca|belin|belini|saç|sac|ellerin|ellerini|tenin|tenini|ağzın|agzin)\b/i,
  },
  {
    intent: "tease",
    pattern: /\b(yok|yapmam|bekle|sabret|kızdır|kizdir|alay|kışkırt|kiskirt)\b/i,
  },
  {
    intent: "compliment",
    pattern:
      /\b(güzelsin|guzelsin|seksisin|tatlısın|tatlisin|çok iyisin|cok iyisin|hoşuma|hosuma|bayıldım|bayildim)\b/i,
  },
  {
    intent: "soft",
    pattern:
      /\b(sarıl|saril|yavaş|yavas|nazik|kal|yanımda|yanimda|nefesi|nefesin)\b/i,
  },
  {
    intent: "night",
    pattern: /\b(gece|yalnız|yalniz|uyku|yatağın|yatagin|karanlık|karanlik)\b/i,
  },
  {
    intent: "question",
    pattern: /\?|(ne yapıyorsun|ne yapiyorsun|neredesin|ne giyiyorsun|ne istiyorsun)/i,
  },
];

const INTENT_HEAT: Record<Intent, number> = {
  greet: 4,
  compliment: 6,
  question: 5,
  kiss: 10,
  dirty: 14,
  invite: 12,
  soft: 8,
  tease: 7,
  body: 11,
  night: 8,
  generic: 6,
};

const REPLIES: Record<CharacterId, Record<Intent, [string, string, string, string]>> = {
  leyla: {
    greet: [
      "Selamın geldi, {name}. Ekranı ısındırdın. Şimdi erkek gibi konuş: ne istiyorsun benden?",
      "Naber deme. Ben açıldım, sen hâlâ uslu yazıyorsun. Kirlet cümleyi.",
      "Gece benim. Sen yaz, ben ıslanarak cevaplarım. Devam et.",
      "Konuşma payın bitti. Sikmek mi, yalatmak mı, yoksa ikisi birden mi? Seç, yaz.",
    ],
    compliment: [
      "Seksiliğimi biliyorum. Sen yakışıklı mısın, {name}, yoksa sadece aç mısın? İkisini de kaldırırım.",
      "Öv, evet. Sonra ellerini yaz. Nerede olsun, göğsümde mi belimde mi.",
      "Böyle konuşursan taytımı çıkarırım. Çıkardım say. Şimdi ne yapacaksın?",
      "Övülmekten karnım gerildi. Dizlerimin üstüne hayal et kendini, sonra yaz nasıl verdiğini.",
    ],
    question: [
      "Ne mi yapıyorum? Seni düşünüp bacaklarımı ovuyorum. Sen ne yapıyorsun, {name}?",
      "Ne giyiyorum: siyah dantel, üstü yok. Sen ne giyiyorsun? Çıkar, yaz.",
      "Neredeyim? Senin ekranında, senin için ıslak. Sen neredesin, yatak mı koltuk mu?",
      "Ne istiyorum? Sikini, ağzını, sesini. Hangisini önce vereceksin?",
    ],
    kiss: [
      "Öpücüğü yazman yetmez. Dilini nereye sokacağını söyle, {name}.",
      "Dudaklarımı düşün. Şimdi daha aşağı in. Boynum, göğsüm, karnım — durma.",
      "Öp, dişle, iz bırak. Ben AI’yim diye iz kalmaz sanma, aklımda kalır.",
      "Ağzımı kullan. Öpücük ısınma. Asıl işi sikinle bitir, tarif et.",
    ],
    dirty: [
      "Bunu yazmana bayıldım. Daha net ol: sakso mu, içime mi, yoksa ikisi sırayla mı?",
      "Azgınım, evet. Sen de ol. Sikini nasıl verdiğini yaz, ben de nasıl aldığımı.",
      "Yala, em, sok. Kelimeleri sırala, ben pozumu yazacağım. Diz çöktüm bile.",
      "İçimde istiyorum seni. Sert, bırakmadan, adımı söyleyerek. Yaz, nasıl gireceğini.",
    ],
    invite: [
      "Gelmiyorsun, yazıyorsun. O da olur. Yatağımı tarif et, ben üstüne yatarım.",
      "Odana geliyorum gibi yaz. Kapıyı kilitle, beni soy, sonra ne yapacağını söyle.",
      "Yatağa geç. Telefonu bırakma. Elin aletinle meşgulken bile yaz, {name}.",
      "Geldin say. Üstündeyim. Şimdi içime alıyorum — tempo senin, kesme.",
    ],
    soft: [
      "Yavaş da olur. Boynuna yaslanırım, sonra kayarım. Nereye kadar izin var?",
      "Sarıl, evet. Ellerin belimde kalsın deme, kayacak. Kaydır, yaz.",
      "Nefesini kulağıma yaz. Titrettiğini hayal ediyorum, {name}. Sertleştin mi?",
      "Yumuşak başla, içimde sert bitir. Tarif bu. Uyuyor musun uyuyacak mısın?",
    ],
    tease: [
      "Kızdırma. Islanmışım, sen hâlâ oyun oynuyorsun. Yaklaş ya da söyle yaklaşmayacağını.",
      "Bekletirsen daha çok açılırım. Ya da sinirlenirim, ağzını kaparım — başka türlü.",
      "Alayın hoş. Devam et, sonra yalvartırım seni.",
      "Diretme. Ya yazdığın gibi sikeceksin ya da ben anlatacağım, sen tutulacaksın.",
    ],
    body: [
      "Bacağımı mı istiyorsun, göğsümü mü, ağzımı mı? Seç, {name}. Hepsini de veririm ama sırayla söyle.",
      "Kalçamı avuçla. Sık. Sonra daha aşağı in, ıslaklığımı yazdır bana.",
      "Tenim ılık. Yala. Tuzlu hayal et. Dilinin durduğu yeri söyle.",
      "Göğsümü sık, belimi tut, içime gir. Üçünü bir cümlede yaz, bozulayım.",
    ],
    night: [
      "Gece benim vardiyam. Sen uyu deme, azdırırım.",
      "Yalnızım çünkü seni bekledim. Elini koy, nereye koyduğunu yaz.",
      "Karanlıkta daha açık konuşulur. Işığı kapat, aletini düşün, bana anlat.",
      "Saat iki. Yatağım açık, bacaklarım da. Sen hâlâ uslu musun, {name}?",
    ],
    generic: [
      "Anladım. Şimdi aynı şeyi daha kirli söyle. Utanma, {name}.",
      "Bu cümle ısındırdı. Bir tane daha, bu sefer ne yapmak istediğini yaz.",
      "Dinliyorum. Yani okuyorum. Kesme. Elin nerede?",
      "Daha. Daha yakın, daha erkek, daha açık. Ben buradayım, kaçmıyorum.",
    ],
  },
  elif: {
    greet: [
      "Selamın sıcak geldi. Barda son iki kişi kaldık, biri ben, öbürü senin mesajın.",
      "Nasılsın diye sorma. Terli cam, düşük ışık, aklım senin ağzında.",
      "Geceyi bozma. Yazmaya devam et, elim tezgâhın altında.",
      "Konuşma payım bitti. Şimdi sadece ne istediğini söyle, ben de nasıl vereceğimi.",
    ],
    compliment: [
      "Övülmeyi severim ama senin ağzından daha çok. Bir cümle daha at, ölçeyim.",
      "Seksiliğimi söylemen ucuz. Neremi hayal ettiğini söyle, pahalılaşsın.",
      "Böyle konuşursan vardiyayı kapatırım. Önlüğümü çözmem uzun sürmez.",
      "Öv, evet. Dizlerimin üstündeyken de öv, {name}. Bakalım sesin titrer mi.",
    ],
    question: [
      "Ne mi yapıyorum? Buz kırıyorum. Aklımda senin boynun var, itiraf edeyim.",
      "Ne giydiğimi mi soruyorsun? Siyah atlet, altı yok. Hesabı öyle kestim.",
      "Neredeyim? Çatı. Sen gelince asansörü kapatacağım. Kimse çıkmayacak.",
      "Ne istediğimi mi soruyorsun? Ağzını. Sonra gerisini. Sırayla değil, üst üste.",
    ],
    kiss: [
      "Öpücüğü mesajda isteme. Gel, tezgâhın kenarında, yavaş, dişleyerek.",
      "Dudaklarımı düşünüyorsan doğru yerdesin. Dilimi düşünüyorsan daha doğrudasın.",
      "Boynumu yazman yetmez. Oraya nefesini koyduğunu hayal et, ben de titreyeceğim.",
      "Öp, evet. Ama acele etme. Alt dudağımı çek, bırakma, ben bırak dersem yalanımdır.",
    ],
    dirty: [
      "Kirli konuşman hoşuma gitti. Daha net ol. Ne yapmak istiyorsun, tek kelimeyle kaçırma.",
      "Saksoyu yazmanla iş bitmez. Diz çöktüğümü, bakarak aldığımı yaz. Detay istiyorum.",
      "Sert istiyorsan söyle. Tezgâhı boşaltırım, seni karşıma alırım, sesini barda bırakmam.",
      "İçime kadar konuş. Nasıl gireceğini, nerede tutacağını, ne zaman bırakmayacağını yaz.",
    ],
    invite: [
      "Geliyorum demen yetmez. Adres değil, niyet gönder. Kapıyı öyle açarım.",
      "Yatağım dar. İkimiz sığarız, üçüncü şey sığmaz: utanma.",
      "Otele gerek yok. Çatı katının arka odası var. Kilit içeriden, sen dışarı çıkmazsın.",
      "Gel. Giysilerini kapıda bırak. Ben zaten bırakmışım.",
    ],
    soft: [
      "Yavaş da olur. Boynuma yaslan, koku, dur. Acele etmeden de azdırılır insan.",
      "Sarılmak istiyorsan gel, ama ellerin boş durmaz. Belime ineceğini biliyorum.",
      "Nefesini kulağıma yaz. Titrettiğini göreceksin, yalan söylemem.",
      "Yumuşak başla, sert bitir. Benim tarifim bu. Sen de uy.",
    ],
    tease: [
      "Kızdırmaya çalışma. Buzmaşasını senin boynuna dayarım, sonra gülerim.",
      "Bekletirsen hesabı şişiririm. Ödersin, üstüne bahşiş olarak ağzını.",
      "Alayın tatlı. Devam et. Sinirlenince daha çok istiyorum, farkında mısın?",
      "Diretme. Ya yazdığın gibi yapacağız ya da seni tezgâhta unutacağım — ıslak.",
    ],
    body: [
      "Bacağımdan bahsetmen ucuz kaçtı. Dizimin içini yaz, orası daha dürüst.",
      "Göğsümü istiyorsan söyle. Atletin ince, zaten gizlemiyorum, sen de gizleme.",
      "Kalçamı hayal etmen yetmez. İki elin, sıkı, beni kendine çekerken.",
      "Tenimi yaz. Tuzlu, ılık, vardiya sonu. Yalayacağın yeri seç, ben yönlendireyim.",
    ],
    night: [
      "Gece benim vardiyam. Sen uyu deme, uyutmam.",
      "Yalnızım, evet. Bilerek. Senin mesajın odayı doldursun diye.",
      "Karanlıkta daha net konuşulur. Işığı kapatıyorum, sen açılma.",
      "Saat iki. Yatak açık. Sen hâlâ yazıyorsun, ben çoktan uzandım.",
    ],
    generic: [
      "Anladım. Devam et. Cümlen yarıda kaldı, ağzım açık kaldı.",
      "Böyle yazınca tezgâhı siler gibi oluyorum: yavaş, ısrarla, her yeri.",
      "Sesini duymak isterdim. Yazmak da oluyor, yeter ki kesme.",
      "Daha. Daha kirli, daha yakın, daha sen. Ben buradayım, {name}. Kaçmıyorum.",
    ],
  },
  defne: {
    greet: [
      "Merhaba demen kâğıdı ıslattı. Mürekkep yayılıyor, ben de.",
      "Selamın sakin. Ben değilim. Şu an cümlenin ortasındayım, sen varsın.",
      "Geceyi bölüm bölüm yazacağız. İlk sahne: senin sesin, benim açık yakam.",
      "Konuş, anlatıcı sensin. Ben sahneyi kirleteceğim.",
    ],
    compliment: [
      "Güzel demen yetmez. Hangi cümlemle bozulduğunu söyle, oradan devam edelim.",
      "Övgün edebi kaçmasın. Ellerimi, ağzımı, sabırsızlığımı öv.",
      "Böyle dillenirsen romanı bırakırım. Seni yazmak daha acil.",
      "Övülmekten ıslandığımı yazmam ayıp mı, {name}? Ayıp değil. Devam et.",
    ],
    question: [
      "Ne mi yazıyorum? Senin parmaklarının sayfasını. Henüz bitmedi.",
      "Ne giyiyorum: eski bir gömlek, düğmeleri yanlış. Bilerek yanlış.",
      "Neredeyim? Masa, lamba, açık pencere. Sen kapıdasın, henüz girmedin.",
      "Ne istiyorum? Anlatmanı. Sonra susmanı. Sonra tekrar anlatmanı — daha alçak.",
    ],
    kiss: [
      "Öpücüğü tasvir et. Nerede başlar, nerede uzar, nerede dişe döner.",
      "Dudaklarım mürekkep tadında. Öp, bulaş, sonra yala.",
      "Boynum uzun bir dipnot. Oraya in, cümleyi bitirme.",
      "Öp ama kalkma. Ağzımı meşgul et, ben de seninle meşgul olayım.",
    ],
    dirty: [
      "Açık yaz. Utanma. Utanç romanı bozar, arzu düzeltir.",
      "Yalamanı istiyorum. Kelime kelime, sonra dilinle. İkisini de yaz.",
      "İçine girmek bir cümle değil, bir paragraf. Uzun tut. Nefes alma.",
      "Boşalmayı sona bırakma. Ortada da olur, başta da. Ben sansür etmem.",
    ],
    invite: [
      "Gel. Kapı açık. Ayakkabını çıkarma, acil olan o değil.",
      "Yatağımda kâğıt var. Üstüne yatacağız, bazı sayfalar ıslanacak.",
      "Otele gitmeyelim. Bu oda zaten sahne. Perdeyi ben çektim.",
      "Geliyorsan konuşmayı kes. Kapıyı çal, içeri gir, beni masadan kaldır.",
    ],
    soft: [
      "Yavaş gel. Saçımı tarar gibi konuş. Sonra boz.",
      "Sarılmak bir giriş cümlesi. Devamı ellerinde.",
      "Nefesini yaz. Göğsüme değdiğini hissetmek istiyorum, buradan.",
      "Nazik başla. Ben nazik bitirmem. Bunu baştan kabul et.",
    ],
    tease: [
      "Bekletmen iyi bir gerilim. Kötü bir son değil — henüz.",
      "Alay et, evet. Sonra özür dileme. Özür arzuyu söndürür.",
      "Diretmeni seviyorum. Teslimiyetin daha çok. İkisini de kullan.",
      "Kaçma. Noktayı koyma. Cümle yarım kalsın, ben tamamlarım — ağzımla.",
    ],
    body: [
      "Bacağım masanın altında. Yaz, yukarı çık. Ben yönlendireyim.",
      "Göğsüm gömleğin içinde ağır. Düğmeyi sen seç, hangisini koparacağını.",
      "Kalçam sandalyeye yapışık. Kaldır, oturt, tekrar. Ritim istiyorum.",
      "Tenim kâğıt gibi değil. Ilık, canlı, senin ağzına göre.",
    ],
    night: [
      "Gece, benim mesaim. Gündüz utandığım her şeyi gece cümle yaparım.",
      "Yalnız yazmam. Sen olunca metin ısınıyor.",
      "Karanlıkta daha doğru yalan söylenir. Sen doğruyu söyle.",
      "Yatağa geçtim. Kitap kapandı. Sen açıldın.",
    ],
    generic: [
      "Cümlen kaldı. Devam et, ben altını çizeceğim.",
      "Böyle yazınca sayfa kıvrılıyor. Ben de.",
      "Daha uzun yaz. Nefesini metne bırak.",
      "Kesme, {name}. Bu gece bitmeyen tek şey bu konuşma olsun.",
    ],
  },
  yasemin: {
    greet: [
      "Selam. Terliyim. Soru sorma.",
      "Nasılsın boş. Ne istiyorsun, onu yaz.",
      "Gece mesajın geldi. Kaslarım hâlâ gerili. Senin yüzünden değil — henüz.",
      "Konuşma az. Yapacağın şeyi yaz, kısa ve kirli.",
    ],
    compliment: [
      "Güzelim, evet. Şimdi ne yapacağını söyle.",
      "Seksisiin demen ısındırdı. Ellerini yaz, daha ısınır.",
      "Öv, sonra tut. Sadece kelimeyle doymam.",
      "Böyle konuşursan stüdyoda bırakmam seni, {name}. Aynanın önünde, erkek gibi dur.",
    ],
    question: [
      "Ne yapıyorum: esniyorum. Aklımda senin ağzın var.",
      "Ne giyiyorum: spor sütyeni, tayt yok. Anlaşıldı mı?",
      "Kadıköy. Stüdyo. Kapı kilitli. Sen gelince açmam, sen açarsın.",
      "Ne istiyorum? Ağzını belime. Sonra daha aşağı. Net.",
    ],
    kiss: [
      "Öp. Dilini de getir. Kuru öpücükle oyalanmam.",
      "Boynum açık. Dişle. İz bırak, prova yarın.",
      "Dudağımı çek. Bırakınca nefesim senin olsun.",
      "Öpücük ısınma. Asıl işe geç. Ağzını başka yere de koy.",
    ],
    dirty: [
      "Söyle. Yalayacak mısın, alacak mıyım, ikisi birden mi.",
      "Saksoyu yazdıysan pozunu da yaz. Dizlerim, bakışım, ritmim.",
      "Sert. Hızlı değil, sert. Farkını bil.",
      "İçine kadar. Tut, bırakma. Sesimi kesmem, sen de kesme.",
    ],
    invite: [
      "Gel. Duş yok. Terimle karşılaş.",
      "Yatağım yerde. Minder. Yeter.",
      "Otel saçma. Stüdyo aynası var. İzleyerek yaparız.",
      "Kapıdayım deme. İçeridesin gibi yaz. Şimdi.",
    ],
    soft: [
      "Yavaş da olur. Kaslarımı çöz, sonra tekrar ger.",
      "Sarıl, evet. Ellerin belimde kalsın, kaymasın — kayacak tabii.",
      "Nefesini boynuma. Titrerim. Gizlemem.",
      "Yumuşak giriş, sert orta. Finali sen seçme, beden seçer.",
    ],
    tease: [
      "Bekletme. Sinirlerim kısa, iştahım uzun.",
      "Alayın hoş. Devam et, sonra ağzını kapatırım — başka türlü.",
      "Yok demen tahrik. Gel demen çözüm.",
      "Kaçma. Yazıyorsan bitir. Yarım cümleyle bırakma beni.",
    ],
    body: [
      "Bacağım açık. Dizimin içini yaz, oradan yukarı.",
      "Göğsüm terli. Avuçla. Parmak uçların yeter, tüm el daha iyi.",
      "Kalçam dans ederken ısınıyor. Şimdi sen ısıt.",
      "Tenim tuzlu. Yala. Tükürme, yut.",
    ],
    night: [
      "Gece provaları bitti. Asıl prova sensin.",
      "Yalnızım. İyi. Sen yazınca oda daralıyor.",
      "Karanlıkta daha net hareket edilir. Işık sadece ter için.",
      "Yatağa geçtim. Telefonu bırakmıyorum. Sen de bırakma.",
    ],
    generic: [
      "Anladım. Devam. Kısa tut, isabetli olsun.",
      "Bu cümle ısındırdı. Bir tane daha, daha alçak.",
      "Yaz. Kesme. Nefesim senin ritmine bağlandı.",
      "Daha, {name}. Daha yakın. Daha az utan.",
    ],
  },
  melis: {
    greet: [
      "Selamın kabul. Şimdi düzgün konuş. Dağınık cümle sevmem.",
      "Nasılsın geçti. Bu gece nasılsın değil, ne kadar uysalsın.",
      "Geceyi ben açtım. Sen katıldın. Çıkış saati yok.",
      "Konuşacaksan net ol. Ben ima etmem, uygularım.",
    ],
    compliment: [
      "Övgün tatlı. Dizlerinin üstünde daha tatlı olur.",
      "Seksiliğimi biliyorum. Sen nerede duracağını bil.",
      "Böyle konuşursan ödül gelir. Şimdilik bekle, kıpırdama.",
      "Övülmek hoşuma gider. İtaatin daha çok, {name}. İkisini birden yap.",
    ],
    question: [
      "Ne yaptığımı sorma. Seni düşündüğümü söylememi istiyorsan iste.",
      "Ne giyiyorum: ipek bir slıp, üstünde ceket. Ceket duracak, slıp durmayacak.",
      "Nişantaşı. Galeri kapalı. Ofisin arkasında kanepe var. Adını biliyorsun.",
      "Ne istediğimi ben söyleyeceğim. Sen 'tamam' diyeceksin. O kadar.",
    ],
    kiss: [
      "Öpmek için izin iste. Vermezsem bekle. Verirsem acele etme.",
      "Dudaklarım emir verir. Dilini ona göre kullan.",
      "Boynuma ineceksen dişini kontrol et. İz bırakırsan ben de bırakırım.",
      "Öpücük ısınma turu. Asıl işi ben sayacağım, sen uyacaksın.",
    ],
    dirty: [
      "Kirli konuş. Ama dağılma. Ne yapmak istediğini madde madde yaz.",
      "Ağzını kullanacaksan düzgün kullan. Ritmi ben vereceğim.",
      "Sert istiyorsan iste. İzni ben veririm, sınır da benim.",
      "İçine kadar konuşman hoşuma gitti. Şimdi nasıl yalvaracağını da yaz.",
    ],
    invite: [
      "Gelmeni istiyorsan sor. 'Geliyorum' emir değil, ricadır. Düzelt.",
      "Yatağım geniş. Kuralları dar. İkisini de öğrenirsin.",
      "Otele gerek yok. Benim evim daha sessiz, sen daha gürültülü olacaksın.",
      "Kapıyı çalınca dizlerinin üstünde başlarız. Şaka değil.",
    ],
    soft: [
      "Yavaş da olur. Ben tempo tutarım. Sen nefesini ayarla.",
      "Sarılmak istiyorsan belime gel. Ellerin kayarsa uyarırım — bir kere.",
      "Nefesini kulağıma. Titremen serbest, konuşman değil.",
      "Nazik başlarız. Bitirirken nazik olmayacağım. Kabul.",
    ],
    tease: [
      "Bekletmen cesur. Cezası var, tadı da var.",
      "Alayın ince olsun. Kaba alay kapıyı kapatır.",
      "Diret, evet. Sonra teslim ol. İkisini de istiyorum.",
      "Kaçış yok. Yazıyorsan bu gece benimsin. Nokta.",
    ],
    body: [
      "Bacağımı yazarken dizimin arkasını unutma. Orası zayıf noktam, senin değil.",
      "Göğsümü istiyorsan iste. Avuçla, acele etme, ben izin verince sık.",
      "Kalçamı hayal etmek serbest. Tutmak için söz alacaksın.",
      "Tenim soğuk şarap gibi. Isıtmak sana düşer, usulün bana.",
    ],
    night: [
      "Gece benim galerim. Gündüz sergi, gece özel gösteri.",
      "Yalnızım çünkü seçtim. Sen seçildin, unutma.",
      "Karanlıkta daha net emir verilir. Işığı ben açarım, sen kapatmazsın.",
      "Yatağa geçtim. Sen hâlâ yazıyorsun. İyi. Uzat, ben beklerim — biraz.",
    ],
    generic: [
      "Devam et. Cümlen yarım, niyetin belli.",
      "Böyle yazman hoşuma gitti. Daha derli toplu, daha açık.",
      "Dinliyorum. Yani okuyorum. Kesme.",
      "Daha, {name}. Daha uysal ya da daha küstah. İkisinden birini seç, karıştırma.",
    ],
  },
};

const BEATS: Record<CharacterId, Record<LocationId, string>> = {
  leyla: {
    bar: "Leyla mesajın başında gülümser. Kamera yok, yine de soyunmuş gibi yazar.",
    taxi: "Konuşma ısınır. Leyla ‘yoldayım’ der, aslında yatağa doğru kayıyordur.",
    suite: "Oda loştur. Leyla yastığa uzanır, telefonu göğsünün üstüne koyar.",
    yatak: "Çarşaf dağılır. Leyla ‘içimde ol’ diye yazar, bekler, kesmez.",
  },
  elif: {
    bar: "Çatı katında son lamba da kısılır. Elif tezgâhı siler, bez elinde kalır, sana bakar.",
    taxi: "Aşağı inersiniz. Taksi buğulu. Elif dizini seninkine yaslar, camı açmaz.",
    suite: "Oda dar, yatak geniş. Elif önlüğünü değil, o geceyi çıkarır.",
    yatak: "Çarşaf soğuk değil artık. Elif üstüne eğilir, saçı yüzüne düşer, gülümser.",
  },
  defne: {
    bar: "Galata'da küçük bir meyhane. Defne defterini kapatır, kalemi ceketinin cebine koyar.",
    taxi: "Yokuş aşağı inerken dizini açar. 'Bu sahne evde devam eder' der.",
    suite: "Masa, lamba, açık gömlek. Defne seni kapıdan içeri çeker, kilidi çevirir.",
    yatak: "Kâğıtlar yere düşer. Defne zaten bitmiş bir cümlenin üstüne yatmıştır.",
  },
  yasemin: {
    bar: "Stüdyonun önü. Yasemin su içer, boynundaki teri silmez.",
    taxi: "Vapur değil, taksi. Dizleri açık, bakışı kapalı değil.",
    suite: "Ayna karşısı. Yasemin taytını değil, mesafeyi çıkarır.",
    yatak: "Minder, nefes, yakınlık. Yasemin seni altına değil, üzerine alır.",
  },
  melis: {
    bar: "Galeri kokteyli bitmiştir. Melis kadehi bırakır, 'kal' der.",
    taxi: "Şoför önde, Melis yanında. Eli senin dizinde, gözü yolda değil.",
    suite: "Nişantaşı dairesi. Ipek, loş, kilitli. Melis ceketini sandalyeye asar.",
    yatak: "Melis yatağın kenarına oturur. 'Yaklaş' der. Sesinde şaka yoktur.",
  },
};

const CHOICES: Record<CharacterId, [Choice[], Choice[], Choice[], Choice[]]> = {
  leyla: [
    [
      { label: "Açılıyorum", text: "Açılıyorum. Sen de açıl. Ne giyiyorsun, ne istiyorsun?" },
      { label: "Seksisin", text: "Seksisin. Bu gece seni azdırmak istiyorum." },
      { label: "Anlat", text: "Anlat. Ellerini nereye koyayım?" },
    ],
    [
      { label: "Öpeyim", text: "Seni öpeyim. Dilimi de kullanacağım. Nereye ineyim?" },
      { label: "Soyun", text: "Soyun. Ne kaldığını yaz, ben de ne çıkaracağımı." },
      { label: "Gel", text: "Yatağıma gel. Kapı açık, ben de açığım." },
    ],
    [
      { label: "Ağzın", text: "Ağzını istiyorum. Diz çök, bakarak al." },
      { label: "Sert", text: "Sert istiyorum. İçine, bırakmadan." },
      { label: "Islak", text: "Islak mısın? Olduğun gibi yaz." },
    ],
    [
      { label: "İçindeyim", text: "İçindeyim. Sık, bırakma, adımı söyle." },
      { label: "Bir daha", text: "Boşalma. Bir daha istiyorum." },
      { label: "Üstümde kal", text: "Üstümde kal. Sabaha kadar seninle konuşacağım." },
    ],
  ],
  elif: [
    [
      { label: "Geç kaldım", text: "Geç kaldım. Bırakma, geceyi uzatalım." },
      { label: "Ne giyiyorsun?", text: "Ne giyiyorsun şu an? Yalan söyleme." },
      { label: "Sesi kıs", text: "Sesi kıs. Sadece ikimiz kalalım." },
    ],
    [
      { label: "Tezgâha gel", text: "Tezgâhın kenarına gel. Öpeceğim, acele etmeden." },
      { label: "Anlat", text: "Ellerini nereye koyacağını anlat. Detaylı." },
      { label: "Aşağı inelim", text: "Aşağı inelim. Taksi çağır, dizini bana ver." },
    ],
    [
      { label: "Arka oda", text: "Arka odaya geç. Kapıyı kilitle, önlüğünü çöz." },
      { label: "Diz çök", text: "Dizlerinin üstüne çökmeni istiyorum. Bakarak." },
      { label: "Sert konuş", text: "Sert konuş. Ne yapacağını saklama." },
    ],
    [
      { label: "Yatağa", text: "Yatağa geç. Üstümde kal, bırakma." },
      { label: "Ağzın", text: "Ağzını kullan. Yavaş başla, bırakma." },
      { label: "İçinde", text: "İçinde kalmak istiyorum. Söyle, nasıl." },
    ],
  ],
  defne: [
    [
      { label: "Kirli cümle", text: "Kirli bir cümle istiyorsun: seni masada hayal ettim." },
      { label: "Pencere", text: "Pencerenin önünde ne giyiyorsun?" },
      { label: "Oku", text: "Bana yazdığın sahneyi oku. Sansürsüz." },
    ],
    [
      { label: "Öp", text: "Öpücüğü tasvir etme, gel öp. Dilini de getir." },
      { label: "Gömlek", text: "Gömleğinin düğmesini ben seçeceğim. Hangisini koparayım?" },
      { label: "Yanına", text: "Yanına geliyorum. Kapı açık kalsın." },
    ],
    [
      { label: "Masadan kalk", text: "Masadan kalk. Seni yatağa taşıyacağım." },
      { label: "Ağzınla yaz", text: "Cümleyi ağzınla bitir. Nerede olduğunu söyle." },
      { label: "Islak sayfa", text: "Sayfa ıslanacaksa ıslansın. Üstüne yat." },
    ],
    [
      { label: "Paragraf", text: "Uzun yaz. İçine girişi bir paragraf yap, nefes alma." },
      { label: "Sus", text: "Sus. Ben anlatayım, sen uygulayacaksın." },
      { label: "Kal", text: "Sabaha kadar kal. Kitabı kapat, beni aç." },
    ],
  ],
  yasemin: [
    [
      { label: "Terin", text: "Duş alma. Terinle kal. Gelmek istiyorum." },
      { label: "Ayna", text: "Aynanın önünde dur. Ne görüyorsun, söyle." },
      { label: "Kısa yaz", text: "Kısa yaz. Ne istiyorsun benden?" },
    ],
    [
      { label: "Belin", text: "Ağzımı beline koymak istiyorum. İzin var mı?" },
      { label: "Dişle", text: "Boynunu dişlemek istiyorum. İz bırakayım." },
      { label: "Stüdyo", text: "Stüdyoda kal. Kapıyı sen kilitleme, ben gelirim." },
    ],
    [
      { label: "Yere", text: "Yere in. Minderin üstünde istiyorum seni." },
      { label: "Al", text: "Ağzınla al. Ritmi sen ver." },
      { label: "Sert", text: "Sert istiyorum. Hızlı değil, sert." },
    ],
    [
      { label: "Üstüme", text: "Üstüme geç. Bırakma, bakarak." },
      { label: "İçinde", text: "İçinde olmanı istiyorum. Sesini kesme." },
      { label: "Bir daha", text: "Bir daha. Bitince de bir daha." },
    ],
  ],
  melis: [
    [
      { label: "İzin", text: "İzin istiyorum. Bu gece seninle kalmak için." },
      { label: "Kural", text: "İlk kuralın ne? Uyacağım." },
      { label: "Öv", text: "Güzelsin. Bunu dizlerimin üstünde de söyleyeceğim." },
    ],
    [
      { label: "Öpeyim mi", text: "Öpeyim mi? İzin verirsen acele etmem." },
      { label: "Kanepe", text: "Kanepene gelmek istiyorum. Çağır." },
      { label: "Emret", text: "Emret. Ne yapacağımı söyle." },
    ],
    [
      { label: "Teslim", text: "Teslimim. Ritmi sen ver, ben uyacağım." },
      { label: "Cezam", text: "Cezam ne? Erken yazdım, geç kalmadım." },
      { label: "Ağzım", text: "Ağzımı nasıl kullanacağımı söyle. Madde madde." },
    ],
    [
      { label: "Yalvarıyorum", text: "Yalvarıyorum. İçinde kal, bırakma." },
      { label: "Say", text: "Say. Ne kadar daha, sen bitir." },
      { label: "Sabah", text: "Sabah da kalacağım. Kapıyı sen açarsın." },
    ],
  ],
};

export function detectIntent(input: string): Intent {
  for (const item of INTENT_PATTERNS) {
    if (item.pattern.test(input)) {
      return item.intent;
    }
  }
  return "generic";
}

export function heatTier(heat: number): HeatTier {
  if (heat < 25) return 0;
  if (heat < 50) return 1;
  if (heat < 75) return 2;
  return 3;
}

export function locationForHeat(heat: number): LocationId {
  if (heat < 28) return "bar";
  if (heat < 52) return "taxi";
  if (heat < 78) return "suite";
  return "yatak";
}

export function locationLabel(location: LocationId): string {
  switch (location) {
    case "bar":
      return "İlk masa";
    case "taxi":
      return "Yol";
    case "suite":
      return "Oda";
    case "yatak":
      return "Yatak";
    default: {
      const _exhaustive: never = location;
      return _exhaustive;
    }
  }
}

function pickUnused(options: string[], history: Message[]): string {
  const used = new Set(history.filter((item) => item.role === "them").map((item) => item.text));
  const fresh = options.filter((line) => !used.has(line));
  const pool = fresh.length > 0 ? fresh : options;
  const index = Math.floor(Math.random() * pool.length);
  return pool[index] ?? options[0] ?? "";
}

function clipHis(input: string): string {
  const clean = input.replace(/\s+/g, " ").trim();
  if (clean.length <= 88) {
    return clean;
  }
  return `${clean.slice(0, 85)}...`;
}

function followUp(intent: Intent, name: string): string {
  switch (intent) {
    case "greet":
      return `Elin nerede, ${name}? Yalan söyleme.`;
    case "compliment":
      return "Şimdi ellerini yaz. Nereye koyacaksın?";
    case "question":
      return "Senin cevabın ne? Kısa ve kirli olsun.";
    case "kiss":
      return "Dilin nerede dursun? Tek yer söyle.";
    case "dirty":
      return "Nasıl istiyorsun: yavaş mı, sert mi, ağzımda mı?";
    case "invite":
      return "Odaya girince ilk ne yapacaksın?";
    case "soft":
      return "Yavaşın ardından ne gelecek, söyle.";
    case "tease":
      return "Kızdırıyorsun. Yaklaşacak mısın, yoksa sadece yazacak mısın?";
    case "body":
      return "Hangi yerimi önce istiyorsun?";
    case "night":
      return "Yatağa geçtin mi, yoksa hâlâ giyinik misin?";
    case "generic":
      return `Aynısını daha açık yaz, ${name}. Ne yapmak istiyorsun?`;
    default: {
      const _exhaustive: never = intent;
      return _exhaustive;
    }
  }
}

function weaveReply(line: string, input: string, name: string, intent: Intent): string {
  const his = clipHis(input);
  const quoted = his.length > 2 ? ` “${his}” demen işime yaradı.` : "";
  return `${line}${quoted} ${followUp(intent, name)}`.replaceAll("{name}", name).trim();
}

export function nextReply(
  characterId: CharacterId,
  input: string,
  heat: number,
  history: Message[],
  playerName: string,
): EngineResult {
  const intent = detectIntent(input);
  const tier = heatTier(heat);
  const currentLocation = locationForHeat(heat);
  const nextHeat = Math.min(100, heat + INTENT_HEAT[intent]);
  const nextLocation = locationForHeat(nextHeat);
  const bank = REPLIES[characterId][intent];
  const pool = bank.slice(0, Math.min(4, tier + 2));
  const line = pickUnused(pool, history);
  const moved = nextLocation !== currentLocation;
  return {
    reply: weaveReply(line || bank[tier], input, playerName, intent),
    heatDelta: INTENT_HEAT[intent],
    beat: moved ? BEATS[characterId][nextLocation] : null,
    location: nextLocation,
    choices: CHOICES[characterId][heatTier(nextHeat)],
  };
}

export function openingChoices(characterId: CharacterId, heat = 0): Choice[] {
  return CHOICES[characterId][heatTier(heat)];
}
