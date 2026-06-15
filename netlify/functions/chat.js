// netlify/functions/chat.js
// YAPIŞTIR-KAYDET-SİL modu. Hesaplama YOK. Sadece formatlı metni ayrıştırır,
// Supabase'e yazar/siler. Gemini çağrısı yok → aptallaşacak parça yok.
//
// DESTEKLENEN GİRİŞLER:
//
// 1) ÖĞÜN ekle (| ile ayrılmış):
//    Akşam | 5 köfte, 6 yk makarna | 520 kcal | P:38 K:55 Y:18
//    ("kcal" ve "P:/K:/Y:" sırası serbest, eksik olan 0 sayılır)
//
// 2) KİLO ekle:
//    Kilo | 92.3
//    Kilo | 92.3 | yag:21 kas:53 su:59
//
// 3) ANTRENMAN ekle:
//    Antrenman | Göğüs & Triceps | Bench 80kg 4x8; Incline 30kg 3x10 | Kardiyo: koşu 30dk 300kcal
//
// 4) SİLME:
//    "bugünkü yediklerimi sil"  → o günün tüm öğünleri
//    "akşam öğününü sil"        → o günün belirtilen öğünü
//    "kiloyu sil"               → o günün kilo kaydı
//    "antrenmanı sil"           → o günün antrenmanı
//    "bugünü tamamen sil"       → o günün her şeyi

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== "POST") return json({ cevap: "Sadece POST." });

    const body = JSON.parse(event.body || "{}");
    const mesaj = String(body.mesaj || "").trim();
    const tarih = String(body.tarih || "").trim() || bugun();
    const gorsel = body.gorsel || null; // base64 görsel (tartı/tahlil)
    const gorselTip = body.gorsel_tip || "tarti"; // "tarti" | "tahlil"

    const SB_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
    const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
    if (!SB_URL || !KEY) return json({ cevap: "Supabase ortam değişkenleri eksik." });

    const ctx = { SB_URL, KEY, tarih };

    // ---- GÖRSEL GELDİYSE: Gemini ile oku, onaya sun (kaydetme) ----
    if (gorsel) {
      return await gorselOku(gorsel, gorselTip, tarih);
    }

    // ---- PDF METNİ GELDİYSE (tahlil): Gemini ayrıştırsın, onaya sun ----
    if (body.pdf_metin) {
      return await tahlilMetniOku(String(body.pdf_metin), tarih);
    }

    if (!mesaj) return json({ cevap: "Mesaj boş." });

    // ---- ONAY MI? (görsel okuması sonrası "evet/onayla/kaydet") ----
    const onay = onayKomutu(mesaj, body.bekleyen);
    if (onay) return await onayliKaydet(ctx, onay);

    // ---- SİLME KOMUTU MU? ----
    const silme = silmeKomutu(mesaj, tarih);
    if (silme) return await silmeYap(ctx, silme, mesaj);

    // ---- KALORİ HEDEFİ GÜNCELLEME Mİ? ----
    const hedef = hedefKomutu(mesaj, tarih);
    if (hedef) return await hedefGuncelle(ctx, hedef);

    // ---- 1) FORMAT (| ile) — en kesin, yiyecekler doğru okunur ----
    const tip = girisTipi(mesaj);
    if (tip === "kilo") return await kiloKaydet(ctx, mesaj);
    if (tip === "antrenman") return await antrenmanKaydet(ctx, mesaj);
    if (tip === "ogun") return await ogunKaydet(ctx, mesaj);

    // ---- 2) KOD İLE DENE (| yoksa): TOPLAM/değer içeren serbest metin ----
    const rapor = raporParse(mesaj);
    if (rapor) return await ogunKaydetDirekt(ctx, rapor);

    // ---- 3) GEMINI İLE ANLA (kod çözemedi ama yemek gibi görünüyor) ----
    if (yemekGibiMi(mesaj)) {
      const geminiSonuc = await geminiOgunAnla(mesaj);
      if (geminiSonuc) return await ogunKaydetDirekt(ctx, geminiSonuc);
      // Gemini de başarısızsa yönlendirmeye düş
    }

    // ---- HİÇBİRİ DEĞİLSE: YÖNLENDİR ----
    return json({
      cevap:
        "Anlayamadım 🤔 Şöyle yazabilirsin:\n\n" +
        "🍽️ Öğün: \"öğlen 5 köfte, pilav yedim, toplam 600 kalori 32 protein\"\n" +
        "⚖️ Kilo: \"Kilo | 92.3\"\n" +
        "💪 Antrenman: \"Antrenman | Göğüs | Bench 80kg 4x8\"\n" +
        "🗑️ Silme: \"bugünkü yediklerimi sil\"",
    });
  } catch (e) {
    return json({ cevap: "Hata: " + (e.message || String(e)) });
  }
};

// Mesaj yemek/öğün gibi mi görünüyor? (Gemini'ye sormaya değer mi)
function yemekGibiMi(mesaj) {
  const t = temizle(mesaj);
  // kalori/makro kelimesi VEYA yaygın yemek/eylem kelimeleri varsa
  if (/kalori|kcal|protein|karbonhidrat|makro/.test(t)) return true;
  if (/yedim|ictim|kahvalti|oglen|aksam|ara ?ogun|atistir|tukettim/.test(t)) return true;
  return false;
}

