const fetch = require('node-fetch');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  const GEMINI_KEY = (process.env.GEMINI_API_KEY || '').trim();
  const { mesaj, gecmis } = JSON.parse(event.body || '{}');

  // Talimatı sadeleştirdik ki model cevap üretirken kafası karışmasın
  const sistemTalimati = "Sen bir fitness koçusun. Kullanıcı sana yediklerini yazınca makroları (kcal, p, k, y) hesapla. Cevabını şu JSON formatında ver: {\"cevap\": \"...\", \"kayit\": { \"is_food\": true, \"ogun_adi\": \"...\", \"yiyecekler\": \"...\", \"kcal\": 0, \"protein\": 0, \"karb\": 0, \"yag\": 0 }}. Eğer yemek değilse is_food: false yap.";

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`;
    
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: sistemTalimati }] },
        contents: [{ role: 'user', parts: [{ text: mesaj }] }]
      }),
    });

    const data = await res.json();
    let text = data.candidates[0].content.parts[0].text;
    
    // JSON'ı metnin içinden "cımbızla" çekiyoruz, modelin gevezelik etmesini engelliyoruz
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    const cleanJson = (start !== -1 && end !== -1) ? text.substring(start, end + 1) : JSON.stringify({cevap: text, kayit: null});

    return { statusCode: 200, body: cleanJson };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
