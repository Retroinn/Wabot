const $ = (selector) => document.querySelector(selector);

const connectionLabels = {
  connected: ["Bağlı", "WhatsApp Bağlandı ✓", "status-dot-connected"],
  connecting: ["Bağlanıyor", "WhatsApp bağlanıyor", "status-dot-connecting"],
  disconnected: ["Bağlantı yok", "Bağlantı yok", "status-dot-disconnected"],
};

let currentTargetId = "";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showNotice(message, error = false) {
  const notice = $("#notice");
  notice.textContent = message;
  notice.className = `notice${error ? " error" : ""}`;
  notice.style.display = "block";
  window.clearTimeout(showNotice.timer);
  showNotice.timer = window.setTimeout(() => {
    notice.style.display = "none";
  }, 4500);
}

async function request(url, options) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || "İşlem başarısız.");
  }
  return data;
}

function renderStatus(status) {
  const [shortLabel, title, dotClass] =
    connectionLabels[status.status] || connectionLabels.disconnected;
  $("#connection-title").textContent = title;
  $("#connection-label").textContent = shortLabel;
  $("#connection-dot").className = `status-dot ${dotClass}`;
  $("#bot-state").textContent = status.botEnabled ? "Bot aktif" : "Bot pasif";
  $("#bot-state").className = `tag${status.botEnabled ? "" : " tag-warning"}`;
  $("#toggle-bot").textContent = status.botEnabled ? "Botu Pasif Et" : "Botu Aktif Et";

  const account = status.connectedAccount;
  $("#account-name").textContent = account?.name || "Henüz bağlı değil";
  $("#account-id").textContent = account?.id || "—";

  currentTargetId = status.targetGroup?.id || "";
  $("#target-name").textContent = status.targetGroup?.name || "Grup seçilmedi";
  $("#target-id").textContent = currentTargetId || "BURAYA_GRUP_ID";
  $("#target-state").textContent = status.targetGroup?.configured ? "Aktif hedef" : "Seçilmedi";
  $("#target-state").className = `tag${status.targetGroup?.configured ? "" : " tag-warning"}`;

  const schedule = status.schedule || {};
  $("#morning-time").value = schedule.morning || "08:30";
  $("#evening-time").value = schedule.evening || "19:00";
  $("#night-time").value = schedule.night || "23:30";

  renderCounts(status.messageCounts || []);
  renderRecent(status.recentMessages || []);
}

function renderQr(qrData) {
  const qrContent = $("#qr-content");
  if (qrData.connected) {
    qrContent.innerHTML = '<div class="qr-success">WhatsApp Bağlandı ✓</div><p>QR kod artık gerekli değil.</p>';
    return;
  }
  if (qrData.qr) {
    qrContent.innerHTML = `<img src="${qrData.qr}" alt="WhatsApp bağlantı QR kodu" /><p>WhatsApp &gt; Bağlı cihazlar &gt; Cihaz bağla</p>`;
    return;
  }
  qrContent.innerHTML = '<div class="spinner"></div><p>QR kod bekleniyor...</p>';
}

function renderGroups(groupData) {
  const list = $("#groups-list");
  const groupItems = groupData.groups || [];
  $("#group-count").textContent = `${groupItems.length} grup`;
  if (groupItems.length === 0) {
    list.innerHTML = '<div class="empty-state">WhatsApp bağlandıktan sonra gruplar burada görünecek.</div>';
    return;
  }

  list.innerHTML = groupItems.map((group) => {
    const selected = group.id === currentTargetId;
    return `
      <div class="group-item">
        <div class="group-copy">
          <strong>${escapeHtml(group.subject)}</strong>
          <small>${escapeHtml(group.id)}</small>
        </div>
        <button class="select-group${selected ? " selected" : ""}" data-group-id="${escapeHtml(group.id)}" type="button">
          ${selected ? "Seçildi" : "Seç"}
        </button>
      </div>`;
  }).join("");
}

function renderCounts(counts) {
  $("#message-counts").innerHTML = counts.map((item) => `
    <div class="count-item">
      <span>${escapeHtml(item.label)}</span>
      <strong>${item.count} mesaj</strong>
    </div>`).join("");
}

function formatHistoryTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("tr-TR", {
    timeZone: "Europe/Istanbul",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderRecent(items) {
  const list = $("#recent-messages");
  if (items.length === 0) {
    list.innerHTML = '<div class="empty-state">Henüz gönderilmiş mesaj yok.</div>';
    return;
  }
  list.innerHTML = items.map((item) => `
    <div class="recent-item">
      <span class="recent-time">${formatHistoryTime(item.time)}</span>
      <div class="recent-copy">
        <strong>${escapeHtml(item.text)}</strong>
        <small>${item.automatic ? "Otomatik mesaj" : "Panel mesajı"}</small>
      </div>
    </div>`).join("");
}

async function refreshStatus() {
  try {
    const [status, qr] = await Promise.all([
      request("/api/status"),
      request("/api/qr"),
    ]);
    renderStatus(status);
    renderQr(qr);
  } catch (error) {
    showNotice(error.message, true);
  }
}

async function refreshGroups() {
  try {
    const data = await request("/api/groups");
    currentTargetId = data.targetGroupId || currentTargetId;
    renderGroups(data);
    await refreshStatus();
    showNotice("Gruplar yenilendi.");
  } catch (error) {
    showNotice(error.message, true);
  }
}

async function toggleBot() {
  const button = $("#toggle-bot");
  button.disabled = true;
  try {
    const status = await request("/api/status");
    const result = await request("/api/bot/toggle", {
      method: "POST",
      body: JSON.stringify({ enabled: !status.botEnabled }),
    });
    showNotice(`✓ ${result.message}`);
    await refreshStatus();
  } catch (error) {
    showNotice(`✗ ${error.message}`, true);
  } finally {
    button.disabled = false;
  }
}

async function sendMessage(category, button) {
  button.disabled = true;
  try {
    const result = await request("/api/send-message", {
      method: "POST",
      body: JSON.stringify({ category }),
    });
    showNotice(`✓ ${result.message} ${result.sentText ? `— ${result.sentText}` : ""}`);
    await refreshStatus();
  } catch (error) {
    showNotice(`✗ ${error.message}`, true);
  } finally {
    button.disabled = false;
  }
}

$("#toggle-bot").addEventListener("click", toggleBot);
$("#refresh-groups").addEventListener("click", refreshGroups);
$("#groups-list").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-group-id]");
  if (!button) return;
  button.disabled = true;
  try {
    const result = await request("/api/group", {
      method: "POST",
      body: JSON.stringify({ groupId: button.dataset.groupId }),
    });
    showNotice(`✓ ${result.message}`);
    await refreshStatus();
    await refreshGroups();
  } catch (error) {
    showNotice(`✗ ${error.message}`, true);
    button.disabled = false;
  }
});

$("#schedule-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const result = await request("/api/schedule", {
      method: "POST",
      body: JSON.stringify({
        morning: form.get("morning"),
        evening: form.get("evening"),
        night: form.get("night"),
      }),
    });
    showNotice(`✓ ${result.message}`);
  } catch (error) {
    showNotice(`✗ ${error.message}`, true);
  }
});

document.querySelectorAll("[data-message-category]").forEach((button) => {
  button.addEventListener("click", () => sendMessage(button.dataset.messageCategory, button));
});

refreshStatus();
refreshGroups();
window.setInterval(refreshStatus, 4000);
window.setInterval(refreshGroups, 15000);