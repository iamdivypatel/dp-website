"""Build the site's portrait images from the illustrated portrait.

usage: python3 tools/portrait.py photo.png mask.png public/assets/img photos
  photo.png  the illustration (its "transparent" checkerboard is drawn in, so it needs a mask)
  mask.png   from: swift tools/subject_mask.swift photo.png mask.png

Writes portrait-coder.webp (About, 960x1200) and avatar.webp (round crops) for the site, and
full-size copies to photos/: the transparent cut-out (used by the link-preview image), the
portrait, the avatar and a square headshot. Only the background, light and crop change; the
illustration itself is never altered. Pillow is the only requirement.
"""
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

photo_path, mask_path, web_dir, photo_dir = sys.argv[1:5]
web_dir, photo_dir = Path(web_dir), Path(photo_dir)
photo_dir.mkdir(parents=True, exist_ok=True)

src = Image.open(photo_path).convert('RGB')
mask = Image.open(mask_path).convert('L').resize(src.size)
S = src.width  # the illustration is square
NAVY_TOP, BG = (13, 18, 32), (10, 10, 15)
ACCENT, ACCENT_2 = (77, 141, 255), (124, 231, 255)


def clamp(v):
    return max(0, min(255, int(v)))


def clean_alpha():
    """Mask minus the light, colourless fringe the drawn checkerboard leaves along the edge."""
    alpha = mask.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.8))
    band = ImageChops.subtract(alpha, mask.filter(ImageFilter.MinFilter(29))).point([255 if v > 2 else 0 for v in range(256)])
    r, g, b = src.split()
    chroma = ImageChops.subtract(ImageChops.lighter(ImageChops.lighter(r, g), b), ImageChops.darker(ImageChops.darker(r, g), b))
    light = src.convert('L').point([clamp((v - 120) / 90 * 255) for v in range(256)])
    grey = chroma.point([clamp((40 - v) / 25 * 255) for v in range(256)])  # skin is saturated, so it is never touched
    fringe = ImageChops.multiply(ImageChops.multiply(light, grey), band)
    return ImageChops.multiply(alpha, ImageChops.invert(fringe)).filter(ImageFilter.GaussianBlur(0.6))


ALPHA = clean_alpha()


def background(w, h, head):
    """Dark navy with a blue glow behind the head and a faint blueprint grid, like the site."""
    bg = Image.new('RGB', (w, h))
    top = Image.new('RGB', (w, h), NAVY_TOP)
    ramp = Image.linear_gradient('L').resize((w, h))
    bg = Image.composite(Image.new('RGB', (w, h), BG), top, ramp)
    for center, radius, color, strength in ((head, 0.52 * w, ACCENT, 0.3), ((0.82 * w, 0.12 * h), 0.4 * w, ACCENT_2, 0.1)):
        glow = Image.new('L', (w, h), 0)
        ImageDraw.Draw(glow).ellipse((center[0] - radius, center[1] - radius, center[0] + radius, center[1] + radius), fill=int(255 * strength))
        bg = Image.composite(Image.new('RGB', (w, h), color), bg, glow.filter(ImageFilter.GaussianBlur(radius * 0.45)))
    grid = Image.new('L', (w, h), 0)
    draw, step = ImageDraw.Draw(grid), max(24, w // 20)
    for x in range(0, w, step):
        draw.line((x, 0, x, h), fill=14)
    for y in range(0, h, step):
        draw.line((0, y, w, y), fill=14)
    fade = Image.new('L', (w, h), 0)
    ImageDraw.Draw(fade).ellipse((head[0] - 0.7 * w, head[1] - 0.6 * w, head[0] + 0.7 * w, head[1] + 0.8 * w), fill=255)
    grid = ImageChops.multiply(grid, fade.filter(ImageFilter.GaussianBlur(w * 0.12)))
    return Image.composite(Image.new('RGB', (w, h), (255, 255, 255)), bg, grid)


def compose(w, h, scale, dx, dy):
    """The illustration at `scale`, placed at (dx, dy), lit from the top left with a cyan rim."""
    size = round(S * scale)
    subj, alpha = src.resize((size, size), Image.Resampling.LANCZOS), ALPHA.resize((size, size), Image.Resampling.LANCZOS)
    head = (dx + 0.5 * size, dy + 0.34 * size)
    canvas = background(w, h, head)
    layer = Image.new('L', (w, h), 0)
    layer.paste(alpha, (dx, dy))
    canvas.paste(subj, (dx, dy), alpha)
    # rim: the edge that faces the light, so the black hoodie never melts into the dark background
    shift = max(2, round(7 * scale))
    edge = ImageChops.subtract(layer, ImageChops.offset(layer, shift, shift)).filter(ImageFilter.GaussianBlur(3 * scale))
    canvas = Image.composite(Image.new('RGB', (w, h), ACCENT_2), canvas, edge.point([int(v * 0.55) for v in range(256)]))
    return canvas


def portrait(w):
    """4:5, shoulders bleeding off both sides, head in the upper third."""
    h = round(w * 5 / 4)
    scale = w * 1.08 / S
    size = round(S * scale)
    return compose(w, h, scale, (w - size) // 2, h - size)


def square():
    return compose(S, S, 1, 0, 0)


def avatar(px):
    """Round crop (the CSS draws the circle): the face centred, hair to chin."""
    side = round(S * 0.66)
    cx, cy = S // 2, round(S * 0.33)
    box = (cx - side // 2, max(0, cy - side // 2), cx + side // 2, max(0, cy - side // 2) + side)
    return square().crop(box).resize((px, px), Image.Resampling.LANCZOS)


portrait(960).save(web_dir / 'portrait-coder.webp', quality=86, method=6)
avatar(320).save(web_dir / 'avatar.webp', quality=88, method=6)

cutout = src.copy()
cutout.putalpha(ALPHA)
cutout.save(photo_dir / 'divya-patel-cutout.png', optimize=True)
portrait(1600).save(photo_dir / 'divya-patel-portrait.jpg', quality=92)
avatar(1024).save(photo_dir / 'divya-patel-avatar.jpg', quality=92)
square().save(photo_dir / 'divya-patel-headshot-square.jpg', quality=92)
print('web:', sorted(p.name for p in web_dir.glob('*.webp')))
print('photos:', sorted(p.name for p in photo_dir.glob('divya-patel-*')))
