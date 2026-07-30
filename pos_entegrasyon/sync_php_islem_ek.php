<?php
/**
 * SYNC.PHP EKİ — Mobil İşlem Kuyruğu (Finans + Fiş) — 2026-07
 *
 * Bu iki case'i sync.php'deki switch($action) bloğuna
 * (price_update case'lerinin yanına) yapıştırın.
 *
 * Tablo: mobil_islem_kuyrugu (uygulama backend'i otomatik oluşturur)
 * Akış: price_update_poll / price_update_mark_applied ile birebir aynı desen.
 */

        case 'islem_poll': {
            $firm = require_firm($pdo, $tenantId);
            verify_client_secret($firm);
            $limit = max(1, min(200, (int)($input['limit'] ?? 50)));
            $grubu = trim((string)($input['islem_grubu'] ?? '')); // '' = hepsi, 'finans', 'fis'
            $includeResim = (int)($input['include_resim'] ?? 0) === 1;

            $sql = "SELECT id, tenant_id, islem_grubu, islem_turu, islem_turu_ad,
                           kart_borclu, kart_borclu_ad, kart_alacakli, kart_alacakli_ad,
                           tutar, aciklama, vade_tarihi, cek_no, vergi_no, detay_json,
                           olusturan, created_at"
                 . ($includeResim ? ", cek_resmi" : ", (cek_resmi IS NOT NULL) AS resim_var")
                 . " FROM mobil_islem_kuyrugu
                    WHERE tenant_id = ? AND durum = 'bekliyor'"
                 . ($grubu !== '' ? " AND islem_grubu = " . $pdo->quote($grubu) : '')
                 . " ORDER BY id ASC LIMIT " . (int)$limit;
            $stmt = $pdo->prepare($sql);
            $stmt->execute([$tenantId]);
            $items = $stmt->fetchAll(PDO::FETCH_ASSOC);

            log_sync($pdo, $tenantId, null, 'islem_poll', 'ok', null, null, ['count' => count($items)]);
            respond(['ok' => true, 'success' => true, 'count' => count($items), 'items' => $items]);
        }

        case 'islem_mark': {
            $firm = require_firm($pdo, $tenantId);
            verify_client_secret($firm);
            $id = (int)($input['id'] ?? 0);
            if ($id <= 0) {
                respond(['ok' => false, 'error' => 'missing_id'], 400);
            }
            $errorMessage = trim((string)($input['error_message'] ?? ''));
            $erpId = (int)($input['erp_id'] ?? 0);
            $durum = $errorMessage !== '' ? 'hata' : 'aktarildi';
            $stmt = $pdo->prepare(
                "UPDATE mobil_islem_kuyrugu
                    SET durum = ?, erp_id = ?, hata_mesaji = ?, processed_at = NOW()
                  WHERE tenant_id = ? AND id = ? AND durum IN ('bekliyor','hata')"
            );
            $stmt->execute([$durum, $erpId > 0 ? $erpId : null,
                            $errorMessage !== '' ? $errorMessage : null, $tenantId, $id]);
            if ($stmt->rowCount() <= 0) {
                respond(['ok' => false, 'error' => 'islem_not_found_or_done'], 404);
            }
            log_sync($pdo, $tenantId, null, 'islem_mark', $durum === 'aktarildi' ? 'ok' : 'error',
                     null, null, ['id' => $id, 'erp_id' => $erpId],
                     $errorMessage !== '' ? $errorMessage : null);
            respond(['ok' => true, 'success' => true, 'id' => $id, 'durum' => $durum]);
        }
