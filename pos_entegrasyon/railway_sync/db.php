<?php
/**
 * db.php — Railway'de çalışan sync.php için veritabanı bağlantısı (ortam değişkenlerinden).
 *
 * Railway servis değişkenleri (Variables):
 *   DB_HOST  = ${{MariaDB.MYSQLHOST}}      (özel ağ: mariadb.railway.internal)
 *   DB_PORT  = ${{MariaDB.MYSQLPORT}}      (3306)
 *   DB_NAME  = kasacepteweb
 *   DB_USER  = ${{MariaDB.MYSQLUSER}}
 *   DB_PASS  = ${{MariaDB.MYSQLPASSWORD}}
 *
 * Hosting'deki orijinal db.php ile aynı imza: db(): PDO
 */
declare(strict_types=1);

function db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }
    $host = getenv('DB_HOST') ?: '127.0.0.1';
    $port = getenv('DB_PORT') ?: '3306';
    $name = getenv('DB_NAME') ?: 'kasacepteweb';
    $user = getenv('DB_USER') ?: 'root';
    $pass = getenv('DB_PASS') ?: '';
    $dsn = "mysql:host={$host};port={$port};dbname={$name};charset=utf8mb4";
    $pdo = new PDO($dsn, $user, $pass, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
        PDO::ATTR_TIMEOUT => 15,
    ]);
    // Eski sunucu (MariaDB 5.5) ile aynı toleranslı davranış; yeni sürümlerde varsayılan sql_mode katı
    $pdo->exec("SET SESSION sql_mode=''");
    $pdo->exec("SET SESSION time_zone='+03:00'");
    return $pdo;
}
