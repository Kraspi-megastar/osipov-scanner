(function () {
"use strict";
/* ======================= справочники ======================= */
var SC = window.OsipovScanner;
var JSETUP = {
  breakK: "Слом: коррекция = импульс → ретест",
  breakN: "Слом: импульс не обновил → ретест",
  prevHigh: "Ретест предыдущего максимума / минимума",
  line: "Линия поддержки / сопротивления, 3-е касание",
  flatLow: "Флет: от границы",
  flatRetest: "Флет: выход + ретест накопления",
  third: "Пробой с 3-го раза (ложный пробой / пробой / ретест)",
  dbl: "Двойное дно / вершина"
};
var SETUPS = Object.keys(JSETUP).map(function (k) { return JSETUP[k]; }).concat(["Отскок от сильного уровня", "Голова и плечи", "Флаг / вымпел", "Другое"]);
var TRIGGERS = ["Ложный пробой одной свечой", "Ложный пробой двумя свечами", "Харами", "Поглощение",
  "Отскок: пинбар (нужно подтверждение младшим ТФ)", "Отскок: две свечи (нужно подтверждение младшим ТФ)",
  "Пробой: закрытие свечи над уровнем", "Ретест пробитого уровня", "Слом структуры на младшем ТФ"];
var CHECKS = [
  { g: "MN — тренд и зона", items: [
    { id: "c1", t: "Тренд по 4 точкам определён, сделка в его сторону (во флете — от границы к границе)", crit: 1 },
    { id: "c2", t: "Цена в коррекции, а не в импульсе", crit: 1 },
    { id: "c3", t: "Цена в зоне: ретест предыдущего максимума, нижняя граница флета или уровень слома" }] },
  { g: "W — подтверждение", items: [
    { id: "c4", t: "На неделе нет противоположной тенденции", crit: 1 },
    { id: "c5", t: "Есть слом, «импульс не обновил» или выход из флета с ретестом" }] },
  { g: "D — точка входа", items: [
    { id: "c6", t: "Есть паттерн: слом → ретест, 1-2-3, ГиП, двойное дно, пробой с 3-го раза" },
    { id: "c7", t: "Триггер есть и свеча закрылась", crit: 1 },
    { id: "c8", t: "Для отскока пинбаром или двумя свечами есть слом на младшем ТФ" },
    { id: "c15", t: "Доп. подтверждение RSI по тренду: выход из перепроданности через 30 (шорт — из перекупленности через 70) или конвергенция; можно смотреть на H4" }] },
  { g: "Фильтры и риск", items: [
    { id: "c9", t: "Не середина флета", crit: 1 },
    { id: "c10", t: "Нет отчёта в ближайшие ~2 недели", crit: 1 },
    { id: "c11", t: "Ниже нет неотретестированного уровня, ради которого стоит подождать" },
    { id: "c12", t: "Стоп за ближайшим минимумом (при шорте — максимумом), не ближе, чем требует структура", crit: 1 },
    { id: "c13", t: "Тейк — следующий ценовой уровень или высота фигуры" },
    { id: "c14", t: "Спокойное состояние: не после серии плюсов и не «отыграться»" }] }
];
var STATUS = { open: "открыта", take: "тейк", stop: "стоп", be: "безубыток", manual: "вручную" };
var PSTATUS = { wait: "жду", alert: "сработал алерт", in: "вошёл", cancel: "отменён" };
var TREND = { up: "вверх", down: "вниз", flat: "флет" };

/* ======================= утилиты ======================= */
function $(s, r) { return (r || document).querySelector(s); }
function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
function num(v) { var n = parseFloat(String(v).replace(",", ".")); return isFinite(n) ? n : NaN; }
function fmt(n, d) { if (!isFinite(n)) return "—"; d = d == null ? 2 : d; return n.toLocaleString("ru-RU", { minimumFractionDigits: d, maximumFractionDigits: d }); }
function px(n) { if (!isFinite(n)) return "—"; return fmt(n, Math.abs(n) >= 1 ? 2 : 4); }
function money(n) { return isFinite(n) ? (n < 0 ? "−" : "") + "$" + fmt(Math.abs(n), 0) : "—"; }
function today() { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function uid(p) { return p + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7); }
function lsGet(k, def) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* нет хранилища */ } }
function opts(list, sel) { return list.map(function (x) { return "<option" + (x === sel ? " selected" : "") + ">" + esc(x) + "</option>"; }).join(""); }
function daysTo(d) { if (!d) return NaN; return Math.round((new Date(d + "T00:00:00") - new Date(today() + "T00:00:00")) / 864e5); }
function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
var toastTimer;
function toast(msg) { var t = $("#toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove("on"); }, 3200); }
function kv(k, v, cls) { return '<div class="kv ' + (cls || "") + '"><div class="k">' + esc(k) + '</div><div class="v">' + v + "</div></div>"; }
function rsiHtml(r) {
  if (!r) return "";
  return r.ok.map(function (x) { return '<span class="tag up">' + esc(x) + "</span>"; }).concat(r.warn.map(function (x) { return '<span class="tag">' + esc(x) + "</span>"; })).join(" ");
}
function rsiVal(t, tf) { var r = t && t[tf] && t[tf].r; var x = r && r[r.length - 1]; return x == null ? NaN : x; }
function rsiZone(x) { return !isFinite(x) ? "" : x > 70 ? " (перекупл.)" : x < 30 ? " (перепрод.)" : ""; }
function trendTag(t, label) { var c = t === "up" ? "up" : t === "down" ? "down" : ""; return '<span class="tag ' + c + '">' + esc(label) + " " + esc(TREND[t] || "—") + "</span>"; }

/* ======================= хранилище и синхронизация ======================= */
var LS_STATE = "osipov.state.v2", LS_SYNC = "osipov.sync.v1", LS_UI = "osipov.ui.v2", LS_SCAN = "osipov.scan.v1";
var Store = {
  st: lsGet(LS_STATE, { trades: [], plans: [], settings: {} }),
  list: function (k) { return (this.st[k] || []).filter(function (x) { return !x.del; }); },
  get: function (k, id) { return (this.st[k] || []).find(function (x) { return x.id === id; }); },
  put: function (k, obj) {
    obj.u = Date.now();
    var arr = this.st[k] = this.st[k] || [];
    var i = arr.findIndex(function (x) { return x.id === obj.id; });
    if (i >= 0) arr[i] = obj; else arr.push(obj);
    this.saved();
  },
  del: function (k, id) { var o = this.get(k, id); if (o) { o.del = true; o.u = Date.now(); this.saved(); } },
  saved: function () { lsSet(LS_STATE, this.st); renderAll(); Sync.schedule(); }
};
function mergeArr(a, b) {
  var m = {};
  (a || []).forEach(function (x) { m[x.id] = x; });
  (b || []).forEach(function (x) { var y = m[x.id]; if (!y || (x.u || 0) >= (y.u || 0)) m[x.id] = x; });
  return Object.keys(m).map(function (k) { return m[k]; });
}
function b64enc(s) { var bytes = new TextEncoder().encode(s), bin = ""; for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(bin); }
function b64dec(b) { var bin = atob(b.replace(/\s/g, "")), bytes = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return new TextDecoder().decode(bytes); }

var Sync = {
  cfg: lsGet(LS_SYNC, {}), sha: null, timer: null, busy: false, again: false, ok: false,
  ready: function () { return !!(this.cfg.owner && this.cfg.repo && this.cfg.token); },
  url: function (path) { return "https://api.github.com/repos/" + encodeURIComponent(this.cfg.owner) + "/" + encodeURIComponent(this.cfg.repo) + path; },
  hdr: function () { return { "Authorization": "Bearer " + this.cfg.token, "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }; },
  status: function (kind, text) { $("#syncStatus").innerHTML = '<span class="dot ' + kind + '"></span><span>' + esc(text) + "</span>"; },
  pull: function () {
    var self = this;
    if (!this.ready()) { this.status("warn", "Журнал: только на этом устройстве"); return Promise.resolve(); }
    this.status("", "Журнал: синхронизация…");
    return fetch(this.url("/contents/journal.json") + "?t=" + Date.now(), { headers: this.hdr(), cache: "no-store" }).then(function (r) {
      if (r.status === 404) { self.sha = null; return null; }
      if (r.status === 401) throw new Error("Ключ не подходит или истёк");
      if (r.status === 403) throw new Error("У ключа нет доступа к репозиторию");
      if (!r.ok) throw new Error("GitHub ответил " + r.status);
      return r.json();
    }).then(function (j) {
      var remote = j ? JSON.parse(b64dec(j.content)) : { trades: [], plans: [], settings: {} };
      self.sha = j ? j.sha : null;
      var loc = Store.st;
      var merged = { version: 2, trades: mergeArr(remote.trades, loc.trades), plans: mergeArr(remote.plans, loc.plans), settings: Object.assign({}, loc.settings || {}, remote.settings || {}) };
      var changed = JSON.stringify(merged.trades) !== JSON.stringify(remote.trades || []) || JSON.stringify(merged.plans) !== JSON.stringify(remote.plans || []);
      Store.st = merged; lsSet(LS_STATE, merged); renderAll(); renderSettingsInfo();
      self.ok = true;
      self.status("ok", "Журнал: синхронизирован");
      if (changed || !j) return self.push();
    }).catch(function (e) { self.ok = false; self.status("bad", "Журнал: " + e.message); });
  },
  schedule: function () { var self = this; if (!this.ready()) return; clearTimeout(this.timer); this.timer = setTimeout(function () { self.push(); }, 1200); this.status("warn", "Журнал: есть несохранённое"); },
  push: function () {
    var self = this;
    if (!this.ready()) return Promise.resolve();
    if (this.busy) { this.again = true; return Promise.resolve(); }
    this.busy = true;
    var body = { message: "Обновление журнала", content: b64enc(JSON.stringify(Store.st, null, 1)) };
    if (this.sha) body.sha = this.sha;
    return fetch(this.url("/contents/journal.json"), { method: "PUT", headers: Object.assign({ "Content-Type": "application/json" }, this.hdr()), body: JSON.stringify(body) }).then(function (r) {
      if (r.status === 409 || r.status === 422) { self.busy = false; return self.pull(); }
      if (!r.ok) throw new Error("не удалось сохранить (" + r.status + ")");
      return r.json().then(function (j) { self.sha = j.content.sha; self.busy = false; self.status("ok", "Журнал: синхронизирован"); if (self.again) { self.again = false; return self.push(); } });
    }).catch(function (e) { self.busy = false; self.status("bad", "Журнал: " + e.message); });
  },
  dispatch: function (repo, wf) {
    if (!this.ready()) return Promise.reject(new Error("Сначала подключите синхронизацию"));
    return fetch("https://api.github.com/repos/" + encodeURIComponent(this.cfg.owner) + "/" + encodeURIComponent(repo) + "/actions/workflows/" + wf + "/dispatches",
      { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, this.hdr()), body: JSON.stringify({ ref: "main" }) })
      .then(function (r) { if (r.status !== 204) throw new Error(r.status === 403 || r.status === 404 ? "у ключа нет права Actions для " + repo : "GitHub ответил " + r.status); });
  }
};

/* ======================= навигация ======================= */
var VIEWS = ["scan", "trade", "plan", "journal", "guide", "settings"];
function route() {
  var v = (location.hash || "#scan").slice(1);
  if (VIEWS.indexOf(v) < 0) v = "scan";
  $$(".view").forEach(function (s) { s.classList.toggle("on", s.id === "v-" + v); });
  $$("nav a").forEach(function (a) { a.classList.toggle("on", a.dataset.v === v); });
}
window.addEventListener("hashchange", route);

/* ======================= данные рынка ======================= */
var DATA = { uni: null, meta: null, map: {}, sectors: [] };
function loadData() {
  return Promise.all([
    fetch("data/universe.json", { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }),
    fetch("data/meta.json", { cache: "no-cache" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
  ]).then(function (res) {
    DATA.uni = res[0].t || []; DATA.meta = res[1] || { updated: res[0].updated, count: DATA.uni.length };
    DATA.map = {}; var secs = {};
    DATA.uni.forEach(function (t) { DATA.map[t.s] = t; if (t.sec) secs[t.sec] = 1; });
    DATA.sectors = Object.keys(secs).sort();
    var upd = DATA.meta.updated ? new Date(DATA.meta.updated) : null;
    var info = DATA.uni.length + " бумаг · " + (upd ? upd.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
    $("#dataInfo").textContent = info;
    $("#metaInfo").textContent = "Котировки: " + info + (DATA.meta.failedCount ? " · не загрузилось: " + DATA.meta.failedCount : "");
    var sel = $("#oSector"), cur = SCFG.sector;
    sel.innerHTML = '<option value="">все</option>' + DATA.sectors.map(function (s) { return "<option" + (s === cur ? " selected" : "") + ">" + esc(s) + "</option>"; }).join("");
    $("#runScan").disabled = false;
    if (SCFG.auto !== false) runScan();
  }).catch(function () {
    $("#dataInfo").textContent = "данные недоступны";
    $("#hits").innerHTML = '<div class="panel empty">Котировки ещё не загружены. После первого запуска обновления на GitHub (15–25 минут) здесь появится весь рынок.</div>';
  });
}

/* ======================= сканер ======================= */
var SCFG = Object.assign({ tf: "D", dir: "long", setups: { breakK: 1, breakN: 1, prevHigh: 1, line: 1, flatLow: 1, flatRetest: 1, third: 1, dbl: 1 },
  zIn: true, zNear: true, mn: true, w: true, earn: true, trg: false, rsi: false, rr: "2", cap: 10, sector: "" }, lsGet(LS_SCAN, {}));
var LAST = [];
function initScan() {
  var box = $("#oSetups"), html = "";
  Object.keys(SC.SETUPS).forEach(function (k) { html += '<label><input type="checkbox" data-setup="' + k + '"' + (SCFG.setups[k] ? " checked" : "") + "> " + esc(SC.SETUPS[k]) + "</label>"; });
  box.innerHTML = html;
  $("#oZoneIn").checked = SCFG.zIn; $("#oZoneNear").checked = SCFG.zNear; $("#oMn").checked = SCFG.mn; $("#oW").checked = SCFG.w;
  $("#oEarn").checked = SCFG.earn; $("#oTrg").checked = SCFG.trg; $("#oRsi").checked = !!SCFG.rsi; $("#oRR").value = SCFG.rr; $("#oCap").value = SCFG.cap;
  segSync();
  $$("[data-o-tf]").forEach(function (b) { b.onclick = function () { SCFG.tf = b.dataset.oTf; segSync(); saveScanCfg(); }; });
  $$("[data-o-dir]").forEach(function (b) { b.onclick = function () { SCFG.dir = b.dataset.oDir; segSync(); saveScanCfg(); }; });
  $("#scanOpts").addEventListener("change", function () { readScanCfg(); saveScanCfg(); });
  if (window.innerWidth < 900) $("#scanDetails").open = false;
  $("#runScan").disabled = true;
  $("#runScan").onclick = function () { runScan(); if (window.innerWidth < 900) setTimeout(function () { $("#scanSummary").scrollIntoView({ block: "start", behavior: "smooth" }); }, 120); };
  $("#hits").addEventListener("click", function (e) { var b = e.target.closest("[data-hit]"); if (b) openChart(b.dataset.s, LAST[+b.dataset.hit]); });
  var open = function () { var s = ($("#tickerSearch").value || "").trim().toUpperCase(); if (!s) return; if (DATA.map[s]) openChart(s, null); else toast("Тикера " + s + " нет в списке (капитализация от 10 млрд $)"); };
  $("#openTicker").onclick = open;
  $("#tickerSearch").addEventListener("keydown", function (e) { if (e.key === "Enter") open(); });
}
function segSync() {
  $$("[data-o-tf]").forEach(function (b) { b.classList.toggle("on", b.dataset.oTf === SCFG.tf); });
  $$("[data-o-dir]").forEach(function (b) { b.classList.toggle("on", b.dataset.oDir === SCFG.dir); });
}
function readScanCfg() {
  $$("[data-setup]").forEach(function (i) { SCFG.setups[i.dataset.setup] = i.checked ? 1 : 0; });
  SCFG.zIn = $("#oZoneIn").checked; SCFG.zNear = $("#oZoneNear").checked; SCFG.mn = $("#oMn").checked; SCFG.w = $("#oW").checked;
  SCFG.earn = $("#oEarn").checked; SCFG.trg = $("#oTrg").checked; SCFG.rsi = $("#oRsi").checked; SCFG.rr = $("#oRR").value; SCFG.cap = num($("#oCap").value) || 0; SCFG.sector = $("#oSector").value;
}
function saveScanCfg() { lsSet(LS_SCAN, SCFG); }
function engineCfg(all) {
  var setups = all ? { breakK: 1, breakN: 1, prevHigh: 1, line: 1, flatLow: 1, flatRetest: 1, third: 1, dbl: 1 } : SCFG.setups;
  var zones = all ? ["in", "near"] : [].concat(SCFG.zIn ? ["in"] : [], SCFG.zNear ? ["near"] : []);
  return { tf: SCFG.tf, dirs: SCFG.dir === "both" ? ["long", "short"] : [SCFG.dir], setups: setups, tol: 0.75, stopAtr: 0.5,
    mnFilter: all ? false : SCFG.mn, wFilter: all ? false : SCFG.w, earnDays: 14, earnExclude: all ? false : SCFG.earn,
    minRR: all ? 0 : num(SCFG.rr) || 0, zones: zones, minCap: all ? 0 : SCFG.cap, sector: all ? "" : SCFG.sector, today: today() };
}
function runScan() {
  if (!DATA.uni) return;
  readScanCfg(); saveScanCfg();
  var bar = $("#scanProg"); bar.style.width = "30%";
  setTimeout(function () {
    var t0 = performance.now();
    var res = SC.scan(DATA.uni, engineCfg(false));
    if (SCFG.trg) res = res.filter(function (h) { return h.trg && h.trg.length; });
    if (SCFG.rsi) res = res.filter(function (h) { return h.rsi && h.rsi.ok.length; });
    // группируем по бумаге и стороне: лучшая находка + остальные сетапы
    var groups = {}, order = [];
    res.forEach(function (h) { var key = h.s + "|" + h.dir; if (!groups[key]) { groups[key] = h; h.more = []; order.push(key); } else if (groups[key].more.indexOf(h.name) < 0 && groups[key].name !== h.name) groups[key].more.push(h.name); });
    LAST = order.map(function (k) { return groups[k]; });
    bar.style.width = "100%"; setTimeout(function () { bar.style.width = "0"; }, 400);
    var inZ = LAST.filter(function (h) { return h.zone === "in"; }).length;
    $("#scanSummary").textContent = "Найдено " + LAST.length + " бумаг (в зоне: " + inZ + ", на подходе: " + (LAST.length - inZ) + ") · " + Math.round(performance.now() - t0) + " мс";
    renderHits();
  }, 30);
}
function renderHits() {
  var el = $("#hits");
  if (!LAST.length) { el.innerHTML = '<div class="panel empty">По этим условиям сейчас ничего нет. Ослабьте фильтры (R:R, «на подходе», шорты) или смените таймфрейм.</div>'; return; }
  el.innerHTML = LAST.slice(0, 300).map(function (h, i) {
    var zone = h.zone === "in" ? '<span class="tag up">в зоне</span>' : '<span class="tag acc">до зоны ' + fmt(Math.abs(h.dAtr), 1) + " ATR</span>";
    var trg = (h.trg || []).map(function (x) { return '<span class="tag warn">' + esc(x) + "</span>"; }).join(" ");
    var rs = rsiHtml(h.rsi);
    var earn = isFinite(h.eDays) && h.eDays >= 0 ? '<span class="tag' + (h.eDays <= 14 ? " down" : "") + '">отчёт ' + (h.eDays <= 30 ? "через " + h.eDays + " дн." : esc(h.e)) + "</span>" : "";
    return '<button type="button" class="hit ' + h.dir + '" data-hit="' + i + '" data-s="' + esc(h.s) + '">' +
      '<div class="row between"><span class="tk">' + esc(h.s) + '</span><span class="tag ' + (h.dir === "long" ? "up" : "down") + '">' + (h.dir === "long" ? "покупка" : "шорт") + " · " + esc(h.tf) + "</span></div>" +
      '<div class="nm">' + esc(h.n || "") + (h.sec ? " · " + esc(h.sec) : "") + "</div>" +
      '<div class="small"><b>' + esc(h.name) + "</b>" + (h.more.length ? ' <span class="muted">+ ' + esc(h.more.join(", ")) + "</span>" : "") + "</div>" +
      '<div class="row">' + zone + " " + trg + " " + earn + "</div>" + (rs ? '<div class="row">' + rs + "</div>" : "") +
      '<div class="nums"><div><span>Вход</span>' + px(h.entry) + "</div><div><span>Стоп</span>" + px(h.stop) + "</div><div><span>Тейк</span>" + px(h.take) + "</div><div><span>R:R</span>" + (isFinite(h.rr) ? "1:" + fmt(h.rr, 1) : "—") + "</div></div>" +
      '<div class="row">' + trendTag(h.mT, "MN") + " " + trendTag(h.wT, "W") + "</div></button>";
  }).join("") + (LAST.length > 300 ? '<div class="note">Показаны первые 300. Сузьте фильтры.</div>' : "");
}

/* ======================= график ======================= */
var CH = { chart: null, s: null, hit: null, tf: "D", data: null, ro: null };
function openChart(s, hit) {
  CH.s = s; CH.hit = hit; CH.tf = hit ? (hit.tf === "W" ? "W" : "D") : "D";
  var t = DATA.map[s] || {};
  $("#chTitle").textContent = s; $("#chName").textContent = (t.n || "") + (t.sec ? " · " + t.sec : "") + (t.mc ? " · " + fmt(t.mc, 0) + " млрд $" : "");
  $("#chartModal").classList.add("on"); document.body.style.overflow = "hidden";
  $("#chartBox").innerHTML = '<div class="empty">Загрузка графика…</div>';
  renderSide();
  fetch("data/charts/" + encodeURIComponent(s) + ".json").then(function (r) { if (!r.ok) throw new Error(); return r.json(); }).then(function (d) { CH.data = d; drawChart(); })
    .catch(function () { $("#chartBox").innerHTML = '<div class="empty">График не загрузился. Откройте в TradingView по кнопке справа.</div>'; });
}
function closeChart() { $("#chartModal").classList.remove("on"); document.body.style.overflow = ""; if (CH.chart) { CH.chart.remove(); CH.chart = null; } }
function drawChart() {
  if (!CH.data || !window.LightweightCharts) return;
  $$("[data-ctf]").forEach(function (b) { b.classList.toggle("on", b.dataset.ctf === CH.tf); });
  if (CH.chart) { CH.chart.remove(); CH.chart = null; }
  var box = $("#chartBox"); box.innerHTML = "";
  var LC = window.LightweightCharts;
  var chart = LC.createChart(box, { autoSize: true, layout: { background: { type: "solid", color: css("--panel") }, textColor: css("--muted"), fontFamily: css("--font-body") },
    grid: { vertLines: { color: css("--line") }, horzLines: { color: css("--line") } }, rightPriceScale: { borderColor: css("--line") },
    timeScale: { borderColor: css("--line") }, localization: { locale: "ru-RU" } });
  var up = css("--up"), dn = css("--down");
  var ser = chart.addCandlestickSeries({ upColor: up, downColor: dn, wickUpColor: up, wickDownColor: dn, borderVisible: false });
  var rows = CH.data[CH.tf] || [];
  ser.setData(rows.map(function (r) { return { time: r[0], open: r[1], high: r[2], low: r[3], close: r[4] }; }));
  // RSI(14) отдельной панелью снизу: 30 / 70, середина — «зона неинтересно»
  ser.priceScale().applyOptions({ scaleMargins: { top: 0.05, bottom: 0.27 } });
  var rv = rsiSeries(rows.map(function (r) { return r[4]; }));
  var rsiS = chart.addLineSeries({ priceScaleId: "rsi", color: css("--warn"), lineWidth: 1, lastValueVisible: true, priceLineVisible: false, title: "RSI" });
  chart.priceScale("rsi").applyOptions({ scaleMargins: { top: 0.78, bottom: 0.02 }, borderColor: css("--line") });
  rsiS.setData(rows.map(function (r, i) { return isFinite(rv[i]) ? { time: r[0], value: +rv[i].toFixed(1) } : null; }).filter(Boolean));
  [30, 70].forEach(function (lv) { rsiS.createPriceLine({ price: lv, color: css("--muted"), lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: String(lv) }); });
  // развороты (зигзаг) с этого таймфрейма
  var st = (DATA.map[CH.s] || {})[CH.tf];
  if (st && st.p) {
    var zz = chart.addLineSeries({ color: css("--accent"), lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
    var pts = st.p.filter(function (p) { return rows[p[0]]; }).map(function (p) { return { time: rows[p[0]][0], value: p[2] }; });
    if (rows.length) pts.push({ time: rows[rows.length - 1][0], value: rows[rows.length - 1][4] });
    var seen = {}; pts = pts.filter(function (p) { if (seen[p.time]) return false; seen[p.time] = 1; return true; });
    zz.setData(pts);
  }
  var h = CH.hit;
  var line = function (price, color, title, style) { if (isFinite(price)) ser.createPriceLine({ price: price, color: color, lineWidth: 1, lineStyle: style == null ? 2 : style, axisLabelVisible: true, title: title }); };
  if (h) { line(h.level, css("--accent"), "уровень", 0); line(h.stop, dn, "стоп"); line(h.take, up, "тейк 80%"); }
  Store.list("plans").filter(function (p) { return p.ticker === CH.s && p.alertOn && !p.alertTriggered; }).forEach(function (p) { line(num(p.alertPrice), css("--warn"), "алерт", 1); });
  var n = rows.length, show = window.innerWidth < 820 ? 90 : CH.tf === "M" ? 180 : 160;
  chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - show), to: n + 3 });
  CH.chart = chart;
}
function rsiSeries(c, n) {
  n = n || 14; var out = c.map(function () { return NaN; });
  if (c.length <= n) return out;
  var au = 0, ad = 0, i;
  for (i = 1; i <= n; i++) { var d = c[i] - c[i - 1]; if (d > 0) au += d; else ad -= d; }
  au /= n; ad /= n; out[n] = ad === 0 ? 100 : 100 - 100 / (1 + au / ad);
  for (i = n + 1; i < c.length; i++) { var e = c[i] - c[i - 1]; au = (au * (n - 1) + Math.max(e, 0)) / n; ad = (ad * (n - 1) + Math.max(-e, 0)) / n; out[i] = ad === 0 ? 100 : 100 - 100 / (1 + au / ad); }
  return out;
}
function renderSide() {
  var s = CH.s, t = DATA.map[s] || {}, h = CH.hit;
  var found = h ? [h] : (DATA.map[s] ? ["D", "W"].reduce(function (acc, tf) {
    var c = engineCfg(true); c.tf = tf; c.dirs = ["long", "short"];
    return acc.concat(SC.scanTicker(t, c));
  }, []) : []);
  var mT = SC.trend(SC.view(t.M, 1)), wT = SC.trend(SC.view(t.W, 1)), dT = SC.trend(SC.view(t.D, 1));
  var ed = daysTo(t.e);
  var html = '<div class="row">' + trendTag(mT, "MN") + trendTag(wT, "W") + trendTag(dT, "D") + "</div>";
  html += '<div class="small">RSI(14): ' + ["M", "W", "D"].map(function (k) { var x = rsiVal(t, k); return (k === "M" ? "MN" : k) + " <b class=\"mono\">" + (isFinite(x) ? fmt(x, 0) : "—") + "</b>" + rsiZone(x); }).join(" · ") + "</div>";
  html += '<div class="small">Цена: <b class="mono">' + px(t.px) + "</b>" + (t.e ? ' · отчёт: <b>' + esc(t.e) + "</b>" + (isFinite(ed) && ed >= 0 && ed <= 14 ? ' <span class="tag down">через ' + ed + " дн.</span>" : "") : "") + "</div>";
  if (found.length) {
    var f = found[0];
    html += '<div class="stack" style="gap:6px"><h3>' + (h ? "Находка сканера" : "Паттерны сейчас") + "</h3>";
    found.slice(0, 3).forEach(function (x, i) {
      html += '<div class="kv"><div class="small"><span class="tag ' + (x.dir === "long" ? "up" : "down") + '">' + (x.dir === "long" ? "покупка" : "шорт") + " · " + x.tf + "</span> <b>" + esc(x.name) + '</b></div><div class="note">' + esc(x.why) + "</div>" +
        '<div class="small mono">вход ' + px(x.entry) + " · стоп " + px(x.stop) + " · тейк " + px(x.take) + " · R:R " + (isFinite(x.rr) ? "1:" + fmt(x.rr, 1) : "—") + "</div>" +
        ((x.trg || []).length ? '<div class="small">Триггер: ' + x.trg.map(esc).join(", ") + "</div>" : '<div class="note">Триггера пока нет — ждём свечу в зоне.</div>') +
        (rsiHtml(x.rsi) ? '<div class="row">' + rsiHtml(x.rsi) + "</div>" : "") +
        (!h ? '<button type="button" class="btn ghost small" data-usehit="' + i + '">Показать уровни на графике</button>' : "") + "</div>";
    });
    html += "</div>";
    CH.found = found;
    if (!h) CH.hit = null;
  } else {
    html += '<div class="note">По правилам сканера паттернов сейчас нет. Можно всё равно добавить в watchlist.</div>';
  }
  var base = h || found[0] || null;
  var lvl = base ? base.level : t.px, isAbove = isFinite(t.px) && isFinite(lvl) ? t.px >= lvl : true;
  html += '<form class="stack" id="wlForm" style="gap:8px"><h3>В watchlist и алерт</h3><div class="fields">' +
    '<label class="f"><span>Цена алерта</span><input type="number" step="any" id="wlPrice" value="' + (isFinite(lvl) ? (+lvl).toFixed(Math.abs(lvl) >= 1 ? 2 : 4) : "") + '"></label>' +
    '<label class="f"><span>Условие</span><select id="wlDir"><option value="below"' + (isAbove ? " selected" : "") + '>цена опустится до</option><option value="above"' + (!isAbove ? " selected" : "") + ">цена поднимется до</option></select></label></div>" +
    '<label class="chk"><input type="checkbox" id="wlAlert" checked><span>Прислать алерт в Telegram</span></label>' +
    '<label class="f"><span>Заметка</span><input type="text" id="wlNote" value="' + esc(base ? base.name : "") + '"></label>' +
    '<button class="btn pri" type="submit">Добавить в watchlist</button></form>';
  html += '<div class="row"><button class="btn" type="button" id="toCalc">Записать сделку</button>' +
    '<a class="btn" href="https://www.tradingview.com/chart/?symbol=' + encodeURIComponent(s) + '" target="_blank" rel="noopener">TradingView</a>' +
    '<a class="btn" href="https://finviz.com/quote.ashx?t=' + encodeURIComponent(s) + '" target="_blank" rel="noopener">Finviz</a></div>';
  html += '<div class="note">Синяя ломаная — развороты по ATR. Это подсказка: уровни и триггер проверяйте глазами.</div>';
  var side = $("#chartSide"); side.innerHTML = html;
  $("#wlForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var b = CH.hit || (CH.found && CH.found[0]) || null;
    var p = { id: uid("p"), ticker: s, tf: b ? b.tf : "D", dir: b ? b.dir : "long", trend: TREND[mT], setup: b ? JSETUP[b.k] : SETUPS[SETUPS.length - 1],
      zone: b ? px(b.entry) : "", entry: b ? +(+b.entry).toFixed(4) : "", stop: b ? +(+b.stop).toFixed(4) : "", take: b ? +(+b.takeLevel).toFixed(4) : "",
      alertOn: $("#wlAlert").checked, alertPrice: num($("#wlPrice").value), alertDir: $("#wlDir").value, alertTriggered: null,
      report: t.e || "", status: "wait", note: $("#wlNote").value, created: Date.now() };
    Store.put("plans", p);
    toast(s + " добавлена в watchlist" + (p.alertOn ? ", алерт на " + px(p.alertPrice) : ""));
    drawChart();
  });
  $("#toCalc").onclick = function () { prefillTrade(s, CH.hit || (CH.found && CH.found[0]) || null); closeChart(); location.hash = "#trade"; };
  $$("[data-usehit]", side).forEach(function (b) { b.onclick = function () { CH.hit = CH.found[+b.dataset.usehit]; CH.tf = CH.hit.tf; drawChart(); }; });
}

/* ======================= сделка: чек-лист + калькулятор ======================= */
var UI = lsGet(LS_UI, {});
var dir = UI.dir || "long", checks = UI.checks || {}, lastCalc = null, addTo = null;
function initTrade() {
  $("#t_setup").innerHTML = opts(SETUPS, UI.setup || SETUPS[0]);
  $("#t_trigger").innerHTML = opts(TRIGGERS, UI.trigger || TRIGGERS[0]);
  $("#t_ticker").value = UI.ticker || ""; $("#t_tf").value = UI.tf || "D";
  var html = "";
  CHECKS.forEach(function (g) {
    html += '<div class="chk-group"><h3>' + esc(g.g) + "</h3>";
    g.items.forEach(function (it) { html += '<label class="chk"><input type="checkbox" id="' + it.id + '"' + (checks[it.id] ? " checked" : "") + "><span>" + esc(it.t) + (it.crit ? ' <span class="tag crit">обязательно</span>' : "") + "</span></label>"; });
    html += "</div>";
  });
  $("#checklist").innerHTML = html;
  var C = UI.calc || { dep: 100000, risk: 1, comm: 0.05, fix: 0, entry: 250, stop: 242, take: 290, tp: "0.8" };
  setCalc(C);
  if (UI.calc) $("#calcNote").textContent = "Последние введённые значения.";
  setDir(dir, true);
  $("#v-trade").addEventListener("input", onTradeChange);
  $("#v-trade").addEventListener("change", onTradeChange);
  $("#dirLong").onclick = function () { setDir("long"); };
  $("#dirShort").onclick = function () { setDir("short"); };
  $("#resetChecks").onclick = function () { checks = {}; $$("#checklist input").forEach(function (i) { i.checked = false; }); onTradeChange(); };
  $("#toJournal").onclick = tradeToJournal;
}
function setCalc(C) { $("#c_dep").value = C.dep; $("#c_risk").value = C.risk; $("#c_comm").value = C.comm; $("#c_fix").value = C.fix; $("#c_entry").value = C.entry; $("#c_stop").value = C.stop; $("#c_take").value = C.take; $("#c_tp").value = C.tp; }
function prefillTrade(s, h) {
  $("#t_ticker").value = s;
  if (h) {
    $("#t_setup").value = JSETUP[h.k] || SETUPS[0]; $("#t_tf").value = h.tf === "W" ? "W" : "D";
    var c = readCalc(); c.entry = +(+h.entry).toFixed(4); c.stop = +(+h.stop).toFixed(4); c.take = +(+h.takeLevel).toFixed(4); c.tp = "0.8";
    setCalc(c); setDir(h.dir, true);
    $("#calcNote").textContent = "Цифры из сканера: вход у уровня, стоп за уровнем на 0,5 ATR, тейк — следующий уровень. Поправьте по факту на графике.";
    if (h.trg && h.trg.length) { var tm = { "пинбар": TRIGGERS[4], "поглощение": TRIGGERS[3], "харами": TRIGGERS[2], "ложный пробой одной свечой": TRIGGERS[0], "ложный пробой двумя свечами": TRIGGERS[1] }; if (tm[h.trg[0]]) $("#t_trigger").value = tm[h.trg[0]]; }
    checks = {}; if (h.mT !== (h.dir === "long" ? "down" : "up")) checks.c1 = true; if (!(isFinite(h.eDays) && h.eDays >= 0 && h.eDays <= 14)) checks.c10 = true; if (h.rsi && h.rsi.ok.length) checks.c15 = true;
    $$("#checklist input").forEach(function (i) { i.checked = !!checks[i.id]; });
  }
  onTradeChange();
}
function setDir(d, silent) { dir = d; $("#dirLong").classList.toggle("on", d === "long"); $("#dirShort").classList.toggle("on", d === "short"); if (!silent) onTradeChange(); else calc(); }
function readCalc() { return { dep: num($("#c_dep").value), risk: num($("#c_risk").value), comm: num($("#c_comm").value) || 0, fix: num($("#c_fix").value) || 0, entry: num($("#c_entry").value), stop: num($("#c_stop").value), take: num($("#c_take").value), tp: $("#c_tp").value }; }
function computePosition(c, direction) {
  var r = { ok: false, err: "" }, sign = direction === "long" ? 1 : -1;
  if (!(c.dep > 0) || !(c.risk > 0)) { r.err = "Укажите депозит и риск."; return r; }
  if (!isFinite(c.entry) || !isFinite(c.stop)) { r.err = "Укажите вход и стоп."; return r; }
  if (sign * (c.entry - c.stop) <= 0) { r.err = direction === "long" ? "Для покупки стоп должен быть ниже входа." : "Для шорта стоп должен быть выше входа."; return r; }
  var hasTake = isFinite(c.take);
  if (hasTake && sign * (c.take - c.entry) <= 0) { r.err = direction === "long" ? "Для покупки тейк должен быть выше входа." : "Для шорта тейк должен быть ниже входа."; return r; }
  var dist = Math.abs(c.entry - c.stop), cp = c.comm / 100, riskUsd = c.dep * c.risk / 100;
  var perShare = dist + c.entry * cp + c.stop * cp;
  var shares = Math.floor((riskUsd - 2 * c.fix) / perShare);
  if (!(shares > 0)) { r.err = "Риска не хватает даже на одну акцию: уменьшите стоп или комиссию."; return r; }
  var vol = shares * c.entry, realRisk = shares * perShare + 2 * c.fix;
  r = { ok: true, dist: dist, riskUsd: riskUsd, shares: shares, vol: vol, volPct: vol / c.dep * 100, realRisk: realRisk, stopPct: dist / c.entry * 100, add: Math.floor(shares / 2) };
  if (hasTake) {
    var k = parseFloat(c.tp) || 1, tEff = c.entry + (c.take - c.entry) * k;
    var gross = Math.abs(tEff - c.entry) * shares, commT = shares * (c.entry + tEff) * cp + 2 * c.fix;
    r.tEff = tEff; r.profit = gross - commT; r.rr = r.profit / realRisk; r.profitPctDep = r.profit / c.dep * 100;
  }
  return r;
}
function calc() {
  var c = readCalc(), r = computePosition(c, dir); lastCalc = { c: c, r: r };
  var o = $("#calcOut");
  if (!r.ok) { o.innerHTML = '<div class="kv" style="grid-column:1/-1"><div class="k">Расчёт</div><div class="small neg">' + esc(r.err) + "</div></div>"; verdict(); return; }
  var h = kv("Акций по риску", fmt(r.shares, 0), "big") + kv("Риск, $", money(r.realRisk)) + kv("Объём", money(r.vol)) + kv("Доля депозита", fmt(r.volPct, 0) + "%") + kv("До стопа", fmt(r.stopPct, 2) + "%");
  if (isFinite(r.rr)) h += kv("Тейк в ордер", px(r.tEff)) + kv("Прибыль на тейке", money(r.profit)) + kv("К депозиту", fmt(r.profitPctDep, 2) + "%") + kv("R:R (чистыми)", "1 : " + fmt(r.rr, 1), "big");
  h += kv("Добор при пробое с 3-го раза (½)", fmt(r.add, 0) + " акц.");
  var par = addTo && Store.get("trades", addTo);
  if (par) h += '<div class="kv" style="grid-column:1/-1"><div class="k">Докупка к сделке ' + esc(par.ticker) + " от " + esc(par.date) + '</div><div class="small">Это отдельная сделка: своя ТВХ, свой стоп за своим паттерном, риск от текущего депозита. После записи в журнал стопы открытых частей перенесутся на стоп докупки. <button class="btn ghost small" type="button" id="cancelAdd">Не докупка</button></div></div>';
  if (r.volPct > 100) h += '<div class="kv" style="grid-column:1/-1"><div class="k">Маржа</div><div class="small">Объём больше депозита в ' + fmt(r.volPct / 100, 1) + " раза: нужно плечо. Допустимо, если риск остаётся 1%.</div></div>";
  o.innerHTML = h; verdict();
  var ca = $("#cancelAdd"); if (ca) ca.onclick = function () { addTo = null; calc(); };
}
function verdict() {
  var missing = [];
  CHECKS.forEach(function (g) { g.items.forEach(function (it) { if (it.crit && !checks[it.id]) missing.push(it.t); }); });
  var el = $("#verdict"), r = lastCalc && lastCalc.r, cls, html;
  var needLower = /Отскок/.test($("#t_trigger").value) && !checks.c8;
  if (r && !r.ok) { cls = "no"; html = "<b>Расчёт не сходится</b><div class='small'>" + esc(r.err) + "</div>"; }
  else if (missing.length) { cls = "wait"; html = "<b>Ждать: не выполнено обязательных пунктов — " + missing.length + "</b><ul class='small'>" + missing.map(function (m) { return "<li>" + esc(m) + "</li>"; }).join("") + "</ul>"; }
  else if (!isFinite(r.rr)) { cls = "wait"; html = "<b>Укажите тейк</b><div class='small'>Тейк — следующий ценовой уровень.</div>"; }
  else if (r.rr < 2) { cls = "no"; html = "<b>Не входить: R:R 1 : " + fmt(r.rr, 1) + "</b><div class='small'>Минимум 1:2 для отработанного сетапа. Ищите вход с более коротким стопом или следующий уровень для тейка.</div>"; }
  else if (needLower) { cls = "wait"; html = "<b>Ждать подтверждения на младшем ТФ</b><div class='small'>Отскок пинбаром или двумя свечами — только после слома структуры на младшем таймфрейме.</div>"; }
  else if (r.rr < 3) { cls = "wait"; html = "<b>Можно, но R:R 1 : " + fmt(r.rr, 1) + " ниже 1:3</b><div class='small'>Для сетапа, который у вас в журнале стабильно в плюсе.</div>"; }
  else { cls = "ok"; html = "<b>Сделка по правилам: R:R 1 : " + fmt(r.rr, 1) + "</b><div class='small'>Вход по закрытию свечи, стоп не двигаем.</div>"; }
  el.className = "verdict " + cls; el.innerHTML = html;
}
var saveUiTimer = null;
function onTradeChange(e) {
  if (e && e.target && e.target.type === "checkbox") checks[e.target.id] = e.target.checked;
  calc();
  clearTimeout(saveUiTimer);
  saveUiTimer = setTimeout(function () { UI = { dir: dir, checks: checks, setup: $("#t_setup").value, trigger: $("#t_trigger").value, ticker: $("#t_ticker").value, tf: $("#t_tf").value, calc: readCalc() }; lsSet(LS_UI, UI); }, 400);
}
function reasonText() {
  var done = []; CHECKS.forEach(function (g) { g.items.forEach(function (it) { if (checks[it.id]) done.push(it.t); }); });
  return $("#t_setup").value + ". Триггер: " + $("#t_trigger").value + (done.length ? ". Выполнено: " + done.join("; ") + "." : "");
}
function tradeToJournal() {
  var c = readCalc(), r = computePosition(c, dir);
  editing = { isNew: true, obj: { id: uid("t"), date: today(), ticker: ($("#t_ticker").value || "").toUpperCase(), tf: $("#t_tf").value, dir: dir, setup: $("#t_setup").value, trigger: $("#t_trigger").value,
    reason: reasonText(), before: "", deposit: c.dep, entry: c.entry, stop: c.stop, take: r.ok && isFinite(r.tEff) ? +r.tEff.toFixed(4) : c.take, shares: r.ok ? r.shares : "", riskPct: c.risk, riskUsd: r.ok ? +r.realRisk.toFixed(2) : "",
    status: "open", exit: "", pnl: "", closeWhy: "", chbd: "", after: "", created: Date.now() } };
  var par = addTo && Store.get("trades", addTo);
  if (par && par.ticker === editing.obj.ticker && (par.dir || "long") === dir) editing.obj.parent = par.id;
  addTo = null;
  location.hash = "#journal"; renderJournal();
  setTimeout(function () { var el = $("#editWrap"); if (el) el.scrollIntoView({ block: "start" }); }, 50);
}

/* ======================= журнал ======================= */
var jFilter = "all", editing = null;
var EXAMPLES = [
  { id: "ex1", ex: 1, date: "пример", ticker: "AMZN", tf: "D", dir: "long", setup: JSETUP.prevHigh, status: "take", riskUsd: 1000, pnl: 3100 },
  { id: "ex2", ex: 1, date: "пример", ticker: "NFLX", tf: "D", dir: "long", setup: JSETUP.breakK, status: "stop", riskUsd: 1000, pnl: -1000 },
  { id: "ex3", ex: 1, date: "пример", ticker: "AVGO", tf: "W", dir: "long", setup: JSETUP.third, status: "open", riskUsd: 900, pnl: "" }
];
function tradeR(t) { var p = num(t.pnl), rk = num(t.riskUsd); return isFinite(p) && rk > 0 ? p / rk : NaN; }
function closed(t) { return t.status && t.status !== "open"; }
function renderJournal() {
  var all = Store.list("trades").sort(function (a, b) { return (b.date || "").localeCompare(a.date || "") || (b.created || 0) - (a.created || 0); });
  var showEx = !all.length, base = showEx ? EXAMPLES : all, rows = base;
  if (jFilter === "open") rows = rows.filter(function (t) { return !closed(t); });
  if (jFilter === "closed") rows = rows.filter(closed);
  var cl = base.filter(function (t) { return closed(t) && isFinite(num(t.pnl)); });
  var wins = cl.filter(function (t) { return num(t.pnl) > 0; }), loss = cl.filter(function (t) { return num(t.pnl) < 0; });
  var sum = cl.reduce(function (a, t) { return a + num(t.pnl); }, 0);
  var gp = wins.reduce(function (a, t) { return a + num(t.pnl); }, 0), gl = Math.abs(loss.reduce(function (a, t) { return a + num(t.pnl); }, 0));
  var rs = cl.map(tradeR).filter(isFinite), avgR = rs.length ? rs.reduce(function (a, b) { return a + b; }, 0) / rs.length : NaN;
  var chbd = base.filter(function (t) { return closed(t) && t.chbd; }).length;
  var h = showEx ? '<div class="kv" style="grid-column:1/-1"><div class="k">Журнал пуст</div><div class="small">Серые строки — пример. Они исчезнут после первой вашей записи.</div></div>' : "";
  h += kv("Сделок закрыто", fmt(cl.length, 0) + (base.length - cl.length ? ' <span class="tag">+' + (base.length - cl.length) + " откр.</span>" : ""));
  h += kv("Доля прибыльных", cl.length ? fmt(wins.length / cl.length * 100, 0) + "%" : "—");
  h += kv("Итог, $", '<span class="' + (sum >= 0 ? "pos" : "neg") + '">' + money(sum) + "</span>", "big");
  h += kv("Средний R", isFinite(avgR) ? '<span class="' + (avgR >= 0 ? "pos" : "neg") + '">' + fmt(avgR, 2) + "</span>" : "—");
  h += kv("Профит-фактор", gl > 0 ? fmt(gp / gl, 2) : (gp > 0 ? "∞" : "—"));
  h += kv("Заполнено ЧБД", cl.length ? fmt(chbd, 0) + " из " + fmt(cl.length, 0) : "—");
  $("#jStats").innerHTML = h;
  var th = '<thead><tr><th>Дата</th><th>Тикер</th><th>ТФ</th><th>Сторона</th><th>Сетап</th><th>Статус</th><th class="n">Риск $</th><th class="n">Итог $</th><th class="n">R</th><th></th></tr></thead>';
  var tb = rows.map(function (t) {
    var R = tradeR(t), p = num(t.pnl), st = t.status || "open", stc = st === "take" ? "up" : st === "stop" ? "down" : st === "open" ? "acc" : "";
    return '<tr class="' + (t.ex ? "ex" : "") + '"><td class="mono">' + esc(t.date) + "</td><td><b>" + esc(t.ticker || "—") + "</b></td><td>" + esc(t.tf || "") + '</td><td><span class="tag ' + (t.dir === "short" ? "down" : "up") + '">' + (t.dir === "short" ? "шорт" : "покупка") + '</span></td><td class="small">' + esc(t.setup || "") + (t.parent ? ' <span class="tag acc">докупка</span>' : "") + '</td><td><span class="tag ' + stc + '">' + esc(STATUS[st] || st) + "</span>" + (st === "open" && atBE(t) ? ' <span class="tag up">стоп в БУ</span>' : "") + ((t.partials || []).length ? ' <span class="tag">частично</span>' : "") + '</td><td class="n">' + (isFinite(num(t.riskUsd)) ? money(num(t.riskUsd)) : "—") + '</td><td class="n ' + (p > 0 ? "pos" : p < 0 ? "neg" : "") + '">' + (isFinite(p) ? money(p) : "—") + '</td><td class="n">' + (isFinite(R) ? fmt(R, 2) : "—") + "</td><td>" + (t.ex ? "" : '<button class="btn ghost small" type="button" data-edit="' + esc(t.id) + '">Открыть</button>') + "</td></tr>";
  }).join("");
  $("#jTable").innerHTML = th + "<tbody>" + (tb || '<tr><td colspan="10" class="empty">Нет записей в этом фильтре</td></tr>') + "</tbody>";
  var by = {}; cl.forEach(function (t) { var k = t.setup || "Без сетапа"; (by[k] = by[k] || []).push(t); });
  var keys = Object.keys(by);
  var sh = '<thead><tr><th>Сетап</th><th class="n">Сделок</th><th class="n">Прибыльных</th><th class="n">Сумма R</th><th class="n">Средний R</th><th>Вывод</th></tr></thead><tbody>';
  if (!keys.length) sh += '<tr><td colspan="6" class="empty">Появится после первых закрытых сделок</td></tr>';
  keys.sort(function (a, b) { return by[b].length - by[a].length; }).forEach(function (k) {
    var arr = by[k], w = arr.filter(function (t) { return num(t.pnl) > 0; }).length, rr = arr.map(tradeR).filter(isFinite), s = rr.reduce(function (a, b) { return a + b; }, 0), av = rr.length ? s / rr.length : NaN;
    var tag = arr.length < 5 ? '<span class="tag">мало данных</span>' : s < 0 ? '<span class="tag down">убрать или пересмотреть</span>' : av >= 0.5 ? '<span class="tag up">рабочий</span>' : '<span class="tag warn">наблюдать</span>';
    sh += "<tr><td>" + esc(k) + '</td><td class="n">' + arr.length + '</td><td class="n">' + fmt(w / arr.length * 100, 0) + '%</td><td class="n ' + (s >= 0 ? "pos" : "neg") + '">' + fmt(s, 2) + '</td><td class="n">' + fmt(av, 2) + "</td><td>" + tag + "</td></tr>";
  });
  $("#jSetups").innerHTML = sh + "</tbody>";
  renderEdit();
}
function fld(n, l, type, v) { return '<label class="f"><span>' + esc(l) + '</span><input name="' + n + '" id="f_' + n + '" type="' + type + '"' + (type === "number" ? ' step="any"' : "") + ' value="' + esc(v == null ? "" : v) + '"></label>'; }
function sel(n, l, list, v) { return '<label class="f"><span>' + esc(l) + '</span><select name="' + n + '" id="f_' + n + '">' + opts(list, v) + "</select></label>"; }
function area(n, l, v) { return '<label class="f"><span>' + esc(l) + '</span><textarea name="' + n + '" id="f_' + n + '">' + esc(v || "") + "</textarea></label>"; }
function readForm(f, base) {
  var o = JSON.parse(JSON.stringify(base));
  $$("input,select,textarea", f).forEach(function (el) { if (!el.name) return; var v = el.value; if (el.type === "number") v = v === "" ? "" : num(v); if (el.type === "checkbox") v = el.checked; o[el.name] = v; });
  if (o.ticker) o.ticker = String(o.ticker).toUpperCase();
  return o;
}
function renderEdit() {
  var w = $("#editWrap");
  if (!editing) { w.innerHTML = ""; return; }
  var t = editing.obj;
  w.innerHTML = '<form class="panel stack edit-panel" id="tradeForm" novalidate><div class="row between"><h2>' + (editing.isNew ? "Новая запись" : "Сделка " + esc(t.ticker || "")) + '</h2><button class="btn ghost" type="button" id="cancelEdit">Закрыть</button></div>' +
    '<h3>Вход</h3><div class="fields">' + fld("date", "Дата", "date", t.date) + fld("ticker", "Тикер", "text", t.ticker) + sel("tf", "ТФ", ["D", "W", "MN", "H4"], t.tf) +
    '<label class="f"><span>Сторона</span><select name="dir" id="f_dir"><option value="long"' + (t.dir !== "short" ? " selected" : "") + '>Покупка</option><option value="short"' + (t.dir === "short" ? " selected" : "") + ">Шорт</option></select></label>" +
    fld("deposit", "Депозит, $", "number", t.deposit) + fld("riskPct", "Риск, %", "number", t.riskPct) + fld("entry", "Вход", "number", t.entry) + fld("stop", "Стоп", "number", t.stop) + fld("take", "Тейк", "number", t.take) + fld("shares", "Акций", "number", t.shares) + fld("riskUsd", "Риск, $", "number", t.riskUsd) +
    '</div><div class="fields wide">' + sel("setup", "Сетап", SETUPS, t.setup) + sel("trigger", "Триггер", TRIGGERS, t.trigger) + "</div>" +
    '<div class="fields wide">' + area("reason", "Почему вхожу (MN → W → D, триггер)", t.reason) + area("before", "Состояние до работы", t.before) + "</div>" +
    (editing.isNew && t.parent ? moveStopsBox(t) : "") +
    (!editing.isNew && (t.status || "open") === "open" ? '<div id="mgmt" class="stack"></div>' : mgmtLog(t)) +
    '<h3>Выход</h3><div class="fields"><label class="f"><span>Как закрылась</span><select name="status" id="f_status">' + Object.keys(STATUS).map(function (k) { return '<option value="' + k + '"' + (t.status === k ? " selected" : "") + ">" + STATUS[k] + "</option>"; }).join("") + "</select></label>" +
    fld("exit", "Цена выхода", "number", t.exit) + fld("pnl", "Итог, $", "number", t.pnl) + '</div><div class="note" id="pnlHint"></div>' +
    '<div class="fields wide">' + area("closeWhy", "Почему закрылась", t.closeWhy) + area("chbd", "ЧБД — что было дальше", t.chbd) + area("after", "Состояние после", t.after) + "</div>" +
    '<div class="row"><button class="btn pri" type="submit">Сохранить</button>' + (editing.isNew ? "" : '<button class="btn danger" type="button" id="delTrade">Удалить</button><span class="note" id="delAsk"></span>') + "</div></form>";
  var f = $("#tradeForm");
  f.addEventListener("input", function (e) { if (["exit", "entry", "shares", "dir"].indexOf(e.target.name) >= 0) autoPnl(); });
  f.addEventListener("submit", function (e) {
    e.preventDefault();
    var o = readForm(f, editing.obj), moved = 0, mv = o.moveStops; delete o.moveStops;
    var orig = Store.get("trades", o.id);
    if (orig && !isFinite(num(o.stop0)) && num(orig.stop) !== num(o.stop)) { o.stop0 = orig.stop; addLog(o, "Стоп изменён вручную: " + px(num(orig.stop)) + " → " + px(num(o.stop))); }
    if (mv && o.parent && isFinite(num(o.stop))) moved = moveSiblingStops(o);
    Store.put("trades", o); editing = null; renderJournal(); toast(moved ? "Сделка сохранена, стопы перенесены: " + moved : "Сделка сохранена");
  });
  if ($("#mgmt")) renderMgmt();
  $("#cancelEdit").onclick = function () { editing = null; renderEdit(); };
  var del = $("#delTrade");
  if (del) { var armed = false; del.onclick = function () { if (!armed) { armed = true; del.textContent = "Точно удалить?"; $("#delAsk").textContent = "Нажмите ещё раз — запись удалится."; return; } Store.del("trades", editing.obj.id); editing = null; renderJournal(); }; }
  autoPnl(true);
}
function autoPnl(onlyHint) {
  var f = $("#tradeForm"); if (!f) return;
  var fe = function (n) { return f.querySelector('[name="' + n + '"]'); };
  var e = num(fe("entry").value), x = num(fe("exit").value), sh = num(fe("shares").value), d = fe("dir").value === "short" ? -1 : 1, h = $("#pnlHint");
  var part = partialSum(editing && editing.obj), pt = part ? " (включая частичные выходы: " + money(part) + ")" : "";
  if (isFinite(e) && isFinite(x) && sh >= 0) { var p = (x - e) * sh * d + part; h.textContent = "По цене выхода без комиссии: " + money(p) + pt + (onlyHint ? "" : " — подставлено в «Итог»"); if (!onlyHint) fe("pnl").value = p.toFixed(2); }
  else h.textContent = "Укажите цену выхода — итог посчитается сам (без комиссии), его можно поправить." + (part ? " Частичные выходы уже дали " + money(part) + "." : "");
}
/* ======================= сопровождение сделки ======================= */
var MGCUR = {};
function sgn(t) { return t && t.dir === "short" ? -1 : 1; }
function atBE(t) { var e = num(t.entry), s = num(t.stop); return isFinite(e) && isFinite(s) && sgn(t) * (s - e) >= 0; }
function partialSum(t) { return ((t && t.partials) || []).reduce(function (a, p) { return a + (num(p.pnl) || 0); }, 0); }
function addLog(t, text) { (t.log = t.log || []).push({ d: today(), t: text }); }
function openSiblings(t) { return Store.list("trades").filter(function (x) { return x.id !== t.id && (x.status || "open") === "open" && x.ticker === t.ticker && (x.dir || "long") === (t.dir || "long"); }); }
function moveStopsBox(t) {
  var sib = openSiblings(t);
  if (!sib.length) return "";
  return '<label class="chk"><input type="checkbox" name="moveStops" checked><span>Перенести стопы открытых частей ' + esc(t.ticker) + " (" + sib.length + " шт.) на стоп этой докупки. По уроку «Сопровождение»: при каждой новой ТВХ все стопы переезжают за её паттерн.</span></label>";
}
function moveSiblingStops(o) {
  var n = 0, ns = num(o.stop), s = sgn(o);
  openSiblings(o).forEach(function (x) {
    var cur = num(x.stop);
    if (isFinite(cur) && s * (ns - cur) <= 0) return; // текущий стоп не хуже нового
    if (!isFinite(num(x.stop0))) x.stop0 = x.stop;
    x.stop = ns; addLog(x, "Стоп перенесён на " + px(ns) + " (докупка от " + o.date + ")"); x.u = Date.now(); n++;
  });
  return n;
}
function mgmtLog(t) {
  var L = t.log || [];
  if (!L.length) return "";
  return '<div class="panel stack"><h3>Сопровождение — история</h3><ul class="small" style="margin:0;padding-left:18px">' + L.map(function (x) { return '<li><span class="mono">' + esc(x.d) + "</span> " + esc(x.t) + "</li>"; }).join("") + "</ul></div>";
}
function mgmtAct(fn) {
  var f = $("#tradeForm"); if (!f) return;
  var o = readForm(f, editing.obj);
  if (fn(o) === false) return;
  editing.obj = o;
  Store.put("trades", JSON.parse(JSON.stringify(o)));
}
function renderMgmt() {
  var box = $("#mgmt"), t = editing.obj, s = sgn(t);
  var e = num(t.entry), st = num(t.stop), tk = num(t.take), sh = num(t.shares), s0 = isFinite(num(t.stop0)) ? num(t.stop0) : st;
  var q = DATA.map[t.ticker], manual = isFinite(MGCUR[t.id]), cur = manual ? MGCUR[t.id] : (q ? q.px : NaN);
  var path = isFinite(cur) && isFinite(tk) && tk !== e ? (cur - e) / (tk - e) : NaN;
  var R = isFinite(cur) && isFinite(s0) && e !== s0 ? s * (cur - e) / Math.abs(e - s0) : NaN;
  var openPnl = isFinite(cur) && sh > 0 ? s * (cur - e) * sh : NaN, part = partialSum(t);
  var third = e + (tk - e) / 3, two = e + 2 * (tk - e) / 3, rep = q && q.e ? daysTo(q.e) : NaN;
  var h = '<h3>Сопровождение</h3><div class="tiles">' +
    kv("Текущая цена", px(cur) + ' <span class="tag">' + (manual ? "вручную" : "закрытие дня") + "</span>") +
    kv("Пройдено пути к тейку", isFinite(path) ? fmt(path * 100, 0) + "%" : "—", "big") +
    kv("Сейчас, R", isFinite(R) ? '<span class="' + (R >= 0 ? "pos" : "neg") + '">' + fmt(R, 2) + "</span>" : "—") +
    kv("Открытый итог", isFinite(openPnl) ? '<span class="' + (openPnl >= 0 ? "pos" : "neg") + '">' + money(openPnl) + "</span>" : "—") +
    (part ? kv("Зафиксировано", money(part)) : "") +
    kv("Стоп", px(st) + (atBE(t) ? ' <span class="tag up">БУ</span>' : "")) +
    kv("1/3 пути (сейф)", px(third)) + kv("2/3 пути", px(two)) + "</div>";
  var cls = "wait", adv;
  if (!isFinite(cur)) adv = "<b>Введите текущую цену</b> — бумаги нет в данных сканера.";
  else if (path < 0) adv = "<b>Позиция в минусе: стоп не двигаем и не убираем.</b><div class='small'>Работаем на статистику. Закрыть раньше стопа — только если структура сломалась против нас: две свечи в обратную сторону и слом, а не «кажется».</div>";
  else if (path < 1 / 3) adv = "<b>Ждём.</b><div class='small'>Стоп переносим только когда появилась новая ТВХ (пробой, ретест, выход из накопления, ложный пробой) и её подтверждает младший ТФ (H4).</div>";
  else if (path < 0.8) { cls = "ok"; adv = "<b>Пройдена треть пути.</b><div class='small'>Есть новая ТВХ — можно докупиться отдельной сделкой со своим риском, все стопы перенести за её паттерн. Правило сейфа (по желанию, лучше на W и MN): закрыть 50% и стоп в безубыток.</div>"; }
  else { cls = "ok"; adv = "<b>Цена у тейка.</b><div class='small'>Варианты: закрыть всё; или на личном счёте, если тренд в силе, закрыть 50% (иногда 80%), стоп в безубыток, тейк убрать и держать по тренду.</div>"; }
  if (atBE(t) && isFinite(cur)) adv += "<div class='small'>Стоп уже в безубытке — эта часть позиции без риска.</div>";
  if (q && path > 0) {
    // RSI в «пространстве позиции»: ob — перекупленность для покупки (для шорта — перепроданность)
    var hiZ = s > 0 ? "перекупленности" : "перепроданности";
    var rw = SC.rsiInfo(SC.view(q.W, s)), rm = SC.rsiInfo(SC.view(q.M, s)), rd = SC.rsiInfo(SC.view(q.D, s));
    if (rw.ob || rm.ob) adv += "<div class='small'><b>RSI: " + (rm.ob ? "MN" : "W") + " в " + hiZ + "</b> — пора думать о фиксации у ближайшего старшего уровня.</div>";
    else if (rd.ob) adv += "<div class='small'>RSI на дневке в " + hiZ + ": идут активные " + (s > 0 ? "покупки" : "продажи") + " — движение в нашу сторону.</div>";
    if (rd.div || rw.div) adv += "<div class='small'><b>RSI: " + (s > 0 ? "дивергенция" : "конвергенция") + " против позиции</b> (" + (rw.div ? "W" : "D") + ") — " + (s > 0 ? "покупатели" : "продавцы") + " заканчиваются. По уроку — фиксировать вручную.</div>";
  }
  if (isFinite(rep) && rep >= 0 && rep <= 14) { adv += "<div class='small'><b>Через " + rep + " дн. отчёт:</b> прибыльную позицию частично фиксируем.</div>"; if (path > 0) cls = "wait"; }
  var mg = t.mg || {}, ml = { third: "пройдена треть", take: "цена у тейка", stop: "цена у стопа" };
  var tg = Object.keys(ml).filter(function (k) { return mg[k]; }).map(function (k) { return ml[k] + " (" + new Date(mg[k]).toLocaleDateString("ru-RU") + ")"; });
  if (tg.length) adv += "<div class='small muted'>Telegram уже сообщал: " + esc(tg.join(", ")) + ".</div>";
  h += '<div class="verdict ' + cls + '">' + adv + "</div>";
  h += '<div class="fields">' +
    '<label class="f"><span>Текущая цена (если другая)</span><input type="number" step="any" id="mg_cur" value="' + (manual ? MGCUR[t.id] : "") + '" placeholder="' + (isFinite(cur) ? cur : "") + '"></label>' +
    '<label class="f"><span>Новый стоп</span><input type="number" step="any" id="mg_stop"></label>' +
    '<label class="f"><span>Основание</span><select id="mg_why"><option>новая ТВХ: ретест</option><option>новая ТВХ: пробой</option><option>новая ТВХ: выход из накопления</option><option>новая ТВХ: ложный пробой</option><option>подтверждение на H4</option><option>правило сейфа</option></select></label>' +
    '<label class="f"><span>Зафиксировать часть</span><select id="mg_pct"><option value="50">50%</option><option value="80">80%</option><option value="33">33%</option></select></label>' +
    '<label class="f"><span>Цена фиксации</span><input type="number" step="any" id="mg_px" placeholder="' + (isFinite(cur) ? cur : "") + '"></label></div>';
  h += '<div class="row"><button class="btn" type="button" id="mg_be">Стоп в безубыток</button><button class="btn" type="button" id="mg_move">Перенести стоп</button><button class="btn" type="button" id="mg_part">Зафиксировать часть</button><button class="btn" type="button" id="mg_add">Докупка (новая ТВХ)</button></div>';
  h += '<details class="sec"><summary>Когда закрывать вручную</summary><div class="body small"><ul><li>Нарисовался максимум: <b>две свечи в обратную сторону</b>.</li><li>И подтверждён <b>слом структуры</b> (коррекция = импульс, импульс не обновил) — не «мне кажется».</li><li>Причину запишите в «Почему закрылась», а потом заполните ЧБД. Если «зря закрыл» повторяется — не смотрите в терминал: только стоп или тейк.</li></ul></div></details>';
  h += mgmtLog(t);
  box.innerHTML = h;
  $("#mg_cur").addEventListener("change", function () { var v = num(this.value); if (isFinite(v)) MGCUR[t.id] = v; else delete MGCUR[t.id]; renderMgmt(); });
  $("#mg_be").onclick = function () { mgmtAct(function (o) { if (atBE(o)) { toast("Стоп уже в безубытке"); return false; } if (!isFinite(num(o.stop0))) o.stop0 = o.stop; o.stop = o.entry; addLog(o, "Стоп в безубыток (" + px(num(o.entry)) + ")"); toast("Стоп перенесён в безубыток"); }); };
  $("#mg_move").onclick = function () { var ns = num($("#mg_stop").value), why = $("#mg_why").value; mgmtAct(function (o) {
    if (!isFinite(ns)) { toast("Укажите новый стоп"); return false; }
    if (sgn(o) * (ns - num(o.stop)) <= 0) { toast("Стоп двигаем только в сторону прибыли"); return false; }
    if (isFinite(cur) && sgn(o) * (cur - ns) <= 0) { toast("Новый стоп по другую сторону от текущей цены"); return false; }
    if (!isFinite(num(o.stop0))) o.stop0 = o.stop; o.stop = ns; addLog(o, "Стоп перенесён на " + px(ns) + " — " + why); toast("Стоп перенесён"); }); };
  $("#mg_part").onclick = function () { var pct = +$("#mg_pct").value, p = num($("#mg_px").value); if (!isFinite(p)) p = cur; mgmtAct(function (o) {
    var n = Math.floor(num(o.shares) * pct / 100);
    if (!isFinite(p)) { toast("Укажите цену фиксации"); return false; }
    if (!(n >= 1)) { toast("Слишком мало акций для частичного выхода"); return false; }
    var pnl = sgn(o) * (p - num(o.entry)) * n;
    (o.partials = o.partials || []).push({ d: today(), n: n, px: p, pnl: +pnl.toFixed(2) });
    o.shares = num(o.shares) - n; addLog(o, "Зафиксировано " + pct + "% (" + n + " акц.) по " + px(p) + ": " + money(pnl));
    toast("Часть зафиксирована. Не забудьте стоп в безубыток"); }); };
  $("#mg_add").onclick = function () {
    addTo = t.id; $("#t_ticker").value = t.ticker; $("#t_tf").value = t.tf || "D"; setDir(t.dir || "long", true);
    checks = {}; $$("#checklist input").forEach(function (i) { i.checked = false; });
    location.hash = "#trade"; onTradeChange(); toast("Докупка: найдите новую ТВХ, поставьте стоп за её паттерн и посчитайте риск");
  };
}

function toCsv() {
  var cols = ["date", "ticker", "tf", "dir", "setup", "trigger", "reason", "before", "deposit", "riskPct", "riskUsd", "entry", "stop0", "stop", "take", "shares", "status", "exit", "pnl", "closeWhy", "chbd", "after", "log"];
  var head = ["Дата", "Тикер", "ТФ", "Сторона", "Сетап", "Триггер", "Почему вхожу", "Состояние до", "Депозит", "Риск %", "Риск $", "Вход", "Стоп начальный", "Стоп", "Тейк", "Акций", "Статус", "Выход", "Итог $", "Почему закрылась", "ЧБД", "Состояние после", "Сопровождение"];
  var q = function (v) { v = v == null ? "" : String(v); return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  var val = function (t, c) {
    if (c === "status") return STATUS[t.status] || t.status;
    if (c === "dir") return t.dir === "short" ? "шорт" : "покупка";
    if (c === "stop0") return isFinite(num(t.stop0)) ? t.stop0 : t.stop;
    if (c === "log") return (t.log || []).map(function (x) { return x.d + " " + x.t; }).join(" | ");
    if (c === "setup") return (t.setup || "") + (t.parent ? " (докупка)" : "");
    return t[c];
  };
  return [head.join(";")].concat(Store.list("trades").map(function (t) { return cols.map(function (c) { return q(val(t, c)); }).join(";"); })).join("\n");
}
function initJournal() {
  $$("[data-jf]").forEach(function (b) { b.onclick = function () { jFilter = b.dataset.jf; $$("[data-jf]").forEach(function (x) { x.classList.toggle("on", x === b); }); renderJournal(); }; });
  $("#newTrade").onclick = function () { var c = readCalc(); editing = { isNew: true, obj: { id: uid("t"), date: today(), ticker: "", tf: "D", dir: "long", setup: SETUPS[0], trigger: TRIGGERS[0], reason: "", before: "", deposit: c.dep, riskPct: c.risk, entry: "", stop: "", take: "", shares: "", riskUsd: "", status: "open", exit: "", pnl: "", closeWhy: "", chbd: "", after: "", created: Date.now() } }; renderEdit(); };
  $("#jTable").addEventListener("click", function (e) { var b = e.target.closest("[data-edit]"); if (!b) return; var t = Store.get("trades", b.dataset.edit); if (t) { editing = { obj: JSON.parse(JSON.stringify(t)), isNew: false }; renderEdit(); $("#editWrap").scrollIntoView({ block: "start" }); } });
  $("#copyCsv").onclick = function () {
    var csv = toCsv(), box = $("#csvBox");
    if (!Store.list("trades").length) { box.innerHTML = '<p class="note">В журнале пока нет ваших сделок.</p>'; return; }
    var show = function (msg) { box.innerHTML = '<div class="panel stack"><span class="note">' + msg + '</span><textarea class="copybox" id="csvText" readonly>' + esc(csv) + "</textarea></div>"; var ta = $("#csvText"); ta.focus(); ta.select(); };
    try { navigator.clipboard.writeText(csv).then(function () { show("CSV скопирован. Вставьте в Excel или Google Таблицы (разделитель — точка с запятой)."); }, function () { show("Текст выделен — нажмите Ctrl+C."); }); } catch (err) { show("Текст выделен — нажмите Ctrl+C."); }
  };
}

/* ======================= watchlist ======================= */
var pEdit = null;
function renderPlan() {
  var order = { alert: 0, wait: 1, in: 2, cancel: 3 };
  var rows = Store.list("plans").sort(function (a, b) { return (order[a.status] == null ? 1 : order[a.status]) - (order[b.status] == null ? 1 : order[b.status]) || (b.created || 0) - (a.created || 0); });
  var th = '<thead><tr><th>Тикер</th><th>Сторона</th><th>Чего жду</th><th class="n">Вход / стоп / тейк</th><th>Алерт</th><th>Отчёт</th><th>Статус</th><th></th></tr></thead>';
  var tb = rows.map(function (p) {
    var dt = daysTo(p.report), rep = p.report ? '<span class="mono">' + esc(p.report) + "</span>" + (isFinite(dt) && dt >= 0 && dt <= 14 ? ' <span class="tag warn">через ' + dt + " дн.</span>" : "") : "—";
    var al = p.alertOn ? (p.alertTriggered ? '<span class="tag warn">сработал ' + esc(new Date(p.alertTriggered).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })) + "</span>" : '<span class="tag acc">' + (p.alertDir === "above" ? "≥ " : "≤ ") + px(num(p.alertPrice)) + "</span>") : '<span class="tag">нет</span>';
    var st = p.status || "wait", stc = st === "alert" ? "warn" : st === "in" ? "up" : st === "cancel" ? "" : "acc";
    return "<tr><td><b>" + esc(p.ticker) + "</b>" + (p.note ? '<div class="small muted">' + esc(p.note) + "</div>" : "") + '</td><td><span class="tag ' + (p.dir === "short" ? "down" : "up") + '">' + (p.dir === "short" ? "шорт" : "покупка") + "</span> " + esc(p.tf || "") + '</td><td class="small">' + esc(p.setup || "") + '</td><td class="n">' + px(num(p.entry)) + " / " + px(num(p.stop)) + " / " + px(num(p.take)) + "</td><td>" + al + "</td><td>" + rep + '</td><td><span class="tag ' + stc + '">' + esc(PSTATUS[st] || st) + "</span></td>" +
      '<td class="row" style="flex-wrap:nowrap">' + (DATA.map[p.ticker] ? '<button class="btn ghost small" type="button" data-pchart="' + esc(p.ticker) + '">График</button>' : "") + '<button class="btn ghost small" type="button" data-pedit="' + esc(p.id) + '">Изменить</button></td></tr>';
  }).join("");
  $("#pTable").innerHTML = th + "<tbody>" + (tb || '<tr><td colspan="8" class="empty">Пусто. Добавляйте бумаги из сканера кнопкой «В watchlist» или вручную.</td></tr>') + "</tbody>";
  renderPlanEdit();
}
function renderPlanEdit() {
  var w = $("#planEdit"); if (!pEdit) { w.innerHTML = ""; return; }
  var p = pEdit.obj;
  w.innerHTML = '<form class="panel stack edit-panel" id="planForm" novalidate><div class="row between"><h2>' + (pEdit.isNew ? "Новая бумага" : esc(p.ticker)) + '</h2><button class="btn ghost" type="button" id="pCancel">Закрыть</button></div>' +
    '<div class="fields">' + fld("ticker", "Тикер", "text", p.ticker) + sel("tf", "ТФ", ["D", "W", "MN"], p.tf) +
    '<label class="f"><span>Сторона</span><select name="dir"><option value="long"' + (p.dir !== "short" ? " selected" : "") + '>Покупка</option><option value="short"' + (p.dir === "short" ? " selected" : "") + ">Шорт</option></select></label>" +
    fld("entry", "Вход", "number", p.entry) + fld("stop", "Стоп", "number", p.stop) + fld("take", "Тейк (уровень)", "number", p.take) + fld("report", "Дата отчёта", "date", p.report) +
    '<label class="f"><span>Статус</span><select name="status">' + Object.keys(PSTATUS).map(function (k) { return '<option value="' + k + '"' + (p.status === k ? " selected" : "") + ">" + PSTATUS[k] + "</option>"; }).join("") + "</select></label></div>" +
    '<div class="fields wide">' + sel("setup", "Чего жду", SETUPS, p.setup) + "</div>" +
    '<h3>Алерт в Telegram</h3><div class="fields"><label class="chk" style="align-self:end"><input type="checkbox" name="alertOn"' + (p.alertOn ? " checked" : "") + "><span>Включён</span></label>" +
    fld("alertPrice", "Цена алерта", "number", p.alertPrice) + '<label class="f"><span>Условие</span><select name="alertDir"><option value="below"' + (p.alertDir !== "above" ? " selected" : "") + '>опустится до</option><option value="above"' + (p.alertDir === "above" ? " selected" : "") + ">поднимется до</option></select></label></div>" +
    (p.alertTriggered ? '<label class="chk"><input type="checkbox" name="rearm"><span>Сработал ' + esc(new Date(p.alertTriggered).toLocaleString("ru-RU")) + " — включить заново</span></label>" : "") +
    area("note", "Заметка (уровни, условия входа)", p.note) +
    '<div class="row"><button class="btn pri" type="submit">Сохранить</button>' + (pEdit.isNew ? "" : '<button class="btn" type="button" id="pToCalc">В калькулятор</button><button class="btn danger" type="button" id="pDel">Удалить</button>') + "</div></form>";
  var f = $("#planForm");
  f.addEventListener("submit", function (e) { e.preventDefault(); var o = readForm(f, pEdit.obj); if (o.rearm) o.alertTriggered = null; delete o.rearm; Store.put("plans", o); pEdit = null; renderPlan(); toast("Сохранено"); });
  $("#pCancel").onclick = function () { pEdit = null; renderPlanEdit(); };
  var c = $("#pToCalc"); if (c) c.onclick = function () { var o = readForm(f, pEdit.obj); $("#t_ticker").value = o.ticker; var cc = readCalc(); cc.entry = o.entry; cc.stop = o.stop; cc.take = o.take; setCalc(cc); setDir(o.dir || "long", true); $("#t_setup").value = o.setup; onTradeChange(); location.hash = "#trade"; };
  var d = $("#pDel"); if (d) { var armed = false; d.onclick = function () { if (!armed) { armed = true; d.textContent = "Точно удалить?"; return; } Store.del("plans", pEdit.obj.id); pEdit = null; renderPlan(); }; }
}
function initPlan() {
  $("#newPlan").onclick = function () { pEdit = { isNew: true, obj: { id: uid("p"), ticker: "", tf: "D", dir: "long", setup: SETUPS[2], entry: "", stop: "", take: "", report: "", status: "wait", alertOn: true, alertPrice: "", alertDir: "below", alertTriggered: null, note: "", created: Date.now() } }; renderPlanEdit(); };
  $("#pTable").addEventListener("click", function (e) {
    var b = e.target.closest("[data-pedit]"); if (b) { var p = Store.get("plans", b.dataset.pedit); if (p) { pEdit = { isNew: false, obj: JSON.parse(JSON.stringify(p)) }; renderPlanEdit(); window.scrollTo(0, 0); } return; }
    var g = e.target.closest("[data-pchart]"); if (g) openChart(g.dataset.pchart, null);
  });
}

/* ======================= шпаргалка ======================= */
function spark(pts, level, mark, labels) {
  var W = 260, H = 120, pad = 12, all = pts.concat(level != null ? [level] : []), min = Math.min.apply(null, all), max = Math.max.apply(null, all);
  var X = function (i) { return pad + i * (W - 2 * pad) / (pts.length - 1); }, Y = function (v) { return H - pad - (v - min) * (H - 2 * pad) / (max - min || 1); };
  var d = pts.map(function (v, i) { return (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1); }).join(" ");
  var s = '<svg viewBox="0 0 ' + W + " " + H + '" aria-hidden="true">';
  if (level != null) s += '<line x1="' + pad + '" x2="' + (W - pad) + '" y1="' + Y(level) + '" y2="' + Y(level) + '" stroke="var(--muted)" stroke-dasharray="4 4"/>';
  s += '<path d="' + d + '" fill="none" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round"/>';
  (labels || []).forEach(function (l) { s += '<text x="' + X(l[0]) + '" y="' + (Y(pts[l[0]]) + (l[2] || -6)) + '" font-size="10" text-anchor="middle" fill="var(--muted)">' + l[1] + "</text>"; });
  if (mark != null) s += '<circle cx="' + X(mark) + '" cy="' + Y(pts[mark]) + '" r="5" fill="var(--up)"/><text x="' + X(mark) + '" y="' + (Y(pts[mark]) + 18) + '" font-size="10" text-anchor="middle" fill="var(--up)" font-weight="700">ТВХ</text>';
  return s + "</svg>";
}
function initGuide() {
  var cards = [
    { t: "Слом: коррекция = импульс", p: "Нисходящая структура, затем коррекция больше последнего импульса. Вход — ретест уровня начала последнего импульса.", svg: spark([90, 60, 75, 40, 55, 22, 64, 55, 88], 55, 7, [[5, "И", 14], [6, "К=И"]]) },
    { t: "Импульс не обновил → слом", p: "Импульс не обновил минимум (первый признак), коррекция ломает структуру. Вход — ретест уровня слома. Это же 1-2-3.", svg: spark([90, 52, 70, 30, 50, 38, 64, 50, 86], 50, 7, [[3, "1", 14], [4, "2"], [5, "3", 14]]) },
    { t: "Пробой с 3-го раза", p: "Тест 1, тест 2, накопление. ТВХ-1 — ложный пробой низа, ТВХ-2 — пробой (добор в 2 раза меньше), ТВХ-3 — ретест.", svg: spark([20, 70, 52, 70, 58, 62, 55, 73, 69, 92], 70, 6, [[1, "т1"], [3, "т2"], [7, "пробой"]]) },
    { t: "Флет: выход и ретест", p: "Во флете торгуем только от границ. Консервативно — выход из накопления и вход на ретесте.", svg: spark([30, 60, 44, 60, 45, 59, 46, 72, 61, 88], 60, 8, [[7, "выход"]]) }
  ];
  var sec = function (title, body, open) { return '<details class="sec"' + (open ? " open" : "") + "><summary>" + esc(title) + '</summary><div class="body">' + body + "</div></details>"; };
  var html = '<div class="panel stack"><h2>Лучшие сетапы автора</h2><div class="cards">' + cards.map(function (c) { return '<div class="card">' + c.svg + "<h4>" + esc(c.t) + "</h4><p>" + esc(c.p) + "</p></div>"; }).join("") + "</div></div>";
  html += sec("Как работает сканер", "<p>Каждый вечер после закрытия рынка США GitHub скачивает котировки ~1000 бумаг с капитализацией от 10 млрд $ и строит развороты (зигзаг по ATR) на месяце, неделе и дне. Кнопка «Сканировать» проверяет их по правилам ниже прямо на устройстве.</p><ul><li><b>Тренд</b> — по 4 точкам: три последних разворота плюс текущая цена.</li><li><b>Фильтр месяца</b>: против месячного тренда сделок нет.</li><li><b>В зоне</b> — цена в пределах ~0,75 ATR от уровня входа; <b>на подходе</b> — до 4 ATR: ставьте алерт.</li><li><b>Стоп</b> — за уровнем на 0,5 ATR, <b>тейк</b> — 80% пути до следующего уровня (или высота фигуры).</li><li><b>Триггер</b> — ложный пробой уровня, пинбар, поглощение или харами на последней закрытой свече.</li><li><b>RSI</b> — зелёные метки: выход из перепроданности или конвергенция (доп. подтверждение); серые: предупреждения (ждём выхода, старший ТФ в перекупленности).</li></ul><p>Сканер находит кандидатов. Решение о входе — по графику и чек-листу.</p>", true);
  html += sec("Три кита и главное правило", "<ul><li><b>Тренд — твой друг.</b> Против тренда не торгуем.</li><li><b>Цена учитывает всё.</b></li><li><b>История повторяется.</b></li></ul><p><b>В импульсе не покупаем и не продаём. Ждём окончания коррекции.</b> MN → W → D.</p>");
  html += sec("Азбука: шесть «букв»", '<div class="tbl-wrap"><table><thead><tr><th>Импульсы</th><th>Коррекции</th></tr></thead><tbody><tr><td><b>Обновил</b> — тренд</td><td><b>Стандартная</b> — тренд продолжается</td></tr><tr><td><b>Вровень</b> — флет под вопросом</td><td><b>Вровень</b> — флет</td></tr><tr><td><b>Не обновил</b> — первый признак слома</td><td><b>= новый импульс</b> — слом</td></tr></tbody></table></div><p>Пройдено 61,8% старшего импульса — покупки не рассматриваем.</p>');
  html += sec("Триггеры входа", "<ul><li><b>Ложный пробой</b> (1 свеча, 2 свечи, харами, поглощение) — стоп за ложным пробоем.</li><li><b>Отскок</b> пинбаром или двумя свечами — только с подтверждением сломом на младшем ТФ.</li><li><b>Пробой</b>: с 1-го раза не торгуем, со 2-го — по закрытию свечи, с 3-го — любимая ТВХ.</li><li><b>Ретест</b>: уровни, пробитые с 3-го раза, и уровни слома ретестятся почти всегда.</li></ul>");
  html += sec("RSI (индекс относительной силы)", "<ul><li><b>RSI(14), уровни 30 и 70.</b> Выше 70 — перекупленность, ниже 30 — перепроданность, середина — «зона неинтересно»: сигналов там нет.</li><li><b>Только по тренду.</b> Выход из перепроданности (пересечение 30 снизу вверх) — дополнительное подтверждение запланированной ТВХ: ретест, ложный пробой, нижняя граница флета. В шорт — выход из перекупленности через 70. Против тренда сигнал обманный.</li><li><b>Конвергенция</b> у зоны входа: цена обновила минимум, а RSI — нет (продавцы кончаются). Сильный повод искать покупку.</li><li><b>Дивергенция</b> на максимумах: цена обновила максимум, RSI — нет (покупатель кончился). Фиксируем вручную.</li><li>Перекупленность на <b>D</b> — идут активные покупки. На <b>W и MN</b> — пора думать о фиксации. Все ТФ в перекупленности — продолжение 50/50, лучше фиксировать.</li><li>На акциях D, W, MN редко заходят в зоны — входы по RSI ищите на <b>H4</b> (и H1). Уход H1/H4 в перекупленность по тренду — пошли большие деньги: можно войти раньше закрытия дневной свечи (ближе к концу сессии), стоп короче, без риска гэпа.</li><li>Скользящие (MA) запаздывают: если техника уже дала ложный пробой, а 50 и 200 вот-вот пересекутся — входим по технике, не ждём пересечения.</li><li>RSI, свечи, скользящие — только помощники. Основа — теханализ и фундамент.</li></ul>");
  html += sec("Риск и тейк", "<ul><li>Риск 1% на сделку с комиссией, до ~15 позиций.</li><li>R:R: 1:1 — минус; 1:2 — минимум; цель 1:3+. При 1:3 доля прибыльных 45% — очень хороший результат, 50% — удвоение депозита.</li><li>Тейк — следующий уровень, ~80% пути.</li><li>Перед отчётом не входим, прибыльные позиции частично фиксируем.</li></ul>");
  html += sec("Сопровождение сделки", "<ul><li><b>Стоп двигаем только при новой ТВХ</b> (ретест, пробой, выход из накопления, ложный пробой), лучше с подтверждением на H4. Стоп всегда за последним минимумом — за паттерном последнего входа.</li><li><b>Докупка</b> — отдельная сделка: своя ТВХ, свой стоп, риск от текущего депозита. Тейк общий (по старшему ТФ). Стопы всех прежних частей переносим на стоп докупки: первые части оказываются в безубытке или в плюсе.</li><li><b>У тейка</b>: закрыть всё; или на личном счёте при сильном тренде — закрыть 50% (иногда 80%), стоп в безубыток, тейк убрать и держать по тренду.</li><li><b>Закрыть вручную</b> — если нарисовался максимум (две свечи против нас) и подтверждён слом структуры, а не «кажется». Причину — в журнал.</li><li><b>Правило сейфа</b> (по желанию): путь до тейка делим на 3 части; прошли треть — закрыть 50% и стоп в безубыток, дальше стоп подтягиваем. Лучше работает на W и MN, на форексе и крипте; придумано, чтобы новичок не терял много.</li><li>Сопровождение — ежедневно ~30 минут. Если по журналу «зря закрыл» повторяется — не смотрите в терминал: только стоп или тейк.</li><li>1–2 числа месяца проверяйте закрытие месячных свечей.</li></ul>");
  html += '<p class="note">Конспект обучающего курса для самостоятельной работы, не инвестиционная рекомендация. Графики: TradingView Lightweight Charts™.</p>';
  $("#guideBody").innerHTML = html;
}

/* ======================= настройки ======================= */
function initSettings() {
  var host = location.hostname, auto = /\.github\.io$/.test(host) ? host.split(".")[0] : "";
  var c = Sync.cfg;
  $("#s_owner").value = c.owner || auto; $("#s_repo").value = c.repo || "osipov-journal"; $("#s_scan").value = c.scanRepo || "osipov-scanner"; $("#s_token").value = c.token ? "••••••••" : "";
  $("#saveSync").onclick = function () {
    var tok = $("#s_token").value.trim();
    Sync.cfg = { owner: $("#s_owner").value.trim(), repo: $("#s_repo").value.trim(), scanRepo: $("#s_scan").value.trim(), token: tok && tok.indexOf("••") < 0 ? tok : c.token };
    lsSet(LS_SYNC, Sync.cfg); c = Sync.cfg; $("#s_token").value = c.token ? "••••••••" : "";
    $("#syncMsg").textContent = "Подключаюсь…";
    Sync.pull().then(function () { $("#syncMsg").textContent = Sync.ok ? "Готово: журнал и watchlist синхронизируются." : "Не получилось — проверьте логин, имя репозитория и ключ."; });
  };
  $("#forgetToken").onclick = function () { Sync.cfg.token = ""; lsSet(LS_SYNC, Sync.cfg); c = Sync.cfg; $("#s_token").value = ""; Sync.status("warn", "Журнал: только на этом устройстве"); $("#syncMsg").textContent = "Ключ удалён с этого устройства."; };
  $("#refreshData").onclick = function () { Sync.dispatch(Sync.cfg.scanRepo || "osipov-scanner", "build.yml").then(function () { $("#actMsg").textContent = "Запущено. Новые котировки появятся через 15–25 минут — обновите страницу."; }, function (e) { $("#actMsg").textContent = "Не запустилось: " + e.message; }); };
  $("#checkAlerts").onclick = function () { Sync.dispatch(Sync.cfg.repo || "osipov-journal", "alerts.yml").then(function () { $("#actMsg").textContent = "Проверка алертов запущена, займёт 1–2 минуты."; setTimeout(function () { Sync.pull(); }, 120000); }, function (e) { $("#actMsg").textContent = "Не запустилось: " + e.message; }); };
}
function renderSettingsInfo() {
  var s = Store.st.settings || {};
  var t = s.tgError ? "Ошибка: " + s.tgError : s.tgChat ? "Подключён (чат " + s.tgChat + ")." : "Не подключён: добавьте секрет TG_TOKEN и напишите боту /start.";
  if (s.lastAlertRun) t += " Последняя проверка алертов: " + new Date(s.lastAlertRun).toLocaleString("ru-RU") + ".";
  $("#tgInfo").textContent = t;
}

/* ======================= запуск ======================= */
function renderAll() { renderJournal(); renderPlan(); }
initScan(); initTrade(); initJournal(); initPlan(); initGuide(); initSettings();
route(); renderAll(); calc(); renderSettingsInfo();
$("#chClose").onclick = closeChart;
$("#chartModal").addEventListener("click", function (e) { if (e.target.id === "chartModal") closeChart(); });
document.addEventListener("keydown", function (e) { if (e.key === "Escape" && $("#chartModal").classList.contains("on")) closeChart(); });
$$("[data-ctf]").forEach(function (b) { b.onclick = function () { CH.tf = b.dataset.ctf; drawChart(); }; });
loadData();
Sync.pull();
document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") Sync.pull(); });
setInterval(function () { if (document.visibilityState === "visible" && !Sync.busy) Sync.pull(); }, 180000);
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(function () { /* без офлайна */ });
})();
