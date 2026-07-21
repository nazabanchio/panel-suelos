import openpyxl, json, re, unicodedata, datetime, os
from collections import defaultdict

BASE = "/Users/joaquinbanchio/Desktop/Trabajo Papi/Analisis suelos"

def strip_accents(s):
    if s is None: return ""
    s = str(s)
    nfkd = unicodedata.normalize('NFKD', s)
    return "".join(c for c in nfkd if not unicodedata.combining(c))

NULL_TEXT = {"", "—", "-", "–", "sin fecha", "s/f", "s/d"}

def clean(v):
    if v is None: return None
    if isinstance(v, str):
        v = v.strip()
        if v.lower() in NULL_TEXT: return None
        return v
    if isinstance(v, datetime.datetime):
        return v.strftime("%Y-%m-%d")
    return v

def clean_date(v):
    """Always normalize to canonical ISO YYYY-MM-DD, regardless of whether the
    source cell was a real Excel date or text typed as DD/MM/YYYY (both occur
    in this workbook -- ~34 chemical rows are DD/MM/YYYY text, which sorts
    wrong lexicographically if left as-is: '16/06/2025' < '2022-05-27')."""
    v = clean(v)
    if v is None: return None
    if isinstance(v, str):
        m = re.match(r"^(\d{2})/(\d{2})/(\d{4})$", v)
        if m:
            dd, mm, yyyy = m.groups()
            return f"{yyyy}-{mm}-{dd}"
        m = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", v)
        if m:
            return v
        return None
    return v

def to_num(v):
    v = clean(v)
    if v is None: return None
    if isinstance(v, (int, float)): return v
    try:
        return float(str(v).replace(",", "."))
    except Exception:
        return None

def norm_prof(v):
    v = clean(v)
    if v is None: return None
    s = str(v).strip().upper().replace(" ", "")
    s = s.replace("CM", "")
    return s + " cm" if s else None

STOP = {"LOTE","LT","CAMPO","ZONA","DE","LA","EL","LOS","LAS","L","HA","CM","UNICO","ÚNICO"}
TYPE_TOKENS = {"BIO","BIOLOGICO","BIOLOGICA","QUIM","QUIMICO","QUIMICA","QCO","Q","TESTIGO","HUMIC"}
# canonical, accented display forms -- MUST match the values used verbatim in
# the chemical workbook's own "Tipo" column ("Biológico"/"Químico"/"Testigo"),
# since the dashboard's chart legend colors keys off this exact string.
TIPO_DISPLAY = {"Biologico": "Biológico", "Quimico": "Químico", "Testigo": "Testigo"}

TYPO_FIX = [
    (r"\bANGER\b", "ANGEL"),
    (r"\b23 EL TACA\b", "EL TALA 23"),
    (r"\bEL TACA\b", "EL TALA"),
]

