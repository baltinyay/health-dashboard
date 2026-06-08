import streamlit as str
import pandas as pd
import datetime
import numpy as np

# --- SAYFA AYARLARI ---
st.set_page_config(
    page_title="Klinik Metabolizma & Performans",
    page_icon="🧬",
    layout="wide",
    initial_sidebar_state="expanded"
)

# --- PREMIUM GÖRÜNÜM İÇİN ÖZEL CSS ---
st.markdown("""
<style>
    .metric-card {
        background-color: #f8f9fa;
        padding: 20px;
        border-radius: 12px;
        border-left: 5px solid #4A90E2;
        box-shadow: 0 2px 4px rgba(0,0,0,0.05);
        margin-bottom: 15px;
    }
    .macro-box {
        padding: 10px;
        border-radius: 8px;
        text-align: center;
        color: white;
        font-weight: bold;
    }
    .protein { background-color: #FF4B4B; }
    .carbs { background-color: #00C0F2; }
    .fat { background-color: #FFAA00; }
</style>
""", unsafe_allow_html=True)

# ==========================================
# 1. YAN MENÜ (SIDEBAR) & TAKVİM
# ==========================================
st.sidebar.header("🧬 Kontrol Merkezi")

# En kritik istek: Takvim/Tarih Seçici
secilen_tarih = st.sidebar.date_input(
    "📅 Takip Tarihi Seçin",
    datetime.date.today(),
    help="Düne veya geçmiş bir tarihe veri girmek/incelemek için tarihi değiştirin."
)

st.sidebar.markdown("---")
st.sidebar.subheader("📥 Hızlı Veri Girişi")
st.sidebar.caption(f"{secilen_tarih.strftime('%d %B %Y')} günü için veri ekle:")

# Form Alanları (Dummy Yapı)
yeni_kilo = st.sidebar.number_input("Kilo (kg)", min_value=30.0, max_value=200.0, value=93.5, step=0.1)
yeni_kalori = st.sidebar.number_input("Alınan Kalori (kcal)", min_value=0, max_value=10000, value=2300)
kaydet_btn = st.sidebar.button("💾 Günlüğü Kaydet", use_container_width=True)

if kaydet_btn:
    st.sidebar.success(f"{secilen_tarih.strftime('%d.%m.%Y')} verisi başarıyla işlendi! (Simülasyon)")

# ==========================================
# ANA SAYFA BAŞLIK
# ==========================================
st.title("🧬 Klinik Metabolizma ve Hipertrofi Yönetimi")
st.markdown(f"**Seçili Tarih:** `{secilen_tarih.strftime('%A, %d %B %Y')}` — *Veriler ve grafikler bu tarihe göre optimize edilmiştir.*")
st.markdown("---")

# SEKMELİ MİMARİ (TABS)
tab1, tab2, tab3, tab4 = st.tabs([
    "📊 Özet & Akıllı Tartı", 
    "🍎 Detaylı Beslenme & Makrolar", 
    "💪 Antrenman & Kardiyo Logları", 
    "🩸 Tahlil & Laboratuvar Geçmişi"
])

