# sync.php'yi Railway'de çalıştıran PHP servisi
# Railway → New Service → GitHub repo →
#   Settings → Root Directory: pos_entegrasyon
#   Variables → RAILWAY_DOCKERFILE_PATH = railway_sync/Dockerfile
# (build bağlamı pos_entegrasyon klasörüdür; sync.php oradan kopyalanır)
FROM php:8.2-apache

RUN docker-php-ext-install pdo pdo_mysql \
 && a2enmod rewrite headers

# Büyük parça gönderimleri (350K karakterlik JSON parçaları, 200K satırlık stok sayfaları)
COPY railway_sync/php.ini /usr/local/etc/php/conf.d/kasacepte.ini

COPY sync.php sync_php_islem_ek.php /var/www/html/
COPY railway_sync/db.php /var/www/html/db.php

# Railway PORT değişkenini Apache'ye bağla
RUN sed -i 's/Listen 80/Listen ${PORT}/' /etc/apache2/ports.conf \
 && sed -i 's/:80>/:${PORT}>/' /etc/apache2/sites-available/000-default.conf

ENV PORT=8080
EXPOSE 8080
CMD ["apache2-foreground"]
