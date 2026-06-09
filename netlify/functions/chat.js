async function gonder(){
  const input = document.getElementById('chatInput');
  const sendBtn = document.getElementById('chatSend');
  const text = input.value.trim();
  if(!text) return;

  chatGecmis.push({rol:'kullanici', metin:text});
  input.value=''; input.style.height='auto';
  sendBtn.disabled = true;

  // Mesajları çiz
  document.getElementById('chatMsgs').innerHTML = chatGecmis.map(m=>`<div class="msg ${m.rol==='kullanici'?'user':'koc'}">${escapeHtml(m.metin)}</div>`).join('') + '<div class="msg typing" id="typing"><span></span><span></span><span></span></div>';
  scrollChat();

  try{
    const res = await fetch('/.netlify/functions/chat', {
      method:'POST',
      body: JSON.stringify({ mesaj:text }),
    });
    
    const data = await res.json();
    document.getElementById('typing').remove();
    
    let cevap = data.cevap || "Hata oluştu.";
    
    // Veritabanı kaydı
    if(data.kayit && data.kayit.is_food){
      const yeniOgun = { tarih: selDate, ogun: data.kayit.ogun_adi, yiyecekler: data.kayit.yiyecekler, kcal: data.kayit.kcal, protein: data.kayit.protein, karb: data.kayit.karb, yag: data.kayit.yag };
      const { error } = await sb.from('ogunler').insert([yeniOgun]);
      if(!error) {
        if(!cache.ogun[selDate]) cache.ogun[selDate] = [];
        cache.ogun[selDate].push(yeniOgun);
        cevap += '\n\n*(✅ Günlüğe eklendi!)*';
      }
    }
    
    chatGecmis.push({rol:'koc', metin:cevap});
  } catch(e) {
    if(document.getElementById('typing')) document.getElementById('typing').remove();
    chatGecmis.push({rol:'koc', metin:'Bağlantı zaman aşımına uğradı, tekrar dene.'});
  }

  document.getElementById('chatMsgs').innerHTML = chatGecmis.map(m=>`<div class="msg ${m.rol==='kullanici'?'user':'koc'}">${escapeHtml(m.metin)}</div>`).join('');
  sendBtn.disabled = false;
  scrollChat();
}