# ==========================================
# TAB 1: ÖZET & AKILLI TARTI (GRAFİKLİ)
# ==========================================
with tab1:
    st.subheader("🎯 Günlük Kritik Metrikler")
    
    # Üst Metrik Kartları
    col1, col2, col3, col4 = st.columns(4)
    with col1:
        st.metric(label="Güncel Kilo", value=f"{yeni_kilo} kg", delta="-0.4 kg (Dün)")
    with col2:
        st.metric(label="Hedef Kilo", value="94.0 kg", delta="Hedefe Ulaşıldı", delta_color="inverse")
    with col3:
        st.metric(label="Bazal Metabolizma (BMR)", value="1,945 kcal", delta="Formül: Mifflin-St Jeor")
    with col4:
        st.metric(label="Net Kalori Dengesi", value=f"{yeni_kalori - 2600} kcal", delta="Açık Durumu")
        
    st.markdown("---")
    
    # Akıllı Tartı Detay Kartları
    st.subheader("📉 Akıllı Tartı Detay Analizi (Vücut Kompozisyonu)")
    t_col1, t_col2, t_col3, t_col4 = st.columns(4)
    
    with t_col1:
        st.markdown("""<div class='metric-card'><h5>Vücut Yağ Oranı</h5><h3>%14.2</h3><p style='color:green; size:10px;'>📉 %-0.2 düşüş</p></div>""", unsafe_allow_html=True)
    with t_col2:
        st.markdown("""<div class='metric-card'><h5>Kas Kütlesi</h5><h3>76.4 kg</h3><p style='color:green;'>📈 +0.1 kg artış</p></div>""", unsafe_allow_html=True)
    with t_col3:
        st.markdown("""<div class='metric-card'><h5>Vücut Sıvısı</h5><h3>%58.6</h3><p style='color:gray;'>➡️ Dengeli</p></div>""", unsafe_allow_html=True)
    with t_col4:
        st.markdown("""<div class='metric-card'><h5>Metabolik Yaş</h5><h3>26 Yaş</h3><p style='color:green;'>🔥 Harika</p></div>""", unsafe_allow_html=True)

    st.markdown("---")
    
    # Kilo Değişim Grafiği (Çizgi ve Nokta)
    st.subheader("📈 Zaman Serisi Kilo Değişim Trendi")
    
    # Örnek son 7 günlük veri oluşturma
    tarihler = pd.date_range(end=secilen_tarih, periods=10)
    dummy_kilolar = [95.2, 94.9, 94.8, 94.4, 94.5, 94.1, 93.9, 93.8, 93.5, yeni_kilo]
    grafik_df = pd.DataFrame({"Tarih": tarihler, "Kilo (kg)": dummy_kilolar}).set_index("Tarih")
    
    # Streamlit Çizgi Grafiği
    st.line_chart(grafik_df, y="Kilo (kg)", use_container_width=True)
    st.caption("Grafik üzerinden gün gün nokta bazlı değişimleri ve genel eğilimi (trend) takip edebilirsiniz.")

# ==========================================
# TAB 2: BESLENME & MAKROLAR
# ==========================================
with tab2:
    st.subheader("🍽️ Öğün Bazlı Kalori ve Makro Dağılımı")
    
    # Öğünler Tablosu
    ogun_data = {
        "Öğün": ["Sabah (09:00)", "Öğle (13:30)", "Akşam (19:30)", "Ara Öğün / Takviye"],
        "Açıklama": ["4 Yumurta Akı, 2 Tam Yumurta, 70g Yulaf, Filtre Kahve", "200g Tavuk Göğsü, 150g Basmati Pirinç, Akdeniz Salatası", "220g Antrikot, Fırın Kuşkonmaz, 150g Tatlı Patates", "1 Ölçek Whey Protein, 30g Çiğ Badem, Omega-3"],
        "Kalori (kcal)": [550, 650, 850, 250],
        "Protein (g)": [45, 55, 60, 30],
        "Karbonhidrat (g)": [50, 65, 55, 10],
        "Yağ (g)": [15, 12, 28, 12]
    }
    ogun_df = pd.DataFrame(ogun_data)
    st.table(ogun_df)
    
    st.markdown("---")
    st.subheader("📊 Günlük Toplam Makro Hedef Durumu")
    
    m_col1, m_col2, m_col3, m_col4 = st.columns(4)
    with m_col1:
        st.markdown("<div class='macro-box protein'>PROTEİN<br>190g / 200g</div>", unsafe_allow_html=True)
    with m_col2:
        st.markdown("<div class='macro-box carbs'>KARBONHİDRAT<br>180g / 220g</div>", unsafe_allow_html=True)
    with m_col3:
        st.markdown("<div class='macro-box fat'>YAĞ<br>67g / 75g</div>", unsafe_allow_html=True)
    with m_col4:
        st.metric(label="Toplam Alınan Enerji", value="2,300 kcal", delta="-200 kcal Hedef Alti")

