"""Draw the app icon and write assets/icon.ico (multi-size) and assets/icon.png.

    python scripts/make_icon.py

Design: blue rounded tile, a faint fault waveform (a sine wave that swells
the way fault current does), and a white lightning bolt for the trip.
Small sizes drop the waveform so the bolt stays crisp.
"""
import math
import os

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets")
S = 1024  # draw large, then downsample


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def tile(size, detail=True):
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    pad = int(S * 0.04)
    radius = int(S * 0.22)

    # diagonal gradient background
    top, bottom = (16, 72, 168), (34, 150, 243)
    grad = Image.new("RGBA", (S, S))
    gp = grad.load()
    for y in range(S):
        for x in range(0, S, 4):
            c = lerp(top, bottom, (x * 0.35 + y * 0.65) / S)
            for dx in range(4):
                gp[x + dx, y] = c + (255,)
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([pad, pad, S - pad, S - pad], radius, fill=255)
    img.paste(grad, (0, 0), mask)

    d = ImageDraw.Draw(img)
    # soft top highlight
    hl = Image.new("L", (S, S), 0)
    ImageDraw.Draw(hl).rounded_rectangle([pad, pad, S - pad, int(S * 0.50)], radius, fill=34)
    hl = hl.filter(ImageFilter.GaussianBlur(S * 0.05))
    img.paste(Image.new("RGBA", (S, S), (255, 255, 255, 255)), (0, 0),
              Image.composite(hl, Image.new("L", (S, S), 0), mask))

    if detail:
        # fault waveform: small prefault sine, large fault sine, then cleared (flat)
        pts = []
        x0, x1 = int(S * 0.12), int(S * 0.88)
        mid = int(S * 0.56)
        for i in range(400):
            t = i / 399
            x = x0 + (x1 - x0) * t
            if t < 0.32:
                amp = 0.05
            elif t < 0.80:
                amp = 0.05 + 0.20 * min(1, (t - 0.32) / 0.06)
            else:
                amp = 0.25 * max(0, 1 - (t - 0.80) / 0.05)
            y = mid - math.sin(t * 2 * math.pi * 5.0) * amp * S
            pts.append((x, y))
        wave = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        ImageDraw.Draw(wave).line(pts, fill=(170, 220, 255, 150), width=int(S * 0.028), joint="curve")
        img.alpha_composite(Image.composite(wave, Image.new("RGBA", (S, S)), mask))

    # lightning bolt
    bolt = [(0.585, 0.14), (0.30, 0.56), (0.475, 0.56), (0.405, 0.88), (0.72, 0.43), (0.535, 0.43)]
    k = 1.0 if detail else 1.16  # bigger bolt when the icon is tiny
    bolt = [((0.5 + (x - 0.51) * k) * S, (0.5 + (y - 0.51) * k) * S) for x, y in bolt]
    shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).polygon([(x + S * 0.012, y + S * 0.02) for x, y in bolt], fill=(5, 30, 80, 140))
    img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(S * 0.018)))
    d = ImageDraw.Draw(img)
    d.polygon(bolt, fill=(255, 255, 255, 255))
    d.line(bolt + [bolt[0]], fill=(255, 255, 255, 255), width=int(S * 0.012), joint="curve")

    return img.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)
    sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
    frames = {s: tile(s, detail=s >= 40) for s in sizes}
    frames[256].save(os.path.join(OUT, "icon.ico"), format="ICO",
                     sizes=[(s, s) for s in sizes], append_images=[frames[s] for s in sizes if s != 256])
    tile(512).save(os.path.join(OUT, "icon.png"))
    tile(128).save(os.path.join(OUT, "icon-128.png"), optimize=True)   # embedded in the browser version
    print("wrote", os.path.join(OUT, "icon.ico"), "icon.png and icon-128.png")


if __name__ == "__main__":
    main()
