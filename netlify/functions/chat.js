exports.handler = async function(event) {
  try {
    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        body: JSON.stringify({ error: 'Sadece POST desteklenir.' })
      };
    }

    const { mesaj } = JSON.parse(event.body || '{}');

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
        body: JSON.stringify({ error: 'GEMINI_API_KEY tanımlı değil.' })
      };
    }

    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

    const schema = {
      type: 'object',
      properties: {
        cevap: {
          type: 'string',
          description: 'Kullanıcıya gösterilecek kısa cevap.'
        },
        kayitlar: {
          type: 'array',
          description: 'Yemek girişi varsa Supabase beslenme tablosuna eklenecek öğün kayıtları.',
          items: {
            type: 'object',
            properties: {
              is_food: { type: 'boolean' },
              ogun_adi: {
                type: 'string',
                description: 'Öğlen, akşam, kahvaltı, ara öğün veya genel.'
              },
              yiyecekler: {
                type: 'string',
                description: 'Kullanıcının yazdığı yiyeceklerin kısa özeti.'
              },
              kcal: { type: 'integer' },
              protein: { type: 'integer' },
              karb: { type: 'integer' },
              yag: { type: 'integer' }
            },
            required: [
              'is_food',
              'ogun_adi',
              'yiyecekler',
              'kcal',
              'protein',
              'karb',
              'yag'
            ]
          }
        }
      },
      required: ['cevap', 'kayitlar']
    };

    const prompt = `
Sen kullanıcının kişisel beslenme ve antrenman koçusun.

Ana görev:
Kullanıcı yemek, öğün, içecek veya besin yazarsa:
1. Makro değerleri tahmin et.
2. Öğünleri ayır. Örneğin öğlen ve akşam ayrı kayıtlara dönüşmeli.
3. kayitlar dizisini doldur.
4. Kullanıcıya çok kısa cevap ver.

Cevap formatı:
- Maksimum 1-2 cümle.
- Uzun açıklama yapma.
- "Şunu mu öğrenmek istiyorsun?" diye sorma.
- Kullanıcı yemek yazdıysa direkt toplam kcal, protein, karbonhidrat ve yağ ver.
- Değerlerin tahmini olduğunu kısa şekilde belirtmen yeterli.
- Eğer mesaj yemek değilse kayitlar boş array olsun ve kısa doğal cevap ver.

Örnek cevap:
"Kaydettim. Toplam: 1250 kcal | Protein 75g | Karb 135g | Yağ 48g"

Kullanıcı mesajı:
${mesaj}
`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
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
            maxOutputTokens: 700,
            responseFormat: {
              text: {
                mimeType: 'application/json',
                schema
              }
            }
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error('Gemini hata:', data);

      return {
        statusCode: response.status,
        body: JSON.stringify({
          error: data
        })
      };
    }

    const raw =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      '{}';

    let parsed;

    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      console.error('JSON parse hatası:', raw);

      parsed = {
        cevap: 'Koç cevap üretti ama kayıt formatı okunamadı.',
        kayitlar: []
      };
    }

    if (!Array.isArray(parsed.kayitlar)) {
      parsed.kayitlar = [];
    }

    return {
      statusCode: 200,
      body: JSON.stringify(parsed)
    };

  } catch (error) {
    console.error('Function genel hata:', error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error.message || 'Sunucu hatası oluştu.'
      })
    };
  }
};
