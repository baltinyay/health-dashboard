// netlify/functions/chat.js
// Akıllı koç: Supabase'den kullanıcının verisini okur, Gemini'ye bağlam verir,
// yemek girişlerini kaydeder, koçluk sorularına geçmişe bakarak cevap verir.

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json({ cevap: "Sadece POST desteklenir.", saved: false });
  }

  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  const SB_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  if (!GEMINI_KEY) return json({ cevap: "GEMINI_API_KEY tanımlı değil.", saved: false });
  if (!SB_URL || !SB_SERVICE) return json({ cevap: "Supabase ortam değişkenleri eksik.", saved: false });

  let mesaj, tarih, gecmis;
  try {
    const body = JSON.parse(event.body || "{}");
    mesaj = String(body.mesaj || "").trim();
    tarih = String(body.tarih || "").trim() || new Date().toISOString().slice(0, 10);
    gecmis = Array.isArray(body.gecmis) ? body.gecmis.slice(-10) : [];
  } catch {
    return json({ cevap: "Geçersiz istek.", saved: false });
  }
  if (!mesaj) return json({ cevap: "Mesaj boş.", saved: false });

  // ---- 1) Supabase'den bağlam verisi çek (son 14 gün) ----
  const baglam = await baglamGetir(SB_URL, SB_SERVICE, tarih);

  // ---- 2) Gemini'ye sor ----
  let sonuc;
  try {
    sonuc = await geminiSor(GEMINI_KEY, MODEL, mesaj, tarih, baglam, gecmis);
  } catch (e) {
    return json({ cevap: "AI hatası: " + e.message, saved: false });
  }

  // ---- 3) Kaydedilecek bir şey varsa Supabase'e yaz ----
  let saved = false, saveError = null;

  if (sonuc.kayit_tipi === "ogun" && sonuc.ogun) {
    const r = await sbInsert(SB_URL, SB_SERVICE, "ogunler", {
      tarih,
      ogun: sonuc.ogun.ogun_adi || "Genel",
      yiyecekler: sonuc.ogun.yiyecekler || mesaj,
      kcal: num(sonuc.ogun.kcal),
      protein: num(sonuc.ogun.protein),
      karb: num(sonuc.ogun.karb),
      yag: num(sonuc.ogun.yag),
    });
    saved = r.ok; saveError = r.error;
  }

  if (sonuc.kayit_tipi === "kilo" && sonuc.kilo) {
    // Aynı güne kilo varsa güncelle, yoksa ekle (upsert)
    const r = await sbUpsert(SB_URL, SB_SERVICE, "gunluk_olcum", {
      tarih,
      kilo: num(sonuc.kilo.kilo, true),
      ...(sonuc.kilo.yag_orani ? { yag_orani: num(sonuc.kilo.yag_orani, true) } : {}),
      ...(sonuc.kilo.kas_kg ? { kas_kg: num(sonuc.kilo.kas_kg, true) } : {}),
      ...(sonuc.kilo.su_orani ? { su_orani: num(sonuc.kilo.su_orani, true) } : {}),
    }, "tarih");
    saved = r.ok; saveError = r.error;
  }

  if (sonuc.kayit_tipi === "antrenman" && sonuc.antrenman) {
    const r = await sbUpsert(SB_URL, SB_SERVICE, "antrenmanlar", {
      tarih,
      tip: sonuc.antrenman.tip || "Antrenman",
      egzersizler: sonuc.antrenman.egzersizler || [],
      kardiyo: sonuc.antrenman.kardiyo || [],
    }, "tarih");
    saved = r.ok; saveError = r.error;
  }

  let cevap = sonuc.cevap || "Anladım.";
  if (saved) cevap += `\n\n✅ ${tarih} tarihine kaydedildi.`;
  else if (saveError) cevap += "\n\n⚠️ Kayıt yapılamadı: " + saveError;

  return json({ cevap, saved, kayit_tipi: sonuc.kayit_tipi || "yok" });
};

// ================= YARDIMCILAR =================

function json(payload) {
  return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) };
}

function num(v, float) {
  const n = Number(v) || 0;
  return float ? Math.round(n * 10) / 10 : Math.round(n);
}