// Gemini ile serbest metinden öğün makrolarını anla
async function geminiOgunAnla(mesaj) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  const prompt = `Kullanıcı ne yediğini serbest şekilde yazdı. Toplam kalori ve makroları çıkar. Eğer kullanıcı zaten kalori/makro yazdıysa onları KULLAN, yazmadıysa yaygın porsiyonlara göre TAHMİN et. Öğün adını (kahvaltı/öğlen/akşam/ara öğün) metinden bul, yoksa "Öğün" yaz.

SADECE şu JSON, başka hiçbir şey yazma:
{"ogun":"Öğlen","yiyecekler":"kısa özet","kcal":600,"protein":32,"karb":61,"yag":26}

Kullanıcı mesajı:
${mesaj}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 800, responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } },
        }),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    let p;
    try {
      let tt = raw.trim().replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();
      p = JSON.parse(tt);
    } catch { return null; }
    const kcal = Math.round(Number(p.kcal) || 0);
    if (kcal <= 0) return null;
    return {
      ogun: p.ogun || "Öğün",
      yiyecekler: p.yiyecekler || mesaj.slice(0, 80),
      kcal,
      protein: Math.round(Number(p.protein) || 0),
      karb: Math.round(Number(p.karb) || 0),
      yag: Math.round(Number(p.yag) || 0),
    };
  } catch {
    return null;
  }
}

// ================= MARKDOWN RAPOR =================
// Gemini/Claude'un ürettiği tablolu raporu anlar. TOPLAM satırından
// gerçek kcal/protein/karb/yağ değerlerini çeker.

function raporParse(mesaj) {
  const t = temizle(mesaj);

  // Esnek okuma: değerleri nerede/nasıl yazılırsa yazılsın yakala.
  // "800 kcal", "kalori: 800", "800 kalori" → hepsi çalışır.
  const kcal = ilkSayi(mesaj, [
    /(\d{3,5})\s*kcal/i,
    /(\d{3,5})\s*kalori/i,
    /kalori\s*[:=]\s*(\d{3,5})/i,
    /toplam\s*[:=]?\s*(\d{3,5})/i,
  ]);

  const protein = ilkSayi(mesaj, [
    /protein\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i,
    /(\d+(?:[.,]\d+)?)\s*(?:g)?\s*protein/i,
    /\bp\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i,
  ]);

  const karb = ilkSayi(mesaj, [
    /karbonhidrat\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i,
    /(\d+(?:[.,]\d+)?)\s*(?:g)?\s*karbonhidrat/i,
    /\bkarb\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i,
    /\bk\s*[:=]\s*(\d+(?:[.,]\d+)?)/i,
  ]);

  const yag = ilkSayi(mesaj, [
    /ya[ğg]\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i,
    /(\d+(?:[.,]\d+)?)\s*(?:g)?\s*ya[ğg]/i,
    /\by\s*[:=]\s*(\d+(?:[.,]\d+)?)/i,
  ]);

  // En az kalori VEYA bir makro bulunduysa öğün say.
  if (kcal == null && protein == null && karb == null && yag == null) return null;

  // TOPLAM satırı varsa ONDAN AL (en güvenilir, çoklu yemekte toplam doğru olur)
  const toplamSatir = mesaj.split("\n").find((s) => /toplam/i.test(temizle(s)) && /\d/.test(s));
  let fKcal = kcal, fPro = protein, fKarb = karb, fYag = yag;
  if (toplamSatir) {
    // TOPLAM satırındaki değerleri etiketlerine göre çek (kalori/kcal, protein, karb, yağ)
    const tKcal = ilkSayi(toplamSatir, [/(\d{3,5})\s*kcal/i, /(\d{3,5})\s*kalori/i, /kalori\s*[:=]?\s*(\d{3,5})/i, /toplam\s*[:=]?\s*(\d{3,5})/i]);
    const tPro = ilkSayi(toplamSatir, [/protein\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i, /(\d+(?:[.,]\d+)?)\s*g?\s*protein/i]);
    const tKarb = ilkSayi(toplamSatir, [/karbonhidrat\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i, /(\d+(?:[.,]\d+)?)\s*g?\s*karbonhidrat/i, /karb\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i]);
    const tYag = ilkSayi(toplamSatir, [/ya[ğg]\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i, /(\d+(?:[.,]\d+)?)\s*g?\s*ya[ğg]/i]);
    if (tKcal != null) fKcal = tKcal;
    if (tPro != null) fPro = tPro;
    if (tKarb != null) fKarb = tKarb;
    if (tYag != null) fYag = tYag;
  }

  return {
    ogun: ogunTespit(t),
    yiyecekler: baslikYiyecek(mesaj) || "Çeşitli besinler",
    kcal: fKcal || 0,
    protein: fPro || 0,
    karb: fKarb || 0,
    yag: fYag || 0,
  };
}

// Verilen kalıplardan ilk eşleşeni döndürür (sayı veya null)
function ilkSayi(mesaj, kaliplar) {
  for (const re of kaliplar) {
    const m = mesaj.match(re);
    if (m) return Math.round(Number(m[1].replace(",", ".")));
  }
  return null;
}

function ogunTespit(t) {
  if (/kahvalti/.test(t)) return "Kahvaltı";
  if (/oglen|ogle/.test(t)) return "Öğlen";
  if (/aksam/.test(t)) return "Akşam";
  if (/ara ?ogun/.test(t)) return "Ara Öğün";
  return "Öğün";
}

function baslikYiyecek(mesaj) {
  // 1) Markdown **kalın** isimler
  const kalin = [...mesaj.matchAll(/\*\*(.+?)\*\*/g)]
    .map((m) => m[1].trim())
    .filter((x) =>
      !/toplam/i.test(x) && !/\d+\s*kcal/i.test(x) &&
      !/^[\d.,\s]+$/.test(x) &&
      !/degerlendirme|durum|analiz|gunluk|protein|karbonhidrat|ya[ğg]|kalori/i.test(temizle(x)) &&
      x.length < 50
    );
  if (kalin.length) return kalin.join(", ");

  // 2) İlk satır (genelde besin adı): "1,5 Adana Dürüm ve 1 Kola..." 
  const ilkSatir = mesaj.split("\n")[0].trim();
  // başlık temizle: "Tahmini Besin Değerleri" gibi kuyrukları at
  const temiz = ilkSatir
    .replace(/tahmini.*$/i, "")
    .replace(/besin de[ğg]er.*$/i, "")
    .replace(/makro.*$/i, "")
    .replace(/[#*]/g, "")
    .trim();
  if (temiz && temiz.length < 80 && !/^kalori|^protein|^toplam/i.test(temizle(temiz))) return temiz;

  return null;
}

async function ogunKaydetDirekt(ctx, r) {
  const res = await sbInsert(ctx, "ogunler", {
    tarih: ctx.tarih,
    ogun: r.ogun,
    yiyecekler: r.yiyecekler,
    kcal: r.kcal, protein: r.protein, karb: r.karb, yag: r.yag,
  });
  if (res.ok)
    return json({
      cevap: `✅ ${r.ogun} kaydedildi (${ctx.tarih})\n${r.kcal} kcal · P:${r.protein} K:${r.karb} Y:${r.yag}\n${r.yiyecekler}`,
      saved: true,
    });
  return json({ cevap: "⚠️ Kayıt yapılamadı: " + res.error, saved: false });
}

// ================= TİP TESPİTİ =================

function girisTipi(mesaj) {
  const ilk = mesaj.split("|")[0].trim().toLowerCase();
  if (/^kilo/.test(ilk)) return "kilo";
  if (/^antren|^antrenman/.test(ilk)) return "antrenman";
  // İçinde | varsa ve kcal/makro geçiyorsa öğün say
  if (mesaj.includes("|")) return "ogun";
  return "bilinmiyor";
}

// ================= ÖĞÜN =================

async function ogunKaydet(ctx, mesaj) {
  // Mesajı satırlara ayır: ilk satır = öğün başlığı, "-" ile başlayanlar = besinler
  const satirlar = mesaj.split("\n").map((s) => s.trim()).filter(Boolean);
  const basSatir = satirlar[0] || mesaj;
  const besinSatirlari = satirlar.slice(1).filter((s) => /^[-•*]/.test(s));

  // Başlık satırını ayrıştır: Öğün | (yiyecekler) | kcal | makro
  const p = basSatir.split("|").map((s) => s.trim());
  const ogunAdi = p[0] || "Öğün";

  // Besin satırlarını ayrıştır: "- ad | X kcal | P:.. K:.. Y:.."
  const besinler = besinSatirlari.map((s) => {
    const c = s.replace(/^[-•*]\s*/, "").split("|").map((x) => x.trim());
    const ad = c[0] || "";
    const kalan = c.slice(1).join(" ");
    return {
      ad,
      kcal: sayiBul(kalan, /(\d+)\s*kcal/i) ?? sayiBul(kalan, /(\d+)/) ?? 0,
      protein: sayiBul(kalan, /p\s*[:=]?\s*(\d+)/i) ?? 0,
      karb: sayiBul(kalan, /k\s*[:=]?\s*(\d+)/i) ?? 0,
      yag: sayiBul(kalan, /y\s*[:=]?\s*(\d+)/i) ?? 0,
    };
  }).filter((b) => b.ad);

  // Toplam: başlık satırında varsa oradan, yoksa besinlerden topla
  let kcal = sayiBul(p.slice(1).join(" "), /(\d+)\s*kcal/i);
  let protein = sayiBul(p.slice(1).join(" "), /p\s*[:=]?\s*(\d+)/i);
  let karb = sayiBul(p.slice(1).join(" "), /k\s*[:=]?\s*(\d+)/i);
  let yag = sayiBul(p.slice(1).join(" "), /y\s*[:=]?\s*(\d+)/i);
  if (besinler.length) {
    if (kcal == null) kcal = besinler.reduce((s, b) => s + b.kcal, 0);
    if (protein == null) protein = besinler.reduce((s, b) => s + b.protein, 0);
    if (karb == null) karb = besinler.reduce((s, b) => s + b.karb, 0);
    if (yag == null) yag = besinler.reduce((s, b) => s + b.yag, 0);
  }
  kcal = kcal || 0; protein = protein || 0; karb = karb || 0; yag = yag || 0;

  // Yiyecekler metni: besin varsa adlarını birleştir, yoksa başlıktaki 2. alan
  const yiyecekler = besinler.length
    ? besinler.map((b) => b.ad).join(", ")
    : (p[1] || mesaj);

  const r = await sbInsert(ctx, "ogunler", {
    tarih: ctx.tarih,
    ogun: ogunAdi,
    yiyecekler,
    kcal, protein, karb, yag,
    besinler: besinler.length ? besinler : null,
  });

  if (r.ok)
    return json({
      cevap: `✅ ${ogunAdi} kaydedildi (${ctx.tarih})\n${kcal} kcal · P:${protein} K:${karb} Y:${yag}${besinler.length ? `\n${besinler.length} besin` : ""}`,
      saved: true,
    });
  return json({ cevap: "⚠️ Kayıt yapılamadı: " + r.error, saved: false });
}

// ================= KİLO =================

async function kiloKaydet(ctx, mesaj) {
  const p = mesaj.split("|").map((s) => s.trim());
  const kilo = floatBul(p[1] || "", /(-?\d+(?:[.,]\d+)?)/);
  if (kilo == null) return json({ cevap: "Kilo değeri okunamadı. Örn: Kilo | 92.3" });

  const detay = p.slice(2).join(" ");
  const payload = { tarih: ctx.tarih, kilo };
  const yag = floatBul(detay, /yag\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i);
  const kas = floatBul(detay, /kas\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i);
  const su = floatBul(detay, /su\s*[:=]?\s*(\d+(?:[.,]\d+)?)/i);
  if (yag != null) payload.yag_orani = yag;
  if (kas != null) payload.kas_kg = kas;
  if (su != null) payload.su_orani = su;

  const r = await sbUpsert(ctx, "gunluk_olcum", payload, "tarih");
  if (r.ok) return json({ cevap: `✅ Kilo kaydedildi: ${kilo} kg (${ctx.tarih})`, saved: true });
  return json({ cevap: "⚠️ Kayıt yapılamadı: " + r.error, saved: false });
}

// ================= ANTRENMAN =================

async function antrenmanKaydet(ctx, mesaj) {
  const p = mesaj.split("|").map((s) => s.trim());
  const tip = p[1] || "Antrenman";
  const egzMetin = p[2] || "";
  const kardMetin = (p[3] || "").replace(/^kardiyo\s*[:=]?\s*/i, "");

  let egzersizler = egzMetin
    ? egzMetin.split(";").map((e) => {
        const t = e.trim();
        const ad = t.split(/\s+/)[0] ? t.replace(/\s+\d.*$/, "").trim() : t;
        const detay = t.replace(ad, "").trim();
        return { ad: ad || t, detay };
      }).filter((x) => x.ad)
    : [];

  // Hareket adlarını AI ile düzelt (chst press → Chest Press).
  // Gemini cevap vermezse orijinal haliyle kaydet — veri kaybı olmaz.
  if (egzersizler.length) {
    try {
      egzersizler = await egzersizAdlariniDuzelt(egzersizler);
    } catch (e) {
      console.error("Egzersiz düzeltme atlandı:", e.message);
    }
  }

  const kardiyo = kardMetin
    ? kardMetin.split(";").map((k) => {
        const t = k.trim();
        const sure = sayiBul(t, /(\d+)\s*dk/i) ?? 0;
        const kcal = sayiBul(t, /(\d+)\s*kcal/i) ?? 0;
        const ad = t.replace(/\d+\s*dk/i, "").replace(/\d+\s*kcal/i, "").trim() || "Kardiyo";
        return { ad, sure, kcal };
      }).filter((x) => x.ad)
    : [];

  const r = await sbUpsert(ctx, "antrenmanlar", {
    tarih: ctx.tarih, tip, egzersizler, kardiyo,
  }, "tarih");

  if (r.ok)
    return json({
      cevap: `✅ Antrenman kaydedildi: ${tip} (${ctx.tarih})\n${egzersizler.length} egzersiz, ${kardiyo.length} kardiyo`,
      saved: true,
    });
  return json({ cevap: "⚠️ Kayıt yapılamadı: " + r.error, saved: false });
}

async function egzersizAdlariniDuzelt(egzersizler) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return egzersizler; // key yoksa orijinali döndür

  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const adlar = egzersizler.map((e) => e.ad);

  const prompt = `Aşağıdaki fitness hareket isimlerini standart, doğru yazımlarına çevir (Türkçe veya İngilizce yaygın isimle). Sadece JSON dizi döndür, başka hiçbir şey yazma. Örnek giriş: ["chst press","incln dmbl","lat puldown"] → ["Chest Press","Incline Dumbbell Press","Lat Pulldown"].\n\nGiriş: ${JSON.stringify(adlar)}`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 500, responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } },
      }),
    }
  );
  if (!res.ok) throw new Error("Gemini " + res.status);
  const data = await res.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  let duzeltilmis;
  try {
    let t = raw.trim().replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();
    duzeltilmis = JSON.parse(t);
  } catch {
    return egzersizler; // parse edilemezse orijinal
  }
  if (!Array.isArray(duzeltilmis) || duzeltilmis.length !== egzersizler.length) return egzersizler;

  return egzersizler.map((e, i) => ({ ad: duzeltilmis[i] || e.ad, detay: e.detay }));
}

// ================= TAHLİL PDF METNİ AYRIŞTIRMA =================

async function tahlilMetniOku(metin, tarih) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return json({ cevap: "Tahlil okuma için GEMINI_API_KEY gerekli." });
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  // Metni makul boyuta kırp (çok uzunsa Gemini'yi zorlamasın)
  const kisaMetin = metin.slice(0, 28000);

  const prompt = `Bu bir laboratuvar kan tahlili raporunun metni. İçindeki TÜM test parametrelerini ayrıştır. Yorum yapma, sadece veriyi çıkar.

