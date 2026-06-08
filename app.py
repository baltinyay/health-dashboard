import streamlit as st
import pandas as pd
import datetime
import altair as alt

# ==========================================
# SAYFA AYARLARI
# ==========================================
st.set_page_config(
    page_title="Koç — Metabolizma & Performans",
    page_icon="🟢",
    layout="wide",
    initial_sidebar_state="collapsed"
)

# ==========================================
# ÖZEL CSS — benim tasarıma yakınlaştırma
# ==========================================
st.markdown("""
<style>
    /* Genel temizlik */
    #MainMenu {visibility: hidden;}
    footer {visibility: hidden;}
    .block-container {padding-top: 2rem; padding-bottom: 2rem; max-width: 1100px;}

    /* Metrik kartları */
    .kpi {
        background: #F7F7F5;
        border-radius: 12px;
        padding: 14px 16px;
        height: 100%;
    }
    .kpi-label { font-size: 12px; color: #6B6B6B; margin-bottom: 4px; }
    .kpi-val { font-size: 24px; font-weight: 600; color: #1A1A1A; line-height: 1.1; }
    .kpi-sub { font-size: 11px; color: #9B9B9B; margin-top: 3px; }
    .kpi-val.good { color: #1D9E75; }
    .kpi-val.warn { color: #BA7517; }
    .kpi-val.bad  { color: #E24B4A; }

    /* Section kartı */
    .card {
        background: #FFFFFF;
        border: 1px solid #ECECEC;
        border-radius: 14px;
        padding: 18px 20px;
        margin-bottom: 12px;
    }
    .card-title { font-size: 14px; font-weight: 600; color: #1A1A1A; margin-bottom: 14px; }

    /* Makro bar */
    .mbar-wrap { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
    .mbar-label { font-size: 13px; color: #6B6B6B; width: 110px; }
    .mbar-track { flex: 1; height: 8px; background: #F0F0EE; border-radius: 5px; overflow: hidden; }
    .mbar-fill { height: 100%; border-radius: 5px; }
    .mbar-val { font-size: 13px; color: #1A1A1A; width: 70px; text-align: right; }

    /* Öğün kartı */
    .ogun {
        border: 1px solid #ECECEC;
        border-radius: 10px;
        padding: 12px 14px;
        margin-bottom: 8px;
    }
    .ogun-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
    .ogun-name { font-size: 14px; font-weight: 600; color: #1A1A1A; }
    .ogun-kcal { font-size: 13px; color: #6B6B6B; }
    .ogun-macro { font-size: 12px; color: #9B9B9B; }
    .ogun-food { font-size: 13px; color: #6B6B6B; margin-top: 6px; }

    /* Yorum kutusu */
    .yorum { background: #E1F5EE; border-radius: 10px; padding: 12px 14px; font-size: 13px; color: #085041; line-height: 1.6; }
    .yorum.warn { background: #FAEEDA; color: #412402; }

    /* Tahlil */
    .lab-item { background: #F7F7F5; border-radius: 10px; padding: 10px 12px; margin-bottom: 8px; }
    .lab-name { font-size: 12px; color: #6B6B6B; }
    .lab-val { font-size: 16px; font-weight: 600; }
    .lab-ref { font-size: 11px; color: #9B9B9B; }
    .ok { color: #1D9E75; } .lo { color: #BA7517; } .hi { color: #E24B4A; }

    /* Tab stilini sadeleştir */
    .stTabs [data-baseweb="tab-list"] { gap: 4px; }
    .stTabs [data-baseweb="tab"] { border-radius: 8px; padding: 6px 14px; }
</style>
""", unsafe_allow_html=True)


# ==========================================
# DUMMY VERİ (Gemini'nin verileri korundu)
# ==========================================
HEDEF = {"kalori": 2600, "protein": 200, "karb": 220, "yag": 75}

