/* Сканер по правилам Осипова.
 * Вход: структура бумаги из universe.json (развороты по таймфреймам M, W, D).
 * Каждый разворот: [индекс бара, тип, цена по тени, цена по телу, RSI], тип 1 — максимум, -1 — минимум,
 * ±2 — текущий экстремум, ещё не подтверждённый разворотом. tf.r — RSI(14) последних 5 свечей.
 * Все детекторы написаны для покупки; для шорта цены зеркалятся (умножаются на -1).
 */
(function (root) {
  "use strict";

  var SETUPS = {
    breakK: "Слом: коррекция = импульс → ретест",
    breakN: "Слом: импульс не обновил → ретест",
    prevHigh: "Ретест предыдущего максимума",
    line: "Линия поддержки, 3-е касание",
    flatLow: "Флет: от нижней границы",
    flatRetest: "Флет: выход + ретест накопления",
    third: "Накопление у уровня: пробой с 3-го раза",
    dbl: "Двойное дно → ретест шеи"
  };
  var SETUPS_SHORT = {
    breakK: "Слом: коррекция = импульс → ретест",
    breakN: "Слом: импульс не обновил → ретест",
    prevHigh: "Ретест предыдущего минимума",
    line: "Линия сопротивления, 3-е касание",
    flatLow: "Флет: от верхней границы",
    flatRetest: "Флет: выход вниз + ретест",
    third: "Накопление у уровня: пробой вниз с 3-го раза",
    dbl: "Двойная вершина → ретест шеи"
  };

  // ---------- представление в «пространстве покупки»
  function view(tf, sgn) {
    if (!tf || !tf.p || !tf.p.length) return null;
    var p = tf.p.map(function (x) {
      return { i: x[0], t: sgn * Math.sign(x[1]), tent: Math.abs(x[1]) === 2, w: sgn * x[2], b: sgn * x[3], r: mr(x[4], sgn) };
    });
    var lb = tf.lb, pb = tf.pb;
    var bar = function (b) { return sgn > 0 ? { o: b[0], h: b[1], l: b[2], c: b[3] } : { o: -b[0], h: -b[2], l: -b[1], c: -b[3] }; };
    return { p: p, a: tf.a, n: tf.n, P: sgn * lb[3], last: bar(lb), prev: bar(pb), cp: tf.cp || [], sgn: sgn,
      r: (tf.r || []).map(function (x) { return mr(x, sgn); }) };
  }
  // RSI в «пространстве покупки»: для шорта перекупленность (70) становится перепроданностью (30)
  function mr(x, sgn) { return x == null ? NaN : sgn > 0 ? x : 100 - x; }

  // ---------- RSI (урок «RSI»): 30 / 70, середина — «зона неинтересно»
  // exit — выход из перепроданности: пересечение 30 снизу вверх за последние 3 свечи (для шорта — 70 сверху вниз);
  // conv — конвергенция у минимумов: цена обновила минимум, RSI — нет, первый минимум был в перепроданности
  // (для шорта — дивергенция у максимумов); div — дивергенция против позиции: повод зафиксировать вручную.
  function rsiInfo(v) {
    var r = v.r || [], now = r[r.length - 1], o = { now: now, exit: false, os: false, ob: false, conv: false, div: false };
    if (!isFinite(now)) return o;
    o.os = now < 30; o.ob = now > 70;
    for (var k = Math.max(1, r.length - 3); k < r.length; k++) if (r[k - 1] < 30 && r[k] >= 30) o.exit = true;
    if (now < 30) o.exit = false;
    var lows = v.p.filter(function (x) { return x.t < 0 && isFinite(x.r); }).slice(-2);
    if (lows.length === 2 && lows[1].w < lows[0].w && lows[1].r > lows[0].r + 2 && lows[0].r < 35) o.conv = true;
    var highs = v.p.filter(function (x) { return x.t > 0 && isFinite(x.r); }).slice(-2);
    if (highs.length === 2 && highs[1].w > highs[0].w && highs[1].r < highs[0].r - 2 && highs[0].r > 65) o.div = true;
    return o;
  }
  var real = function (v, x) { return v.sgn * x; };

  // ---------- тренд по правилу четырёх точек
  // 3 последних разворота (включая текущий экстремум) + текущая цена.
  function trend(v) {
    if (!v || v.p.length < 3) return "flat";
    var p = v.p, A = v.a, last = p[p.length - 1];
    var inImpulse = last.tent && Math.abs(last.w - v.P) < 1.0 * A;
    var pts;
    if (inImpulse) {
      var conf = p.slice(0, -1).slice(-3);
      pts = conf.map(function (x) { return { t: x.t, w: x.w }; }).concat([{ t: last.t, w: v.P }]);
    } else {
      pts = p.slice(-3).map(function (x) { return { t: x.t, w: x.w }; }).concat([{ t: -last.t, w: v.P }]);
    }
    var H = pts.filter(function (x) { return x.t > 0; }).map(function (x) { return x.w; });
    var L = pts.filter(function (x) { return x.t < 0; }).map(function (x) { return x.w; });
    if (H.length < 2 || L.length < 2) return "flat";
    var tol = 0.25 * A;
    var hu = H[1] - H[0] > tol, hd = H[0] - H[1] > tol, lu = L[1] - L[0] > tol, ld = L[0] - L[1] > tol;
    if (hu && lu) return "up";
    if (hd && ld) return "down";
    return "flat";
  }
  // Фаза текущего движения: импульс по тренду или коррекция
  function phase(v) {
    var last = v.p[v.p.length - 1];
    if (last.tent && Math.abs(last.w - v.P) < 1.0 * v.a) return last.t > 0 ? "impulseUp" : "impulseDown";
    return last.t > 0 ? "corrDown" : "corrUp";
  }

  // ---------- вспомогательное
  function nextResistance(v, above, minDist) {
    // ближайший максимум (по телу) выше уровня
    var best = Infinity;
    v.p.forEach(function (x) { if (x.t > 0 && x.b > above + minDist && x.b < best) best = x.b; });
    v.p.forEach(function (x) { if (x.t > 0 && x.w > above + minDist && x.w < best) best = x.w; });
    return isFinite(best) ? best : NaN;
  }
  function zoneStatus(v, level, tolUp, tolDown) {
    var d = (v.P - level) / v.a; // в ATR: >0 цена выше уровня
    if (d >= -tolDown && d <= tolUp) return { z: "in", d: d };
    if (d > tolUp && d <= tolUp + 4) return { z: "near", d: d };
    return { z: "far", d: d };
  }
  function trigger(v, level) {
    var res = [];
    var L = v.last, A = v.a;
    var cp = v.cp.map(function (c) { return v.sgn > 0 ? c : c.replace("+", "#").replace("-", "+").replace("#", "-"); });
    if (isFinite(level) && L.l < level - 0.05 * A && L.c > level) res.push("ложный пробой одной свечой");
    if (isFinite(level) && v.prev.l < level - 0.05 * A && v.prev.c < level && L.c > level && L.c > L.o) res.push("ложный пробой двумя свечами");
    if (cp.indexOf("pin+") >= 0) res.push("пинбар");
    if (cp.indexOf("eng+") >= 0) res.push("поглощение");
    if (cp.indexOf("har+") >= 0) res.push("харами");
    return res;
  }
  function plan(v, entry, stop, take, k80) {
    var t80 = entry + (take - entry) * (k80 || 0.8);
    var rr = (t80 - entry) / (entry - stop);
    return { entry: real(v, entry), stop: real(v, stop), take: real(v, t80), level: real(v, take), rr: isFinite(rr) && rr > 0 ? rr : NaN };
  }

  // ---------- детекторы (всё в пространстве покупки)
  // 1–2. Слом: ...H_a, L_a, H_b, L0, H_c(> H_b), [L_d] — ретест уровня H_b
  function detBreak(v, cfg) {
    var p = v.p, out = [];
    for (var j = Math.max(3, p.length - 4); j < p.length - 1; j++) {
      var Ha = p[j - 3], La = p[j - 2], Hb = p[j - 1], L0 = p[j], Hc = p[j + 1];
      if (!(Ha.t > 0 && La.t < 0 && Hb.t > 0 && L0.t < 0 && Hc.t > 0)) continue;
      if (!(Hb.w < Ha.w - 0.25 * v.a)) continue;        // до слома структура нисходящая
      if (!(Hc.w > Hb.w + 0.25 * v.a)) continue;        // коррекция стала больше импульса — слом
      var rest = p.slice(j + 2);
      if (rest.length > 1) continue;                     // после слома не больше одного разворота
      if (rest.length === 1 && !(rest[0].t < 0 && rest[0].w > L0.w)) continue;
      if (v.P <= L0.w) continue;
      var level = Hb.b;
      var zs = zoneStatus(v, level, cfg.tol, 0.6);
      if (zs.z === "far") continue;
      if (phase(v) !== "corrDown" && zs.z !== "in") continue;
      var stop = Math.min(v.P, level, v.last.l) - cfg.stopAtr * v.a;
      var take = nextResistance(v, level, 1.5 * v.a);
      if (!isFinite(take)) take = Hc.w;
      var kind = L0.w > La.w + 0.25 * v.a ? "breakN" : "breakK";
      out.push({ k: kind, zs: zs, pl: plan(v, level, stop, take), lvl: real(v, level), trg: zs.z === "in" ? trigger(v, level) : [],
        why: kind === "breakN" ? "импульс не обновил минимум, затем слом; ретест уровня слома" : "коррекция больше последнего импульса — слом; ретест уровня слома" });
    }
    return out;
  }

  // 3. Ретест предыдущего максимума: тренд вверх, H_prev, L, H_last(> H_prev), сейчас коррекция к H_prev
  function detPrevHigh(v, cfg) {
    var p = v.p, n = p.length;
    if (n < 3 || trend(v) !== "up" || phase(v) !== "corrDown") return [];
    var Hl = p[n - 1], L = p[n - 2], Hp = p[n - 3];
    if (!(Hl.t > 0 && L.t < 0 && Hp.t > 0 && Hl.w > Hp.w + 0.5 * v.a)) return [];
    var retr = (Hl.w - v.P) / (Hl.w - L.w);
    if (retr > 0.618) return [];
    var level = Hp.b;
    var zs = zoneStatus(v, level, cfg.tol, 0.6);
    if (zs.z === "far") return [];
    var stop = Math.min(v.P, level, v.last.l) - cfg.stopAtr * v.a;
    return [{ k: "prevHigh", zs: zs, pl: plan(v, level, stop, Hl.w), lvl: real(v, level), trg: zs.z === "in" ? trigger(v, level) : [],
      why: "восходящая структура, коррекция к пробитому максимуму (" + Math.round(retr * 100) + "% от импульса)" }];
  }

  // 4. Линия поддержки по двум повышающимся минимумам, цена у линии
  function detLine(v, cfg) {
    var p = v.p, n = p.length;
    if (n < 4 || phase(v) !== "corrDown" || trend(v) !== "up") return [];
    var lows = p.filter(function (x) { return x.t < 0 && !x.tent; }).slice(-2);
    if (lows.length < 2 || !(lows[1].w > lows[0].w + 0.5 * v.a) || lows[1].i === lows[0].i) return [];
    var slope = (lows[1].w - lows[0].w) / (lows[1].i - lows[0].i);
    var lineNow = lows[1].w + slope * (v.n - 1 - lows[1].i);
    var zs = zoneStatus(v, lineNow, cfg.tol, 0.4);
    if (zs.z === "far") return [];
    var top = p[n - 1].t > 0 ? p[n - 1].w : nextResistance(v, v.P, v.a);
    var stop = Math.min(v.P, lineNow, v.last.l) - cfg.stopAtr * v.a;
    return [{ k: "line", zs: zs, pl: plan(v, lineNow, stop, top), lvl: real(v, lineNow), trg: zs.z === "in" ? trigger(v, lineNow) : [],
      why: "линия поддержки по двум повышающимся минимумам, третье касание" }];
  }

  // Ищем флет в окне разворотов: максимумы и минимумы держатся в коридоре
  function findFlat(ptsAll, A) {
    var pts = ptsAll.filter(function (x) { return !x.tent; });
    var H = pts.filter(function (x) { return x.t > 0; }), L = pts.filter(function (x) { return x.t < 0; });
    if (H.length < 2 || L.length < 2) return null;
    var hs = H.map(function (x) { return x.w; }), ls = L.map(function (x) { return x.w; });
    var top = Math.max.apply(null, hs), bot = Math.min.apply(null, ls), hgt = top - bot;
    if (hgt < 3 * A) return null;
    var hSpread = top - Math.min.apply(null, hs), lSpread = Math.max.apply(null, ls) - bot;
    if (hSpread > 0.35 * hgt || lSpread > 0.35 * hgt) return null;
    var tn = ptsAll.filter(function (x) { return x.tent; })[0];
    if (tn && (tn.w > top + 0.5 * A || tn.w < bot - 0.5 * A)) return null;
    return { top: top, bot: bot, h: hgt, topB: Math.max.apply(null, H.map(function (x) { return x.b; })), botB: Math.min.apply(null, L.map(function (x) { return x.b; })) };
  }

  // 5. Флет: от нижней границы
  function detFlatLow(v, cfg) {
    var p = v.p;
    if (p.length < 4) return [];
    var f = findFlat(p.slice(-6), v.a) || findFlat(p.slice(-5), v.a);
    if (!f) return [];
    if (v.P > f.bot + 0.25 * f.h || v.P < f.bot - 0.6 * v.a) {
      var zsF = zoneStatus(v, f.botB, cfg.tol, 0.6);
      if (zsF.z !== "near") return [];
    }
    var level = f.botB;
    var zs = zoneStatus(v, level, Math.max(cfg.tol, 0.25 * f.h / v.a), 0.6);
    if (zs.z === "far") return [];
    var stop = Math.min(f.bot, v.last.l) - cfg.stopAtr * v.a;
    return [{ k: "flatLow", zs: zs, pl: plan(v, Math.max(level, Math.min(v.P, level + 0.25 * f.h)), stop, f.topB), lvl: real(v, level), trg: zs.z === "in" ? trigger(v, f.bot) : [],
      why: "боковик высотой " + (f.h / v.a).toFixed(1) + " ATR, цена у нижней границы" }];
  }

  // 6. Флет: выход вверх + ретест верхней границы
  function detFlatRetest(v, cfg) {
    var p = v.p, n = p.length;
    if (n < 5) return [];
    var last = p[n - 1];
    var brk = last.t > 0 ? last : (n >= 2 && p[n - 2].t > 0 ? p[n - 2] : null);
    if (!brk) return [];
    var k = p.indexOf(brk);
    var f = findFlat(p.slice(Math.max(0, k - 5), k), v.a) || findFlat(p.slice(Math.max(0, k - 4), k), v.a);
    if (!f || !(brk.w > f.top + 1 * v.a)) return [];
    if (v.P < f.top - 0.8 * v.a) return [];
    var level = f.topB;
    var zs = zoneStatus(v, level, cfg.tol, 0.6);
    if (zs.z === "far") return [];
    var stop = Math.min(v.P, level, v.last.l) - cfg.stopAtr * v.a;
    var take = Math.max(brk.w, f.top + f.h);
    return [{ k: "flatRetest", zs: zs, pl: plan(v, level, stop, take), lvl: real(v, level), trg: zs.z === "in" ? trigger(v, level) : [],
      why: "выход из накопления и возврат к его верхней границе" }];
  }

  // 7. Накопление у уровня: два теста одного максимума, минимумы растут — ждём пробой с 3-го раза
  function detThird(v, cfg) {
    var p = v.p, n = p.length;
    if (n < 5) return [];
    var H = p.filter(function (x) { return x.t > 0; }).slice(-2);
    if (H.length < 2) return [];
    var h1 = H[0], h2 = H[1];
    if (Math.abs(h1.w - h2.w) > 0.75 * v.a) return [];
    var level = Math.max(h1.w, h2.w), levelB = Math.max(h1.b, h2.b);
    var lowsBetween = p.filter(function (x) { return x.t < 0 && x.i > h1.i; });
    var lowsBefore = p.filter(function (x) { return x.t < 0 && x.i < h1.i; });
    if (!lowsBetween.length || !lowsBefore.length) return [];
    var accLow = Math.min.apply(null, lowsBetween.map(function (x) { return x.w; }));
    var pre = lowsBefore[lowsBefore.length - 1];
    if (!(accLow > pre.w + 0.5 * v.a)) return [];        // восходящая структура: минимумы растут
    if (v.P > level + 0.5 * v.a || v.P < accLow - 0.6 * v.a) return [];
    var d = (level - v.P) / v.a;
    var zs = { z: d <= cfg.tol + 0.5 ? "in" : d <= 4 ? "near" : "far", d: -d };
    if (zs.z === "far") return [];
    var pole = level - pre.w;
    var entry = level + 0.1 * v.a, stop = accLow - 0.25 * v.a;
    return [{ k: "third", zs: zs, pl: plan(v, entry, stop, level + pole, 0.8), lvl: real(v, levelB), trg: trigger(v, accLow),
      why: "два теста уровня, минимумы растут: ТВХ-1 ложный пробой низа накопления, ТВХ-2 пробой с 3-го раза" }];
  }

  // 8. Двойное дно: два минимума на одном уровне, шея пробита — ретест шеи
  function detDouble(v, cfg) {
    var p = v.p, n = p.length;
    if (n < 5) return [];
    for (var j = n - 4; j < n - 2; j++) {
      if (j < 1) continue;
      var Hpre = p[j - 1], L1 = p[j], N = p[j + 1], L2 = p[j + 2], B = p[j + 3];
      if (!(Hpre && L1 && N && L2 && Hpre.t > 0 && L1.t < 0 && N.t > 0 && L2.t < 0)) continue;
      if (Math.abs(L1.w - L2.w) > 0.75 * v.a || !(Hpre.w > N.w)) continue;
      var neck = N.b, hgt = N.w - Math.min(L1.w, L2.w);
      if (hgt < 2 * v.a) continue;
      var broke = B && B.t > 0 && B.w > N.w + 0.5 * v.a;
      if (!broke) continue;
      var zs = zoneStatus(v, neck, cfg.tol, 0.6);
      if (zs.z === "far") continue;
      var stop = Math.min(v.P, neck, v.last.l) - cfg.stopAtr * v.a;
      return [{ k: "dbl", zs: zs, pl: plan(v, neck, stop, N.w + hgt), lvl: real(v, neck), trg: zs.z === "in" ? trigger(v, neck) : [],
        why: "двойное дно, шея пробита; тейк — высота фигуры" }];
    }
    return [];
  }

  var DETECTORS = { breakK: detBreak, breakN: detBreak, prevHigh: detPrevHigh, line: detLine, flatLow: detFlatLow, flatRetest: detFlatRetest, third: detThird, dbl: detDouble };

  // Подсказки RSI для находки: rsi.ok — доп. подтверждения входа, rsi.warn — предупреждения
  function rsiTags(t, tf, sgn) {
    var ok = [], warn = [], e = rsiInfo(view(t[tf], sgn)), w = rsiInfo(view(t.W, sgn)), m = rsiInfo(view(t.M, sgn));
    var long = sgn > 0;
    if (e.exit) ok.push(long ? "RSI вышел из перепроданности" : "RSI вышел из перекупленности");
    if (e.conv) ok.push(long ? "RSI конвергенция" : "RSI дивергенция у максимумов");
    if (e.os) warn.push(long ? "RSI в перепроданности: ждём выхода через 30" : "RSI в перекупленности: ждём выхода через 70");
    var hiW = long ? "перекупленности" : "перепроданности";
    if (w.ob && m.ob && rsiInfo(view(t.D, sgn)).ob) warn.push("все ТФ в " + hiW + ": продолжение 50/50");
    else if (w.ob || m.ob) warn.push((m.ob ? "MN" : "W") + " в " + hiW + ": ближе к фиксации, чем ко входу");
    return { ok: ok, warn: warn, now: isFinite(e.now) ? (long ? e.now : 100 - e.now) : null };
  }

  function daysTo(d, today) {
    if (!d) return NaN;
    return Math.round((new Date(d + "T00:00:00Z") - new Date(today + "T00:00:00Z")) / 864e5);
  }

  /* cfg: {tf:'D'|'W', dirs:['long','short'], setups:{key:true}, tol:0.75, stopAtr:0.5,
           mnFilter:true, wFilter:true, earnDays:14, earnExclude:true, minRR:2, zones:['in','near'],
           minCap:10, sector:'', today:'YYYY-MM-DD'} */
  function scanTicker(t, cfg) {
    var res = [];
    var dirs = cfg.dirs || ["long"];
    dirs.forEach(function (dir) {
      var sgn = dir === "long" ? 1 : -1;
      var v = view(t[cfg.tf], sgn);
      if (!v || !(v.a > 0)) return;
      var mT = trend(view(t.M, sgn)), wT = trend(view(t.W, sgn));
      if (cfg.mnFilter && mT === "down") return;           // против месячного тренда не торгуем
      if (cfg.wFilter && cfg.tf === "D" && wT === "down") return;
      var seen = {};
      Object.keys(DETECTORS).forEach(function (key) {
        if (!cfg.setups[key]) return;
        var fn = DETECTORS[key];
        if (seen[fn.name]) return;
        seen[fn.name] = 1;
        fn(v, cfg).forEach(function (h) {
          if (!cfg.setups[h.k]) return;
          if (cfg.zones.indexOf(h.zs.z) < 0) return;
          if (cfg.minRR && !(h.pl.rr >= cfg.minRR)) return;
          var ed = daysTo(t.e, cfg.today);
          if (cfg.earnExclude && isFinite(ed) && ed >= 0 && ed <= cfg.earnDays) return;
          res.push({
            s: t.s, n: t.n, sec: t.sec, mc: t.mc, px: t.px, dir: dir, tf: cfg.tf, k: h.k,
            name: (dir === "long" ? SETUPS : SETUPS_SHORT)[h.k], why: h.why, zone: h.zs.z, dAtr: h.zs.d,
            entry: h.pl.entry, stop: h.pl.stop, take: h.pl.take, level: h.lvl, takeLevel: h.pl.level, rr: h.pl.rr,
            trg: h.trg, mT: mT, wT: wT, e: t.e || null, eDays: ed, atr: t[cfg.tf].a, rsi: rsiTags(t, cfg.tf, sgn)
          });
        });
      });
    });
    return res;
  }

  function scan(universe, cfg) {
    var out = [];
    universe.forEach(function (t) {
      if (cfg.minCap && t.mc < cfg.minCap) return;
      if (cfg.sector && t.sec !== cfg.sector) return;
      try { out = out.concat(scanTicker(t, cfg)); } catch (e) { /* пропускаем битую запись */ }
    });
    var zr = { in: 0, near: 1, far: 2 };
    out.sort(function (a, b) {
      return (zr[a.zone] - zr[b.zone]) || ((b.trg.length > 0) - (a.trg.length > 0)) || ((b.rsi.ok.length > 0) - (a.rsi.ok.length > 0)) || ((b.rr || 0) - (a.rr || 0));
    });
    return out;
  }

  var api = { scan: scan, scanTicker: scanTicker, trend: trend, view: view, phase: phase, rsiInfo: rsiInfo, rsiTags: rsiTags, SETUPS: SETUPS, SETUPS_SHORT: SETUPS_SHORT };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.OsipovScanner = api;
})(this);
