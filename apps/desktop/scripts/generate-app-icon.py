#!/usr/bin/env python3
"""Generate the BISEO app icon set from the design spec (BISEO App Icon.dc.html).

Construction — 512pt grid:
  - Squircle radius 115 (22.5%), ground #007AFF, white letterform
  - Stem 68 x 336 at (138, 88)
  - Bowls: true circles o168 with 40pt strokes at (206, 88) and (206, 256),
    stacked edge-to-edge so the counters stay open
  - Top light: single 16% white gradient over the top 46% - no bevel
  - Small sizes (<=32 px): stem widens to 78 at (138, 96) h320, strokes to 46,
    bowls at (216, 96)/(216, 256) o160 - counters survive rasterisation

Outputs: assets/icon.png (1024), assets/icon.icns, assets/icon.ico,
public/apple-touch-icon.png, public/hermes.png (runtime dock icon).

Run: python3 scripts/generate-app-icon.py   (requires Pillow; macOS iconutil)
"""

import os
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
DESKTOP = os.path.dirname(HERE)

BLUE = (0, 122, 255, 255)
WHITE = (255, 255, 255, 255)


def draw_icon(px: int, small: bool = False, light: bool = False) -> Image.Image:
    """Render the icon at px x px. Geometry is authored on the 512 grid and
    drawn at 4x supersampling, then downscaled for clean edges."""
    ss = 4
    size = px * ss
    scale = size / 512

    ground = WHITE if light else BLUE
    ink = BLUE if light else WHITE

    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    def s(v: float) -> float:
        return v * scale

    # Squircle ground (rounded-rect approximation, radius 115/512 = 22.5%).
    radius = s(115)
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=ground)

    # Letterform.
    if small:
        stem = (138, 96, 138 + 78, 96 + 320)
        bowls = [(216, 96, 216 + 160, 96 + 160), (216, 256, 216 + 160, 256 + 160)]
        stroke = 46
    else:
        stem = (138, 88, 138 + 68, 88 + 336)
        bowls = [(206, 88, 206 + 168, 88 + 168), (206, 256, 206 + 168, 256 + 168)]
        stroke = 40

    draw.rectangle([s(stem[0]), s(stem[1]), s(stem[2]), s(stem[3])], fill=ink)

    for bowl in bowls:
        draw.ellipse([s(bowl[0]), s(bowl[1]), s(bowl[2]), s(bowl[3])], outline=ink, width=round(s(stroke)))

    # Top light: white 16% -> 0 over the top 46%, clipped to the squircle.
    if not light:
        overlay = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        limit = int(size * 0.46)

        for y in range(limit):
            alpha = int(255 * 0.16 * (1 - y / limit))
            ImageDraw.Draw(overlay).line([(0, y), (size, y)], fill=(255, 255, 255, alpha))

        mask = Image.new('L', (size, size), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
        overlay.putalpha(Image.composite(overlay.getchannel('A'), Image.new('L', (size, size), 0), mask))
        img = Image.alpha_composite(img, overlay)

    return img.resize((px, px), Image.LANCZOS)


def main() -> None:
    assets = os.path.join(DESKTOP, 'assets')
    public = os.path.join(DESKTOP, 'public')

    primary_1024 = draw_icon(1024)
    primary_1024.save(os.path.join(assets, 'icon.png'))
    primary_1024.save(os.path.join(public, 'apple-touch-icon.png'))
    primary_1024.save(os.path.join(public, 'hermes.png'))

    # .ico — small sizes use the thickened variant.
    ico_frames = [draw_icon(px, small=px <= 32) for px in (16, 32, 48, 64, 128, 256)]
    ico_frames[-1].save(
        os.path.join(assets, 'icon.ico'),
        sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
        append_images=ico_frames[:-1]
    )

    # .icns via iconutil.
    with tempfile.TemporaryDirectory() as tmp:
        iconset = os.path.join(tmp, 'biseo.iconset')
        os.makedirs(iconset)

        for px in (16, 32, 64, 128, 256, 512, 1024):
            draw_icon(px, small=px <= 32).save(os.path.join(iconset, f'icon_{px}x{px}.png'))

            if px <= 512:
                draw_icon(px * 2, small=px * 2 <= 32).save(os.path.join(iconset, f'icon_{px}x{px}@2x.png'))

        subprocess.run(['iconutil', '-c', 'icns', iconset, '-o', os.path.join(assets, 'icon.icns')], check=True)

    print('generated: assets/icon.{png,ico,icns}, public/apple-touch-icon.png, public/hermes.png')


if __name__ == '__main__':
    sys.exit(main())
