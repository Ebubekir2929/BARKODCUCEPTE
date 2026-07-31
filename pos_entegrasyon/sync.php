<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

require_once __DIR__ . '/db.php';

function json_input(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        return [];
    }
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function respond(array $payload, int $code = 200): void
{
    http_response_code($code);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function sha256_hex(string $value): string
{
    return hash('sha256', $value);
}

function get_header_value(string $name): string
{
    $key = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
    return isset($_SERVER[$key]) ? trim((string)$_SERVER[$key]) : '';
}

function canonicalize_json_value($value)
{
    if (!is_array($value)) {
        if (is_string($value) && preg_match('/^-?0+E[-+]?\d+$/i', trim($value))) {
            return '0';
        }
        return $value;
    }

    $isList = array_keys($value) === range(0, count($value) - 1);
    if ($isList) {
        foreach ($value as $k => $v) {
            $value[$k] = canonicalize_json_value($v);
        }
        return $value;
    }

    ksort($value, SORT_STRING);
    foreach ($value as $k => $v) {
        $value[$k] = canonicalize_json_value($v);
    }
    return $value;
}

function clean_json($value): string
{
    return json_encode(canonicalize_json_value($value), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '{}';
}

function normalize_row_count($data): int
{
    if (is_array($data)) {
        return count($data);
    }
    return 1;
}

function first_non_empty(array $keys, array $params, $default = null)
{
    foreach ($keys as $key) {
        if (array_key_exists($key, $params)) {
            $val = $params[$key];
            if ($val !== null && $val !== '') {
                return $val;
            }
        }
    }
    return $default;
}

function normalize_day_from_value($value): string
{
    $s = trim((string)$value);
    if ($s === '') {
        return gmdate('Y-m-d');
    }
    if (preg_match('/^\d{4}-\d{2}-\d{2}/', $s, $m)) {
        return $m[0];
    }
    try {
        return (new DateTime($s))->format('Y-m-d');
    } catch (Throwable $e) {
        return gmdate('Y-m-d');
    }
}

function cache_lookup_array(string $datasetKey, array $params): array
{
    switch ($datasetKey) {
        // sürekli tek kayıt, değişirse update
        case 'firma_sabitleri':
        case 'stok_fiyat_adlari':
        case 'cari_bakiye_liste':
            return ['scope' => 'master'];

        // Büyük stok listesi tek master cache olarak tutulur.
        // FIYAT_AD / page / search gibi okuma parametreleri cache anahtarını değiştirmez.
        case 'stock_list':
            return ['scope' => 'master'];

        // Bildirim feed artık request cevabı değil, client tarafından web cache'e direkt basılır.
        // Mobil/backend dataset_get sırasında MinTutar/SonFisId gönderse bile aynı günlük cache bulunmalı.
        case 'fis_gunluk_bildirim_feed':
            return [
                'scope' => 'fis_gunluk_bildirim_feed_daily',
                'day' => normalize_day_from_value(first_non_empty(['TARIH', 'tarih', 'date', 'sdate', 'SDATE'], $params, '')),
            ];

        // günlük veri; aynı gün içinde update
        case 'financial_data':
        case 'hourly_data':
        case 'top10_stock_movements':
        case 'down10_stock_movements':
        case 'garson_satis_ozet':
            return [
                'scope' => 'daily',
                'day' => normalize_day_from_value(first_non_empty(['sdate', 'SDATE', 'date'], $params, '')),
                'lokasyonID' => first_non_empty(['lokasyonID', 'LOKASYON_ID', 'LOKASYON'], $params, null),
            ];

        case 'financial_data_location':
        case 'hourly_location_data':
        case 'cancel_data':
        case 'iptal_ozet':
            return [
                'scope' => 'daily',
                'day' => normalize_day_from_value(first_non_empty(['sdate', 'SDATE', 'date'], $params, '')),
            ];

        case 'rap_acik_hesap_kisi_ozet_web':
            // Açık hesap ayrı dataset'tir; açık masa ile karışmaz.
            // Page/PageSize sadece okuma/sayfalama parametresidir, cache anahtarını değiştirmez.
            return [
                'scope' => 'rap_acik_hesap_kisi_ozet_web',
                'sdate' => normalize_day_from_value(first_non_empty(['sdate', 'SDATE', 'date'], $params, '')),
                'edate' => normalize_day_from_value(first_non_empty(['edate', 'EDATE'], $params, '')),
                'cari' => first_non_empty(['CARI_ID', 'CARI', 'cari_id', 'cari'], $params, null),
                'lokasyonID' => first_non_empty(['lokasyonID', 'LOKASYON_ID', 'LOKASYON'], $params, null),
            ];

        case 'rap_filtre_lookup':
        case 'rapor_filter_lookup':
        case 'stok_lookup':
        case 'cari_lookup':
        case 'lokasyon_lookup':
        case 'grup_lookup':
        case 'fiyat_lookup':
            // Lookup cache tek master kayıt olarak tutulur. Kaynak/Q filtreleri okuma sırasında uygulanır.
            return ['scope' => $datasetKey];

        case 'acik_masalar':
            return [
                'scope' => 'live_open_tables',
            ];

        case 'acik_masa_detay':
            return [
                'scope' => 'open_table_detail',
                'POS_ID' => (string)first_non_empty(['POS_ID', 'pos_id'], $params, '0'),
            ];

        case 'iptal_detay':
            $iptalId = first_non_empty(['IPTAL_ID', 'iptal_id'], $params, null);
            if ($iptalId !== null && $iptalId !== '') {
                return [
                    'scope' => 'iptal_detail',
                    'IPTAL_ID' => (string)$iptalId,
                ];
            }
            return [
                'scope' => 'daily_cancel_list',
                'day' => normalize_day_from_value(first_non_empty(['sdate', 'SDATE', 'date'], $params, '')),
            ];
			
		case 'hourly_stock_detail':
    return [
        'scope' => 'hourly_stock_detail',
        'day' => normalize_day_from_value(first_non_empty(['sdate', 'SDATE', 'date'], $params, '')),
        'lokasyonID' => first_non_empty(['lokasyonID', 'LOKASYON_ID', 'LOKASYON'], $params, null),
        'sdate' => first_non_empty(['sdate', 'SDATE'], $params, ''),
        'edate' => first_non_empty(['edate', 'EDATE'], $params, ''),
    ];	

        case 'rap_acik_hesap_kisi_ozet_web':
            return [
                'scope' => 'rap_acik_hesap_kisi_ozet_web',
                'day' => normalize_day_from_value(first_non_empty(['sdate', 'SDATE', 'date'], $params, '')),
                'sdate' => first_non_empty(['sdate', 'SDATE'], $params, ''),
                'edate' => first_non_empty(['edate', 'EDATE'], $params, ''),
                'cari' => first_non_empty(['CARI_ID', 'CARI', 'cari_id', 'cari'], $params, null),
                'lokasyonID' => first_non_empty(['lokasyonID', 'LOKASYON_ID', 'LOKASYON'], $params, null),
            ];

        case 'rapor_filter_lookup':
        case 'stok_lookup':
        case 'cari_lookup':
        case 'lokasyon_lookup':
        case 'grup_lookup':
        case 'fiyat_lookup':
            return ['scope' => $datasetKey];
	

        // detay prosedürler parametre kombinasyonuna göre tek kayıt
        case 'stok_extre':
        case 'stok_bilgi_miktar':
        case 'kart_extre_cari':
        case 'fis_detay_toplam':
            return canonicalize_json_value($params);

        default:
            return canonicalize_json_value($params);
    }
}

function cache_lookup_json(string $datasetKey, array $params): string
{
    return clean_json(cache_lookup_array($datasetKey, $params));
}

function log_sync(PDO $pdo, string $tenantId, ?string $datasetKey, string $actionName, string $status, ?string $requestId = null, ?string $paramsJson = null, ?array $meta = null, ?string $errorText = null): void
{
    $stmt = $pdo->prepare(
        "INSERT INTO sync_logs
            (tenant_id, dataset_key, action_name, status, request_id, params_json, meta_json, error_text, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())"
    );
    $stmt->execute([
        $tenantId,
        $datasetKey,
        $actionName,
        $status,
        $requestId,
        $paramsJson,
        $meta ? clean_json($meta) : null,
        $errorText,
    ]);
}

function upsert_firm_if_missing(PDO $pdo, string $tenantId, ?string $dbName = null): array
{
    $stmt = $pdo->prepare(
        "INSERT INTO firms (tenant_id, db_name, created_at, updated_at)
         VALUES (?, ?, NOW(), NOW())
         ON DUPLICATE KEY UPDATE
            db_name = COALESCE(VALUES(db_name), db_name),
            updated_at = NOW()"
    );
    $stmt->execute([$tenantId, $dbName]);

    $stmt = $pdo->prepare("SELECT * FROM firms WHERE tenant_id = ? LIMIT 1");
    $stmt->execute([$tenantId]);
    $firm = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$firm) {
        respond(['ok' => false, 'error' => 'tenant_not_found'], 404);
    }
    return $firm;
}

function require_firm(PDO $pdo, string $tenantId): array
{
    $stmt = $pdo->prepare("SELECT * FROM firms WHERE tenant_id = ? AND is_active = 1 LIMIT 1");
    $stmt->execute([$tenantId]);
    $firm = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$firm) {
        respond(['ok' => false, 'error' => 'tenant_not_found'], 404);
    }
    return $firm;
}

function verify_client_secret(array $firm): void
{
    $incoming = get_header_value('X-Client-Secret');
    if ($incoming === '') {
        respond(['ok' => false, 'error' => 'missing_client_secret'], 401);
    }
    $storedHash = trim((string)($firm['client_secret_hash'] ?? ''));
    if ($storedHash === '') {
        respond(['ok' => false, 'error' => 'client_secret_not_registered'], 401);
    }
    if (!hash_equals($storedHash, sha256_hex($incoming))) {
        respond(['ok' => false, 'error' => 'invalid_client_secret'], 401);
    }
}

function table_exists_for_settings(PDO $pdo, string $tableName): bool
{
    try {
        $stmt = $pdo->prepare("SHOW TABLES LIKE ?");
        $stmt->execute([$tableName]);
        return (bool)$stmt->fetch(PDO::FETCH_NUM);
    } catch (Throwable $e) {
        return false;
    }
}

function get_table_columns_assoc(PDO $pdo, string $tableName): array
{
    try {
        $safe = str_replace('`', '``', $tableName);
        $stmt = $pdo->query("SHOW COLUMNS FROM `" . $safe . "`");
        $cols = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $name = (string)$row['Field'];
            $cols[strtolower($name)] = $name;
        }
        return $cols;
    } catch (Throwable $e) {
        return [];
    }
}

function read_fis_bildirim_settings(PDO $pdo, string $tenantId, float $defaultMinTutar = 4000.0): array
{
    $tables = [
        'fis_bildirim_ayarlari', 'fis_bildirim_ayar',
        'bildirim_ayarlari', 'bildirim_ayar', 'mobil_bildirim_ayarlari',
        'notification_settings', 'push_notification_settings', 'app_notification_settings',
        'app_settings', 'settings'
    ];
    $valueCols = [
        'min_tutar', 'mintutar', 'min_tutar_yuksek_satis',
        'yuksek_tutar', 'yuksek_tutar_limit', 'limit_tutar', 'tutar_limit',
        'bildirim_min_tutar', 'satis_min_tutar', 'high_amount_limit', 'amount_limit', 'tutar'
    ];
    $tenantCols = ['tenant_id', 'tenant', 'firma_tenant_id'];
    $activeCols = ['is_active', 'aktif', 'enabled', 'bildirim_aktif', 'aktif_mi'];
    $orderCols = ['updated_at', 'created_at', 'id'];

    foreach ($tables as $table) {
        if (!table_exists_for_settings($pdo, $table)) {
            continue;
        }
        $cols = get_table_columns_assoc($pdo, $table);
        if (!$cols) {
            continue;
        }

        $valueCol = null;
        foreach ($valueCols as $candidate) {
            if (isset($cols[strtolower($candidate)])) {
                $valueCol = $cols[strtolower($candidate)];
                break;
            }
        }
        if ($valueCol === null) {
            continue;
        }

        $where = [];
        $bind = [];
        foreach ($tenantCols as $candidate) {
            if (isset($cols[strtolower($candidate)])) {
                $where[] = '`' . str_replace('`', '``', $cols[strtolower($candidate)]) . '` = ?';
                $bind[] = $tenantId;
                break;
            }
        }
        foreach ($activeCols as $candidate) {
            if (isset($cols[strtolower($candidate)])) {
                $c = '`' . str_replace('`', '``', $cols[strtolower($candidate)]) . '`';
                $where[] = '(' . $c . ' = 1 OR ' . $c . ' = "1")';
                break;
            }
        }

        $order = '';
        foreach ($orderCols as $candidate) {
            if (isset($cols[strtolower($candidate)])) {
                $order = ' ORDER BY `' . str_replace('`', '``', $cols[strtolower($candidate)]) . '` DESC';
                break;
            }
        }

        $sql = 'SELECT `' . str_replace('`', '``', $valueCol) . '` AS min_tutar FROM `' . str_replace('`', '``', $table) . '`';
        if ($where) {
            $sql .= ' WHERE ' . implode(' AND ', $where);
        }
        $sql .= $order . ' LIMIT 1';

        try {
            $stmt = $pdo->prepare($sql);
            $stmt->execute($bind);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            if ($row && isset($row['min_tutar']) && is_numeric($row['min_tutar']) && (float)$row['min_tutar'] > 0) {
                return [
                    'MinTutar' => (float)$row['min_tutar'],
                    'source' => $table . '.' . $valueCol,
                    'default_used' => false,
                ];
            }
        } catch (Throwable $e) {
            continue;
        }
    }

    return [
        'MinTutar' => $defaultMinTutar,
        'source' => 'default',
        'default_used' => true,
    ];
}

