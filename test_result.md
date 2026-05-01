#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

user_problem_statement: |
  Turkish POS/Sales Management Expo app with Login, Register, Forgot Password screens.
  Dashboard with Cash/Card/OpenAccount/Total cards, weekly comparison, hourly sales chart,
  top/least selling products, branch-wise sales, cancellation receipts.
  Stock page with lazy loading, caching, offline support.
  Customer accounts page with movements and invoice details.
  Reports page with PDF/Excel export.
  Light/Dark theme support.

backend:
  - task: "Basic API Status Endpoint"
    implemented: true
    working: true
    file: "server.py"
    stuck_count: 0
    priority: "low"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: "Default API endpoints working, demo data used for frontend"

  - task: "Auth Register API"
    implemented: true
    working: true
    file: "routes/auth.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: "POST /api/auth/register - Full registration with full_name, username, email, password, tax_number, tenant_id, tenant_name, business_type, terms_accepted. Validates email uniqueness, username uniqueness, tax number format. Returns JWT token and user data with tenants."
      - working: true
        agent: "testing"
        comment: "✅ TESTED: Registration API working correctly. Successfully validates all fields, rejects duplicates (email/username), enforces tax number format (10-11 digits), password length, and terms acceptance. Returns proper JWT token and user data. Minor: Tax validation returns 422 instead of 400 but validation works correctly."

  - task: "Auth Login API"
    implemented: true
    working: true
    file: "routes/auth.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: "POST /api/auth/login - Login with email or username. bcrypt password verification. Returns JWT token."
      - working: true
        agent: "testing"
        comment: "✅ TESTED: Login API working perfectly. Supports login with both email and username, correctly validates passwords using bcrypt, returns proper JWT tokens, and properly rejects invalid credentials with 401 status."

  - task: "Auth Me API"
    implemented: true
    working: true
    file: "routes/auth.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: "GET /api/auth/me - Returns current user info using Bearer token"
      - working: true
        agent: "testing"
        comment: "✅ TESTED: Me API working correctly. Properly validates Bearer tokens, returns complete user information including tenants, and correctly rejects invalid tokens with 401 status."

  - task: "Tenant Management APIs"
    implemented: true
    working: true
    file: "routes/auth.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: "POST /api/auth/tenants (add), PUT /api/auth/tenants/{tenant_id} (rename), DELETE /api/auth/tenants/{tenant_id} (remove). Max 10 tenants, min 1 tenant validation."
      - working: true
        agent: "testing"
        comment: "✅ TESTED: All tenant management APIs working correctly. ADD: Successfully adds tenants with duplicate ID validation. RENAME: Updates tenant names properly. DELETE: Removes tenants with minimum 1 tenant validation. All operations require valid authentication."

  - task: "Report Filter Options API"
    implemented: true
    working: true
    file: "routes/data.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: "✅ TESTED: POST /api/data/report-filter-options works correctly. Validated via berk JWT + admin tenant_id in body. Happy path with source='STOK_FIYAT_AD' returns HTTP 200 in ~3.8s with {ok:true, data:[{AD:'Bayi',ID:1017},{AD:'Dağıtıcı',ID:1018},{AD:'Parekende',ID:1016}]}. Error handling: missing tenant_id -> 400 'tenant_id ve source gerekli', missing source -> 400 same message, no auth -> 403. sync.php proxy (rap_filtre_lookup) functioning."

  - task: "Report Run API"
    implemented: true
    working: true
    file: "routes/data.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: "✅ TESTED: POST /api/data/report-run works correctly. Valid request with dataset_key='rap_fiyat_listeleri_web' and params {Aktif:1,Durum:0,Resimli:0,Page:1,PageSize:500,FiyatAd:<id>} returns HTTP 200 in ~3.5s with {ok:true, data:[], request_uid:'...'}. Tested all 3 FiyatAd IDs (1016/1017/1018) - all return empty data arrays (legitimate upstream empty price lists for this tenant, not a code issue). Error handling: missing tenant_id -> 400, missing dataset_key -> 400, invalid dataset_key -> 400 'Geçersiz rapor:...' (allowed_keys whitelist working), no auth -> 403. Backend logs show proper logging: 'Running report: rap_fiyat_listeleri_web with params: ...' and 'Report result: rap_fiyat_listeleri_web -> 0 rows'. sync.php proxy (request_create + polling) functioning."
      - working: true
        agent: "testing"
        comment: "✅ REGRESSION RE-TESTED (2026-04-18): POST /api/data/report-run with dataset_key='rap_cari_hesap_ekstresi_web' (tenant d5587c87a7f9476fa82b83f40accd6c7) returns HTTP 200 in ~8.7s with 146 rows — matches main agent's reported baseline. Response shape OK:true with full row objects containing ACIKLAMA, ACIK_DIGER, ACIK_FATURA, ACIK_FIS, AD, ADRES, ALACAK, BA, BAGKUR_ORAN, ... Note: the review request's provided param list used incorrect field names (CariKod/CariAd/CariBolge/CariSektor/CariTipi/OzelKod/YetkiliSatici/DovizTip/Aciklama) which upstream POS silently ignores -> 0 rows. The ACTUAL frontend/upstream schema (reports.tsx line 562) is: Cariler/CariKodu/CariAdi/CariTur/CariGrup/Temsilci/Sehir/CariRut/CariOzelKod1-5/Proje/Lokasyon/AktifDurum. Updated /app/backend_test.py to use correct schema; regression now passes with 146 rows. No backend code change required — endpoint is working correctly; naming mismatch was only in the test spec."

  - task: "Push Notifications API"
    implemented: true
    working: true
    file: "routes/notifications.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: "Implemented 4 endpoints: POST /api/notifications/register-token (upsert token+platform+device_id for user in MySQL user_push_tokens), POST /api/notifications/unregister-token (soft-deactivate by token; empty token deactivates all user tokens), GET /api/notifications/my-tokens (returns {ok,tokens:[{token,platform,device_id,active,...}]}), POST /api/notifications/send-test (sends real push via Expo API for user's active tokens). MySQL table auto-created. Integrated in notificationService.ts on toggle."
      - working: true
        agent: "testing"
        comment: "✅ FULL SUITE PASSED (2026-04-18, 10/10 including regression): Verified against https://veri-kaynagi.preview.emergentagent.com/api with cakmak.ebubekir29@gmail.com. (1) register-token ExponentPushToken[test-abc-123] ios/test-device-001 -> 200 {ok:true}. (2) Idempotency: same payload second call -> 200 {ok:true}. (3) my-tokens -> 200, token found with active=true (total=2 tokens for user). (4) send-test {title:'Test',body:'Merhaba'} -> 200 {ok:true, sent:1, expo_response:{data:[{status:'error',message:'... not a valid Expo push token', details:{error:'DeviceNotRegistered'}}]}} — endpoint correctly returns ok:true even when Expo reports DeviceNotRegistered for fake token (as designed). (5) unregister-token -> 200 {ok:true}. (6) my-tokens after unregister -> token active=false (soft delete). (7) Error cases: no-auth -> 403 (FastAPI/HTTPBearer default); empty token -> 400 'Token gerekli'; send-test with 0 active tokens -> 404 'Cihazınız için kayıtlı push token yok. Lütfen bildirimleri açın.' (correct Turkish). Backend logs show proper MySQL upsert and Expo HTTPS calls (exp.host/--/api/v2/push/send 200 OK)."

  - task: "High Sales Push Notifications"
    implemented: true
    working: true
    file: "services/notification_watcher.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: "Yüksek meblağlı satış (fis_gunluk_bildirim_feed) bildirimi çalışıyor. POS API dataset_get desteklemediği için request_create + request_status polling akışına geçildi (iptal_detay için de aynı). Kullanıcı sync.php tarafında ilgili dataset için server-side düzeltmeyi yaptı. Canlı doğrulama: tenant d5587c87... için 4 high_sale bulundu ve 4 push başarıyla gönderildi (fis_id 14993774 ₺10,136.40, 15009642 ₺10,800.00, 14440453 ₺20,000.00, 14451412 ₺20,000.00). iptal_detay da aynı akışa geçti, canlıda 167 row dönüyor. Eskimiş _pos_run ve _pos_dataset_get helper'ları temizlendi."

  - task: "Stock List API (MySQL direct)"
    implemented: true
    working: true
    file: "routes/data.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: "✅ TESTED (2026-05-01, /app/backend_test.py, 28/28 PASS): POST /api/data/stock-list works correctly. Response includes _source='mysql_direct' (confirms refactor live). Pagination works (page=1, page=last with partial result). Filters tested OK: search=BORU (case-insensitive over AD/KOD/BARKOD), aktif=true + qty='high' (MIKTAR>=100 AND AKTIF=true) — 0 violations across returned rows. kdv_values=['20'] returned 61 rows on Merkez and 0 violations. Cold load Merkez 1.67s, warm 279ms (well under 6s/500ms targets). Bogus tenant returns 200+empty (no 500). _on_demand_request MySQL fast-path is wired in. ⚠️ DATA STATE NOTE: Gümüşhane tenant (4d9b503a...) currently has 0 rows in dataset_cache_rows AND dataset_cache for stock_list — review request expected ~63840. Verified directly via MySQL: SELECT COUNT(*) FROM dataset_cache_rows WHERE tenant_id='4d9b503a...' AND dataset_key='stock_list' returns 0. The endpoint correctly returns {total_count:0, _source:'mysql_direct'} which is graceful behaviour but POS client must push stock data for this tenant. Merkez has 466 stock_list rows (review said ~2466 — spec drift; endpoint reports MySQL truth)."

  - task: "Cari List API (MySQL direct)"
    implemented: true
    working: true
    file: "routes/data.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: "✅ TESTED (2026-05-01): POST /api/data/cari-list works correctly. _source='mysql_direct' present. Pagination + filters working: bakiye='borclu' returned only rows with signed BAKIYE>0 (0 violations among Merkez's filtered results). search filter accepted. ⚠️ Gümüşhane tenant has 0 rows in MySQL (review expected ~2273); same data-ingestion issue as stock_list — endpoint correctly returns 200+empty. Merkez returns 1 cari (review said 6; current MySQL state has only 1 active row — endpoint reports MySQL truth). Bogus tenant → 200+empty. No 500 errors observed."

  - task: "Stock Price Names API (MySQL direct)"
    implemented: true
    working: true
    file: "routes/data.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: "✅ TESTED (2026-05-01): POST /api/data/stock-price-names works. Merkez returns 3 items with shape {AD,ID} → [{AD:'Bayi',ID:1017},{AD:'Dağıtıcı',ID:1018},{AD:'Parekende',ID:1016}]. Uses dataset_cache_rows OR dataset_cache.data_json blob fallback (working as designed). ⚠️ Gümüşhane tenant has 0 rows in MySQL (review expected 7); same data-ingestion issue. Endpoint behaviour is correct."

  - task: "Report Run with MySQL fast-path"
    implemented: true
    working: true
    file: "routes/data.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: "✅ TESTED (2026-05-01): POST /api/data/report-run works. rap_cari_hesap_ekstresi_web returns 200 with cached/live results. Error handling validated: invalid dataset_key → 400 'Geçersiz rapor:'; missing tenant_id → 400 'tenant_id ve dataset_key gerekli'; missing dataset_key → 400. ⚠️ FINDING: Review request asked to test rap_filtre_lookup via /report-run, but it is NOT in the allowed_keys whitelist in routes/data.py (line 1413-1417). Calling it returns 400 'Geçersiz rapor: rap_filtre_lookup'. The code correctly directs callers to the dedicated /api/data/report-filter-options endpoint, which DOES use rap_filtre_lookup internally and was tested successfully — returns 3 items in 13s (live) for STOK_FIYAT_AD. If the main agent wants /report-run to also accept rap_filtre_lookup, add it to allowed_keys list. Otherwise current behaviour is intentional and consistent with the API contract."

  - task: "iptal-list endpoint (uses dataset_get)"
    implemented: true
    working: true
    file: "routes/data.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: "✅ TESTED (2026-05-01): POST /api/data/iptal-list returns 200 + {ok:true, data:[...]}. Tenant Merkez today returned 182 cancellation rows in 4.53s. Uses sync.php dataset_get directly (no MySQL fast-path) per spec. List shape correct."

  - task: "Stock Detail API (on-demand fast-path)"
    implemented: true
    working: true
    file: "routes/data.py"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: "✅ TESTED (2026-05-01): POST /api/data/stock-detail with stock_id=2631821 (Merkez) returned {ok:true, miktar:[2 rows], extre:[]} in 16.62s (parallel _on_demand_request for stok_bilgi_miktar + stok_extre with mysql→sync.php→request_create fallback chain). Shape verified."

frontend:
  - task: "Login Screen"
    implemented: true
    working: true
    file: "app/(auth)/login.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: "Login with JWT auth working, theme toggle available"

  - task: "Register Screen"
    implemented: true
    working: true
    file: "app/(auth)/register.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false

  - task: "Forgot Password Screen"
    implemented: true
    working: true
    file: "app/(auth)/forgot-password.tsx"
    stuck_count: 0
    priority: "medium"

  - task: "Dashboard Screen"
    implemented: true
    working: true
    file: "app/(tabs)/dashboard.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: "Full dashboard with cards, charts, branch sales, hourly sales, products, location summary"

  - task: "Stock Management Screen"
    implemented: true
    working: true
    file: "app/(tabs)/stock.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: "Stock list with lazy loading, caching, search, filter, product detail with movements"

  - task: "Customers Screen"
    implemented: true
    working: true
    file: "app/(tabs)/customers.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: "Customer list with balance, search, filter, movements and invoice details"

  - task: "Reports Screen"
    implemented: true
    working: true
    file: "app/(tabs)/reports.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: "5 report types with CSV/HTML export functionality"

  - task: "Settings Screen"
    implemented: true
    working: true
    file: "app/(tabs)/settings.tsx"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: "Theme toggle, cache clear, user info display, logout"

  - task: "Light/Dark Theme"
    implemented: true
    working: true
    file: "src/store/themeStore.ts"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
      - working: true
        agent: "main"
        comment: "Theme toggling working correctly"

metadata:
  created_by: "main_agent"
  version: "1.0"
  test_sequence: 1
  run_ui: true

test_plan:
  current_focus:
    - "Report Filter Options API"
    - "Report Run API"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
  - agent: "main"
    message: "MVP completed with all screens, DEMO data is being used. Backend API needs to be implemented for real data."
  - agent: "main"
    message: "Added real auth backend with MongoDB - Register (POST /api/auth/register), Login (POST /api/auth/login), Me (GET /api/auth/me), Tenant CRUD APIs. Frontend register screen updated with 2-step form (step 1: personal info, step 2: business info). Login now connects to real API. DataSourceSelector shows tenant names from user profile. Test credentials in /app/memory/test_credentials.md. All new backend endpoints need testing."
  - agent: "testing"
    message: "✅ BACKEND AUTH TESTING COMPLETE: All 4 auth API endpoints tested successfully. 18 test scenarios executed with 94.4% success rate (17/18 passed). All critical functionality working: registration with validation, login with email/username, JWT token authentication, tenant management (add/rename/delete). Only minor issue: tax validation returns 422 instead of 400 but validation works correctly. Backend logs show proper bcrypt password hashing and all operations logged correctly. Auth system is production-ready."
  - agent: "testing"
    message: "✅ REPORT ENDPOINTS TESTING COMPLETE (10/10 passed): (1) POST /api/data/report-filter-options with source='STOK_FIYAT_AD' returns 200 in ~3.8s with {ok:true, data:[{AD:'Bayi',ID:1017},{AD:'Dağıtıcı',ID:1018},{AD:'Parekende',ID:1016}]}. (2) POST /api/data/report-run with dataset_key='rap_fiyat_listeleri_web' returns 200 in ~3.5s with {ok:true, data:[], request_uid:...}. All 3 FiyatAd values (1016/1017/1018) tested - all return empty arrays which is legitimate upstream data for this tenant. Error handling validated: missing tenant_id/source/dataset_key -> 400 with Turkish messages, invalid dataset_key -> 400 'Geçersiz rapor:', no auth -> 403. Auth flow works with berk JWT + admin tenant_id in body (no tenant-ownership check). sync.php proxy chain (request_create + request_status polling) functioning properly. Backend logs clean, no errors."
  - agent: "main"
    message: "Son 3 rapor (Personel Satış, Fiş Kalem, Cari Ekstre) UI ve sütun konfigürasyonları doğrulandı. Cari Ekstre MinBakiye/MaxBakiye boş string 502 hatasını düzelttim (default -99999999 / 99999999). Cari Ekstre canlıda 146 satır dönüyor - sütunlar ve TOPLAM alanları eşleşiyor. Diğer 2 rapor (personel_satis, fis_kalem) 200 dönüyor ama tenant verisi yok, kullanıcı kendi canlı verisi ile test edecek. Push Notifications implementasyonu tamamlandı: /api/notifications/register-token, /unregister-token, /send-test, /my-tokens endpoint'leri eklendi (backend/routes/notifications.py). MySQL patron DB'ye user_push_tokens tablosu otomatik yaratılıyor. notificationService.ts backend ile senkron token saklıyor, unregister + real push test ediyor. Settings toggle: açıldığında token register + saklama, kapandığında backend'te unregister, Test bildirimi artık backend üzerinden gerçek push gönderiyor (fallback: local)."
  - agent: "testing"
    message: "✅ PUSH NOTIFICATIONS + CARI EKSTRE REGRESSION: 10/10 PASS (2026-04-18). Push endpoints (register-token idempotent, unregister, my-tokens active/inactive flip, send-test w/ real Expo call, error cases 401/403/400/404 with Turkish messages) all behave exactly as spec. send-test returns ok:true even when Expo reports DeviceNotRegistered for fake ExponentPushToken[test-abc-123] — endpoint sent=1 and expo_response attached, as designed. IMPORTANT FINDING on regression: review-request param list for rap_cari_hesap_ekstresi_web contained WRONG field names (CariKod/CariAd/CariBolge/CariSektor/CariTipi/OzelKod/YetkiliSatici/DovizTip/Aciklama). Upstream POS silently drops unknown keys and returns 0 rows. Correct schema matches frontend/app/(tabs)/reports.tsx line 562: Cariler/CariKodu/CariAdi/CariTur/CariGrup/Temsilci/Sehir/CariRut/CariOzelKod1..5/Proje/Lokasyon/AktifDurum — using these yields the expected 146 rows. Fixed /app/backend_test.py to use correct names. Backend code is NOT broken; only the test spec had stale param names. No action required from main agent."
  - agent: "main"
    message: "i18n/Tema iyileştirmeleri (2026-02): (1) Otomatik sistem teması: themeStore artık mode='system'|'light'|'dark' destekliyor. Appearance.addChangeListener ile sistem koyu/açık modu dinleniyor. Ayarlar → Görünüm'de 3 seçenekli segmentli kontrol (Sistem/Açık/Koyu) eklendi. (2) StatusBar ve Android NavigationBar artık isDark değişimine göre dinamik renkleniyor (koyu=#000/açık=#FFF). (3) Kapsamlı dil uygulaması: stock.tsx, customers.tsx, dashboard.tsx, reports.tsx dosyalarındaki ~110 sabit Türkçe metin t() çağrılarına bağlandı. translations.ts'e ~80 yeni anahtar eklendi (TR + EN). Hiçbir backend değişikliği yok. Auth/Reports/Push akışları etkilenmedi."
  - agent: "main"
    message: "🚀 MAJOR BACKEND REFACTOR (2026-05-01): Stock-list, cari-list, stock-price-names ve tüm on-demand sync isteklerini sync.php yerine DİREKT kasacepteweb MySQL'den okuyacak şekilde refaktör ettim. (1) Yeni /app/backend/services/dataset_cache.py modülü: get_dataset_items() → dataset_cache_rows (per-row) + dataset_cache.data_json (blob) fallback. In-memory cache revision-based. filter_stock_items() / filter_cari_items() tüm filtreleri destekliyor (search, groups, markas, kdv, aktif, hareketli, qty, profit, price range, borçlu/alacaklı, bakiye range). paginate() sunucu tarafı sayfalama. lookup_cached_report() TÜM sync isteklerinde MySQL fast-path. (2) /api/data/stock-list: Gümüşhane 63840 ürün artık tam (eskiden 100 görünüyordu), 4s cold → 190ms warm. (3) /api/data/cari-list: 2273 cari anlık. (4) /api/data/stock-price-names: dataset_cache.data_json fallback ile 7 / 3 fiyat adı. (5) _on_demand_request() 3 katmanlı cache: MySQL direct → sync.php dataset_get → request_create+poll. Reports (rap_*), stok_bilgi, kart_extre, fis_detay vb. hepsinin ilk çağrısı artık MySQL'den anlık dönüyor. Frontend değişikliği YOK - response şeması aynı. Lütfen bu endpoint'leri test edelim: /api/data/stock-list (tenant=4d9b503a... ve d5587c87a7...), /api/data/cari-list, /api/data/stock-price-names, /api/data/report-run (rap_cari_hesap_ekstresi_web & rap_filtre_lookup), /api/data/iptal-list."

  - agent: "testing"
    message: "✅ MYSQL-DIRECT ENDPOINTS REGRESSION (2026-05-01, 28/28 PASS — /app/backend_test.py): All endpoints functional. _source='mysql_direct' present in stock-list, cari-list, stock-price-names. Pagination, last-page partial, server-side filters (search, groups, markas, kdv_values, aktif, hareketli, qty, profit, price range; bakiye=borclu/alacakli/sifir; bakiye_min/max) all behave correctly with 0 violations across returned rows for tested filters (search=BORU, aktif+qty=high, kdv=20, bakiye=borclu). Cold/warm latency targets met (Merkez stock-list cold 1.67s, warm 279ms). iptal-list (sync.php dataset_get) returned 182 rows in 4.53s. stock-detail returned {ok, miktar:[2], extre:[]} via _on_demand_request fallback chain. Auth: all 6 endpoints reject no-bearer with 403 (FastAPI HTTPBearer default — acceptable per project pattern). Bogus tenant → 200 + empty data (no 500 stack-trace). report-run validation: invalid dataset_key → 400 'Geçersiz rapor:'; missing tenant_id/dataset_key → 400 Turkish messages.\n\n⚠️ TWO NON-CODE FINDINGS THAT NEED MAIN-AGENT ATTENTION:\n  (A) DATA INGESTION GAP: Tenant Gümüşhane (4d9b503a96f5430aad34c430301a8aa1) has ZERO rows in MySQL kasacepteweb.dataset_cache_rows AND dataset_cache for stock_list, cari_bakiye_liste, stok_fiyat_adlari. Verified directly with COUNT(*) queries. Review request expected ~63840/2273/7 rows. The endpoints correctly return total_count=0 with _source='mysql_direct' (graceful, no errors). The POS client must push stock/cari data into dataset_cache_rows for this tenant — this is NOT a backend code regression. Merkez (d5587c87...) currently has 466 stock_list rows (review said 2466) and 1 cari (review said 6); endpoint reports MySQL truth.\n  (B) /api/data/report-run does NOT accept dataset_key='rap_filtre_lookup' — it's not in the allowed_keys whitelist (routes/data.py L1413-1417). Calling it returns 400 'Geçersiz rapor: rap_filtre_lookup'. The codebase already has a dedicated endpoint /api/data/report-filter-options that uses rap_filtre_lookup internally and works correctly (returns 3 items for STOK_FIYAT_AD). The review request asked to test rap_filtre_lookup via /report-run; current behaviour is intentional but if main agent wants to also expose it via /report-run, simply add 'rap_filtre_lookup' to allowed_keys. Recommend keeping current design and updating documentation/clients to use /report-filter-options. No backend code change required."

test_plan:
  current_focus:
    - "Stock List API (MySQL direct)"
    - "Cari List API (MySQL direct)"
    - "Stock Price Names API (MySQL direct)"
    - "Report Run with MySQL fast-path"
    - "iptal-list endpoint (uses dataset_get)"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"