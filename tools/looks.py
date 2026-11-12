"""Professional portrait looks for the portfolio, built from one photo + its cut-out mask.

The face itself is never altered: only background, light, colour grade, crop and the
screen reflection in the glasses change.

usage:
  swift tools/subject_mask.swift photo.png mask.png          # on-device cut-out (macOS)
  python3 tools/looks.py photo.png mask.png public/assets/img photos

Looks: coder (default), studio, mono, duotone, natural. Also writes the round avatar,
switcher thumbnails, a square headshot and transparent cut-outs.
"""
import os
import sys

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps

photo_path, mask_path, web_dir, full_dir = sys.argv[1:5]
HERE = os.path.dirname(os.path.abspath(__file__))
MONO = os.path.join(HERE, 'fonts', 'JetBrainsMono.ttf')

photo = Image.open(photo_path).convert('RGB')
mask = Image.open(mask_path).convert('L').resize(photo.size)
W, H = photo.size
mask_soft = mask.filter(ImageFilter.GaussianBlur(1.1))
# The photo was shot on white: its outermost edge pixels carry a white fringe that glows on dark
# backgrounds. Dark looks use a mask pulled in by ~4 px and feathered, which drops that fringe.
mask_core = mask.filter(ImageFilter.MinFilter(9)).filter(ImageFilter.GaussianBlur(1.8))
LANCZOS = Image.Resampling.LANCZOS
BICUBIC = Image.Resampling.BICUBIC

# ---------- geometry from the mask: head top and face centre ----------
px = mask.load()
head_top = next(y for y in range(H) if sum(1 for x in range(0, W, 4) if px[x, y] > 128) > 3)
spans = []
for y in range(head_top + int(0.05 * H), head_top + int(0.15 * H), 8):
    xs = [x for x in range(0, W, 2) if px[x, y] > 128]
    if xs:
        spans.append((min(xs) + max(xs)) / 2)
