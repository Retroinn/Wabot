# Basit WhatsApp Grup Botu V1

Baileys kullanan, tek bir WhatsApp grubuna komut ve zamanlanmış mesaj gönderen basit Node.js botu.

## Başlatma

Bu klasörde:

```bash
npm start
```

İlk çalıştırmada terminalde görünen QR kodu WhatsApp uygulamasından okut. Oturum bilgisi `auth_info_baileys` klasörüne kaydedilir; sonraki başlatmalarda genellikle tekrar QR okutman gerekmez.

## Hedef grubu seçme

1. Bot bağlanınca terminalde grup adları ve grup ID'leri listelenir.
2. `index.js` dosyasının en üstündeki `CONFIG.targetGroupId` değerine istediğin grubun ID'sini yaz.
3. Saatleri aynı `CONFIG` bölümünden değiştir:

```js
const CONFIG = {
  targetGroupId: "120363000000000000@g.us",
  morningTime: "08:30",
  eveningTime: "19:00",
  nightTime: "23:30",
  timezone: "Europe/Istanbul"
};
```

Hedef grup ID'si girilmeden önce `!groupid` komutu keşif için tüm gruplarda çalışır. Hedef grup seçildikten sonra bot yalnızca o gruptaki komutları işler ve otomatik mesajları yalnızca o gruba gönderir.

## Komutlar

- `!ping` → `Pong 🫡`
- `!help` → mevcut komutları gösterir
- `!groupid` → bulunduğun grubun ID'sini gösterir

## Otomatik mesajlar

Mesajları `messages.json` içindeki `morning`, `evening` ve `night` listelerinden düzenleyebilirsin. Bot her kategori için günde en fazla bir mesaj gönderir ve aynı kategoride aynı mesajı arka arkaya seçmemeye çalışır.

## Sorun giderme

- QR görünürken botu kapatma; WhatsApp'ta **Bağlı cihazlar** üzerinden QR'ı okut.
- Hesaptan tamamen çıkış yaptıysan `auth_info_baileys` klasörünü silip tekrar başlatmak yeni QR üretir.
- Bağlantı koparsa bot 5 saniye sonra yeniden bağlanmayı dener.
- `CONFIG.targetGroupId` değerinin sonunda `@g.us` olduğundan emin ol.

Botu spam için kullanma; WhatsApp kurallarına ve grup üyelerinin iznine uygun kullan.