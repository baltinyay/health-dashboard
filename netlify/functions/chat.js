// netlify/functions/chat.js
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Yalnızca POST' }) };
  }

  const GEMINI_KEY = (process.env.GEMINI_API_KEY || '').trim();
  if (!GEMINI_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Gemini key tanımlı değil' }) };
  }

  let mesaj, gecmis;
  try {
    const body = JSON.parse(event.body || '{}');
    mesaj = body.mesaj || '';
    gecmis = body.gecmis || [];
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Geçersiz istek' }) };
  }

  // Gemini'ye hem cevap vermesini hem de verileri gizli bir JSON objesinde toplamasını söylüyoruz
  const sistemTalimati = `Sen kişisel fitness ve beslenme koçusun. Türkçe konuşuyorsun.
Kullanıcı yediklerini yazdığında besin değerlerini hesapla. 
MUTLAKA şu JSON formatında cevap ver, başka hiçbir düz metin yazma:
{
  "cevap": "Kullanıcıya chat ekranında gösterilecek samimi koçluk mesajı ve makro özeti buraya",
  "kayit": {
    "is_food": true, 
    "ogun_adi": "Öğle veya Akşam veya Sabah (tahmin et)",
    "yiyecekler": "Yenilen gıdaların listesi",
    "kcal": 1250,
    "protein": 55,
    "karb": 140,
    "yag": 45
  }
}
Eğer kullanıcı yemek yazmadıysa, normal sohbet ettiyse "is_food" değerini false yap ve "kayit" içini boş bırak.`;

  const contents = [];
  for (const h of gecmis) {
    contents.push({ role: h.rol === 'kullanici' ? 'user' : 'model', parts: [{ text: h.metin }] });
  }
  contents.push({ role: 'user', parts: [{ text: mesaj }] });

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${GEMINI_KEY}`;
    
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: sistemTalimati }] },
        contents,
        generationConfig: { 
          maxOutputTokens: 1200,
          responseMimeType: "application/json" // Gemini'nin kesinlikle JSON dönmesini zorunlu kılıyoruz
        },
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      return { statusCode: res.status, body: JSON.stringify({ error: 'Gemini hatası', detay: data }) };
    }

    // Gemini'den gelen ham JSON string'i alıp temiz bir şekilde iletiyoruz
    const hamCevap = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: hamCevap // Zaten JSON formatında olduğu için direkt gönderiyoruz
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Sunucu hatası', detay: String(e) }) };
  }
};