ÖNEMLİ - RAPOR TARİHİ: Raporun "Numune Alma Zamanı" tarihini bul (kanın alındığı gün). Bunu YYYY-MM-DD formatında "rapor_tarihi" alanına yaz. Örnek: "13.06.2026 09:26" → "2026-06-13". Numune alma zamanı yoksa numune kabul veya istem zamanını kullan.

Her parametre için şu alanları bul:
- ad: tetkik adı (örn "Vitamin B12", "TSH", "Demir")
- deger: güncel sonuç (sayı, birimiyle örn "547 pg/mL")
- referans: referans aralığı (örn "187 - 914")
- onceki: önceki sonuç varsa (örn "697 pg/mL"), yoksa boş
- durum: değer referans aralığının ALTINDAysa "lo", ÜSTÜNDEyse "hi", İÇİNDEyse "ok". Belirsizse "ok".

"Çalışılıyor" yazan veya sonucu olmayan parametreleri ATLA.

SADECE şu JSON formatında dön, başka hiçbir şey yazma:
{"baslik":"Kan Tahlili","rapor_tarihi":"2026-06-13","degerler":[{"ad":"...","deger":"...","referans":"...","onceki":"...","durum":"ok"}]}

Tahlil metni:
${kisaMetin}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 8000, responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } },
        }),
      }
    );
    const data = await res.json();
    if (!res.ok) {
      const msg = data?.error?.message || JSON.stringify(data).slice(0, 200);
      return json({ cevap: "Tahlil okunamadı: " + msg });
    }
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    let okunan;
    try {
      let t = raw.trim().replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();
      okunan = JSON.parse(t);
    } catch {
      return json({ cevap: "Tahlil ayrıştırılamadı. PDF çok büyük olabilir, tekrar dener misin?" });
    }

    const deg = okunan.degerler || [];
    if (!deg.length) return json({ cevap: "Tahlilde değer bulunamadı." });

    // PDF'teki rapor tarihini kullan (yükleme günü değil)
    let tahlilTarih = tarih;
    if (okunan.rapor_tarihi && /^\d{4}-\d{2}-\d{2}$/.test(okunan.rapor_tarihi)) {
      tahlilTarih = okunan.rapor_tarihi;
    }

    // Anormal olanları özetle (hepsini değil, çok uzun olmasın)
    const anormal = deg.filter((d) => d.durum === "lo" || d.durum === "hi");
    let ozet = `📋 Tahlilden ${deg.length} parametre okudum.\n📅 Tahlil tarihi: ${tahlilTarih}\n\n`;
    if (anormal.length) {
      ozet += `⚠️ Aralık dışı ${anormal.length} değer:\n`;
      ozet += anormal.slice(0, 15).map((d) => `• ${d.ad}: ${d.deger} (${d.durum === "lo" ? "düşük" : "yüksek"})`).join("\n");
      if (anormal.length > 15) ozet += `\n… ve ${anormal.length - 15} tane daha`;
    } else {
      ozet += "✅ Tüm değerler referans aralığında görünüyor.";
    }
    ozet += `\n\n✅ Kaydetmek için "evet" yaz, iptal için "hayır".`;

    return json({ cevap: ozet, bekleyen: { tip: "tahlil", tarih: tahlilTarih, veri: okunan } });
  } catch (e) {
    return json({ cevap: "Tahlil işlenirken hata: " + e.message });
  }
}

