"""Иконки приложения (PNG 192 и 512) — рисуются при сборке сайта."""
import sys
from PIL import Image, ImageDraw

out = sys.argv[1] if len(sys.argv) > 1 else "site"
for S in (192, 512):
    im = Image.new("RGB", (S, S), "#14202b")
    d = ImageDraw.Draw(im)
    u = S / 24

    def candle(x, o, c, h, l, col):
        d.line([(x * u, h * u), (x * u, l * u)], fill=col, width=max(2, int(u * 0.6)))
        d.rectangle([((x - 1.3) * u, min(o, c) * u), ((x + 1.3) * u, max(o, c) * u)], fill=col)

    candle(7, 9, 14, 7, 16, "#ff7b70")
    candle(12, 13, 9, 7, 15, "#4cc68a")
    candle(17, 9, 5, 3.5, 11, "#4cc68a")
    d.line([(4 * u, 18.5 * u), (20 * u, 18.5 * u)], fill="#7aa2ff", width=max(2, int(u * 0.5)))
    im.save(f"{out}/icon-{S}.png")
