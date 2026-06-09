const fetch = require('node-fetch');

exports.handler = async (event) => {
  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  const { mesaj } = JSON.parse(event.body);

  // Talimatı tek cümleye indirdik (model yorulmasın diye)
  const sistemTalimati = "Sen fitness koçusun. Yenenleri analiz et ve makro (kcal,p,k,y) ver. Cevabını sadece şu JSON formatında yaz: {\"cevap\": \"koçluk mesajı\", \"kayit\": { \"is_food\": true, \"ogun_adi\": \"Öğün\", \"yiyecekler\": \"...\", \"kcal\": 0, \"protein\": 0, \"karb\": 0, \"yag\": 0 }}";

  try {
    // 1.5-flash en hızlı modeldir
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`;
    
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: sistemTalimati + "\nKullanıcı mesajı: " + mesaj }] }]
      }),
    });

    const data = await res.json();
    let text = data.candidates[0].content.parts[0].text;
    
    // JSON'ı metinden ayıkla (hata ihtimalini sıfırladık)
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    const cleanJson = (start !== -1 && end !== -1) ? text.substring(start, end + 1) : JSON.stringify({cevap: text, kayit: null});

    return { statusCode: 200, body: cleanJson };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
