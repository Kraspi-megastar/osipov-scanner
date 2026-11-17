"""Ежедневное обновление данных для сканера Осипова.

Запускается в GitHub Actions после закрытия рынка США.
1. Список бумаг: все акции NASDAQ/NYSE/AMEX с капитализацией от MIN_CAP (по умолчанию 10 млрд $).
2. Котировки (yfinance): месяц (до 25 лет), неделя (10 лет), день (2 года).
3. Для каждого таймфрейма: развороты (зигзаг по ATR), ATR, последние две свечи и свечные модели.
4. Даты ближайших отчётов.
Результат:
  <out>/universe.json  — компактные структуры для сканера (весь рынок одним файлом)
  <out>/charts/<T>.json — свечи для графика (грузятся по запросу)
  <out>/meta.json       — время обновления и статистика
"""
import argparse
import json
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
ZZ_K = {"D": 2.5, "W": 2.0, "M": 1.5}
KEEP_PIVOTS = 16
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
        if cap < MIN_CAP:
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


def to_bars(df, limit):
    df = df.tail(limit)
    t = [d.strftime("%Y-%m-%d") for d in df.index]
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


def candles(o, h, l, c):
    """Свечные модели на последней закрытой свече."""
    res = []
    if len(c) < 2:
        return res
    O, H, L, C = o[-1], h[-1], l[-1], c[-1]
    po, pc = o[-2], c[-2]
    rng = H - L
    body = abs(C - O)
    if rng > 0:
        lw = min(O, C) - L
        uw = H - max(O, C)
        if lw >= 2 * body and lw >= 0.6 * rng and (C - L) >= 0.6 * rng:
            res.append("pin+")
        if uw >= 2 * body and uw >= 0.6 * rng and (H - C) >= 0.6 * rng:
            res.append("pin-")
    pb = abs(pc - po)
    if pc < po and C > O and C >= po and O <= pc and body > pb:
        res.append("eng+")
    if pc > po and C < O and C <= po and O >= pc and body > pb:
        res.append("eng-")
    if pc < po and C > O and max(O, C) <= po and min(O, C) >= pc and body < 0.6 * pb:
        res.append("har+")
    if pc > po and C < O and max(O, C) <= pc and min(O, C) >= po and body < 0.6 * pb:
        res.append("har-")
    return res


def tf_struct(df, key, limit):
    t, (o, h, l, c) = to_bars(df, limit)
    if len(c) < 20:
        return None, None
    p, a = zigzag(o, h, l, c, ZZ_K[key])
    st = {"a": rnd(a), "n": len(c), "p": p,
          "lb": [rnd(o[-1]), rnd(h[-1]), rnd(l[-1]), rnd(c[-1])],
          "pb": [rnd(o[-2]), rnd(h[-2]), rnd(l[-2]), rnd(c[-2])],
          "cp": candles(o, h, l, c), "d": t[-1]}
    chart = [[t[i], rnd(o[i]), rnd(h[i]), rnd(l[i]), rnd(c[i])] for i in range(len(c))]
    return st, chart


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
    if earnings is None:
        earnings = load_earnings(syms) if os.environ.get("SKIP_EARNINGS") != "1" else {}
    limits = {"M": 300, "W": 520, "D": 500}
    items, failed = [], []
    for u in uni:
        s = u["s"]
        rec = dict(u)
        chart = {"s": s}
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
            chart[key] = ch
        if not ok:
            failed.append(s)
            continue
        rec["px"] = rec["D"]["lb"][3]
        if s in earnings:
            rec["e"] = earnings[s]
        items.append(rec)
        with open(os.path.join(out, "charts", f"{s}.json"), "w", encoding="utf-8") as f:
            json.dump(chart, f, separators=(",", ":"))
    now = datetime.now(timezone.utc).isoformat(timespec="minutes")
    with open(prev, "w", encoding="utf-8") as f:
        json.dump({"updated": now, "zz": ZZ_K, "t": items}, f, ensure_ascii=False, separators=(",", ":"))
    meta = {"updated": now, "count": len(items), "failed": failed[:200], "failedCount": len(failed),
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
