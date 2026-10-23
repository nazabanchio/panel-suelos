  // =====================================================================
  // SEGUIMIENTO (se inserta dentro del IIFE de app.js via build.py):
  // detecta evoluciones, mejoras y alertas entre análisis de un mismo lote.
  // Convencional y microbiológico se analizan SIEMPRE por separado: cada
  // campo pertenece a un solo estudio y nunca se mezclan sus datos.
  // =====================================================================

  // parámetros que varían mucho con la época / el cultivo: se informan, pero
  // no pesan en el veredicto general del lote
  var VOLATILE = { N_NO3: 1, Azufre_S: 1, CE: 1, CO2_Resp: 1, N_bio: 1, P_bio: 1, K_bio: 1, Agua_Util: 1 };
  var ST_WORD = { good: "óptimo", warn: "intermedio", bad: "crítico" };
  var STALE_MONTHS = 12;

  function goodRank(st) { return st === "good" ? 2 : (st === "warn" ? 1 : (st === "bad" ? 0 : null)); }
  function distOutside(v, meta) {
    var ro = meta.range_opt;
    if (v < ro[0]) return ro[0] - v;
    if (v > ro[1]) return v - ro[1];
    return 0;
  }
  function sigThreshold(key, meta, prev) {
    var span = (meta.dir === "hi" || meta.dir === "lo") ? Math.abs(meta.opt - meta.crit) : (meta.range_opt[1] - meta.range_opt[0]);
    if (key === "pH") return 0.2;
    return Math.max(0.12 * Math.abs(prev), 0.1 * span);
  }

  // compara dos valores consecutivos de un mismo parámetro
  function judge(key, meta, prev, last) {
    var d = last - prev;
    var stPrev = statusFor(prev, meta), stLast = statusFor(last, meta);
    var rp = goodRank(stPrev), rl = goodRank(stLast);
    var sig = Math.abs(d) >= sigThreshold(key, meta, prev);
    var rel = prev !== 0 ? Math.abs(d) / Math.abs(prev) : 1;
    var verdict = "estable", note = null;
    if (rp !== null && rl !== null && rp === 2 && rl === 2) {
      // ya estaba en óptimo y sigue ahí: no es ni mejora ni alerta, solo se deja asentado el cambio
      if (sig && rel >= 0.25) note = "varió dentro del rango óptimo";
    } else if (rp !== null && rl !== null && rp !== rl && (sig || rel >= 0.05)) {
      verdict = rl > rp ? "mejora" : "empeora";
    } else if (sig) {
      var better = null;
      if (meta.dir === "hi") better = d > 0;
      else if (meta.dir === "lo") better = d < 0;
      else if (meta.dir === "rng") {
        var dp = distOutside(prev, meta), dl = distOutside(last, meta);
        better = dp === dl ? null : dl < dp;
      }
      if (better === true) verdict = "mejora"; else if (better === false) verdict = "empeora";
    }
    return { verdict: verdict, d: d, rel: rel, stPrev: stPrev, stLast: stLast, note: note };
  }

  function avg(a) { return a.reduce(function (x, y) { return x + y; }, 0) / a.length; }

  // todas las series (profundidad x tipo de manejo) con 2 o más fechas
  function buildTrendItems(campo) {
    var meta = metaFor(campo.dataset);
    var groups = {}, items = [];
    campo.rows.forEach(function (r) {
      var g = (r.prof || "Sin dato") + "|" + (r.tipo || "");
      (groups[g] = groups[g] || []).push(r);
    });
    Object.keys(groups).forEach(function (g) {
      var parts = g.split("|"), depth = parts[0], tipo = parts[1] || null, rows = groups[g];
      Object.keys(meta).forEach(function (key) {
        var byDate = {}, order = [];
        rows.forEach(function (r) {
          var v = r.params[key];
          if (v === null || v === undefined) return;
          if (!byDate[r.fecha]) { byDate[r.fecha] = { vals: [], labs: {} }; order.push(r.fecha); }
          byDate[r.fecha].vals.push(v);
          if (r.lab) byDate[r.fecha].labs[r.lab] = 1;
        });
        order.sort();
        if (order.length < 2) return;
        var pts = order.map(function (d) { return { date: d, v: avg(byDate[d].vals), labs: Object.keys(byDate[d].labs) }; });
        var first = pts[0], prev = pts[pts.length - 2], last = pts[pts.length - 1];
        var j = judge(key, meta[key], prev.v, last.v);
        var labChange = prev.labs.length && last.labs.length && !last.labs.some(function (l) { return prev.labs.indexOf(l) !== -1; });
        // tendencia sostenida: 3+ análisis que se mueven siempre en el mismo sentido
        var sustained = false;
        if (pts.length >= 3 && j.verdict !== "estable") {
          sustained = true;
          for (var i = 1; i < pts.length; i++) {
            var step = pts[i].v - pts[i - 1].v;
            if ((j.d > 0 && step <= 0) || (j.d < 0 && step >= 0)) { sustained = false; break; }
          }
        }
        items.push({
          key: key, label: meta[key].label, unit: meta[key].unit, depth: depth, tipo: tipo, volatile: !!VOLATILE[key],
          n: pts.length, firstDate: first.date, prevDate: prev.date, lastDate: last.date, first: first.v, prev: prev.v, last: last.v,
          d: j.d, rel: j.rel, dTotal: last.v - first.v, verdict: j.verdict, stPrev: j.stPrev, stLast: j.stLast,
          note: j.note, labChange: !!labChange, sustained: sustained, pts: pts
        });
      });
    });
    return items;
  }

  function campoTrend(campo) {
    if (campo._trend && campo._trendN === campo.rows.length) return campo._trend;
    var items = buildTrendItems(campo);
    // profundidad principal del seguimiento: la que tiene más parámetros comparables
    var perDepth = {};
    items.forEach(function (it) { if (!it.volatile) perDepth[it.depth] = (perDepth[it.depth] || 0) + 1; });
    var depth = modeDepth(campo.rows), best = -1;
    Object.keys(perDepth).forEach(function (dp) { if (perDepth[dp] > best) { best = perDepth[dp]; depth = dp; } });
    var main = items.filter(function (it) { return it.depth === depth; });
    var core = main.filter(function (it) { return !it.volatile; });
    var counts = { mejora: 0, empeora: 0, estable: 0 };
    core.forEach(function (it) { counts[it.verdict]++; });
    var verdict = null;
    if (main.length) {
      if (counts.empeora > counts.mejora) verdict = counts.mejora ? "mixto" : "alerta";
      else if (counts.mejora > counts.empeora) verdict = counts.empeora ? "mixto" : "mejora";
      else verdict = counts.mejora ? "mixto" : "estable";
    }
    var months = monthsSince(campo.last_date);
    var t = { items: items, depth: depth, main: main, counts: counts, verdict: verdict, monthsSince: months, stale: months !== null && months > STALE_MONTHS };
    campo._trend = t; campo._trendN = campo.rows.length;
    return t;
  }

  function monthsSince(dateStr) {
    if (!dateStr) return null;
    var p = dateStr.split("-"), now = new Date();
    return (now.getFullYear() - parseInt(p[0], 10)) * 12 + (now.getMonth() + 1 - parseInt(p[1], 10));
  }

  function trendMatches(c, mode) {
    var t = campoTrend(c);
    if (mode === "mejora") return t.counts.mejora > 0;
    if (mode === "alerta") return t.counts.empeora > 0;
    if (mode === "viejo") return t.stale;
    return true;
  }

  // ---- redacción ----
  function signedPct(it) {
    if (!it.prev) return "";
    var p = (it.d / Math.abs(it.prev)) * 100;
    return (p > 0 ? "+" : "−") + Math.abs(Math.round(p)) + " %";
  }
  function itemLabel(it) {
    return it.label + (it.tipo ? " · " + it.tipo : "");
  }
  function describeItem(it) {
    var u = it.unit && !/^\d/.test(it.unit) ? " " + it.unit : "";
    var s = "<b>" + esc(itemLabel(it)) + ":</b> " + fmtNum(it.prev) + " → " + fmtNum(it.last) + esc(u) +
      " <span class=\"tr-pct\">(" + esc(signedPct(it)) + ")</span> entre " + fmtDateShort(it.prevDate) + " y " + fmtDateShort(it.lastDate);
    if (it.verdict !== "estable" && it.stPrev && it.stLast && it.stPrev !== it.stLast) s += " — pasó de " + ST_WORD[it.stPrev] + " a " + ST_WORD[it.stLast];
    else if (it.note) s += " — " + esc(it.note);
    if (it.sustained) s += " · tendencia sostenida en " + it.n + " análisis";
    var flags = [];
    if (it.volatile) flags.push("varía con la época o el cultivo");
    if (it.labChange) flags.push("cambió el laboratorio: comparar con cautela");
    if (flags.length) s += ' <span class="tr-flag">(' + esc(flags.join("; ")) + ")</span>";
    return s;
  }

  function verdictPill(v) {
    var map = { mejora: ["good", "▲ En mejora"], alerta: ["bad", "▼ Con alertas"], mixto: ["warn", "◆ Cambios mixtos"], estable: ["none", "● Estable"] };
    var m = map[v];
    return m ? '<span class="tr-pill ' + m[0] + '">' + m[1] + "</span>" : "";
  }

  // diferencia entre manejo Biológico y Químico (solo dentro del estudio convencional)
  function tipoComparison(campo, depth) {
    if (campo.tipos.indexOf("Biológico") === -1 || campo.tipos.indexOf("Químico") === -1) return [];
    var meta = metaFor(campo.dataset);
    var rows = campo.rows.filter(function (r) { return (r.prof || "Sin dato") === depth; });
    var out = [];
    var priority = campo.dataset === "quimico" ? CHEM_PRIORITY : BIO_PRIORITY;
    priority.concat(Object.keys(meta)).filter(function (k, i, a) { return a.indexOf(k) === i; }).forEach(function (key) {
      var m = meta[key];
      if (!m) return;
      var series = {};
      ["Biológico", "Químico"].forEach(function (tp) {
        var byDate = {};
        rows.filter(function (r) { return r.tipo === tp && r.params[key] !== null && r.params[key] !== undefined; })
          .forEach(function (r) { (byDate[r.fecha] = byDate[r.fecha] || []).push(r.params[key]); });
        var dates = Object.keys(byDate).sort();
        series[tp] = { dates: dates, by: byDate };
      });
      if (!series["Biológico"].dates.length || !series["Químico"].dates.length) return;
      var lastB = series["Biológico"].dates.slice(-1)[0], lastQ = series["Químico"].dates.slice(-1)[0];
      var vb = avg(series["Biológico"].by[lastB]), vq = avg(series["Químico"].by[lastQ]);
      var common = series["Biológico"].dates.filter(function (d) { return series["Químico"].by[d]; });
      var gapTrend = null;
      if (common.length >= 2) {
        var f = common[0], l = common[common.length - 1];
        gapTrend = { from: f, to: l, gapFrom: avg(series["Biológico"].by[f]) - avg(series["Químico"].by[f]), gapTo: avg(series["Biológico"].by[l]) - avg(series["Químico"].by[l]) };
      }
      var better = null;
      if (m.dir === "hi") better = vb === vq ? null : (vb > vq ? "Biológico" : "Químico");
      else if (m.dir === "lo") better = vb === vq ? null : (vb < vq ? "Biológico" : "Químico");
      else if (m.dir === "rng") { var db = distOutside(vb, m), dq = distOutside(vq, m); better = db === dq ? null : (db < dq ? "Biológico" : "Químico"); }
      var sameDate = lastB === lastQ;
      out.push({ key: key, label: m.label, unit: m.unit, vb: vb, vq: vq, dateB: lastB, dateQ: lastQ, sameDate: sameDate, better: better, gapTrend: gapTrend, dir: m.dir });
    });
    return out.slice(0, 10);
  }

  function tipoComparisonHtml(campo, depth) {
    var cmp = tipoComparison(campo, depth);
    if (!cmp.length) return "";
    var rows = cmp.map(function (c) {
      var u = c.unit ? " " + c.unit : "";
      var trendTxt = "—";
      if (c.gapTrend) {
        var g0 = c.gapTrend.gapFrom, g1 = c.gapTrend.gapTo;
        var closer = Math.abs(g1) < Math.abs(g0) - 1e-9, wider = Math.abs(g1) > Math.abs(g0) + 1e-9;
        trendTxt = "Dif. " + fmtNum(g0) + " → " + fmtNum(g1) + " (" + fmtDateShort(c.gapTrend.from) + " a " + fmtDateShort(c.gapTrend.to) + ")" +
          (closer ? " · se acercan" : (wider ? " · se separan" : " · igual"));
      }
      return "<tr><td>" + esc(c.label) + "</td><td>" + fmtNum(c.vb) + esc(u) + "</td><td>" + fmtNum(c.vq) + esc(u) + "</td>" +
        "<td>" + (c.better ? "<b>" + c.better + "</b>" : "Igual") + "</td><td>" + trendTxt + "</td></tr>" +
        (c.sameDate ? "" : "");
    }).join("");
    return '<h4 class="tr-sub">Comparativo Biológico vs. Químico (profundidad ' + esc(depth) + ')</h4>' +
      '<div class="tr-table-wrap"><table class="tr-table"><thead><tr><th>Parámetro</th><th>Biológico (último)</th><th>Químico (último)</th><th>Mejor posicionado</th><th>Evolución de la diferencia</th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
      '<div class="tr-note">Compara dos manejos del mismo lote dentro del estudio convencional. "Mejor posicionado" sigue los umbrales de cada parámetro (más alto, más bajo o dentro del rango según corresponda).</div>';
  }

  // panel de seguimiento de un lote (pantalla y informe)
  function trendPanelHtml(campo, depth, opts) {
    opts = opts || {};
    var t = campoTrend(campo);
    var d = depth && t.items.some(function (it) { return it.depth === depth; }) ? depth : t.depth;
    var items = t.items.filter(function (it) { return it.depth === d; });
    var stale = t.stale ? '<div class="note warn">⏱ Último análisis hace ' + t.monthsSince + ' meses (' + fmtDate(campo.last_date) + '): conviene volver a muestrear para retomar el seguimiento.</div>' : "";
    if (!items.length) {
      return '<div class="panel trend-panel"><h3>Seguimiento y evolución</h3>' + stale +
        '<p class="tr-empty">Todavía hay un solo análisis' + (campo.dataset === "biologico" ? " microbiológico" : "") + " de este lote en esta profundidad: el seguimiento aparece cuando se cargue el siguiente.</p>" +
        tipoComparisonHtml(campo, d) + "</div>";
    }
    function bySize(a, b) { return Math.abs(b.rel) - Math.abs(a.rel); }
    var core = items.filter(function (it) { return !it.volatile; });
    var sec = items.filter(function (it) { return it.volatile; });
    var good = core.filter(function (i) { return i.verdict === "mejora"; }).concat(sec.filter(function (i) { return i.verdict === "mejora"; })).sort(bySize);
    var bad = core.filter(function (i) { return i.verdict === "empeora"; }).concat(sec.filter(function (i) { return i.verdict === "empeora"; })).sort(bySize);
    var flat = items.filter(function (i) { return i.verdict === "estable"; });
    function li(i) { return "<li>" + describeItem(i) + "</li>"; }
    var dates = items.map(function (i) { return i.lastDate; }).sort();
    var firsts = items.map(function (i) { return i.firstDate; }).sort();
    var head = '<div class="trend-head">' + verdictPill(t.verdict) +
      '<span class="tr-meta">' + items.length + " parámetros comparados · " + fmtDate(firsts[0]) + " → " + fmtDate(dates[dates.length - 1]) + " · profundidad " + esc(d) + "</span></div>";
    var stableHtml = flat.length ? (opts.print
      ? '<div class="tr-stable"><b>Sin cambios relevantes (' + flat.length + "):</b> " + flat.map(function (i) { return esc(itemLabel(i)) + " " + fmtNum(i.prev) + " → " + fmtNum(i.last); }).join(" · ") + "</div>"
      : '<details class="tr-stable"><summary>Sin cambios relevantes (' + flat.length + ')</summary><ul>' + flat.map(li).join("") + "</ul></details>") : "";
    return '<div class="panel trend-panel"><h3>Seguimiento y evolución</h3>' + head + stale +
      '<div class="trend-cols">' +
      '<div class="trend-col"><h4 class="tr-good">▲ Mejoras (' + good.length + ")</h4>" + (good.length ? "<ul>" + good.map(li).join("") + "</ul>" : '<p class="tr-empty">Sin mejoras relevantes entre los últimos análisis.</p>') + "</div>" +
      '<div class="trend-col"><h4 class="tr-bad">▼ Alertas (' + bad.length + ")</h4>" + (bad.length ? "<ul>" + bad.map(li).join("") + "</ul>" : '<p class="tr-empty">Sin parámetros que hayan empeorado.</p>') + "</div></div>" +
      stableHtml + tipoComparisonHtml(campo, d) +
      '<div class="tr-note">Se compara el último análisis contra el anterior (y se marca si la tendencia es sostenida). Nitratos, azufre, conductividad y nutrientes biodisponibles varían con la época y el cultivo: se informan pero no pesan en el estado general.</div></div>';
  }

  function trendHeadline(campo, max, only) {
    var t = campoTrend(campo);
    return t.main.filter(function (i) { return (only ? i.verdict === only : i.verdict !== "estable") && !i.volatile; })
      .sort(function (a, b) { return Math.abs(b.rel) - Math.abs(a.rel); }).slice(0, max || 3)
      .map(function (i) { return esc(i.label) + " " + esc(signedPct(i)); }).join(" · ");
  }

  // ---- tarjetas de la lista ----
  function trendBadgeHtml(campo) {
    var t = campoTrend(campo);
    if (!t.verdict) return t.stale ? '<span class="tr-mini none" title="Último análisis hace ' + t.monthsSince + ' meses">⏱</span>' : "";
    var map = { mejora: ["good", "▲ mejora"], alerta: ["bad", "▼ alerta"], mixto: ["warn", "◆ mixto"], estable: ["none", "● estable"] }[t.verdict];
    var tip = "Seguimiento: " + t.counts.mejora + " mejoras, " + t.counts.empeora + " alertas, " + t.counts.estable + " sin cambios";
    return '<span class="tr-mini ' + map[0] + '" title="' + esc(tip) + '">' + map[1] + "</span>" + (t.stale ? ' <span class="tr-mini none" title="Último análisis hace ' + t.monthsSince + ' meses">⏱</span>' : "");
  }

  // ---- panorama general ----
  function trendOverviewHtml() {
    var withT = CAMPOS.filter(function (c) { return campoTrend(c).verdict; });
    var alerts = withT.filter(function (c) { return campoTrend(c).counts.empeora > 0; })
      .sort(function (a, b) { var ta = campoTrend(a), tb = campoTrend(b); return (tb.counts.empeora - tb.counts.mejora) - (ta.counts.empeora - ta.counts.mejora); });
    var goods = withT.filter(function (c) { return campoTrend(c).counts.mejora > 0; })
      .sort(function (a, b) { var ta = campoTrend(a), tb = campoTrend(b); return (tb.counts.mejora - tb.counts.empeora) - (ta.counts.mejora - ta.counts.empeora); });
    var stale = CAMPOS.filter(function (c) { return campoTrend(c).stale; });
    function row(c, cls, only) {
      var t = campoTrend(c);
      return '<div class="attn-item trend-item" data-id="' + c.id + '"><span class="status-dot ' + cls + '"></span><span class="campo-title">' + esc(c.lote) + " · " + esc(c.productor) +
        '</span><span class="tr-headline">' + trendHeadline(c, 2, only) + "</span></div>";
    }
    return '<div class="panel">' +
      '<h2 style="font-size:15px;margin-bottom:6px;">Seguimiento: evolución entre análisis</h2>' +
      '<p style="color:var(--ink-faint);font-size:11.5px;margin:0 0 10px;">Compara el último análisis de cada lote contra el anterior, por parámetro y profundidad. Convencional y microbiológico se evalúan por separado.</p>' +
      '<div class="overview-grid">' +
      '<div class="tile"><b class="num">' + withT.length + '</b><span>Lotes con seguimiento (2+ análisis)</span></div>' +
      '<div class="tile"><b class="num" style="color:var(--bad)">' + alerts.length + '</b><span>con alertas (algún parámetro empeoró)</span></div>' +
      '<div class="tile"><b class="num" style="color:var(--good)">' + goods.length + '</b><span>con mejoras</span></div>' +
      '<div class="tile"><b class="num" style="color:var(--warn)">' + stale.length + '</b><span>sin análisis hace más de ' + STALE_MONTHS + ' meses</span></div>' +
      "</div>" +
      '<h4 class="tr-bad" style="margin:14px 0 4px">▼ Alertas — lotes donde algo empeoró</h4>' +
      (alerts.length ? alerts.slice(0, 8).map(function (c) { return row(c, "bad", "empeora"); }).join("") : '<p class="tr-empty">Ninguno.</p>') +
      '<h4 class="tr-good" style="margin:14px 0 4px">▲ Mejoras — lotes donde algo mejoró</h4>' +
      (goods.length ? goods.slice(0, 8).map(function (c) { return row(c, "good", "mejora"); }).join("") : '<p class="tr-empty">Ninguno.</p>') +
      '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" id="btnTrendReport2">📈 Generar informe de seguimiento</button>' +
      '<button class="btn" data-trendfilter="alerta">Ver todos los lotes con alertas</button><button class="btn" data-trendfilter="mejora">Ver todos con mejoras</button><button class="btn" data-trendfilter="viejo">Ver desactualizados</button></div>' +
      "</div>";
  }

  function bindTrendOverview(pane) {
    var b = pane.querySelector("#btnTrendReport2");
    if (b) b.addEventListener("click", openTrendReport);
    Array.prototype.forEach.call(pane.querySelectorAll("[data-trendfilter]"), function (el) {
      el.addEventListener("click", function () { setTrendFilter(el.getAttribute("data-trendfilter")); });
    });
  }

  // ---- filtro "Seguimiento" de la lista ----
  function setTrendFilter(val) {
    state.trend = val;
    var g = document.getElementById("trendFilter");
    Array.prototype.forEach.call(g.querySelectorAll(".chip"), function (c) { c.classList.toggle("active", c.getAttribute("data-val") === val); });
    renderList();
  }
  function setupTrendControls() {
    var g = document.getElementById("trendFilter");
    [["todos", "Todos"], ["mejora", "▲ Con mejoras"], ["alerta", "▼ Con alertas"], ["viejo", "⏱ Desactualizados"]].forEach(function (p) {
      var el = document.createElement("span");
      el.className = "chip" + (p[0] === "todos" ? " active" : "");
      el.textContent = p[1];
      el.setAttribute("data-val", p[0]);
      el.addEventListener("click", function () { setTrendFilter(p[0]); });
      g.appendChild(el);
    });
  }

  // ---- informe de seguimiento (varios lotes) ----
  function openTrendReport() {
    var list = getFiltered().filter(function (c) { return campoTrend(c).verdict; });
    if (!list.length) { toast("No hay lotes con 2 o más análisis en la lista actual."); return; }
    // alertas primero
    var order = { alerta: 0, mixto: 1, mejora: 2, estable: 3 };
    list.sort(function (a, b) { return order[campoTrend(a).verdict] - order[campoTrend(b).verdict]; });
    reportOpts = { last: false, charts: false, history: false, trend: true, summary: true, __keep: true };
    openReport(list.map(function (c) { return c.id; }));
  }

  function reportSummaryHtml(campos) {
    var list = campos.filter(function (c) { return campoTrend(c).verdict; });
    if (!list.length) return "";
    var rows = list.map(function (c) {
      var t = campoTrend(c);
      return "<tr><td><b>" + esc(c.lote) + "</b><br><small>" + esc(c.productor) + "</small></td>" +
        "<td>" + (c.dataset === "quimico" ? "Convencional" : "Microbiológico") + "</td>" +
        "<td>" + verdictPill(t.verdict) + "</td><td>" + t.counts.mejora + "</td><td>" + t.counts.empeora + "</td><td>" + t.counts.estable + "</td>" +
        "<td>" + (trendHeadline(c, 3) || "—") + "</td><td>" + fmtDateShort(c.last_date) + (t.stale ? " ⏱" : "") + "</td></tr>";
    }).join("");
    var nA = list.filter(function (c) { return campoTrend(c).counts.empeora > 0; }).length;
    var nM = list.filter(function (c) { return campoTrend(c).counts.mejora > 0; }).length;
    return '<section class="rep-lote rep-summary"><h1>Resumen de seguimiento</h1>' +
      '<div class="rep-meta"><span><b>' + list.length + "</b> lotes con 2+ análisis</span><span>Con alertas: <b>" + nA + "</b></span><span>Con mejoras: <b>" + nM + "</b></span></div>" +
      '<table class="rep-table"><thead><tr><th>Lote</th><th>Estudio</th><th>Estado</th><th>Mejoras</th><th>Alertas</th><th>Sin cambios</th><th>Cambios principales</th><th>Último</th></tr></thead><tbody>' + rows + "</tbody></table>" +
      '<div class="rep-ref">Cada lote se compara contra su propio análisis anterior. ⏱ = último análisis con más de " + STALE_MONTHS + " meses. Detalle por lote en las páginas siguientes.</div></section>';
  }
