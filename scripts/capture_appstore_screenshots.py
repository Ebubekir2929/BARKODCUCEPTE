#!/usr/bin/env python3
"""
Generates App Store screenshots for iPhone 6.7", 6.5" and 5.5" devices.
Captures key screens of the Barkodcu Cepte POS app with demo data overlaid
(real user/restaurant/customer names and numbers are masked so the screenshots
are safe for public distribution on the App Store).
"""
import asyncio
import os
from pathlib import Path
from playwright.async_api import async_playwright

BASE = "https://pos-app-store.preview.emergentagent.com"
EMAIL = "cakmak.ebubekir29@gmail.com"
PASSWORD = "123456"

OUT_BASE = Path("/app/screenshots")
DEVICES = {
    # name: (css_width, css_height, target_pixel_width, target_pixel_height, scale)
    "iphone_6_7": (430, 932, 1290, 2796, 3),   # iPhone 14/15 Pro Max
    "iphone_6_5": (414, 896, 1242, 2688, 3),   # iPhone 11 Pro Max / XS Max
    "iphone_5_5": (414, 736, 1242, 2208, 3),   # iPhone 8 Plus
    # 2026-05-18 — iPad Pro 13" (M4)
    "ipad_13":    (1032, 1376, 2064, 2752, 2),  # iPad Pro 13" portrait
}

# Demo data substitution: real_text -> demo_text
# Applied via DOM text replacement before each screenshot.
# IMPORTANT: order matters — more specific (longer) strings first to avoid
# accidental double-replacement like "Merkez" -> "Merkez Şube" -> "Merkez Şube Şube".
DEMO_REPLACEMENTS = [
    # --- multi-word PII first ---
    ("EBUBEKİR ÇAKMAK", "DEMO KULLANICI"),
    ("EBUBEKİR Ç", "DEMO KULLANICI"),
    ("cakmak.ebubekir29@gmail.com", "demo@barkodcu.com"),
    ("Berk Yazılım", "Demo Yazılım"),
    ("PEŞİN SATIŞ CARİSİ", "Genel Satış"),
    # Product whose name is literally "EBUBEKİR XXXXX..." (a long X string)
    # Replace the whole token chain.
    ("EBUBEKİR XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", "Demo Ürün 3"),
    ("EBUBEKİR XXXXXXXXXXXXXXXXXXXXXXXXXX", "Demo Ürün 3"),
    ("EBUBEKİR XXXXXXXXXXXXX", "Demo Ürün 3"),
    ("EBUBEKİR XXX", "Demo Ürün 3"),
    ("EBUBEKİR", "Demo"),
    # --- branches ---
    ("Gümüşhane", "Şube 2"),
    # NOT replacing "Merkez" — it is a generic Turkish word ("Headquarters")
    # and double-replacement caused "Merkez Şube Şube". Leave as-is.
    # --- customer (Cari) names ---
    ("DENEMEEEE", "Berk Demir"),
    ("KURUHAL", "Cem Aksoy"),
    ("MİMARLIK", "Deniz Kara"),
    # ("deneme", "Ali Yılmaz"),  # too generic — might collide with "denemek" etc., but it's a Cari name
    ("deneme", "Ali Yılmaz"),
    # --- product names (Stok) ---
    ("DENEME 1", "Demo Ürün 1"),
    ("DENEME 2", "Demo Ürün 2"),
    ("ZENNE", "Kahve Çekirdeği"),
    ("KÖME", "Türk Kahvesi"),
    ("PESTİL", "Sade Çay"),
]

# JavaScript to inject for replacing text
MASK_JS_TEMPLATE = """
(() => {
  const pairs = REPLACEMENTS_JSON;
  function walk(node) {
    if (node.nodeType === 3) {
      let v = node.nodeValue;
      if (!v) return;
      for (const [from, to] of pairs) {
        if (v.includes(from)) v = v.split(from).join(to);
      }
      if (v !== node.nodeValue) node.nodeValue = v;
    } else if (node.nodeType === 1) {
      // skip script / style
      const tag = node.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE') return;
      for (let i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i]);
    }
  }
  walk(document.body);
})();
"""

def build_mask_js():
    import json
    pairs = json.dumps(DEMO_REPLACEMENTS, ensure_ascii=False)
    return MASK_JS_TEMPLATE.replace("REPLACEMENTS_JSON", pairs)


async def login(page):
    await page.goto(f"{BASE}/login", wait_until="networkidle", timeout=45000)
    await page.wait_for_timeout(2500)
    await page.locator('input').first.fill(EMAIL)
    await page.locator('input').nth(1).fill(PASSWORD)
    await page.get_by_text("Giriş Yap", exact=True).click()
    await page.wait_for_timeout(7000)


async def mask(page):
    await page.evaluate(build_mask_js())
    # Second pass: regex sweep to cleanup any remaining EBUBEKİR XXX or Demo X+ leftovers
    await page.evaluate("""
      (() => {
        function walk(node) {
          if (node.nodeType === 3) {
            let v = node.nodeValue;
            if (!v) return;
            // 'Demo Ürün 3XXXXX' or 'Demo Ürün 3 XXXX' -> 'Demo Ürün 3'
            v = v.replace(/Demo Ürün 3\\s*X+\\.{0,3}/g, 'Demo Ürün 3');
            // 'Demo X X X ...' leftover -> 'Demo Ürün 3'
            v = v.replace(/Demo\\s+X{2,}[^\\s]*/g, 'Demo Ürün 3');
            v = v.replace(/EBUBEKİR\\s+X{2,}[^\\s]*/gi, 'Demo Ürün 3');
            // any standalone X-string of 3+ -> drop it (truncated wrap continuation)
            v = v.replace(/X{3,}\\.{0,3}/g, '');
            // any stray 'EBUBEKİR' -> 'DEMO KULLANICI'
            v = v.replace(/EBUBEKİR[A-ZÇĞİÖŞÜa-zçğıöşü]*/g, 'DEMO KULLANICI');
            // 'Merkez Şube Şube' -> 'Merkez Şube'
            v = v.replace(/Merkez Şube Şube/g, 'Merkez Şube');
            if (v !== node.nodeValue) node.nodeValue = v;
          } else if (node.nodeType === 1) {
            const tag = node.tagName;
            if (tag === 'SCRIPT' || tag === 'STYLE') return;
            for (let i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i]);
          }
        }
        walk(document.body);
      })();
    """)
    await page.wait_for_timeout(300)


