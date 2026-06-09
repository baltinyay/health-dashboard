exports.handler = async function(event) {
  const headers = {
    'Content-Type': 'application/json'
  };

  try {
    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        headers,
        body: JSON.stringify({
          cevap: 'Sadece POST isteği desteklenir.',
          kayit: { is_food: false }
        })
      };
    }

    const body = JSON.parse(event.body || '{}');
    const mesaj = (body.mesaj || '').trim();

    if (!mesaj) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          cevap: 'Mesaj boş olamaz.',
          kayit: { is_food: false }
        })
      };
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          cevap: 'GEMINI_API_KEY Netlify ortam değişkenlerinde tanımlı değil.',
          kayit: { is_food: false }
        })
      };
    }

    const models = [
      process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      'gemini-2.5-flash-lite'
    ].filter((model, index, arr) => model && arr.indexOf(model) === index);

    const prompt = `
Sen kullanıcının kişisel beslenme, makro ve antrenman koçusun.

Görevin:
- Kullanıcı yemek, öğün, içecek veya besin yazarsa kalori ve makro tahmini yap.
- Uzun açıklama yapma.
- Gereksiz soru sorma.
- "Hangi değerleri öğrenmek istersin?" gibi cevaplar verme.
- Direkt toplam kalori, protein, karbonhidrat ve yağ bilgisini ver.
- Kullanıcı yemek yazdıysa mutlaka kayıt üret.
- Kullanıcı birden fazla öğün yazarsa tek toplam kayıt oluştur.
- Değerler tahminidir, ama kullanıcıya uzun uyarı yazma.
- Cevap kısa, net ve uygulanabilir olsun.
- Türkçe cevap ver.

Çıktı formatı:
Sadece geçerli JSON döndür. Markdown, açıklama, üçlü tırnak veya ek metin kullanma.

Yemek/beslenme mesajıysa şu formatta dön:

{
  "cevap": "Kaydettim. Toplam: 1250 kcal | Protein 75g | Karb 135g | Yağ 48g",
  "kayit": {
    "is_food": true,
    "ogun_adi": "Öğlen + Akşam",
    "yiyecekler": "1 tavuk dürüm, 10 adet patates kızartması, 10 yk makarna, 5-6 yk panelenmiş tavuk",
    "kcal": 1250,
    "protein": 75,
    "karb": 135,
    "yag": 48
  }
}

Yemek/beslenme mesajı değilse şu formatta dön:

{
  "cevap": "Kısa ve doğal cevap",
  "kayit": {
    "is_food": false
  }
}

Kullanıcı mesajı:
${mesaj}
`;

    let lastError = null;

    for (const model of models) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
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
                temperature: 0.2,
                maxOutputTokens: 600,
                responseMimeType: 'application/json'
              }
            })
          }
        );

        const geminiData = await response.json();

        if (!response.ok) {
          lastError = geminiData;
          console.error(`Gemini hata - model: ${model}`, geminiData);

          if (
            response.status === 429 ||
            response.status === 500 ||
            response.status === 503
          ) {
            continue;
          }

          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              cevap: 'Gemini isteğinde hata oluştu. Model veya API anahtarı kontrol edilmeli.',
              kayit: { is_food: false },
              detay: geminiData
            })
          };
        }

        const raw =
          geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '';

        const parsed = parseGeminiJson(raw, mesaj);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify(parsed)
        };

      } catch (modelError) {
        lastError = modelError;
        console.error(`Model çağrı hatası - ${model}`, modelError);
        continue;
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        cevap: 'Gemini şu anda yoğun veya geçici olarak erişilemiyor. Biraz sonra tekrar dene.',
        kayit: { is_food: false },
        detay: String(lastError?.message || lastError || '')
      })
    };

  } catch (error) {
    console.error('Netlify function genel hata:', error);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        cevap: 'Sunucu tarafında hata oluştu. Tekrar dene.',
        kayit: { is_food: false },
        detay: error.message || String(error)
      })
    };
  }
};

function parseGeminiJson(raw, orijinalMesaj) {
  try {
    let cleaned = String(raw || '').trim();

    cleaned = cleaned
      .replace(/^```json/i, '')
      .replace(/^```/i, '')
      .replace(/```$/i, '')
      .trim();

    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');

    if (firstBrace !== -1 && lastBrace !== -1) {
      cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    }

    const parsed = JSON.parse(cleaned);

    if (!parsed.cevap) {
      parsed.cevap = 'Cevap üretildi.';
    }

    if (!parsed.kayit) {
      parsed.kayit = { is_food: false };
    }

    if (parsed.kayit.is_food) {
      parsed.kayit.ogun_adi = parsed.kayit.ogun_adi || 'Genel';
      parsed.kayit.yiyecekler = parsed.kayit.yiyecekler || orijinalMesaj;
      parsed.kayit.kcal = Number(parsed.kayit.kcal) || 0;
      parsed.kayit.protein = Number(parsed.kayit.protein) || 0;
      parsed.kayit.karb = Number(parsed.kayit.karb) || 0;
      parsed.kayit.yag = Number(parsed.kayit.yag) || 0;
    } else {
      parsed.kayit = { is_food: false };
    }

    return parsed;

  } catch (error) {
    console.error('Gemini JSON parse hatası:', raw);

    return {
      cevap: 'Makroları hesaplayamadım. Daha net porsiyon yazar mısın?',
      kayit: { is_food: false }
    };
  }
}