def get_gun_data(tarih):
    return {
        "kilo": 93.5, "yag_orani": 14.2, "kas": 76.4, "su": 58.6,
        "metabolik_yas": 26, "bmr": 1945,
        "kalori": 2300, "protein": 190, "karb": 180, "yag": 67,
        "oguns": [
            {"ad": "Sabah (09:00)", "kcal": 550, "p": 45, "k": 50, "y": 15,
             "food": "4 yumurta akı, 2 tam yumurta, 70g yulaf, filtre kahve"},
            {"ad": "Öğle (13:30)", "kcal": 650, "p": 55, "k": 65, "y": 12,
             "food": "200g tavuk göğsü, 150g basmati pirinç, Akdeniz salatası"},
            {"ad": "Akşam (19:30)", "kcal": 850, "p": 60, "k": 55, "y": 28,
             "food": "220g antrikot, fırın kuşkonmaz, 150g tatlı patates"},
            {"ad": "Ara öğün / Takviye", "kcal": 250, "p": 30, "k": 10, "y": 12,
             "food": "1 ölçek whey protein, 30g çiğ badem, Omega-3"},
        ],
        "antrenman_tip": "Push (Göğüs – Omuz – Triceps)",
        "egzersizler": [
            {"ad": "Incline Barbell Bench Press", "set": "4×8", "log": "80–85–85–90 kg", "rpe": "9/10"},
            {"ad": "Dumbbell Shoulder Press", "set": "3×10", "log": "30–32.5–32.5 kg", "rpe": "8.5/10"},
            {"ad": "Cable Crossover", "set": "4×12", "log": "25–25–30–30 kg", "rpe": "9/10"},
            {"ad": "Triceps Overhead Extension", "set": "3×12", "log": "35–40–40 kg", "rpe": "8/10"},
        ],
        "kardiyo": {"tur": "Eğimli koşu bandı (LISS)", "sure": 35, "kcal": 380, "nabiz": 132},
        "yorum": {"tip": "warn",
                  "metin": "Kalori hedefinin 200 kcal altındasın (2300/2600). Protein neredeyse hedefte (190/200g) — iyi. "
                           "Yağ yakımı + kas hedefi için bu hafif açık ideal. Antrenman hacmin yüksek, toparlanma için uykuya dikkat."},
    }

SUPPS = ["Whey", "Kreatin", "Omega 3", "D Vitamini", "K Vitamini", "NMN",
         "Coenzyme Q10", "C Vitamini", "B12", "Magnezyum", "Çinko", "Bromelain", "Resveratrol"]

KILO_TREND = pd.DataFrame({
    "Tarih": pd.date_range(end=datetime.date.today(), periods=10),
    "Kilo": [95.2, 94.9, 94.8, 94.4, 94.5, 94.1, 93.9, 93.8, 93.5, 93.5],
})

TAHLILLER = {
    "15 Mayıs 2026 (Son Tahlil)": {
        "degerler": [
            ("Açlık Kan Şekeri", "88 mg/dL", "70–100", "ok"),
            ("Vitamin D3", "54 ng/mL", "30–100", "ok"),
            ("B12 Vitamini", "420 pg/mL", "200–900", "ok"),
            ("Total Testosteron", "680 ng/dL", "249–836", "ok"),
            ("Serbest Testosteron", "14.2 pg/mL", "8.7–25.1", "ok"),
            ("Ferritin", "110 µg/L", "30–400", "ok"),
            ("ALT", "22 U/L", "<41", "ok"),
            ("AST", "19 U/L", "<41", "ok"),
        ],
        "not": "D3+K2 takviyesine devam, seviye 50'nin üzerinde. Karaciğer enzimleri temiz. "
               "Açlık şekeri stabil, insülin hassasiyeti yüksek.",
    },
    "10 Ocak 2026 (Önceki Dönem)": {
        "degerler": [
            ("Açlık Kan Şekeri", "92 mg/dL", "70–100", "ok"),
            ("Vitamin D3", "38 ng/mL", "30–100", "ok"),
            ("B12 Vitamini", "310 pg/mL", "200–900", "ok"),
            ("Total Testosteron", "610 ng/dL", "249–836", "ok"),
        ],
        "not": "D3 seviyesi yükseliyor ama hâlâ optimumun altında — doz artışı önerildi.",
    },
}


# ==========================================
# ÜST BAŞLIK + TARİH
# ==========================================
c1, c2 = st.columns([3, 2])
with c1:
    st.markdown("### 🟢 Koç — Metabolizma & Performans")
