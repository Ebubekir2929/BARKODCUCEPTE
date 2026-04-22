"""
Generate Barkodcu Cepte branding assets:
  - icon.png           (1024x1024)  – App launcher icon (iOS & Android)
  - adaptive-icon.png  (1024x1024)  – Android adaptive icon foreground
  - splash-image.png   (2048x2048)  – Splash screen logo
  - favicon.png         (196x196)   – Web favicon

Design: Barcode + shopping cart, brand blue (#2563EB).
"""
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend", "assets", "images")
BRAND_BLUE = (37, 99, 235)       # #2563EB
BRAND_BLUE_DARK = (29, 78, 216)  # #1D4ED8
WHITE = (255, 255, 255)
BLACK = (15, 23, 42)  # slate-900

os.makedirs(OUT_DIR, exist_ok=True)


def _find_font(size):
    # Try a few common system fonts
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
    ]
    for c in candidates:
        if os.path.exists(c):
            try:
                return ImageFont.truetype(c, size)
            except Exception:
                continue
    return ImageFont.load_default()


def _draw_gradient(img: Image.Image, top_color, bottom_color):
    """Vertical gradient background."""
    W, H = img.size
    top = Image.new("RGB", (1, H), top_color)
    # Build the gradient by blending rows
    grad = Image.new("RGB", (1, H))
    px = grad.load()
    for y in range(H):
        t = y / max(1, H - 1)
        r = int(top_color[0] * (1 - t) + bottom_color[0] * t)
        g = int(top_color[1] * (1 - t) + bottom_color[1] * t)
        b = int(top_color[2] * (1 - t) + bottom_color[2] * t)
        px[0, y] = (r, g, b)
    grad = grad.resize((W, H))
    img.paste(grad, (0, 0))


def _draw_rounded_rect(draw, xy, radius, fill):
    x0, y0, x1, y1 = xy
    draw.rounded_rectangle(xy, radius=radius, fill=fill)


def _draw_barcode(draw, x, y, width, height, color=WHITE):
    """Simple barcode with varied bar widths."""
    # Bar widths pattern (thin=1, thick=3)
    pattern = [2, 1, 3, 1, 2, 1, 1, 3, 1, 2, 1, 3, 2, 1, 1, 3, 1, 2, 1, 1]
    gap = 2
    total_units = sum(pattern) + len(pattern) * gap
    unit = width / total_units
    cursor = x
    for i, p in enumerate(pattern):
        bar_w = p * unit
        if i % 2 == 0:  # only even indices are bars; odd are intentional bars too alternately
            draw.rectangle([cursor, y, cursor + bar_w, y + height], fill=color)
        else:
            # odd – draw thinner bar
            draw.rectangle([cursor, y, cursor + bar_w * 0.8, y + height], fill=color)
        cursor += bar_w + gap * unit


def _draw_cart(draw, cx, cy, size, color=WHITE):
    """Shopping cart icon centered at (cx, cy)."""
    s = size
    lw = max(3, int(s * 0.08))  # line width

    # Cart body (trapezoid-ish)
    body = [
        (cx - s * 0.45, cy - s * 0.25),      # top-left
        (cx + s * 0.55, cy - s * 0.25),      # top-right
        (cx + s * 0.40, cy + s * 0.20),      # bottom-right
        (cx - s * 0.30, cy + s * 0.20),      # bottom-left
    ]
    draw.polygon(body, outline=color, width=lw)

    # Handle rail going up-left
    draw.line(
        [(cx - s * 0.45, cy - s * 0.25), (cx - s * 0.62, cy - s * 0.45),
         (cx - s * 0.72, cy - s * 0.45)],
        fill=color, width=lw, joint="curve",
    )

    # Wheels
    wheel_r = max(5, int(s * 0.08))
    w1 = (cx - s * 0.18, cy + s * 0.35)
    w2 = (cx + s * 0.30, cy + s * 0.35)
    for wx, wy in (w1, w2):
        draw.ellipse([wx - wheel_r, wy - wheel_r, wx + wheel_r, wy + wheel_r],
                     outline=color, width=lw)


