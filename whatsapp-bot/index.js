const fs = require("node:fs");
const path = require("node:path");
const P = require("pino");
const qrcode = require("qrcode-terminal");
const {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  makeWASocket,
  useMultiFileAuthState,
} = require("@whiskeysockets/baileys");

// ============================================================
// CONFIG - Bu bölümü kendi grubuna göre kolayca değiştirebilirsin.
// Grup ID'sini bot başlarken terminalde listelenen gruplardan al.
// ============================================================
const CONFIG = {
  targetGroupId: "BURAYA_GRUP_ID",
  morningTime: "08:30",
  eveningTime: "19:00",
  nightTime: "23:30",
  timezone: "Europe/Istanbul",
};

const AUTH_DIR = path.join(__dirname, "auth_info_baileys");
const MESSAGES_FILE = path.join(__dirname, "messages.json");
const RECONNECT_DELAY_MS = 5_000;
const CHECK_INTERVAL_MS = 20_000;
const PLACEHOLDER_GROUP_ID = "BURAYA_GRUP_ID";

let socket;
let reconnectTimer;
let lastSentMessageByCategory = {};
const sentScheduleKeys = new Set();

function log(message) {
  console.log(`[${new Date().toLocaleTimeString("tr-TR")}] ${message}`);
}

function isTargetGroup(groupId) {
  return (
    typeof groupId === "string" &&
    groupId.endsWith("@g.us") &&
    CONFIG.targetGroupId !== PLACEHOLDER_GROUP_ID &&
    groupId === CONFIG.targetGroupId
  );
}

function isTargetConfigured() {
  return (
    CONFIG.targetGroupId &&
    CONFIG.targetGroupId !== PLACEHOLDER_GROUP_ID &&
    CONFIG.targetGroupId.endsWith("@g.us")
  );
}

function commandsAreAllowedIn(groupId) {
  // Grup ID henüz girilmediyse !groupid ile keşif kolay olsun.
  return !isTargetConfigured() || isTargetGroup(groupId);
}

function readMessages() {
  try {
    const data = JSON.parse(fs.readFileSync(MESSAGES_FILE, "utf8"));
    if (!data || typeof data !== "object") {
      throw new Error("messages.json bir nesne içermeli.");
    }
    return data;
  } catch (error) {
    log(`messages.json okunamadı: ${error.message}`);
    return {};
  }
}

function getRandomMessage(category) {
  const messages = readMessages()[category];
  if (!Array.isArray(messages) || messages.length === 0) {
    log(`"${category}" kategorisinde mesaj bulunamadı.`);
    return null;
  }

  const validMessages = messages.filter(
    (message) =>
      typeof message === "string" &&
      message.trim() &&
      (messages.length === 1 || message !== lastSentMessageByCategory[category]),
  );
  const allTextMessages = messages.filter(
    (message) => typeof message === "string" && message.trim(),
  );
  if (allTextMessages.length === 0) {
    log(`"${category}" kategorisinde geçerli metin bulunamadı.`);
    return null;
  }
  const choices = validMessages.length > 0 ? validMessages : allTextMessages;
  const message = choices[Math.floor(Math.random() * choices.length)];
  lastSentMessageByCategory[category] = message;
  return message;
}

function getTimeParts() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: CONFIG.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());

  return Object.fromEntries(
    parts
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, value]),
  );
}

function getLocalDateKey() {
  const { year, month, day } = getTimeParts();
  return `${year}-${month}-${day}`;
}

function getConfiguredSchedules() {
  return {
    morning: CONFIG.morningTime,
    evening: CONFIG.eveningTime,
    night: CONFIG.nightTime,
  };
}

async function checkSchedule() {
  if (!socket || !isTargetConfigured()) {
    return;
  }

  const { hour, minute } = getTimeParts();
  const currentTime = `${hour}:${minute}`;
  const dateKey = getLocalDateKey();

  for (const [category, scheduledTime] of Object.entries(
    getConfiguredSchedules(),
  )) {
    const scheduleKey = `${dateKey}:${category}`;
    if (scheduledTime !== currentTime || sentScheduleKeys.has(scheduleKey)) {
      continue;
    }

    const message = getRandomMessage(category);
    if (!message) {
      sentScheduleKeys.add(scheduleKey);
      continue;
    }

    try {
      await socket.sendMessage(CONFIG.targetGroupId, { text: message });
      sentScheduleKeys.add(scheduleKey);
      log(`Otomatik mesaj gönderildi (${category}): ${message}`);
    } catch (error) {
      log(`Otomatik mesaj gönderilemedi: ${error.message}`);
    }
  }

  // Bellekte gereksiz büyümeyi önle; sadece son 10 günü tut.
  if (sentScheduleKeys.size > 40) {
    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 10);
    const cutoff = recentDate.toISOString().slice(0, 10);
    for (const key of sentScheduleKeys) {
      if (key.slice(0, 10) < cutoff) {
        sentScheduleKeys.delete(key);
      }
    }
  }
}

