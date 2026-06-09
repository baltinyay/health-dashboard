// netlify/functions/chat.js
// Gizli mutfak: chat mesajını alır, Gemini'ye sorar, cevabı döndürür.
// Gemini API key burada DEĞİL — Netlify'ın gizli kasasında (environment variable).

exports.handler = async (event) => {
  // Sadece POST kabul et
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Yalnızca POST' }) };
  }

  const GEMINI_KEY = process.env.GEMINI_API_KEY;
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

  if (!mesaj.trim()) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Boş mesaj' }) };
  }

  // Koçun kişiliği ve görevi
  const sistemTalimati = `Sen kişisel bir sağlık, beslenme ve antrenman koçusun. Türkçe konuşuyorsun.
Kullanıcı sana ne yediğini yazdığında, besinlerin yaklaşık makro değerlerini (kalori, protein, karbonhidrat, yağ) hesapla.
Kısa, net ve motive edici ol. Gereksiz uzun açıklama yapma. Samimi ama profesyonel bir dille konuş.
Sayısal değerler verirken yaklaşık olduklarını belirt.`;

  // Gemini'ye gönderilecek konuşma geçmişi
  const contents = [];
  for (const h of gecmis) {
    contents.push({ role: h.rol === 'kullanici' ? 'user' : 'model', parts: [{ text: h.metin }] });
  }
  contents.push({ role: 'user', parts: [{ text: mesaj }] });

  try {
    // MODEL: Şu an ücretsiz kota (gemini-3.5-flash).
    // Pro'ya geçmek için: AI Studio'ya kart ekle, aşağıdaki satırda
    // gemini-3.5-flash yerine gemini-3.1-pro-preview yaz.
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${GEMINI_KEY}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: sistemTalimati }] },
        contents,
        generationConfig: { maxOutputTokens: 1200 },
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      return { statusCode: 502, body: JSON.stringify({ error: 'Gemini hatası', detay: data }) };
    }

    const cevap = data?.candidates?.[0]?.content?.parts?.[0]?.text || 'Cevap alınamadı.';
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cevap }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Sunucu hatası', detay: String(e) }) };
  }
};
