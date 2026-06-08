import streamlit as st
import pandas as pd
import datetime
import altair as alt

# ==========================================
# SUPABASE BAĞLANTISI
# ==========================================
SUPABASE_URL = "https://lmmhcfqchbirklgrwwtj.supabase.co"
SUPABASE_KEY = st.secrets.get("SUPABASE_KEY", "sb_publishable_Jx5FvqBOVqBvzplgU0ZE-A_35Yy2xxf")

@st.cache_resource
def init_supabase():
    try:
        from supabase import create_client
        return create_client(SUPABASE_URL, SUPABASE_KEY)
    except Exception as e:
        return None

sb = init_supabase()

def sb_select(tablo, tarih=None):
    """Supabase'den veri çeker. Hata olursa boş liste döner."""
    if sb is None:
        return []
    try:
        q = sb.table(tablo).select("*")
        if tarih is not None:
            q = q.eq("tarih", str(tarih))
        return q.execute().data or []
    except Exception:
        return []

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
    .mbar-label { font-size: 13px; color: #6B6B6B; width: 110px; flex-shrink: 0; }
    .mbar-track { flex: 1; height: 8px; background: #F0F0EE; border-radius: 5px; overflow: hidden; }
    .mbar-fill { height: 8px; border-radius: 5px; }
    .mbar-val { font-size: 13px; color: #1A1A1A; width: 70px; text-align: right; flex-shrink: 0; }

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
# VERİ ÇEKME (önce Supabase, yoksa dummy)
# ==========================================
HEDEF = {"kalori": 2600, "protein": 200, "karb": 220, "yag": 75}

def _dummy_gun():
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

def get_gun_data(tarih):
    olcum = sb_select("gunluk_olcum", tarih)
    ogun_rows = sb_select("ogunler", tarih)
    ant_rows = sb_select("antrenmanlar", tarih)

    # Supabase'de bu güne ait hiç veri yoksa dummy göster
    if not olcum and not ogun_rows and not ant_rows:
        return _dummy_gun()

    o = olcum[0] if olcum else {}
    oguns = [{"ad": r.get("ogun", ""), "kcal": r.get("kcal", 0), "p": r.get("protein", 0),
              "k": r.get("karb", 0), "y": r.get("yag", 0), "food": r.get("yiyecekler", "")}
             for r in ogun_rows]
    toplam_kcal = sum(x["kcal"] for x in oguns)
    toplam_p = sum(x["p"] for x in oguns)
    toplam_k = sum(x["k"] for x in oguns)
    toplam_y = sum(x["y"] for x in oguns)

    ant = ant_rows[0] if ant_rows else {}
    egz = ant.get("egzersizler", []) or []
    kard_list = ant.get("kardiyo", []) or []
    kard = kard_list[0] if kard_list else {"tur": "—", "sure": 0, "kcal": 0, "nabiz": 0}

    return {
        "kilo": o.get("kilo", 0), "yag_orani": o.get("yag_orani", 0),
        "kas": o.get("kas_kg", 0), "su": o.get("su_orani", 0),
        "metabolik_yas": o.get("metabolik_yas", 0), "bmr": o.get("bmr", 1945) if o.get("bmr") else 1945,
        "kalori": toplam_kcal, "protein": toplam_p, "karb": toplam_k, "yag": toplam_y,
        "oguns": oguns,
        "antrenman_tip": ant.get("tip", "—"),
        "egzersizler": [{"ad": e.get("ad", ""), "set": e.get("set", ""),
                         "log": e.get("log", ""), "rpe": e.get("rpe", "")} for e in egz],
        "kardiyo": {"tur": kard.get("tur", "—"), "sure": kard.get("sure", 0),
                    "kcal": kard.get("kcal", 0), "nabiz": kard.get("nabiz", 0)},
        "yorum": {"tip": "ok", "metin": "Veriler Supabase'den yüklendi."},
    }

SUPPS = ["Whey", "Kreatin", "Omega 3", "D Vitamini", "K Vitamini", "NMN",
         "Coenzyme Q10", "C Vitamini", "B12", "Magnezyum", "Çinko", "Bromelain", "Resveratrol"]

def get_kilo_trend():
    rows = sb_select("gunluk_olcum")
    if rows:
        rows = sorted(rows, key=lambda r: r.get("tarih", ""))
        df = pd.DataFrame({
            "Tarih": pd.to_datetime([r["tarih"] for r in rows]),
            "Kilo": [r.get("kilo", 0) for r in rows],
        })
        if not df.empty and df["Kilo"].sum() > 0:
            return df
    return pd.DataFrame({
        "Tarih": pd.date_range(end=datetime.date.today(), periods=10),
        "Kilo": [95.2, 94.9, 94.8, 94.4, 94.5, 94.1, 93.9, 93.8, 93.5, 93.5],
    })

KILO_TREND = get_kilo_trend()

TAHLILLER = {
    "15 Mayıs 2026 (Son Tahlil)": {
        "degerler": [
            ("Açlık Kan Şekeri", "88 mg/dL", "70–100", "ok"),
            ("HbA1c", "%5.2", "<%5.7", "ok"),
            ("İnsülin (açlık)", "6.4 µIU/mL", "2.6–24.9", "ok"),
            ("Vitamin D3", "54 ng/mL", "30–100", "ok"),
            ("B12 Vitamini", "420 pg/mL", "200–900", "ok"),
            ("Folik Asit", "11 ng/mL", "3–17", "ok"),
            ("Ferritin", "110 µg/L", "30–400", "ok"),
            ("Demir", "98 µg/dL", "65–175", "ok"),
            ("Total Testosteron", "680 ng/dL", "249–836", "ok"),
            ("Serbest Testosteron", "14.2 pg/mL", "8.7–25.1", "ok"),
            ("TSH", "1.8 mIU/L", "0.4–4.0", "ok"),
            ("T4 (serbest)", "1.2 ng/dL", "0.8–1.8", "ok"),
            ("ALT", "22 U/L", "<41", "ok"),
            ("AST", "19 U/L", "<41", "ok"),
            ("Total Kolesterol", "182 mg/dL", "<200", "ok"),
            ("LDL", "108 mg/dL", "<100", "hi"),
            ("HDL", "58 mg/dL", ">40", "ok"),
            ("Trigliserit", "82 mg/dL", "<150", "ok"),
            ("CRP", "0.6 mg/L", "<5", "ok"),
            ("Kreatinin", "0.95 mg/dL", "0.7–1.3", "ok"),
        ],
        "not": "D3+K2 takviyesine devam, seviye 50'nin üzerinde. Karaciğer enzimleri temiz. "
               "Açlık şekeri ve insülin stabil, hassasiyet yüksek. LDL hedefin biraz üzerinde — "
               "doymuş yağı azaltıp omega-3'ü artırmak faydalı olur.",
    },
    "10 Ocak 2026 (Önceki Dönem)": {
        "degerler": [
            ("Açlık Kan Şekeri", "92 mg/dL", "70–100", "ok"),
            ("HbA1c", "%5.4", "<%5.7", "ok"),
            ("Vitamin D3", "38 ng/mL", "30–100", "ok"),
            ("B12 Vitamini", "310 pg/mL", "200–900", "ok"),
            ("Ferritin", "95 µg/L", "30–400", "ok"),
            ("Total Testosteron", "610 ng/dL", "249–836", "ok"),
            ("TSH", "2.1 mIU/L", "0.4–4.0", "ok"),
            ("ALT", "26 U/L", "<41", "ok"),
            ("AST", "21 U/L", "<41", "ok"),
            ("LDL", "124 mg/dL", "<100", "hi"),
            ("HDL", "51 mg/dL", ">40", "ok"),
            ("Trigliserit", "98 mg/dL", "<150", "ok"),
        ],
        "not": "D3 seviyesi yükseliyor ama hâlâ optimumun altında — doz artışı önerildi. "
               "LDL yüksek, beslenme düzenlemesi gerekli.",
    },
    "22 Ağustos 2025 (Başlangıç)": {
        "degerler": [
            ("Açlık Kan Şekeri", "98 mg/dL", "70–100", "ok"),
            ("HbA1c", "%5.6", "<%5.7", "ok"),
            ("Vitamin D3", "21 ng/mL", "30–100", "lo"),
            ("B12 Vitamini", "245 pg/mL", "200–900", "ok"),
            ("Ferritin", "70 µg/L", "30–400", "ok"),
            ("Total Testosteron", "540 ng/dL", "249–836", "ok"),
            ("TSH", "2.4 mIU/L", "0.4–4.0", "ok"),
            ("ALT", "34 U/L", "<41", "ok"),
            ("AST", "28 U/L", "<41", "ok"),
            ("LDL", "138 mg/dL", "<100", "hi"),
            ("HDL", "44 mg/dL", ">40", "ok"),
            ("Trigliserit", "142 mg/dL", "<150", "ok"),
        ],
        "not": "Başlangıç paneli. D3 düşük (21), takviye başlandı. LDL ve trigliserit yüksek. "
               "Bu değerler ilerleyen dönemde belirgin iyileşme gösterdi.",
    },
}


# ==========================================
# ÜST BAŞLIK + TARİH
# ==========================================
st.markdown("### 🟢 Koç — Metabolizma & Performans")

dc1, dc2 = st.columns([3, 1])
with dc2:
    secilen_tarih = st.date_input("📅 Takip tarihi", datetime.date.today())

gun = get_gun_data(secilen_tarih)

st.caption(f"Seçili gün: **{secilen_tarih.strftime('%d.%m.%Y, %A')}**")
st.write("")

tab1, tab2, tab3, tab4, tab5 = st.tabs([
    "📊 Özet", "🍎 Beslenme", "💪 Antrenman", "💊 Supplement", "🩸 Tahlil"
])


# ----- TAB 1: ÖZET -----
with tab1:
    cols = st.columns(5)
    kpis = [
        ("Kilo", f"{gun['kilo']} kg", ""),
        ("Kalori", f"{gun['kalori']}", ""),
        ("Protein", f"{gun['protein']}g", ""),
        ("Yağ oranı", f"%{gun['yag_orani']}", ""),
        ("BMR", f"{gun['bmr']}", ""),
    ]
    for col, (lbl, val, cls) in zip(cols, kpis):
        col.markdown(f"<div class='kpi'><div class='kpi-label'>{lbl}</div>"
                     f"<div class='kpi-val {cls}'>{val}</div></div>", unsafe_allow_html=True)

    st.write("")
    left, right = st.columns(2)
    with left:
        bars = [
            ("Protein", gun["protein"], HEDEF["protein"], "#1D9E75"),
            ("Karbonhidrat", gun["karb"], HEDEF["karb"], "#378ADD"),
            ("Yağ", gun["yag"], HEDEF["yag"], "#BA7517"),
            ("Kalori", gun["kalori"], HEDEF["kalori"], "#D85A30"),
        ]
        bar_html = "<div class='card'><div class='card-title'>📊 Makro durumu</div>"
        for ad, val, mx, renk in bars:
            pct = min(100, round(val / mx * 100))
            bar_html += (
                f"<div class='mbar-wrap'>"
                f"<div class='mbar-label'>{ad}</div>"
                f"<div class='mbar-track'><div class='mbar-fill' style='width:{pct}%;background:{renk};'></div></div>"
                f"<div class='mbar-val'>{val}</div>"
                f"</div>"
            )
        bar_html += "</div>"
        st.markdown(bar_html, unsafe_allow_html=True)

    with right:
        y = gun["yorum"]
        st.markdown(f"<div class='card'><div class='card-title'>🧠 Koç yorumu</div>"
                    f"<div class='yorum {y['tip']}'>{y['metin']}</div></div>", unsafe_allow_html=True)

    st.markdown("<div class='card'><div class='card-title'>📈 Kilo trendi</div>", unsafe_allow_html=True)
    base = alt.Chart(KILO_TREND).encode(
        x=alt.X("Tarih:T", title=None),
        y=alt.Y("Kilo:Q", scale=alt.Scale(domain=[93, 96]), title="kg"),
    )
    line = base.mark_line(point=alt.OverlayMarkDef(color="#1D9E75", size=60), color="#1D9E75")
    labels = base.mark_text(dy=-12, fontSize=11, color="#1A1A1A", fontWeight=600).encode(
        text=alt.Text("Kilo:Q", format=".1f")
    )
    st.altair_chart((line + labels).properties(height=260), use_container_width=True)
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

    toplam = len(t["degerler"])
    anormal = sum(1 for *_, d in t["degerler"] if d != "ok")
    scol = st.columns(3)
    scol[0].markdown(f"<div class='kpi'><div class='kpi-label'>Toplam parametre</div>"
                     f"<div class='kpi-val'>{toplam}</div></div>", unsafe_allow_html=True)
    scol[1].markdown(f"<div class='kpi'><div class='kpi-label'>Normal aralıkta</div>"
                     f"<div class='kpi-val good'>{toplam - anormal}</div></div>", unsafe_allow_html=True)
    scol[2].markdown(f"<div class='kpi'><div class='kpi-label'>Dikkat gerektiren</div>"
                     f"<div class='kpi-val {'bad' if anormal else 'good'}'>{anormal}</div></div>", unsafe_allow_html=True)

    st.write("")
    st.markdown("<div class='card'><div class='card-title'>🩸 Biyomarker paneli (tamamı)</div>", unsafe_allow_html=True)
    lcols = st.columns(3)
    for i, (ad, val, ref, durum) in enumerate(t["degerler"]):
        with lcols[i % 3]:
            st.markdown(f"<div class='lab-item'><div class='lab-name'>{ad}</div>"
                        f"<div class='lab-val {durum}'>{val}</div>"
                        f"<div class='lab-ref'>ref: {ref}</div></div>", unsafe_allow_html=True)
    st.markdown("</div>", unsafe_allow_html=True)
    st.markdown(f"<div class='card'><div class='card-title'>📋 Klinik notlar</div>"
                f"<div class='yorum warn'>{t['not']}</div></div>", unsafe_allow_html=True)
    st.caption("Tahlil PDF'lerini yükledikçe değerler otomatik buraya işlenecek (Supabase bağlanınca).")