cx = int(sum(spans) / len(spans))
crop_w = int(0.71 * W)
CROP_45 = (max(0, cx - crop_w // 2), head_top - int(0.065 * H), 0, 0)
CROP_45 = (CROP_45[0], max(0, CROP_45[1]), CROP_45[0] + crop_w, max(0, CROP_45[1]) + int(crop_w * 1.25))
av = int(0.54 * W)
av_cy = head_top + int(0.156 * H)
AVATAR = (cx - av // 2, av_cy - av // 2, cx + av // 2, av_cy + av // 2)
HEADSHOT = (cx - int(0.6 * W) // 2, head_top - int(0.06 * H), cx + int(0.6 * W) // 2, head_top - int(0.06 * H) + int(0.6 * W))


def hexrgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def solid(color, size=(W, H)):
    return Image.new('RGB', size, hexrgb(color) if isinstance(color, str) else color)


def scale_alpha(alpha, k):
    return alpha.point(lambda v: int(v * k))


def vertical_gradient(top, bottom, size=(W, H)):
    return Image.composite(solid(bottom, size), solid(top, size), Image.linear_gradient('L').resize(size))


def add_glow(base, center, radius, color, strength):
    g = ImageOps.invert(Image.radial_gradient('L')).resize((radius * 2, radius * 2), BICUBIC)
    alpha = Image.new('L', base.size, 0)
    alpha.paste(g, (center[0] - radius, center[1] - radius))
    return Image.composite(solid(color, base.size), base, scale_alpha(alpha, strength))


def vignette(base, strength=0.55):
    w, h = base.size
    g = Image.radial_gradient('L').resize((int(w * 1.5), int(h * 1.5)), BICUBIC)
    alpha = Image.new('L', base.size, 0)
    alpha.paste(g, (-int(w * 0.25), -int(h * 0.25)))
    return Image.composite(solid('#000000', base.size), base, scale_alpha(alpha, strength))


def halo(base, color, strength, blur=48):
    return Image.composite(solid(color, base.size), base, scale_alpha(mask.filter(ImageFilter.GaussianBlur(blur)), strength))


def rim(base, color, strength, dx=11, dy=7):
    """Edge light from one side, only inside the silhouette (dx<0 lights the right edge)."""
    shifted = ImageChops.offset(mask_core, dx, dy)
    edge = ImageChops.subtract(mask_core, shifted).filter(ImageFilter.GaussianBlur(5))
    return Image.composite(ImageChops.screen(base, solid(color, base.size)), base, scale_alpha(edge, strength))


def bottom_fade(base, color, start=0.84):
    w, h = base.size
    alpha = Image.new('L', base.size, 0)
    d = ImageDraw.Draw(alpha)
    y0 = int(h * start)
    for y in range(y0, h):
        d.line([(0, y), (w, y)], fill=int(255 * ((y - y0) / (h - y0)) ** 1.4))
    return Image.composite(solid(color, base.size), base, alpha)


def grain(base, amount):
    return Image.blend(base, ImageChops.overlay(base, Image.effect_noise(base.size, 28).convert('RGB')), amount)


def graded_subject():
    s = ImageEnhance.Contrast(photo).enhance(1.05)
    s = ImageEnhance.Color(s).enhance(1.03)
    s = s.filter(ImageFilter.UnsharpMask(radius=28, percent=14, threshold=0))
    return s.filter(ImageFilter.UnsharpMask(radius=1.2, percent=55, threshold=2))


subject = graded_subject()


def place(bg, subj, m=None):
    return Image.composite(subj, bg, m or mask_core)


# ---------- the coder look ----------
SYNTAX = {'kw': '#c586c0', 'fn': '#dcdcaa', 'ty': '#4ec9b0', 'str': '#ce9178', 'var': '#9cdcfe',
          'num': '#b5cea8', 'com': '#6a9955', 'txt': '#d4d4d4', 'op': '#8b949e'}
CODE_TS = [
    [('com', '// core-api/src/handlers/outfits.ts')],
    [('kw', 'import '), ('txt', '{ z } '), ('kw', 'from '), ('str', "'zod'"), ('op', ';')],
    [('kw', 'import '), ('txt', '{ cache } '), ('kw', 'from '), ('str', "'../lib/cache'"), ('op', ';')],
    [],
    [('kw', 'export const '), ('fn', 'getOutfits'), ('op', ' = '), ('fn', 'handler'), ('op', '('), ('kw', 'async '), ('op', '('), ('var', 'req'), ('op', ') => {')],
    [('kw', '  const '), ('op', '{ '), ('var', 'userId'), ('op', ' } = '), ('fn', 'auth'), ('op', '('), ('var', 'req'), ('op', ');')],
    [('kw', '  const '), ('var', 'key'), ('op', ' = '), ('str', '`outfits:${userId}`'), ('op', ';')],
    [('kw', '  const '), ('var', 'hit'), ('op', ' = '), ('kw', 'await '), ('var', 'cache'), ('op', '.'), ('fn', 'get'), ('op', '('), ('var', 'key'), ('op', ');')],
    [('kw', '  if '), ('op', '('), ('var', 'hit'), ('op', ') '), ('kw', 'return '), ('fn', 'ok'), ('op', '('), ('var', 'hit'), ('op', ');')],
    [('kw', '  const '), ('var', 'rows'), ('op', ' = '), ('kw', 'await '), ('ty', 'Outfit'), ('op', '.'), ('fn', 'findAll'), ('op', '({ '), ('var', 'where'), ('op', ': { '), ('var', 'userId'), ('op', ' } });')],
    [('kw', '  await '), ('var', 'cache'), ('op', '.'), ('fn', 'set'), ('op', '('), ('var', 'key'), ('op', ', '), ('var', 'rows'), ('op', ', { '), ('var', 'ttl'), ('op', ': '), ('num', '300'), ('op', ' });')],
    [('kw', '  return '), ('fn', 'ok'), ('op', '('), ('var', 'rows'), ('op', ');')],
    [('op', '});')],
]
CODE_TF = [
    [('kw', 'resource '), ('str', '"aws_lambda_function" "api"'), ('op', ' {')],
    [('var', '  function_name'), ('op', ' = '), ('str', '"core-api"')],
    [('var', '  runtime'), ('op', '       = '), ('str', '"nodejs22.x"')],
    [('var', '  memory_size'), ('op', '   = '), ('num', '1024')],
    [('var', '  timeout'), ('op', '       = '), ('num', '29')],
    [],
    [('var', '  vpc_config'), ('op', ' {')],
    [('var', '    subnet_ids'), ('op', ' = '), ('var', 'module.vpc.private_subnets')],
    [('op', '  }')],
    [('op', '}')],
]


def editor(lines, size, font_px, title):
    """A dark code-editor window with line numbers and syntax colours."""
    w, h = size
    img = Image.new('RGBA', size, (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, w - 1, h - 1], radius=18, fill=(13, 16, 24, 235), outline=(40, 48, 66, 255), width=2)
    d.rounded_rectangle([0, 0, w - 1, 44], radius=18, fill=(20, 24, 34, 255))
    d.rectangle([0, 26, w - 1, 44], fill=(20, 24, 34, 255))
    for i, c in enumerate(['#ff5f57', '#febc2e', '#28c840']):
        d.ellipse([18 + i * 22, 15, 32 + i * 22, 29], fill=hexrgb(c))
    font = ImageFont.truetype(MONO, font_px)
    small = ImageFont.truetype(MONO, int(font_px * 0.8))
    d.text((90, 12), title, font=small, fill=(139, 148, 158))
    y = 64
    for n, line in enumerate(lines, 1):
        d.text((18, y), f'{n:>2}', font=font, fill=(72, 80, 98))
        x = 70
        for kind, text in line:
            d.text((x, y), text, font=font, fill=hexrgb(SYNTAX[kind]))
            x += d.textlength(text, font=font)
        y += int(font_px * 1.55)
    return img


def lens_reflection(base, quad, angle):
    """Faint code lines reflected in one lens, kept below the eyes."""
    xs = [p[0] for p in quad]
    ys = [p[1] for p in quad]
    box = (min(xs), min(ys), max(xs), max(ys))
    bw, bh = box[2] - box[0], box[3] - box[1]
    layer = Image.new('RGB', (bw * 2, bh * 2), (0, 0, 0))
    d = ImageDraw.Draw(layer)
    colors = [SYNTAX[k] for k in ('var', 'fn', 'kw', 'str', 'ty', 'txt')]
    y = 6
    i = 0
    while y < bh * 2:
        x = 6 + (i % 3) * 10
        for seg in range(1 + i % 3):
            length = 18 + (i * 37 + seg * 23) % 70
            d.rectangle([x, y, x + length, y + 4], fill=hexrgb(colors[(i + seg) % len(colors)]))
            x += length + 10
        y += 11
        i += 1
    layer = layer.rotate(angle, resample=BICUBIC).resize((bw, bh), LANCZOS).filter(ImageFilter.GaussianBlur(0.8))
    full = Image.new('RGB', base.size, (0, 0, 0))
    full.paste(layer, box[:2])
    lens = Image.new('L', base.size, 0)
    ImageDraw.Draw(lens).polygon(quad, fill=255)
    lens = lens.filter(ImageFilter.GaussianBlur(4))
    # fade in from the eye line downward so the eyes stay clear
    fade = Image.new('L', base.size, 0)
    fd = ImageDraw.Draw(fade)
    y0 = box[1] + int(bh * 0.42)
    for yy in range(y0, box[3]):
        fd.line([(box[0], yy), (box[2], yy)], fill=min(255, int(255 * (yy - y0) / max(1, bh * 0.3))))
    alpha = ImageChops.multiply(lens, fade)
    return Image.composite(ImageChops.screen(base, full), base, scale_alpha(alpha, 0.42))


def coder():
    bg = solid('#06070c')
    bg = add_glow(bg, (int(W * 0.18), int(H * 0.95)), int(W * 0.75), '#0d4f7a', 0.55)
    bg = add_glow(bg, (int(W * 0.85), int(H * 0.3)), int(W * 0.5), '#1b2a6b', 0.45)
    big = editor(CODE_TS, (int(W * 0.95), int(H * 0.36)), 24, 'outfits.ts — core-api')
    big = big.filter(ImageFilter.GaussianBlur(4.5))
    bg.paste(big, (int(-W * 0.18), head_top - int(0.11 * H)), big)
    side = editor(CODE_TF, (int(W * 0.62), int(H * 0.22)), 22, 'lambda.tf — infra')
    side = side.filter(ImageFilter.GaussianBlur(3))
    bg.paste(side, (int(W * 0.58), head_top + int(0.21 * H)), side)
    bg = vignette(bg, 0.55)
    bg = halo(bg, '#4d8dff', 0.28, blur=60)
    # monitor light: cool from the viewer's left, a warm kicker from the right
    lit = ImageChops.screen(subject, Image.composite(solid('#123a66'), solid('#000000'), Image.linear_gradient('L').rotate(90).resize((W, H))))
    lit = ImageEnhance.Contrast(lit).enhance(1.05)
    img = place(bg, lit)
    img = rim(img, '#7ce7ff', 0.34, dx=12, dy=4)
    img = rim(img, '#ffb46b', 0.14, dx=-10, dy=4)
    for quad, angle in LENSES:
        img = lens_reflection(img, quad, angle)
    return grain(img, 0.05)


# Lens outlines (inner edge of the frames) for this photo, in source pixels.
LENSES = [
    ([(520, 790), (672, 810), (660, 912), (527, 905)], -7),
    ([(747, 815), (922, 830), (907, 935), (760, 932)], -5),
]


# ---------- the other looks ----------
def studio():
    bg = solid('#0a0a0f')
    bg = add_glow(bg, (cx, head_top + int(0.2 * H)), int(0.5 * W), '#1d3d86', 0.9)
    bg = add_glow(bg, (int(W * 0.82), int(H * 0.9)), int(0.42 * W), '#0d5a6e', 0.35)
    bg = vignette(bg, 0.5)
    bg = halo(bg, '#4d8dff', 0.32)
    img = rim(place(bg, subject), '#7ce7ff', 0.32)
    return grain(img, 0.05)


def mono():
    g = ImageEnhance.Contrast(ImageOps.autocontrast(ImageOps.grayscale(subject), cutoff=0.4)).enhance(1.12).convert('RGB')
    bg = vertical_gradient('#26272c', '#060607')
    bg = add_glow(bg, (cx, head_top + int(0.2 * H)), int(0.46 * W), '#4a4b52', 0.65)
    bg = halo(vignette(bg, 0.45), '#ffffff', 0.08)
    return grain(rim(place(bg, g), '#ffffff', 0.24), 0.09)


def duotone():
    g = ImageOps.autocontrast(ImageOps.grayscale(subject), cutoff=0.5)
    tone = Image.blend(ImageOps.colorize(g, black='#070c20', mid='#4673c8', white='#e2f8ff', midpoint=118), subject, 0.22)
    bg = vertical_gradient('#0d1433', '#04050b')
    bg = halo(add_glow(bg, (cx, head_top + int(0.2 * H)), int(0.48 * W), '#2348b8', 0.75), '#7ce7ff', 0.3)
    img = rim(place(bg, tone), '#7ce7ff', 0.34)
    lines = Image.new('L', img.size, 0)
    d = ImageDraw.Draw(lines)
    for y in range(0, H, 5):
        d.line([(0, y), (W, y)], fill=28)
    return grain(Image.composite(solid('#000000'), img, lines), 0.05)


def natural():
    bg = vertical_gradient('#f3f5f8', '#d3d9e2')
    bg = add_glow(bg, (cx, head_top + int(0.2 * H)), int(0.44 * W), '#ffffff', 0.75)
    shadow = ImageChops.offset(mask, 16, 22).filter(ImageFilter.GaussianBlur(28))
    bg = Image.composite(solid('#1a2333'), bg, scale_alpha(shadow, 0.22))
    return grain(place(bg, subject, mask_soft), 0.025)  # light backdrop hides the fringe


looks = {'coder': coder(), 'studio': studio(), 'mono': mono(), 'duotone': duotone(), 'natural': natural()}
FADE_TO = {'coder': '#06070c', 'studio': '#0a0a0f', 'mono': '#060607', 'duotone': '#04050b'}
for name, img in looks.items():
    full = img.crop(CROP_45)
    if name in FADE_TO:
        full = bottom_fade(full, FADE_TO[name])
    full.save(f'{full_dir}/divya-patel-{name}.jpg', quality=92, optimize=True, progressive=True)
    if name == 'coder':  # the site uses the coder look; the others stay in photos/ for your own use
        full.resize((960, 1200), LANCZOS).save(f'{web_dir}/portrait-{name}.webp', quality=80, method=6)
    print(name, 'ok')

looks['natural'].crop(HEADSHOT).save(f'{full_dir}/divya-patel-headshot-square.jpg', quality=92, optimize=True)
avatar = looks['coder'].crop(AVATAR)
avatar.resize((320, 320), LANCZOS).save(f'{web_dir}/avatar.webp', quality=82, method=6)
avatar.save(f'{full_dir}/divya-patel-avatar.jpg', quality=92)

# Transparent cut-outs (natural, and studio-lit for the link preview).
box = mask.point(lambda v: 255 if v > 8 else 0).getbbox()
box = (max(0, box[0] - 40), max(0, box[1] - 40), min(W, box[2] + 40), H)
for name, src in (('cutout', subject), ('cutout-studio', rim(subject, '#7ce7ff', 0.32))):
    cut = src.convert('RGBA')
    cut.putalpha(mask_core)
    cut.crop(box).save(f'{full_dir}/divya-patel-{name}.png', optimize=True)
print('avatar, headshot, cut-outs ok; crop', CROP_45, 'avatar', AVATAR)