async def shoot(page, out_dir: Path, name: str):
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{name}.png"
    await page.screenshot(path=str(path), full_page=False, type="png")
    print(f"  ✓ {path}")


async def capture_screen_set(playwright, device_key: str, css_w: int, css_h: int, scale: int):
    out_dir = OUT_BASE / device_key
    # Use the bundled headless_shell at /pw-browsers (version pinned by env)
    exe_path = "/pw-browsers/chromium_headless_shell-1208/chrome-linux/headless_shell"
    if os.path.exists(exe_path):
        browser = await playwright.chromium.launch(headless=True, executable_path=exe_path)
    else:
        browser = await playwright.chromium.launch(headless=True)
    is_tablet = device_key.startswith("ipad")
    context = await browser.new_context(
        viewport={"width": css_w, "height": css_h},
        device_scale_factor=scale,
        is_mobile=not is_tablet,
        has_touch=True,
        user_agent=(
            "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 "
            "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
            if is_tablet else
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 "
            "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
        ),
    )
    page = await context.new_page()

    try:
        # 1. Login screen (before mask)
        await page.goto(f"{BASE}/login", wait_until="networkidle", timeout=45000)
        await page.wait_for_timeout(2500)
        await shoot(page, out_dir, "01_login")

        # 2. Login
        await page.locator('input').first.fill(EMAIL)
        await page.locator('input').nth(1).fill(PASSWORD)
        await page.get_by_text("Giriş Yap", exact=True).click()
        await page.wait_for_timeout(7000)
        await mask(page)
        await shoot(page, out_dir, "02_dashboard")

        # 3. Filter modal
        try:
            await page.get_by_text("Filtre", exact=True).first.click()
            await page.wait_for_timeout(2000)
            await mask(page)
            await shoot(page, out_dir, "03_filter")
            await page.keyboard.press("Escape")
            await page.wait_for_timeout(1500)
        except Exception as e:
            print(f"  ! filter modal: {e}")

        # 4. Veresiye expand (click row)
        try:
            # Try clicking the chevron/row of VERESİYE
            ver = page.locator('text=VERESİYE').last
            await ver.click(force=True, timeout=8000)
            await page.wait_for_timeout(2000)
            await mask(page)
            await shoot(page, out_dir, "04_veresiye")
        except Exception as e:
            print(f"  ! veresiye: {e}")

        # 5. Stock
        await page.goto(f"{BASE}/stock", wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(5000)
        await mask(page)
        await shoot(page, out_dir, "05_stock")

        # 6. Customers
        await page.goto(f"{BASE}/customers", wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(5000)
        await mask(page)
        await shoot(page, out_dir, "06_customers")

        # 7. Customer detail (open first customer)
        try:
            first_row = page.locator('text=Ali Yılmaz').first
            await first_row.click(force=True, timeout=6000)
            await page.wait_for_timeout(4000)
            await mask(page)
            await shoot(page, out_dir, "07_customer_detail")
            # Try going back
            try:
                await page.go_back(wait_until="networkidle", timeout=10000)
                await page.wait_for_timeout(2000)
            except Exception:
                await page.goto(f"{BASE}/customers", wait_until="networkidle", timeout=20000)
                await page.wait_for_timeout(3000)
        except Exception as e:
            print(f"  ! customer detail: {e}")

        # 8. Reports
        await page.goto(f"{BASE}/reports", wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(4000)
        await mask(page)
        await shoot(page, out_dir, "08_reports")

        # 9. Report — Satış Adet / Kâr detail
        try:
            await page.get_by_text("Satış Adet / Kâr", exact=True).first.click(force=True, timeout=6000)
            await page.wait_for_timeout(5000)
            await mask(page)
            await shoot(page, out_dir, "09_report_sales")
            try:
                await page.go_back(wait_until="networkidle", timeout=10000)
                await page.wait_for_timeout(2000)
            except Exception:
                pass
        except Exception as e:
            print(f"  ! report detail: {e}")

        # 10. Settings
        await page.goto(f"{BASE}/settings", wait_until="networkidle", timeout=30000)
        await page.wait_for_timeout(4000)
        await mask(page)
        await shoot(page, out_dir, "10_settings")

    finally:
        await context.close()
        await browser.close()


async def main():
    import sys
    OUT_BASE.mkdir(parents=True, exist_ok=True)
    # Optional CLI args: device keys to run (default = all)
    requested = sys.argv[1:] if len(sys.argv) > 1 else list(DEVICES.keys())
    async with async_playwright() as p:
        for key in requested:
            if key not in DEVICES:
                print(f"Skipping unknown device: {key}")
                continue
            cw, ch, _, _, sc = DEVICES[key]
            print(f"\n=== {key} ({cw}x{ch} @ {sc}x) ===")
            await capture_screen_set(p, key, cw, ch, sc)
    print("\nDone.")


if __name__ == "__main__":
    asyncio.run(main())
