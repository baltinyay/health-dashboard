exports.handler = async function(event) {
  try {
    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        body: JSON.stringify({ error: 'Sadece POST isteği desteklenir.' })
      };
    }

    const body = JSON.parse(event.body || '{}');
    const mesaj = body.mesaj;

    if (!mesaj || !mesaj.trim()) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Mesaj boş olamaz.' })
      };
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'GEMINI_API_KEY Netlify ortam değişkenlerinde tanımlı değil.' })
      };
    }

    const models = [
      process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      'gemini-2.5-flash-lite'
    ];

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
                      text: `
Sen kullanıcının beslenme, makro, mikro, antrenman ve sağlık verilerini takip eden kişisel koçusun.

Kurallar:
- Türkçe cevap ver.
- Kısa, net ve uygulanabilir konuş.
- Tıbbi teşhis koyma.
- Tahlil veya sağlık sonucunda risk varsa doktora yönlendir.
- Yemek girildiyse kalori ve makro tahmini yap.
- Kullanıcı sadece sohbet ediyorsa doğal cevap ver.

Kullanıcı mesajı:
${mesaj}
                      `
                    }
                  ]
                }
              ]
            })
          }
        );

        const data = await response.json();

        if (!response.ok) {
          lastError = data;
          console.error(`Gemini hata - model: ${model}`, data);

          if (response.status === 503 || response.status === 429 || response.status >= 500) {
            continue;
          }

          return {
            statusCode: response.status,
            body: JSON.stringify({
              error: data
            })
          };
        }

        const cevap =
          data?.candidates?.[0]?.content?.parts?.[0]?.text ||
          'Cevap üretilemedi.';

        return {
          statusCode: 200,
          body: JSON.stringify({
            cevap
          })
        };

      } catch (err) {
        lastError = err;
        console.error(`Model çağrı hatası - ${model}`, err);
        continue;
      }
    }

    return {
      statusCode: 503,
      body: JSON.stringify({
        error: 'Gemini şu anda yoğun veya geçici olarak erişilemiyor.',
        detay: lastError
      })
    };

  } catch (error) {
    console.error('Netlify function genel hata:', error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error.message || 'Sunucu hatası oluştu.'
      })
    };
  }
};
