# Basit WhatsApp Grup Botu V1

Baileys kullanan, tek bir WhatsApp grubuna komut ve zamanlanmış mesaj gönderen basit Node.js botu.

## Web paneli

Bot çalışırken Replit Preview üzerinden açılan panelde şunları yönetebilirsin:

- WhatsApp bağlantı durumu ve web QR kodu
- Bağlı hesap bilgisi
- Erişilebilen gruplar ve hedef grup seçimi
- Botu aktif/pasif etme
- Test, günaydın ve iyi geceler mesajı gönderme
- Sabah, akşam ve gece saatlerini değiştirme
- Mesaj kategorilerindeki kayıt sayıları
- Son 10 gönderilen mesaj

Panel API'si aynı Node sürecindeki Baileys bağlantısını kullanır. Ayrı bir bot veya ikinci WhatsApp bağlantısı başlatmaz.

## Başlatma

Bu klasörde:

```bash
npm start
```

İlk çalıştırmada Replit Preview panelini açıp web panelindeki QR kodu WhatsApp uygulamasından okut. Oturum bilgisi `auth_info_baileys` klasörüne kaydedilir; sonraki başlatmalarda genellikle tekrar QR okutman gerekmez.

## Hedef grubu seçme

1. Bot bağlanınca paneldeki **Gruplar** bölümünü aç.
2. İstediğin grubun yanındaki **Seç** düğmesine bas.
3. Saatleri paneldeki **Zamanlama** bölümünden değiştir ve kaydet.

İstersen `settings.json` dosyasını da elle düzenleyebilirsin:

```js
const CONFIG = {
  "targetGroupId": "120363000000000000@g.us",
  "morningTime": "08:30",
  "eveningTime": "19:00",
  "nightTime": "23:30",
  "botEnabled": true
};
```

Hedef grup ID'si girilmeden önce `!groupid` komutu keşif için tüm gruplarda çalışır. Hedef grup seçildikten sonra bot yalnızca o gruptaki komutları işler ve otomatik mesajları yalnızca o gruba gönderir. Panelden yapılan grup ve saat değişiklikleri `settings.json` dosyasına kaydedilir.

## Komutlar

- `!ping` → `Pong 🫡`
- `!help` → mevcut komutları gösterir
- `!groupid` → bulunduğun grubun ID'sini gösterir

## Otomatik mesajlar

Mesajları `messages.json` içindeki `morning`, `evening`, `night`, `romantic`, `funny`, `longing` ve `compliment` listelerinden düzenleyebilirsin. Panel kategorilerin kaç mesaj içerdiğini gösterir. Bot her zamanlama kategorisi için günde en fazla bir mesaj gönderir ve aynı kategoride aynı mesajı arka arkaya seçmemeye çalışır.

Gönderilen son 10 mesaj `sent-messages.json` içinde tutulur.

## Sorun giderme

- QR görünürken botu kapatma; WhatsApp'ta **Bağlı cihazlar** üzerinden paneldeki QR'ı okut.
- Hesaptan tamamen çıkış yaptıysan `auth_info_baileys` klasörünü silip tekrar başlatmak yeni QR üretir.
- Bağlantı koparsa bot 5 saniye sonra yeniden bağlanmayı dener.
- `CONFIG.targetGroupId` değerinin sonunda `@g.us` olduğundan emin ol.

Botu spam için kullanma; WhatsApp kurallarına ve grup üyelerinin iznine uygun kullan.