function printHelp() {
  return [
    "Mevcut komutlar:",
    "!ping - Botun çalıştığını kontrol eder.",
    "!help - Bu yardım mesajını gösterir.",
    "!groupid - Bulunduğun grubun ID'sini gösterir.",
  ].join("\n");
}

async function printGroups(currentSocket) {
  try {
    const groups = await currentSocket.groupFetchAllParticipating();
    const groupList = Object.values(groups).sort((a, b) =>
      (a.subject || "").localeCompare(b.subject || "", "tr"),
    );

    log(`Toplam ${groupList.length} WhatsApp grubu bulundu:`);
    if (groupList.length === 0) {
      log("Katıldığın grup bulunamadı.");
      return;
    }

    for (const group of groupList) {
      console.log(`- ${group.subject || "(isimsiz grup)"} | ${group.id}`);
    }

    if (!isTargetConfigured()) {
      log('Bir grubu hedef yapmak için CONFIG.targetGroupId değerini değiştir.');
    } else {
      log(`Hedef grup: ${CONFIG.targetGroupId}`);
    }
  } catch (error) {
    log(`Gruplar listelenemedi: ${error.message}`);
  }
}

async function handleIncomingMessage(message) {
  const remoteJid = message.key?.remoteJid;
  const text =
    message.message?.conversation ||
    message.message?.extendedTextMessage?.text ||
    "";

  if (!remoteJid?.endsWith("@g.us") || !text.trim()) {
    return;
  }

  const command = text.trim().toLowerCase().split(/\s+/)[0];
  if (!commandsAreAllowedIn(remoteJid)) {
    return;
  }

  if (command === "!ping") {
    await socket.sendMessage(remoteJid, { text: "Pong 🫡" });
  } else if (command === "!help") {
    await socket.sendMessage(remoteJid, { text: printHelp() });
  } else if (command === "!groupid") {
    await socket.sendMessage(remoteJid, { text: `Bu grubun ID'si:\n${remoteJid}` });
  }
}

function scheduleReconnect() {
  if (reconnectTimer) {
    return;
  }
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    connectToWhatsApp().catch((error) => {
      log(`Yeniden bağlanma hatası: ${error.message}`);
    });
  }, RECONNECT_DELAY_MS);
}

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  let version;

  try {
    ({ version } = await fetchLatestBaileysVersion());
  } catch {
    log("Baileys sürümü alınamadı; uyumlu varsayılan sürüm kullanılacak.");
  }

  log("WhatsApp bağlanıyor...");
  socket = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, P({ level: "silent" })),
    },
    browser: Browsers.ubuntu("WhatsApp Grup Botu"),
    printQRInTerminal: false,
    logger: P({ level: "silent" }),
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false,
  });

  socket.ev.on("creds.update", saveCreds);

  socket.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      log("QR kodu okut:");
      qrcode.generate(qr, { small: true });
    }

    if (connection === "open") {
      log("WhatsApp bağlandı.");
      await printGroups(socket);
      await checkSchedule();
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;

      if (loggedOut) {
        log(
          "WhatsApp oturumu kapatıldı. auth_info_baileys klasörünü silmeden önce tekrar giriş yapılamaz.",
        );
        return;
      }

      log("WhatsApp bağlantısı koptu; yeniden bağlanılacak...");
      scheduleReconnect();
    }
  });

  socket.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") {
      return;
    }
    for (const message of messages) {
      try {
        await handleIncomingMessage(message);
      } catch (error) {
        log(`Komut işlenemedi: ${error.message}`);
      }
    }
  });
}

log("WhatsApp Grup Botu V1 başlatılıyor...");
log(
  isTargetConfigured()
    ? `Hedef grup: ${CONFIG.targetGroupId}`
    : "Hedef grup seçilmedi; gruplar listelenecek.",
);
log(`Saat dilimi: ${CONFIG.timezone}`);
setInterval(() => {
  checkSchedule().catch((error) => log(`Zamanlayıcı hatası: ${error.message}`));
}, CHECK_INTERVAL_MS);

connectToWhatsApp().catch((error) => {
  log(`Başlangıç hatası: ${error.message}`);
  scheduleReconnect();
});