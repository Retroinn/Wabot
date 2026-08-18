const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const P = require("pino");
const QRCode = require("qrcode");
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
const SETTINGS_FILE = path.join(__dirname, "settings.json");
const SENT_MESSAGES_FILE = path.join(__dirname, "sent-messages.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const RECONNECT_DELAY_MS = 5_000;
const CHECK_INTERVAL_MS = 20_000;
const PLACEHOLDER_GROUP_ID = "BURAYA_GRUP_ID";
const PORT = Number(process.env.PORT || 5000);

let socket;
let reconnectTimer;
let lastSentMessageByCategory = {};
let botEnabled = true;
let connectionState = "disconnected";
let qrDataUrl = null;
let connectedAccount = null;
let lastConnectionError = null;
let groups = [];
let sentMessages = [];
const sentScheduleKeys = new Set();

function loadJsonFile(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function saveJsonFile(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function loadPersistedSettings() {
  const settings = loadJsonFile(SETTINGS_FILE, {});
  if (!settings || typeof settings !== "object") {
    return;
  }

  for (const key of ["targetGroupId", "morningTime", "eveningTime", "nightTime"]) {
    if (typeof settings[key] === "string" && settings[key].trim()) {
      CONFIG[key] = settings[key].trim();
    }
  }
  if (typeof settings.botEnabled === "boolean") {
    botEnabled = settings.botEnabled;
  }
}

function persistSettings() {
  saveJsonFile(SETTINGS_FILE, {
    targetGroupId: CONFIG.targetGroupId,
    morningTime: CONFIG.morningTime,
    eveningTime: CONFIG.eveningTime,
    nightTime: CONFIG.nightTime,
    botEnabled,
  });
}

function loadSentMessages() {
  const history = loadJsonFile(SENT_MESSAGES_FILE, []);
  sentMessages = Array.isArray(history) ? history.slice(0, 10) : [];
}

function recordSentMessage(category, text, automatic = false) {
  sentMessages.unshift({
    time: new Date().toISOString(),
    category,
    text,
    automatic,
  });
  sentMessages = sentMessages.slice(0, 10);
  saveJsonFile(SENT_MESSAGES_FILE, sentMessages);
}

function getConnectionStatus() {
  if (connectionState === "open") {
    return "connected";
  }
  if (connectionState === "connecting") {
    return "connecting";
  }
  return "disconnected";
}

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

async function sendToTarget(text, category = "test", automatic = false) {
  if (!isTargetConfigured()) {
    throw new Error("Hedef grup seçilmedi.");
  }
  if (!socket || connectionState !== "open") {
    throw new Error("WhatsApp bağlı değil.");
  }
  if (!botEnabled) {
    throw new Error("Bot pasif durumda.");
  }

  await socket.sendMessage(CONFIG.targetGroupId, { text });
  recordSentMessage(category, text, automatic);
  return text;
}

async function checkSchedule() {
  if (!socket || connectionState !== "open" || !isTargetConfigured() || !botEnabled) {
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
      await sendToTarget(message, category, true);
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
    const groupData = await currentSocket.groupFetchAllParticipating();
    const groupList = Object.values(groupData).sort((a, b) =>
      (a.subject || "").localeCompare(b.subject || "", "tr"),
    );
    groups = groupList.map((group) => ({
      id: group.id,
      subject: group.subject || "(isimsiz grup)",
    }));

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
  if (!botEnabled) {
    return;
  }

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
  connectionState = "connecting";
  lastConnectionError = null;
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
      try {
        qrDataUrl = await QRCode.toDataURL(qr, {
          width: 360,
          margin: 2,
          color: {
            dark: "#111827",
            light: "#ffffff",
          },
        });
        log("Web panel için QR kodu hazır.");
      } catch (error) {
        lastConnectionError = `QR oluşturulamadı: ${error.message}`;
        log(lastConnectionError);
      }
    }

    if (connection === "open") {
      connectionState = "open";
      qrDataUrl = null;
      connectedAccount = socket.user
        ? {
            id: socket.user.id,
            name: socket.user.name || socket.user.verifiedName || "WhatsApp hesabı",
          }
        : null;
      lastConnectionError = null;
      log("WhatsApp bağlandı.");
      await printGroups(socket);
      await checkSchedule();
    }

    if (connection === "close") {
      connectionState = "disconnected";
      qrDataUrl = null;
      connectedAccount = null;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;

      if (loggedOut) {
        lastConnectionError = "WhatsApp oturumu kapatıldı.";
        log(
          "WhatsApp oturumu kapatıldı. auth_info_baileys klasörünü silmeden önce tekrar giriş yapılamaz.",
        );
        return;
      }

      lastConnectionError = "WhatsApp bağlantısı koptu.";
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

function getMessageCounts() {
  const messageData = readMessages();
  const categories = [
    ["morning", "Günaydın"],
    ["evening", "Akşam"],
    ["night", "İyi geceler"],
    ["romantic", "Romantik"],
    ["funny", "Komik"],
    ["longing", "Özlem"],
    ["compliment", "İltifat"],
  ];

  return categories.map(([key, label]) => ({
    key,
    label,
    count: Array.isArray(messageData[key]) ? messageData[key].length : 0,
  }));
}

function getTargetGroup() {
  return groups.find((group) => group.id === CONFIG.targetGroupId) || null;
}

function getStatusPayload() {
  return {
    status: getConnectionStatus(),
    connectionState,
    botEnabled,
    qrAvailable: Boolean(qrDataUrl),
    connectedAccount,
    targetGroup: {
      id: CONFIG.targetGroupId,
      name: getTargetGroup()?.subject || null,
      configured: isTargetConfigured(),
    },
    schedule: {
      morning: CONFIG.morningTime,
      evening: CONFIG.eveningTime,
      night: CONFIG.nightTime,
      timezone: CONFIG.timezone,
    },
    groupCount: groups.length,
    messageCounts: getMessageCounts(),
    recentMessages: sentMessages,
    error: lastConnectionError,
  };
}

function isValidTime(value) {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

async function sendPanelMessage(category) {
  if (category === "test") {
    return sendToTarget("Bot test mesajı başarılı.", "test");
  }

  const message = getRandomMessage(category);
  if (!message) {
    throw new Error(`"${category}" kategorisinde mesaj bulunamadı.`);
  }
  return sendToTarget(message, category);
}

function startWebServer() {
  const app = express();
  app.use(express.json({ limit: "32kb" }));
  app.use(express.static(PUBLIC_DIR));

  app.get("/api/status", (_request, response) => {
    response.json(getStatusPayload());
  });

  app.get("/api/qr", (_request, response) => {
    response.json({
      qr: qrDataUrl,
      connected: connectionState === "open",
    });
  });

  app.get("/api/groups", async (_request, response) => {
    if (socket && connectionState === "open") {
      await printGroups(socket);
    }
    response.json({ groups, targetGroupId: CONFIG.targetGroupId });
  });

  app.post("/api/group", (request, response) => {
    const { groupId } = request.body || {};
    if (
      typeof groupId !== "string" ||
      !groupId.endsWith("@g.us") ||
      (groups.length > 0 && !groups.some((group) => group.id === groupId))
    ) {
      return response.status(400).json({
        ok: false,
        message: "Geçerli bir WhatsApp grubu seçilmedi.",
      });
    }

    CONFIG.targetGroupId = groupId;
    persistSettings();
    response.json({
      ok: true,
      message: "Hedef grup kaydedildi.",
      targetGroup: getTargetGroup(),
    });
  });

  app.post("/api/bot/toggle", (request, response) => {
    const bodyEnabled = request.body?.enabled;
    botEnabled =
      typeof bodyEnabled === "boolean" ? bodyEnabled : !botEnabled;
    persistSettings();
    response.json({
      ok: true,
      enabled: botEnabled,
      message: botEnabled ? "Bot aktif edildi." : "Bot pasif edildi.",
    });
  });

  app.post("/api/test-message", async (_request, response) => {
    try {
      const message = await sendPanelMessage("test");
      response.json({ ok: true, message: "Test mesajı gönderildi.", sentText: message });
    } catch (error) {
      response.status(400).json({ ok: false, message: error.message });
    }
  });

  app.post("/api/send-message", async (request, response) => {
    const category = request.body?.category;
    if (!["test", "morning", "night"].includes(category)) {
      return response.status(400).json({
        ok: false,
        message: "Geçersiz mesaj türü.",
      });
    }

    try {
      const message = await sendPanelMessage(category);
      response.json({
        ok: true,
        message: "Mesaj gönderildi.",
        sentText: message,
      });
    } catch (error) {
      response.status(400).json({ ok: false, message: error.message });
    }
  });

  app.post("/api/schedule", (request, response) => {
    const { morning, evening, night } = request.body || {};
    if (![morning, evening, night].every(isValidTime)) {
      return response.status(400).json({
        ok: false,
        message: "Saatleri SS:DD biçiminde gir.",
      });
    }

    CONFIG.morningTime = morning;
    CONFIG.eveningTime = evening;
    CONFIG.nightTime = night;
    persistSettings();
    response.json({ ok: true, message: "Zamanlama ayarları kaydedildi." });
  });

  app.use((_request, response) => {
    response.sendFile(path.join(PUBLIC_DIR, "index.html"));
  });

  app.listen(PORT, "0.0.0.0", () => {
    log(`Web panel hazır: http://0.0.0.0:${PORT}`);
  });
}

loadPersistedSettings();
loadSentMessages();
startWebServer();
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