def normalize_core(name):
    if not name: return "", None
    s = strip_accents(name).upper()
    s = re.sub(r"[\.,/]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    for pat, rep in TYPO_FIX:
        s = re.sub(pat, rep, s)
    s = re.sub(r"\bL(\d)", r"\1", s)
    tokens = s.split(" ")
    tipo_found = None
    kept = []
    for t in tokens:
        tt = t.strip()
        if tt in TYPE_TOKENS:
            if tt in ("BIO", "BIOLOGICO", "BIOLOGICA"): tipo_found = TIPO_DISPLAY["Biologico"]
            elif tt in ("QUIM", "QUIMICO", "QUIMICA", "QCO", "Q"): tipo_found = TIPO_DISPLAY["Quimico"]
            elif tt == "TESTIGO": tipo_found = TIPO_DISPLAY["Testigo"]
            elif tt == "HUMIC": tipo_found = TIPO_DISPLAY["Biologico"]
            continue
        if tt in STOP:
            continue
        if tt == "":
            continue
        kept.append(tt)
    core = " ".join(kept).strip()
    if core == "":
        core = s
    return core, tipo_found

def sig_tokens(core):
    return set(t for t in core.split(" ") if t and (t.isdigit() or len(t) >= 3))

PROD_ALIASES = {
    "DIEGO BANCHIO": "Banchio Diego",
    "BANCHIO DIEGO": "Banchio Diego",
    "DIEGO FORNI": "Diego Forni",
    "LUCAS BAUDINO": "Lucas Baudino",
    "ANGEL BOSCHETTO": "Boschetto Angel",
    "BOSCHETTO ANGEL": "Boschetto Angel",
}

def norm_prod(name):
    if not name: return "Sin dato"
    s = strip_accents(name).upper().strip()
    s = re.sub(r"\s+", " ", s)
    return PROD_ALIASES.get(s, name.strip())

# ---------- CHEMICAL DATASET ----------
wb1 = openpyxl.load_workbook(f"{BASE}/Analisis suel TOT V7.xlsx", data_only=True)
ws1 = wb1['Análisis Suelo']
headers1 = [ws1.cell(row=3, column=c).value for c in range(1, ws1.max_column+1)]

PARAM_MAP_CHEM = [
    ("MO (%)", "MO", "%"),
    ("C Org. (%)", "C_Org", "%"),
    ("N Total (%)", "N_Total", "%"),
    ("pH", "pH", ""),
    ("CE (µS/cm)", "CE", "µS/cm"),
    ("P Total (ppm)", "P_Total", "ppm"),
    ("P Bray I (ppm)", "P_BrayI", "ppm"),
    ("N-NO3 (ppm)", "N_NO3", "ppm"),
    ("Azufre S (ppm)", "Azufre_S", "ppm"),
    ("CIC (meq/100g)", "CIC", "meq/100g"),
    ("Ca Intercamb. (ppm)", "Ca_Interc", "ppm"),
    ("Mg Intercamb. (ppm)", "Mg_Interc", "ppm"),
    ("K Intercamb. (ppm)", "K_Interc", "ppm"),
    ("Na Intercamb. (ppm)", "Na_Interc", "ppm"),
    ("PSI (%)", "PSI", "%"),
    ("Sat. Bases (%)", "Sat_Bases", "%"),
    ("Zn (ppm)", "Zn", "ppm"),
    ("Mn (ppm)", "Mn", "ppm"),
    ("Fe (ppm)", "Fe", "ppm"),
    ("Cu (ppm)", "Cu", "ppm"),
    ("Bo (ppm)", "Bo", "ppm"),
    ("Agua Útil (%)", "Agua_Util", "%"),
]

chem_rows = []
bad_dates = []
for r in range(4, ws1.max_row+1):
    d = dict(zip(headers1, [ws1.cell(row=r, column=c).value for c in range(1, ws1.max_column+1)]))
    if d.get("N°") is None:
        continue
    lote_raw = clean(d.get("Lote"))
    if not lote_raw:
        continue
    prod_raw = clean(d.get("Productor / Propietario"))
    core, tipo_from_lote = normalize_core(lote_raw)
    tipo_col = clean(d.get("Tipo"))
    tipo = tipo_col or tipo_from_lote
    params = {}
    for xlname, key, unit in PARAM_MAP_CHEM:
        params[key] = to_num(d.get(xlname))
    fecha = clean_date(d.get("Fecha"))
    if d.get("Fecha") is not None and fecha is None:
        bad_dates.append((r, lote_raw, d.get("Fecha")))
    row = {
        "dataset": "quimico",
        "lab": clean(d.get("Laboratorio")),
        "informe": clean(d.get("Archivo / Informe")),
        "productor": norm_prod(prod_raw),
        "lote": lote_raw,
        "lote_core": core,
        "tipo": tipo,
        "municipio": clean(d.get("Municipio")),
        "posicion": clean(d.get("Posición")),
        "ha": clean(d.get("HA")),
        "prof": norm_prof(d.get("Prof.")),
        "fecha": fecha,
        "campana": clean(d.get("Campaña")),
        "params": params,
        "score": to_num(d.get("Score\nponderado")),
        "clasificacion": clean(d.get("Clasificación\nponderada")),
    }
    chem_rows.append(row)

print("chem rows:", len(chem_rows))
if bad_dates:
    print("WARNING unparsed dates:", bad_dates)

# ---------- BIOLOGICAL DATASET ----------
wb2 = openpyxl.load_workbook(f"{BASE}/Analisis_Suelos_TecnoSustrato_v7.xlsx", data_only=True)
ws2 = wb2['Analisis_TS_Unificado']
headers2 = [ws2.cell(row=1, column=c).value for c in range(1, ws2.max_column+1)]

PARAM_MAP_BIO = [
    ("N bio (ppm)", "N_bio", "ppm"),
    ("P bio (ppm)", "P_bio", "ppm"),
    ("K bio (ppm)", "K_bio", "ppm"),
    ("pH", "pH", ""),
    ("EC (µS/cm)", "CE", "µS/cm"),
    ("CO2 Resp. (ppm)", "CO2_Resp", "ppm"),
    ("% Orgánico", "Pct_Organico", "%"),
    ("% Mineral", "Pct_Mineral", "%"),
    ("% Centro Gaseoso", "Pct_CentroGaseoso", "%"),
    ("% SBE", "Pct_SBE", "%"),
    ("ICS (1–3)", "ICS", ""),
    ("Act. Biológica", "Act_Biologica", ""),
    ("Humif. MO", "Humif_MO", ""),
    ("Miner. MO", "Miner_MO", ""),
    ("SBE", "SBE", ""),
    ("Compactación", "Compactacion", ""),
    ("Respiración", "Respiracion", ""),
]

bio_rows = []
for r in range(2, ws2.max_row+1):
    d = dict(zip(headers2, [ws2.cell(row=r, column=c).value for c in range(1, ws2.max_column+1)]))
    muestra = clean(d.get("Muestra/Punto"))
    if muestra is None or "PROMEDIO" in muestra:
        continue
    lote_raw = clean(d.get("Lote"))
    if not lote_raw:
        continue
    prod_raw = clean(d.get("Productor/Establecimiento"))
    core, tipo_from_lote = normalize_core(lote_raw)
    params = {}
    for xlname, key, unit in PARAM_MAP_BIO:
        params[key] = to_num(d.get(xlname))
    row = {
        "dataset": "biologico",
        "lab": clean(d.get("Laboratorio")),
        "informe": clean(d.get("Archivo/Informe")),
        "productor": norm_prod(prod_raw),
        "localidad": clean(d.get("Localidad")),
        "lote": lote_raw,
        "lote_core": core,
        "tipo": tipo_from_lote,
        "muestra": muestra,
        "prof": norm_prof(d.get("Profundidad (cm)")),
        "fecha": clean_date(d.get("Fecha")),
        "campana": clean(d.get("Campaña")),
        "observaciones": clean(d.get("Observaciones")),
        "params": params,
    }
    bio_rows.append(row)

print("bio rows:", len(bio_rows))

# ---------- FIELD GROUPING (within each dataset, by productor + lote_core) ----------
def group_key(row):
    return (strip_accents(row["productor"]).upper(), row["lote_core"])

groups = defaultdict(list)
for row in chem_rows + bio_rows:
    groups[group_key(row)].append(row)

print("total field groups:", len(groups))

# ---------- CROSS-DATASET SOFT LINK SUGGESTIONS ----------
chem_groups = defaultdict(list)
bio_groups = defaultdict(list)
for row in chem_rows:
    chem_groups[group_key(row)].append(row)
for row in bio_rows:
    bio_groups[group_key(row)].append(row)

def tokens_for_group(key):
    prod, core = key
    return sig_tokens(core)

all_group_keys = list(chem_groups.keys()) + list(bio_groups.keys())
doc_freq = defaultdict(int)
for k in all_group_keys:
    for t in tokens_for_group(k):
        doc_freq[t] += 1
DISTINCTIVE_MAX_DF = 3
NEVER_DISTINCTIVE = {"ESTE","OESTE","NORTE","SUR","CENTRO","MITAD"}

def distinctive(toks):
    return {t for t in toks if doc_freq[t] <= DISTINCTIVE_MAX_DF and t not in NEVER_DISTINCTIVE}

def same_operator(prod_a, prod_b):
    a, b = prod_a.strip(), prod_b.strip()
    if not a or not b: return False
    short, long_ = (a, b) if len(a) <= len(b) else (b, a)
    return short in long_ and len(short) >= 5

links = {}
for ck in chem_groups:
    ctoks = tokens_for_group(ck)
    if not ctoks: continue
    best = []
    for bk in bio_groups:
        btoks = tokens_for_group(bk)
        if not btoks: continue
        inter = ctoks & btoks
        union = ctoks | btoks
        jac = len(inter) / len(union) if union else 0
        dist_inter = distinctive(inter)
        strong = jac >= 0.5 and inter == (ctoks if len(ctoks) <= len(btoks) else btoks)
        if dist_inter and (strong or len(inter) >= 2):
            best.append(bk)
        elif (inter and "COL" in ctoks and same_operator(ck[0], bk[0])
              and inter == (ctoks if len(ctoks) <= len(btoks) else btoks)):
            # "COL <n>" is Molisol/AFA's own shorthand for Banchio's "Campo Col" lots
            # (see Diccionario note) -- safe to match on the bare lot number here,
            # but nowhere else, since a bare number is otherwise ambiguous across
            # this operator's many differently-named parcels (Angel 3, Levrino, etc.)
            best.append(bk)
    if best:
        links[ck] = best

print("cross-dataset soft links found:", len(links))
for ck, bks in links.items():
    print(" ", ck, "<->", bks)

# ---------- BUILD FIELD GROUPS ----------
from collections import Counter

def best_label(rows, key):
    c = Counter(r[key] for r in rows if r.get(key))
    if not c: return None
    return c.most_common(1)[0][0]

campos = []
gid = 0
key_to_gid = {}
for key, rows in groups.items():
    gid += 1
    key_to_gid[key] = f"g{gid}"
    productor_disp = best_label(rows, "productor") or key[0].title()
    lote_disp = best_label(rows, "lote") or key[1].title()
    rows_sorted = sorted(rows, key=lambda r: (r.get("fecha") or "0000"))
    datasets_present = sorted(set(r["dataset"] for r in rows))
    tipos_present = sorted(set(r["tipo"] for r in rows if r.get("tipo")))
    fechas = [r["fecha"] for r in rows if r.get("fecha")]
    campos.append({
        "id": f"g{gid}",
        "key_productor": key[0],
        "key_lote": key[1],
        "productor": productor_disp,
        "lote": lote_disp,
        "datasets": datasets_present,
        "tipos": tipos_present,
        "n_analyses": len(rows),
        "n_chem": sum(1 for r in rows if r["dataset"] == "quimico"),
        "n_bio": sum(1 for r in rows if r["dataset"] == "biologico"),
        "first_date": min(fechas) if fechas else None,
        "last_date": max(fechas) if fechas else None,
        "rows": rows_sorted,
        "links": [],
    })

for ck, bks in links.items():
    ck_gid = key_to_gid.get(ck)
    for bk in bks:
        bk_gid = key_to_gid.get(bk)
        if not ck_gid or not bk_gid: continue
        c_campo = next(c for c in campos if c["id"] == ck_gid)
        b_campo = next(c for c in campos if c["id"] == bk_gid)
        if bk_gid not in c_campo["links"]:
            c_campo["links"].append(bk_gid)
        if ck_gid not in b_campo["links"]:
            b_campo["links"].append(ck_gid)

# ---------- PARAM METADATA (thresholds from Diccionario / Leyenda Semaforo) ----------
CHEM_PARAM_META = {
    "MO":        {"label": "Materia Orgánica", "unit": "%", "dir": "hi", "crit": 2.0, "opt": 3.5},
    "C_Org":     {"label": "Carbono Orgánico", "unit": "%", "dir": "hi", "crit": 1.0, "opt": 1.8},
    "N_Total":   {"label": "Nitrógeno Total", "unit": "%", "dir": "hi", "crit": 0.10, "opt": 0.15},
    "pH":        {"label": "pH", "unit": "", "dir": "rng", "range_opt": [6.0, 7.0], "range_warn": [5.5, 7.5]},
    "CE":        {"label": "Conductividad Eléctrica", "unit": "µS/cm", "dir": "lo", "crit": 800, "opt": 400},
    "P_Total":   {"label": "Fósforo Total", "unit": "ppm", "dir": "hi", "crit": 20, "opt": 40},
    "P_BrayI":   {"label": "Fósforo Bray I", "unit": "ppm", "dir": "hi", "crit": 15, "opt": 30},
    "N_NO3":     {"label": "Nitrógeno de Nitratos", "unit": "ppm", "dir": "hi", "crit": 5, "opt": 15},
    "Azufre_S":  {"label": "Azufre (sulfatos)", "unit": "ppm", "dir": "hi", "crit": 5, "opt": 10},
    "CIC":       {"label": "Capacidad Intercambio Catiónico", "unit": "meq/100g", "dir": "hi", "crit": 15, "opt": 25},
    "Ca_Interc": {"label": "Calcio Intercambiable", "unit": "ppm", "dir": "hi", "crit": 500, "opt": 1000},
    "Mg_Interc": {"label": "Magnesio Intercambiable", "unit": "ppm", "dir": "hi", "crit": 50, "opt": 150},
    "K_Interc":  {"label": "Potasio Intercambiable", "unit": "ppm", "dir": "hi", "crit": 100, "opt": 200},
    "Na_Interc": {"label": "Sodio Intercambiable", "unit": "ppm", "dir": "lo", "crit": 200, "opt": 100},
    "PSI":       {"label": "% Sodio Intercambiable", "unit": "%", "dir": "lo", "crit": 15, "opt": 10},
    "Sat_Bases": {"label": "Saturación de Bases", "unit": "%", "dir": "hi", "crit": 60, "opt": 80},
    "Zn":        {"label": "Zinc disponible", "unit": "ppm", "dir": "hi", "crit": 0.5, "opt": 1.0},
    "Mn":        {"label": "Manganeso disponible", "unit": "ppm", "dir": "hi", "crit": 1, "opt": 5},
    "Fe":        {"label": "Hierro disponible", "unit": "ppm", "dir": "hi", "crit": 4, "opt": 20},
    "Cu":        {"label": "Cobre disponible", "unit": "ppm", "dir": "hi", "crit": 0.2, "opt": 0.5},
    "Bo":        {"label": "Boro disponible", "unit": "ppm", "dir": "hi", "crit": 0.5, "opt": 1.0},
    "Agua_Util": {"label": "Agua Útil", "unit": "%", "dir": "hi", "crit": 15, "opt": 25},
}

BIO_PARAM_META = {
    "N_bio":  {"label": "Nitrógeno biodisponible", "unit": "ppm", "dir": "hi", "crit": 20, "opt": 40},
    "P_bio":  {"label": "Fósforo biodisponible", "unit": "ppm", "dir": "hi", "crit": 25, "opt": 50},
    "K_bio":  {"label": "Potasio biodisponible", "unit": "ppm", "dir": "hi", "crit": 60, "opt": 120},
    "pH":     {"label": "pH", "unit": "", "dir": "rng", "range_opt": [6.0, 7.5], "range_warn": [5.5, 8.0]},
    "CE":     {"label": "Conductividad Eléctrica", "unit": "µS/cm", "dir": "lo", "crit": 800, "opt": 400},
    "CO2_Resp": {"label": "CO₂ Respiración", "unit": "ppm", "dir": "hi", "crit": 1500, "opt": 2500},
    "Pct_Organico": {"label": "% Orgánico (cromatografía)", "unit": "%", "dir": "hi", "crit": 40, "opt": 65},
    "Pct_Mineral":  {"label": "% Mineral (cromatografía)", "unit": "%", "dir": "lo", "crit": 80, "opt": 50},
    "Pct_CentroGaseoso": {"label": "% Centro Gaseoso", "unit": "%", "dir": "hi", "crit": 1, "opt": 3},
    "ICS": {"label": "Índice de Calidad de Suelo (ICS)", "unit": "1-3", "dir": "hi", "crit": 1.5, "opt": 2.5},
    "Act_Biologica": {"label": "Actividad Biológica", "unit": "1-3", "dir": "hi", "crit": 1.5, "opt": 2.5},
    "Compactacion": {"label": "Compactación", "unit": "1-3", "dir": "hi", "crit": 1.5, "opt": 2.5},
    "Respiracion": {"label": "Respiración", "unit": "1-3", "dir": "hi", "crit": 1.5, "opt": 2.5},
}

out = {
    "campos": campos,
    "chem_param_meta": CHEM_PARAM_META,
    "bio_param_meta": BIO_PARAM_META,
    "stats": {
        "n_campos": len(campos),
        "n_chem": len(chem_rows),
        "n_bio": len(bio_rows),
        "n_productores": len(set(c["productor"] for c in campos)),
    }
}
with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "data.json"), "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False)

print("wrote data.json, campos:", len(campos))
