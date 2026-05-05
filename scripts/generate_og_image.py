"""
generate_og_image.py — Generate interim 1200x630 social preview card for GoArrive.

Output: apps/goarrive/public/og-image.png

Design (interim — Morgan replaces with final brand asset):
  - Dark brand background (#0F1117) with a soft gold radial glow
  - Small GoArrive wordmark anchored top
  - Headline "A Coach in Your Pocket" set BIG so it reads at iMessage thumbnail scale
  - Top gold accent bar (brand signature)

Notes:
  - iMessage and SMS previews compress 1200x630 down to ~600px wide.
    The headline must read at a glance at that scale, so the tagline is
    sized as the dominant element (logo is the supporting mark).
  - The og:description and the URL are shown by iMessage *below* the
    image, so we don't repeat them on the card.
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

    # Small wordmark anchored top — the headline carries the card
    logo = Image.open(LOGO_PATH).convert('RGBA')
    target_w = 360
    ratio = target_w / logo.width
    target_h = int(logo.height * ratio)
    logo = logo.resize((target_w, target_h), Image.LANCZOS)
    lx = (W - target_w) // 2
    ly = 70
    img.paste(logo, (lx, ly), logo)

    # Hero headline — auto-fit to leave 80px margins, capped at 96px
    headline = 'A Coach in Your Pocket'
    max_text_w = W - 160
    headline_size = 96
    headline_font = ImageFont.truetype(FONT_GROTESK, headline_size)
    while draw.textlength(headline, font=headline_font) > max_text_w and headline_size > 60:
        headline_size -= 2
        headline_font = ImageFont.truetype(FONT_GROTESK, headline_size)
    hw = draw.textlength(headline, font=headline_font)
    headline_y = 300
    draw.text(((W - hw) // 2, headline_y), headline, font=headline_font, fill=TEXT)

    # Subhead — readable at thumbnail scale, supports the headline
    sub_font = ImageFont.truetype(FONT_DMSANS, 38)
    sub = 'Real coaching. Personalized for you.'
    sw = draw.textlength(sub, font=sub_font)
    draw.text(((W - sw) // 2, headline_y + headline_size + 40), sub, font=sub_font, fill=MUTED)

    img.save(OUT_PATH, 'PNG', optimize=True)
    print(f'[generate_og_image] Wrote {OUT_PATH} ({os.path.getsize(OUT_PATH)} bytes)')


if __name__ == '__main__':
    main()
