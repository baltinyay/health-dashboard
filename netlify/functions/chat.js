const fetch = require('node-fetch'); // Netlify ortamında fetch kullanımı için

exports.handler = async (event) => {
  // 1. İstek kontrolü
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Yalnızca POST' }) };
  }

  // 2. API Key kontrolü
  const GEMINI_KEY = (process.env.GEMINI_API_KEY || '').trim();
  if (!GEMINI_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Gemini key tanımlı değil' }) };
  }

  // 3. İstek içeriğini al
  let mesaj, gecmis;
  try {
    const body = JSON.parse(event.body || '{}');
    mesaj = body.mesaj || '';
    gecmis = body.gecmis || [];
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Geçersiz istek' }) };
  }

  // 4. Koçun Talimatı
  const sistemTalimati = `Sen kişisel fitness koçusun. Kullanıcı sana yediklerini yazdığında makroları hesapla. 
  CEVABINI SADECE AŞAĞIDAKİ JSON FORMATINDA VER, BAŞKA BİRŞEY YAZMA:
  {
    "cevap": "Koçluk mesajın ve özetin",
    "kayit": { "is_food": true, "ogun_adi": "Öğün", "yiyecekler": "...", "kcal": 0, "protein": 0, "karb": 0, "yag": 0 }
  }
  Yemek değilse "kayit": null yap.`;

  // 5. Geçmişi hazırla
  const contents = gecmis.map(h => ({
    role: h.rol === 'kullanici' ? 'user' : 'model',
    parts: [{ text: h.metin }]
  }));
  contents.push({ role: 'user', parts: [{ text: mesaj }] });

  try {
    // 6. Gemini'ye bağlan (1.5-flash şu an en stabil ve resmi uç nokta)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`;
    
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: sistemTalimati }] },
        contents,
        generationConfig: { maxOutputTokens: 1200 } // JSON zorunluluğunu buradan kaldırdık
      }),
    });

    const data = await res.json();
    if (!res.ok) return { statusCode: 502, body: JSON.stringify({ error: 'Gemini hatası', detay: data }) };

    let hamCevap = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    // 7. TEMİZLİK: Model JSON dışı bir şey yazarsa ayıkla
    const jsonBaslangic = hamCevap.indexOf('{');
    const jsonBitis = hamCevap.lastIndexOf('}');
    if (jsonBaslangic !== -1 && jsonBitis !== -1) {
      hamCevap = hamCevap.substring(jsonBaslangic, jsonBitis + 1);
    } else {
      // JSON bulamazsa manuel oluştur
      hamCevap = JSON.stringify({ cevap: hamCevap, kayit: null });
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: hamCevap
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Sunucu hatası', detay: e.message }) };
  }
};
