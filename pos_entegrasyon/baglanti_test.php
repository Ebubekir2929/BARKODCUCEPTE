<?php
/**
 * baglanti_test.php — Hosting'den Railway'e erişim testi (web sitesinin uzaktaki MariaDB'ye bağlanıp bağlanamayacağı).
 *
 * Hosting'e yükleyip tarayıcıdan açın:
 *   https://SITENIZ/baglanti_test.php?host=xxxx.proxy.rlwy.net&port=12345
 * Çıktı: TCP AÇIK / KAPALI + süre. Yalnızca Railway adreslerine izin verir (güvenlik).
 * Test bitince dosyayı silin.
 */
declare(strict_types=1);
header('Content-Type: text/plain; charset=utf-8');

$host = trim((string)($_GET['host'] ?? ''));
$port = (int)($_GET['port'] ?? 0);
if ($host === '' || $port <= 0 || !preg_match('/\.(proxy\.rlwy\.net|railway\.app|railway\.internal)$/', $host)) {
    echo "Kullanım: ?host=xxxx.proxy.rlwy.net&port=12345 (yalnızca Railway adresleri)\n";
    exit;
}
$t0 = microtime(true);
$errno = 0;
$errstr = '';
$fp = @fsockopen($host, $port, $errno, $errstr, 8);
$ms = (int)round((microtime(true) - $t0) * 1000);
if ($fp) {
    fclose($fp);
    echo "TCP AÇIK ✓  {$host}:{$port}  ({$ms} ms)\n";
    echo "→ Web sitesi bu adrese PDO ile bağlanabilir (DSN: mysql:host={$host};port={$port};dbname=kasacepteweb).\n";
} else {
    echo "TCP KAPALI ✗  {$host}:{$port}  ({$ms} ms)  hata: [{$errno}] {$errstr}\n";
    echo "→ Hosting dış bağlantıya izin vermiyor. Seçenekler: hosting'den portun açılmasını isteyin (CSF TCP_OUT) ya da web sitesini de Railway'e taşıyın.\n";
}
echo "PHP: " . PHP_VERSION . " | pdo_mysql: " . (extension_loaded('pdo_mysql') ? 'var' : 'YOK') . " | curl: " . (extension_loaded('curl') ? 'var' : 'YOK') . "\n";