with c2:
    secilen_tarih = st.date_input("Tarih", datetime.date.today(), label_visibility="collapsed")

gun = get_gun_data(secilen_tarih)

st.caption(f"Seçili gün: **{secilen_tarih.strftime('%d.%m.%Y, %A')}**")

tab1, tab2, tab3, tab4, tab5 = st.tabs([
    "📊 Özet", "🍎 Beslenme", "💪 Antrenman", "💊 Supplement", "🩸 Tahlil"
])


# ----- TAB 1: ÖZET -----
with tab1:
    cols = st.columns(5)
    kpis = [
        ("Kilo", f"{gun['kilo']} kg", "Hedef: 94 kg", ""),
        ("Kalori", f"{gun['kalori']}", f"Hedef: {HEDEF['kalori']}", "warn"),
        ("Protein", f"{gun['protein']}g", f"Hedef: {HEDEF['protein']}g", "good"),
        ("Yağ oranı", f"%{gun['yag_orani']}", "Hedef: <%13", ""),
        ("BMR", f"{gun['bmr']}", "Mifflin-St Jeor", ""),
    ]
    for col, (lbl, val, sub, cls) in zip(cols, kpis):
        col.markdown(f"<div class='kpi'><div class='kpi-label'>{lbl}</div>"
                     f"<div class='kpi-val {cls}'>{val}</div>"
                     f"<div class='kpi-sub'>{sub}</div></div>", unsafe_allow_html=True)

    st.write("")
    left, right = st.columns(2)
    with left:
        st.markdown("<div class='card'><div class='card-title'>📊 Makro durumu</div>", unsafe_allow_html=True)
        bars = [
            ("Protein", gun["protein"], HEDEF["protein"], "#1D9E75"),
            ("Karbonhidrat", gun["karb"], HEDEF["karb"], "#378ADD"),
            ("Yağ", gun["yag"], HEDEF["yag"], "#BA7517"),
            ("Kalori", gun["kalori"], HEDEF["kalori"], "#D85A30"),
        ]
        for ad, val, mx, renk in bars:
            pct = min(100, round(val / mx * 100))
            st.markdown(
                f"<div class='mbar-wrap'><span class='mbar-label'>{ad}</span>"
                f"<span class='mbar-track'><span class='mbar-fill' style='width:{pct}%;background:{renk}'></span></span>"
                f"<span class='mbar-val'>{val}</span></div>", unsafe_allow_html=True)
        st.markdown("</div>", unsafe_allow_html=True)

    with right:
        y = gun["yorum"]
        st.markdown(f"<div class='card'><div class='card-title'>🧠 Koç yorumu</div>"
                    f"<div class='yorum {y['tip']}'>{y['metin']}</div></div>", unsafe_allow_html=True)

    st.markdown("<div class='card'><div class='card-title'>📈 Kilo trendi</div>", unsafe_allow_html=True)
    chart = alt.Chart(KILO_TREND).mark_line(point=True, color="#1D9E75").encode(
        x=alt.X("Tarih:T", title=None),
        y=alt.Y("Kilo:Q", scale=alt.Scale(domain=[93, 96]), title="kg"),
    ).properties(height=240)
    st.altair_chart(chart, use_container_width=True)
    st.markdown("</div>", unsafe_allow_html=True)

    st.markdown("<div class='card'><div class='card-title'>📉 Akıllı tartı detayları</div>", unsafe_allow_html=True)
    tcols = st.columns(4)
    tartı = [("Kas kütlesi", f"{gun['kas']} kg"), ("Vücut sıvısı", f"%{gun['su']}"),
             ("Metabolik yaş", f"{gun['metabolik_yas']}"), ("Yağ kütlesi", f"{round(gun['kilo']*gun['yag_orani']/100,1)} kg")]
    for col, (lbl, val) in zip(tcols, tartı):
        col.markdown(f"<div class='kpi'><div class='kpi-label'>{lbl}</div>"
                     f"<div class='kpi-val'>{val}</div></div>", unsafe_allow_html=True)
    st.markdown("</div>", unsafe_allow_html=True)