# ==========================================
# TAB 3: ANTRENMAN & KARDİYO LOGLARI
# ==========================================
with tab3:
    st.subheader("🏋️ Ağır Sağlam Hipertrofi Günlüğü")
    
    st.info("💡 Bugün: **Push (Göğüs - Omuz - Triceps)** Odaklı Hipertrofi Rutini Uygulandı.")
    
    # Egzersiz Ağırlık Detayları
    egzersiz_data = {
        "Egzersiz Adı": ["Incline Barbell Bench Press", "Dumbbell Shoulder Press", "Cable Crossover", "Triceps Overhead Extension"],
        "Set x Tekrar": ["4 Set x 8 Tekrar", "3 Set x 10 Tekrar", "4 Set x 12 Tekrar", "3 Set x 12 Tekrar"],
        "Ağırlık Değerleri (Log)": ["80kg - 85kg - 85kg - 90kg", "30kg - 32.5kg - 32.5kg", "25kg - 25kg - 30kg - 30kg", "35kg - 40kg - 40kg"],
        "RPE (ZorlukDerecesi)": ["9 / 10", "8.5 / 10", "9 / 10", "8 / 10"]
    }
    egzersiz_df = pd.DataFrame(egzersiz_data)
    st.dataframe(egzersiz_df, use_container_width=True, hide_index=True)
    
    st.markdown("---")
    st.subheader("🏃 Kardiyo & Kondisyon Analizi")
    
    k_col1, k_col2, k_col3 = st.columns(3)
    with k_col1:
        st.metric(label="Kardiyo Türü & Süresi", value="Eğimli Koşu Bandı (LISS) - 35 dk")
    with k_col2:
        st.metric(label="Teorik Yakılan Kalori", value="380 kcal", delta="🔥 Aktif Metabolizma")
    with k_col3:
        st.metric(label="Ortalama Nabız (HR)", value="132 bpm", delta="Zone 2 Yağ Yakımı")

# ==========================================
# TAB 4: TAHLİL VE LABORATUVAR GEÇMİŞİ
# ==========================================
with tab4:
    st.subheader("🩸 Tarih Bazlı Laboratuvar Biyomarker Takibi")
    
    # Tahlil Tarihi Seçici (Sadece bu sekmeyi filtrelemek için)
    tahlil_tarihi = st.selectbox(
        "Görüntülemek İstediğiniz Tahlil Dönemini Seçin:",
        ["15 Mayıs 2026 (Son Tahlil)", "10 Ocak 2026 (Önceki Dönem)", "22 Ağustos 2025 (Başlangıç)"]
    )
    
    st.caption(f"**{tahlil_tarihi}** dönemine ait laboratuvar paneli aşağıda listelenmiştir:")
    
    # Örnek Tahlil Verisi
    tahlil_data = {
        "Biyomarker (Klinik Değer)": ["Açlık Kan Şekeri", "Vitamin D3", "B12 Vitamini", "Total Testosteron", "Serbest Testosteron", "Ferritin", "ALT / AST (Karaciğer)"],
        "Senin Değerin": ["88 mg/dL", "54 ng/mL", "420 pg/mL", "680 ng/dL", "14.2 pg/mL", "110 µg/L", "22 / 19 U/L"],
        "Referans Aralığı": ["70 - 100", "30 - 100", "200 - 900", "249 - 836", "8.7 - 25.1", "30 - 400", "< 41 / < 41"],
        "Durum Analizi": ["✅ Optimum", "🟢 Yeterli (Takviyeye devam)", "➡️ Dengeli", "🔥 Harika (Hipertrofi için ideal)", "✅ Sağlıklı", "✅ Depolar Dolu", "🟢 Tertemiz"]
    }
    tahlil_df = pd.DataFrame(tahlil_data)
    
    # Duruma göre renklendirme veya doğrudan şık tablo gösterme
    st.dataframe(tahlil_df, use_container_width=True, hide_index=True)
    
    st.markdown("---")
    st.subheader("📋 Klinik Notlar ve Hekim/Koç Tavsiyeleri")
    st.warning("""
    * **D3+K2:** Günlük 5000 IU almaya devam, seviye 50'nin üzerinde tutulacak.
    * **Karaciğer:** ALT/AST değerleri mükemmel, ağır antrenmanlara rağmen enzimleri yoracak bir durum yok.
    * **Glukoz Dengesi:** Sabah açlık şekeri stabil. İnsülin hassasiyeti yüksek, karbonhidrat zamanlaması antrenman çevresinde iyi çalışıyor.
    """)