function save_dataset_cache(PDO $pdo, string $tenantId, string $datasetKey, array $params, $data, ?string $requestUid = null): array
{
    $paramsJson = clean_json($params);
    $lookupJson = cache_lookup_json($datasetKey, $params);
    $paramsHash = sha256_hex($lookupJson);
    $dataJson = clean_json($data);
    $dataHash = sha256_hex($dataJson);
    $rowCount = normalize_row_count($data);

    $stmt = $pdo->prepare(
        "SELECT id, revision_no, data_hash
           FROM dataset_cache
          WHERE tenant_id = ? AND dataset_key = ? AND params_hash = ?
          LIMIT 1"
    );
    $stmt->execute([$tenantId, $datasetKey, $paramsHash]);
    $existing = $stmt->fetch(PDO::FETCH_ASSOC);

    if ($existing) {
        $cacheId = (int)$existing['id'];
        $revisionNo = (int)$existing['revision_no'];
        $sameHash = hash_equals((string)$existing['data_hash'], $dataHash);
        if (!$sameHash) {
            $revisionNo++;
        }

        $upd = $pdo->prepare(
            "UPDATE dataset_cache
                SET params_json = ?,
                    data_json = ?,
                    row_count = ?,
                    data_hash = ?,
                    revision_no = ?,
                    synced_at = NOW(),
                    updated_at = NOW()
              WHERE id = ?"
        );
        $upd->execute([$paramsJson, $dataJson, $rowCount, $dataHash, $revisionNo, $cacheId]);
    } else {
        $revisionNo = 1;
        $ins = $pdo->prepare(
            "INSERT INTO dataset_cache
                (tenant_id, dataset_key, params_hash, params_json, data_json, row_count, data_hash, revision_no, synced_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1, NOW(), NOW(), NOW())"
        );
        $ins->execute([$tenantId, $datasetKey, $paramsHash, $paramsJson, $dataJson, $rowCount, $dataHash]);
        $cacheId = (int)$pdo->lastInsertId();
    }

    $stmt = $pdo->prepare(
        "SELECT id, revision_no, snapshot_hash
           FROM dataset_snapshots
          WHERE tenant_id = ? AND dataset_key = ? AND params_hash = ?
          LIMIT 1"
    );
    $stmt->execute([$tenantId, $datasetKey, $paramsHash]);
    $snapshot = $stmt->fetch(PDO::FETCH_ASSOC);

    if ($snapshot) {
        $snapshotRevision = (int)$snapshot['revision_no'];
        if (!hash_equals((string)$snapshot['snapshot_hash'], $dataHash)) {
            $snapshotRevision++;
        }
        $upd = $pdo->prepare(
            "UPDATE dataset_snapshots
                SET snapshot_hash = ?,
                    row_count = ?,
                    revision_no = ?,
                    last_success_at = NOW()
              WHERE id = ?"
        );
        $upd->execute([$dataHash, $rowCount, $snapshotRevision, (int)$snapshot['id']]);
    } else {
        $ins = $pdo->prepare(
            "INSERT INTO dataset_snapshots
                (tenant_id, dataset_key, params_hash, snapshot_hash, row_count, revision_no, last_success_at)
             VALUES (?, ?, ?, ?, ?, 1, NOW())"
        );
        $ins->execute([$tenantId, $datasetKey, $paramsHash, $dataHash, $rowCount]);
    }

    $updatedRequestCount = update_existing_requests_from_cache($pdo, $tenantId, $datasetKey, $params, $cacheId);

    return [
        'cache_id' => $cacheId,
        'params_hash' => $paramsHash,
        'lookup_json' => $lookupJson,
        'data_hash' => $dataHash,
        'row_count' => $rowCount,
        'revision_no' => $revisionNo,
        'request_uid' => $requestUid,
        'updated_request_count' => $updatedRequestCount,
    ];
}


function update_existing_requests_from_cache(PDO $pdo, string $tenantId, string $datasetKey, array $params, int $cacheId): int
{
    /*
     * Bir dataset web cache'e tekrar yazıldığında, daha önce oluşmuş request kayıtları da
     * aynı cache sonucuna bağlanır. Böylece backend request açtıktan sonra yeni veri gelirse
     * request_status eski sonucu beklemez; result_cache_id aynı güncel cache'i gösterir.
     */
    try {
        $normalizedParamsJson = clean_json(cache_lookup_array($datasetKey, $params));

        if ($datasetKey === 'fis_gunluk_bildirim_feed') {
            // Bildirim feed gün içinde devamlı değişir. MinTutar/SonFisId gibi alanlar cache anahtarı değildir.
            // Bu yüzden son 2 gündeki aynı dataset requestlerini güncel cache'e bağla.
            $stmt = $pdo->prepare(
                "UPDATE sync_requests
                    SET status = 'done',
                        result_cache_id = ?,
                        error_text = NULL,
                        picked_at = COALESCE(picked_at, NOW()),
                        finished_at = NOW()
                  WHERE tenant_id = ?
                    AND dataset_key = ?
                    AND status IN ('queued','running','done')
                    AND created_at >= DATE_SUB(NOW(), INTERVAL 2 DAY)"
            );
            $stmt->execute([$cacheId, $tenantId, $datasetKey]);
            return $stmt->rowCount();
        }

        $stmt = $pdo->prepare(
            "UPDATE sync_requests
                SET status = 'done',
                    result_cache_id = ?,
                    error_text = NULL,
                    picked_at = COALESCE(picked_at, NOW()),
                    finished_at = NOW()
              WHERE tenant_id = ?
                AND dataset_key = ?
                AND params_json = ?
                AND status IN ('queued','running','done')
                AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)"
        );
        $stmt->execute([$cacheId, $tenantId, $datasetKey, $normalizedParamsJson]);
        return $stmt->rowCount();
    } catch (Throwable $e) {
        // Request güncellemesi ana dataset push akışını bozmasın.
        return 0;
    }
}

function assemble_upload(PDO $pdo, string $tenantId, string $uploadId): array
{
    $stmt = $pdo->prepare(
        "SELECT dataset_key, params_hash, part_no, total_parts, chunk_text
           FROM dataset_upload_chunks
          WHERE tenant_id = ? AND upload_id = ?
          ORDER BY part_no ASC"
    );
    $stmt->execute([$tenantId, $uploadId]);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    if (!$rows) {
        respond(['ok' => false, 'error' => 'upload_not_found'], 404);
    }

    $totalParts = (int)$rows[0]['total_parts'];
    if (count($rows) !== $totalParts) {
        respond(['ok' => false, 'error' => 'upload_incomplete', 'received_parts' => count($rows), 'total_parts' => $totalParts], 409);
    }

    $joined = '';
    foreach ($rows as $row) {
        $joined .= (string)$row['chunk_text'];
    }

    $decoded = json_decode($joined, true);
    if ($decoded === null && json_last_error() !== JSON_ERROR_NONE) {
        respond(['ok' => false, 'error' => 'invalid_joined_json', 'details' => json_last_error_msg()], 400);
    }

    return [
        'dataset_key' => (string)$rows[0]['dataset_key'],
        'params_hash' => (string)$rows[0]['params_hash'],
        'data' => $decoded,
    ];
}


function is_paged_dataset(string $datasetKey): bool
{
    // v38 net mimari: stock_list ve cari_bakiye_liste rows değildir; dataset_cache_pages yapısında tutulur.
    return in_array($datasetKey, ['stock_list', 'cari_bakiye_liste'], true);
}

function table_columns(PDO $pdo, string $tableName): array
{
    try {
        $safe = str_replace('`', '``', $tableName);
        $stmt = $pdo->query("SHOW COLUMNS FROM `" . $safe . "`");
        $cols = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $cols[strtolower((string)$row['Field'])] = true;
        }
        return $cols;
    } catch (Throwable $e) {
        return [];
    }
}

function safe_alter(PDO $pdo, string $sql): void
{
    try {
        $pdo->exec($sql);
    } catch (Throwable $e) {
    }
}

function commit_if_active(PDO $pdo): void
{
    if ($pdo->inTransaction()) {
        $pdo->commit();
    }
}

function ensure_dataset_cache_pages(PDO $pdo): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $done = true;

    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS dataset_cache_pages (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            tenant_id VARCHAR(100) NOT NULL,
            dataset_key VARCHAR(100) NOT NULL,
            params_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            page_no INT NOT NULL,
            row_count INT NOT NULL DEFAULT 0,
            data_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
            data_json LONGTEXT NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            PRIMARY KEY (id),
            UNIQUE KEY uniq_dataset_cache_page (tenant_id, dataset_key, params_hash, page_no),
            KEY idx_dataset_cache_page_lookup (tenant_id, dataset_key, params_hash)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    $cols = table_columns($pdo, 'dataset_cache_pages');
    if (!isset($cols['params_hash'])) safe_alter($pdo, "ALTER TABLE dataset_cache_pages ADD COLUMN params_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '' AFTER dataset_key");
    if (!isset($cols['page_no'])) safe_alter($pdo, "ALTER TABLE dataset_cache_pages ADD COLUMN page_no INT NOT NULL DEFAULT 1 AFTER params_hash");
    if (!isset($cols['row_count'])) safe_alter($pdo, "ALTER TABLE dataset_cache_pages ADD COLUMN row_count INT NOT NULL DEFAULT 0 AFTER page_no");
    if (!isset($cols['data_hash'])) safe_alter($pdo, "ALTER TABLE dataset_cache_pages ADD COLUMN data_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL AFTER row_count");
    if (!isset($cols['data_json'])) safe_alter($pdo, "ALTER TABLE dataset_cache_pages ADD COLUMN data_json LONGTEXT NULL AFTER data_hash");
    if (!isset($cols['created_at'])) safe_alter($pdo, "ALTER TABLE dataset_cache_pages ADD COLUMN created_at DATETIME NULL");
    if (!isset($cols['updated_at'])) safe_alter($pdo, "ALTER TABLE dataset_cache_pages ADD COLUMN updated_at DATETIME NULL");

    $cols = table_columns($pdo, 'dataset_cache_pages');
    if (isset($cols['page_json']) && isset($cols['data_json'])) {
        safe_alter($pdo, "UPDATE dataset_cache_pages SET data_json = page_json WHERE (data_json IS NULL OR data_json = '') AND page_json IS NOT NULL");
    }
    safe_alter($pdo, "UPDATE dataset_cache_pages SET data_json = '[]' WHERE data_json IS NULL OR data_json = ''");
    safe_alter($pdo, "ALTER TABLE dataset_cache_pages ADD UNIQUE KEY uniq_dataset_cache_page (tenant_id, dataset_key, params_hash, page_no)");
    safe_alter($pdo, "ALTER TABLE dataset_cache_pages ADD KEY idx_dataset_cache_page_lookup (tenant_id, dataset_key, params_hash)");
}

