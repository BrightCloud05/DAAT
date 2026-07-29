#!/usr/bin/env python3
"""Build the macOS/Windows icon set from a rendered master image.

Takes the design render (a full-bleed square image) and produces every size
the app ships, applying two things the render itself does not have:

  1. A real squircle mask with transparency outside it. macOS composites the
     icon over whatever is behind it — the Dock, Launchpad, a Finder list —
     so the corners must be transparent, not painted dark. A rectangular
     master lands in the Dock as a hard-edged black tile.

  2. Apple's safe area. The Dock sizes every icon by its full canvas, so an
     icon whose artwork reaches the canvas edge renders visibly larger than
     its neighbours. Apple's grid puts the body in 824 of 1024 (80.5%).

Small sizes get extra contrast, because photographic fold detail turns to
mush below about 64px — the render's own spec sheet says the same thing.

Usage:
    python3 scripts/build-app-icon.py assets/icon-source.png
    python3 scripts/build-app-icon.py assets/icon-source.png --inset 0.88

`--inset` shrinks the artwork inside the squircle (1.0 = fills it). Use it
when the rendered subject crowds the tile.
"""

import argparse
import os
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw, ImageEnhance, ImageFile

# The render is a photograph; a stray truncated byte should not stop a build.
ImageFile.LOAD_TRUNCATED_IMAGES = True

HERE = os.path.dirname(os.path.abspath(__file__))
DESKTOP = os.path.dirname(HERE)

# Apple's macOS icon grid: an 824x824 body centred in a 1024x1024 canvas.
BODY_RATIO = 824 / 1024
# Continuous-corner radius as a fraction of the body, matching the system shape.
CORNER_RATIO = 0.2237
# Below this, photographic detail stops resolving and needs a contrast lift.
SMALL_PX = 64
SUPERSAMPLE = 4


def squircle_mask(size: int, radius: int) -> Image.Image:
    """An antialiased rounded-square mask, drawn large and downsampled."""
    big = Image.new('L', (size * SUPERSAMPLE, size * SUPERSAMPLE), 0)
    ImageDraw.Draw(big).rounded_rectangle(
        [0, 0, size * SUPERSAMPLE - 1, size * SUPERSAMPLE - 1],
        radius=radius * SUPERSAMPLE,
        fill=255,
    )

    return big.resize((size, size), Image.LANCZOS)


def build(master: Image.Image, px: int, inset: float) -> Image.Image:
    """One icon at `px`, artwork masked into the safe-area squircle."""
    body = max(1, round(px * BODY_RATIO))
    art_px = max(1, round(body * inset))

    # Render the artwork larger than needed, then downsample once — resizing
    # a photo straight to 16px loses the tonal structure that carries the form.
    art = master.convert('RGBA').resize((art_px, art_px), Image.LANCZOS)

    if px <= SMALL_PX:
        # Folds dissolve at these sizes and the icon flattens into a pale
        # disc. Pushing contrast keeps a light and a shadowed plane distinct.
        art = ImageEnhance.Contrast(art).enhance(1.0 + (SMALL_PX - px) / SMALL_PX * 0.55)

    tile = Image.new('RGBA', (body, body), (0, 0, 0, 0))
    offset = (body - art_px) // 2
    tile.paste(art, (offset, offset))

    # Alpha-composite the mask so the corners are genuinely transparent
    # rather than filled with the ground colour.
    mask = squircle_mask(body, round(body * CORNER_RATIO))
    tile.putalpha(mask)

    canvas = Image.new('RGBA', (px, px), (0, 0, 0, 0))
    margin = (px - body) // 2
    canvas.paste(tile, (margin, margin), tile)

    return canvas


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', help='master render (square image)')
    parser.add_argument(
        '--inset',
        type=float,
        default=1.0,
        help='artwork size inside the squircle, 0.7-1.0 (default 1.0)',
    )
    args = parser.parse_args()

    master = Image.open(args.source)
    master.load()

    if master.width != master.height:
        print(f'! source is {master.width}x{master.height}, not square — cropping to centre square')
        side = min(master.size)
        left = (master.width - side) // 2
        top = (master.height - side) // 2
        master = master.crop((left, top, left + side, top + side))

    if master.mode != 'RGBA':
        print(f'  source has no alpha channel ({master.mode}); the squircle is applied here')

    assets = os.path.join(DESKTOP, 'assets')
    public = os.path.join(DESKTOP, 'public')

    primary = build(master, 1024, args.inset)
    primary.save(os.path.join(assets, 'icon.png'))
    primary.save(os.path.join(public, 'apple-touch-icon.png'))
    primary.save(os.path.join(public, 'hermes.png'))

    ico_sizes = (16, 32, 48, 64, 128, 256)
    frames = [build(master, px, args.inset) for px in ico_sizes]
    frames[-1].save(
        os.path.join(assets, 'icon.ico'),
        sizes=[(px, px) for px in ico_sizes],
        append_images=frames[:-1],
    )

    with tempfile.TemporaryDirectory() as tmp:
        iconset = os.path.join(tmp, 'daat.iconset')
        os.makedirs(iconset)

        for px in (16, 32, 64, 128, 256, 512, 1024):
            build(master, px, args.inset).save(os.path.join(iconset, f'icon_{px}x{px}.png'))

            if px <= 512:
                build(master, px * 2, args.inset).save(os.path.join(iconset, f'icon_{px}x{px}@2x.png'))

        subprocess.run(
            ['iconutil', '-c', 'icns', iconset, '-o', os.path.join(assets, 'icon.icns')],
            check=True,
        )

    print(f'generated at inset {args.inset:.2f}:')
    print('  assets/icon.png (1024), assets/icon.icns, assets/icon.ico')
    print('  public/apple-touch-icon.png, public/hermes.png')

    return 0


if __name__ == '__main__':
    sys.exit(main())
