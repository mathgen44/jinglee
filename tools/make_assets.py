"""Génère les icônes et le module js/media.js (petits médias embarqués en base64).

Usage : python tools/make_assets.py
Prérequis : Pillow ; ffmpeg pour régénérer assets/*.mp4 / *.mp3 (voir README).
"""
import base64
import os

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def icon(size, path, pad_ratio=0.0):
    img = Image.new("RGB", (size, size), "#0e1013")
    d = ImageDraw.Draw(img)
    m = size * (0.14 + pad_ratio)
    gap = size * 0.05
    cell = (size - 2 * m - gap) / 2
    colors = ["#2e86de", "#d64541", "#27ae60", "#f1c40f"]
    for i, c in enumerate(colors):
        x = m + (i % 2) * (cell + gap)
        y = m + (i // 2) * (cell + gap)
        d.rounded_rectangle([x, y, x + cell, y + cell], radius=cell * 0.18, fill=c)
    # Triangle « lecture » sur le premier pad.
    cx, cy = m + cell / 2, m + cell / 2
    r = cell * 0.24
    d.polygon([(cx - r * 0.7, cy - r), (cx - r * 0.7, cy + r), (cx + r, cy)], fill="#ffffff")
    img.save(path)


def main():
    icons = os.path.join(ROOT, "icons")
    os.makedirs(icons, exist_ok=True)
    icon(192, os.path.join(icons, "icon-192.png"))
    icon(512, os.path.join(icons, "icon-512.png"), pad_ratio=0.04)
    icon(180, os.path.join(icons, "apple-touch-icon.png"))

    def b64(name):
        with open(os.path.join(ROOT, "assets", name), "rb") as f:
            return base64.b64encode(f.read()).decode("ascii")

    js = (
        "// Fichier généré par tools/make_assets.py — ne pas modifier à la main.\n"
        "// Vidéo muette (anti-veille) et silence audio, embarqués pour fonctionner hors-ligne.\n"
        f"export const KEEPAWAKE_MP4 = 'data:video/mp4;base64,{b64('keepawake.mp4')}';\n"
        f"export const SILENCE_MP3 = 'data:audio/mpeg;base64,{b64('silence.mp3')}';\n"
    )
    with open(os.path.join(ROOT, "js", "media.js"), "w", encoding="utf-8", newline="\n") as f:
        f.write(js)


if __name__ == "__main__":
    main()