function ensure_dataset_upload_chunks(PDO $pdo): void
{
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS dataset_upload_chunks (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            tenant_id VARCHAR(100) NOT NULL,
            upload_id VARCHAR(100) NOT NULL,
            dataset_key VARCHAR(100) NOT NULL,
            params_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            part_no INT NOT NULL,
            total_parts INT NOT NULL,
            chunk_text LONGTEXT NULL,
            created_at DATETIME NOT NULL,
            PRIMARY KEY (id),
            UNIQUE KEY uniq_dataset_upload_part (tenant_id, upload_id, part_no),
            KEY idx_dataset_upload_lookup (tenant_id, upload_id, dataset_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    $cols = table_columns($pdo, 'dataset_upload_chunks');
    if (!isset($cols['dataset_key'])) safe_alter($pdo, "ALTER TABLE dataset_upload_chunks ADD COLUMN dataset_key VARCHAR(100) NOT NULL DEFAULT '' AFTER upload_id");
    if (!isset($cols['params_hash'])) safe_alter($pdo, "ALTER TABLE dataset_upload_chunks ADD COLUMN params_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '' AFTER dataset_key");
    if (!isset($cols['part_no'])) safe_alter($pdo, "ALTER TABLE dataset_upload_chunks ADD COLUMN part_no INT NOT NULL DEFAULT 1 AFTER params_hash");
    if (!isset($cols['total_parts'])) safe_alter($pdo, "ALTER TABLE dataset_upload_chunks ADD COLUMN total_parts INT NOT NULL DEFAULT 1 AFTER part_no");
    if (!isset($cols['chunk_text'])) safe_alter($pdo, "ALTER TABLE dataset_upload_chunks ADD COLUMN chunk_text LONGTEXT NULL AFTER total_parts");
    if (!isset($cols['created_at'])) safe_alter($pdo, "ALTER TABLE dataset_upload_chunks ADD COLUMN created_at DATETIME NULL");
    safe_alter($pdo, "ALTER TABLE dataset_upload_chunks ADD UNIQUE KEY uniq_dataset_upload_part (tenant_id, upload_id, part_no)");
}

function save_dataset_cache_meta(PDO $pdo, string $tenantId, string $datasetKey, array $params, int $rowCount, string $dataHash, ?array $extraMeta = null): array
{
    $paramsJson = clean_json($params);
    $lookupJson = cache_lookup_json($datasetKey, $params);
    $paramsHash = sha256_hex($lookupJson);
    $metaJson = clean_json([
        'paged' => true,
        'row_count' => $rowCount,
        'meta' => $extraMeta ?: [],
    ]);

    $stmt = $pdo->prepare(
        "SELECT id, revision_no, data_hash
           FROM dataset_cache
          WHERE tenant_id = ? AND dataset_key = ? AND params_hash = ?
          LIMIT 1"
    );
    $stmt->execute([$tenantId, $datasetKey, $paramsHash]);
    $existing = $stmt->fetch(PDO::FETCH_ASSOC);

    if ($existing) {
        $cacheId = (int)$existing['id'];
        $revisionNo = (int)$existing['revision_no'];
        if (!hash_equals((string)$existing['data_hash'], $dataHash)) {
            $revisionNo++;
        }

        $upd = $pdo->prepare(
            "UPDATE dataset_cache
                SET params_json = ?,
                    data_json = ?,
                    row_count = ?,
                    data_hash = ?,
                    revision_no = ?,
                    synced_at = NOW(),
                    updated_at = NOW()
              WHERE id = ?"
        );
        $upd->execute([$paramsJson, $metaJson, $rowCount, $dataHash, $revisionNo, $cacheId]);
    } else {
        $revisionNo = 1;
        $ins = $pdo->prepare(
            "INSERT INTO dataset_cache
                (tenant_id, dataset_key, params_hash, params_json, data_json, row_count, data_hash, revision_no, synced_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1, NOW(), NOW(), NOW())"
        );
        $ins->execute([$tenantId, $datasetKey, $paramsHash, $paramsJson, $metaJson, $rowCount, $dataHash]);
        $cacheId = (int)$pdo->lastInsertId();
    }

    $stmt = $pdo->prepare(
        "SELECT id, revision_no, snapshot_hash
           FROM dataset_snapshots
          WHERE tenant_id = ? AND dataset_key = ? AND params_hash = ?
          LIMIT 1"
    );
    $stmt->execute([$tenantId, $datasetKey, $paramsHash]);
    $snapshot = $stmt->fetch(PDO::FETCH_ASSOC);

    if ($snapshot) {
        $snapshotRevision = (int)$snapshot['revision_no'];
        if (!hash_equals((string)$snapshot['snapshot_hash'], $dataHash)) {
            $snapshotRevision++;
        }
        $upd = $pdo->prepare(
            "UPDATE dataset_snapshots
                SET snapshot_hash = ?,
                    row_count = ?,
                    revision_no = ?,
                    last_success_at = NOW()
              WHERE id = ?"
        );
        $upd->execute([$dataHash, $rowCount, $snapshotRevision, (int)$snapshot['id']]);
    } else {
        $ins = $pdo->prepare(
            "INSERT INTO dataset_snapshots
                (tenant_id, dataset_key, params_hash, snapshot_hash, row_count, revision_no, last_success_at)
             VALUES (?, ?, ?, ?, ?, 1, NOW())"
        );
        $ins->execute([$tenantId, $datasetKey, $paramsHash, $dataHash, $rowCount]);
    }

    $updatedRequestCount = update_existing_requests_from_cache($pdo, $tenantId, $datasetKey, $params, $cacheId);

    return [
        'cache_id' => $cacheId,
        'params_hash' => $paramsHash,
        'lookup_json' => $lookupJson,
        'data_hash' => $dataHash,
        'row_count' => $rowCount,
        'revision_no' => $revisionNo,
        'paged' => true,
        'updated_request_count' => $updatedRequestCount,
    ];
}

function is_delta_dataset(string $datasetKey): bool
{
    // v38 net mimari: sadece hourly_stock_detail rows/delta yapısında tutulur.
    // stock_list ve cari_bakiye_liste dataset_cache_pages içindedir.
    return in_array($datasetKey, ['hourly_stock_detail'], true);
}

function ensure_dataset_cache_rows(PDO $pdo): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $done = true;

    /*
     * Eski MySQL/Plesk kurulumlarında 1071 "Specified key was too long" hatası
     * tenant_id + dataset_key + params_hash + row_key indeksinden geliyordu.
     * Bu yüzden benzersiz anahtar artık uzun row_key yerine 64 karakterlik row_key_hash kullanır.
     */
    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS dataset_cache_rows (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            tenant_id VARCHAR(100) NOT NULL,
            dataset_key VARCHAR(100) NOT NULL,
            params_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            row_key VARCHAR(255) NOT NULL,
            row_key_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            row_uid_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
            row_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
            row_json LONGTEXT NULL,
            deleted_at DATETIME NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            PRIMARY KEY (id),
            UNIQUE KEY uniq_dataset_cache_row_uid (row_uid_hash),
            KEY idx_dataset_cache_rows_lookup (tenant_id(32), dataset_key(32), params_hash, deleted_at),
            KEY idx_dataset_cache_rows_updated (tenant_id(32), dataset_key(32), updated_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    $cols = table_columns($pdo, 'dataset_cache_rows');
    if (!isset($cols['params_hash'])) safe_alter($pdo, "ALTER TABLE dataset_cache_rows ADD COLUMN params_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '' AFTER dataset_key");
    if (!isset($cols['row_key'])) safe_alter($pdo, "ALTER TABLE dataset_cache_rows ADD COLUMN row_key VARCHAR(255) NOT NULL DEFAULT '' AFTER params_hash");
    if (!isset($cols['row_key_hash'])) safe_alter($pdo, "ALTER TABLE dataset_cache_rows ADD COLUMN row_key_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '' AFTER row_key");
    if (!isset($cols['row_uid_hash'])) safe_alter($pdo, "ALTER TABLE dataset_cache_rows ADD COLUMN row_uid_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '' AFTER row_key_hash");
    if (!isset($cols['row_hash'])) safe_alter($pdo, "ALTER TABLE dataset_cache_rows ADD COLUMN row_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL AFTER row_uid_hash");
    if (!isset($cols['row_json'])) safe_alter($pdo, "ALTER TABLE dataset_cache_rows ADD COLUMN row_json LONGTEXT NULL AFTER row_hash");
    if (!isset($cols['deleted_at'])) safe_alter($pdo, "ALTER TABLE dataset_cache_rows ADD COLUMN deleted_at DATETIME NULL AFTER row_json");
    if (!isset($cols['created_at'])) safe_alter($pdo, "ALTER TABLE dataset_cache_rows ADD COLUMN created_at DATETIME NULL");
    if (!isset($cols['updated_at'])) safe_alter($pdo, "ALTER TABLE dataset_cache_rows ADD COLUMN updated_at DATETIME NULL");

    // Eski uzun indeksler varsa kaldırmayı dene; yoksa sessiz geç.
    safe_alter($pdo, "ALTER TABLE dataset_cache_rows DROP INDEX uniq_dataset_cache_row");
    safe_alter($pdo, "ALTER TABLE dataset_cache_rows DROP INDEX uniq_dataset_cache_row_hash");

    // Var olan eski kayıtlara hash üret.
    safe_alter($pdo, "UPDATE dataset_cache_rows SET row_key_hash = SHA2(row_key, 256) WHERE row_key_hash IS NULL OR row_key_hash = ''");
    safe_alter($pdo, "UPDATE dataset_cache_rows SET row_uid_hash = SHA2(CONCAT(tenant_id, '|', dataset_key, '|', params_hash, '|', row_key), 256) WHERE row_uid_hash IS NULL OR row_uid_hash = ''");

    // Eski MySQL'de uzun composite index 1071 hatası verir. Tek 64 karakterlik UID hash ile güvenli unique kullanıyoruz.
    safe_alter($pdo, "ALTER TABLE dataset_cache_rows ADD UNIQUE KEY uniq_dataset_cache_row_uid (row_uid_hash)");
    safe_alter($pdo, "ALTER TABLE dataset_cache_rows ADD KEY idx_dataset_cache_rows_lookup (tenant_id(32), dataset_key(32), params_hash, deleted_at)");
}

function save_dataset_cache_rows_meta(PDO $pdo, string $tenantId, string $datasetKey, array $params, int $rowCount, string $dataHash, ?array $extraMeta = null): array
{
    $paramsJson = clean_json($params);
    $lookupJson = cache_lookup_json($datasetKey, $params);
    $paramsHash = sha256_hex($lookupJson);
    $metaJson = clean_json([
        'delta_rows' => true,
        'row_count' => $rowCount,
        'meta' => $extraMeta ?: [],
    ]);

    $stmt = $pdo->prepare(
        "SELECT id, revision_no, data_hash
           FROM dataset_cache
          WHERE tenant_id = ? AND dataset_key = ? AND params_hash = ?
          LIMIT 1"
    );
    $stmt->execute([$tenantId, $datasetKey, $paramsHash]);
    $existing = $stmt->fetch(PDO::FETCH_ASSOC);

    if ($existing) {
        $cacheId = (int)$existing['id'];
        $revisionNo = (int)$existing['revision_no'];
        if (!hash_equals((string)$existing['data_hash'], $dataHash)) {
            $revisionNo++;
        }
        $upd = $pdo->prepare(
            "UPDATE dataset_cache
                SET params_json = ?,
                    data_json = ?,
                    row_count = ?,
                    data_hash = ?,
                    revision_no = ?,
                    synced_at = NOW(),
                    updated_at = NOW()
              WHERE id = ?"
        );
        $upd->execute([$paramsJson, $metaJson, $rowCount, $dataHash, $revisionNo, $cacheId]);
    } else {
        $revisionNo = 1;
        $ins = $pdo->prepare(
            "INSERT INTO dataset_cache
                (tenant_id, dataset_key, params_hash, params_json, data_json, row_count, data_hash, revision_no, synced_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 1, NOW(), NOW(), NOW())"
        );
        $ins->execute([$tenantId, $datasetKey, $paramsHash, $paramsJson, $metaJson, $rowCount, $dataHash]);
        $cacheId = (int)$pdo->lastInsertId();
    }

    $stmt = $pdo->prepare(
        "SELECT id, revision_no, snapshot_hash
           FROM dataset_snapshots
          WHERE tenant_id = ? AND dataset_key = ? AND params_hash = ?
          LIMIT 1"
    );
    $stmt->execute([$tenantId, $datasetKey, $paramsHash]);
    $snapshot = $stmt->fetch(PDO::FETCH_ASSOC);

    if ($snapshot) {
        $snapshotRevision = (int)$snapshot['revision_no'];
        if (!hash_equals((string)$snapshot['snapshot_hash'], $dataHash)) {
            $snapshotRevision++;
        }
        $upd = $pdo->prepare(
            "UPDATE dataset_snapshots
                SET snapshot_hash = ?,
                    row_count = ?,
                    revision_no = ?,
                    last_success_at = NOW()
              WHERE id = ?"
        );
        $upd->execute([$dataHash, $rowCount, $snapshotRevision, (int)$snapshot['id']]);
    } else {
        $ins = $pdo->prepare(
            "INSERT INTO dataset_snapshots
                (tenant_id, dataset_key, params_hash, snapshot_hash, row_count, revision_no, last_success_at)
             VALUES (?, ?, ?, ?, ?, 1, NOW())"
        );
        $ins->execute([$tenantId, $datasetKey, $paramsHash, $dataHash, $rowCount]);
    }

    $updatedRequestCount = update_existing_requests_from_cache($pdo, $tenantId, $datasetKey, $params, $cacheId);

    return [
        'cache_id' => $cacheId,
        'params_hash' => $paramsHash,
        'lookup_json' => $lookupJson,
        'data_hash' => $dataHash,
        'row_count' => $rowCount,
        'revision_no' => $revisionNo,
        'delta_rows' => true,
        'updated_request_count' => $updatedRequestCount,
    ];
}

function dataset_rows_response(PDO $pdo, string $tenantId, string $datasetKey, array $params, array $cacheRow): ?array
{
    if (!is_delta_dataset($datasetKey)) {
        return null;
    }

    ensure_dataset_cache_rows($pdo);
    $paramsHash = sha256_hex(cache_lookup_json($datasetKey, $params));
    $page = max(1, (int)first_non_empty(['page', 'sayfa'], $params, 1));
    $pageSize = max(1, min(1000, (int)first_non_empty(['page_size', 'limit', 'take'], $params, 100)));
    $offset = ($page - 1) * $pageSize;

    $hasFilter = trim((string)first_non_empty(['search', 'q', 'arama', 'FIYAT_AD', 'FIYAT_ADI', 'fiyat_ad', 'fiyat_adi'], $params, '')) !== '';
    $out = [];
    $totalMatched = 0;

    if (!$hasFilter) {
        $stmt = $pdo->prepare(
            "SELECT COUNT(*)
               FROM dataset_cache_rows
              WHERE tenant_id = ? AND dataset_key = ? AND params_hash = ? AND deleted_at IS NULL"
        );
        $stmt->execute([$tenantId, $datasetKey, $paramsHash]);
        $totalMatched = (int)$stmt->fetchColumn();

        $stmt = $pdo->prepare(
            "SELECT row_json
               FROM dataset_cache_rows
              WHERE tenant_id = ? AND dataset_key = ? AND params_hash = ? AND deleted_at IS NULL
              ORDER BY id ASC
              LIMIT " . (int)$pageSize . " OFFSET " . (int)$offset
        );
        $stmt->execute([$tenantId, $datasetKey, $paramsHash]);
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $decoded = json_decode((string)$row['row_json'], true);
            if (is_array($decoded)) {
                $out[] = $decoded;
            }
        }
    } else {
        $stmt = $pdo->prepare(
            "SELECT row_json
               FROM dataset_cache_rows
              WHERE tenant_id = ? AND dataset_key = ? AND params_hash = ? AND deleted_at IS NULL
              ORDER BY id ASC"
        );
        $stmt->execute([$tenantId, $datasetKey, $paramsHash]);
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $decoded = json_decode((string)$row['row_json'], true);
            if (!is_array($decoded) || !row_matches_dataset_filters($decoded, $datasetKey, $params)) {
                continue;
            }
            $totalMatched++;
            if ($totalMatched > $offset && count($out) < $pageSize) {
                $out[] = $decoded;
            }
        }
    }

    if ($totalMatched === 0 && (int)$cacheRow['row_count'] === 0) {
        return null;
    }

    $totalPages = $pageSize > 0 ? (int)ceil($totalMatched / $pageSize) : 1;

    return [
        'ok' => true,
        'lazy' => true,
        'delta_rows' => true,
        'cache_id' => (int)$cacheRow['id'],
        'dataset_key' => (string)$cacheRow['dataset_key'],
        'params' => json_decode((string)$cacheRow['params_json'], true) ?: [],
        'data' => $out,
        'page' => $page,
        'page_size' => $pageSize,
        'total_pages' => $totalPages,
        'total_row_count' => $totalMatched,
        'row_count' => count($out),
        'has_more' => $page < $totalPages,
        'data_hash' => (string)$cacheRow['data_hash'],
        'revision_no' => (int)$cacheRow['revision_no'],
        'synced_at' => (string)$cacheRow['synced_at'],
    ];
}

function row_matches_dataset_filters(array $row, string $datasetKey, array $params): bool
{
    if ($datasetKey === 'stock_list') {
        $fiyatId = first_non_empty(['FIYAT_AD', 'fiyat_ad', 'FIYAT_AD_ID', 'fiyat_ad_id'], $params, null);
        if ($fiyatId !== null && $fiyatId !== '' && (string)$fiyatId !== '0') {
            $hasField = array_key_exists('FIYAT_AD', $row) || array_key_exists('FIYAT_AD_ID', $row) || array_key_exists('fiyat_ad', $row);
            if ($hasField) {
                $rowFiyat = first_non_empty(['FIYAT_AD', 'FIYAT_AD_ID', 'fiyat_ad', 'fiyat_ad_id'], $row, null);
                if ((string)$rowFiyat !== (string)$fiyatId) {
                    return false;
                }
            }
        }

        $fiyatAdi = first_non_empty(['FIYAT_ADI', 'fiyat_adi', 'FIYAT_LISTE_ADI'], $params, null);
        if ($fiyatAdi !== null && $fiyatAdi !== '') {
            $hasField = array_key_exists('FIYAT_ADI', $row) || array_key_exists('FIYAT_LISTE_ADI', $row) || array_key_exists('fiyat_adi', $row);
            if ($hasField) {
                $rowFiyatAdi = first_non_empty(['FIYAT_ADI', 'FIYAT_LISTE_ADI', 'fiyat_adi'], $row, '');
                if (strtolower((string)$rowFiyatAdi) !== strtolower((string)$fiyatAdi)) {
                    return false;
                }
            }
        }
    }


    // Genel rows filtreleri: page/page_size/search gibi kontrol alanları dışındaki parametreler,
    // satırda aynı isimli kolon varsa eşitlik filtresi olarak uygulanır.
    $ignoreParams = [
        'page' => true, 'sayfa' => true, 'page_size' => true, 'limit' => true, 'take' => true,
        'search' => true, 'q' => true, 'arama' => true,
    ];
    foreach ($params as $pKey => $pValue) {
        $pKeyStr = (string)$pKey;
        if (isset($ignoreParams[strtolower($pKeyStr)])) {
            continue;
        }
        if ($pValue === null || $pValue === '' || (is_string($pValue) && trim($pValue) === '')) {
            continue;
        }
        $candidateKeys = [$pKeyStr, strtoupper($pKeyStr), strtolower($pKeyStr)];
        $matchedColumn = false;
        foreach ($candidateKeys as $ck) {
            if (array_key_exists($ck, $row)) {
                $matchedColumn = true;
                if ((string)$row[$ck] !== (string)$pValue) {
                    return false;
                }
                break;
            }
        }
        // Satırda o alan yoksa filtreyi zorlamıyoruz; params_hash zaten ana kapsamı ayırıyor.
    }

    $search = trim((string)first_non_empty(['search', 'q', 'arama'], $params, ''));
    if ($search !== '') {
        $needle = strtolower($search);
        $found = false;
        foreach ($row as $value) {
            if (is_scalar($value) || $value === null) {
                $hay = strtolower((string)$value);
                if ($hay !== '' && strpos($hay, $needle) !== false) {
                    $found = true;
                    break;
                }
            }
        }
        if (!$found) {
            return false;
        }
    }

    return true;
}


function paged_row_first_non_empty(array $keys, array $row, $default = null)
{
    foreach ($keys as $key) {
        if (array_key_exists($key, $row)) {
            $val = $row[$key];
            if ($val !== null && $val !== '') {
                return $val;
            }
        }
    }
    return $default;
}

function paged_dataset_row_key(string $datasetKey, array $row): string
{
    if ($datasetKey === 'stock_list') {
        $parts = [];
        $fiyat = paged_row_first_non_empty(['FIYAT_AD', 'FIYAT_AD_ID', 'fiyat_ad', 'fiyat_ad_id', 'STOK_FIYAT_AD'], $row, null);
        $stok = paged_row_first_non_empty(['STOK_ID', 'stok_id', 'STOK', 'stok', 'ID', 'id', 'STOK_KODU', 'stok_kodu', 'KOD', 'kod', 'BARKOD', 'barkod'], $row, null);
        $birim = paged_row_first_non_empty(['BIRIM_ID', 'birim_id', 'STOK_BIRIM', 'stok_birim', 'BIRIM', 'birim', 'BIRIM_ADI', 'birim_adi'], $row, null);
        if ($fiyat !== null) $parts[] = 'FIYAT_AD:' . trim((string)$fiyat);
        if ($stok !== null) $parts[] = 'STOK:' . trim((string)$stok);
        if ($birim !== null) $parts[] = 'BIRIM:' . trim((string)$birim);
        if ($parts) return $datasetKey . ':' . implode('|', $parts);
        foreach (['BARKOD', 'barkod', 'KOD', 'kod', 'STOK_KODU', 'stok_kodu'] as $key) {
            if (isset($row[$key]) && trim((string)$row[$key]) !== '') return $datasetKey . ':' . $key . ':' . trim((string)$row[$key]);
        }
    }

    if ($datasetKey === 'cari_bakiye_liste') {
        foreach (['CARI_ID', 'cari_id', 'CARI', 'cari', 'ID', 'id', 'KOD', 'kod', 'CARI_KODU', 'cari_kodu'] as $key) {
            if (isset($row[$key]) && trim((string)$row[$key]) !== '') return $datasetKey . ':' . $key . ':' . trim((string)$row[$key]);
        }
    }

    return $datasetKey . ':hash:' . sha256_hex(clean_json($row));
}

function split_rows_for_page_storage(array $rows, int $maxBytes = 450000, int $maxRows = 10000): array
{
    $pages = [];
    $batch = [];
    $batchBytes = 2;

    foreach ($rows as $row) {
        $rowJson = clean_json($row);
        $rowBytes = strlen($rowJson) + ($batch ? 1 : 0);
        if ($batch && (count($batch) >= $maxRows || ($batchBytes + $rowBytes) > $maxBytes)) {
            $pages[] = $batch;
            $batch = [];
            $batchBytes = 2;
        }
        $batch[] = $row;
        $batchBytes += $rowBytes;
    }
    if ($batch) {
        $pages[] = $batch;
    }
    return $pages;
}

function paged_dataset_response(PDO $pdo, string $tenantId, string $datasetKey, array $params, array $cacheRow): ?array
{
    if (!is_paged_dataset($datasetKey)) {
        return null;
    }

    ensure_dataset_cache_pages($pdo);
            ensure_dataset_upload_chunks($pdo);

    $paramsHash = sha256_hex(cache_lookup_json($datasetKey, $params));
    $stmt = $pdo->prepare(
        "SELECT page_no, row_count, data_json
           FROM dataset_cache_pages
          WHERE tenant_id = ? AND dataset_key = ? AND params_hash = ?
          ORDER BY page_no ASC"
    );
    $stmt->execute([$tenantId, $datasetKey, $paramsHash]);
    $pages = $stmt->fetchAll(PDO::FETCH_ASSOC);

    if (!$pages) {
        return null;
    }

    $page = max(1, (int)first_non_empty(['page', 'sayfa'], $params, 1));
    $pageSize = max(1, min(1000, (int)first_non_empty(['page_size', 'limit', 'take'], $params, 100)));
    $offset = ($page - 1) * $pageSize;

    $totalMatched = 0;
    $out = [];

    foreach ($pages as $pageRow) {
        $rows = json_decode((string)$pageRow['data_json'], true);
        if (!is_array($rows)) {
            continue;
        }

        foreach ($rows as $row) {
            if (!is_array($row)) {
                continue;
            }
            if (!row_matches_dataset_filters($row, $datasetKey, $params)) {
                continue;
            }

            $totalMatched++;
            if ($totalMatched > $offset && count($out) < $pageSize) {
                $out[] = $row;
            }
        }
    }

    $totalPages = $pageSize > 0 ? (int)ceil($totalMatched / $pageSize) : 1;

    return [
        'ok' => true,
        'lazy' => true,
        'paged' => true,
        'cache_id' => (int)$cacheRow['id'],
        'dataset_key' => (string)$cacheRow['dataset_key'],
        'params' => json_decode((string)$cacheRow['params_json'], true) ?: [],
        'data' => $out,
        'page' => $page,
        'page_size' => $pageSize,
        'total_pages' => $totalPages,
        'total_row_count' => $totalMatched,
        'row_count' => count($out),
        'has_more' => $page < $totalPages,
        'data_hash' => (string)$cacheRow['data_hash'],
        'revision_no' => (int)$cacheRow['revision_no'],
        'synced_at' => (string)$cacheRow['synced_at'],
    ];
}



function reset_stale_running_requests(PDO $pdo, string $tenantId, ?string $datasetKey = null, int $timeoutSeconds = 120): void
{
    try {
        $timeoutSeconds = max(30, min(3600, $timeoutSeconds));
        if ($datasetKey !== null && $datasetKey !== '') {
            $stmt = $pdo->prepare(
                "UPDATE sync_requests
                    SET status = 'queued',
                        error_text = NULL,
                        picked_at = NULL
                  WHERE tenant_id = ?
                    AND dataset_key = ?
                    AND status = 'running'
                    AND picked_at IS NOT NULL
                    AND picked_at < DATE_SUB(NOW(), INTERVAL ? SECOND)"
            );
            $stmt->execute([$tenantId, $datasetKey, $timeoutSeconds]);
        } else {
            $stmt = $pdo->prepare(
                "UPDATE sync_requests
                    SET status = 'queued',
                        error_text = NULL,
                        picked_at = NULL
                  WHERE tenant_id = ?
                    AND status = 'running'
                    AND picked_at IS NOT NULL
                    AND picked_at < DATE_SUB(NOW(), INTERVAL ? SECOND)"
            );
            $stmt->execute([$tenantId, $timeoutSeconds]);
        }
    } catch (Throwable $e) {
        // Ana request akışını bozmasın.
    }
}

function boolish_value($value, bool $default = false): bool
{
    if ($value === null || $value === '') {
        return $default;
    }
    if (is_bool($value)) {
        return $value;
    }
    if (is_numeric($value)) {
        return ((int)$value) !== 0;
    }
    $s = strtolower(trim((string)$value));
    if (in_array($s, ['1', 'true', 'yes', 'evet', 'on'], true)) {
        return true;
    }
    if (in_array($s, ['0', 'false', 'no', 'hayir', 'hayır', 'off'], true)) {
        return false;
    }
    return $default;
}

function request_cache_allowed(array $input, array $params): bool
{
    if (boolish_value($input['force_refresh'] ?? null, false) || boolish_value($params['force_refresh'] ?? null, false)) {
        return false;
    }
    if (boolish_value($input['no_cache'] ?? null, false) || boolish_value($params['no_cache'] ?? null, false)) {
        return false;
    }
    return boolish_value($input['prefer_cache'] ?? ($params['prefer_cache'] ?? null), true);
}


function ensure_pending_price_updates(PDO $pdo): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $done = true;

    $pdo->exec(
        "CREATE TABLE IF NOT EXISTS pending_price_updates (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            user_id BIGINT NULL,
            tenant_id VARCHAR(100) NOT NULL,
            product_id VARCHAR(64) NOT NULL,
            stok_stok_birim_id VARCHAR(64) NOT NULL,
            product_barcode VARCHAR(64) NULL,
            product_name VARCHAR(255) NULL,
            price_name_id BIGINT NULL,
            price_name VARCHAR(100) NULL,
            old_price DECIMAL(15,2) NULL,
            new_price DECIMAL(15,2) NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'pending',
            source VARCHAR(20) NULL DEFAULT 'mobile',
            batch_id VARCHAR(64) NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            applied_at DATETIME NULL,
            error_message VARCHAR(500) NULL,
            notes VARCHAR(500) NULL,
            PRIMARY KEY (id),
            KEY idx_tenant_status (tenant_id, status),
            KEY idx_user_created (user_id, created_at),
            KEY idx_batch (batch_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    );

    $cols = table_columns($pdo, 'pending_price_updates');
    if (!isset($cols['stok_stok_birim_id'])) safe_alter($pdo, "ALTER TABLE pending_price_updates ADD COLUMN stok_stok_birim_id VARCHAR(64) NOT NULL DEFAULT '' AFTER product_id");
    if (!isset($cols['price_name_id'])) safe_alter($pdo, "ALTER TABLE pending_price_updates ADD COLUMN price_name_id BIGINT NULL AFTER product_name");
    if (!isset($cols['price_name'])) safe_alter($pdo, "ALTER TABLE pending_price_updates ADD COLUMN price_name VARCHAR(100) NULL AFTER price_name_id");
    if (!isset($cols['old_price'])) safe_alter($pdo, "ALTER TABLE pending_price_updates ADD COLUMN old_price DECIMAL(15,2) NULL AFTER price_name");
    if (!isset($cols['new_price'])) safe_alter($pdo, "ALTER TABLE pending_price_updates ADD COLUMN new_price DECIMAL(15,2) NOT NULL DEFAULT 0 AFTER old_price");
    if (!isset($cols['status'])) safe_alter($pdo, "ALTER TABLE pending_price_updates ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'pending' AFTER new_price");
    if (!isset($cols['applied_at'])) safe_alter($pdo, "ALTER TABLE pending_price_updates ADD COLUMN applied_at DATETIME NULL AFTER created_at");
    if (!isset($cols['error_message'])) safe_alter($pdo, "ALTER TABLE pending_price_updates ADD COLUMN error_message VARCHAR(500) NULL AFTER applied_at");
    safe_alter($pdo, "ALTER TABLE pending_price_updates ADD KEY idx_tenant_status (tenant_id, status)");
}

function normalize_id_list($value): array
{
    if (!is_array($value)) {
        return [];
    }
    $out = [];
    foreach ($value as $id) {
        if (is_numeric($id) && (int)$id > 0) {
            $out[] = (int)$id;
        }
    }
    return array_values(array_unique($out));
}

function request_cache_ttl_seconds(array $input, array $params): int
{
    $ttl = first_non_empty(['cache_ttl_sec', 'ttl_sec', 'cache_ttl_seconds'], $input, null);
    if ($ttl === null) {
        $ttl = first_non_empty(['cache_ttl_sec', 'ttl_sec', 'cache_ttl_seconds'], $params, 0);
    }
    return max(0, min(86400, (int)$ttl));
}

function find_dataset_cache_row(PDO $pdo, string $tenantId, string $datasetKey, array $params, int $ttlSeconds = 0): ?array
{
    $paramsHash = sha256_hex(cache_lookup_json($datasetKey, $params));
    if ($ttlSeconds > 0) {
        $stmt = $pdo->prepare(
            "SELECT id, dataset_key, params_json, data_json, row_count, data_hash, revision_no, synced_at
               FROM dataset_cache
              WHERE tenant_id = ? AND dataset_key = ? AND params_hash = ?
                AND synced_at IS NOT NULL
                AND synced_at >= DATE_SUB(NOW(), INTERVAL ? SECOND)
              LIMIT 1"
        );
        $stmt->execute([$tenantId, $datasetKey, $paramsHash, $ttlSeconds]);
    } else {
        $stmt = $pdo->prepare(
            "SELECT id, dataset_key, params_json, data_json, row_count, data_hash, revision_no, synced_at
               FROM dataset_cache
              WHERE tenant_id = ? AND dataset_key = ? AND params_hash = ?
              LIMIT 1"
        );
        $stmt->execute([$tenantId, $datasetKey, $paramsHash]);
    }
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return $row ?: null;
}

function create_done_request_from_cache(PDO $pdo, string $tenantId, string $datasetKey, string $paramsJson, string $requestedBy, int $priorityNo, int $cacheId): string
{
    $requestUid = bin2hex(random_bytes(16));
    $stmt = $pdo->prepare(
        "INSERT INTO sync_requests
            (tenant_id, dataset_key, request_uid, params_json, priority_no, status, requested_by, result_cache_id, created_at, finished_at)
         VALUES (?, ?, ?, ?, ?, 'done', ?, ?, NOW(), NOW())"
    );
    $stmt->execute([$tenantId, $datasetKey, $requestUid, $paramsJson, $priorityNo, $requestedBy, $cacheId]);
    return $requestUid;
}


function norm_scalar_string($value): string
{
    if ($value === null) return '';
    return trim((string)$value);
}

function row_first_non_empty(array $keys, array $row, $default = null)
{
    foreach ($keys as $key) {
        if (array_key_exists($key, $row)) {
            $val = $row[$key];
            if ($val !== null && $val !== '') {
                return $val;
            }
        }
    }
    return $default;
}

function filter_fis_gunluk_bildirim_feed_rows(array $rows, array $params): array
{
    $minTutar = (float)first_non_empty(['MinTutar', 'min_tutar', 'high_sales_threshold'], $params, 0);
    $sonFisId = (int)first_non_empty(['SonFisId', 'son_fis_id'], $params, 0);
    $lokasyon = norm_scalar_string(first_non_empty(['Lokasyon', 'lokasyon', 'LOKASYON'], $params, ''));
    $personel = norm_scalar_string(first_non_empty(['Personel', 'personel', 'PERSONEL'], $params, ''));
    $fisTuru = norm_scalar_string(first_non_empty(['FisTuru', 'fis_turu', 'FIS_TURU'], $params, ''));

    $out = [];
    foreach ($rows as $row) {
        if (!is_array($row)) {
            continue;
        }

        $bildirimlik = row_first_non_empty(['BILDIRIMLIK', 'bildirimlik'], $row, null);
        if ($bildirimlik !== null && !in_array((string)$bildirimlik, ['1', 'True', 'true', 'TRUE'], true)) {
            continue;
        }

        $tutar = (float)row_first_non_empty(['TUTAR', 'GENELTOPLAM', 'GENEL_TOPLAM', 'TOPLAM_TUTAR', 'tutar'], $row, 0);
        if ($minTutar > 0 && $tutar < $minTutar) {
            continue;
        }

        $fisId = (int)row_first_non_empty(['FIS_ID', 'FISID', 'ID', 'BELGE_ID', 'fis_id'], $row, 0);
        if ($sonFisId > 0 && $fisId <= $sonFisId) {
            continue;
        }

        if ($lokasyon !== '') {
            $rowLokasyon = norm_scalar_string(row_first_non_empty(['LOKASYON', 'LOKASYON_ID', 'Lokasyon', 'lokasyon'], $row, ''));
            if ($rowLokasyon !== '' && $rowLokasyon !== $lokasyon) {
                continue;
            }
        }

        if ($personel !== '') {
            $rowPersonel = norm_scalar_string(row_first_non_empty(['PERSONEL', 'PERSONEL_ID', 'CARI_PERSONEL', 'personel'], $row, ''));
            if ($rowPersonel !== '' && $rowPersonel !== $personel) {
                continue;
            }
        }

        if ($fisTuru !== '') {
            $rowFisTuru = norm_scalar_string(row_first_non_empty(['FIS_TURU', 'FISTURU', 'fis_turu'], $row, ''));
            if ($rowFisTuru !== '' && $rowFisTuru !== $fisTuru) {
                continue;
            }
        }

        $out[] = $row;
    }
    return $out;
}

function filter_rap_filtre_lookup_rows(array $rows, array $params): array
{
    $kaynak = trim((string)first_non_empty(['Kaynak', 'kaynak', 'KAYNAK', 'source', 'SOURCE'], $params, ''));
    $q = mb_strtolower(trim((string)first_non_empty(['Q', 'q', 'search', 'arama'], $params, '')), 'UTF-8');

    if ($kaynak === '' && $q === '') {
        return $rows;
    }

    $out = [];
    foreach ($rows as $row) {
        if (!is_array($row)) {
            continue;
        }

        if ($kaynak !== '') {
            $rowKaynak = (string)first_non_empty(['Kaynak', 'kaynak', 'KAYNAK', 'source', 'SOURCE'], $row, '');
            if ($rowKaynak !== '' && mb_strtolower($rowKaynak, 'UTF-8') !== mb_strtolower($kaynak, 'UTF-8')) {
                continue;
            }
        }

        if ($q !== '') {
            $found = false;
            foreach ($row as $value) {
                if (is_scalar($value) || $value === null) {
                    if (mb_strpos(mb_strtolower((string)$value, 'UTF-8'), $q, 0, 'UTF-8') !== false) {
                        $found = true;
                        break;
                    }
                }
            }
            if (!$found) {
                continue;
            }
        }

        $out[] = $row;
    }
    return $out;
}

function paginate_plain_rows(array $rows, array $params): array
{
    $page = max(1, (int)first_non_empty(['page', 'Page', 'sayfa'], $params, 1));
    $pageSize = max(1, min(1000, (int)first_non_empty(['page_size', 'PageSize', 'limit', 'take'], $params, count($rows) > 0 ? count($rows) : 100)));
    $total = count($rows);
    $offset = ($page - 1) * $pageSize;
    return [
        'rows' => array_slice($rows, $offset, $pageSize),
        'page' => $page,
        'page_size' => $pageSize,
        'total_pages' => $pageSize > 0 ? (int)ceil($total / $pageSize) : 1,
        'total_row_count' => $total,
        'has_more' => $page < ($pageSize > 0 ? (int)ceil($total / $pageSize) : 1),
    ];
}



function is_acik_masa_pos_currently_open(PDO $pdo, string $tenantId, array $params): bool
{
    $wanted = (string)first_non_empty(['POS_ID', 'pos_id', 'POSID', 'POS_GECICI'], $params, '');
    if ($wanted === '' || $wanted === '0') {
        return false;
    }

    $openParamsHash = sha256_hex(cache_lookup_json('acik_masalar', []));
    $stmt = $pdo->prepare(
        "SELECT data_json
           FROM dataset_cache
          WHERE tenant_id = ? AND dataset_key = 'acik_masalar' AND params_hash = ?
          LIMIT 1"
    );
    $stmt->execute([$tenantId, $openParamsHash]);
    $json = $stmt->fetchColumn();
    if (!$json) {
        return false;
    }

    $rows = json_decode((string)$json, true);
    if (!is_array($rows)) {
        return false;
    }

    foreach ($rows as $row) {
        if (!is_array($row)) {
            continue;
        }
        $pos = row_first_non_empty(['POS_ID', 'POSID', 'POS_GECICI_ID', 'POS_GECICI'], $row, null);
        if ((string)$pos !== $wanted) {
            continue;
        }

        // Açık masa listesinde FIS/FIS_ID doluysa kapanmış fiştir; detay döndürme.
        $fis = row_first_non_empty(['FIS', 'FIS_ID', 'FISID'], $row, null);
        if ($fis !== null && $fis !== '' && (string)$fis !== '0') {
            return false;
        }

        $acik = row_first_non_empty(['ACIK_MI', 'ACIK', 'OPEN'], $row, null);
        if ($acik !== null && $acik !== '') {
            $v = strtolower(trim((string)$acik));
            if (in_array($v, ['0', 'false', 'hayir', 'hayır', 'kapali', 'kapalı', 'closed'], true)) {
                return false;
            }
        }

        $kapali = row_first_non_empty(['KAPALI_MI', 'KAPANDI_MI', 'KAPALI', 'CLOSED'], $row, null);
        if ($kapali !== null && $kapali !== '') {
            $v = strtolower(trim((string)$kapali));
            if (in_array($v, ['1', 'true', 'evet', 'yes', 'kapali', 'kapalı', 'closed'], true)) {
                return false;
            }
        }

        $durum = row_first_non_empty(['DURUM', 'DURUM_AD', 'STATUS'], $row, null);
        if ($durum !== null && $durum !== '' && strpos(strtolower((string)$durum), 'kapa') !== false) {
            return false;
        }

        return true;
    }

    return false;
}

function auto_cleanup_old_logs(PDO $pdo, int $days = 7): void
{
    static $done = false;
    if ($done) {
        return;
    }
    $done = true;
    $days = max(1, min(3650, $days));
    try {
        $stmt = $pdo->prepare("DELETE FROM sync_logs WHERE created_at < (NOW() - INTERVAL ? DAY)");
        $stmt->execute([$days]);
        $stmt = $pdo->prepare("DELETE FROM sync_requests WHERE created_at < (NOW() - INTERVAL ? DAY) AND status IN ('done','error','expired')");
        $stmt->execute([$days]);
        $stmt = $pdo->prepare("DELETE FROM dataset_upload_chunks WHERE created_at < (NOW() - INTERVAL 2 DAY)");
        $stmt->execute();
    } catch (Throwable $e) {
        // otomatik temizlik ana akışı bozmasın
    }
}

$pdo = db();
auto_cleanup_old_logs($pdo, 7);
$input = json_input();

$action = trim((string)($input['action'] ?? ''));
$tenantId = trim((string)($input['tenant_id'] ?? ''));

if ($action === '') {
    respond(['ok' => false, 'error' => 'missing_action'], 400);
}
if ($tenantId === '') {
    respond(['ok' => false, 'error' => 'missing_tenant_id'], 400);
}

try {
    switch ($action) {
        case 'client_secret_register': {
            $dbName = isset($input['db_name']) ? trim((string)$input['db_name']) : null;
            $incoming = get_header_value('X-Client-Secret');
            if ($incoming === '') {
                respond(['ok' => false, 'error' => 'missing_client_secret'], 400);
            }

            upsert_firm_if_missing($pdo, $tenantId, $dbName);
            $stmt = $pdo->prepare(
                "UPDATE firms
                    SET client_secret_hash = ?,
                        db_name = COALESCE(?, db_name),
                        last_seen_at = NOW(),
                        updated_at = NOW()
                  WHERE tenant_id = ?"
            );
            $stmt->execute([sha256_hex($incoming), $dbName, $tenantId]);

            log_sync($pdo, $tenantId, null, 'client_secret_register', 'ok', null, null, ['db_name' => $dbName]);
            respond(['ok' => true, 'message' => 'client_secret_registered', 'tenant_id' => $tenantId]);
        }

        case 'heartbeat': {
            $firm = require_firm($pdo, $tenantId);
            verify_client_secret($firm);

            $stmt = $pdo->prepare("UPDATE firms SET last_seen_at = NOW(), updated_at = NOW() WHERE tenant_id = ?");
            $stmt->execute([$tenantId]);

            respond(['ok' => true, 'server_time' => gmdate('Y-m-d H:i:s')]);
        }

        case 'fis_bildirim_settings_get': {
            $firm = require_firm($pdo, $tenantId);
            verify_client_secret($firm);

            $defaultMinTutar = isset($input['default_min_tutar']) && is_numeric($input['default_min_tutar'])
                ? (float)$input['default_min_tutar']
                : 4000.0;
            $settings = read_fis_bildirim_settings($pdo, $tenantId, $defaultMinTutar);

            respond(['ok' => true, 'settings' => $settings]);
        }

        case 'ondemand_tracked_list': {
            $firm = require_firm($pdo, $tenantId);
            verify_client_secret($firm);

            $datasetKeys = $input['dataset_keys'] ?? [];
            if (!is_array($datasetKeys)) {
                $datasetKeys = [];
            }
            $cleanKeys = [];
            foreach ($datasetKeys as $key) {
                $key = trim((string)$key);
                if ($key !== '' && !in_array($key, $cleanKeys, true)) {
                    $cleanKeys[] = $key;
                }
            }

            if (!$cleanKeys) {
                respond(['ok' => true, 'items' => []]);
            }

            $limit = max(1, min(500, (int)($input['limit'] ?? 250)));
            $placeholders = implode(',', array_fill(0, count($cleanKeys), '?'));
            $sql = "SELECT id, dataset_key, params_json, row_count, data_hash, revision_no, synced_at
                      FROM dataset_cache
                     WHERE tenant_id = ?
                       AND dataset_key IN ($placeholders)
                     ORDER BY synced_at DESC, id DESC
                     LIMIT $limit";
            $stmt = $pdo->prepare($sql);
            $stmt->execute(array_merge([$tenantId], $cleanKeys));
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

            $items = [];
            foreach ($rows as $row) {
                $params = json_decode((string)$row['params_json'], true);
                if (!is_array($params)) {
                    $params = [];
                }
                $items[] = [
                    'cache_id' => (int)$row['id'],
                    'dataset_key' => (string)$row['dataset_key'],
                    'params' => $params,
                    'row_count' => (int)$row['row_count'],
                    'data_hash' => (string)$row['data_hash'],
                    'revision_no' => (int)$row['revision_no'],
                    'synced_at' => (string)$row['synced_at'],
                ];
            }

            respond(['ok' => true, 'items' => $items]);
        }

        case 'dataset_cache_exists': {
            $firm = require_firm($pdo, $tenantId);
            verify_client_secret($firm);

            $datasetKey = trim((string)($input['dataset_key'] ?? ''));
            $params = is_array($input['params'] ?? null) ? $input['params'] : [];

            if ($datasetKey === '') {
                respond(['ok' => false, 'error' => 'missing_dataset_key'], 400);
            }

            if ($datasetKey === 'acik_masa_detay' && !is_acik_masa_pos_currently_open($pdo, $tenantId, $params)) {
                respond([
                    'ok' => false,
                    'error' => 'open_table_not_found',
                    'message' => 'POS_ID güncel açık masalar listesinde yok; kapanmış fiş detayı döndürülmedi.',
                    'dataset_key' => $datasetKey,
                    'params' => $params,
                ], 404);
            }

            $paramsHash = sha256_hex(cache_lookup_json($datasetKey, $params));
            $stmt = $pdo->prepare(
                "SELECT id, row_count, revision_no, synced_at
                   FROM dataset_cache
                  WHERE tenant_id = ? AND dataset_key = ? AND params_hash = ?
                  LIMIT 1"
            );
            $stmt->execute([$tenantId, $datasetKey, $paramsHash]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);

            $activeRowCount = null;
            if (is_delta_dataset($datasetKey)) {
                ensure_dataset_cache_rows($pdo);
                $rowParamsHash = sha256_hex(cache_lookup_json($datasetKey, $params));
                $stmtRows = $pdo->prepare(
                    "SELECT COUNT(*)
                       FROM dataset_cache_rows
                      WHERE tenant_id = ? AND dataset_key = ? AND params_hash = ? AND deleted_at IS NULL"
                );
                $stmtRows->execute([$tenantId, $datasetKey, $rowParamsHash]);
                $activeRowCount = (int)$stmtRows->fetchColumn();
            } elseif (is_paged_dataset($datasetKey)) {
                ensure_dataset_cache_pages($pdo);
                $pageParamsHash = sha256_hex(cache_lookup_json($datasetKey, $params));
                $stmtRows = $pdo->prepare(
                    "SELECT COALESCE(SUM(row_count), 0)
                       FROM dataset_cache_pages
                      WHERE tenant_id = ? AND dataset_key = ? AND params_hash = ?"
                );
                $stmtRows->execute([$tenantId, $datasetKey, $pageParamsHash]);
                $activeRowCount = (int)$stmtRows->fetchColumn();
            }

            respond([
                'ok' => true,
                'exists' => (bool)$row,
                'cache_id' => $row ? (int)$row['id'] : null,
                'row_count' => $row ? (int)$row['row_count'] : 0,
                'active_row_count' => $activeRowCount,
                'revision_no' => $row ? (int)$row['revision_no'] : 0,
                'synced_at' => $row ? (string)$row['synced_at'] : null,
            ]);
        }

        case 'dataset_push': {
            $firm = require_firm($pdo, $tenantId);
            verify_client_secret($firm);

            $datasetKey = trim((string)($input['dataset_key'] ?? ''));
            $params = is_array($input['params'] ?? null) ? $input['params'] : [];
            $data = $input['data'] ?? [];
            $dataHash = trim((string)($input['data_hash'] ?? ''));

            if ($datasetKey === '') {
                respond(['ok' => false, 'error' => 'missing_dataset_key'], 400);
            }

            $calcHash = sha256_hex(clean_json($data));
            if ($dataHash !== '' && !hash_equals($dataHash, $calcHash)) {
                respond(['ok' => false, 'error' => 'data_hash_mismatch'], 400);
            }

            $pdo->beginTransaction();
            $saved = save_dataset_cache($pdo, $tenantId, $datasetKey, $params, $data);
            log_sync($pdo, $tenantId, $datasetKey, 'dataset_push', 'ok', null, clean_json($params), [
                'row_count' => $saved['row_count'],
                'revision_no' => $saved['revision_no'],
                'data_hash' => $saved['data_hash'],
                'lookup_json' => $saved['lookup_json'],
            ]);
            commit_if_active($pdo);

            respond(['ok' => true] + $saved);
        }

        case 'dataset_push_part': {
            $firm = require_firm($pdo, $tenantId);
            verify_client_secret($firm);
            ensure_dataset_upload_chunks($pdo);

            $datasetKey = trim((string)($input['dataset_key'] ?? ''));
            $uploadId = trim((string)($input['upload_id'] ?? ''));
            $partNo = (int)($input['part_no'] ?? 0);
            $totalParts = (int)($input['total_parts'] ?? 0);
            $params = is_array($input['params'] ?? null) ? $input['params'] : [];
            $chunkText = (string)($input['chunk_text'] ?? '');

            if ($datasetKey === '' || $uploadId === '' || $partNo < 1 || $totalParts < 1) {
                respond(['ok' => false, 'error' => 'invalid_chunk_request'], 400);
            }

            $paramsHash = sha256_hex(cache_lookup_json($datasetKey, $params));
            $stmt = $pdo->prepare(
                "INSERT INTO dataset_upload_chunks
                    (tenant_id, upload_id, dataset_key, params_hash, part_no, total_parts, chunk_text, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
                 ON DUPLICATE KEY UPDATE
                    chunk_text = VALUES(chunk_text),
                    total_parts = VALUES(total_parts)"
            );
            $stmt->execute([$tenantId, $uploadId, $datasetKey, $paramsHash, $partNo, $totalParts, $chunkText]);

            respond(['ok' => true, 'upload_id' => $uploadId, 'part_no' => $partNo, 'total_parts' => $totalParts]);
        }

        case 'dataset_push_commit': {
            $firm = require_firm($pdo, $tenantId);
            verify_client_secret($firm);
            ensure_dataset_upload_chunks($pdo);

            $uploadId = trim((string)($input['upload_id'] ?? ''));
            $params = is_array($input['params'] ?? null) ? $input['params'] : [];
            $dataHash = trim((string)($input['data_hash'] ?? ''));

            if ($uploadId === '') {
                respond(['ok' => false, 'error' => 'missing_upload_id'], 400);
            }

            $assembled = assemble_upload($pdo, $tenantId, $uploadId);
            $datasetKey = $assembled['dataset_key'];
            $data = $assembled['data'];

            $calcHash = sha256_hex(clean_json($data));
            if ($dataHash !== '' && !hash_equals($dataHash, $calcHash)) {
                respond(['ok' => false, 'error' => 'data_hash_mismatch'], 400);
            }

            $pdo->beginTransaction();
            $saved = save_dataset_cache($pdo, $tenantId, $datasetKey, $params, $data);
            $stmt = $pdo->prepare("DELETE FROM dataset_upload_chunks WHERE tenant_id = ? AND upload_id = ?");
            $stmt->execute([$tenantId, $uploadId]);

            log_sync($pdo, $tenantId, $datasetKey, 'dataset_push_commit', 'ok', null, clean_json($params), [
                'upload_id' => $uploadId,
                'row_count' => $saved['row_count'],
                'revision_no' => $saved['revision_no'],
                'lookup_json' => $saved['lookup_json'],
            ]);
            commit_if_active($pdo);

            respond(['ok' => true] + $saved);
        }

        case 'dataset_page_delta_push': {
            $firm = require_firm($pdo, $tenantId);
            verify_client_secret($firm);
            ensure_dataset_cache_pages($pdo);

            $datasetKey = trim((string)($input['dataset_key'] ?? ''));
            $params = is_array($input['params'] ?? null) ? $input['params'] : [];
            $changes = is_array($input['changes'] ?? null) ? $input['changes'] : [];
            $deletes = is_array($input['deletes'] ?? null) ? $input['deletes'] : [];
            $totalRowCount = (int)($input['total_row_count'] ?? 0);
            $dataHash = trim((string)($input['data_hash'] ?? ''));

            if ($datasetKey === '' || !is_paged_dataset($datasetKey)) {
                respond(['ok' => false, 'error' => 'invalid_page_delta_dataset'], 400);
            }

            $paramsHash = sha256_hex(cache_lookup_json($datasetKey, $params));
            $stmt = $pdo->prepare(
                "SELECT page_no, data_json
                   FROM dataset_cache_pages
                  WHERE tenant_id = ? AND dataset_key = ? AND params_hash = ?
                  ORDER BY page_no ASC"
            );
            $stmt->execute([$tenantId, $datasetKey, $paramsHash]);
            $pageRows = $stmt->fetchAll(PDO::FETCH_ASSOC);
            if (!$pageRows) {
                respond(['ok' => false, 'error' => 'paged_cache_not_found', 'message' => 'Önce full sayfalı seed gerekir.'], 404);
            }

            $order = [];
            $rowsByKey = [];
            foreach ($pageRows as $pageRow) {
                $rows = json_decode((string)$pageRow['data_json'], true);
                if (!is_array($rows)) {
                    continue;
                }
                foreach ($rows as $row) {
                    if (!is_array($row)) {
                        continue;
                    }
                    $rk = paged_dataset_row_key($datasetKey, $row);
                    if (!array_key_exists($rk, $rowsByKey)) {
                        $order[] = $rk;
                    }
                    $rowsByKey[$rk] = $row;
                }
            }

            $deleteCount = 0;
            foreach ($deletes as $del) {
                if (!is_array($del)) continue;
                $rk = trim((string)($del['row_key'] ?? ''));
                if ($rk !== '' && array_key_exists($rk, $rowsByKey)) {
                    unset($rowsByKey[$rk]);
                    $deleteCount++;
                }
            }

            $upsertCount = 0;
            foreach ($changes as $chg) {
                if (!is_array($chg)) continue;
                $row = $chg['row'] ?? null;
                if (!is_array($row)) continue;
                $rk = trim((string)($chg['row_key'] ?? ''));
                if ($rk === '') {
                    $rk = paged_dataset_row_key($datasetKey, $row);
                }
                if (!array_key_exists($rk, $rowsByKey)) {
                    $order[] = $rk;
                }
                $rowsByKey[$rk] = $row;
                $upsertCount++;
            }

            $newRows = [];
            foreach ($order as $rk) {
                if (array_key_exists($rk, $rowsByKey)) {
                    $newRows[] = $rowsByKey[$rk];
                }
            }

            if ($totalRowCount <= 0) {
                $totalRowCount = count($newRows);
            }
            if ($dataHash === '') {
                $dataHash = sha256_hex($datasetKey . '|' . $paramsHash . '|' . (string)$totalRowCount . '|' . clean_json([$upsertCount, $deleteCount, time()]));
            }

            $pages = split_rows_for_page_storage($newRows, 450000, 10000);

            $pdo->beginTransaction();
            $pdo->prepare(
                "DELETE FROM dataset_cache_pages
                  WHERE tenant_id = ? AND dataset_key = ? AND params_hash = ?"
            )->execute([$tenantId, $datasetKey, $paramsHash]);

            $insertPage = $pdo->prepare(
                "INSERT INTO dataset_cache_pages
                    (tenant_id, dataset_key, params_hash, page_no, row_count, data_hash, data_json, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())"
            );

            $pageNo = 0;
            foreach ($pages as $page) {
                $pageNo++;
                $pageJson = clean_json($page);
                $insertPage->execute([
                    $tenantId,
                    $datasetKey,
                    $paramsHash,
                    $pageNo,
                    count($page),
                    sha256_hex($pageJson),
                    $pageJson,
                ]);
            }

            $saved = save_dataset_cache_meta($pdo, $tenantId, $datasetKey, $params, $totalRowCount, $dataHash, [
                'paged_delta' => true,
                'upsert_count' => $upsertCount,
                'delete_count' => $deleteCount,
                'page_count' => count($pages),
            ]);

            log_sync($pdo, $tenantId, $datasetKey, 'dataset_page_delta_push', 'ok', null, clean_json($params), [
                'upsert_count' => $upsertCount,
                'delete_count' => $deleteCount,
                'row_count' => $totalRowCount,
                'page_count' => count($pages),
                'lookup_json' => $saved['lookup_json'],
            ]);

            commit_if_active($pdo);

            respond([
                'ok' => true,
                'paged_delta' => true,
                'upsert_count' => $upsertCount,
                'delete_count' => $deleteCount,
                'row_count' => $totalRowCount,
                'page_count' => count($pages),
            ] + $saved);
        }

        case 'dataset_page_begin': {
            $firm = require_firm($pdo, $tenantId);
            verify_client_secret($firm);
            ensure_dataset_cache_pages($pdo);
            ensure_dataset_upload_chunks($pdo);

            $datasetKey = trim((string)($input['dataset_key'] ?? ''));
            $uploadId = trim((string)($input['upload_id'] ?? ''));
            $params = is_array($input['params'] ?? null) ? $input['params'] : [];
            $totalParts = (int)($input['total_parts'] ?? 0);

            if ($datasetKey === '' || $uploadId === '' || $totalParts < 1 || !is_paged_dataset($datasetKey)) {
                respond(['ok' => false, 'error' => 'invalid_page_begin'], 400);
            }

            $pdo->prepare("DELETE FROM dataset_upload_chunks WHERE tenant_id = ? AND upload_id = ?")
                ->execute([$tenantId, $uploadId]);

            respond(['ok' => true, 'upload_id' => $uploadId, 'dataset_key' => $datasetKey, 'total_parts' => $totalParts]);
        }

        case 'dataset_page_part': {
            $firm = require_firm($pdo, $tenantId);
            verify_client_secret($firm);
            ensure_dataset_cache_pages($pdo);
            ensure_dataset_upload_chunks($pdo);

            $datasetKey = trim((string)($input['dataset_key'] ?? ''));
            $uploadId = trim((string)($input['upload_id'] ?? ''));
            $partNo = (int)($input['part_no'] ?? 0);
            $totalParts = (int)($input['total_parts'] ?? 0);
            $params = is_array($input['params'] ?? null) ? $input['params'] : [];
            $data = $input['data'] ?? [];

            if ($datasetKey === '' || $uploadId === '' || $partNo < 1 || $totalParts < 1 || !is_paged_dataset($datasetKey)) {
                respond(['ok' => false, 'error' => 'invalid_page_part'], 400);
            }
            if (!is_array($data)) {
                respond(['ok' => false, 'error' => 'invalid_page_data'], 400);
            }

            $paramsHash = sha256_hex(cache_lookup_json($datasetKey, $params));
            $chunkText = clean_json($data);

            $stmt = $pdo->prepare(
                "INSERT INTO dataset_upload_chunks
                    (tenant_id, upload_id, dataset_key, params_hash, part_no, total_parts, chunk_text, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
                 ON DUPLICATE KEY UPDATE
                    chunk_text = VALUES(chunk_text),
                    total_parts = VALUES(total_parts)"
            );
            $stmt->execute([$tenantId, $uploadId, $datasetKey, $paramsHash, $partNo, $totalParts, $chunkText]);

            respond([
                'ok' => true,
                'upload_id' => $uploadId,
                'part_no' => $partNo,
                'total_parts' => $totalParts,
                'row_count' => count($data),
            ]);
        }

        case 'dataset_page_commit': {
            $firm = require_firm($pdo, $tenantId);
            verify_client_secret($firm);
            ensure_dataset_cache_pages($pdo);
            ensure_dataset_upload_chunks($pdo);

            $datasetKey = trim((string)($input['dataset_key'] ?? ''));
            $uploadId = trim((string)($input['upload_id'] ?? ''));
            $params = is_array($input['params'] ?? null) ? $input['params'] : [];
            $totalParts = (int)($input['total_parts'] ?? 0);
            $totalRowCount = (int)($input['total_row_count'] ?? 0);
            $dataHash = trim((string)($input['data_hash'] ?? ''));

            if ($datasetKey === '' || $uploadId === '' || $totalParts < 1 || !is_paged_dataset($datasetKey)) {
                respond(['ok' => false, 'error' => 'invalid_page_commit'], 400);
            }

            $stmt = $pdo->prepare(
                "SELECT part_no, total_parts, chunk_text
                   FROM dataset_upload_chunks
                  WHERE tenant_id = ? AND upload_id = ? AND dataset_key = ?
                  ORDER BY part_no ASC"
            );
            $stmt->execute([$tenantId, $uploadId, $datasetKey]);
            $parts = $stmt->fetchAll(PDO::FETCH_ASSOC);

            if (count($parts) !== $totalParts) {
                respond([
                    'ok' => false,
                    'error' => 'page_upload_incomplete',
                    'received_parts' => count($parts),
                    'total_parts' => $totalParts,
                ], 409);
            }

            $paramsHash = sha256_hex(cache_lookup_json($datasetKey, $params));

            /*
             * Güvenli sayfa yenileme:
             * Eski sürüm önce dataset_cache_pages kayıtlarını siliyor, sonra yeni sayfaları yazıyordu.
             * Yazma sırasında hata olursa stok/cari liste sayfaları boş kalabiliyordu.
             *
             * Yeni sürüm önce tüm yeni sayfaları geçici params_hash ile yazar.
             * Tüm sayfalar başarılı yazıldıktan sonra tek transaction içinde:
             * 1) eski gerçek sayfaları siler,
             * 2) geçici sayfaları gerçek params_hash'e çevirir,
             * 3) ana cache meta bilgisini günceller.
             */
            $stagingHash = sha256_hex('staging|' . $tenantId . '|' . $datasetKey . '|' . $paramsHash . '|' . $uploadId);

            $pdo->beginTransaction();

            // Aynı upload_id tekrar denenirse önce yarım kalmış staging kayıtlarını temizle.
            $pdo->prepare(
                "DELETE FROM dataset_cache_pages
                  WHERE tenant_id = ? AND dataset_key = ? AND params_hash = ?"
            )->execute([$tenantId, $datasetKey, $stagingHash]);

            $insertPage = $pdo->prepare(
                "INSERT INTO dataset_cache_pages
                    (tenant_id, dataset_key, params_hash, page_no, row_count, data_hash, data_json, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())"
            );

            $actualRows = 0;
            foreach ($parts as $part) {
                $pageNo = (int)$part['part_no'];
                $rows = json_decode((string)$part['chunk_text'], true);
                if (!is_array($rows)) {
                    throw new RuntimeException('invalid_page_json');
                }

                $rowCount = count($rows);
                $actualRows += $rowCount;

                $insertPage->execute([
                    $tenantId,
                    $datasetKey,
                    $stagingHash,
                    $pageNo,
                    $rowCount,
                    sha256_hex((string)$part['chunk_text']),
                    (string)$part['chunk_text'],
                ]);
            }

            if ($totalRowCount <= 0) {
                $totalRowCount = $actualRows;
            }
            if ($dataHash === '') {
                $dataHash = sha256_hex($datasetKey . '|' . $paramsHash . '|' . (string)$totalRowCount . '|' . (string)$totalParts);
            }

            // Buraya gelindiyse bütün yeni sayfalar staging'e yazılmış demektir.
            // Şimdi eski sayfaları silip staging sayfaları aktif hale getiriyoruz.
            $pdo->prepare(
                "DELETE FROM dataset_cache_pages
                  WHERE tenant_id = ? AND dataset_key = ? AND params_hash = ?"
            )->execute([$tenantId, $datasetKey, $paramsHash]);

            $pdo->prepare(
                "UPDATE dataset_cache_pages
                    SET params_hash = ?,
                        updated_at = NOW()
                  WHERE tenant_id = ? AND dataset_key = ? AND params_hash = ?"
            )->execute([$paramsHash, $tenantId, $datasetKey, $stagingHash]);

            $saved = save_dataset_cache_meta($pdo, $tenantId, $datasetKey, $params, $totalRowCount, $dataHash, [
                'upload_id' => $uploadId,
                'total_parts' => $totalParts,
                'actual_rows' => $actualRows,
                'safe_swap' => true,
            ]);

            $pdo->prepare("DELETE FROM dataset_upload_chunks WHERE tenant_id = ? AND upload_id = ?")
                ->execute([$tenantId, $uploadId]);

            log_sync($pdo, $tenantId, $datasetKey, 'dataset_page_commit', 'ok', null, clean_json($params), [
                'upload_id' => $uploadId,
                'row_count' => $totalRowCount,
                'actual_rows' => $actualRows,
                'total_parts' => $totalParts,
                'lookup_json' => $saved['lookup_json'],
                'safe_swap' => true,
            ]);

            commit_if_active($pdo);

            respond(['ok' => true] + $saved + ['total_parts' => $totalParts, 'safe_swap' => true]);
        }

        case 'dataset_delta_push': {
            $firm = require_firm($pdo, $tenantId);
            verify_client_secret($firm);
            ensure_dataset_cache_rows($pdo);

            $datasetKey = trim((string)($input['dataset_key'] ?? ''));
            $params = is_array($input['params'] ?? null) ? $input['params'] : [];
            $changes = is_array($input['changes'] ?? null) ? $input['changes'] : [];
            $deletes = is_array($input['deletes'] ?? null) ? $input['deletes'] : [];

            if ($datasetKey === '' || !is_delta_dataset($datasetKey)) {
                respond(['ok' => false, 'error' => 'invalid_delta_dataset'], 400);
            }

            $paramsHash = sha256_hex(cache_lookup_json($datasetKey, $params));

            $pdo->beginTransaction();
            $upsertStmt = $pdo->prepare(
                "INSERT INTO dataset_cache_rows
                    (tenant_id, dataset_key, params_hash, row_key, row_key_hash, row_uid_hash, row_hash, row_json, deleted_at, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NOW(), NOW())
                 ON DUPLICATE KEY UPDATE
                    row_key = VALUES(row_key),
                    row_key_hash = VALUES(row_key_hash),
                    row_hash = VALUES(row_hash),
                    row_json = VALUES(row_json),
                    deleted_at = NULL,
                    updated_at = NOW()"
            );
            $deleteStmt = $pdo->prepare(
                "UPDATE dataset_cache_rows
                    SET deleted_at = NOW(), updated_at = NOW()
                  WHERE row_uid_hash = ?"
            );

            $upserted = 0;
            foreach ($changes as $item) {
                if (!is_array($item)) {
                    continue;
                }
                $rowKey = trim((string)($item['row_key'] ?? ''));
                $row = $item['row'] ?? null;
                if ($rowKey === '' || !is_array($row)) {
                    continue;
                }
                $rowJson = clean_json($row);
                $rowHash = trim((string)($item['row_hash'] ?? ''));
                if ($rowHash === '') {
                    $rowHash = sha256_hex($rowJson);
                }
                $rowKeyHash = sha256_hex($rowKey);
                $rowUidHash = sha256_hex($tenantId . '|' . $datasetKey . '|' . $paramsHash . '|' . $rowKey);
                $upsertStmt->execute([$tenantId, $datasetKey, $paramsHash, $rowKey, $rowKeyHash, $rowUidHash, $rowHash, $rowJson]);
                $upserted++;
            }

            $deleted = 0;
            foreach ($deletes as $item) {
                if (!is_array($item)) {
                    continue;
                }
                $rowKey = trim((string)($item['row_key'] ?? ''));
                if ($rowKey === '') {
                    continue;
                }
                $rowUidHash = sha256_hex($tenantId . '|' . $datasetKey . '|' . $paramsHash . '|' . $rowKey);
                $deleteStmt->execute([$rowUidHash]);
                $deleted += $deleteStmt->rowCount();
            }

            commit_if_active($pdo);

            respond([
                'ok' => true,
                'dataset_key' => $datasetKey,
                'upserted' => $upserted,
                'deleted' => $deleted,
            ]);
        }

        case 'dataset_delta_commit': {
            $firm = require_firm($pdo, $tenantId);
            verify_client_secret($firm);
            ensure_dataset_cache_rows($pdo);

            $datasetKey = trim((string)($input['dataset_key'] ?? ''));
            $params = is_array($input['params'] ?? null) ? $input['params'] : [];
            $totalRowCount = (int)($input['total_row_count'] ?? 0);
            $dataHash = trim((string)($input['data_hash'] ?? ''));

            if ($datasetKey === '' || !is_delta_dataset($datasetKey)) {
                respond(['ok' => false, 'error' => 'invalid_delta_commit'], 400);
            }

            $paramsHash = sha256_hex(cache_lookup_json($datasetKey, $params));
            $stmt = $pdo->prepare(
                "SELECT COUNT(*)
                   FROM dataset_cache_rows
                  WHERE tenant_id = ? AND dataset_key = ? AND params_hash = ? AND deleted_at IS NULL"
            );
            $stmt->execute([$tenantId, $datasetKey, $paramsHash]);
            $activeRows = (int)$stmt->fetchColumn();
            if ($totalRowCount <= 0) {
                $totalRowCount = $activeRows;
            }
            if ($dataHash === '') {
                $dataHash = sha256_hex($datasetKey . '|' . $paramsHash . '|' . (string)$activeRows . '|' . gmdate('Y-m-d H:i:s'));
            }

            $pdo->beginTransaction();
            $saved = save_dataset_cache_rows_meta($pdo, $tenantId, $datasetKey, $params, $activeRows, $dataHash, [
                'active_rows' => $activeRows,
                'client_total_row_count' => $totalRowCount,
            ]);
            log_sync($pdo, $tenantId, $datasetKey, 'dataset_delta_commit', 'ok', null, clean_json($params), [
                'row_count' => $activeRows,
                'client_total_row_count' => $totalRowCount,
                'lookup_json' => $saved['lookup_json'],
            ]);
            commit_if_active($pdo);

            respond(['ok' => true] + $saved + ['active_rows' => $activeRows]);
        }

        case 'dataset_get': {
            $datasetKey = trim((string)($input['dataset_key'] ?? ''));
            $params = is_array($input['params'] ?? null) ? $input['params'] : [];

            if ($datasetKey === '') {
                respond(['ok' => false, 'error' => 'missing_dataset_key'], 400);
            }

            $paramsHash = sha256_hex(cache_lookup_json($datasetKey, $params));
            $stmt = $pdo->prepare(
                "SELECT id, dataset_key, params_json, data_json, row_count, data_hash, revision_no, synced_at
                   FROM dataset_cache
                  WHERE tenant_id = ? AND dataset_key = ? AND params_hash = ?
                  LIMIT 1"
            );
            $stmt->execute([$tenantId, $datasetKey, $paramsHash]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);

            if (!$row) {
                respond(['ok' => false, 'error' => 'cache_not_found'], 404);
            }

            $rowsResponse = dataset_rows_response($pdo, $tenantId, $datasetKey, $params, $row);
            if ($rowsResponse !== null) {
                respond($rowsResponse);
            }

            $pagedResponse = paged_dataset_response($pdo, $tenantId, $datasetKey, $params, $row);
            if ($pagedResponse !== null) {
                respond($pagedResponse);
            }

            $dataRows = json_decode((string)$row['data_json'], true);
            if (!is_array($dataRows)) {
                $dataRows = [];
            }

            if ($datasetKey === 'fis_gunluk_bildirim_feed') {
                $dataRows = filter_fis_gunluk_bildirim_feed_rows($dataRows, $params);
            }
            if ($datasetKey === 'rap_filtre_lookup' || $datasetKey === 'rapor_filter_lookup') {
                $dataRows = filter_rap_filtre_lookup_rows($dataRows, $params);
            }

            $plainPageInfo = null;
            if ($datasetKey === 'rap_acik_hesap_kisi_ozet_web' || $datasetKey === 'rap_filtre_lookup' || $datasetKey === 'rapor_filter_lookup') {
                $plainPageInfo = paginate_plain_rows($dataRows, $params);
                $dataRows = $plainPageInfo['rows'];
            }

            $response = [
                'ok' => true,
                'cache_id' => (int)$row['id'],
                'dataset_key' => (string)$row['dataset_key'],
                'params' => json_decode((string)$row['params_json'], true),
                'data' => $dataRows,
                'row_count' => count($dataRows),
                'data_hash' => (string)$row['data_hash'],
                'revision_no' => (int)$row['revision_no'],
                'synced_at' => (string)$row['synced_at'],
            ];
            if ($plainPageInfo !== null) {
                $response['page'] = $plainPageInfo['page'];
                $response['page_size'] = $plainPageInfo['page_size'];
                $response['total_pages'] = $plainPageInfo['total_pages'];
                $response['total_row_count'] = $plainPageInfo['total_row_count'];
                $response['has_more'] = $plainPageInfo['has_more'];
            }
            respond($response);
        }

        case 'dataset_wipe': {
            $firm = require_firm($pdo, $tenantId);
            verify_client_secret($firm);

            $datasetKey = trim((string)($input['dataset_key'] ?? ''));

            // CREATE/ALTER tablo hazırlıkları transaction içinde yapılırsa MySQL transaction'ı otomatik kapatabilir.
            ensure_dataset_cache_pages($pdo);
            ensure_dataset_upload_chunks($pdo);

            $pdo->beginTransaction();
            if ($datasetKey === '') {
                $pdo->prepare("DELETE FROM dataset_cache WHERE tenant_id = ?")->execute([$tenantId]);
                $pdo->prepare("DELETE FROM dataset_snapshots WHERE tenant_id = ?")->execute([$tenantId]);
                $pdo->prepare("DELETE FROM dataset_upload_chunks WHERE tenant_id = ?")->execute([$tenantId]);
                $pdo->prepare("DELETE FROM dataset_cache_pages WHERE tenant_id = ?")->execute([$tenantId]);
                ensure_dataset_cache_rows($pdo);
                $pdo->prepare("DELETE FROM dataset_cache_rows WHERE tenant_id = ?")->execute([$tenantId]);
                $pdo->prepare("DELETE FROM sync_requests WHERE tenant_id = ? AND status IN ('queued','running')")->execute([$tenantId]);
            } else {
                $pdo->prepare("DELETE FROM dataset_cache WHERE tenant_id = ? AND dataset_key = ?")->execute([$tenantId, $datasetKey]);
                $pdo->prepare("DELETE FROM dataset_snapshots WHERE tenant_id = ? AND dataset_key = ?")->execute([$tenantId, $datasetKey]);
                $pdo->prepare("DELETE FROM dataset_upload_chunks WHERE tenant_id = ? AND dataset_key = ?")->execute([$tenantId, $datasetKey]);
                $pdo->prepare("DELETE FROM dataset_cache_pages WHERE tenant_id = ? AND dataset_key = ?")->execute([$tenantId, $datasetKey]);
                ensure_dataset_cache_rows($pdo);
                $pdo->prepare("DELETE FROM dataset_cache_rows WHERE tenant_id = ? AND dataset_key = ?")->execute([$tenantId, $datasetKey]);
                $pdo->prepare("DELETE FROM sync_requests WHERE tenant_id = ? AND dataset_key = ? AND status IN ('queued','running')")->execute([$tenantId, $datasetKey]);
            }
            log_sync($pdo, $tenantId, $datasetKey !== '' ? $datasetKey : null, 'dataset_wipe', 'ok');
            commit_if_active($pdo);

            respond(['ok' => true, 'dataset_key' => $datasetKey !== '' ? $datasetKey : null]);
        }

        case 'acik_masa_detay_cleanup': {
            $firm = require_firm($pdo, $tenantId);
            verify_client_secret($firm);

            $activeInput = is_array($input['active_pos_ids'] ?? null) ? $input['active_pos_ids'] : [];
            $active = [];
            foreach ($activeInput as $v) {
                $s = trim((string)$v);
                if ($s !== '') {
                    $active[$s] = true;
                }
            }

            $stmt = $pdo->prepare(
                "SELECT id, params_json
                   FROM dataset_cache
                  WHERE tenant_id = ? AND dataset_key = 'acik_masa_detay'"
            );
            $stmt->execute([$tenantId]);
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

            $deleteIds = [];
            foreach ($rows as $r) {
                $params = json_decode((string)$r['params_json'], true);
                if (!is_array($params)) {
                    $deleteIds[] = (int)$r['id'];
                    continue;
                }
                $pos = first_non_empty(['POS_ID', 'pos_id'], $params, '');
                $pos = trim((string)$pos);
                if ($pos === '' || !isset($active[$pos])) {
                    $deleteIds[] = (int)$r['id'];
                }
            }

            $deleted = 0;
            if ($deleteIds) {
                $pdo->beginTransaction();
                $del = $pdo->prepare("DELETE FROM dataset_cache WHERE tenant_id = ? AND id = ? AND dataset_key = 'acik_masa_detay'");
                foreach ($deleteIds as $id) {
                    $del->execute([$tenantId, $id]);
                    $deleted += $del->rowCount();
                }
                $pdo->prepare("DELETE FROM dataset_snapshots WHERE tenant_id = ? AND dataset_key = 'acik_masa_detay'")->execute([$tenantId]);
                log_sync($pdo, $tenantId, 'acik_masa_detay', 'acik_masa_detay_cleanup', 'ok', null, null, [
                    'active_count' => count($active),
                    'deleted' => $deleted,
                ]);
                if ($pdo->inTransaction()) {
                    $pdo->commit();
                }
            }

            respond(['ok' => true, 'active_count' => count($active), 'deleted' => $deleted]);
        }

        case 'request_create': {
            $datasetKey = trim((string)($input['dataset_key'] ?? ''));
            $params = is_array($input['params'] ?? null) ? $input['params'] : [];
            $priorityNo = (int)($input['priority_no'] ?? 100);
            $requestedBy = trim((string)($input['requested_by'] ?? 'web'));

            if ($datasetKey === '') {
                respond(['ok' => false, 'error' => 'missing_dataset_key'], 400);
            }

            $normalizedParamsJson = clean_json(cache_lookup_array($datasetKey, $params));
            reset_stale_running_requests($pdo, $tenantId, $datasetKey, $datasetKey === 'fis_gunluk_bildirim_feed' ? 45 : 120);

            // Cache-first request akışı:
            // Aynı sorgu daha önce web cache'e yazıldıysa yeni POS request açma.
            // İstersen force_refresh=true veya no_cache=true gönderip POS'a zorla gidebilirsin.
            $cacheTtlSec = request_cache_ttl_seconds($input, $params);
            if (request_cache_allowed($input, $params)) {
                $cacheRow = find_dataset_cache_row($pdo, $tenantId, $datasetKey, $params, $cacheTtlSec);
                if ($cacheRow) {
                    $requestUid = create_done_request_from_cache(
                        $pdo,
                        $tenantId,
                        $datasetKey,
                        $normalizedParamsJson,
                        $requestedBy,
                        $priorityNo,
                        (int)$cacheRow['id']
                    );

                    log_sync($pdo, $tenantId, $datasetKey, 'request_create_cache_hit', 'ok', $requestUid, $normalizedParamsJson, [
                        'priority_no' => $priorityNo,
                        'requested_by' => $requestedBy,
                        'cache_id' => (int)$cacheRow['id'],
                        'row_count' => (int)$cacheRow['row_count'],
                        'revision_no' => (int)$cacheRow['revision_no'],
                        'synced_at' => (string)$cacheRow['synced_at'],
                        'cache_ttl_sec' => $cacheTtlSec,
                    ]);

                    respond([
                        'ok' => true,
                        'request_uid' => $requestUid,
                        'reused' => false,
                        'cache_hit' => true,
                        'status' => 'done',
                        'result_cache_id' => (int)$cacheRow['id'],
                        'row_count' => (int)$cacheRow['row_count'],
                        'revision_no' => (int)$cacheRow['revision_no'],
                        'synced_at' => (string)$cacheRow['synced_at'],
                    ]);
                }
            }

            // Bildirim feed zaman hassas: running durumda kalmış eski request yüzünden yeni fiş kaçmasın.
            // Bu dataset için yalnızca queued aynı istek tekrar kullanılır; running varsa yeni request açılır.
            if ($datasetKey === 'fis_gunluk_bildirim_feed') {
                $stmt = $pdo->prepare(
                    "SELECT request_uid
                       FROM sync_requests
                      WHERE tenant_id = ?
                        AND dataset_key = ?
                        AND params_json = ?
                        AND status = 'queued'
                      ORDER BY id DESC
                      LIMIT 1"
                );
                $stmt->execute([$tenantId, $datasetKey, $normalizedParamsJson]);
            } else {
                $stmt = $pdo->prepare(
                    "SELECT request_uid
                       FROM sync_requests
                      WHERE tenant_id = ?
                        AND dataset_key = ?
                        AND params_json = ?
                        AND status IN ('queued','running')
                      ORDER BY id DESC
                      LIMIT 1"
                );
                $stmt->execute([$tenantId, $datasetKey, $normalizedParamsJson]);
            }
            $existing = $stmt->fetch(PDO::FETCH_ASSOC);
            if ($existing) {
                respond(['ok' => true, 'request_uid' => (string)$existing['request_uid'], 'reused' => true, 'cache_hit' => false]);
            }

            $requestUid = bin2hex(random_bytes(16));
            $stmt = $pdo->prepare(
                "INSERT INTO sync_requests
                    (tenant_id, dataset_key, request_uid, params_json, priority_no, status, requested_by, created_at)
                 VALUES (?, ?, ?, ?, ?, 'queued', ?, NOW())"
            );
            $stmt->execute([
                $tenantId,
                $datasetKey,
                $requestUid,
                $normalizedParamsJson,
                $priorityNo,
                $requestedBy,
            ]);

            log_sync($pdo, $tenantId, $datasetKey, 'request_create', 'ok', $requestUid, $normalizedParamsJson, [
                'priority_no' => $priorityNo,
                'requested_by' => $requestedBy,
                'cache_hit' => false,
            ]);

            respond(['ok' => true, 'request_uid' => $requestUid, 'reused' => false, 'cache_hit' => false]);
        }

        case 'request_poll': {
            $firm = require_firm($pdo, $tenantId);
            verify_client_secret($firm);

            $limit = max(1, min(20, (int)($input['limit'] ?? 10)));
            reset_stale_running_requests($pdo, $tenantId, null, 120);
            $pdo->beginTransaction();

            $stmt = $pdo->prepare(
                "SELECT id, dataset_key, request_uid, params_json, priority_no, created_at
                   FROM sync_requests
                  WHERE tenant_id = ? AND status = 'queued'
                  ORDER BY priority_no ASC, created_at ASC
                  LIMIT $limit"
            );
            $stmt->execute([$tenantId]);
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

            $picked = [];
            if ($rows) {
                $update = $pdo->prepare(
                    "UPDATE sync_requests
                        SET status = 'running',
                            picked_at = NOW()
                      WHERE id = ? AND status = 'queued'"
                );

                foreach ($rows as $row) {
                    $update->execute([(int)$row['id']]);
                    if ($update->rowCount() > 0) {
                        $picked[] = [
                            'dataset_key' => (string)$row['dataset_key'],
                            'request_uid' => (string)$row['request_uid'],
                            'params' => json_decode((string)$row['params_json'], true) ?: [],
                            'priority_no' => (int)$row['priority_no'],
                            'created_at' => (string)$row['created_at'],
                        ];
                    }
                }
            }

            commit_if_active($pdo);
            respond(['ok' => true, 'requests' => $picked]);
        }

        case 'request_result_push': {
            $firm = require_firm($pdo, $tenantId);
            verify_client_secret($firm);

            $requestUid = trim((string)($input['request_uid'] ?? ''));
            $datasetKey = trim((string)($input['dataset_key'] ?? ''));
            $status = trim((string)($input['status'] ?? 'done'));
            $params = is_array($input['params'] ?? null) ? $input['params'] : [];
            $data = $input['data'] ?? [];
            $errorText = trim((string)($input['error_text'] ?? ''));

            if ($requestUid === '' || $datasetKey === '') {
                respond(['ok' => false, 'error' => 'missing_request_uid_or_dataset_key'], 400);
            }

            $pdo->beginTransaction();
            $resultMeta = null;
            $resultCacheId = null;

            if ($status === 'done') {
                $saved = save_dataset_cache($pdo, $tenantId, $datasetKey, $params, $data, $requestUid);
                $resultCacheId = $saved['cache_id'];
                $resultMeta = $saved;
            }

            $stmt = $pdo->prepare(
                "UPDATE sync_requests
                    SET status = ?,
                        result_cache_id = ?,
                        error_text = ?,
                        finished_at = NOW()
                  WHERE tenant_id = ? AND request_uid = ?"
            );
            $stmt->execute([
                $status,
                $resultCacheId,
                $errorText !== '' ? $errorText : null,
                $tenantId,
                $requestUid,
            ]);

            log_sync($pdo, $tenantId, $datasetKey, 'request_result_push', $status === 'done' ? 'ok' : 'error', $requestUid, clean_json($params), $resultMeta, $errorText !== '' ? $errorText : null);
            commit_if_active($pdo);

            respond(['ok' => true, 'request_uid' => $requestUid, 'result_cache_id' => $resultCacheId]);
        }


        case 'request_status': {
            $requestUid = trim((string)($input['request_uid'] ?? ''));
            $includeData = (bool)($input['include_data'] ?? false);

            if ($requestUid === '') {
                respond(['ok' => false, 'error' => 'missing_request_uid'], 400);
            }

            $stmt = $pdo->prepare(
                "SELECT tenant_id, dataset_key, request_uid, params_json, status, result_cache_id, error_text, created_at, picked_at, finished_at
                   FROM sync_requests
                  WHERE tenant_id = ? AND request_uid = ?
                  LIMIT 1"
            );
            $stmt->execute([$tenantId, $requestUid]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);

            if (!$row) {
                respond(['ok' => false, 'error' => 'request_not_found'], 404);
            }

            $result = [
                'ok' => true,
                'dataset_key' => (string)$row['dataset_key'],
                'request_uid' => (string)$row['request_uid'],
                'params' => json_decode((string)$row['params_json'], true) ?: [],
                'status' => (string)$row['status'],
                'result_cache_id' => $row['result_cache_id'] !== null ? (int)$row['result_cache_id'] : null,
                'error_text' => $row['error_text'] !== null ? (string)$row['error_text'] : null,
                'created_at' => (string)$row['created_at'],
                'picked_at' => $row['picked_at'] !== null ? (string)$row['picked_at'] : null,
                'finished_at' => $row['finished_at'] !== null ? (string)$row['finished_at'] : null,
            ];

            if ($includeData && $row['result_cache_id'] !== null) {
                $stmt2 = $pdo->prepare(
                    "SELECT id, params_json, data_json, row_count, data_hash, revision_no, synced_at
                       FROM dataset_cache
                      WHERE tenant_id = ? AND id = ?
                      LIMIT 1"
                );
                $stmt2->execute([$tenantId, (int)$row['result_cache_id']]);
                $cacheRow = $stmt2->fetch(PDO::FETCH_ASSOC);
                if ($cacheRow) {
                    $result['cache'] = [
                        'cache_id' => (int)$cacheRow['id'],
                        'params' => json_decode((string)$cacheRow['params_json'], true) ?: [],
                        'data' => json_decode((string)$cacheRow['data_json'], true) ?: [],
                        'row_count' => (int)$cacheRow['row_count'],
                        'data_hash' => (string)$cacheRow['data_hash'],
                        'revision_no' => (int)$cacheRow['revision_no'],
                        'synced_at' => (string)$cacheRow['synced_at'],
                    ];
                }
            }

            respond($result);
        }


        case 'price_update_poll': {
            $firm = require_firm($pdo, $tenantId);
            verify_client_secret($firm);
            $limit = max(1, min(1000, (int)($input['limit'] ?? 200)));
            $stmt = $pdo->prepare(
                "SELECT id, user_id, tenant_id, product_id, stok_stok_birim_id,
                        product_barcode, product_name, price_name_id, price_name,
                        old_price, new_price, batch_id, created_at, notes
                   FROM pending_price_updates
                  WHERE tenant_id = ? AND status = 'pending'
                  ORDER BY created_at ASC, id ASC
                  LIMIT " . (int)$limit
            );
            $stmt->execute([$tenantId]);
            $items = $stmt->fetchAll(PDO::FETCH_ASSOC);

            log_sync($pdo, $tenantId, null, 'price_update_poll', 'ok', null, null, ['count' => count($items)]);
            respond([
                'ok' => true,
                'success' => true,
                'tenant_id' => $tenantId,
                'count' => count($items),
                'items' => $items,
            ]);
        }

        case 'price_update_mark_applied_bulk': {
            $firm = require_firm($pdo, $tenantId);
            verify_client_secret($firm);
            $ids = normalize_id_list($input['ids'] ?? []);
            if (!$ids) {
                respond(['ok' => false, 'error' => 'missing_ids'], 400);
            }
            $errorMessage = trim((string)($input['error_message'] ?? ''));
            $status = $errorMessage !== '' ? 'failed' : 'applied';
            $placeholders = implode(',', array_fill(0, count($ids), '?'));
            $params = [$status, $errorMessage !== '' ? $errorMessage : null, $tenantId];
            foreach ($ids as $id) $params[] = $id;

            $stmt = $pdo->prepare(
                "UPDATE pending_price_updates
                    SET status = ?,
                        applied_at = NOW(),
                        error_message = ?
                  WHERE tenant_id = ?
                    AND id IN ($placeholders)
                    AND status IN ('pending','failed')"
            );
            $stmt->execute($params);
            $affected = $stmt->rowCount();

            log_sync($pdo, $tenantId, null, 'price_update_mark_applied_bulk', $status === 'applied' ? 'ok' : 'error', null, null, ['ids' => $ids, 'affected' => $affected], $errorMessage !== '' ? $errorMessage : null);
            respond(['ok' => true, 'success' => true, 'status' => $status, 'applied_count' => $affected, 'affected_count' => $affected]);
        }

        case 'price_update_mark_applied': {
            $firm = require_firm($pdo, $tenantId);
            verify_client_secret($firm);
            $id = (int)($input['id'] ?? 0);
            if ($id <= 0) {
                respond(['ok' => false, 'error' => 'missing_id'], 400);
            }
            $errorMessage = trim((string)($input['error_message'] ?? ''));
            $status = $errorMessage !== '' ? 'failed' : 'applied';
            $stmt = $pdo->prepare(
                "UPDATE pending_price_updates
                    SET status = ?,
                        applied_at = NOW(),
                        error_message = ?
                  WHERE tenant_id = ? AND id = ? AND status IN ('pending','failed')"
            );
            $stmt->execute([$status, $errorMessage !== '' ? $errorMessage : null, $tenantId, $id]);
            if ($stmt->rowCount() <= 0) {
                respond(['ok' => false, 'error' => 'price_update_not_found_or_already_applied'], 404);
            }

            log_sync($pdo, $tenantId, null, 'price_update_mark_applied', $status === 'applied' ? 'ok' : 'error', null, null, ['id' => $id], $errorMessage !== '' ? $errorMessage : null);
            respond(['ok' => true, 'success' => true, 'status' => $status, 'id' => $id]);
        }

        case 'islem_poll': {
            $firm = require_firm($pdo, $tenantId);
            verify_client_secret($firm);
            $limit = max(1, min(200, (int)($input['limit'] ?? 50)));
            $grubu = trim((string)($input['islem_grubu'] ?? '')); // '' = hepsi, 'finans', 'fis', 'sayim'
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

        case 'islem_yetki_set': {
            $firm = require_firm($pdo, $tenantId);
            verify_client_secret($firm);
            $pdo->exec("CREATE TABLE IF NOT EXISTS mobil_islem_yetkileri (
                tenant_id VARCHAR(64) PRIMARY KEY,
                finans TINYINT NOT NULL DEFAULT 0,
                fis TINYINT NOT NULL DEFAULT 0,
                sayim TINYINT NOT NULL DEFAULT 0,
                fiyat TINYINT NOT NULL DEFAULT 1,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) CHARACTER SET utf8mb4 COLLATE utf8mb4_turkish_ci");
            try {
                $pdo->exec("ALTER TABLE mobil_islem_yetkileri ADD COLUMN fiyat TINYINT NOT NULL DEFAULT 1");
            } catch (Throwable $e) { /* kolon zaten var */ }
            $finans = (int)($input['finans'] ?? 0) === 1 ? 1 : 0;
            $fis = (int)($input['fis'] ?? 0) === 1 ? 1 : 0;
            $sayim = (int)($input['sayim'] ?? 0) === 1 ? 1 : 0;
            $fiyat = isset($input['fiyat']) ? ((int)$input['fiyat'] === 1 ? 1 : 0) : 1;
            $stmt = $pdo->prepare(
                "INSERT INTO mobil_islem_yetkileri (tenant_id, finans, fis, sayim, fiyat)
                 VALUES (?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE finans = VALUES(finans), fis = VALUES(fis), sayim = VALUES(sayim), fiyat = VALUES(fiyat)"
            );
            $stmt->execute([$tenantId, $finans, $fis, $sayim, $fiyat]);
            log_sync($pdo, $tenantId, null, 'islem_yetki_set', 'ok', null, null,
                     ['finans' => $finans, 'fis' => $fis, 'sayim' => $sayim, 'fiyat' => $fiyat]);
            respond(['ok' => true, 'finans' => $finans, 'fis' => $fis, 'sayim' => $sayim, 'fiyat' => $fiyat]);
        }

        case 'cleanup_logs': {
            $firm = require_firm($pdo, $tenantId);
            verify_client_secret($firm);

            $days = max(1, min(3650, (int)($input['days'] ?? 30)));
            $pdo->beginTransaction();

            $stmt1 = $pdo->prepare("DELETE FROM sync_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)");
            $stmt1->execute([$days]);
            $deletedLogs = $stmt1->rowCount();

            $stmt2 = $pdo->prepare("DELETE FROM sync_requests WHERE finished_at IS NOT NULL AND finished_at < DATE_SUB(NOW(), INTERVAL ? DAY)");
            $stmt2->execute([$days]);
            $deletedRequests = $stmt2->rowCount();

            $stmt3 = $pdo->prepare("DELETE FROM dataset_upload_chunks WHERE created_at < DATE_SUB(NOW(), INTERVAL 1 DAY)");
            $stmt3->execute();
            $deletedChunks = $stmt3->rowCount();

            log_sync($pdo, $tenantId, null, 'cleanup_logs', 'ok', null, clean_json(['days' => $days]), [
                'deleted_logs' => $deletedLogs,
                'deleted_requests' => $deletedRequests,
                'deleted_chunks' => $deletedChunks,
            ]);
            commit_if_active($pdo);

            respond([
                'ok' => true,
                'days' => $days,
                'deleted_logs' => $deletedLogs,
                'deleted_requests' => $deletedRequests,
                'deleted_chunks' => $deletedChunks,
            ]);
        }

        default:
            respond(['ok' => false, 'error' => 'unknown_action'], 400);
    }
} catch (Throwable $e) {
    try {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
    } catch (Throwable $inner) {
    }

    respond([
        'ok' => false,
        'error' => 'server_exception',
        'message' => $e->getMessage(),
    ], 500);
}
