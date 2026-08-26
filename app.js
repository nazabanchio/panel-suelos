(function () {
  "use strict";
  var DATA = JSON.parse(document.getElementById("app-data").textContent);
  var CAMPOS = DATA.campos;
  var CHEM_META = DATA.chem_param_meta;
  var BIO_META = DATA.bio_param_meta;
  var CAMPO_BY_ID = {};
  CAMPOS.forEach(function (c) { CAMPO_BY_ID[c.id] = c; });

  var CHEM_PRIORITY = ["MO", "pH", "CE", "P_BrayI", "N_NO3", "K_Interc", "Ca_Interc", "Mg_Interc", "Azufre_S"];
  var BIO_PRIORITY = ["N_bio", "P_bio", "K_bio", "pH", "ICS", "CO2_Resp", "Pct_Organico", "Act_Biologica"];

  var CLASS_ORDER = ["CRÍTICO", "INTERMEDIO", "ÓPTIMO"];
  var CLASS_TONE = { "CRÍTICO": "bad", "INTERMEDIO": "warn", "ÓPTIMO": "good" };

  var MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

  // ---------------- helpers ----------------
  function stripAccents(s) {
    return (s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  }
  function norm(s) { return stripAccents(String(s || "")).toLowerCase(); }

  function fmtDate(d) {
    if (!d) return "—";
    var parts = d.split("-");
    if (parts.length !== 3) return d;
    var m = parseInt(parts[1], 10) - 1;
    return parts[2] + " " + MONTHS[m] + " " + parts[0];
  }
  function fmtDateShort(d) {
    if (!d) return "—";
    var parts = d.split("-");
    if (parts.length !== 3) return d;
    var m = parseInt(parts[1], 10) - 1;
    return MONTHS[m] + " " + parts[0].slice(2);
  }
  function fmtNum(v, digits) {
    if (v === null || v === undefined) return "—";
    if (typeof digits !== "number") digits = (Math.abs(v) >= 100) ? 0 : (Math.abs(v) >= 10 ? 1 : 2);
    var r = Number(v.toFixed(digits));
    return r.toLocaleString("es-AR", { maximumFractionDigits: digits });
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function tipoClass(tipo) {
    if (tipo === "Químico") return "tipo-quimico";
    if (tipo === "Biológico") return "tipo-biologico";
    if (tipo === "Testigo") return "tipo-testigo";
    return "";
  }

  function aggregateByDate(points) {
    // Some reports (AgLab in particular) submit several sub-samples under the
    // exact same date/depth -- plotted individually those land right on top
    // of each other as a scattered vertical smear instead of a trend. One
    // averaged point per date reads as an actual evolution line.
    var byDate = {};
    var order = [];
    points.forEach(function (p) {
      if (!byDate[p.x]) { byDate[p.x] = []; order.push(p.x); }
      byDate[p.x].push(p.y);
    });
    return order.map(function (x) {
      var vals = byDate[x];
      var avg = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
      return { x: x, y: avg, n: vals.length };
    });
  }

  function statusFor(value, meta) {
    if (value === null || value === undefined || !meta) return null;
    if (meta.dir === "hi") {
      if (value < meta.crit) return "bad";
      if (value < meta.opt) return "warn";
      return "good";
    }
    if (meta.dir === "lo") {
      if (value > meta.crit) return "bad";
      if (value > meta.opt) return "warn";
      return "good";
    }
    if (meta.dir === "rng") {
      var ro = meta.range_opt, rw = meta.range_warn;
      if (value >= ro[0] && value <= ro[1]) return "good";
      if (value >= rw[0] && value <= rw[1]) return "warn";
      return "bad";
    }
    return null;
  }

  function classTone(clasificacion) {
    return CLASS_TONE[clasificacion] || null;
  }

  function rowStatus(row) {
    if (row.dataset === "quimico") {
      if (row.clasificacion) return classTone(row.clasificacion);
      if (row.score !== null && row.score !== undefined) {
        return row.score < 1.75 ? "bad" : (row.score < 2.5 ? "warn" : "good");
      }
      return null;
    }
    var ics = row.params.ICS;
    if (ics !== null && ics !== undefined) return statusFor(ics, BIO_META.ICS);
    var ab = row.params.Act_Biologica;
    if (ab !== null && ab !== undefined) return statusFor(ab, BIO_META.Act_Biologica);
    return null;
  }

  function campoLatestRow(campo, datasetFilter) {
    var rows = campo.rows.filter(function (r) { return !datasetFilter || r.dataset === datasetFilter; });
    if (!rows.length) return null;
    return rows[rows.length - 1];
  }

  function campoOverallStatus(campo) {
    var r = campoLatestRow(campo, "quimico") || campoLatestRow(campo, "biologico");
    if (!r) return null;
    var st = rowStatus(r);
    if (st) return st;
    var other = r.dataset === "quimico" ? campoLatestRow(campo, "biologico") : campoLatestRow(campo, "quimico");
    return other ? rowStatus(other) : null;
  }

  function defaultSparkParam(campo) {
    if (campo.dataset === "quimico") return { ds: "quimico", key: "MO", meta: CHEM_META.MO };
    return { ds: "biologico", key: "ICS", meta: BIO_META.ICS };
  }

  // ---------------- state ----------------
  var state = {
    search: "",
    dataset: "todos",
    tipo: "todos",
    productor: "todos",
    sort: "nombre",
    selectedId: null,
    selectedParam: null,
    selectedDepth: null
  };

  // ---------------- filtering ----------------
  function campoSearchBlob(c) {
    if (!c._blob) {
      var infs = c.rows.map(function (r) { return r.informe || ""; }).join(" ");
      c._blob = norm([c.productor, c.lote, c.key_lote, infs].join(" "));
    }
    return c._blob;
  }

  function getFiltered() {
    var q = norm(state.search.trim());
    var list = CAMPOS.filter(function (c) {
      if (state.dataset !== "todos" && c.dataset !== state.dataset) return false;
      if (state.tipo !== "todos" && c.tipos.indexOf(state.tipo) === -1) return false;
      if (state.productor !== "todos" && c.productor !== state.productor) return false;
      if (q && campoSearchBlob(c).indexOf(q) === -1) return false;
      return true;
    });
    list.sort(function (a, b) {
      if (state.sort === "nombre") return (a.productor + a.lote).localeCompare(b.productor + b.lote, "es");
      if (state.sort === "fecha") return (b.last_date || "").localeCompare(a.last_date || "");
      if (state.sort === "analisis") return b.n_analyses - a.n_analyses;
      if (state.sort === "atencion") {
        var order = { bad: 0, warn: 1, good: 2 };
        var sa = order[campoOverallStatus(a)]; sa = sa === undefined ? 3 : sa;
        var sb = order[campoOverallStatus(b)]; sb = sb === undefined ? 3 : sb;
        return sa - sb;
      }
      return 0;
    });
    return list;
  }

  // ---------------- sparkline ----------------
  function sparklineSVG(campo) {
    var p = defaultSparkParam(campo);
    var rows = campo.rows.filter(function (r) { return r.dataset === p.ds && r.params[p.key] !== null && r.params[p.key] !== undefined; });
    if (rows.length < 2) return "";
    rows = rows.slice(-8);
    var vals = rows.map(function (r) { return r.params[p.key]; });
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
    if (min === max) { min -= 1; max += 1; }
    var w = 120, h = 26, pad = 3;
    var pts = vals.map(function (v, i) {
      var x = pad + (i / (vals.length - 1)) * (w - pad * 2);
      var y = h - pad - ((v - min) / (max - min)) * (h - pad * 2);
      return [x, y];
    });
    var path = pts.map(function (pt, i) { return (i === 0 ? "M" : "L") + pt[0].toFixed(1) + "," + pt[1].toFixed(1); }).join(" ");
    var last = pts[pts.length - 1];
    var st = statusFor(vals[vals.length - 1], p.meta) || "good";
    return '<svg class="spark" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
      '<path d="' + path + '" fill="none" stroke="var(--ink-faint)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="2.6" fill="var(--' + st + ')"/>' +
      "</svg>";
  }

  // ---------------- list rendering ----------------
  function renderList() {
    var list = getFiltered();
    document.getElementById("resultCount").textContent = list.length + (list.length === 1 ? " campo" : " campos");
    var pane = document.getElementById("listPane");
    if (!list.length) {
      pane.innerHTML = '<div class="empty-list">Sin resultados para estos filtros.<br>Probá ajustar la búsqueda.</div>';
      return;
    }
    var html = list.map(function (c) {
      var st = campoOverallStatus(c) || "none";
      var badges = c.dataset === "quimico"
        ? '<span class="badge q" title="Análisis convencional (macro/micronutrientes)">CONV · ' + c.n_analyses + "</span>"
        : '<span class="badge b" title="Análisis microbiológico (TecnoSustrato)">MICROB · ' + c.n_analyses + "</span>";
      var range = c.first_date === c.last_date ? fmtDateShort(c.last_date) : fmtDateShort(c.first_date) + " – " + fmtDateShort(c.last_date);
      return '<div class="campo-card' + (c.id === state.selectedId ? " selected" : "") + '" data-id="' + c.id + '">' +
        '<div class="row1"><span class="status-dot ' + st + '"></span><span class="campo-title">' + esc(c.lote) + "</span></div>" +
        '<div class="campo-sub">' + esc(c.productor) + "</div>" +
        '<div class="row2">' + badges + "</div>" +
        '<div class="campo-meta">' + c.n_analyses + " análisis · " + range + "</div>" +
        sparklineSVG(c) +
        "</div>";
    }).join("");
    pane.innerHTML = html;
    Array.prototype.forEach.call(pane.querySelectorAll(".campo-card"), function (el) {
      el.addEventListener("click", function () { selectCampo(el.getAttribute("data-id")); });
    });
  }

  // ---------------- chart ----------------
  var TIPO_COLORS = {
    "Químico": "var(--series-quimico)",
    "Biológico": "var(--series-biologico)",
    "Testigo": "var(--series-testigo)",
    "General": "var(--series-general)",
    "Convencional": "var(--series-quimico)",
    "Microbiológico": "var(--series-biologico)"
  };

  function bandsFor(meta, domainMin, domainMax) {
    var bands = [];
    if (meta.dir === "hi") {
      bands.push([domainMin, meta.crit, "bad"]);
      bands.push([meta.crit, meta.opt, "warn"]);
      bands.push([meta.opt, domainMax, "good"]);
    } else if (meta.dir === "lo") {
      bands.push([domainMin, meta.opt, "good"]);
      bands.push([meta.opt, meta.crit, "warn"]);
      bands.push([meta.crit, domainMax, "bad"]);
    } else if (meta.dir === "rng") {
      var ro = meta.range_opt, rw = meta.range_warn;
      bands.push([domainMin, rw[0], "bad"]);
      bands.push([rw[0], ro[0], "warn"]);
      bands.push([ro[0], ro[1], "good"]);
      bands.push([ro[1], rw[1], "warn"]);
      bands.push([rw[1], domainMax, "bad"]);
    }
    return bands.filter(function (b) { return b[1] > b[0]; })
      .map(function (b) { return [Math.max(b[0], domainMin), Math.min(b[1], domainMax), b[2]]; })
      .filter(function (b) { return b[1] > b[0]; });
  }

  function buildLineChart(seriesList, meta, unit) {
    var W = 760, H = 280, ML = 46, MR = 16, MT = 16, MB = 40;
    var plotW = W - ML - MR, plotH = H - MT - MB;

    var allDates = [];
    seriesList.forEach(function (s) { s.points.forEach(function (p) { if (allDates.indexOf(p.x) === -1) allDates.push(p.x); }); });
    allDates.sort();
    if (!allDates.length) return '<div class="empty-detail">No hay valores registrados para este parámetro.</div>';

    var allVals = [];
    seriesList.forEach(function (s) { s.points.forEach(function (p) { allVals.push(p.y); }); });
    var dataMin = Math.min.apply(null, allVals), dataMax = Math.max.apply(null, allVals);
    var refs = [];
    if (meta.dir === "hi" || meta.dir === "lo") { refs = [meta.crit, meta.opt]; }
    else if (meta.dir === "rng") { refs = meta.range_warn.concat(meta.range_opt); }
    var domainMin = Math.min(dataMin, refs.length ? Math.min.apply(null, refs) : dataMin);
    var domainMax = Math.max(dataMax, refs.length ? Math.max.apply(null, refs) : dataMax);
    var pad = (domainMax - domainMin) * 0.12 || Math.abs(domainMax) * 0.1 || 1;
    domainMin -= pad; domainMax += pad;
    if (domainMin === domainMax) { domainMin -= 1; domainMax += 1; }

    function xPos(dateStr) {
      var i = allDates.indexOf(dateStr);
      if (allDates.length === 1) return ML + plotW / 2;
      return ML + (i / (allDates.length - 1)) * plotW;
    }
    function yPos(v) {
      return MT + plotH - ((v - domainMin) / (domainMax - domainMin)) * plotH;
    }

    var svg = [];
    svg.push('<svg viewBox="0 0 ' + W + " " + H + '" width="100%" height="' + H + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Evolución de ' + esc(meta.label) + '">');

    var bands = bandsFor(meta, domainMin, domainMax);
    bands.forEach(function (b) {
      var y0 = yPos(b[1]), y1 = yPos(b[0]);
      svg.push('<rect x="' + ML + '" y="' + y0.toFixed(1) + '" width="' + plotW + '" height="' + (y1 - y0).toFixed(1) + '" fill="var(--' + b[2] + '-soft)" />');
    });

    var ticks = 4;
    for (var t = 0; t <= ticks; t++) {
      var v = domainMin + (t / ticks) * (domainMax - domainMin);
      var y = yPos(v);
      svg.push('<line x1="' + ML + '" x2="' + (W - MR) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke="var(--border)" stroke-width="1" />');
      svg.push('<text x="' + (ML - 8) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="end" font-size="10" fill="var(--ink-faint)">' + fmtNum(v) + "</text>");
    }

    var step = Math.ceil(allDates.length / 7);
    var lastLabel = null;
    allDates.forEach(function (d, i) {
      if (i % step !== 0 && i !== allDates.length - 1) return;
      var label = fmtDateShort(d);
      // two dates a day or two apart (different labs testing the same lot in
      // the same week) can render the same "mmm yy" label right next to
      // itself, which reads as a glitch -- skip the repeat, the point itself
      // still gets its own x position and tooltip
      if (label === lastLabel) return;
      lastLabel = label;
      var x = xPos(d);
      svg.push('<text x="' + x.toFixed(1) + '" y="' + (H - MB + 18) + '" text-anchor="middle" font-size="13" font-weight="600" fill="var(--ink)">' + esc(label) + "</text>");
    });

    seriesList.forEach(function (s, sIdx) {
      var pts = s.points.slice().sort(function (a, b) { return a.x < b.x ? -1 : 1; });
      if (!pts.length) return;
      var color = TIPO_COLORS[s.label] || "var(--series-general)";
      // when two series share a date, their labels would land on the exact
      // same spot -- alternate above/below by series so both stay readable
      var labelAbove = sIdx % 2 === 0;
      var path = pts.map(function (p, i) { return (i === 0 ? "M" : "L") + xPos(p.x).toFixed(1) + "," + yPos(p.y).toFixed(1); }).join(" ");
      svg.push('<path d="' + path + '" fill="none" stroke="' + color + '" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" />');
      pts.forEach(function (p, i) {
        var st = statusFor(p.y, meta) || "good";
        var isLast = i === pts.length - 1;
        var ptLabel = fmtDateShort(p.x) + ": " + fmtNum(p.y) + " " + (unit || "") + " (" + s.label + ")" + (p.n > 1 ? " · promedio de " + p.n + " muestras" : "");
        svg.push('<circle cx="' + xPos(p.x).toFixed(1) + '" cy="' + yPos(p.y).toFixed(1) + '" r="' + (isLast ? 4.5 : 3.4) + '" fill="var(--' + st + ')" stroke="' + color + '" stroke-width="1.6"><title>' + esc(ptLabel) + "</title></circle>");
        var labelY = labelAbove ? yPos(p.y) - 9 : yPos(p.y) + 17;
        svg.push('<text x="' + xPos(p.x).toFixed(1) + '" y="' + labelY.toFixed(1) + '" text-anchor="middle" font-size="10.5" font-weight="' + (isLast ? 700 : 600) + '" fill="' + (isLast ? "var(--ink)" : color) + '">' + fmtNum(p.y) + "</text>");
      });
    });

    svg.push("</svg>");
    return svg.join("");
  }

  // ---------------- overview ----------------
  function renderOverview() {
    var nChem = DATA.stats.n_chem, nBio = DATA.stats.n_bio;

    var classCounts = {};
    CLASS_ORDER.forEach(function (k) { classCounts[k] = 0; });
    var attn = [];
    CAMPOS.forEach(function (c) {
      var r = campoLatestRow(c, "quimico");
      if (r && r.clasificacion && classCounts.hasOwnProperty(r.clasificacion)) classCounts[r.clasificacion]++;
      var st = campoOverallStatus(c);
      if (st === "bad") attn.push(c);
    });
    attn.sort(function (a, b) {
      var ra = campoLatestRow(a, "quimico") || campoLatestRow(a, "biologico");
      var rb = campoLatestRow(b, "quimico") || campoLatestRow(b, "biologico");
      var sa = ra ? (ra.score !== undefined && ra.score !== null ? ra.score : (ra.params && ra.params.ICS)) : 99;
      var sb = rb ? (rb.score !== undefined && rb.score !== null ? rb.score : (rb.params && rb.params.ICS)) : 99;
      return (sa === null || sa === undefined ? 99 : sa) - (sb === null || sb === undefined ? 99 : sb);
    });

    var maxClassCount = Math.max.apply(null, CLASS_ORDER.map(function (k) { return classCounts[k]; }));
    var barsHtml = CLASS_ORDER.map(function (k) {
      var v = classCounts[k];
      var tone = CLASS_TONE[k];
      var pct = maxClassCount ? (v / maxClassCount) * 100 : 0;
      return '<div class="bar-row"><span class="lbl">' + k + '</span><div class="bar-track"><div class="bar-fill" style="width:' + pct.toFixed(0) + '%;background:var(--' + tone + ')"></div></div><span class="val">' + v + "</span></div>";
    }).join("");

    var attnHtml = attn.length ? attn.slice(0, 10).map(function (c) {
      var r = campoLatestRow(c, "quimico") || campoLatestRow(c, "biologico");
      var label = r && r.dataset === "quimico" ? (r.clasificacion || "Crítico") : "Baja actividad biológica";
      return '<div class="attn-item" data-id="' + c.id + '"><span class="status-dot bad"></span><span class="campo-title">' + esc(c.lote) + " · " + esc(c.productor) + '</span><span class="attn-score" style="background:var(--bad-soft);color:var(--bad)">' + label + "</span></div>";
    }).join("") : '<p style="color:var(--ink-faint);font-size:12.5px;">Ningún campo en estado crítico según el último análisis registrado. Buen panorama general.</p>';

    var nProd = DATA.stats.n_productores;

    var html = '' +
      '<div class="panel">' +
      '<h2 style="font-size:16px;margin-bottom:12px;">Panorama general</h2>' +
      '<div class="overview-grid">' +
      '<div class="tile"><b class="num">' + DATA.stats.n_campos + '</b><span>Campos / lotes relevados</span></div>' +
      '<div class="tile"><b class="num">' + (nChem + nBio) + '</b><span>Análisis totales (' + nChem + ' convencionales · ' + nBio + ' microbiológicos)</span></div>' +
      '<div class="tile"><b class="num">' + nProd + '</b><span>Productores / establecimientos</span></div>' +
      "</div></div>" +
      '<div class="panel">' +
      '<h2 style="font-size:15px;margin-bottom:10px;">Estado de fertilidad química — último análisis por campo</h2>' +
      barsHtml +
      "</div>" +
      '<div class="panel">' +
      '<h2 style="font-size:15px;margin-bottom:6px;">Campos que requieren atención</h2>' +
      '<p style="color:var(--ink-faint);font-size:11.5px;margin:0 0 8px;">Según clasificación química crítica o baja actividad biológica en el análisis más reciente.</p>' +
      attnHtml +
      "</div>" +
      '<div class="panel empty-detail" style="padding:30px 20px;">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m21 21-4.3-4.3"/><circle cx="11" cy="11" r="7"/></svg>' +
      "<div>Buscá o elegí un campo de la lista para ver su ficha completa,<br>histórico de análisis y evolución de parámetros.</div>" +
      "</div>";

    var pane = document.getElementById("detailPane");
    pane.innerHTML = html;
    Array.prototype.forEach.call(pane.querySelectorAll(".attn-item"), function (el) {
      el.addEventListener("click", function () { selectCampo(el.getAttribute("data-id")); });
    });
  }

  // ---------------- detail ----------------
  function paramsWithData(rows, priorityList, meta, getter) {
    var have = {};
    rows.forEach(function (r) {
      Object.keys(meta).forEach(function (k) { var v = getter(r, k); if (v !== null && v !== undefined) have[k] = true; });
    });
    var out = priorityList.filter(function (k) { return have[k]; });
    Object.keys(meta).forEach(function (k) { if (have[k] && out.indexOf(k) === -1) out.push(k); });
    return out;
  }

  function modeDepth(rows) {
    var counts = {};
    rows.forEach(function (r) { var p = r.prof || "Sin dato"; counts[p] = (counts[p] || 0) + 1; });
    var best = null, bestN = -1;
    Object.keys(counts).forEach(function (p) {
      if (p.indexOf("0-20") !== -1 && counts[p] >= bestN) { best = p; bestN = counts[p] + 0.5; return; }
      if (counts[p] > bestN) { best = p; bestN = counts[p]; }
    });
    return best;
  }

  function renderCampoDetail(campo) {
    var ds = campo.dataset;
    var meta = ds === "quimico" ? CHEM_META : BIO_META;
    var priority = ds === "quimico" ? CHEM_PRIORITY : BIO_PRIORITY;
    var dsRows = campo.rows;
    function paramVal(r, k) { return r.params[k]; }

    var campanas = dsRows.reduce(function (a, r) { if (r.campana && a.indexOf(r.campana) === -1) a.push(r.campana); return a; }, []).sort();
    var municipio = dsRows.map(function (r) { return r.municipio || r.localidad; }).filter(Boolean)[0];
    var labs = dsRows.reduce(function (a, r) { if (r.lab && a.indexOf(r.lab) === -1) a.push(r.lab); return a; }, []);

    var badges = ds === "quimico"
      ? '<span class="badge q">CONVENCIONAL · ' + campo.n_analyses + "</span>"
      : '<span class="badge b">MICROBIOLÓGICO · ' + campo.n_analyses + "</span>";

    var depths = dsRows.reduce(function (a, r) { var p = r.prof || "Sin dato"; if (a.indexOf(p) === -1) a.push(p); return a; }, []);
    if (!state.selectedDepth || depths.indexOf(state.selectedDepth) === -1) state.selectedDepth = modeDepth(dsRows);
    var depthHtml = "";
    if (depths.length > 1) {
      depthHtml = '<div class="depth-picker"><span class="glabel">Profundidad</span>' + depths.map(function (d) {
        return '<span class="chip depth-chip' + (d === state.selectedDepth ? " active" : "") + '" data-depth="' + esc(d) + '">' + esc(d) + "</span>";
      }).join("") + "</div>";
    }

    var availParams = paramsWithData(dsRows, priority, meta, paramVal);
    if (!state.selectedParam || availParams.indexOf(state.selectedParam) === -1) state.selectedParam = availParams[0];
    var paramHtml = '<div class="param-picker">' + availParams.map(function (k) {
      return '<span class="chip param-chip' + (k === state.selectedParam ? " active" : "") + '" data-param="' + k + '" title="' + esc(meta[k].label) + '">' + esc(meta[k].label) + "</span>";
    }).join("") + "</div>";

    var chartHtml = "";
    if (state.selectedParam) {
      var pmeta = meta[state.selectedParam];
      var chartRows = dsRows.filter(function (r) { return (r.prof || "Sin dato") === state.selectedDepth; });
      var byGroup = {};
      chartRows.forEach(function (r) {
        var v = paramVal(r, state.selectedParam);
        if (v === null || v === undefined) return;
        var tk = r.tipo || "General";
        if (!byGroup[tk]) byGroup[tk] = [];
        byGroup[tk].push({ x: r.fecha, y: v });
      });
      var seriesList = Object.keys(byGroup).map(function (k) { return { label: k, points: aggregateByDate(byGroup[k]) }; });
      var legendHtml = "";
      if (seriesList.length > 1) {
        legendHtml = '<div class="legend">' + seriesList.map(function (s) {
          return '<div class="legend-item"><span class="legend-swatch" style="background:' + (TIPO_COLORS[s.label] || "var(--series-general)") + '"></span>' + esc(s.label) + "</div>";
        }).join("") + "</div>";
      }
      chartHtml = '<div class="chart-wrap">' +
        '<div class="chart-title">' + esc(pmeta.label) + (pmeta.unit ? ' <span class="unit">(' + esc(pmeta.unit) + ")</span>" : "") + "</div>" +
        (state.selectedDepth ? '<div class="chart-desc">Profundidad: ' + esc(state.selectedDepth) + " · Franjas de fondo: rojo = crítico, amarillo = intermedio, verde = óptimo</div>" : "") +
        buildLineChart(seriesList, pmeta, pmeta.unit) +
        legendHtml +
        "</div>";
    }

    var tableCols = availParams.slice(0, 12);
    var tableRows = dsRows.slice().sort(function (a, b) { return (a.fecha || "").localeCompare(b.fecha || ""); });
    var theadHtml = "<tr><th>Fecha</th><th>Informe</th><th>Laboratorio</th><th>Tipo</th><th>Prof.</th>" +
      tableCols.map(function (k) { return "<th>" + esc(meta[k].label.length > 16 ? k.replace(/_/g, " ") : meta[k].label) + "</th>"; }).join("") +
      (ds === "quimico" ? "<th>Score</th>" : "") + "</tr>";
    var tbodyHtml = tableRows.map(function (r) {
      var cells = tableCols.map(function (k) {
        var v = paramVal(r, k);
        var st = statusFor(v, meta[k]);
        var cls = st ? "cell-" + st : "";
        return '<td class="' + cls + '">' + (v === null || v === undefined ? "—" : fmtNum(v)) + "</td>";
      }).join("");
      var scoreCell = "";
      if (ds === "quimico") {
        var stq = classTone(r.clasificacion);
        scoreCell = '<td class="' + (stq ? "cell-" + stq : "") + '">' + (r.clasificacion || (r.score !== null && r.score !== undefined ? fmtNum(r.score) : "—")) + "</td>";
      }
      var labCell = "<td>" + esc(r.lab || "—") + "</td>";
      var informeCell = "<td>" + (r.informe_file ? '<a href="' + esc(r.informe_file) + '" target="_blank" rel="noopener" class="informe-link" title="Abrir informe original en PDF">Ver PDF</a>' : "—") + "</td>";
      var fechaCell = r.fecha_is_estimate
        ? '<td title="Sin fecha exacta en la planilla: se usa el inicio de la campaña ' + esc(r.campana || "") + ' como referencia">~' + fmtDate(r.fecha) + "</td>"
        : "<td>" + fmtDate(r.fecha) + "</td>";
      return "<tr>" + fechaCell + informeCell + labCell + '<td><span class="tipo-pill ' + tipoClass(r.tipo) + '">' + esc(r.tipo || "—") + '</span></td><td>' + esc(r.prof || "—") + "</td>" + cells + scoreCell + "</tr>";
    }).join("");

    var pane = document.getElementById("detailPane");
    pane.innerHTML =
      '<div class="panel">' +
      '<button class="back-btn" id="backBtn">← Volver a la lista</button>' +
      '<div class="detail-head"><div><h2>' + esc(campo.lote) + "</h2>" +
      '<div class="sub">' + esc(campo.productor) + (municipio ? " · " + esc(municipio) : "") + "</div></div>" +
      "<div>" + badges + "</div></div>" +
      '<div class="meta-row">' +
      '<span class="meta-item"><b>' + campo.n_analyses + "</b> análisis registrados</span>" +
      '<span class="meta-item">Campañas: <b>' + (campanas.join(", ") || "—") + "</b></span>" +
      '<span class="meta-item">Laboratorios: <b>' + (labs.join(", ") || "—") + "</b></span>" +
      "</div>" +
      '<div class="subcontrols">' + paramHtml + depthHtml + "</div>" +
      chartHtml +
      '<div class="table-scroll"><table class="data-table"><thead>' + theadHtml + "</thead><tbody>" + tbodyHtml + "</tbody></table></div>" +
      "</div>";

    var backBtn = document.getElementById("backBtn");
    if (backBtn) backBtn.addEventListener("click", function () { state.selectedId = null; render(); window.scrollTo({ top: 0, behavior: "smooth" }); });

    Array.prototype.forEach.call(pane.querySelectorAll(".depth-chip"), function (el) {
      el.addEventListener("click", function () { state.selectedDepth = el.getAttribute("data-depth"); renderCampoDetail(campo); });
    });
    Array.prototype.forEach.call(pane.querySelectorAll(".param-chip"), function (el) {
      el.addEventListener("click", function () { state.selectedParam = el.getAttribute("data-param"); renderCampoDetail(campo); });
    });
  }

  function selectCampo(id) {
    state.selectedId = id;
    state.selectedParam = null; state.selectedDepth = null;
    render();
    var card = document.querySelector('.campo-card[data-id="' + id + '"]');
    if (card) card.scrollIntoView({ block: "nearest" });
    if (window.matchMedia("(max-width: 900px)").matches) {
      document.getElementById("detailPane").scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function render() {
    renderList();
    if (state.selectedId && CAMPO_BY_ID[state.selectedId]) {
      renderCampoDetail(CAMPO_BY_ID[state.selectedId]);
    } else {
      renderOverview();
    }
  }

  // ---------------- controls setup ----------------
  function setupControls() {
    document.getElementById("topStats").innerHTML =
      '<div class="stat-chip"><b class="num">' + DATA.stats.n_campos + '</b><span>Campos</span></div>' +
      '<div class="stat-chip"><b class="num">' + (DATA.stats.n_chem + DATA.stats.n_bio) + '</b><span>Análisis</span></div>' +
      '<div class="stat-chip"><b class="num">' + DATA.stats.n_productores + '</b><span>Productores</span></div>';

    var dsGroup = document.getElementById("datasetFilter");
    [["todos", "Todos"], ["quimico", "Análisis convencional"], ["biologico", "Análisis microbiológico"]].forEach(function (pair) {
      var el = document.createElement("span");
      el.className = "chip" + (pair[0] === "todos" ? " active" : "");
      el.textContent = pair[1];
      el.setAttribute("data-val", pair[0]);
      el.addEventListener("click", function () {
        state.dataset = pair[0];
        Array.prototype.forEach.call(dsGroup.querySelectorAll(".chip"), function (c) { c.classList.remove("active"); });
        el.classList.add("active");
        renderList();
      });
      dsGroup.appendChild(el);
    });

    var tipoGroup = document.getElementById("tipoFilter");
    [["todos", "Todos"], ["Biológico", "Biológico"], ["Químico", "Químico"]].forEach(function (pair) {
      var el = document.createElement("span");
      el.className = "chip" + (pair[0] === "todos" ? " active" : "");
      el.textContent = pair[1];
      el.addEventListener("click", function () {
        state.tipo = pair[0];
        Array.prototype.forEach.call(tipoGroup.querySelectorAll(".chip"), function (c) { c.classList.remove("active"); });
        el.classList.add("active");
        renderList();
      });
      tipoGroup.appendChild(el);
    });

    var productores = CAMPOS.reduce(function (a, c) { if (a.indexOf(c.productor) === -1) a.push(c.productor); return a; }, []).sort(function (a, b) { return a.localeCompare(b, "es"); });
    var prodSel = document.getElementById("productorFilter");
    var optAll = document.createElement("option");
    optAll.value = "todos"; optAll.textContent = "Todos los productores";
    prodSel.appendChild(optAll);
    productores.forEach(function (p) {
      var o = document.createElement("option");
      o.value = p; o.textContent = p;
      prodSel.appendChild(o);
    });
    prodSel.addEventListener("change", function () { state.productor = prodSel.value; renderList(); });

    document.getElementById("sortSelect").addEventListener("change", function (e) { state.sort = e.target.value; renderList(); });

    var searchInput = document.getElementById("searchInput");
    var t = null;
    searchInput.addEventListener("input", function (e) {
      clearTimeout(t);
      var v = e.target.value;
      t = setTimeout(function () { state.search = v; renderList(); }, 90);
    });
  }

  setupControls();
  render();
})();
