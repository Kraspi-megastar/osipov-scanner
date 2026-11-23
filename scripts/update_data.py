"""Ежедневное обновление данных для сканера Осипова.

Запускается в GitHub Actions после закрытия рынка США.
1. Список бумаг: все акции NASDAQ/NYSE/AMEX с капитализацией от MIN_CAP (по умолчанию 10 млрд $).
2. Котировки (yfinance): месяц (до 25 лет), неделя (10 лет), день (2 года), 4 часа (год; собираются из часовых свечей
   по сессии США: 9:30–13:30 и 13:30–16:00 по Нью-Йорку, как в TradingView).
3. Для каждого таймфрейма: развороты (зигзаг по ATR), ATR, RSI(14), последние две свечи и свечные модели,
   прайс экшен (характер свечи, волны, доля бычьих тел), скользящие 50/100/200.
4. Даты ближайших отчётов.
Результат:
  <out>/universe.json  — компактные структуры для сканера (весь рынок одним файлом)
  <out>/charts/<T>.json — свечи для графика (грузятся по запросу)
  <out>/meta.json       — время обновления и статистика
"""
import argparse
import json
import re
import math
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone, date

import numpy as np
import pandas as pd

MIN_CAP = float(os.environ.get("MIN_CAP", 10e9))
# Чувствительность зигзага: разворот считается, когда цена прошла K * ATR(14) от экстремума.
ZZ_K = {"H4": 2.5, "D": 2.5, "W": 2.0, "M": 1.5}
KEEP_PIVOTS = 16
# Облигации, привилегированные акции, варранты и т.п. — не обычные акции, сканер их не смотрит
NOT_COMMON = re.compile(r"%|\b(notes?|debentures?|preferred|warrants?|rights|units?|subordinated|perpetual|depositary shares, each)\b", re.I)
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")


# ---------------------------------------------------------------- список бумаг
def load_universe(prev_path):
    import requests
    rows = []
    try:
        r = requests.get(
            "https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&download=true",
            headers={"User-Agent": UA, "Accept": "application/json, text/plain, */*",
                     "Origin": "https://www.nasdaq.com", "Referer": "https://www.nasdaq.com/"},
            timeout=60)
        r.raise_for_status()
        rows = r.json()["data"]["rows"]
    except Exception as e:  # noqa
        print("NASDAQ screener недоступен:", e, file=sys.stderr)
    out = []
    for x in rows:
        sym = (x.get("symbol") or "").strip()
        if not sym or "^" in sym or " " in sym:
            continue
        try:
            cap = float(str(x.get("marketCap") or "0").replace(",", "").replace("$", "") or 0)
        except ValueError:
            cap = 0
        if cap < MIN_CAP or NOT_COMMON.search(x.get("name") or ""):
            continue
        out.append({"s": sym.replace("/", "-"), "n": (x.get("name") or "").strip(),
                    "sec": (x.get("sector") or "").strip(), "ind": (x.get("industry") or "").strip(),
                    "mc": round(cap / 1e9, 1)})
    if len(out) < 300 and prev_path and os.path.exists(prev_path):
        print("Беру список бумаг из прошлого обновления", file=sys.stderr)
        prev = json.load(open(prev_path, encoding="utf-8"))
        out = [{k: t.get(k) for k in ("s", "n", "sec", "ind", "mc")} for t in prev.get("t", [])]
    # Убираем дубли тикеров
    seen, uniq = set(), []
    for t in sorted(out, key=lambda t: -t["mc"]):
        if t["s"] not in seen:
            seen.add(t["s"])
            uniq.append(t)
    return uniq


# ---------------------------------------------------------------- котировки
def download(tickers, period, interval, batch=80):
    import yfinance as yf
    res = {}
    for k in range(0, len(tickers), batch):
        chunk = tickers[k:k + batch]
        for attempt in range(3):
            try:
                df = yf.download(chunk, period=period, interval=interval, group_by="ticker",
                                 auto_adjust=True, threads=True, progress=False)
                break
            except Exception as e:  # noqa
                print(f"повтор {attempt + 1} {interval} {k}: {e}", file=sys.stderr)
                time.sleep(5 * (attempt + 1))
                df = None
        if df is None or df.empty:
            continue
        for s in chunk:
            try:
                sub = df[s] if isinstance(df.columns, pd.MultiIndex) else df
            except KeyError:
                continue
            sub = sub.dropna(subset=["Open", "High", "Low", "Close"])
            if len(sub):
                res[s] = sub
        time.sleep(1.5)
    return res


