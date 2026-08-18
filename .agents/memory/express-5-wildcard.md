---
name: Express 5 wildcard
description: Express 5 path-to-regexp davranışı ve tek sayfa fallback yönlendirmesi
---

Express 5 ile `app.get("*", handler)` kullanımı başlangıçta `Missing parameter name` hatasına yol açabilir. Tek sayfalı panel fallback'i için API rotalarından sonra genel `app.use(handler)` middleware kullan.

**Why:** Express 5’in güncel path-to-regexp sürümü çıplak `*` desenini kabul etmiyor ve sunucu başlamadan kapanıyor.

**How to apply:** Express 5 tabanlı küçük panellerde statik dosya ve API rotalarından sonra route pattern yerine catch-all middleware kullan.