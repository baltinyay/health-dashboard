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
    if (!mesaj) return json({ cevap: "Mesaj boş." });

    const SB_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
    const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
    if (!SB_URL || !KEY) return json({ cevap: "Supabase ortam değişkenleri eksik." });

    const ctx = { SB_URL, KEY, tarih };

    // ---- SİLME KOMUTU MU? ----
    const silme = silmeKomutu(mesaj);
    if (silme) return await silmeYap(ctx, silme, mesaj);

    // ---- KALORİ HEDEFİ GÜNCELLEME Mİ? ----
    const hedef = hedefKomutu(mesaj, tarih);
    if (hedef) return await hedefGuncelle(ctx, hedef);

    // ---- MARKDOWN RAPOR MU? (Gemini/Claude çıktısı, TOPLAM satırlı) ----
    const rapor = raporParse(mesaj);
    if (rapor) return await ogunKaydetDirekt(ctx, rapor);

    // ---- FORMATLI KAYIT MI? ----
    const tip = girisTipi(mesaj);
    if (tip === "ogun") return await ogunKaydet(ctx, mesaj);
    if (tip === "kilo") return await kiloKaydet(ctx, mesaj);
    if (tip === "antrenman") return await antrenmanKaydet(ctx, mesaj);

    // ---- HİÇBİRİ DEĞİLSE: YÖNLENDİR ----
    return json({
      cevap:
        "Şu formatlardan birini yapıştır:\n\n" +
        "🍽️ Öğün:\nAkşam | 5 köfte, 6 yk makarna | 520 kcal | P:38 K:55 Y:18\n\n" +
        "⚖️ Kilo:\nKilo | 92.3\n\n" +
        "💪 Antrenman:\nAntrenman | Göğüs | Bench 80kg 4x8; Fly 15kg 3x12 | Kardiyo: koşu 30dk 300kcal\n\n" +
        "🗑️ Silmek için: \"bugünkü yediklerimi sil\", \"kiloyu sil\", \"antrenmanı sil\", \"bugünü tamamen sil\"",
    });
  } catch (e) {
    return json({ cevap: "Hata: " + (e.message || String(e)) });
  }
};

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

  // Markdown TOPLAM satırı varsa ondan üzerine yaz (daha güvenilir)
  const toplamSatir = mesaj.split("\n").find((s) => /toplam/i.test(temizle(s)) && /\d/.test(s));
  let fKcal = kcal, fPro = protein, fKarb = karb, fYag = yag;
  if (toplamSatir) {
    const km = toplamSatir.match(/(\d+)\s*kcal/i);
    if (km) {
      fKcal = Number(km[1]);
      const sonra = toplamSatir.slice(toplamSatir.indexOf(km[0]) + km[0].length);
      const s2 = (sonra.match(/\d+(?:[.,]\d+)?/g) || []).map((x) => Math.round(Number(x.replace(",", "."))));
      if (s2[0] != null) fPro = s2[0];
      if (s2[1] != null) fKarb = s2[1];
      if (s2[2] != null) fYag = s2[2];
    }
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
  const p = mesaj.split("|").map((s) => s.trim());
  // p[0]=öğün adı, p[1]=yiyecekler, kalan kısımlarda kcal ve makrolar
  const ogunAdi = p[0] || "Öğün";
  const yiyecekler = p[1] || mesaj;
  const kalan = p.slice(2).join(" ");

  const kcal = sayiBul(kalan, /(\d+)\s*kcal/i) ?? sayiBul(mesaj, /(\d+)\s*kcal/i) ?? 0;
  const protein = sayiBul(kalan, /p\s*[:=]?\s*(\d+)/i) ?? 0;
  const karb = sayiBul(kalan, /k\s*[:=]?\s*(\d+)/i) ?? 0;
  const yag = sayiBul(kalan, /y\s*[:=]?\s*(\d+)/i) ?? 0;

  const r = await sbInsert(ctx, "ogunler", {
    tarih: ctx.tarih,
    ogun: ogunAdi,
    yiyecekler,
    kcal, protein, karb, yag,
  });

  if (r.ok)
    return json({
      cevap: `✅ ${ogunAdi} kaydedildi (${ctx.tarih})\n${kcal} kcal · P:${protein} K:${karb} Y:${yag}`,
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
  const m = t.match(/(\d{1,2})\s*(ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik)/);
  if (m) {
    const gun = String(m[1]).padStart(2, "0");
    const ay = String(aylar[m[2]]).padStart(2, "0");
    const yil = new Date().getFullYear();
    return `${yil}-${ay}-${gun}`;
  }
  const baz = refTarih ? new Date(refTarih) : new Date();
  if (/yarin/.test(t)) { baz.setDate(baz.getDate() + 1); return baz.toISOString().slice(0, 10); }
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

function silmeKomutu(mesaj) {
  // Formatlı kayıt (| içeren) ASLA silme değildir — önce bunu ele.
  if (mesaj.includes("|")) return null;

  const t = temizle(mesaj);
  // "sil" kelimesi bir kelime olarak geçmeli
  if (!/\bsil\b|siler|silmek|sildim ?mi|sil$/.test(t)) return null;

  if (/tamamen|hepsini|her ?seyi/.test(t)) return { ne: "hepsi" };

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
function sayiBul(s, re) { const m = String(s).match(re); return m ? Math.round(Number(m[1])) : null; }
function floatBul(s, re) { const m = String(s).match(re); return m ? Math.round(Number(String(m[1]).replace(",", ".")) * 10) / 10 : null; }
function temizle(s) {
  return String(s || "").toLowerCase()
    .replaceAll("ı", "i").replaceAll("ğ", "g").replaceAll("ü", "u")
    .replaceAll("ş", "s").replaceAll("ö", "o").replaceAll("ç", "c");
}
