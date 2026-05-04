"""
generate_og_image.py — Generate interim 1200x630 social preview card for GoArrive.

Output: apps/goarrive/public/og-image.png

Design (interim — Morgan replaces with final brand asset):
  - Dark brand background (#0F1117) with a soft gold radial glow
  - GoArrive wordmark centered (uses public/goarrive-logo.png)
  - Tagline below in Space Grotesk Bold
  - Gold accent underline sweep (brand signature)
  - Small site-language footer line
"""
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC = os.path.join(ROOT, 'apps', 'goarrive', 'public')
LOGO_PATH = os.path.join(PUBLIC, 'goarrive-logo.png')
OUT_PATH = os.path.join(PUBLIC, 'og-image.png')

FONT_GROTESK = '/tmp/og-fonts/SpaceGrotesk.ttf'
FONT_DMSANS = '/tmp/og-fonts/DMSans.ttf'

W, H = 1200, 630
BG = (15, 17, 23)        # #0F1117
GOLD = (245, 166, 35)    # #F5A623
TEXT = (232, 234, 240)   # #E8EAF0
MUTED = (155, 163, 184)  # #9BA3B8


def make_glow():
    """Soft gold radial glow upper-right for visual depth."""
    glow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    g = ImageDraw.Draw(glow)
    cx, cy, r = int(W * 0.78), int(H * 0.18), 380
    for i in range(28, 0, -1):
        alpha = int(8 * (i / 28))
        g.ellipse((cx - r * i // 28, cy - r * i // 28, cx + r * i // 28, cy + r * i // 28),
                  fill=(245, 166, 35, alpha))
    return glow.filter(ImageFilter.GaussianBlur(60))


def main():
    img = Image.new('RGB', (W, H), BG)

    # Soft gold glow
    glow = make_glow()
    img.paste(glow, (0, 0), glow)

    # Top + bottom border accents
    draw = ImageDraw.Draw(img)
    draw.rectangle((0, 0, W, 4), fill=GOLD)

    # Logo (wordmark — already includes its own gold underline sweep)
    logo = Image.open(LOGO_PATH).convert('RGBA')
    target_w = 720
    ratio = target_w / logo.width
    target_h = int(logo.height * ratio)
    logo = logo.resize((target_w, target_h), Image.LANCZOS)
    lx = (W - target_w) // 2
    ly = 150
    img.paste(logo, (lx, ly), logo)

    # Tagline (site hero language — member-facing)
    tagline_font = ImageFont.truetype(FONT_GROTESK, 54)
    tagline = 'A Coach in Your Pocket'
    tw = draw.textlength(tagline, font=tagline_font)
    tagline_y = ly + target_h + 60
    draw.text(((W - tw) // 2, tagline_y), tagline, font=tagline_font, fill=TEXT)

    # Sub-line (site hero sub)
    sub_font = ImageFont.truetype(FONT_DMSANS, 22)
    sub = 'Real coaching. Personalized for you. Delivered through your phone.'
    sw = draw.textlength(sub, font=sub_font)
    draw.text(((W - sw) // 2, tagline_y + 78), sub, font=sub_font, fill=MUTED)

    # Footer URL
    url_font = ImageFont.truetype(FONT_DMSANS, 20)
    url = 'goarrive.fit'
    uw = draw.textlength(url, font=url_font)
    draw.text(((W - uw) // 2, H - 60), url, font=url_font, fill=GOLD)

    img.save(OUT_PATH, 'PNG', optimize=True)
    print(f'[generate_og_image] Wrote {OUT_PATH} ({os.path.getsize(OUT_PATH)} bytes)')


if __name__ == '__main__':
    main()