def make_icon(size=1024):
    img = Image.new("RGB", (size, size), BRAND_BLUE)
    _draw_gradient(img, BRAND_BLUE, BRAND_BLUE_DARK)
    draw = ImageDraw.Draw(img)

    # Rounded dark-blue plate behind the glyphs for depth
    margin = int(size * 0.10)
    _draw_rounded_rect(
        draw,
        (margin, margin, size - margin, size - margin),
        radius=int(size * 0.22),
        fill=BRAND_BLUE_DARK,
    )

    # Barcode — upper portion
    bc_w = int(size * 0.60)
    bc_h = int(size * 0.26)
    bc_x = (size - bc_w) // 2
    bc_y = int(size * 0.22)
    _draw_barcode(draw, bc_x, bc_y, bc_w, bc_h, color=WHITE)

    # Shopping cart — lower portion
    _draw_cart(draw, cx=size // 2, cy=int(size * 0.68), size=int(size * 0.48), color=WHITE)

    return img


def make_adaptive_icon(size=1024):
    """Adaptive icon foreground — transparent background, centered artwork with padding."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # The adaptive icon safe zone is inner ~66%.  Keep art within.
    inset = int(size * 0.20)
    plate_size = size - inset * 2

    plate = Image.new("RGBA", (plate_size, plate_size), (0, 0, 0, 0))
    pd = ImageDraw.Draw(plate)
    _draw_rounded_rect(pd, (0, 0, plate_size, plate_size),
                       radius=int(plate_size * 0.22), fill=BRAND_BLUE)

    # Barcode
    bc_w = int(plate_size * 0.65)
    bc_h = int(plate_size * 0.28)
    bc_x = (plate_size - bc_w) // 2
    bc_y = int(plate_size * 0.20)
    _draw_barcode(pd, bc_x, bc_y, bc_w, bc_h, color=WHITE)
    # Cart
    _draw_cart(pd, plate_size // 2, int(plate_size * 0.68), int(plate_size * 0.50), color=WHITE)

    img.paste(plate, (inset, inset), plate)
    return img


def make_splash(size=2048):
    img = Image.new("RGB", (size, size), BRAND_BLUE)
    _draw_gradient(img, BRAND_BLUE, BRAND_BLUE_DARK)
    draw = ImageDraw.Draw(img)

    # Central logo badge
    badge_size = int(size * 0.42)
    badge_x = (size - badge_size) // 2
    badge_y = int(size * 0.26)
    _draw_rounded_rect(
        draw,
        (badge_x, badge_y, badge_x + badge_size, badge_y + badge_size),
        radius=int(badge_size * 0.22),
        fill=WHITE,
    )
    # Barcode inside badge (navy)
    bc_w = int(badge_size * 0.62)
    bc_h = int(badge_size * 0.22)
    bc_x = badge_x + (badge_size - bc_w) // 2
    bc_y = badge_y + int(badge_size * 0.22)
    _draw_barcode(draw, bc_x, bc_y, bc_w, bc_h, color=BRAND_BLUE)
    # Cart inside badge (navy)
    _draw_cart(draw, size // 2, badge_y + int(badge_size * 0.65),
               int(badge_size * 0.55), color=BRAND_BLUE)

    # App name
    font_name = _find_font(int(size * 0.085))
    name_text = "Barkodcu Cepte"
    bbox = draw.textbbox((0, 0), name_text, font=font_name)
    text_w = bbox[2] - bbox[0]
    text_x = (size - text_w) // 2
    text_y = badge_y + badge_size + int(size * 0.05)
    draw.text((text_x, text_y), name_text, fill=WHITE, font=font_name)

    # Tagline
    font_tag = _find_font(int(size * 0.035))
    tag_text = "Mobil Satış & Stok Takibi"
    bbox2 = draw.textbbox((0, 0), tag_text, font=font_tag)
    tw = bbox2[2] - bbox2[0]
    draw.text(((size - tw) // 2, text_y + int(size * 0.12)),
              tag_text, fill=(220, 230, 255), font=font_tag)

    return img


def make_favicon(size=196):
    img = make_icon(size=size)
    return img


def main():
    print("→ Generating icon.png")
    icon = make_icon(1024)
    icon.save(os.path.join(OUT_DIR, "icon.png"), "PNG", optimize=True)

    print("→ Generating adaptive-icon.png")
    adapt = make_adaptive_icon(1024)
    adapt.save(os.path.join(OUT_DIR, "adaptive-icon.png"), "PNG", optimize=True)

    print("→ Generating splash-image.png")
    splash = make_splash(2048)
    splash.save(os.path.join(OUT_DIR, "splash-image.png"), "PNG", optimize=True)

    print("→ Generating favicon.png")
    fav = make_favicon(196)
    fav.save(os.path.join(OUT_DIR, "favicon.png"), "PNG", optimize=True)

    print(f"\nAll branding assets written to {OUT_DIR}")


if __name__ == "__main__":
    main()
