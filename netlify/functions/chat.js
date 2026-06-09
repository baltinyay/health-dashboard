exports.handler = async function(event) {
  try {
    if (event.httpMethod !== "POST") {
      return json({
        cevap: "Sadece POST isteği desteklenir.",
        kayit: { is_food: false }
      });
    }

    const body = JSON.parse(event.body || "{}");
    const mesaj = String(body.mesaj || "").trim();

    if (!mesaj) {
      return json({
        cevap: "Mesaj boş.",
        kayit: { is_food: false }
      });
    }

    const foodLikely = yemekMi(mesaj);

    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

    if (apiKey) {
      try {
        const geminiText = await geminiyeSor({
          apiKey,
          model,
          mesaj,
          foodLikely
        });

        const parsed = parseJson(geminiText);

        if (parsed && parsed.cevap && parsed.kayit) {
          const normalized = normalizeResponse(parsed, mesaj);

          if (foodLikely && !normalized.kayit.is_food) {
            return json(yerelMakroHesapla(mesaj));
          }

          return json(normalized);
        }

        if (foodLikely) {
          return json(yerelMakroHesapla(mesaj));
        }

      } catch (err) {
        console.error("Gemini hata:", err);

        if (foodLikely) {
          return json(yerelMakroHesapla(mesaj));
        }
      }
    }

    if (foodLikely) {
      return json(yerelMakroHesapla(mesaj));
    }

    return json({
      cevap: "Anladım.",
      kayit: { is_food: false }
    });

  } catch (error) {
    console.error("Function genel hata:", error);

    return json({
      cevap: "Sunucu tarafında hata oluştu. Tekrar dene.",
      kayit: { is_food: false },
      detay: error.message || String(error)
    });
  }
};

function json(payload) {
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  };
}

async function geminiyeSor({ apiKey, model, mesaj, foodLikely }) {
  const prompt = `
Sen kullanıcının kişisel beslenme ve antrenman koçusun.

En önemli kurallar:
- Kullanıcı yemek yazdıysa asla "hesaplayamadım", "daha net yaz", "hangi değerleri istiyorsun" deme.
- Porsiyon net değilse standart porsiyon varsay.
- Kullanıcı yemek yazdıysa direkt kalori ve makro hesapla.
- Cevap kısa olsun.
- Türkçe cevap ver.
- Sadece JSON döndür. Markdown, açıklama, üçlü tırnak kullanma.

Kısaltmalar:
- yk = yemek kaşığı
- tk = tatlı kaşığı
- sb = su bardağı
- gr = gram
- kcal = kalori
- karb = karbonhidrat

Yemek/beslenme mesajıysa şu JSON formatında dön:

{
  "cevap": "Kaydettim. Toplam: yaklaşık 1080 kcal | Protein 62g | Karb 120g | Yağ 37g",
  "kayit": {
    "is_food": true,
    "ogun_adi": "Öğlen + Akşam",
    "yiyecekler": "1 tavuk dürüm, 10 adet patates kızartması, 10 yk makarna, 5-6 yk panelenmiş tavuk",
    "kcal": 1080,
    "protein": 62,
    "karb": 120,
    "yag": 37
  }
}

Yemek/beslenme mesajı değilse şu JSON formatında dön:

{
  "cevap": "Kısa doğal cevap",
  "kayit": {
    "is_food": false
  }
}

Bu mesaj yemek gibi görünüyor mu: ${foodLikely ? "Evet. Yemek girişi olarak işle." : "Hayır. Sohbet olarak işle."}

Kullanıcı mesajı:
${mesaj}
`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: prompt
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 500,
          responseMimeType: "application/json"
        }
      })
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(JSON.stringify(data));
  }

  return data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