async function sbFetch(url, key, path, options = {}) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`,
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, data, error: res.ok ? null : (data?.message || `HTTP ${res.status}`) };
}

async function sbInsert(url, key, table, payload) {
  return sbFetch(url, key, table, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(payload),
  });
}

async function sbUpsert(url, key, table, payload, conflictCol) {
  return sbFetch(url, key, `${table}?on_conflict=${conflictCol}`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(payload),
  });
}

async function baglamGetir(url, key, tarih) {
  // Son 14 günün verisi
  const d = new Date(tarih); d.setDate(d.getDate() - 14);
  const baslangic = d.toISOString().slice(0, 10);

  const [olcum, ogun, ant] = await Promise.all([
    sbFetch(url, key, `gunluk_olcum?tarih=gte.${baslangic}&order=tarih.asc&select=tarih,kilo,yag_orani,kas_kg`),
    sbFetch(url, key, `ogunler?tarih=gte.${baslangic}&order=tarih.asc&select=tarih,ogun,yiyecekler,kcal,protein,karb,yag`),
    sbFetch(url, key, `antrenmanlar?tarih=gte.${baslangic}&order=tarih.asc&select=tarih,tip,egzersizler,kardiyo`),
  ]);

  // Bugünün toplamları
  const bugunOgunler = (ogun.data || []).filter(o => o.tarih === tarih);
  const t = bugunOgunler.reduce((s, o) => ({
    kcal: s.kcal + (o.kcal || 0), protein: s.protein + (o.protein || 0),
    karb: s.karb + (o.karb || 0), yag: s.yag + (o.yag || 0),
  }), { kcal: 0, protein: 0, karb: 0, yag: 0 });

  return {
    olcumler: olcum.data || [],
    ogunler: ogun.data || [],
    antrenmanlar: ant.data || [],
    bugunToplam: t,
    bugunOgunSayisi: bugunOgunler.length,
  };
}

async function geminiSor(apiKey, model, mesaj, tarih, baglam, gecmis) {
  const sonKilo = baglam.olcumler.length ? baglam.olcumler[baglam.olcumler.length - 1] : null;

  const sistem = `Sen kullanıcının kişisel beslenme ve antrenman koçusun. Türkçe konuşursun. Kısa, net, samimi ve motive edici bir dilin var.

KULLANICI PROFİLİ:
- Hedef: yağ yakımı + kas korunumu
- Günlük hedefler: ~2600 kcal, 200g protein, 220g karb, 75g yağ
${sonKilo ? `- Son kilo: ${sonKilo.kilo} kg (${sonKilo.tarih})` : ""}

BUGÜNÜN DURUMU (${tarih}):
- Şu ana kadar: ${baglam.bugunToplam.kcal} kcal | ${baglam.bugunToplam.protein}g protein | ${baglam.bugunToplam.karb}g karb | ${baglam.bugunToplam.yag}g yağ (${baglam.bugunOgunSayisi} öğün)

SON 14 GÜN VERİSİ (gerektiğinde kullan):
Kilolar: ${JSON.stringify(baglam.olcumler)}
Öğünler: ${JSON.stringify(baglam.ogunler.slice(-20))}
Antrenmanlar: ${JSON.stringify(baglam.antrenmanlar)}

GÖREVLERİN:
1. Kullanıcı YEMEK yazdıysa (ne yediğini anlatıyorsa): makroları hesapla. Porsiyon belirsizse standart varsay, asla "daha net yaz" deme. Günlük toplamı ve hedefe uzaklığı belirt. Hedefi aştıysa veya yaklaştıysa uyar ("akşamı hafif geç" gibi).
2. Kullanıcı KİLO/TARTI bildirdiyse ("bugün 92.3 kg" gibi): kaydet, trende göre kısa yorum yap.
3. Kullanıcı ANTRENMAN bildirdiyse (yaptığı egzersizleri anlatıyorsa): kaydet.
4. Kullanıcı SORU sorduysa (geçmiş antrenman, öneri, plan): yukarıdaki veriyi kullanarak somut cevap ver. Örn. "geçen kol günümde ne kaldırdım" → antrenman verisinden oku.
5. Genel sohbet ise doğal cevap ver.

YANIT FORMATI — SADECE şu JSON, markdown yok:
{
  "cevap": "kullanıcıya gösterilecek metin",
  "kayit_tipi": "ogun" | "kilo" | "antrenman" | "yok",
  "ogun": { "ogun_adi": "Öğlen", "yiyecekler": "...", "kcal": 0, "protein": 0, "karb": 0, "yag": 0 },
  "kilo": { "kilo": 0, "yag_orani": 0, "kas_kg": 0, "su_orani": 0 },
  "antrenman": { "tip": "...", "egzersizler": [{"ad":"...","detay":"..."}], "kardiyo": [{"ad":"...","sure":0,"kcal":0}] }
}
Sadece ilgili kayıt alanını doldur, diğerlerini hiç koyma. Kayıt yoksa kayit_tipi "yok" olsun.`;

  const contents = [];
  for (const h of gecmis) {
    contents.push({ role: h.rol === "kullanici" ? "user" : "model", parts: [{ text: h.metin }] });
  }
  contents.push({ role: "user", parts: [{ text: mesaj }] });

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: sistem }] },
        contents,
        generationConfig: { temperature: 0.4, maxOutputTokens: 1000, responseMimeType: "application/json" },
      }),
    }
  );

  const data = await res.json();
  if (!res.ok) {
    const msg = data?.error?.message || JSON.stringify(data).slice(0, 200);
    throw new Error(msg);
  }

  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  let parsed;
  try {
    let t = raw.trim().replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();
    const f = t.indexOf("{"), l = t.lastIndexOf("}");
    if (f >= 0 && l > f) t = t.slice(f, l + 1);
    parsed = JSON.parse(t);
  } catch {
    // JSON gelmezse düz metin olarak göster
    return { cevap: raw || "Cevap alınamadı.", kayit_tipi: "yok" };
  }

  return {
    cevap: parsed.cevap || "Anladım.",
    kayit_tipi: parsed.kayit_tipi || "yok",
    ogun: parsed.ogun,
    kilo: parsed.kilo,
    antrenman: parsed.antrenman,
  };
}
