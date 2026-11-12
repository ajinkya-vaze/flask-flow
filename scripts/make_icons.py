"""Draws the app icon (three glass flasks) and writes PNGs. Pure Python, no deps.

Run:  python3 scripts/make_icons.py
"""
import math
import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(__file__), "..", "icons")

def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))

TOP = hex_rgb("#3b2a8f")
BOTTOM = hex_rgb("#0e1330")
RED, BLUE, YELLOW, GREEN = (hex_rgb(c) for c in ("#ef3e4a", "#3557e8", "#ffd23b", "#2fb35a"))
CORK = hex_rgb("#c98a52")

# (center x, layers bottom->top, corked)
TUBES = [
    (0.28, [BLUE, RED, YELLOW], False),
    (0.50, [GREEN, GREEN, GREEN, GREEN], True),
    (0.72, [YELLOW, BLUE, RED], False),
]
W_T = 0.15        # flask width
Y_TOP = 0.24
Y_BOT = 0.82
EDGE = 0.014      # glass outline thickness
CAP = 4
LAYER_H = (Y_BOT - (Y_TOP + 0.08)) / CAP


def inside(x, y, cx, half, top, bot):
    r = half
    if y < top or y > bot:
        return False
    if y <= bot - r:
        return abs(x - cx) <= half
    return (x - cx) ** 2 + (y - (bot - r)) ** 2 <= r * r


def mix(a, b, t):
    return tuple(a[i] * (1 - t) + b[i] * t for i in range(3))


def sample(x, y):
    col = mix(TOP, BOTTOM, y)
    # soft glow behind the flasks
    d = math.hypot(x - 0.5, y - 0.55)
    col = mix(col, hex_rgb("#6a4cf0"), max(0.0, 0.35 - d) * 0.9)
    for cx, layers, corked in TUBES:
        half = W_T / 2
        # rim
        if Y_TOP - 0.018 <= y <= Y_TOP + 0.006 and abs(x - cx) <= half + 0.022:
            return mix(col, (1, 1, 1), 0.85)
        if corked and Y_TOP - 0.06 <= y < Y_TOP - 0.018 and abs(x - cx) <= half * 0.75:
            return CORK
        if inside(x, y, cx, half + EDGE, Y_TOP, Y_BOT + EDGE):
            if not inside(x, y, cx, half, Y_TOP, Y_BOT):
                return mix(col, (1, 1, 1), 0.85)
            inner = mix(col, (1, 1, 1), 0.10)
            level = int((Y_BOT - y) / LAYER_H)
            if 0 <= level < len(layers):
                inner = layers[level]
                # cylinder shading
                t = (x - (cx - half)) / (2 * half)
                inner = mix(inner, (0, 0, 0), 0.18 * abs(t - 0.38) * 2)
            # glass highlight
            if cx - half * 0.62 <= x <= cx - half * 0.36 and Y_TOP + 0.04 <= y <= Y_BOT - 0.08:
                inner = mix(inner, (1, 1, 1), 0.35)
            return inner
    return col


def render(size, ss=3):
    rows = []
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            acc = [0.0, 0.0, 0.0]
            for sy in range(ss):
                for sx in range(ss):
                    c = sample((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size)
                    acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]
            n = ss * ss
            row += bytes(max(0, min(255, round(v / n * 255))) for v in acc)
        rows.append(bytes(row))
    return b"".join(rows)


def write_png(path, size, raw):
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for size in (180, 192, 512):
        write_png(os.path.join(OUT, f"icon-{size}.png"), size, render(size, 3 if size < 512 else 2))
        print("wrote", size)
