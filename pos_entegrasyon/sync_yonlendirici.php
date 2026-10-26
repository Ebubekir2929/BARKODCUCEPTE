<?php
/**
 * sync_yonlendirici.php — HOSTING'de kalacak ince yönlendirici.
 *
 * Geçiş gecesi hosting'deki sync.php bu dosyayla DEĞİŞTİRİLİR (adı sync.php yapılır).
 * POS istemcileri eski adrese (hosting) göndermeye devam eder; her istek olduğu gibi
 * Railway'deki sync.php'ye iletilir, yanıt aynen geri döner. Başlıklar (X-Tenant-Id,
 * X-Client-Secret, Content-Type) korunur. Tek yapılması gereken aşağıdaki adresi doldurmak.
 *
 * Not: Hosting'in dışarıya 443 erişimi yeterlidir (MySQL portu gerekmez).
 */
declare(strict_types=1);

const HEDEF_SYNC_URL = 'https://DEGISTIR.up.railway.app/sync.php';   // ← Railway sync servisi adresi
const ZAMAN_ASIMI_SN = 300;

$method = $_SERVER['REQUEST_METHOD'] ?? 'POST';
$url = HEDEF_SYNC_URL . (!empty($_SERVER['QUERY_STRING']) ? ('?' . $_SERVER['QUERY_STRING']) : '');
$govde = file_get_contents('php://input');

$basliklar = [];
foreach ($_SERVER as $k => $v) {
    if (strpos($k, 'HTTP_') === 0) {
        $ad = str_replace(' ', '-', ucwords(strtolower(str_replace('_', ' ', substr($k, 5)))));
        if (in_array(strtolower($ad), ['host', 'content-length', 'accept-encoding', 'connection'], true)) {
            continue;
        }
        $basliklar[] = $ad . ': ' . $v;
    }
}
if (!empty($_SERVER['CONTENT_TYPE'])) {
    $basliklar[] = 'Content-Type: ' . $_SERVER['CONTENT_TYPE'];
}
$basliklar[] = 'X-Forwarded-For: ' . ($_SERVER['REMOTE_ADDR'] ?? '');
$basliklar[] = 'X-Yonlendirici: hosting';

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_CUSTOMREQUEST => $method,
    CURLOPT_POSTFIELDS => $govde,
    CURLOPT_HTTPHEADER => $basliklar,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HEADER => true,
    CURLOPT_TIMEOUT => ZAMAN_ASIMI_SN,
    CURLOPT_CONNECTTIMEOUT => 20,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_ENCODING => '',
]);
$yanit = curl_exec($ch);
if ($yanit === false) {
    http_response_code(502);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'yonlendirici_hata' => curl_error($ch)], JSON_UNESCAPED_UNICODE);
    curl_close($ch);
    exit;
}
$kod = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
$baslikBoyu = (int)curl_getinfo($ch, CURLINFO_HEADER_SIZE);
$icerikTipi = (string)curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
curl_close($ch);

http_response_code($kod);
header('Content-Type: ' . ($icerikTipi !== '' ? $icerikTipi : 'application/json; charset=utf-8'));
echo substr($yanit, $baslikBoyu);