function parseJson(raw) {
  try {
    let text = String(raw || "").trim();

    text = text
      .replace(/^```json/i, "")
      .replace(/^```/i, "")
      .replace(/```$/i, "")
      .trim();

    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");

    if (first >= 0 && last >= 0) {
      text = text.slice(first, last + 1);
    }

    return JSON.parse(text);
  } catch (error) {
    console.error("JSON parse edilemedi:", raw);
    return null;
  }
}

function normalizeResponse(parsed, mesaj) {
  if (!parsed.kayit) {
    return {
      cevap: parsed.cevap || "Anladım.",
      kayit: { is_food: false }
    };
  }

  if (!parsed.kayit.is_food) {
    return {
      cevap: parsed.cevap || "Anladım.",
      kayit: { is_food: false }
    };
  }

  const kcal = Math.round(Number(parsed.kayit.kcal) || 0);
  const protein = Math.round(Number(parsed.kayit.protein) || 0);
  const karb = Math.round(Number(parsed.kayit.karb) || 0);
  const yag = Math.round(Number(parsed.kayit.yag) || 0);

  if (kcal <= 0) {
    return yerelMakroHesapla(mesaj);
  }

  return {
    cevap:
      parsed.cevap ||
      `Kaydettim. Toplam: yaklaşık ${kcal} kcal | Protein ${protein}g | Karb ${karb}g | Yağ ${yag}g`,
    kayit: {
      is_food: true,
      ogun_adi: parsed.kayit.ogun_adi || ogunBul(mesaj),
      yiyecekler: parsed.kayit.yiyecekler || mesaj,
      kcal,
      protein,
      karb,
      yag
    }
  };
}

function temizle(str) {
  return String(str || "")
    .toLowerCase()
    .replaceAll("ı", "i")
    .replaceAll("ğ", "g")
    .replaceAll("ü", "u")
    .replaceAll("ş", "s")
    .replaceAll("ö", "o")
    .replaceAll("ç", "c");
}

function yemekMi(mesaj) {
  const t = temizle(mesaj);

  const kelimeler = [
    "kahvalti",
    "oglen",
    "aksam",
    "ara ogun",
    "ogun",
    "yemek",
    "yedim",
    "ictim",
    "tukettim",
    "tavuk",
    "durum",
    "doner",
    "makarna",
    "pilav",
    "patates",
    "yumurta",
    "peynir",
    "ekmek",
    "corba",
    "salata",
    "et",
    "balik",
    "ton baligi",
    "yogurt",
    "sut",
    "protein",
    "whey",
    "muz",
    "elma",
    "yulaf",
    "kofte",
    "hamburger",
    "pizza",
    "lahmacun",
    "kcal",
    "kalori",
    "gram",
    "gr",
    "yk",
    "yemek kasigi",
    "adet"
  ];

  return kelimeler.some(k => t.includes(k));
}

function ogunBul(mesaj) {
  const t = temizle(mesaj);
  const ogunler = [];

  if (t.includes("kahvalti")) ogunler.push("Kahvaltı");
  if (t.includes("oglen")) ogunler.push("Öğlen");
  if (t.includes("aksam")) ogunler.push("Akşam");
  if (t.includes("ara ogun")) ogunler.push("Ara Öğün");

  return ogunler.length ? ogunler.join(" + ") : "Genel";
}

function yerelMakroHesapla(mesaj) {
  const t = temizle(mesaj);

  let kcal = 0;
  let protein = 0;
  let karb = 0;
  let yag = 0;

  const yiyecekler = [];

  function ekle(ad, carpan, deger) {
    kcal += carpan * deger.kcal;
    protein += carpan * deger.protein;
    karb += carpan * deger.karb;
    yag += carpan * deger.yag;
    yiyecekler.push(ad);
  }

  const tavukDurum = t.match(/(\d+)?\s*tavuk\s*durum/);
  if (tavukDurum) {
    const adet = Number(tavukDurum[1] || 1);
    ekle(`${adet} tavuk dürüm`, adet, {
      kcal: 550,
      protein: 35,
      karb: 55,
      yag: 18
    });
  }

  const patates = t.match(/(\d+)\s*(adet|tane)?\s*patates/);
  if (patates && t.includes("kizart")) {
    const adet = Number(patates[1] || 10);
    ekle(`${adet} adet patates kızartması`, adet / 10, {
      kcal: 120,
      protein: 2,
      karb: 16,
      yag: 6
    });
  }

  const makarnaYk = t.match(/(\d+)\s*(yk|yemek kasigi)\s*makarna/);
  if (makarnaYk) {
    const yk = Number(makarnaYk[1] || 10);
    ekle(`${yk} yemek kaşığı makarna`, yk, {
      kcal: 18,
      protein: 0.6,
      karb: 3.7,
      yag: 0.1
    });
  }

  const panelTavuk = t.match(/(\d+)(?:\s*-\s*(\d+))?\s*(yk|yemek kasigi)\s*panelenmis\s*tavuk/);
  if (panelTavuk) {
    const min = Number(panelTavuk[1] || 5);
    const max = Number(panelTavuk[2] || min);
    const yk = (min + max) / 2;

    ekle(`${yk} yemek kaşığı panelenmiş tavuk`, yk, {
      kcal: 42,
      protein: 3.5,
      karb: 2.2,
      yag: 2.1
    });
  }

  if (kcal === 0) {
    kcal = 600;
    protein = 30;
    karb = 60;
    yag = 22;
    yiyecekler.push(mesaj);
  }

  kcal = Math.round(kcal);
  protein = Math.round(protein);
  karb = Math.round(karb);
  yag = Math.round(yag);

  return {
    cevap: `Kaydettim. Toplam: yaklaşık ${kcal} kcal | Protein ${protein}g | Karb ${karb}g | Yağ ${yag}g`,
    kayit: {
      is_food: true,
      ogun_adi: ogunBul(mesaj),
      yiyecekler: yiyecekler.join(", ") || mesaj,
      kcal,
      protein,
      karb,
      yag
    }
  };
}