// ================= GÖRSEL OKUMA (TARTI / TAHLİL) =================

async function gorselOku(gorselBase64, tip, tarih) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return json({ cevap: "Görsel okuma için GEMINI_API_KEY gerekli." });
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const buYil = (tarih && /^\d{4}/.test(tarih)) ? tarih.slice(0, 4) : new Date().getFullYear();

  // base64'ten data prefix'i ayıkla
  let veri = gorselBase64;
  let mime = "image/jpeg";
  const m = gorselBase64.match(/^data:(image\/\w+);base64,(.+)$/);
  if (m) { mime = m[1]; veri = m[2]; }

  const prompt = tip === "tahlil"
    ? `Bu bir kan tahlili sonuç görseli. İçindeki TÜM test parametrelerini oku. Yorum yapma, sadece oku. Her parametre için: ad, değer (sayı+birim), referans aralığı, ve durum (deger referansın altındaysa "lo", üstündeyse "hi", aralıktaysa "ok"). Sadece şu JSON: {"tip":"tahlil","baslik":"Tahlil türü varsa","degerler":[{"ad":"Hemoglobin","deger":"14.2 g/dL","referans":"13-17","durum":"ok"}]}`
    : `Bu bir akıllı tartı / vücut analizi ekranı görseli (Zepp/Mi Fit gibi). Şu değerleri oku, yorum yapma sadece oku: ağırlık (kg), vücut yağ oranı (%), kas kütlesi (kg), su oranı (%), kemik kütlesi (kg), bazal metabolizma, visseral yağ. AYRICA ekranda ölçüm tarihi varsa (örn "8 Haziran 19:51", "08.06.2026") onu YYYY-MM-DD formatında "olcum_tarihi" alanına yaz; yıl belirtilmemişse ${buYil} varsay; tarih yoksa boş bırak. Bulamadığın alanı yazma. Sadece şu JSON: {"tip":"tarti","kilo":0,"yag_orani":0,"kas_kg":0,"su_orani":0,"kemik_kg":0,"metabolik":0,"viseral":0,"olcum_tarihi":""}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: veri } }] }],
          generationConfig: { maxOutputTokens: 1500, responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } },
        }),
      }
    );
    const data = await res.json();
    if (!res.ok) {
      const msg = data?.error?.message || JSON.stringify(data).slice(0, 200);
      return json({ cevap: "Görsel okunamadı: " + msg });
    }
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    let okunan;
    try {
      let t = raw.trim().replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();
      okunan = JSON.parse(t);
    } catch {
      return json({ cevap: "Görseldeki değerler okunamadı, tekrar dener misin veya değerleri yazar mısın?" });
    }

    // Onay metni hazırla
    if (tip === "tahlil") {
      const deg = okunan.degerler || [];
      if (!deg.length) return json({ cevap: "Tahlilde değer okunamadı. Daha net bir görsel dener misin?" });
      const ozet = deg.map(d => `• ${d.ad}: ${d.deger} (${d.durum === "lo" ? "düşük" : d.durum === "hi" ? "yüksek" : "normal"})`).join("\n");
      return json({
        cevap: `📋 Tahlilden şunları okudum (${tarih}):\n\n${ozet}\n\n✅ Doğruysa "evet" yaz, kaydedeyim. Yanlışsa "hayır" yaz.`,
        bekleyen: { tip: "tahlil", tarih, veri: okunan },
      });
    } else {
      const satir = [];
      if (okunan.kilo) satir.push(`Kilo: ${okunan.kilo} kg`);
      if (okunan.yag_orani) satir.push(`Yağ: %${okunan.yag_orani}`);
      if (okunan.kas_kg) satir.push(`Kas: ${okunan.kas_kg} kg`);
      if (okunan.su_orani) satir.push(`Su: %${okunan.su_orani}`);
      if (!satir.length) return json({ cevap: "Tartı değerleri okunamadı. Daha net bir görsel dener misin?" });
      // Görselde ölçüm tarihi varsa onu kullan, yoksa seçili gün
      let olcumTarih = tarih;
      if (okunan.olcum_tarihi && /^\d{4}-\d{2}-\d{2}$/.test(okunan.olcum_tarihi)) {
        olcumTarih = okunan.olcum_tarihi;
      }
      return {
        statusCode: 200, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cevap: `⚖️ Tartıdan şunları okudum:\n📅 Ölçüm tarihi: ${olcumTarih}\n\n${satir.join("\n")}\n\n✅ Doğruysa "evet" yaz, kaydedeyim. Yanlışsa "hayır" yaz.`,
          bekleyen: { tip: "tarti", tarih: olcumTarih, veri: okunan },
        }),
      };
    }
  } catch (e) {
    return json({ cevap: "Görsel işlenirken hata: " + e.message });
  }
}

function onayKomutu(mesaj, bekleyen) {
  if (!bekleyen) return null;
  const t = temizle(mesaj);
  if (/hayir|iptal|yanlis|olmaz|vazgec/.test(t)) return { iptal: true };
  if (/evet|onayla|onaylad|dogru|kaydet|tamam|olur|kabul/.test(t)) return bekleyen;
  return null;
}

async function onayliKaydet(ctx, bekleyen) {
  if (bekleyen.iptal) return json({ cevap: "İptal edildi, kaydetmedim. İstersen tekrar fotoğraf yükle." });
  const tarih = bekleyen.tarih || ctx.tarih;
  if (bekleyen.tip === "tarti") {
    const v = bekleyen.veri;
    const payload = { tarih };
    if (v.kilo) payload.kilo = num(v.kilo, true);
    if (v.yag_orani) payload.yag_orani = num(v.yag_orani, true);
    if (v.kas_kg) payload.kas_kg = num(v.kas_kg, true);
    if (v.su_orani) payload.su_orani = num(v.su_orani, true);
    if (v.kemik_kg) payload.kemik_kg = num(v.kemik_kg, true);
    if (v.metabolik) payload.metabolik_yas = num(v.metabolik);
    if (v.viseral) payload.viseral = num(v.viseral);
    const r = await sbUpsert({ ...ctx, tarih }, "gunluk_olcum", payload, "tarih");
    if (r.ok) return json({ cevap: `✅ Tartı kaydedildi (${tarih}): ${v.kilo} kg`, saved: true });
    return json({ cevap: "⚠️ Kayıt yapılamadı: " + r.error });
  }
  if (bekleyen.tip === "tahlil") {
    const v = bekleyen.veri;
    // Aynı tarihte tahlil varsa önce sil (üzerine yazma)
    await sbDelete({ ...ctx, tarih }, `tahliller?tarih=eq.${tarih}`);
    const r = await sbInsert({ ...ctx, tarih }, "tahliller", {
      tarih,
      baslik: v.baslik || "Kan Tahlili",
      degerler: v.degerler || [],
    });
    if (r.ok) return json({ cevap: `✅ Tahlil kaydedildi (${tarih}): ${(v.degerler || []).length} parametre`, saved: true });
    return json({ cevap: "⚠️ Kayıt yapılamadı: " + r.error });
  }
  return json({ cevap: "Onaylanacak bir şey yok." });
}

// ================= KALORİ HEDEFİ =================
// "almam gereken kaloriyi 2000'e çıkar", "kalorimi 1900'e düşür",
// "hedefi 2200 yap", "1 temmuzdan itibaren 2000" gibi cümleleri anlar.

function hedefKomutu(mesaj, varsayilanTarih) {
  const t = temizle(mesaj);
  // Yemek bildirimi ise (yedim/içtim) kesinlikle hedef değil
  if (/yedim|ictim|tukettim|atistirdim/.test(t)) return null;
  // "kalori" veya "hedef" + bir sayı + değiştirme fiili geçmeli
  if (!/kalori|kcal|hedef/.test(t)) return null;
  if (!/cikar|cikart|dusur|yap|guncelle|ayarla|olsun|ol\b|yukselt|indir|degistir|ayarl/.test(t)) return null;

  const sayilar = (mesaj.match(/\d{3,4}/g) || []).map(Number).filter((n) => n >= 800 && n <= 5000);
  if (!sayilar.length) return null;
  const kalori = sayilar[0];
  const baslangic = tarihBul(mesaj, varsayilanTarih) || varsayilanTarih;
  return { kalori, baslangic };
}

function tarihBul(mesaj, refTarih) {
  const t = temizle(mesaj);
  const aylar = { ocak:1, subat:2, mart:3, nisan:4, mayis:5, haziran:6, temmuz:7, agustos:8, eylul:9, ekim:10, kasim:11, aralik:12 };

  // "14 haziran" / "1 temmuz" (ay ismi)
  const m = t.match(/(\d{1,2})\s*(ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik)/);
  if (m) {
    const gun = String(m[1]).padStart(2, "0");
    const ay = String(aylar[m[2]]).padStart(2, "0");
    // yıl belirtilmişse al, yoksa bu yıl
    const yilM = t.match(/20\d{2}/);
    const yil = yilM ? yilM[0] : new Date().getFullYear();
    return `${yil}-${ay}-${gun}`;
  }

  // "14.06.2026" / "14/06/2026" / "14-06-2026"
  const m2 = t.match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](20\d{2})/);
  if (m2) {
    return `${m2[3]}-${String(m2[2]).padStart(2,"0")}-${String(m2[1]).padStart(2,"0")}`;
  }
  // "2026-06-14" (zaten ISO)
  const m3 = t.match(/(20\d{2})-(\d{1,2})-(\d{1,2})/);
  if (m3) return `${m3[1]}-${String(m3[2]).padStart(2,"0")}-${String(m3[3]).padStart(2,"0")}`;

  const baz = refTarih ? new Date(refTarih) : new Date();
  if (/yarin/.test(t)) { baz.setDate(baz.getDate() + 1); return baz.toISOString().slice(0, 10); }
  if (/dun/.test(t)) { baz.setDate(baz.getDate() - 1); return baz.toISOString().slice(0, 10); }
  if (/bugun/.test(t)) return refTarih || new Date().toISOString().slice(0, 10);
  return null;
}

async function hedefGuncelle(ctx, hedef) {
  const r = await sbInsert(ctx, "hedefler", {
    baslangic_tarih: hedef.baslangic,
    kalori: hedef.kalori,
  });
  if (r.ok)
    return json({
      cevap: `🎯 Kalori hedefin güncellendi: ${hedef.kalori} kcal\n📅 ${hedef.baslangic} tarihinden itibaren geçerli.`,
      saved: true,
    });
  return json({ cevap: "⚠️ Hedef güncellenemedi: " + r.error });
}

// ================= SİLME =================

function silmeKomutu(mesaj, ctxTarih) {
  // Formatlı kayıt (| içeren) ASLA silme değildir — önce bunu ele.
  if (mesaj.includes("|")) return null;

  const t = temizle(mesaj);
  // "sil" kelimesi bir kelime olarak geçmeli
  if (!/\bsil\b|siler|silmek|sildim ?mi|sil$/.test(t)) return null;

  if (/tamamen|hepsini|her ?seyi/.test(t)) return { ne: "hepsi" };

  // ---- TAHLİL SİLME (tarihli) ----
  if (/tahlil|tetkik|kan ?sonuc|lab/.test(t)) {
    const tarih = tarihBul(mesaj, ctxTarih);
    return { ne: "tahlil", tarih: tarih || ctxTarih };
  }

  // ---- "X DIŞINDAKİ / X HARİÇ" öğün silme ----
  if (/disinda|haric|disindaki|haricindeki/.test(t)) {
    let koru = null;
    if (/kahvalti/.test(t)) koru = "Kahvaltı";
    else if (/oglen|ogle/.test(t)) koru = "Öğlen";
    else if (/aksam/.test(t)) koru = "Akşam";
    else if (/ara ?ogun/.test(t)) koru = "Ara Öğün";
    if (koru) return { ne: "ogun_haric", koru };
  }

  if (/kilo|tarti/.test(t)) return { ne: "kilo" };
  if (/antren/.test(t)) return { ne: "antrenman" };

  let ogun = null;
  if (/kahvalti/.test(t)) ogun = "Kahvaltı";
  else if (/oglen|ogle/.test(t)) ogun = "Öğlen";
  else if (/aksam/.test(t)) ogun = "Akşam";
  else if (/ara ?ogun/.test(t)) ogun = "Ara Öğün";
  if (/yedik|yemek|ogun|beslenme/.test(t) || ogun) return { ne: "ogun", ogun };
  return null;
}

async function silmeYap(ctx, silme, mesaj) {
  const yapilanlar = [];

  // Tahlil silme (belirtilen tarihte)
  if (silme.ne === "tahlil") {
    const tarih = silme.tarih || ctx.tarih;
    const r = await sbDelete(ctx, `tahliller?tarih=eq.${tarih}`);
    if (r.ok) return json({ cevap: `🗑️ ${tarih} tarihli tahlil silindi.`, saved: true });
    return json({ cevap: "⚠️ Silme yapılamadı: " + r.error });
  }

  // "X dışındaki öğünleri sil" — korunan hariç hepsini sil
  if (silme.ne === "ogun_haric") {
    const r = await sbDelete(ctx, `ogunler?tarih=eq.${ctx.tarih}&ogun=neq.${encodeURIComponent(silme.koru)}`);
    if (r.ok) return json({ cevap: `🗑️ Silindi (${ctx.tarih}): ${silme.koru} dışındaki öğünler`, saved: true });
    return json({ cevap: "⚠️ Silme yapılamadı: " + r.error });
  }

  if (silme.ne === "hepsi" || silme.ne === "ogun") {
    let path = `ogunler?tarih=eq.${ctx.tarih}`;
    if (silme.ne === "ogun" && silme.ogun) path += `&ogun=eq.${encodeURIComponent(silme.ogun)}`;
    const r = await sbDelete(ctx, path);
    if (r.ok) yapilanlar.push(silme.ogun ? `${silme.ogun} öğünü` : "öğünler");
  }
  if (silme.ne === "hepsi" || silme.ne === "kilo") {
    const r = await sbDelete(ctx, `gunluk_olcum?tarih=eq.${ctx.tarih}`);
    if (r.ok) yapilanlar.push("kilo");
  }
  if (silme.ne === "hepsi" || silme.ne === "antrenman") {
    const r = await sbDelete(ctx, `antrenmanlar?tarih=eq.${ctx.tarih}`);
    if (r.ok) yapilanlar.push("antrenman");
  }
  if (yapilanlar.length)
    return json({ cevap: `🗑️ Silindi (${ctx.tarih}): ${yapilanlar.join(", ")}`, saved: true });
  return json({ cevap: "Silinecek bir şey bulunamadı." });
}

// ================= SUPABASE =================

async function sbReq(ctx, path, options = {}) {
  const res = await fetch(`${ctx.SB_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      apikey: ctx.KEY,
      Authorization: `Bearer ${ctx.KEY}`,
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, data, error: res.ok ? null : (data?.message || `HTTP ${res.status}`) };
}

async function sbInsert(ctx, table, payload) {
  return sbReq(ctx, table, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(payload),
  });
}

async function sbUpsert(ctx, table, payload, conflictCol) {
  return sbReq(ctx, `${table}?on_conflict=${conflictCol}`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(payload),
  });
}

async function sbDelete(ctx, path) {
  return sbReq(ctx, path, { method: "DELETE", headers: { Prefer: "return=minimal" } });
}

// ================= YARDIMCI =================

function json(p) {
  return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) };
}
function bugun() { return new Date().toISOString().slice(0, 10); }
function num(v, float) { const n = Number(String(v).replace(",", ".")) || 0; return float ? Math.round(n * 10) / 10 : Math.round(n); }
function sayiBul(s, re) { const m = String(s).match(re); return m ? Math.round(Number(m[1])) : null; }
function floatBul(s, re) { const m = String(s).match(re); return m ? Math.round(Number(String(m[1]).replace(",", ".")) * 10) / 10 : null; }
function temizle(s) {
  return String(s || "").toLowerCase()
    .replaceAll("ı", "i").replaceAll("ğ", "g").replaceAll("ü", "u")
    .replaceAll("ş", "s").replaceAll("ö", "o").replaceAll("ç", "c");
}
