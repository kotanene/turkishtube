# TürkishTube

YouTube'daki videoları, YouTube'un kendi arayüzü ve resmî Data API'si olmadan izleten sade bir web sitesi.
Veri, açık kaynaklı **Piped** ve **Invidious** API sunucularından gelir. Biri çalışmazsa otomatik olarak sıradakine geçer.

## Kurulum (Windows / Mac / Linux)

1. **Node.js 18 veya üstünü** kurun: https://nodejs.org  (LTS sürümü)
2. ZIP'i bir klasöre çıkarın, o klasörde terminal (Windows'ta PowerShell veya CMD) açın.
3. Bağımlılıkları yükleyin:
   ```
   npm install
   ```
4. Başlatın:
   ```
   npm start
   ```
5. Tarayıcıda açın: **http://localhost:3000**

## Ayarlar (isteğe bağlı)

| Değişken | Anlamı | Varsayılan |
|---|---|---|
| `PORT` | Site portu | 3000 |
| `REGION` | Gündem ülkesi | TR |
| `PIPED_INSTANCES` | Piped API adresleri (virgülle) | hazır liste |
| `INVIDIOUS_INSTANCES` | Invidious adresleri (virgülle) | hazır liste |

Örnek (Windows PowerShell):
```
$env:PORT=8080; npm start
```
Örnek (Mac/Linux):
```
PIPED_INSTANCES=https://pipedapi.ornek.com PORT=8080 npm start
```

## Sorun giderme

- **"Videolar şu an alınamadı"**: Halka açık Piped/Invidious sunucuları sık kapanır veya engellenir.
  `http://localhost:3000/api/status` adresinden listeye bakın. Güncel sunucular için
  https://github.com/TeamPiped/Piped/wiki/Instances ve https://api.invidious.io adreslerine bakıp
  `PIPED_INSTANCES` / `INVIDIOUS_INSTANCES` değişkenlerini güncelleyin.
- **Video açılmıyor**: Oynatıcı önce doğrudan akışı dener, olmazsa kendiliğinden YouTube gömülü oynatıcıya geçer.
  Videonun altındaki "YouTube oynatıcısıyla aç" düğmesiyle elle de geçebilirsiniz.

## Siteye çevirme (sonraki adım)

Sunucuya (VPS) Node.js kurun, projeyi yükleyin, `npm install && npm start` çalıştırın.
Süreç yöneticisi olarak `pm2`, HTTPS için Nginx + Let's Encrypt önerilir.
**Kendi Piped sunucunuzu kurmak**, halka açık sunuculara bağımlılığı bitirir ve en kalıcı çözümdür.

## Dosyalar

- `server.js`: API katmanı (Piped/Invidious, yedekli, önbellekli)
- `public/`: arayüz (HTML, CSS, JS) ve ay-yıldız logosu