def to_h4(df):
    """Часовые свечи → 4-часовые по сессии: 9:30–13:30 и 13:30–16:00 (время Нью-Йорка).
    Индекс результата — «наивное» нью-йоркское время начала свечи."""
    if df is None or df.empty:
        return df
    idx = df.index
    if idx.tz is not None:
        idx = idx.tz_convert("America/New_York").tz_localize(None)
    d = df.copy()
    d.index = idx
    mins = d.index.hour * 60 + d.index.minute
    d = d[(mins >= 570) & (mins < 960)]  # только основная сессия
    if d.empty:
        return d
    mins = d.index.hour * 60 + d.index.minute
    start = pd.to_datetime(d.index.date) + pd.to_timedelta(np.where(mins >= 810, 810, 570), unit="m")
    g = d.groupby(start)
    out = pd.DataFrame({"Open": g["Open"].first(), "High": g["High"].max(), "Low": g["Low"].min(), "Close": g["Close"].last()})
    return out.dropna()


def to_bars(df, limit):
    df = df.tail(limit)
    intraday = len(df) > 1 and any(x.hour or x.minute for x in df.index[-3:])
    # дневные и старше — дата строкой; H4 — секунды (нью-йоркское время, записанное как UTC: график покажет 9:30 и 13:30)
    t = [int(pd.Timestamp(d).tz_localize(None).value // 10**9) if intraday else d.strftime("%Y-%m-%d") for d in df.index]
    cols = [df[c].to_numpy(dtype=float) for c in ("Open", "High", "Low", "Close")]
    return t, cols


def rnd(x):
    if not math.isfinite(x):
        return None
    return round(x, 2) if abs(x) >= 1 else round(x, 4)


# ---------------------------------------------------------------- структуры
def atr(h, l, c, n=14):
    pc = np.concatenate([[c[0]], c[:-1]])
    tr = np.maximum(h - l, np.maximum(np.abs(h - pc), np.abs(l - pc)))
    out = np.empty_like(tr)
    out[0] = tr[0]
    a = 1.0 / n
    for i in range(1, len(tr)):  # сглаживание Уайлдера
        out[i] = out[i - 1] + a * (tr[i] - out[i - 1])
    return out


def rsi(c, n=14):
    """RSI(14) по Уайлдеру."""
    c = np.asarray(c, dtype=float)
    out = np.full(len(c), np.nan)
    if len(c) <= n:
        return out
    d = np.diff(c)
    up = np.where(d > 0, d, 0.0)
    dn = np.where(d < 0, -d, 0.0)
    au, ad = up[:n].mean(), dn[:n].mean()
    out[n] = 100.0 if ad == 0 else 100 - 100 / (1 + au / ad)
    for i in range(n + 1, len(c)):
        au = (au * (n - 1) + up[i - 1]) / n
        ad = (ad * (n - 1) + dn[i - 1]) / n
        out[i] = 100.0 if ad == 0 else 100 - 100 / (1 + au / ad)
    return out


def r1(x):
    return round(float(x), 1) if math.isfinite(x) else None


def zigzag(o, h, l, c, k):
    """Развороты: [индекс бара, тип (1 максимум / -1 минимум; ±2 — текущий, ещё не подтверждённый),
    цена по тени, цена по телу]."""
    n = len(c)
    if n < 5:
        return [], float("nan")
    A = atr(h, l, c)
    piv = []
    d = 0
    hi, hi_i, lo, lo_i = h[0], 0, l[0], 0
    for i in range(1, n):
        th = k * A[i]
        if d == 0:
            if h[i] > hi:
                hi, hi_i = h[i], i
            if l[i] < lo:
                lo, lo_i = l[i], i
            if hi - lo >= th:
                if lo_i < hi_i:
                    piv.append([lo_i, -1]); d = 1; ext, ext_i = hi, hi_i
                else:
                    piv.append([hi_i, 1]); d = -1; ext, ext_i = lo, lo_i
        elif d == 1:
            if h[i] >= ext:
                ext, ext_i = h[i], i
            elif ext - l[i] >= th:
                piv.append([ext_i, 1]); d = -1; ext, ext_i = l[i], i
        else:
            if l[i] <= ext:
                ext, ext_i = l[i], i
            elif h[i] - ext >= th:
                piv.append([ext_i, -1]); d = 1; ext, ext_i = h[i], i
    if d != 0:
        piv.append([ext_i, 2 * d])
    out = []
    for i, t in piv:
        if t > 0:
            out.append([int(i), int(t), rnd(h[i]), rnd(max(o[i], c[i]))])
        else:
            out.append([int(i), int(t), rnd(l[i]), rnd(min(o[i], c[i]))])
    return out[-KEEP_PIVOTS:], float(A[-1])


def candles(o, h, l, c, A=None, i=None):
    """Свечные модели (урок «Прайс экшен») на свече i (по умолчанию — последней закрытой).
    Код: имя + знак: «+» — бычья модель, «-» — медвежья. Нейтральные (доджи, волчок) — без знака.
    Названия зависят от контекста: та же форма — молот после падения и повешенный после роста."""
    n = len(c)
    i = n - 1 if i is None else i
    res = []
    if i < 1:
        return res
    if A is None or not (A > 0):
        A = float(np.mean(h[max(0, i - 14):i + 1] - l[max(0, i - 14):i + 1])) or 1.0
    O, H, L, C = o[i], h[i], l[i], c[i]
    po, ph, pl, pc = o[i - 1], h[i - 1], l[i - 1], c[i - 1]
    rng = H - L
    body = abs(C - O)
    lw = min(O, C) - L
    uw = H - max(O, C)

    def prior(k):  # движение за 5 свечей до начала модели из k свечей, в ATR
        j = i - k
        return (c[j] - c[max(0, j - 5)]) / A if j >= 1 else 0.0

    if rng > 0:
        if lw >= 2 * body and lw >= 0.6 * rng and (C - L) >= 0.6 * rng:
            res.append("pin+")
        if uw >= 2 * body and uw >= 0.6 * rng and (H - C) >= 0.6 * rng:
            res.append("pin-")
        if body <= 0.1 * rng and rng >= 0.3 * A and min(lw, uw) >= 0.3 * rng:
            res.append("doji")  # тени примерно равны; доджи-стрекоза и надгробие идут как пинбары
        elif body <= 0.3 * rng and lw >= body and uw >= body and min(lw, uw) >= 0.25 * rng:
            res.append("top")  # волчок
        if body >= 0.85 * rng and rng >= 0.8 * A:
            res.append("mar+" if C > O else "mar-")  # марибозу
        inside = max(O, C) <= ph and min(O, C) >= pl
        if body > 0 and lw >= 2 * body and uw <= 0.1 * rng and inside:
            if prior(1) < -0.5:
                res.append("ham+")     # молот
            elif prior(1) > 0.5:
                res.append("hang-")    # повешенный
        if body > 0 and uw >= 2 * body and lw <= 0.1 * rng:
            if prior(1) < -0.5:
                res.append("ihm+")     # перевёрнутый молот
            elif prior(1) > 0.5:
                res.append("star-")    # падающая звезда
    pbody = abs(pc - po)
    if pc < po and C > O and C >= po and O <= pc and body > pbody:
        res.append("eng+")
    if pc > po and C < O and C <= po and O >= pc and body > pbody:
        res.append("eng-")
    if pc < po and C > O and max(O, C) <= po and min(O, C) >= pc and body < 0.6 * pbody:
        res.append("har+")
    if pc > po and C < O and max(O, C) <= pc and min(O, C) >= po and body < 0.6 * pbody:
        res.append("har-")
    # пинцет: первая свеча по тренду, вторая против, экстремумы равны
    if prior(2) < -0.5 and pc < po and C > O and abs(L - pl) <= 0.1 * A:
        res.append("twz+")
    if prior(2) > 0.5 and pc > po and C < O and abs(H - ph) <= 0.1 * A:
        res.append("twz-")
    if i >= 2:
        o3, c3 = o[i - 2], c[i - 2]
        b3 = abs(c3 - o3)
        mid3 = (o3 + c3) / 2
        small = pbody <= 0.3 * b3
        # утренняя / вечерняя звезда: длинная — очень маленькая — большая противоположная за середину первой
        if b3 >= 0.6 * A and small and c3 < o3 and C > O and C >= mid3 and body >= 0.5 * b3:
            res.append("ms+")
        if b3 >= 0.6 * A and small and c3 > o3 and C < O and C <= mid3 and body >= 0.5 * b3:
            res.append("es-")
        # три внутри вверх / вниз: харами и закрытие за открытием первой свечи
        if c3 < o3 and pc > po and max(po, pc) <= o3 and min(po, pc) >= c3 and C > O and C > o3:
            res.append("3in+")
        if c3 > o3 and pc < po and max(po, pc) <= c3 and min(po, pc) >= o3 and C < O and C < o3:
            res.append("3in-")
        # три белых солдата / три чёрных вороны
        bodies = [abs(c[k] - o[k]) for k in (i - 2, i - 1, i)]
        if all(c[k] > o[k] for k in (i - 2, i - 1, i)) and c[i - 2] < c[i - 1] < C and min(bodies) >= 0.5 * A \
                and o3 <= po <= c3 and po <= O <= pc:
            res.append("3ws+")
        if all(c[k] < o[k] for k in (i - 2, i - 1, i)) and c[i - 2] > c[i - 1] > C and min(bodies) >= 0.5 * A \
                and c3 <= po <= o3 and pc <= O <= po:
            res.append("3bc-")
    # одна форма — разный смысл по контексту: после роста «молот» — это повешенный (медвежий), а не бычий пинбар;
    # после падения «падающая звезда» — это перевёрнутый молот (бычий), а не медвежий пинбар
    if "hang-" in res and "pin+" in res:
        res.remove("pin+")
    if "ihm+" in res and "pin-" in res:
        res.remove("pin-")
    return res


def candle_character(o, h, l, c, A):
    """Чтение последней свечи по телу и теням: сила, нерешительность, нет интереса, волатильность."""
    O, H, L, C = o[-1], h[-1], l[-1], c[-1]
    rng = H - L
    if not (rng > 0 and A > 0):
        return None
    body = abs(C - O)
    big_body = body >= 0.6 * A
    long_sh = (rng - body) >= 0.6 * rng
    if big_body and (rng - body) <= 0.3 * rng:
        return "strong+" if C > O else "strong-"
    if big_body and (rng - body) >= 0.4 * rng:
        return "vol"
    if body <= 0.3 * rng and long_sh and rng >= 0.6 * A:
        return "indec"
    if body <= 0.25 * A and rng <= 0.5 * A:
        return "quiet"
    return None


def waves(o, c, p, A):
    """Последние волны между разворотами: [направление, длина/ATR, свечей, средн. тело/ATR] — для оценки силы тренда."""
    out = []
    for k in range(max(1, len(p) - 5), len(p)):
        i1, i2 = p[k - 1][0], p[k][0]
        if i2 <= i1:
            continue
        d = 1 if p[k][2] > p[k - 1][2] else -1
        seg = np.abs(c[i1 + 1:i2 + 1] - o[i1 + 1:i2 + 1])
        out.append([d, round(abs(p[k][2] - p[k - 1][2]) / A, 2), int(i2 - i1), round(float(seg.mean()) / A, 2)])
    return out


def bull_share(o, c, n=10):
    """Доля бычьих тел за последние n свечей: >0.6 — контроль у быков, <0.4 — у медведей."""
    b = c[-n:] - o[-n:]
    tot = float(np.abs(b).sum())
    return round(float(b[b > 0].sum()) / tot, 2) if tot > 0 else None


def moving(c):
    """Последние значения скользящих: SMA 50/100/200 и EMA 200."""
    s = pd.Series(c)
    out = {}
    for k in (50, 100, 200):
        if len(c) >= k:
            out[f"s{k}"] = rnd(float(s.rolling(k).mean().iloc[-1]))
    if len(c) >= 200:
        out["e200"] = rnd(float(s.ewm(span=200, adjust=False).mean().iloc[-1]))
    return out


def tf_struct(df, key, limit):
    t, (o, h, l, c) = to_bars(df, limit)
    if len(c) < 20:
        return None, None
    p, a = zigzag(o, h, l, c, ZZ_K[key])
    R = rsi(c)
    for pv in p:  # RSI в точке разворота — для дивергенции и конвергенции
        pv.append(r1(R[pv[0]]))
    st = {"a": rnd(a), "n": len(c), "p": p, "r": [r1(x) for x in R[-5:]],
          "lb": [rnd(o[-1]), rnd(h[-1]), rnd(l[-1]), rnd(c[-1])],
          "pb": [rnd(o[-2]), rnd(h[-2]), rnd(l[-2]), rnd(c[-2])],
          "cp": candles(o, h, l, c, a), "d": t[-1],
          "ch": candle_character(o, h, l, c, a), "wv": waves(o, c, p, a), "bb": bull_share(o, c), "ma": moving(c)}
    chart = [[t[i], rnd(o[i]), rnd(h[i]), rnd(l[i]), rnd(c[i])] for i in range(len(c))]
    # отметки свечных моделей для графика: последние 150 свечей, только направленные модели
    marks = []
    for i in range(max(2, len(c) - 150), len(c)):
        cs = [x for x in candles(o, h, l, c, a, i) if x[-1] in "+-"]
        if cs:
            marks.append([t[i]] + cs)
    return st, (chart, marks)


# ---------------------------------------------------------------- отчёты
def earnings_for(sym):
    import yfinance as yf
    try:
        cal = yf.Ticker(sym).calendar
        ds = cal.get("Earnings Date") if isinstance(cal, dict) else None
        if ds:
            today = date.today()
            fut = sorted(d for d in ds if isinstance(d, date) and d >= today)
            if fut:
                return fut[0].isoformat()
    except Exception:  # noqa
        pass
    return None


def load_earnings(tickers, workers=8):
    res = {}
    with ThreadPoolExecutor(workers) as ex:
        futs = {ex.submit(earnings_for, s): s for s in tickers}
        for f in as_completed(futs):
            try:
                v = f.result(timeout=30)
            except Exception:  # noqa
                v = None
            if v:
                res[futs[f]] = v
    return res


# ---------------------------------------------------------------- сборка
def build(out, frames=None, universe=None, earnings=None):
    os.makedirs(os.path.join(out, "charts"), exist_ok=True)
    prev = os.path.join(out, "universe.json")
    uni = universe if universe is not None else load_universe(prev)
    syms = [u["s"] for u in uni]
    print(f"Бумаг в списке: {len(syms)}")
    if frames is None:
        frames = {"M": download(syms, "max", "1mo"),
                  "W": download(syms, "10y", "1wk"),
                  "D": download(syms, "2y", "1d")}
        if os.environ.get("SKIP_H4") != "1":
            hourly = download(syms, "1y", "1h")
            frames["H4"] = {s: to_h4(df) for s, df in hourly.items()}
    if earnings is None:
        earnings = load_earnings(syms) if os.environ.get("SKIP_EARNINGS") != "1" else {}
    limits = {"M": 300, "W": 520, "D": 500, "H4": 500}
    items, failed, h4n = [], [], 0
    for u in uni:
        s = u["s"]
        rec = dict(u)
        chart = {"s": s, "pm": {}}  # pm — отметки свечных моделей по таймфреймам
        ok = True
        for key in ("M", "W", "D"):
            df = frames[key].get(s)
            if df is None:
                ok = False
                break
            st, ch = tf_struct(df, key, limits[key])
            if st is None:
                ok = False
                break
            rec[key] = st
            chart[key], chart["pm"][key] = ch
        if not ok:
            failed.append(s)
            continue
        h4 = frames.get("H4", {}).get(s)  # H4 необязателен: без него бумага остаётся в сканере
        if h4 is not None and len(h4) >= 40:
            st, ch = tf_struct(h4, "H4", limits["H4"])
            if st is not None:
                rec["H4"] = st
                chart["H4"], chart["pm"]["H4"] = ch
                h4n += 1
        rec["px"] = rec["D"]["lb"][3]
        if s in earnings:
            rec["e"] = earnings[s]
        items.append(rec)
        with open(os.path.join(out, "charts", f"{s}.json"), "w", encoding="utf-8") as f:
            json.dump(chart, f, separators=(",", ":"))
    now = datetime.now(timezone.utc).isoformat(timespec="minutes")
    with open(prev, "w", encoding="utf-8") as f:
        json.dump({"updated": now, "zz": ZZ_K, "t": items}, f, ensure_ascii=False, separators=(",", ":"))
    meta = {"updated": now, "count": len(items), "h4": h4n, "failed": failed[:200], "failedCount": len(failed),
            "minCapBn": MIN_CAP / 1e9}
    with open(os.path.join(out, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False)
    print(json.dumps(meta, ensure_ascii=False)[:500])
    if len(items) < 100:
        sys.exit("Слишком мало бумаг загрузилось — проверьте лог")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="site/data")
    build(ap.parse_args().out)
