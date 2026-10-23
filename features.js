  // =====================================================================
  // FEATURES (se inserta dentro del IIFE de app.js via build.py):
  //   1) subir informes PDF (AFA / Molisol / TecnoSustrato) y sumarlos
  //   2) informes imprimibles por lote (uno o varios) -> imprimir / PDF
  // =====================================================================

  // ---------------- datos propios del navegador ----------------
  var LS_KEY = "panel_suelos_extra_v1";
  var userEntries = [];      // entradas con el mismo esquema que manual_entries.json (+ _uid)
  var pdfUrls = {};          // _uid -> objectURL del PDF subido (solo este navegador)
  var userCounter = 0;
  var selectMode = false;
  var selectedIds = {};

  function lsLoad() {
    try { var raw = localStorage.getItem(LS_KEY); return raw ? JSON.parse(raw) : []; } catch (e) { return []; }
  }
  function lsSave() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(userEntries)); } catch (e) { toast("No pude guardar en este navegador (almacenamiento lleno o bloqueado)."); }
  }

  // PDFs en IndexedDB (para poder abrirlos de nuevo)
  function idbOpen() {
    return new Promise(function (res, rej) {
      if (!window.indexedDB) { rej(new Error("sin IndexedDB")); return; }
      var rq = indexedDB.open("panelSuelos", 1);
      rq.onupgradeneeded = function () { rq.result.createObjectStore("pdfs"); };
      rq.onsuccess = function () { res(rq.result); };
      rq.onerror = function () { rej(rq.error); };
    });
  }
  function idbPut(key, blob) {
    return idbOpen().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction("pdfs", "readwrite");
        tx.objectStore("pdfs").put(blob, key);
        tx.oncomplete = function () { res(); };
        tx.onerror = function () { rej(tx.error); };
      });
    });
  }
  function idbGetAll() {
    return idbOpen().then(function (db) {
      return new Promise(function (res, rej) {
        var out = {};
        var tx = db.transaction("pdfs", "readonly");
        var cur = tx.objectStore("pdfs").openCursor();
        cur.onsuccess = function () {
          var c = cur.result;
          if (c) { out[c.key] = c.value; c.continue(); } else { res(out); }
        };
        cur.onerror = function () { rej(cur.error); };
      });
    });
  }

  function rowLink(r) {
    return r.informe_file || (r._uid && pdfUrls[r._uid]) || null;
  }

  // ---------------- toast ----------------
  function toast(msg) {
    var el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function () { el.classList.add("show"); }, 10);
    setTimeout(function () { el.classList.remove("show"); setTimeout(function () { el.remove(); }, 300); }, 4200);
  }

  // ---------------- stats / selects ----------------
  function renderTopStats() {
    document.getElementById("topStats").innerHTML =
      '<div class="stat-chip"><b class="num">' + DATA.stats.n_campos + '</b><span>Campos</span></div>' +
      '<div class="stat-chip"><b class="num">' + (DATA.stats.n_chem + DATA.stats.n_bio) + '</b><span>Análisis</span></div>' +
      '<div class="stat-chip"><b class="num">' + DATA.stats.n_productores + '</b><span>Productores</span></div>';
  }

  function refreshProductorSelect() {
    var prodSel = document.getElementById("productorFilter");
    var cur = state.productor;
    prodSel.innerHTML = "";
    var optAll = document.createElement("option");
    optAll.value = "todos"; optAll.textContent = "Todos los productores";
    prodSel.appendChild(optAll);
    var productores = CAMPOS.reduce(function (a, c) { if (a.indexOf(c.productor) === -1) a.push(c.productor); return a; }, [])
      .sort(function (a, b) { return a.localeCompare(b, "es"); });
    productores.forEach(function (p) {
      var o = document.createElement("option");
      o.value = p; o.textContent = p;
      prodSel.appendChild(o);
    });
    prodSel.value = productores.indexOf(cur) !== -1 ? cur : "todos";
    state.productor = prodSel.value;
  }

  function recomputeStats() {
    var nChem = 0, nBio = 0, prods = {};
    var nCq = 0, nCb = 0;
    CAMPOS.forEach(function (c) {
      prods[c.productor] = 1;
      if (c.dataset === "quimico") { nChem += c.rows.length; nCq++; } else { nBio += c.rows.length; nCb++; }
    });
    DATA.stats.n_campos = CAMPOS.length;
    DATA.stats.n_campos_quimico = nCq;
    DATA.stats.n_campos_biologico = nCb;
    DATA.stats.n_chem = nChem;
    DATA.stats.n_bio = nBio;
    DATA.stats.n_productores = Object.keys(prods).length;
  }

  function refreshAll() {
    recomputeStats();
    renderTopStats();
    refreshProductorSelect();
    renderPendingButton();
    render();
  }

  // ---------------- alta de una entrada en los datos ----------------
  function normProf(raw) {
    if (raw === null || raw === undefined || raw === "") return null;
    var s = String(raw).toUpperCase().replace(/\s+/g, "").replace("CM", "");
    return s ? s + " cm" : null;
  }

  function addEntryToData(e) {
    var campo = null;
    for (var i = 0; i < CAMPOS.length; i++) {
      var c = CAMPOS[i];
      if (c.dataset === e.dataset && c.productor === e.productor_raw && c.lote === e.lote_raw) { campo = c; break; }
    }
    if (!campo) {
      userCounter++;
      campo = {
        id: "u" + userCounter, dataset: e.dataset, productor: e.productor_raw, lote: e.lote_raw,
        key_lote: e.lote_raw, tipos: [], labs: [], n_analyses: 0, first_date: null, last_date: null, rows: [], _user: true
      };
      CAMPOS.push(campo);
      CAMPO_BY_ID[campo.id] = campo;
    }
    campo.rows.push({
      dataset: e.dataset, lab: e.lab, informe: e.informe || null, productor: e.productor_raw,
      localidad: e.localidad || null, lote: e.lote_raw, lote_core: "", tipo: null, muestra: e.muestra || null,
      prof: normProf(e.profundidad_raw), fecha: e.fecha_raw, fecha_is_estimate: false, campana: e.campana || null,
      params: e.params || {}, score: null, clasificacion: null, informe_file: null, _user: true, _uid: e._uid
    });
    campo.rows.sort(function (a, b) { return (a.fecha || "").localeCompare(b.fecha || ""); });
    campo.n_analyses = campo.rows.length;
    campo.first_date = campo.rows[0].fecha;
    campo.last_date = campo.rows[campo.rows.length - 1].fecha;
    campo.labs = campo.rows.reduce(function (a, r) { if (r.lab && a.indexOf(r.lab) === -1) a.push(r.lab); return a; }, []);
    delete campo._blob;
    return campo;
  }

  // ---------------- lector de PDF (pdf.js, se carga solo al subir) ----------------
  var PDFJS_VER = "3.11.174";
  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    return new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/" + PDFJS_VER + "/pdf.min.js";
      s.onload = function () {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/" + PDFJS_VER + "/pdf.worker.min.js";
        res(window.pdfjsLib);
      };
      s.onerror = function () { rej(new Error("No se pudo cargar el lector de PDF (¿hay internet?)")); };
      document.head.appendChild(s);
    });
  }

  function readPdfPages(buf) {
    return loadPdfJs().then(function (lib) {
      return lib.getDocument({ data: buf }).promise;
    }).then(function (pdf) {
      var pages = [];
      var chain = Promise.resolve();
      for (var i = 1; i <= pdf.numPages; i++) {
        (function (n) {
          chain = chain.then(function () { return pdf.getPage(n); }).then(function (pg) {
            return pg.getTextContent();
          }).then(function (tc) {
            var items = [];
            tc.items.forEach(function (it) {
              var s = (it.str || "").trim();
              if (!s) return;
              items.push({ s: s, x: it.transform[4], y: it.transform[5], w: it.width || 0 });
            });
            pages.push({ items: items, lines: groupLines(items) });
          });
        })(i);
      }
      return chain.then(function () { return pages; });
    });
  }

  function groupLines(items, tol) {
    tol = tol || 4;
    var sorted = items.slice().sort(function (a, b) { return b.y - a.y || a.x - b.x; });
    var lines = [];
    sorted.forEach(function (it) {
      var last = lines[lines.length - 1];
      if (last && Math.abs(last.y - it.y) <= tol) { last.items.push(it); }
      else { lines.push({ y: it.y, items: [it] }); }
    });
    lines.forEach(function (l) {
      l.items.sort(function (a, b) { return a.x - b.x; });
      l.text = l.items.map(function (i) { return i.s; }).join(" ");
    });
    return lines;
  }

  function pageFlat(page) {
    return stripAccents(page.lines.map(function (l) { return l.text; }).join(" ")).replace(/\s+/g, " ");
  }

  function parseNum(s) {
    if (s === null || s === undefined) return null;
    s = String(s).trim();
    if (!s || /^N\.?\s?R\.?$/i.test(s) || /^N\/?A$/i.test(s)) return null;
    if (s.indexOf(",") !== -1) s = s.replace(/\./g, "").replace(",", ".");
    var v = parseFloat(s);
    return isNaN(v) ? null : v;
  }

  function toISO(d, m, y) {
    return y + "-" + ("0" + m).slice(-2) + "-" + ("0" + d).slice(-2);
  }

  var MESES_ES = { ENERO: 1, FEBRERO: 2, MARZO: 3, ABRIL: 4, MAYO: 5, JUNIO: 6, JULIO: 7, AGOSTO: 8, SETIEMBRE: 9, SEPTIEMBRE: 9, OCTUBRE: 10, NOVIEMBRE: 11, DICIEMBRE: 12 };

  // valor de la celda que sigue a una etiqueta, en la misma fila (los cuadros de AFA/Molisol son tablas)
  function valueAfter(page, labelRe) {
    var lab = page.items.filter(function (i) { return labelRe.test(stripAccents(i.s)); })[0];
    if (!lab) return null;
    var cand = page.items.filter(function (i) { return i !== lab && Math.abs(i.y - lab.y) <= 4 && i.x > lab.x + 1; })
      .sort(function (a, b) { return a.x - b.x; })[0];
    return cand ? { item: cand, text: cand.s } : null;
  }

  // ---------- AFA ----------
  var AFA_NUM = "([\\d.,]+|N\\.\\s?R\\.)";
  var AFA_SPECS = [
    ["pH", new RegExp("\\bpH 1: ?2,5 \\(suelo:agua\\) UpH " + AFA_NUM), 1],
    ["CE", new RegExp("Conductividad 1: ?2,5 \\(suelo:agua\\) dS\\/m " + AFA_NUM), 1000],
    ["C_Org", new RegExp("Carbono organico oxidable Walkley & Black % " + AFA_NUM), 1],
    ["MO", new RegExp("Materia Organica Vann Bemmelen % " + AFA_NUM), 1],
    ["P_BrayI", new RegExp("Fosforo extractable Bray Kurtz 1 ppm " + AFA_NUM), 1],
    ["Azufre_S", new RegExp("Azufre extractable \\(sulfatos\\) Turbidimetria ppm " + AFA_NUM), 1],
    ["N_NO3", new RegExp("N-Nitratos N-NO3 Diazotacion por SNEDD ppm " + AFA_NUM), 1],
    ["Zn", new RegExp("Zinc DTPA-ICPE ppm " + AFA_NUM), 1],
    ["Bo", new RegExp("Boro DTPA-ICPE ppm " + AFA_NUM), 1],
    ["Cu", new RegExp("Cobre DTPA-ICPE ppm " + AFA_NUM), 1],
    ["Fe", new RegExp("Hierro DTPA-ICPE ppm " + AFA_NUM), 1],
    ["Ca_Interc", new RegExp("Calcio extractable ICPE ppm " + AFA_NUM), 1],
    ["Mg_Interc", new RegExp("Magnesio extractable ICPE ppm " + AFA_NUM), 1],
    ["Na_Interc", new RegExp("Sodio extractable ICPE ppm " + AFA_NUM), 1],
    ["K_Interc", new RegExp("Potasio extractable ICPE ppm " + AFA_NUM), 1],
    ["CIC", new RegExp("C\\.I\\.C\\. Volumetria cmolc\\/kg " + AFA_NUM), 1]
  ];

  function parseAFA(pages) {
    var flat = pageFlat(pages[0]);
    var m;
    var warnings = [];
    var informe = (m = flat.match(/INFORME N\W{0,3}\s*:?\s*(S\d{2}-\d{3,5}\s?[A-Z]?)/)) ? m[1].trim() : null;
    var fecha = null;
    if ((m = flat.match(/Fecha de muestreo de suelo:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/))) fecha = toISO(m[1], m[2], m[3]);
    var pv = valueAfter(pages[0], /^Propietario del lote:?$/i);
    var prod = pv ? pv.text : ((m = flat.match(/Propietario del lote:\s*(.+?)\s+Fecha de muestreo/)) ? m[1].trim() : "");
    // el municipio puede ocupar dos renglones ("SAN MARTIN DE LAS" / "ESCOBAS"): se toman todas las
    // celdas a la derecha de la etiqueta, en una franja vertical alrededor de ella
    var muni = "";
    var mlab = pages[0].items.filter(function (i) { return /^Municipio:?$/i.test(i.s); })[0];
    if (mlab) {
      var parts = pages[0].items.filter(function (i) { return i !== mlab && i.x > mlab.x + 1 && Math.abs(i.y - mlab.y) <= 13 && !/:/.test(i.s); })
        .sort(function (a, b) { return b.y - a.y || a.x - b.x; });
      muni = parts.map(function (i) { return i.s; }).join(" ").trim();
    }
    var prof = (m = flat.match(/Prof\. muestreo \(cm\):\s*(\d+\s?-\s?\d+)/)) ? m[1].replace(/\s/g, "") : null;
    var lote = (m = flat.match(/Denominacion Muestra:\s*(.+?)\s+Muestra enviada por/)) ? m[1].trim() : "";
    var params = {};
    var found = 0;
    AFA_SPECS.forEach(function (sp) {
      var mm = flat.match(sp[1]);
      if (!mm) return;
      var v = parseNum(mm[1]);
      if (v !== null) {
        var val = Math.round(v * sp[2] * 1000) / 1000;
        if (sp[0] === "CE" && val === 0) { warnings.push("La conductividad figura como 0,0 dS/m (por debajo del límite de lectura): la dejé vacía en vez de cargar un 0 falso."); return; }
        params[sp[0]] = val; found++;
      }
    });
    if (!informe || !fecha || !found) warnings.push("No pude leer todos los datos del informe AFA: revisá los valores antes de agregar.");
    return {
      lab: "AFA Planta Formuladora", dataset: "quimico", informe: informe, fecha: fecha,
      productorGuess: prod, localidad: muni,
      lotes: [{ loteGuess: lote, samples: [{ prof: prof, muestra: null, params: params }] }],
      warnings: warnings
    };
  }

  // ---------- Molisol ----------
  var MOLISOL_COLS = [
    ["MATERIA ORGANICA", "MO"], ["PH", "pH"], ["CONDUCTIVIDAD", "CE"], ["FOSFORO", "P_BrayI"], ["NITROGENO", "N_NO3"],
    ["CALCIO", "Ca_Interc"], ["MAGNESIO", "Mg_Interc"], ["POTASIO", "K_Interc"], ["SODIO", "Na_Interc"], ["CIC", "CIC"],
    ["%SAT", "Sat_Bases"], ["AZUFRE", "Azufre_S"], ["NITROGENO TOTAL", "N_Total"], ["ZINC", "Zn"], ["BORO", "Bo"],
    ["FOSFORO TOTAL", "P_Total"]
  ];

  function parseMolisol(pages) {
    var pg = pages[0];
    var flat = pageFlat(pg).toUpperCase();
    var warnings = [];
    var m;
    var fecha = null;
    if ((m = flat.match(/FECHA:\s*(\d{1,2}) DE ([A-Z]+) DE (\d{4})/)) && MESES_ES[m[2]]) fecha = toISO(m[1], MESES_ES[m[2]], m[3]);
    var sv = valueAfter(pg, /^SOLICITANTE:?$/i);
    var solic = sv ? sv.text : ((m = flat.match(/SOLICITANTE:\s*(.+?)\s+FECHA:/)) ? m[1].trim() : "");

    // columnas = encabezados del cuadro
    var cols = [];
    MOLISOL_COLS.forEach(function (c) {
      var it = pg.items.filter(function (i) { return stripAccents(i.s).toUpperCase() === c[0]; })[0];
      if (it) cols.push({ key: c[1], xc: it.x + it.w / 2, x0: it.x });
    });
    if (cols.length < 6) {
      return { lab: "Laboratorio Molisol", dataset: "quimico", informe: null, fecha: fecha, productorGuess: solic, localidad: null, lotes: [],
        warnings: ["No reconocí el cuadro de resultados de Molisol en este PDF."] };
    }
    cols.sort(function (a, b) { return a.xc - b.xc; });
    var minGap = 1e9;
    for (var i = 1; i < cols.length; i++) minGap = Math.min(minGap, cols[i].xc - cols[i - 1].xc);
    var tol = Math.max(8, minGap * 0.5);

    var determ = pg.items.filter(function (i) { return /^DETERMINACIONES/i.test(i.s); })[0];
    var detX = determ ? determ.x - 4 : cols[0].x0 - 150;
    var nameX1 = cols[0].x0 - 2;
    var hdr2 = pg.items.filter(function (i) { return /^WALKLEY/i.test(i.s); })[0];
    var yTop = hdr2 ? hdr2.y - 3 : 1e9;
    var legend = pg.items.filter(function (i) { return /^Fosforo Bray I \(ppm\)/i.test(stripAccents(i.s)); })[0];
    var yBot = legend ? legend.y + 2 : -1e9;

    var body = pg.items.filter(function (i) { return i.y < yTop && i.y > yBot; });
    var depthItems = body.filter(function (i) { return i.x < detX && /^\d+(\s?-\s?\d+)?$/.test(i.s); });
    var rows = depthItems.map(function (d) { return { y: d.y, prof: d.s.replace(/\s/g, ""), nameParts: [], params: {} }; });
    body.forEach(function (it) {
      if (it.x < detX) return;
      var best = null, bd = 1e9;
      rows.forEach(function (r) { var dy = Math.abs(r.y - it.y); if (dy < bd) { bd = dy; best = r; } });
      if (!best || bd > 6) return;
      if (it.x + it.w / 2 < nameX1) { best.nameParts.push(it); return; }
      if (!/^[\d.,]+$/.test(it.s)) return;
      var xc = it.x + it.w / 2, bc = null, bcd = 1e9;
      cols.forEach(function (c) { var d = Math.abs(c.xc - xc); if (d < bcd) { bcd = d; bc = c; } });
      if (bc && bcd <= tol) {
        var v = parseNum(it.s);
        if (v !== null) best.params[bc.key] = v;
      }
    });
    var byName = {}, order = [];
    rows.forEach(function (r) {
      r.nameParts.sort(function (a, b) { return a.x - b.x; });
      var nm = r.nameParts.map(function (p) { return p.s; }).join(" ").replace(/\s+/g, " ").trim();
      if (!nm) return;
      if (!byName[nm]) { byName[nm] = []; order.push(nm); }
      byName[nm].push({ prof: r.prof, muestra: null, params: r.params });
    });
    if (!order.length) warnings.push("No encontré filas de lotes en el cuadro de Molisol.");
    return {
      lab: "Laboratorio Molisol", dataset: "quimico", informe: null, fecha: fecha,
      productorGuess: solic, localidad: null,
      lotes: order.map(function (nm) { return { loteGuess: nm, samples: byName[nm] }; }),
      warnings: warnings
    };
  }

  // ---------- TecnoSustrato ----------
  function muestraInfo(label) {
    var s = label.replace(/^Muestra\s+/i, "").trim();
    var m = s.match(/^M\s*(\d+-\d+)$/i);
    if (m) return { key: "M" + m[1], prof: m[1], muestra: "M1" };
    m = s.match(/^M\s*(\d+)$/i);
    if (m) return { key: "M" + m[1], prof: null, muestra: "M" + m[1] };
    return { key: s.replace(/\s+/g, ""), prof: null, muestra: s };
  }

  function parseTecno(pages) {
    var warnings = [];
    var sections = [];
    var cur = null;
    var estab = "", locali = "", fecha = null;
    pages.forEach(function (pg) {
      var flat = pageFlat(pg);
      if (/Ph y Conductividad/i.test(flat) && /Nutricionales basicos biodisponibles/i.test(flat)) {
        var m;
        if ((m = flat.match(/Establecimiento:\s*(.+?)\.?\s+Localidad:/))) estab = m[1].trim();
        if ((m = flat.match(/Localidad:\s*(.+?)\.?\s+Fecha:/))) locali = m[1].trim();
        if ((m = flat.match(/Fecha:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/))) fecha = toISO(m[1], m[2], m[3]);
        var title = (m = flat.match(/ANALISIS\s+(?:LOTE\s+)?(.+?)\s+Nutricionales/i)) ? m[1].trim() : "";
        cur = { lote: title, muestras: [], blocks: {} };
        sections.push(cur);
        var labels = null;
        pg.lines.forEach(function (l) {
          var t = stripAccents(l.text);
          var mm;
          if (!labels && (mm = t.match(/^MUESTRA\s+(.+)$/))) {
            labels = (mm[1].match(/M\s?\d+-\d+|M\s?\d+|\b[A-Z]\b/g) || []).map(function (x) { return x.trim(); });
            labels.forEach(function (lb) { cur.muestras.push({ label: lb, params: {} }); });
            return;
          }
          if (!cur.muestras.length) return;
          function fill(key, rest) {
            var nums = (rest.match(/\d+(?:[.,]\d+)?/g) || []).map(parseNum);
            cur.muestras.forEach(function (ms, idx) { if (nums[idx] !== undefined && nums[idx] !== null) ms.params[key] = nums[idx]; });
          }
          if ((mm = t.match(/^N \(ppm\)\s+(.*)$/))) fill("N_bio", mm[1]);
          else if ((mm = t.match(/^P \(ppm\)\s+(.*)$/))) fill("P_bio", mm[1]);
          else if ((mm = t.match(/^K \(ppm\)\s+(.*)$/))) fill("K_bio", mm[1]);
          else if ((mm = t.match(/^pH\s+(.*)$/))) fill("pH", mm[1]);
          else if ((mm = t.match(/^EC\b[^)]*\)\s+(.*)$/))) fill("CE", mm[1]);
        });
      } else if (/Estructura estadistica de Compuestos/i.test(flat) && cur) {
        var heads = pg.items.filter(function (i) { return /^Estructura estad/i.test(stripAccents(i.s)); })
          .sort(function (a, b) { return b.y - a.y; });
        heads.forEach(function (h, hi) {
          var lab = pg.items.filter(function (i) {
            return Math.abs(i.y - h.y) < 5 && i.x < h.x && /^(M\s?\d+(?:-\d+)?|Muestra\s+[A-Z0-9]+)$/i.test(i.s);
          }).sort(function (a, b) { return b.x - a.x; })[0];
          if (!lab) return;
          var yHi = h.y + 15;
          var yLo = hi + 1 < heads.length ? heads[hi + 1].y + 15 : -1e9;
          var blk = pg.items.filter(function (i) { return i.y < yHi && i.y >= yLo; });
          var res = {};
          // porcentajes: cada % se asocia a la etiqueta más cercana
          var pcts = blk.filter(function (i) { return /^\d+(?:[.,]\d+)?%$/.test(i.s); });
          var labs = blk.filter(function (i) { return /^(Organico|Mineral|Centro Gaseoso)$/.test(stripAccents(i.s)); });
          var pairs = [];
          pcts.forEach(function (p, pi) {
            labs.forEach(function (lb, li) {
              pairs.push({ d: Math.hypot((p.x + p.w / 2) - (lb.x + lb.w / 2), p.y - lb.y), pi: pi, li: li });
            });
          });
          pairs.sort(function (a, b) { return a.d - b.d; });
          var usedP = {}, usedL = {};
          pairs.forEach(function (pr) {
            if (usedP[pr.pi] || usedL[pr.li]) return;
            usedP[pr.pi] = usedL[pr.li] = true;
            var nm = stripAccents(labs[pr.li].s);
            var key = nm === "Organico" ? "Pct_Organico" : (nm === "Mineral" ? "Pct_Mineral" : "Pct_CentroGaseoso");
            res[key] = parseNum(pcts[pr.pi].s.replace("%", ""));
          });
          // índices (0-5): el valor está a la derecha de la etiqueta, en la misma fila
          var idx = [
            [/^Actividad biologica$/, "Act_Biologica"], [/^Humificacion de la materia$/, "Humif_MO"], [/^Mineralizacion de la materia$/, "Miner_MO"],
            [/^Sustancias basicas esenciales$/, "SBE"], [/^Compactacion$/, "Compactacion"], [/^Respiracion$/, "Respiracion"]
          ];
          var nums = blk.filter(function (i) { return /^\d(\.\d+)?$/.test(i.s); });
          idx.forEach(function (ix) {
            var L = blk.filter(function (i) { return ix[0].test(stripAccents(i.s)); })[0];
            if (!L) return;
            var best = null, bd = 1e9;
            nums.forEach(function (n) {
              if (n.x < L.x + 40) return;
              var dy = Math.abs(n.y - L.y);
              if (dy < bd) { bd = dy; best = n; }
            });
            if (best && bd <= 14) res[ix[1]] = parseNum(best.s);
          });
          cur.blocks[muestraInfo(lab.s).key] = res;
        });
      }
    });
    var lotes = [];
    sections.forEach(function (sec) {
      var samples = sec.muestras.map(function (ms) {
        var info = muestraInfo(ms.label);
        var p = {};
        Object.keys(ms.params).forEach(function (k) { p[k] = ms.params[k]; });
        var blk = sec.blocks[info.key] || {};
        Object.keys(blk).forEach(function (k) { p[k] = blk[k]; });
        if (!sec.blocks[info.key]) warnings.push("Lote \"" + sec.lote + "\": no encontré los índices de estructura de la muestra " + ms.label + ".");
        return { prof: info.prof, muestra: info.muestra, params: p };
      });
      if (samples.length && !samples.some(function (x) { return x.params.Act_Biologica !== undefined || x.params.Compactacion !== undefined; }))
        warnings.push("Lote \"" + sec.lote + "\": los índices 0-5 (actividad biológica, compactación, etc.) vienen solo como gráfico de barras en este informe y no se pueden leer; se cargan N-P-K, pH, CE y la estructura.");
      if (samples.length) lotes.push({ loteGuess: sec.lote, samples: samples });
    });
    if (!lotes.length) {
      var allFlat = pages.map(pageFlat).join(" ");
      if (/RESPIRACION DE SUELO/i.test(allFlat)) warnings.push("Este es el formato anterior de TecnoSustrato (con curva de CO2), que todavía no leo automáticamente. Mandámelo y lo cargo a mano.");
      else warnings.push("No encontré tablas de resultados numéricos (¿es una cromatografía de tejido vegetal?).");
    }
    return {
      lab: "TecnoSustrato", dataset: "biologico", informe: null, fecha: fecha,
      productorGuess: estab, localidad: locali, lotes: lotes, warnings: warnings
    };
  }

  function parsePdfPages(pages, fileName) {
    var flat = pageFlat(pages[0]);
    var all = pages.map(pageFlat).join(" ");
    var out;
    if (/INFORME N/.test(flat) && /Propietario del lote/i.test(flat)) out = parseAFA(pages);
    else if (/LABORATORIO MOLISOL/i.test(flat) || /SOLICITANTE:/i.test(flat)) out = parseMolisol(pages);
    else if (/Nutricionales basicos biodisponibles/i.test(all) || /Estructura estadistica de Compuestos/i.test(all)) out = parseTecno(pages);
    else out = { lab: null, dataset: null, lotes: [], warnings: ["No reconocí el formato de este PDF (se aceptan informes AFA, Molisol y TecnoSustrato)."] };
    out.fileName = fileName;
    if (out.dataset !== "quimico" || !out.informe) {
      // Molisol / TecnoSustrato no traen un código propio: se usa el nombre del archivo
      if (!out.informe) out.informe = fileName.replace(/\.pdf$/i, "").replace(/^Copia de /i, "").replace(/^Informe de Laboratorio - /i, "") + ".pdf";
    }
    return out;
  }

  function parsePdfBuffer(buf, fileName) {
    return readPdfPages(buf).then(function (pages) { return parsePdfPages(pages, fileName); });
  }

  // ---------------- coincidencias con lo ya cargado ----------------
  var FUZZ_STOP = { lote: 1, campo: 1, de: 1, la: 1, el: 1, los: 1, las: 1, l: 1, ha: 1, cm: 1, y: 1, del: 1, establecimiento: 1, empresa: 1 };
  function fuzzToks(s) {
    return norm(s).replace(/\bl(\d)/g, "$1").split(/[^a-z0-9]+/).filter(function (t) { return t && !FUZZ_STOP[t]; });
  }
  function sim(a, b) {
    var A = fuzzToks(a), B = fuzzToks(b);
    if (!A.length || !B.length) return 0;
    var set = {}, n = 0;
    A.forEach(function (t) { if (!set[t]) { set[t] = 1; n++; } });
    var inter = 0, seen = {};
    B.forEach(function (t) { if (set[t] && !seen[t]) { inter++; seen[t] = 1; } else if (!set[t] && !seen[t]) { n++; seen[t] = 1; } });
    return inter / n;
  }
  function productoresDe(dataset) {
    return CAMPOS.filter(function (c) { return c.dataset === dataset; })
      .reduce(function (a, c) { if (a.indexOf(c.productor) === -1) a.push(c.productor); return a; }, [])
      .sort(function (a, b) { return a.localeCompare(b, "es"); });
  }
  function bestMatch(text, candidates, min) {
    var best = null, bs = 0;
    candidates.forEach(function (c) { var s = sim(text, c); if (s > bs) { bs = s; best = c; } });
    return bs >= (min || 0.5) ? { value: best, score: bs } : null;
  }
  function campanaFor(fecha, sample) {
    if (!fecha) return "";
    var y = parseInt(fecha.slice(0, 4), 10), mo = parseInt(fecha.slice(5, 7), 10);
    var a = mo >= 7 ? y : y - 1, b = a + 1;
    var longFmt = sample && /^\d{4}\//.test(sample);
    return longFmt ? a + "/" + b : String(a).slice(2) + "/" + String(b).slice(2);
  }

  // ---------------- diálogo de revisión ----------------
  function modalRoot() { return document.getElementById("modalRoot"); }
  function closeModal() { modalRoot().innerHTML = ""; }

  function metaFor(dataset) { return dataset === "quimico" ? CHEM_META : BIO_META; }
  function paramOrder(dataset, keys) {
    var meta = metaFor(dataset);
    var order = Object.keys(meta).filter(function (k) { return keys.indexOf(k) !== -1; });
    keys.forEach(function (k) { if (order.indexOf(k) === -1) order.push(k); });
    return order;
  }

  function reviewParsed(parsed, idx, total) {
    return new Promise(function (resolve) {
      var ds = parsed.dataset;
      var productores = productoresDe(ds);
      var pm = bestMatch(parsed.productorGuess, productores, 0.5);
      var prodInitial = pm ? pm.value : "__new__";
      var sampleCampana = null;
      CAMPOS.forEach(function (c) { if (c.dataset === ds && c.rows.length && c.rows[c.rows.length - 1].campana) sampleCampana = c.rows[c.rows.length - 1].campana; });

      var html = '<div class="modal-back"><div class="modal">' +
        '<div class="modal-head"><h2>Revisar informe ' + (total > 1 ? "(" + (idx + 1) + " de " + total + ")" : "") + '</h2>' +
        '<button class="btn ghost" data-act="cancel">✕</button></div>' +
        '<p class="modal-sub"><b>' + esc(parsed.fileName) + '</b> · ' + esc(parsed.lab) + ' · ' + (ds === "quimico" ? "Análisis convencional" : "Análisis microbiológico") + '</p>';
      parsed.warnings.forEach(function (w) { html += '<div class="note warn">⚠ ' + esc(w) + '</div>'; });
      html += '<div class="form-grid">' +
        '<label>Fecha de muestreo<input type="date" id="rvFecha" value="' + esc(parsed.fecha || "") + '"></label>' +
        '<label>Campaña<input type="text" id="rvCampana" value="' + esc(campanaFor(parsed.fecha, sampleCampana)) + '"></label>' +
        '<label>Localidad<input type="text" id="rvLoc" value="' + esc(parsed.localidad || "") + '"></label>' +
        '<label>Informe (código / archivo)<input type="text" id="rvInforme" value="' + esc(parsed.informe || "") + '"></label>' +
        '<label class="wide">Productor<select id="rvProd">' +
        productores.map(function (p) { return '<option value="' + esc(p) + '"' + (p === prodInitial ? " selected" : "") + ">" + esc(p) + "</option>"; }).join("") +
        '<option value="__new__"' + (prodInitial === "__new__" ? " selected" : "") + '>➕ Productor nuevo…</option></select>' +
        '<input type="text" id="rvProdNew" placeholder="Nombre del productor nuevo" value="' + esc(parsed.productorGuess || "") + '" style="display:none"></label>' +
        '</div>' +
        '<p class="hint" id="rvProdHint"></p>' +
        '<div id="rvLotes"></div>' +
        '<div class="modal-foot"><button class="btn ghost" data-act="cancel">Descartar</button><button class="btn primary" data-act="ok">Agregar al panel</button></div>' +
        '</div></div>';
      modalRoot().innerHTML = html;
      var root = modalRoot();

      function q(sel) { return root.querySelector(sel); }
      var prodSel = q("#rvProd"), prodNew = q("#rvProdNew");

      function currentProductor() { return prodSel.value === "__new__" ? prodNew.value.trim() : prodSel.value; }

      function renderLotes() {
        var prod = currentProductor();
        var campos = CAMPOS.filter(function (c) { return c.dataset === ds && c.productor === prod; });
        var lotesNames = campos.map(function (c) { return c.lote; });
        q("#rvProdHint").textContent = prodSel.value === "__new__"
          ? "Productor nuevo: se crea con ese nombre. Si es uno que ya existe con otra grafía, elegilo de la lista para que se junte con su historial."
          : (pm && pm.value === prodSel.value && norm(parsed.productorGuess) !== norm(prodSel.value) ? 'El informe dice "' + parsed.productorGuess + '" → lo asocié a "' + prodSel.value + '". Cambialo si no es el mismo.' : "");
        var host = q("#rvLotes");
        host.innerHTML = "";
        parsed.lotes.forEach(function (lt, li) {
          var lm = bestMatch(lt.loteGuess, lotesNames, 0.5);
          var sel = lm ? lm.value : "__new__";
          var keys = [];
          lt.samples.forEach(function (s) { Object.keys(s.params).forEach(function (k) { if (keys.indexOf(k) === -1) keys.push(k); }); });
          keys = paramOrder(ds, keys);
          var meta = metaFor(ds);
          var sec = document.createElement("div");
          sec.className = "rv-lote";
          var h = '<div class="rv-lote-head"><label class="chk"><input type="checkbox" data-inc="' + li + '" checked> Incluir</label>' +
            '<label class="lote-pick">Lote<select data-lote="' + li + '">' +
            lotesNames.map(function (n) { return '<option value="' + esc(n) + '"' + (n === sel ? " selected" : "") + ">" + esc(n) + "</option>"; }).join("") +
            '<option value="__new__"' + (sel === "__new__" ? " selected" : "") + '>➕ Lote nuevo…</option></select>' +
            '<input type="text" data-lotenew="' + li + '" value="' + esc(lt.loteGuess) + '" placeholder="Nombre del lote nuevo" style="display:none"></label></div>' +
            '<div class="hint" data-lotehint="' + li + '"></div>' +
            '<div class="rv-table-wrap"><table class="rv-table"><thead><tr><th>Prof.</th><th>Punto</th>' +
            keys.map(function (k) { return "<th title=\"" + esc(k) + "\">" + esc(meta[k] ? meta[k].label : k) + "</th>"; }).join("") +
            '</tr></thead><tbody>' +
            lt.samples.map(function (s, si) {
              return '<tr><td><input type="text" class="in-prof" data-l="' + li + '" data-s="' + si + '" value="' + esc(s.prof || "") + '" size="6"></td>' +
                '<td><input type="text" class="in-mu" data-l="' + li + '" data-s="' + si + '" value="' + esc(s.muestra || "") + '" size="10"></td>' +
                keys.map(function (k) {
                  var v = s.params[k];
                  return '<td><input type="number" step="any" class="in-p" data-l="' + li + '" data-s="' + si + '" data-k="' + k + '" value="' + (v === null || v === undefined ? "" : v) + '"></td>';
                }).join("") + "</tr>";
            }).join("") + '</tbody></table></div>';
          sec.innerHTML = h;
          host.appendChild(sec);
        });
        refreshLoteUI();
      }

      function refreshLoteUI() {
        var prod = currentProductor();
        var campos = CAMPOS.filter(function (c) { return c.dataset === ds && c.productor === prod; });
        parsed.lotes.forEach(function (lt, li) {
          var sel = q('[data-lote="' + li + '"]'), nw = q('[data-lotenew="' + li + '"]'), hint = q('[data-lotehint="' + li + '"]');
          nw.style.display = sel.value === "__new__" ? "" : "none";
          var name = sel.value === "__new__" ? nw.value.trim() : sel.value;
          // aviso de duplicado: mismo informe + fecha + profundidad ya cargado en ese lote
          var campo = campos.filter(function (c) { return c.lote === name; })[0];
          var msg = "";
          if (campo) {
            var inf = q("#rvInforme").value.trim(), fe = q("#rvFecha").value;
            var dup = campo.rows.filter(function (r) { return r.fecha === fe && (r.informe || "") === inf; }).length;
            msg = dup ? "⚠ Este lote ya tiene " + dup + " fila(s) con el mismo informe y fecha: puede ser un duplicado." : "Se suma a la ficha existente (" + campo.rows.length + " análisis) para ver la evolución.";
          } else if (name) {
            msg = sel.value === "__new__" ? 'Se crea un lote nuevo: "' + name + '".' : "";
          }
          hint.textContent = msg;
          hint.className = "hint" + (msg.indexOf("⚠") === 0 ? " warn" : "");
        });
      }

      prodSel.addEventListener("change", function () {
        prodNew.style.display = prodSel.value === "__new__" ? "" : "none";
        renderLotes();
      });
      prodNew.addEventListener("input", function () { renderLotes(); });
      prodNew.style.display = prodSel.value === "__new__" ? "" : "none";
      root.addEventListener("change", function (e) {
        if (e.target && (e.target.hasAttribute("data-lote") || e.target.id === "rvFecha" || e.target.id === "rvInforme")) refreshLoteUI();
      });
      root.addEventListener("input", function (e) {
        if (e.target && e.target.hasAttribute("data-lotenew")) refreshLoteUI();
      });
      renderLotes();

      root.querySelectorAll('[data-act="cancel"]').forEach(function (b) {
        b.addEventListener("click", function () { closeModal(); resolve(null); });
      });
      q('[data-act="ok"]').addEventListener("click", function () {
        var prod = currentProductor();
        if (!prod) { toast("Falta el nombre del productor."); return; }
        var fecha = q("#rvFecha").value;
        if (!fecha) { toast("Falta la fecha de muestreo."); return; }
        var entries = [];
        var bad = false;
        // si varias secciones del PDF se mandan al mismo lote (ej. "Entrada izquierda" y "Entrada derecha"
        // dentro de "Alfredito"), el nombre original de cada una queda como punto de muestreo
        var targetCount = {};
        parsed.lotes.forEach(function (lt, li) {
          if (!q('[data-inc="' + li + '"]').checked) return;
          var sel0 = q('[data-lote="' + li + '"]');
          var n0 = sel0.value === "__new__" ? q('[data-lotenew="' + li + '"]').value.trim() : sel0.value;
          targetCount[norm(n0)] = (targetCount[norm(n0)] || 0) + 1;
        });
        parsed.lotes.forEach(function (lt, li) {
          if (!q('[data-inc="' + li + '"]').checked) return;
          var sel = q('[data-lote="' + li + '"]');
          var lote = sel.value === "__new__" ? q('[data-lotenew="' + li + '"]').value.trim() : sel.value;
          if (!lote) { bad = true; return; }
          var groupedLabel = targetCount[norm(lote)] > 1 ? lt.loteGuess : null;
          lt.samples.forEach(function (s, si) {
            var params = {};
            root.querySelectorAll('.in-p[data-l="' + li + '"][data-s="' + si + '"]').forEach(function (inp) {
              if (inp.value !== "") params[inp.getAttribute("data-k")] = parseFloat(inp.value);
            });
            if (!Object.keys(params).length) return;
            entries.push({
              dataset: ds, lab: parsed.lab, informe: q("#rvInforme").value.trim(), productor_raw: prod,
              localidad: q("#rvLoc").value.trim() || null, lote_raw: lote, manejo_tipo: null,
              muestra: (root.querySelector('.in-mu[data-l="' + li + '"][data-s="' + si + '"]').value.trim()) || groupedLabel || null,
              profundidad_raw: (root.querySelector('.in-prof[data-l="' + li + '"][data-s="' + si + '"]').value.trim()) || null,
              fecha_raw: fecha, campana: q("#rvCampana").value.trim() || null, params: params,
              _nota: "Cargado desde el panel (navegador) el " + new Date().toISOString().slice(0, 10) + ". PDF: " + parsed.fileName + ". Revisado a mano en el diálogo de carga."
            });
          });
        });
        if (bad) { toast("Falta el nombre de algún lote nuevo."); return; }
        if (!entries.length) { toast("No hay nada para agregar (todo desmarcado o sin valores)."); return; }
        closeModal();
        resolve(entries);
      });
    });
  }

  // ---------------- flujo de subida ----------------
  function handleFiles(files) {
    var list = Array.prototype.slice.call(files).filter(function (f) { return /\.pdf$/i.test(f.name); });
    if (!list.length) { toast("Elegí archivos PDF."); return Promise.resolve(); }
    toast("Leyendo " + list.length + " informe(s)…");
    var chain = Promise.resolve();
    var lastCampo = null;
    var added = 0;
    list.forEach(function (file, i) {
      chain = chain.then(function () {
        return file.arrayBuffer().then(function (buf) {
          return parsePdfBuffer(buf.slice(0), file.name).then(function (parsed) {
            if (!parsed.lotes.length) { toast(file.name + ": " + (parsed.warnings[0] || "no pude leerlo.")); return null; }
            return reviewParsed(parsed, i, list.length).then(function (entries) {
              if (!entries) return null;
              var blob = new Blob([buf], { type: "application/pdf" });
              entries.forEach(function (e) {
                e._uid = "e" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
                userEntries.push(e);
                lastCampo = addEntryToData(e);
                pdfUrls[e._uid] = pdfUrls["blob:" + file.name + ":" + buf.byteLength] || (pdfUrls["blob:" + file.name + ":" + buf.byteLength] = URL.createObjectURL(blob));
                idbPut(e._uid, blob).catch(function () {});
                added++;
              });
              lsSave();
            });
          });
        });
      }).catch(function (err) {
        toast(file.name + ": " + (err && err.message ? err.message : "error al leer el PDF"));
      });
    });
    return chain.then(function () {
      if (added) {
        refreshAll();
        if (lastCampo) selectCampo(lastCampo.id);
        toast("Agregué " + added + " análisis. Quedan guardados en este navegador; usá \"Pendientes\" para exportarlos y publicarlos.");
      }
    });
  }

  // ---------------- pendientes (exportar) ----------------
  function renderPendingButton() {
    var b = document.getElementById("btnPending");
    if (!b) return;
    b.style.display = userEntries.length ? "" : "none";
    b.textContent = "Pendientes de publicar (" + userEntries.length + ")";
  }

  function openPending() {
    var byFile = {};
    userEntries.forEach(function (e) { var k = e.productor_raw + " · " + e.lote_raw; byFile[k] = (byFile[k] || 0) + 1; });
    var html = '<div class="modal-back"><div class="modal">' +
      '<div class="modal-head"><h2>Análisis cargados desde este navegador</h2><button class="btn ghost" data-act="close">✕</button></div>' +
      '<p class="modal-sub">Estos análisis se ven <b>solo en este navegador</b>. Para que queden publicados para todos, descargá el archivo y mandámelo junto con los PDFs (o pasalo a quien mantiene el panel): se incorporan a <code>manual_entries.json</code>.</p>' +
      '<ul class="pend-list">' + Object.keys(byFile).map(function (k) { return "<li>" + esc(k) + " — " + byFile[k] + " fila(s)</li>"; }).join("") + "</ul>" +
      '<div class="modal-foot"><button class="btn ghost" data-act="clear">Borrar todos de este navegador</button><button class="btn primary" data-act="dl">Descargar JSON</button></div></div></div>';
    modalRoot().innerHTML = html;
    var root = modalRoot();
    root.querySelector('[data-act="close"]').addEventListener("click", closeModal);
    root.querySelector('[data-act="dl"]').addEventListener("click", function () {
      var out = userEntries.map(function (e) { var c = {}; Object.keys(e).forEach(function (k) { if (k !== "_uid") c[k] = e[k]; }); return c; });
      var blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "analisis_nuevos_" + new Date().toISOString().slice(0, 10) + ".json";
      document.body.appendChild(a); a.click(); a.remove();
    });
    root.querySelector('[data-act="clear"]').addEventListener("click", function () {
      if (!window.confirm("¿Borrar de este navegador los " + userEntries.length + " análisis cargados? (Los publicados no se tocan.)")) return;
      try { localStorage.removeItem(LS_KEY); } catch (e) {}
      idbOpen().then(function (db) { var tx = db.transaction("pdfs", "readwrite"); tx.objectStore("pdfs").clear(); tx.oncomplete = function () { location.reload(); }; }).catch(function () { location.reload(); });
    });
  }

  // ---------------- informes imprimibles ----------------
  var STATUS_TXT = { good: "Óptimo", warn: "Intermedio", bad: "Crítico" };

  function refText(m) {
    if (!m) return "";
    var u = m.unit ? " " + m.unit : "";
    if (m.dir === "hi") return "crítico < " + fmtNum(m.crit) + " · óptimo ≥ " + fmtNum(m.opt) + u;
    if (m.dir === "lo") return "óptimo ≤ " + fmtNum(m.opt) + " · crítico > " + fmtNum(m.crit) + u;
    if (m.dir === "rng") return "óptimo " + fmtNum(m.range_opt[0]) + " a " + fmtNum(m.range_opt[1]) + u;
    return "";
  }

  function absUrl(u) {
    try { return new URL(u, location.href).href; } catch (e) { return u; }
  }

  function chartSeries(rows, paramKey, depth, muestraSel) {
    var chartRows = rows.filter(function (r) { return (r.prof || "Sin dato") === depth; });
    if (muestraSel) chartRows = chartRows.filter(function (r) { return r.muestra === muestraSel; });
    var byGroup = {}, groupOrder = [];
    chartRows.forEach(function (r) {
      var v = r.params[paramKey];
      if (v === null || v === undefined) return;
      var tk = r.tipo || r.muestra || "General";
      if (!byGroup[tk]) { byGroup[tk] = []; groupOrder.push(tk); }
      byGroup[tk].push({ x: r.fecha, y: v });
    });
    var altIdx = 0;
    return groupOrder.map(function (k) {
      var color = TIPO_COLORS[k];
      if (!color) { color = SERIES_PALETTE[altIdx % SERIES_PALETTE.length]; altIdx++; }
      return { label: k, points: aggregateByDate(byGroup[k]), color: color };
    });
  }

  function legendHtmlFor(seriesList) {
    if (seriesList.length < 2) return "";
    return '<div class="legend">' + seriesList.map(function (s) {
      return '<div class="legend-item"><span class="legend-swatch" style="background:' + s.color + '"></span>' + esc(s.label) + "</div>";
    }).join("") + "</div>";
  }

  function reportForCampo(campo, opts) {
    var ds = campo.dataset;
    var meta = metaFor(ds);
    var priority = ds === "quimico" ? CHEM_PRIORITY : BIO_PRIORITY;
    var rows = campo.rows;
    var getter = function (r, k) { return r.params[k]; };
    var avail = paramsWithData(rows, priority, meta, getter);
    var municipio = rows.map(function (r) { return r.municipio || r.localidad; }).filter(Boolean)[0];
    var campanas = rows.reduce(function (a, r) { if (r.campana && a.indexOf(r.campana) === -1) a.push(r.campana); return a; }, []).sort();
    var labs = rows.reduce(function (a, r) { if (r.lab && a.indexOf(r.lab) === -1) a.push(r.lab); return a; }, []);
    var depth = modeDepth(rows);
    var hasMuestra = rows.some(function (r) { return r.muestra; });

    // ---- último análisis
    var last = campo.last_date;
    var lastRows = rows.filter(function (r) { return r.fecha === last; });
    var lastCols = paramsWithData(lastRows, priority, meta, getter).slice(0, 9);
    var lastHtml = !opts.last ? "" : '<table class="rep-table"><thead><tr><th>Prof.</th>' + (hasMuestra ? "<th>Punto</th>" : "") +
      lastCols.map(function (k) { return "<th>" + esc(meta[k].label) + (meta[k].unit ? "<small> (" + esc(meta[k].unit) + ")</small>" : "") + "</th>"; }).join("") +
      "</tr></thead><tbody>" + lastRows.map(function (r) {
        return "<tr><td>" + esc(r.prof || "—") + "</td>" + (hasMuestra ? "<td>" + esc(r.muestra || "—") + "</td>" : "") +
          lastCols.map(function (k) {
            var v = r.params[k], st = statusFor(v, meta[k]);
            return '<td class="' + (st ? "cell-" + st : "") + '">' + (v === null || v === undefined ? "—" : fmtNum(v)) + "</td>";
          }).join("") + "</tr>";
      }).join("") + "</tbody></table>" +
      '<div class="rep-ref"><b>Referencias:</b> ' + lastCols.map(function (k) { return esc(meta[k].label) + ": " + esc(refText(meta[k])); }).join(" · ") + "</div>";

    // ---- gráficos de evolución (prioriza parámetros con más de una fecha)
    var withTrend = avail.filter(function (k) {
      var dates = {};
      rows.forEach(function (r) { if ((r.prof || "Sin dato") === depth && r.params[k] !== null && r.params[k] !== undefined) dates[r.fecha] = 1; });
      return Object.keys(dates).length >= 2;
    });
    var chartKeys = (withTrend.length ? withTrend.slice(0, 6) : avail.slice(0, 4));
    var chartsHtml = chartKeys.map(function (k) {
      var sl = chartSeries(rows, k, depth, null);
      return '<div class="rep-chart"><div class="chart-title">' + esc(meta[k].label) + (meta[k].unit ? ' <span class="unit">(' + esc(meta[k].unit) + ")</span>" : "") + "</div>" +
        buildLineChart(sl, meta[k], meta[k].unit) + legendHtmlFor(sl) + "</div>";
    }).join("");

    // ---- historial
    var histHtml = "";
    if (opts.history) {
      var cols = avail.slice(0, 10);
      histHtml = '<h3>Historial de análisis</h3><table class="rep-table"><thead><tr><th>Fecha</th><th>Laboratorio</th><th>Informe</th><th>Prof.</th>' +
        (hasMuestra ? "<th>Punto</th>" : "") +
        cols.map(function (k) { return "<th>" + esc(meta[k].label.length > 14 ? k.replace(/_/g, " ") : meta[k].label) + "</th>"; }).join("") +
        "</tr></thead><tbody>" + rows.map(function (r) {
          var lk = rowLink(r);
          var inf = lk && lk.indexOf("blob:") !== 0 ? '<a href="' + esc(absUrl(lk)) + '">ver informe</a>' : esc(r.informe ? String(r.informe).replace(/\.pdf$/i, "") : "—");
          return "<tr><td>" + (r.fecha_is_estimate ? "~" : "") + fmtDate(r.fecha) + "</td><td>" + esc(r.lab || "—") + "</td><td>" + inf + "</td><td>" + esc(r.prof || "—") + "</td>" +
            (hasMuestra ? "<td>" + esc(r.muestra || "—") + "</td>" : "") +
            cols.map(function (k) {
              var v = r.params[k], st = statusFor(v, meta[k]);
              return '<td class="' + (st ? "cell-" + st : "") + '">' + (v === null || v === undefined ? "—" : fmtNum(v)) + "</td>";
            }).join("") + "</tr>";
        }).join("") + "</tbody></table>";
    }

    var overall = campoOverallStatus(campo);
    var overallHtml = overall ? '<span class="rep-pill ' + overall + '">Estado según último análisis: ' + STATUS_TXT[overall] + "</span>" : "";

    return '<section class="rep-lote">' +
      '<div class="rep-head"><div><h1>' + esc(campo.lote) + '</h1><div class="rep-sub">' + esc(campo.productor) + (municipio ? " · " + esc(municipio) : "") + "</div></div>" +
      '<div class="rep-badge ' + (ds === "quimico" ? "q" : "b") + '">' + (ds === "quimico" ? "ANÁLISIS CONVENCIONAL" : "ANÁLISIS MICROBIOLÓGICO") + "</div></div>" +
      '<div class="rep-meta"><span><b>' + campo.n_analyses + "</b> análisis</span><span>Período: <b>" + fmtDate(campo.first_date) + " – " + fmtDate(campo.last_date) + "</b></span>" +
      "<span>Campañas: <b>" + esc(campanas.join(", ") || "—") + "</b></span><span>Laboratorios: <b>" + esc(labs.join(", ") || "—") + "</b></span></div>" +
      overallHtml +
      (opts.last ? "<h3>Último análisis · " + fmtDate(last) + "</h3>" + lastHtml : "") +
      (opts.trend ? trendPanelHtml(campo, depth, { print: true }) : "") +
      (opts.charts ? "<h3>Evolución" + (depth ? " · profundidad " + esc(depth) : "") + "</h3>" +
        '<div class="rep-note">Franjas de fondo: rojo = crítico, amarillo = intermedio, verde = óptimo.' + (hasMuestra ? " Cada línea es un punto de muestreo." : "") + "</div>" +
        '<div class="rep-charts">' + chartsHtml + "</div>" : "") +
      histHtml + "</section>";
  }

  var reportIds = [];
  var reportOpts = { last: true, charts: true, history: true, trend: true, summary: false };

  function openReport(ids, preset) {
    reportIds = ids.slice();
    if (preset !== false && !reportOpts.__keep) reportOpts = { last: true, charts: true, history: true, trend: true, summary: false };
    delete reportOpts.__keep;
    var host = document.getElementById("reportView");
    host.hidden = false;
    document.body.classList.add("rep-open");
    renderReport();
  }
  function closeReport() {
    document.getElementById("reportView").hidden = true;
    document.body.classList.remove("rep-open");
  }
  function renderReport() {
    var host = document.getElementById("reportView");
    var campos = reportIds.map(function (id) { return CAMPO_BY_ID[id]; }).filter(Boolean);
    var today = new Date().toLocaleDateString("es-AR", { day: "2-digit", month: "long", year: "numeric" });
    host.innerHTML = '<div class="rep-toolbar no-print">' +
      '<div><b>Informe · ' + campos.length + (campos.length === 1 ? " lote" : " lotes") + '</b> <span class="rep-hint">En el diálogo de impresión elegí "Guardar como PDF".</span></div>' +
      '<div class="rep-actions">' +
      [["trend", "Seguimiento"], ["last", "Último análisis"], ["charts", "Gráficos"], ["history", "Historial"]].map(function (o) {
        return '<label class="chk"><input type="checkbox" data-ropt="' + o[0] + '"' + (reportOpts[o[0]] ? " checked" : "") + "> " + o[1] + "</label>";
      }).join("") +
      '<button class="btn primary" id="repPrint">Imprimir / Guardar PDF</button><button class="btn ghost" id="repClose">Cerrar</button></div></div>' +
      '<div class="report-light rep-doc"><div class="rep-cover"><div><div class="rep-title">Informe de análisis de suelo</div><div class="rep-sub">Panel de Suelos · generado el ' + esc(today) + "</div></div></div>" +
      (reportOpts.summary && campos.length > 1 ? reportSummaryHtml(campos) : "") +
      campos.map(function (c) { return reportForCampo(c, reportOpts); }).join("") +
      '<div class="rep-foot">Valores según los informes de laboratorio (Molisol, AFA, Clínica de Suelos, AgLab, TecnoSustrato). Umbrales de referencia: INTA / estándares pampeanos y metodología TecnoSustrato. Uso interno de campo.</div></div>';
    host.scrollTop = 0;
    document.getElementById("repClose").addEventListener("click", closeReport);
    Array.prototype.forEach.call(host.querySelectorAll("[data-ropt]"), function (cb) {
      cb.addEventListener("change", function () { reportOpts[cb.getAttribute("data-ropt")] = cb.checked; renderReport(); });
    });
    document.getElementById("repPrint").addEventListener("click", function () {
      var prev = document.title;
      document.title = campos.length === 1 ? "Informe - " + campos[0].lote + " - " + campos[0].productor : "Informe de suelos - " + campos.length + " lotes";
      var restore = function () { document.title = prev; window.removeEventListener("afterprint", restore); };
      window.addEventListener("afterprint", restore);
      window.print();
    });
  }

  // ---------------- modo selección (informe de varios lotes) ----------------
  function selectedCount() { return Object.keys(selectedIds).length; }

  function renderSelectBar() {
    var bar = document.getElementById("selectBar");
    if (!selectMode) { bar.hidden = true; return; }
    bar.hidden = false;
    bar.innerHTML = '<span><b>' + selectedCount() + '</b> lote(s) seleccionados</span>' +
      '<button class="btn ghost" id="selAll">Seleccionar los ' + getFiltered().length + ' de la lista</button>' +
      '<button class="btn ghost" id="selNone">Limpiar</button>' +
      '<button class="btn primary" id="selGo"' + (selectedCount() ? "" : " disabled") + '>Generar informe</button>' +
      '<button class="btn ghost" id="selCancel">Cancelar</button>';
    document.getElementById("selAll").addEventListener("click", function () {
      getFiltered().forEach(function (c) { selectedIds[c.id] = true; });
      renderList(); renderSelectBar();
    });
    document.getElementById("selNone").addEventListener("click", function () { selectedIds = {}; renderList(); renderSelectBar(); });
    document.getElementById("selCancel").addEventListener("click", function () { setSelectMode(false); });
    document.getElementById("selGo").addEventListener("click", function () {
      var ids = getFiltered().map(function (c) { return c.id; }).filter(function (id) { return selectedIds[id]; });
      Object.keys(selectedIds).forEach(function (id) { if (ids.indexOf(id) === -1) ids.push(id); });
      if (ids.length) openReport(ids);
    });
  }

  function setSelectMode(on) {
    selectMode = on;
    if (!on) selectedIds = {};
    var b = document.getElementById("btnSelectMode");
    if (b) b.classList.toggle("active", on);
    renderList();
    renderSelectBar();
  }

  function toggleSelected(id, on) {
    if (on) selectedIds[id] = true; else delete selectedIds[id];
    renderSelectBar();
  }

  // ---------------- botones de la cabecera ----------------
  function setupFeatureButtons() {
    var host = document.getElementById("topActions");
    host.innerHTML =
      '<button class="btn primary" id="btnUpload" title="Subir informes PDF (AFA, Molisol, TecnoSustrato) y sumarlos al panel">⬆ Subir informe (PDF)</button>' +
      '<button class="btn" id="btnTrendReport" title="Informe con las mejoras y alertas detectadas entre análisis (usa los filtros de la lista)">📈 Informe de seguimiento</button>' +
      '<button class="btn" id="btnSelectMode" title="Elegir varios lotes y generar un informe imprimible">🖨 Informe de lotes</button>' +
      '<button class="btn warnbtn" id="btnPending" style="display:none"></button>';
    var input = document.getElementById("pdfInput");
    document.getElementById("btnUpload").addEventListener("click", function () { input.click(); });
    input.addEventListener("change", function () {
      var files = input.files;
      handleFiles(files).then(function () { input.value = ""; });
    });
    document.getElementById("btnSelectMode").addEventListener("click", function () { setSelectMode(!selectMode); });
    document.getElementById("btnTrendReport").addEventListener("click", openTrendReport);
    document.getElementById("btnPending").addEventListener("click", openPending);
    // soltar PDFs sobre la página
    window.addEventListener("dragover", function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") !== -1) e.preventDefault(); });
    window.addEventListener("drop", function (e) {
      if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
      e.preventDefault();
      handleFiles(e.dataTransfer.files);
    });
  }

  function initUserData() {
    userEntries = lsLoad();
    userEntries.forEach(function (e) { try { addEntryToData(e); } catch (err) {} });
    recomputeStats();
    renderTopStats();
    refreshProductorSelect();
    renderPendingButton();
    if (userEntries.length) {
      idbGetAll().then(function (map) {
        Object.keys(map).forEach(function (k) { pdfUrls[k] = URL.createObjectURL(map[k]); });
        render();
      }).catch(function () {});
    }
  }

  window.__panelDebug = { parsePdfBuffer: parsePdfBuffer, handleFiles: handleFiles, openReport: openReport, campos: CAMPOS, addEntryToData: addEntryToData };
