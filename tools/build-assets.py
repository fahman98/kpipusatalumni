#!/usr/bin/env python3
"""
Jana semula aset imej web daripada logo resolusi penuh dalam images/source/.

    pip install Pillow
    python3 tools/build-assets.py

Kenapa ada skrip ini
--------------------
Logo asal UPSI (2083x982) dan Pusat Alumni (1418x389) terlalu besar untuk
dihantar ke browser; header hanya memaparkannya setinggi 56px. Skrip ini
mengecilkan logo tersebut ke saiz paparan sebenar (3x untuk skrin high-DPI),
dan menjana ikon PWA serta kad pratonton OG daripada sumber yang sama.

Semua fail yang dijana DIKOMIT ke dalam repo, tiada langkah build semasa
deploy. Jalankan skrip ini hanya bila logo sumber atau reka bentuk berubah.

Output (semuanya dalam images/):
    logo-1.png            logo UPSI untuk header
    logo-2.png            logo Pusat Alumni untuk header
    icon-192.png          ikon PWA (manifest)
    icon-512.png          ikon PWA + splash screen (manifest)
    apple-touch-icon.png  ikon skrin utama iOS
    favicon-64.png        favicon lalai sebelum JS melukis versi peratusan
    og-preview.png        pratonton pautan WhatsApp / Facebook / Telegram
"""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'images' / 'source'
OUT = ROOT / 'images'

# Warna jenama, kekal selari dengan style.css dan manifest.json
NAVY = (13, 71, 161)        # #0d47a1, theme_color
NAVY_DEEP = (8, 42, 105)
INK = (23, 37, 64)
MUTED = (95, 108, 130)
PANEL = (247, 250, 255)     # sama dengan kotak ringkasan dalam laporan PDF
GOOD = (67, 160, 71)        # --color-status-good
OK = (245, 158, 11)         # --color-status-ok
BAD = (229, 57, 53)         # --color-status-bad

SITE = 'kpipusatalumni.vercel.app'

# Font yang dibundel bersama-sama skrip supaya hasilnya boleh diulang.
FONT_DIR = Path('/mnt/skills/examples/canvas-design/canvas-fonts')


def font(name, size):
    return ImageFont.truetype(str(FONT_DIR / name), size)


def fit_height(im, h):
    """Ubah saiz mengikut ketinggian, kekalkan nisbah aspek."""
    return im.resize((round(im.width * h / im.height), h), Image.LANCZOS)


def save(im, name, colors=None):
    """Simpan PNG, dengan kuantisasi palet pilihan untuk mengecilkan saiz."""
    path = OUT / name
    if colors:
        im = im.quantize(colors=colors, method=Image.FASTOCTREE)
    im.save(path, optimize=True)
    print(f'  {name:<22} {path.stat().st_size / 1024:6.1f} KB')


logo_upsi = Image.open(SRC / 'logo-upsi.png').convert('RGBA')
logo_alumni = Image.open(SRC / 'logo-pusat-alumni.png').convert('RGBA')

# Lambang bulat UPSI menduduki petak kiri logo penuh, asas untuk ikon app.
CREST_BOX = (0, 0, 832, 832)
crest = logo_upsi.crop(CREST_BOX)


def app_icon(size):
    """
    Ikon 'any maskable': Android boleh memotongnya jadi bulat, bulat-segi
    empat atau titisan air, jadi semua kandungan mesti berada dalam 80%
    tengah kanvas. Cakera putih di sini berdiameter 78%.
    """
    img = Image.new('RGBA', (size, size), NAVY + (255,))
    d = ImageDraw.Draw(img)
    for y in range(size):                      # kecerunan jenama menegak
        t = y / size
        d.line([(0, y), (size, y)],
               fill=tuple(int(NAVY[i] + (NAVY_DEEP[i] - NAVY[i]) * t) for i in range(3)) + (255,))
    disc = int(size * 0.78)
    off = (size - disc) // 2
    d.ellipse([off, off, off + disc, off + disc], fill=(255, 255, 255, 255))
    cs = int(disc * 0.86)
    img.alpha_composite(crest.resize((cs, cs), Image.LANCZOS), ((size - cs) // 2,) * 2)
    return img


def og_card():
    """Kad 1200x630 untuk pratonton pautan WhatsApp / Facebook / Telegram."""
    W, H = 1200, 630
    img = Image.new('RGB', (W, H), PANEL)
    d = ImageDraw.Draw(img)

    d.rectangle([0, 0, W, 14], fill=NAVY)                     # jalur jenama atas

    la = fit_height(logo_alumni, 152)
    img.paste(la, ((W - la.width) // 2, 70), la)

    f_title = font('Outfit-Bold.ttf', 82)
    f_sub = font('Outfit-Regular.ttf', 33)
    f_chip = font('Outfit-Bold.ttf', 27)
    f_meta = font('Outfit-Bold.ttf', 26)

    def centre(text, y, f, fill):
        bb = d.textbbox((0, 0), text, font=f)
        d.text(((W - (bb[2] - bb[0])) // 2 - bb[0], y), text, font=f, fill=fill)

    centre('Dashboard KPI', 268, f_title, NAVY)
    d.rectangle([(W - 132) // 2, 372, (W + 132) // 2, 375], fill=NAVY)
    centre('Pemantauan prestasi suku tahunan Pusat Alumni UPSI', 404, f_sub, MUTED)

    # Legenda status: istilah yang sama digunakan dalam dashboard sendiri
    chips = [(GOOD, 'Cemerlang'), (OK, 'Sederhana'), (BAD, 'Perlu Perhatian')]
    gap, dot, pad = 44, 20, 13
    widths = [dot + pad + d.textbbox((0, 0), t, font=f_chip)[2] for _, t in chips]
    x = (W - (sum(widths) + gap * (len(chips) - 1))) // 2
    cy = 480
    for (colour, label), wdt in zip(chips, widths):
        d.ellipse([x, cy, x + dot, cy + dot], fill=colour)
        d.text((x + dot + pad, cy - 5), label, font=f_chip, fill=INK)
        x += wdt + gap

    d.rectangle([0, H - 72, W, H], fill=NAVY)                 # jalur URL bawah
    bb = d.textbbox((0, 0), SITE, font=f_meta)
    d.text(((W - (bb[2] - bb[0])) // 2 - bb[0],
            H - 72 + (72 - (bb[3] - bb[1])) // 2 - bb[1]), SITE, font=f_meta, fill=(255, 255, 255))
    return img


def main():
    if not FONT_DIR.is_dir():
        sys.exit(f'Direktori font tidak dijumpai: {FONT_DIR}\n'
                 'Kemas kini FONT_DIR ke lokasi Outfit-Bold.ttf / Outfit-Regular.ttf.')

    print('Header logos:')
    # Header memaparkan kedua-dua logo pada h-14 (56px CSS). 168px = 3x untuk
    # skrin high-DPI; apa-apa lebih daripada itu hanyalah bait yang terbuang.
    save(fit_height(logo_upsi, 168), 'logo-1.png', colors=192)
    save(fit_height(logo_alumni, 168), 'logo-2.png', colors=192)

    print('App icons:')
    save(app_icon(192), 'icon-192.png', colors=128)
    save(app_icon(512), 'icon-512.png', colors=128)
    save(app_icon(180), 'apple-touch-icon.png', colors=128)
    save(app_icon(64), 'favicon-64.png', colors=128)

    print('Social preview:')
    save(og_card(), 'og-preview.png')


if __name__ == '__main__':
    main()
