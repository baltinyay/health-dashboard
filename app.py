import streamlit as st
from supabase import create_client, Client

# Sayfa Ayarları
st.set_page_config(page_title="Klinik Metabolizma Paneli", page_icon="🧬", layout="wide")

# Supabase Bağlantısı (Şifreleri GitHub Secrets'tan alacak)
@st.cache_resource
def init_connection():
    url = st.secrets["SUPABASE_URL"]
    key = st.secrets["SUPABASE_KEY"]
    return create_client(url, key)

supabase: Client = init_connection()

# Başlık ve Özet Paneli
st.title("🧬 Klinik Metabolizma ve Hipertrofi Paneli")
st.markdown("---")

col1, col2, col3 = st.columns(3)
col1.metric(label="Güncel Kilo", value="94 kg", delta="-0.5 kg (Hedef)")
col2.metric(label="Hedef", value="Hipertrofi & Yağ Kaybı")
col3.metric(label="Bazal Metabolizma", value="1858 kcal")

st.markdown("---")

# Dinamik Grafik Alanı (Veriler geldikçe dolacak)
st.subheader("📊 Vücut Kompozisyonu Trendi")
st.info("Akıllı tartı verileri ve Telegram girdileri bekleniyor...")

st.markdown("---")

# Supplement Takip Modülü (İstediğin şık ve silik tasarım)
st.subheader("💊 Günlük Takviye Protokolü")

# CSS ile silik ve küçük punto tasarımı
st.markdown("""
<style>
    .supp-info {
        font-size: 12px;
        color: #888888;
        font-style: italic;
    }
</style>
""", unsafe_allow_html=True)

# İnteraktif Checkboxlar
st.checkbox("Omega-3", help="Kullanıldı olarak işaretle")
st.markdown('<p class="supp-info">Öğle veya akşam yemeği gibi yağ içeren ana bir öğünle birlikte</p>', unsafe_allow_html=True)

st.checkbox("D3 + K2 Vitamini")
st.markdown('<p class="supp-info">Günün en yağlı öğünüyle birlikte, sabah veya öğle saatlerinde</p>', unsafe_allow_html=True)

st.checkbox("Magnezyum (Bisglisinat)")
st.markdown('<p class="supp-info">Sinir sistemini yatıştırıp uykuya geçişi kolaylaştırması için yatmadan 1-2 saat önce</p>', unsafe_allow_html=True)

st.checkbox("Kreatin")
st.markdown('<p class="supp-info">Antrenman sonrası karbonhidrat içeren bir öğünle veya günün herhangi bir saatinde bol su ile</p>', unsafe_allow_html=True)
