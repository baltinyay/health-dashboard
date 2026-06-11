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
  // "toplam" kelimesi + en az bir kcal geçmeli ki rapor sayalım
  if (!/toplam/.test(t)) return null;

  // TOPLAM satırını bul (markdown tablo satırı veya düz satır)
  const satirlar = mesaj.split("\n");
  let toplamSatir = satirlar.find((s) => /toplam/i.test(temizle(s)) && /\d/.test(s));
  if (!toplamSatir) return null;

  // Satırdaki tüm sayıları sırayla al: [kcal, protein, karb, yag] beklenir
  const sayilar = (toplamSatir.match(/\d+(?:[.,]\d+)?/g) || []).map((x) =>
    Math.round(Number(x.replace(",", ".")))
  );
  if (!sayilar.length) return null;

  // En büyük sayı kcal'dir (genelde), kalanlar makro.
  // Markdown tabloda sıra: kcal | protein | karb | yag
  let kcal = 0, protein = 0, karb = 0, yag = 0;
  const kcalMatch = toplamSatir.match(/(\d+)\s*kcal/i);
  if (kcalMatch) {
    kcal = Number(kcalMatch[1]);
    // kcal'den sonra gelen ilk 3 sayı: protein, karb, yag
    const sonra = toplamSatir.slice(toplamSatir.indexOf(kcalMatch[0]) + kcalMatch[0].length);
    const s2 = (sonra.match(/\d+(?:[.,]\d+)?/g) || []).map((x) => Math.round(Number(x.replace(",", "."))));
    [protein, karb, yag] = [s2[0] || 0, s2[1] || 0, s2[2] || 0];
  } else {
    // kcal etiketi yoksa: ilk sayı kcal, sonraki üçü makro
    [kcal, protein, karb, yag] = [sayilar[0] || 0, sayilar[1] || 0, sayilar[2] || 0, sayilar[3] || 0];
  }

  if (kcal <= 0) return null;

  // Öğün adı: başlıkta "kahvaltı/öğlen/akşam" geçiyor mu?
  let ogun = "Öğün";
  if (/kahvalti/.test(t)) ogun = "Kahvaltı";
  else if (/oglen|ogle/.test(t)) ogun = "Öğlen";
  else if (/aksam/.test(t)) ogun = "Akşam";
  else if (/ara ?ogun/.test(t)) ogun = "Ara Öğün";

  // Yiyecekler: tablodaki **kalın** isimleri topla
  const isimler = [...mesaj.matchAll(/\*\*(.+?)\*\*/g)]
    .map((m) => m[1].trim())
    .filter((x) =>
      !/toplam/i.test(x) &&            // TOPLAM satırı değil
      !/\d+\s*kcal/i.test(x) &&        // kalori değeri değil
      !/^[\d.,\s]+$/.test(x) &&        // sadece sayı değil (30, 102, 59)
      !/degerlendirme|durum|analiz|gunluk/i.test(temizle(x)) && // başlık değil
      x.length < 50
    );
  const yiyecekler = isimler.length ? isimler.join(", ") : "Çeşitli besinler";

  return { ogun, yiyecekler, kcal, protein, karb, yag };
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

  const egzersizler = egzMetin
    ? egzMetin.split(";").map((e) => {
        const t = e.trim();
        const ad = t.split(/\s+/)[0] ? t.replace(/\s+\d.*$/, "").trim() : t;
        const detay = t.replace(ad, "").trim();
        return { ad: ad || t, detay };
      }).filter((x) => x.ad)
    : [];

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