# ----- TAB 2: BESLENME -----
with tab2:
    cols = st.columns(4)
    bm = [("Toplam kalori", gun["kalori"]), ("Protein", f"{gun['protein']}g"),
          ("Karbonhidrat", f"{gun['karb']}g"), ("Yağ", f"{gun['yag']}g")]
    for col, (lbl, val) in zip(cols, bm):
        col.markdown(f"<div class='kpi'><div class='kpi-label'>{lbl}</div>"
                     f"<div class='kpi-val'>{val}</div></div>", unsafe_allow_html=True)

    st.write("")
    st.markdown("<div class='card'><div class='card-title'>🍽️ Öğünler</div>", unsafe_allow_html=True)
    for o in gun["oguns"]:
        st.markdown(
            f"<div class='ogun'><div class='ogun-head'>"
            f"<span class='ogun-name'>{o['ad']}</span><span class='ogun-kcal'>{o['kcal']} kcal</span></div>"
            f"<div class='ogun-macro'>P: {o['p']}g · K: {o['k']}g · Y: {o['y']}g</div>"
            f"<div class='ogun-food'>{o['food']}</div></div>", unsafe_allow_html=True)
    st.markdown("</div>", unsafe_allow_html=True)


# ----- TAB 3: ANTRENMAN -----
with tab3:
    st.markdown(f"<div class='card'><div class='card-title'>💪 {gun['antrenman_tip']}</div>", unsafe_allow_html=True)
    df = pd.DataFrame([{"Egzersiz": e["ad"], "Set×Tekrar": e["set"],
                        "Ağırlık (log)": e["log"], "RPE": e["rpe"]} for e in gun["egzersizler"]])
    st.dataframe(df, use_container_width=True, hide_index=True)
    st.markdown("</div>", unsafe_allow_html=True)

    k = gun["kardiyo"]
    st.markdown("<div class='card'><div class='card-title'>🏃 Kardiyo</div>", unsafe_allow_html=True)
    kcols = st.columns(3)
    kcols[0].markdown(f"<div class='kpi'><div class='kpi-label'>{k['tur']}</div>"
                      f"<div class='kpi-val'>{k['sure']} dk</div></div>", unsafe_allow_html=True)
    kcols[1].markdown(f"<div class='kpi'><div class='kpi-label'>Teorik yakım</div>"
                      f"<div class='kpi-val good'>{k['kcal']} kcal</div></div>", unsafe_allow_html=True)
    kcols[2].markdown(f"<div class='kpi'><div class='kpi-label'>Ortalama nabız</div>"
                      f"<div class='kpi-val'>{k['nabiz']} bpm</div><div class='kpi-sub'>Zone 2</div></div>", unsafe_allow_html=True)
    st.markdown("</div>", unsafe_allow_html=True)


# ----- TAB 4: SUPPLEMENT -----
with tab4:
    st.markdown("<div class='card'><div class='card-title'>💊 Günlük supplementler</div>", unsafe_allow_html=True)
    scols = st.columns(3)
    for i, s in enumerate(SUPPS):
        with scols[i % 3]:
            st.checkbox(s, value=(s in ["Whey", "D Vitamini", "Omega 3", "Kreatin"]), key=f"supp_{s}")
    st.markdown("</div>", unsafe_allow_html=True)
    st.caption("İşaretlediğin supplementler seçili güne kaydedilecek (Supabase bağlanınca aktif olur).")


# ----- TAB 5: TAHLİL -----
with tab5:
    secim = st.selectbox("Tahlil dönemi", list(TAHLILLER.keys()))
    t = TAHLILLER[secim]
    st.markdown("<div class='card'><div class='card-title'>🩸 Biyomarker paneli</div>", unsafe_allow_html=True)
    lcols = st.columns(3)
    for i, (ad, val, ref, durum) in enumerate(t["degerler"]):
        with lcols[i % 3]:
            st.markdown(f"<div class='lab-item'><div class='lab-name'>{ad}</div>"
                        f"<div class='lab-val {durum}'>{val}</div>"
                        f"<div class='lab-ref'>ref: {ref}</div></div>", unsafe_allow_html=True)
    st.markdown("</div>", unsafe_allow_html=True)
    st.markdown(f"<div class='card'><div class='card-title'>📋 Klinik notlar</div>"
                f"<div class='yorum warn'>{t['not']}</div></div>", unsafe_allow_html=True)
