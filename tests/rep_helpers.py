# Reusable helpers for reports regression (paste into browser_automation scripts)
import re
errs = []
page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
page.on("pageerror", lambda e: errs.append("PAGEERROR: " + str(e)))

async def login_to_reports():
    await page.set_viewport_size({"width": 390, "height": 844})
    for i in range(25):
        t = await page.evaluate("() => document.getElementById('root')?.innerText || ''")
        if len(t.strip()) > 5: break
        await page.wait_for_timeout(1000)
    inputs = page.locator("input")
    await inputs.nth(0).fill("cakmak.ebubekir29@gmail.com")
    await inputs.nth(1).fill("1234567")
    await page.get_by_text("Giriş Yap", exact=True).last.click(force=True)
    await page.wait_for_timeout(6000)
    if await page.get_by_text("Tamam", exact=True).count() > 0:
        await page.get_by_text("Tamam", exact=True).first.click(force=True)
        await page.wait_for_timeout(2000)
    await page.get_by_text("Raporlar", exact=True).last.click(force=True)
    await page.wait_for_timeout(3000)

async def pick_first_option(filter_name, nth=0):
    await page.locator(f'[data-testid="filter-pick-{filter_name}"]').first.click(force=True)
    for i in range(30):
        await page.wait_for_timeout(1000)
        body = await page.evaluate("() => document.body.innerText")
        if "Seçenekler yükleniyor" not in body: break
    container = page.locator('[data-testid="picker-done"]').locator('xpath=../..')
    items = container.locator('[tabindex="0"]:not([data-testid="picker-done"])')
    cnt = await items.count()
    label = None
    if cnt > nth:
        label = (await items.nth(nth).inner_text()).strip()
        await items.nth(nth).click(force=True)
        await page.wait_for_timeout(500)
    await page.locator('[data-testid="picker-done"]').first.click(force=True)
    await page.wait_for_timeout(800)
    return cnt, label

async def wait_result(max_s=120):
    for i in range(max_s):
        await page.wait_for_timeout(1000)
        body = await page.evaluate("() => document.body.innerText")
        if "Çalıştırılıyor" in body: continue
        if re.search(r"\d kayıt", body) or "Sonuç bulunamadı" in body:
            return i + 1, body
    return None, await page.evaluate("() => document.body.innerText")
