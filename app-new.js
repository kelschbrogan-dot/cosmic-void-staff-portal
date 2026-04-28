const API = "https://remoteworker23.jeoliver1fan.workers.dev/";
const params = new URLSearchParams(window.location.search);
const userId = params.get("id");
const token = params.get("token");

const AVAILABLE_MONTHS = [
  "2026-04",
  "2026-05"
];

const state = {
  staff: [],
  ratings: [],
  notes: [],
  messages: [],
  month: getCurrentMonth(),
  user: null,
  reviewFilter: "all",
  maintenance: false
};

const noteDrafts = new Map();
const adminStaffNoteDrafts = new Map();
const openReviewNoteSections = new Set();
const pendingNoteSaves = new Set();
const messageComposeDraft = {
  scope: "all",
  title: "",
  body: "",
  isUrgent: false,
  selectedIds: []
};
let optimisticNoteSequence = 0;
let activeAdminModalTargetId = null;
let hasPromptedUnreadMessages = false;

function getCurrentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function isTrue(value) {
  return value === true || String(value || "").trim().toLowerCase() === "true";
}

function normalizeRoleValue(value) {
  if (value === true) return "ADMIN";
  if (value === false || value === null || value === undefined) return null;

  if (Array.isArray(value)) {
    for (const item of value) {
      const normalizedItem = normalizeRoleValue(item);
      if (normalizedItem) return normalizedItem;
    }
    return null;
  }

  if (typeof value === "object") {
    return normalizeRoleValue(
      value.role ??
      value.name ??
      value.type ??
      value.isWebAdmin ??
      value.permission ??
      value.permissions
    );
  }

  const normalized = String(value).trim().toUpperCase();
  if (!normalized) return null;

  if (["FALSE", "MEMBER", "NONE", "NULL", "0", "NO"].includes(normalized)) {
    return "MEMBER";
  }
  if (normalized.includes("DEVELOPER")) return "DEVELOPER";
  if (normalized.includes("ADMINISTRATOR")) return "ADMINISTRATOR";
  if (normalized.includes("ADMIN")) return "ADMIN";
  if (["TRUE", "1", "YES"].includes(normalized)) return "ADMIN";

  return null;
}

function getUserRole(user) {
  if (!user) return "MEMBER";

  let memberMatch = false;
  const candidates = [
    user.role,
    user.isWebAdmin,
    user.webRole,
    user.adminRole,
    user.permission,
    user.permissions,
    user.staffRole
  ];

  for (const candidate of candidates) {
    const normalized = normalizeRoleValue(candidate);
    if (!normalized) continue;
    if (normalized === "MEMBER") {
      memberMatch = true;
      continue;
    }
    return normalized;
  }

  if (isTrue(user.isAdmin) || isTrue(user.webAdmin)) {
    return "ADMIN";
  }

  return memberMatch ? "MEMBER" : "MEMBER";
}

function getRoleLabel(role) {
  switch (role) {
    case "DEVELOPER":
      return "Developer";
    case "ADMINISTRATOR":
      return "Administrator";
    case "ADMIN":
      return "Moderator";
    default:
      return "Member";
  }
}

function isAdmin(user) {
  return getUserRole(user) !== "MEMBER";
}

function canManageMaintenance(user) {
  const role = getUserRole(user);
  return role === "Developer" || role === "Administrator";
}

function canAddAdmins(user) {
  const role = getUserRole(user);
  return role === "DEVELOPER" || role === "ADMINISTRATOR";
}

function canSendMessages(user) {
  return isAdmin(user);
}

function mapRatingToNumber(value) {
  const normalized = String(value || "").trim().toLowerCase();
  const lookup = {
    excels: 5,
    "on par": 4,
    "meets standards": 3,
    "below par": 2,
    "needs work": 1
  };

  if (lookup[normalized] !== undefined) return lookup[normalized];
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function isPositiveRating(value) {
  const rating = mapRatingToNumber(value);
  return typeof rating === "number" && rating >= 3;
}

function isNegativeRating(value) {
  const rating = mapRatingToNumber(value);
  return typeof rating === "number" && rating <= 2;
}

function computeAverageRating(ratings = []) {
  const values = Array.isArray(ratings)
    ? ratings.map(item => mapRatingToNumber(item.rating)).filter(value => typeof value === "number")
    : [];

  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function getEl(id) {
  return document.getElementById(id);
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function isAnonymousNoteText(noteText) {
  return String(noteText || "").trim().toUpperCase().startsWith("[ANON]");
}

function isStaffNoteText(noteText) {
  return String(noteText || "").trim().toUpperCase().startsWith("[STAFF]");
}

function stripNotePrefixes(noteText) {
  let text = String(noteText || "").trim();
  let changed = true;

  while (changed && text) {
    changed = false;
    if (text.toUpperCase().startsWith("[ANON]")) {
      text = text.slice(6).trim();
      changed = true;
    }
    if (text.toUpperCase().startsWith("[STAFF]")) {
      text = text.slice(7).trim();
      changed = true;
    }
  }

  return text;
}

function getNoteTimestamp(note) {
  const parsed = Date.parse(note?.updatedAt || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function sortNotesForDisplay(notes) {
  return [...notes].sort((a, b) => {
    const staffPriority = Number(isStaffNoteText(b.note)) - Number(isStaffNoteText(a.note));
    if (staffPriority !== 0) return staffPriority;
    const updatedAtDiff = getNoteTimestamp(b) - getNoteTimestamp(a);
    if (updatedAtDiff !== 0) return updatedAtDiff;
    return String(getReviewerName(a.reviewerId)).localeCompare(String(getReviewerName(b.reviewerId)));
  });
}

function getNoteSaveKey(scope, targetId) {
  return `${scope}:${String(targetId).trim()}`;
}

function getReviewNoteDraft(targetId) {
  return noteDrafts.get(String(targetId).trim()) || {
    type: "Positive",
    text: "",
    anonymous: false
  };
}

function setReviewNoteDraft(targetId, updates) {
  const key = String(targetId).trim();
  noteDrafts.set(key, { ...getReviewNoteDraft(key), ...updates });
}

function clearReviewNoteDraft(targetId) {
  noteDrafts.delete(String(targetId).trim());
}

function getAdminStaffNoteDraft(targetId) {
  return adminStaffNoteDrafts.get(String(targetId).trim()) || {
    type: "Positive",
    text: ""
  };
}

function setAdminStaffNoteDraft(targetId, updates) {
  const key = String(targetId).trim();
  adminStaffNoteDrafts.set(key, { ...getAdminStaffNoteDraft(key), ...updates });
}

function clearAdminStaffNoteDraft(targetId) {
  adminStaffNoteDrafts.delete(String(targetId).trim());
}

function encodeStructuredNoteValue(value) {
  return encodeURIComponent(String(value || ""));
}

function decodeStructuredNoteValue(value) {
  try {
    return decodeURIComponent(String(value || ""));
  } catch (error) {
    return String(value || "");
  }
}

function buildMessageNoteText({ id, scope, title, body }) {
  const segments = [
    `id=${encodeStructuredNoteValue(id)}`,
    `scope=${encodeStructuredNoteValue(scope)}`,
    `title=${encodeStructuredNoteValue(title)}`
  ];
  return `[MESSAGE|${segments.join("|")}] ${String(body || "").trim()}`.trim();
}

function buildMessageReadNoteText({ id }) {
  return `[MESSAGE_READ|id=${encodeStructuredNoteValue(id)}]`;
}

function parseStructuredNote(noteText) {
  const match = String(noteText || "").trim().match(/^\[(MESSAGE|MESSAGE_READ)(?:\|([^\]]+))?\]\s*([\s\S]*)$/i);
  if (!match) return null;

  const [, rawKind, rawMeta = "", rawBody = ""] = match;
  const meta = {};

  if (rawMeta) {
    rawMeta.split("|").forEach(segment => {
      const separatorIndex = segment.indexOf("=");
      if (separatorIndex === -1) return;
      const key = segment.slice(0, separatorIndex).trim().toLowerCase();
      const value = segment.slice(separatorIndex + 1);
      if (!key) return;
      meta[key] = decodeStructuredNoteValue(value);
    });
  }

  return {
    kind: rawKind.toUpperCase(),
    meta,
    body: rawBody.trim()
  };
}

function getStructuredNote(note) {
  return parseStructuredNote(typeof note === "string" ? note : note?.note);
}

function isMessageNote(note) {
  return getStructuredNote(note)?.kind === "MESSAGE";
}

function isMessageReadNote(note) {
  return getStructuredNote(note)?.kind === "MESSAGE_READ";
}

function isSystemMessageEntry(note) {
  return isMessageNote(note) || isMessageReadNote(note);
}

function getStandardNotes(notes = state.notes) {
  return notes.filter(note => !isSystemMessageEntry(note));
}

function generateMessageId() {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function pluralize(count, singular, pluralForm) {
  return `${count} ${count === 1 ? singular : (pluralForm || `${singular}s`)}`;
}

function formatDateTime(value) {
  const parsed = Date.parse(value || "");
  if (!Number.isFinite(parsed)) return "Unknown time";
  return new Date(parsed).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function getSendableStaff(includeSuspended = true) {
  return state.staff.filter(member => {
    if (!member) return false;
    if (String(member.discordId).trim() === String(userId).trim()) return false;
    return includeSuspended ? true : isTrue(member.isActive);
  });
}

function normalizeMessageList(values) {
  if (!Array.isArray(values)) return [];
  return values.map(value => String(value || "").trim()).filter(Boolean);
}

function getAllActiveRecipientIds(senderId) {
  return state.staff
    .filter(member => member && isTrue(member.isActive) && String(member.discordId).trim() !== String(senderId || "").trim())
    .map(member => String(member.discordId).trim());
}

function matchesAllActiveStaff(recipientIds, senderId) {
  const activeRecipientIds = getAllActiveRecipientIds(senderId);
  if (!activeRecipientIds.length) return false;
  if (recipientIds.includes("ALL")) return true;
  return recipientIds.length === activeRecipientIds.length && activeRecipientIds.every(id => recipientIds.includes(id));
}

function normalizeMessageRecord(message) {
  const recipientIds = normalizeMessageList(message?.recipientIds);
  const readBy = normalizeMessageList(message?.readBy);
  const senderId = String(message?.senderId || "").trim();
  const scope = matchesAllActiveStaff(recipientIds, senderId)
    ? "all"
    : recipientIds.length <= 1
      ? "single"
      : "selected";

  return {
    id: String(message?.id || "").trim(),
    senderId,
    recipientIds,
    subject: String(message?.subject || "").trim() || "Portal Message",
    message: String(message?.message || "").trim(),
    isUrgent: isTrue(message?.isUrgent),
    sentAt: message?.sentAt || "",
    readBy,
    scope
  };
}

function resolveMessageRecipientIds(message) {
  const normalized = normalizeMessageRecord(message);

  if (!normalized.recipientIds.includes("ALL")) {
    return [...new Set(normalized.recipientIds)];
  }

  const activeRecipients = getAllActiveRecipientIds(normalized.senderId);

  return [...new Set([...activeRecipients, ...normalized.readBy])];
}

function getMessageDataset() {
  const allMessages = (Array.isArray(state.messages) ? state.messages : [])
    .map(normalizeMessageRecord)
    .filter(message => message.id);

  const groupedMessages = allMessages.map(message => {
    const resolvedRecipientIds = resolveMessageRecipientIds(message);
    const recipients = resolvedRecipientIds.map(recipientId => ({
      recipientId,
      recipientName: getReviewerName(recipientId),
      isRead: message.readBy.includes(recipientId),
      readAt: null,
      isActive: isTrue(state.staff.find(member => String(member.discordId).trim() === recipientId)?.isActive)
    })).sort((a, b) => {
      if (a.isRead !== b.isRead) return Number(a.isRead) - Number(b.isRead);
      return String(a.recipientName).localeCompare(String(b.recipientName));
    });

    const readCount = recipients.filter(recipient => recipient.isRead).length;

    return {
      messageId: message.id,
      scope: message.scope,
      title: message.subject,
      body: message.message,
      senderId: message.senderId,
      senderName: getReviewerName(message.senderId),
      sentAt: message.sentAt,
      isUrgent: message.isUrgent,
      recipients,
      readCount,
      unreadCount: Math.max(recipients.length - readCount, 0),
      totalRecipients: recipients.length
    };
  }).sort((a, b) => Date.parse(b.sentAt || "") - Date.parse(a.sentAt || ""));

  const inboxMessages = allMessages
    .filter(message =>
      message.senderId !== String(userId).trim() &&
      (message.recipientIds.includes(String(userId).trim()) || matchesAllActiveStaff(message.recipientIds, message.senderId))
    )
    .map(message => ({
      ...message,
      title: message.subject,
      body: message.message,
      messageId: message.id,
      senderName: getReviewerName(message.senderId),
      isRead: message.readBy.includes(String(userId).trim()),
      readAt: null
    }))
    .sort((a, b) => {
      if (a.isRead !== b.isRead) return Number(a.isRead) - Number(b.isRead);
      return Date.parse(b.sentAt || "") - Date.parse(a.sentAt || "");
    });

  return {
    messages: allMessages,
    groupedMessages,
    inboxMessages
  };
}

function getInboxMessages() {
  return getMessageDataset().inboxMessages;
}

function getUnreadMessages() {
  return getInboxMessages().filter(message => !message.isRead);
}

function getMessageScopeLabel(scope, totalRecipients) {
  if (scope === "all") return "All active staff";
  if (scope === "single") return "Single staff member";
  return `${pluralize(totalRecipients, "selected staff member")}`;
}

function createOptimisticNote({ reviewerId, targetId, type, note }) {
  return {
    month: state.month,
    reviewerId: String(reviewerId).trim(),
    targetId: String(targetId).trim(),
    type: String(type || "Positive").trim() || "Positive",
    note: String(note || "").trim(),
    updatedAt: new Date().toISOString(),
    pending: true,
    localId: `local-note-${Date.now()}-${optimisticNoteSequence++}`
  };
}

function addOptimisticNote(note) {
  state.notes = [...state.notes, note];
  return note;
}

function finalizeOptimisticNote(note) {
  let found = false;

  state.notes = state.notes.map(currentNote => {
    if (currentNote.localId !== note.localId) return currentNote;
    found = true;
    return { ...currentNote, pending: false };
  });

  if (!found) {
    state.notes = [...state.notes, { ...note, pending: false }];
  }
}

function removeOptimisticNote(localId) {
  state.notes = state.notes.filter(note => note.localId !== localId);
}

function refreshAdminStaffModal(targetId) {
  if (activeAdminModalTargetId === String(targetId).trim()) {
    openAdminStaffModal(targetId);
  }
}

function getReviewerName(reviewerId) {
  return state.staff.find(member => String(member.discordId).trim() === String(reviewerId).trim())?.name || reviewerId;
}

function getReviewTargets() {
  return state.staff.filter(member => member && isTrue(member.isActive) && String(member.discordId).trim() !== String(userId).trim());
}

function getMyRatings() {
  return state.ratings.filter(rating => {
    const reviewerMatches = String(rating.reviewerId).trim() === String(userId).trim();
    const targetMatches = String(rating.targetId).trim() !== String(userId).trim();
    return reviewerMatches && targetMatches && rating.rating && rating.rating !== "N/A";
  });
}

function getMyNotes() {
  return getStandardNotes(state.notes).filter(note => {
    const reviewerMatches = String(note.reviewerId).trim() === String(userId).trim();
    const targetMatches = String(note.targetId).trim() !== String(userId).trim();
    return reviewerMatches && targetMatches;
  });
}

function showSpinner() {
  const spinner = getEl("loadingSpinner");
  if (spinner) spinner.style.display = "block";
}

function hideSpinner() {
  const spinner = getEl("loadingSpinner");
  if (spinner) spinner.style.display = "none";
}

function showStatus(message, type = "info") {
  const status = getEl("statusMessage");
  if (!status) return;
  status.textContent = message;
  status.className = `status-message ${type}`;
}

function showError(message) {
  hideSpinner();
  showStatus(message, "error");
  const reviewsBox = getEl("reviewsBox");
  if (reviewsBox) {
    reviewsBox.innerHTML = `<div class="card"><p>${escapeHtml(message)}</p></div>`;
  }
}

function showPopup(title, html, actions = []) {
  const overlay = getEl("popupOverlay");
  const titleEl = getEl("popupTitle");
  const bodyEl = getEl("popupBody");
  const actionsEl = getEl("popupActions");

  if (!overlay || !titleEl || !bodyEl || !actionsEl) return;

  titleEl.textContent = title;
  bodyEl.innerHTML = html;
  actionsEl.innerHTML = actions.map(action => `
    <button class="overlay-button ${action.secondary ? "secondary" : ""}" id="${action.id}">
      ${escapeHtml(action.text)}
    </button>
  `).join("");

  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");

  const closeButton = getEl("popupClose");
  if (closeButton) {
    closeButton.onclick = hidePopup;
  }

  overlay.onclick = event => {
    if (event.target === overlay) hidePopup();
  };

  actions.forEach(action => {
    if (!action.id || !action.callback) return;
    const actionEl = getEl(action.id);
    if (actionEl) actionEl.onclick = action.callback;
  });
}

function hidePopup() {
  const overlay = getEl("popupOverlay");
  const bodyEl = getEl("popupBody");
  const actionsEl = getEl("popupActions");

  if (!overlay || !bodyEl || !actionsEl) return;

  overlay.classList.add("hidden");
  overlay.setAttribute("aria-hidden", "true");
  bodyEl.innerHTML = "";
  actionsEl.innerHTML = "";
  activeAdminModalTargetId = null;
}

  if (state.maintenance && !canManageMaintenance(verifiedUser)) {
    showDeniedOverlay("MAINTENANCE");
    return false;
  }

function showDeniedOverlay(reason) {
  let title = "Access Denied";
  let message = "You do not have permission to access this portal.";

  if (reason === "INVALID_LOGIN") {
    message = "This is for official use by members of the Cosmic Void Staff Team. If this is a mistake, contact a Cosmic Commander.";
  } else if (reason === "SUSPENDED") {
    title = "Access Revoked";
    message = "Your access to the Cosmic Void Staff Portal has been revoked by a Cosmic Commander.";
  } else if (reason === "MAINTENANCE") {
    title = "Maintenance";
    message = "The portal is temporarily unavailable due to maintenance. Please check back shortly.";
  }

  showPopup(title, `<p>${escapeHtml(message)}</p>`, [
    { id: "popupCloseBtn", text: "Close", secondary: true, callback: hidePopup }
  ]);
}

window.addEventListener("unhandledrejection", event => {
  console.error("Unhandled promise rejection:", event.reason);
  showError("Unexpected error occurred while loading. Please refresh the page.");
});

window.addEventListener("error", event => {
  console.error("Unhandled error:", event.error || event.message);
  showError("Unexpected error occurred while loading. Please refresh the page.");
});

async function fetchApi(action, data = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...data }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error(`API ${action} failed with status`, response.status);
      return null;
    }

    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    console.error(`API ${action} crashed:`, error);
    return null;
  }
}

async function verifyUser() {
  if (!userId || !token) {
    showDeniedOverlay("INVALID_LOGIN");
    return false;
  }

  showStatus("Verifying credentials...");

  const [tokenRes, verifyRes, maintenanceRes] = await Promise.all([
    fetchApi("getToken", { discordId: userId }),
    fetchApi("verifyUser", { discordId: userId, token }),
    fetchApi("getMaintenanceMode", {})
  ]);

  if (!tokenRes || !verifyRes) {
    console.error("Verification failed:", { tokenRes, verifyRes, maintenanceRes });
    showError("Failed to contact server. Try again.");
    return false;
  }

  state.maintenance = isTrue(maintenanceRes?.maintenance);

  if (!isTrue(tokenRes.success)) {
    showDeniedOverlay("INVALID_LOGIN");
    return false;
  }

  if (!isTrue(tokenRes.isActive)) {
    showDeniedOverlay("SUSPENDED");
    return false;
  }

  if (!isTrue(verifyRes.valid) && !state.maintenance) {
    showDeniedOverlay("INVALID_LOGIN");
    return false;
  }

  const verifiedUser = {
    discordId: userId,
    isWebAdmin:
      verifyRes.isWebAdmin ??
      verifyRes.role ??
      verifyRes.permissions ??
      tokenRes.isWebAdmin ??
      tokenRes.role ??
      tokenRes.permissions,
    role: verifyRes.role ?? tokenRes.role,
    permissions: verifyRes.permissions ?? tokenRes.permissions,
    name: verifyRes.name ?? tokenRes.name ?? "Staff Member",
    avatarURL: verifyRes.avatarURL ?? tokenRes.avatarURL ?? ""
  };

  state.user = verifiedUser;

  const adminTab = getEl("adminTab");
  if (adminTab) {
    adminTab.classList.toggle("hidden", !isAdmin(state.user));
  }

  return true;
}

function showPage(page) {
  document.querySelectorAll("[data-page]").forEach(link => {
    link.classList.toggle("active", link.dataset.page === page);
  });

  ["reviewsPage", "adminPage", "revokedPage"].forEach(id => {
    const element = getEl(id);
    if (!element) return;
    element.classList.toggle("hidden", id !== `${page}Page`);
  });

  const menu = document.querySelector(".menu");
  if (menu) {
    menu.classList.toggle("hidden", page === "revoked");
  }
}

function buildMonthOptions() {
  const select = getEl("adminMonthSelect");
  if (!select) return;

  const monthValues = Array.from(new Set([getCurrentMonth(), ...AVAILABLE_MONTHS])).sort((a, b) => b.localeCompare(a));
  const months = monthValues.map(monthStr => {
    const [year, month] = monthStr.split("-");
    const date = new Date(Number(year), Number(month) - 1, 1);
    return {
      value: monthStr,
      display: date.toLocaleDateString("en-US", { year: "numeric", month: "long" })
    };
  });

  select.innerHTML = months.map(item => `<option value="${item.value}">${item.display}</option>`).join("");
  select.value = months.some(item => item.value === state.month) ? state.month : months[0]?.value || state.month;
  state.month = select.value;

  if (!select.dataset.bound) {
    select.addEventListener("change", async () => {
      state.month = select.value;
      await loadAdmin();
    });
    select.dataset.bound = "true";
  }
}

function renderProfileEditor() {
  return;
}

function renderReviewFilterControls() {
  const container = getEl("reviewFilterControls");
  if (!container) return;

  container.innerHTML = `
    <button id="filterAll" class="${state.reviewFilter === "all" ? "active" : ""}" type="button">All</button>
    <button id="filterIncomplete" class="${state.reviewFilter === "incomplete" ? "active" : ""}" type="button">Incomplete</button>
    <button id="filterComplete" class="${state.reviewFilter === "complete" ? "active" : ""}" type="button">Complete</button>
  `;

  ["all", "incomplete", "complete"].forEach(filter => {
    const buttonId = `filter${filter.charAt(0).toUpperCase()}${filter.slice(1)}`;
    const button = getEl(buttonId);
    if (!button) return;
    button.addEventListener("click", () => {
      state.reviewFilter = filter;
      renderReviewFilterControls();
      renderReviews();
    });
  });
}

function getReviewCompletion(member) {
  const targetId = String(member.discordId).trim();
  const currentRating = state.ratings.find(rating =>
    String(rating.targetId).trim() === targetId &&
    String(rating.reviewerId).trim() === String(userId).trim()
  );
  return !!currentRating && currentRating.rating && currentRating.rating !== "N/A";
}

function renderReviewsSummary() {
  const container = getEl("reviewsSummary");
  if (!container) return;

  const reviewTargets = getReviewTargets();
  const completedCount = reviewTargets.filter(member => getReviewCompletion(member)).length;
  const totalTargets = reviewTargets.length;
  const progressPercent = totalTargets ? Math.round((completedCount / totalTargets) * 100) : 100;
  const positiveRatings = getMyRatings().filter(rating => isPositiveRating(rating.rating)).length;
  const negativeRatings = getMyRatings().filter(rating => isNegativeRating(rating.rating)).length;
  const notesAdded = getMyNotes().length;
  const remaining = Math.max(totalTargets - completedCount, 0);
  const inboxMessages = getInboxMessages();
  const unreadCount = inboxMessages.filter(message => !message.isRead).length;

  container.innerHTML = `
    <div class="summary-shell">
      <div class="summary-topline">
        <div>
          <div class="summary-kicker">Your monthly activity</div>
          <div class="summary-progress-copy">${completedCount}/${totalTargets} reviews completed</div>
        </div>
        <div class="summary-kicker">${remaining ? `${remaining} still waiting on you` : "You are fully caught up"}</div>
      </div>
      <div class="progress-track">
        <div class="progress-fill" style="width: ${Math.min(progressPercent, 100)}%;"></div>
      </div>
      <div class="summary-grid">
        <div class="mini-stat">
          <b>Completion</b>
          <div class="stat-value accent">${completedCount}/${totalTargets}</div>
          <div class="stat-subtext">active staff reviewed</div>
        </div>
        <div class="mini-stat">
          <b>Progress</b>
          <div class="stat-value accent">${progressPercent}%</div>
          <div class="stat-subtext">this month</div>
        </div>
        <div class="mini-stat">
          <b>Positive Ratings</b>
          <div class="stat-value positive">${positiveRatings}</div>
          <div class="stat-subtext">Excels, On Par, Meets Standards</div>
        </div>
        <div class="mini-stat">
          <b>Needs Attention</b>
          <div class="stat-value negative">${negativeRatings}</div>
          <div class="stat-subtext">Below Par, Needs Work</div>
        </div>
        <div class="mini-stat">
          <b>Notes Added</b>
          <div class="stat-value">${notesAdded}</div>
          <div class="stat-subtext">notes you left for others</div>
        </div>
        <div class="mini-stat ${unreadCount ? "message-attention" : ""}">
          <b>Messages</b>
          <div class="stat-value ${unreadCount ? "warning" : "accent"}">${unreadCount}</div>
          <div class="stat-subtext">
            ${unreadCount
              ? `You've got ${pluralize(unreadCount, "unread message")}.`
              : inboxMessages.length
                ? "All portal messages have been read."
                : "No portal messages yet."}
          </div>
          <button id="openInboxButton" class="button-soft message-inline-button" type="button">Open Inbox</button>
        </div>
      </div>
    </div>
  `;

  getEl("openInboxButton")?.addEventListener("click", () => {
    openInboxModal();
  });
}

function buildInboxMessageCardHtml(message) {
  const unread = !message.isRead;

  return `
    <div class="message-card ${unread ? "message-card-unread" : "message-card-read"}">
      <div class="message-card-header">
        <div class="message-card-title">
          <div class="note-badge-row">
            <span class="note-badge ${unread ? "negative" : "positive"}">${unread ? "Unread" : "Read"}</span>
            ${message.isUrgent ? '<span class="note-badge urgent-message-badge">Urgent</span>' : ""}
          </div>
          <b>${escapeHtml(message.title)}</b>
          <small>From ${escapeHtml(message.senderName)} - ${escapeHtml(formatDateTime(message.sentAt))}</small>
        </div>
        ${unread
          ? `<button class="button-soft message-action-button" type="button" data-message-read="${escapeHtml(message.messageId)}">Mark Read</button>`
          : '<span class="message-read-pill">Confirmed</span>'}
      </div>
      <p>${escapeHtml(message.body || "No message content.")}</p>
    </div>
  `;
}

async function markMessageAsRead(messageId, options = {}) {
  const normalizedMessageId = String(messageId || "").trim();
  const message = getInboxMessages().find(item => item.messageId === normalizedMessageId);
  if (!message || message.isRead) return true;

  const saveKey = getNoteSaveKey("message-read", normalizedMessageId);
  if (pendingNoteSaves.has(saveKey)) return false;

  pendingNoteSaves.add(saveKey);
  showStatus("Marking message as read...");

  const result = await fetchApi("markMessageRead", {
    messageId: normalizedMessageId,
    userId
  });

  pendingNoteSaves.delete(saveKey);

  if (!result?.success) {
    showStatus("Failed to mark message as read.", "error");
    return false;
  }

  state.messages = state.messages.map(currentMessage => {
    if (String(currentMessage.id || "").trim() !== normalizedMessageId) return currentMessage;
    const readBy = normalizeMessageList(currentMessage.readBy);
    if (!readBy.includes(String(userId).trim())) {
      readBy.push(String(userId).trim());
    }
    return { ...currentMessage, readBy };
  });

  if (!getUnreadMessages().length) {
    hasPromptedUnreadMessages = false;
  }

  if (getEl("reviewsPage") && !getEl("reviewsPage").classList.contains("hidden")) {
    renderReviews();
  }

  if (options.reopenInbox) {
    const reopenOptions = options.reopenInbox.unreadOnly && !getUnreadMessages().length
      ? {}
      : options.reopenInbox;
    openInboxModal(reopenOptions);
  }

  showStatus("Message marked as read.");
  return true;
}

async function markAllMessagesRead(messages, reopenOptions = {}) {
  const unreadMessages = (messages || []).filter(message => !message.isRead);
  if (!unreadMessages.length) return;

  showStatus(`Marking ${pluralize(unreadMessages.length, "message")} as read...`);

  for (const message of unreadMessages) {
    const success = await markMessageAsRead(message.messageId, {});
    if (!success) break;
  }

  const nextOptions = reopenOptions.unreadOnly && !getUnreadMessages().length ? {} : reopenOptions;
  openInboxModal(nextOptions);
}

function openInboxModal(options = {}) {
  const dataset = getMessageDataset();
  const unreadOnly = options.unreadOnly === true;
  const inboxMessages = unreadOnly ? dataset.inboxMessages.filter(message => !message.isRead) : dataset.inboxMessages;
  const unreadCount = dataset.inboxMessages.filter(message => !message.isRead).length;

  const html = `
    <div class="message-modal-shell">
      <div class="message-summary-banner ${unreadCount ? "message-summary-banner-unread" : ""}">
        <div>
          <b>${unreadCount ? `You've got ${pluralize(unreadCount, "unread message")}.` : "Your inbox is clear."}</b>
          <small>${dataset.inboxMessages.length ? `${dataset.inboxMessages.length} total portal message${dataset.inboxMessages.length === 1 ? "" : "s"} available.` : "No announcements have been sent to you yet."}</small>
        </div>
        <div class="message-summary-actions">
          ${unreadOnly && dataset.inboxMessages.length !== inboxMessages.length ? '<button id="messageViewAllBtn" class="button-soft" type="button">View All</button>' : ""}
          ${unreadCount > 1 ? '<button id="markAllMessagesReadBtn" class="button-soft" type="button">Mark All Read</button>' : ""}
        </div>
      </div>
      <div class="stack-list">
        ${inboxMessages.length
          ? inboxMessages.map(buildInboxMessageCardHtml).join("")
          : '<div class="empty-state">No messages to show right now.</div>'}
      </div>
    </div>
  `;

  showPopup(unreadOnly ? "Unread Messages" : "Inbox", html, [
    { id: "closeInboxBtn", text: "Close", secondary: true, callback: hidePopup }
  ]);

  getEl("messageViewAllBtn")?.addEventListener("click", () => {
    openInboxModal();
  });

  getEl("markAllMessagesReadBtn")?.addEventListener("click", async () => {
    await markAllMessagesRead(dataset.inboxMessages, unreadOnly ? { unreadOnly: true } : {});
  });

  document.querySelectorAll("[data-message-read]").forEach(button => {
    button.addEventListener("click", async () => {
      const targetMessageId = button.getAttribute("data-message-read");
      if (!targetMessageId) return;
      await markMessageAsRead(targetMessageId, {
        reopenInbox: unreadOnly ? { unreadOnly: true } : {}
      });
    });
  });
}

function maybePromptUnreadMessages() {
  const unreadMessages = getUnreadMessages();
  if (!unreadMessages.length) {
    hasPromptedUnreadMessages = false;
    return;
  }
  if (hasPromptedUnreadMessages) return;
  hasPromptedUnreadMessages = true;
  openInboxModal({ unreadOnly: true });
}

function buildRecipientChecklistHtml(selectedIds) {
  const selected = new Set(normalizeMessageList(selectedIds));
  const recipients = getSendableStaff(true);

  return recipients.length ? recipients.map(member => {
    const targetId = String(member.discordId).trim();
    return `
      <label class="message-recipient-option" for="message-recipient-${escapeHtml(targetId)}">
        <input
          id="message-recipient-${escapeHtml(targetId)}"
          type="checkbox"
          value="${escapeHtml(targetId)}"
          data-message-recipient
          ${selected.has(targetId) ? "checked" : ""}
        >
        <span>
          <b>${escapeHtml(member.name)}</b>
          <small>${escapeHtml(getRoleLabel(getUserRole(member)))} - ${isTrue(member.isActive) ? "Active" : "Suspended"}</small>
        </span>
      </label>
    `;
  }).join("") : `<div class="empty-state">No other staff accounts are available to message.</div>`;
}

function openComposeMessageModal() {
  const scope = messageComposeDraft.scope || "all";
  const html = `
    <div class="message-compose-grid">
      <label for="messageScope">Audience</label>
      <select id="messageScope">
        <option value="all" ${scope === "all" ? "selected" : ""}>All active staff</option>
        <option value="selected" ${scope === "selected" ? "selected" : ""}>Specific staff</option>
      </select>

      <div id="messageRecipientsBlock" class="${scope === "selected" ? "" : "hidden"}">
        <label>Select recipients</label>
        <div class="message-recipient-list">
          ${buildRecipientChecklistHtml(messageComposeDraft.selectedIds)}
        </div>
      </div>

      <label for="messageSubject">Subject</label>
      <input id="messageSubject" type="text" value="${escapeHtml(messageComposeDraft.title)}" placeholder="Portal announcement title">

      <label for="messageBody">Message</label>
      <textarea id="messageBody" rows="6" placeholder="Write the announcement or notice here...">${escapeHtml(messageComposeDraft.body)}</textarea>

      <label for="messageUrgent" class="checkbox-row">
        <input id="messageUrgent" type="checkbox" ${messageComposeDraft.isUrgent ? "checked" : ""}>
        Mark as urgent
      </label>

      <button id="sendMessageSubmitBtn" class="primary-button" type="button">Send Message</button>
    </div>
  `;

  showPopup("Send Message", html, [
    { id: "closeComposeMessageBtn", text: "Close", secondary: true, callback: hidePopup }
  ]);

  getEl("messageScope")?.addEventListener("change", event => {
    messageComposeDraft.scope = event.target.value;
    openComposeMessageModal();
  });

  getEl("messageSubject")?.addEventListener("input", event => {
    messageComposeDraft.title = event.target.value;
  });

  getEl("messageBody")?.addEventListener("input", event => {
    messageComposeDraft.body = event.target.value;
  });

  getEl("messageUrgent")?.addEventListener("change", event => {
    messageComposeDraft.isUrgent = event.target.checked;
  });

  document.querySelectorAll("[data-message-recipient]").forEach(input => {
    input.addEventListener("change", () => {
      messageComposeDraft.selectedIds = Array.from(document.querySelectorAll("[data-message-recipient]:checked"))
        .map(element => element.value);
    });
  });

  getEl("sendMessageSubmitBtn")?.addEventListener("click", async () => {
    const scopeValue = getEl("messageScope")?.value || "all";
    const subject = getEl("messageSubject")?.value.trim() || "";
    const body = getEl("messageBody")?.value.trim() || "";
    const isUrgent = !!getEl("messageUrgent")?.checked;
    const selectedIds = Array.from(document.querySelectorAll("[data-message-recipient]:checked"))
      .map(element => String(element.value || "").trim())
      .filter(Boolean);

    const recipientIds = scopeValue === "all"
      ? getAllActiveRecipientIds(userId)
      : [...new Set(selectedIds)];

    if (!subject || !body) {
      showStatus("Add a subject and message before sending.");
      return;
    }

    if (!recipientIds.length) {
      showStatus("Pick at least one staff member.");
      return;
    }

    showStatus("Sending message...");
    showSpinner();

    const result = await fetchApi("sendMessage", {
      senderId: userId,
      recipientIds,
      subject,
      message: body,
      isUrgent
    });

    hideSpinner();

    if (!result?.success) {
      showStatus("Failed to send message.", "error");
      return;
    }

    const newMessage = {
      id: result.messageId,
      senderId: userId,
      recipientIds,
      subject,
      message: body,
      isUrgent,
      sentAt: new Date().toISOString(),
      readBy: []
    };

    state.messages = [newMessage, ...state.messages];
    messageComposeDraft.scope = "all";
    messageComposeDraft.title = "";
    messageComposeDraft.body = "";
    messageComposeDraft.isUrgent = false;
    messageComposeDraft.selectedIds = [];

    hidePopup();

    if (getEl("adminPage") && !getEl("adminPage").classList.contains("hidden")) {
      renderAdmin();
    }

    showStatus("Message sent.");
  });
}

function buildAdminMessageGroupHtml(group) {
  return `
    <details class="accordion-section message-admin-card">
      <summary>
        <span>
          ${escapeHtml(group.title)}
          <small class="message-summary-line">${escapeHtml(group.senderName)} - ${escapeHtml(formatDateTime(group.sentAt))} - ${escapeHtml(getMessageScopeLabel(group.scope, group.totalRecipients))}</small>
        </span>
        <span class="note-badge-row">
          ${group.isUrgent ? '<span class="note-badge urgent-message-badge">Urgent</span>' : ""}
          <span class="note-badge ${group.unreadCount ? "negative" : "positive"}">${group.readCount}/${group.totalRecipients} read</span>
        </span>
      </summary>
      <div class="accordion-content">
        <p>${escapeHtml(group.body || "No message content.")}</p>
        <div class="message-recipient-status-grid">
          ${group.recipients.map(recipient => `
            <div class="message-recipient-status ${recipient.isRead ? "read" : "unread"}">
              <b>${escapeHtml(recipient.recipientName)}</b>
              <small>${recipient.isRead ? "Read" : "Unread"}${recipient.isActive ? "" : " - Suspended"}</small>
            </div>
          `).join("")}
        </div>
      </div>
    </details>
  `;
}

function renderAdminMessageCenter() {
  const container = getEl("adminMessages");
  if (!container) return;

  const dataset = getMessageDataset();
  const totalUnread = dataset.groupedMessages.reduce((sum, group) => sum + group.unreadCount, 0);
  const fullyRead = dataset.groupedMessages.filter(group => group.unreadCount === 0).length;

  container.innerHTML = `
    <div class="summary-shell admin-message-shell">
      <div class="page-header message-center-header">
        <div>
          <h3>Messages</h3>
          <p class="page-subtitle">Send portal notices and track who has opened them.</p>
        </div>
        ${canSendMessages(state.user) ? '<button id="openComposeMessageBtn" class="primary-button" type="button">Send Message</button>' : ""}
      </div>
      <div class="summary-grid">
        <div class="mini-stat">
          <b>Total Messages</b>
          <div class="stat-value accent">${dataset.groupedMessages.length}</div>
          <div class="stat-subtext">currently tracked</div>
        </div>
        <div class="mini-stat ${totalUnread ? "message-attention" : ""}">
          <b>Unread Receipts</b>
          <div class="stat-value ${totalUnread ? "warning" : "positive"}">${totalUnread}</div>
          <div class="stat-subtext">staff still need to confirm</div>
        </div>
        <div class="mini-stat">
          <b>Fully Read</b>
          <div class="stat-value positive">${fullyRead}</div>
          <div class="stat-subtext">messages confirmed by everyone</div>
        </div>
      </div>
      <div class="message-admin-list">
        ${dataset.groupedMessages.length
          ? dataset.groupedMessages.map(buildAdminMessageGroupHtml).join("")
          : '<div class="empty-state">No messages have been sent yet.</div>'}
      </div>
    </div>
  `;

  getEl("openComposeMessageBtn")?.addEventListener("click", () => {
    openComposeMessageModal();
  });
}

function buildNoteHtml(note) {
  const anonymous = isAnonymousNoteText(note.note);
  const staffNote = isStaffNoteText(note.note);
  const noteText = stripNotePrefixes(note.note) || "No note content.";
  const noteToneClass = note.type === "Negative" ? "note-negative" : "note-positive";
  const reviewerName = anonymous && !staffNote ? "Anonymous" : getReviewerName(note.reviewerId);
  const badges = [];

  if (staffNote) {
    badges.push(`<span class="staff-note-badge">[STAFF]</span>`);
  }

  if (note.pending) {
    badges.push(`<span class="note-badge pending-note-badge">Saving...</span>`);
  }

  badges.push(
    `<span class="note-badge ${note.type === "Negative" ? "negative" : "positive"}">${escapeHtml(note.type || "Note")}</span>`
  );

  if (anonymous && !staffNote) {
    badges.push(`<span class="role-pill">Anonymous</span>`);
  }

  return `
    <div class="note-item ${noteToneClass}${anonymous ? " anonymous-note" : ""}${staffNote ? " staff-note" : ""}${note.pending ? " pending-note" : ""}">
      <div class="note-meta">
        <div class="note-badge-row">${badges.join("")}</div>
        <small>${escapeHtml(reviewerName)}</small>
      </div>
      <p>${escapeHtml(noteText)}</p>
    </div>
  `;
}

function buildRatingsHtml(ratings) {
  if (!ratings.length) {
    return `<div class="empty-state">No reviews have been submitted for this staff member yet.</div>`;
  }

  const sortedRatings = [...ratings].sort((a, b) => {
    return String(getReviewerName(a.reviewerId)).localeCompare(String(getReviewerName(b.reviewerId)));
  });

  return sortedRatings.map(rating => {
    const reviewerName = String(rating.reviewerId).trim() === String(userId).trim() ? "You" : getReviewerName(rating.reviewerId);
    const toneClass = isPositiveRating(rating.rating) ? "positive" : isNegativeRating(rating.rating) ? "negative" : "neutral";
    const comment = String(rating.comment || "").trim() || "No comment left.";

    return `
      <div class="review-card">
        <div class="review-card-header">
          <b>${escapeHtml(reviewerName)}</b>
          <span class="rating-pill ${toneClass}">${escapeHtml(rating.rating || "N/A")}</span>
        </div>
        <p>${escapeHtml(comment)}</p>
      </div>
    `;
  }).join("");
}

function renderReviews() {
  const reviewsBox = getEl("reviewsBox");
  if (!reviewsBox) return;

  const activeStaff = state.staff.filter(member => member && isTrue(member.isActive));
  const currentUser = activeStaff.find(member => String(member.discordId).trim() === String(userId).trim());
  const reviewTargets = getReviewTargets();
  const filteredStaff = reviewTargets.filter(member => {
    const completed = getReviewCompletion(member);
    if (state.reviewFilter === "complete") return completed;
    if (state.reviewFilter === "incomplete") return !completed;
    return true;
  });

  renderReviewsSummary();

  const userRole = state.user ? getRoleLabel(getUserRole(state.user)) : "Member";
  const userCardHtml = currentUser ? `
    <div class="card user-card no-click" id="userProfileCard">
      <img src="${escapeHtml(currentUser.avatarURL || "")}" alt="${escapeHtml(currentUser.name)}">
      <div class="card-body">
        <div class="user-intro">
          <div>
            <b>${escapeHtml(currentUser.name)}</b>
            <p>This is your portal profile.</p>
          </div>
          <span class="role-pill">${escapeHtml(userRole)}</span>
        </div>
        <button type="button" class="edit-profile-toggle" id="editProfileToggle">Edit Profile</button>
        <div id="profileEditorInline" class="profile-editor-inline hidden">
          <label for="profileNameInput">Display name</label>
          <input id="profileNameInput" type="text" value="${escapeHtml(state.user?.name || "")}" placeholder="Nickname">
          <label for="profileAvatarInput">Avatar URL</label>
          <input id="profileAvatarInput" type="text" value="${escapeHtml(state.user?.avatarURL || "")}" placeholder="https://...">
          <button id="profileSaveButton" class="primary-button" type="button">Save Changes</button>
        </div>
      </div>
    </div>
  ` : "";

  const otherCardsHtml = filteredStaff.length ? filteredStaff.map(member => {
    const targetId = String(member.discordId).trim();
    const currentRating = state.ratings.find(rating =>
      String(rating.targetId).trim() === targetId &&
      String(rating.reviewerId).trim() === String(userId).trim()
    );
    const selectedRating = currentRating?.rating || "N/A";
    const myNotes = sortNotesForDisplay(
      getStandardNotes(state.notes).filter(note =>
        String(note.targetId).trim() === targetId &&
        String(note.reviewerId).trim() === String(userId).trim()
      )
    );
    const completed = getReviewCompletion(member);
    const noteDraft = getReviewNoteDraft(targetId);
    const noteSectionOpen = openReviewNoteSections.has(targetId);
    const noteSavePending = pendingNoteSaves.has(getNoteSaveKey("review", targetId));

    const notesHtml = myNotes.length
      ? myNotes.map(note => buildNoteHtml(note)).join("")
      : `<div class="empty-state">No notes yet.</div>`;

    return `
      <div class="card staff-review-card" data-id="${escapeHtml(targetId)}">
        <img src="${escapeHtml(member.avatarURL || "")}" alt="${escapeHtml(member.name)}">
        <div class="card-body">
          <div class="review-card-header">
            <b>${escapeHtml(member.name)}</b>
            <span class="review-status ${completed ? "complete" : "incomplete"}">
              ${completed ? "Complete" : "Incomplete"}
            </span>
          </div>
          <select data-id="${escapeHtml(targetId)}" class="review-rating-select">
            ${["Excels", "On Par", "Meets Standards", "Below Par", "Needs Work", "N/A"].map(option => `
              <option value="${option}" ${option === selectedRating ? "selected" : ""}>${option}</option>
            `).join("")}
          </select>
          <textarea data-id="${escapeHtml(targetId)}" placeholder="Leave a comment... (Optional)" class="review-comment-textarea">${escapeHtml(currentRating?.comment || "")}</textarea>
          <div class="note-summary">
            <button type="button" class="toggle-notes-header${noteSectionOpen ? " open" : ""}" data-target-id="${escapeHtml(targetId)}">
              <span>My notes (${myNotes.length})</span>
              <span class="toggle-icon">v</span>
            </button>
            <div class="toggle-notes-body${noteSectionOpen ? "" : " hidden"}" id="notes-${escapeHtml(targetId)}">
              <div class="stack-list">${notesHtml}</div>
              <label for="noteType-${escapeHtml(targetId)}">New note type</label>
              <select id="noteType-${escapeHtml(targetId)}" data-note-id="${escapeHtml(targetId)}">
                <option value="Positive" ${noteDraft.type === "Positive" ? "selected" : ""}>Positive</option>
                <option value="Negative" ${noteDraft.type === "Negative" ? "selected" : ""}>Negative</option>
              </select>
              <label for="noteInput-${escapeHtml(targetId)}">Add a note</label>
              <textarea id="noteInput-${escapeHtml(targetId)}" data-note-id="${escapeHtml(targetId)}" rows="3" placeholder="Add a note about this staff member...">${escapeHtml(noteDraft.text)}</textarea>
              <label for="anon-${escapeHtml(targetId)}" class="checkbox-row">
                <input type="checkbox" id="anon-${escapeHtml(targetId)}" data-anon-id="${escapeHtml(targetId)}" ${noteDraft.anonymous ? "checked" : ""}>
                Submit anonymously
              </label>
              <button class="save-note-button" data-note-id="${escapeHtml(targetId)}" type="button" ${noteSavePending ? "disabled" : ""}>
                ${noteSavePending ? "Saving..." : "Add Note"}
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join("") : `<div class="card"><p>No staff match the current filter.</p></div>`;

  reviewsBox.innerHTML = userCardHtml + otherCardsHtml;

  const editToggle = getEl("editProfileToggle");
  const profileEditor = getEl("profileEditorInline");
  if (editToggle && profileEditor) {
    editToggle.addEventListener("click", () => {
      const isHidden = profileEditor.classList.toggle("hidden");
      editToggle.classList.toggle("active", !isHidden);
      editToggle.textContent = isHidden ? "Edit Profile" : "Cancel Edit";
    });
  }

  getEl("profileSaveButton")?.addEventListener("click", saveOwnProfile);

  document.querySelectorAll("#reviewsBox .review-rating-select, #reviewsBox .review-comment-textarea").forEach(element => {
    element.addEventListener("change", saveReviews);
  });

  document.querySelectorAll(".toggle-notes-header[data-target-id]").forEach(button => {
    button.addEventListener("click", event => {
      event.preventDefault();
      const targetId = button.dataset.targetId;
      const body = getEl(`notes-${targetId}`);
      if (!body) return;
      const isHidden = body.classList.toggle("hidden");
      button.classList.toggle("open", !isHidden);
      if (isHidden) {
        openReviewNoteSections.delete(targetId);
      } else {
        openReviewNoteSections.add(targetId);
      }
    });
  });

  document.querySelectorAll("#reviewsBox select[data-note-id]").forEach(element => {
    element.addEventListener("change", () => {
      const targetId = element.dataset.noteId;
      if (!targetId) return;
      setReviewNoteDraft(targetId, { type: element.value });
    });
  });

  document.querySelectorAll("#reviewsBox textarea[data-note-id]").forEach(element => {
    element.addEventListener("input", () => {
      const targetId = element.dataset.noteId;
      if (!targetId) return;
      setReviewNoteDraft(targetId, { text: element.value });
    });
  });

  document.querySelectorAll("#reviewsBox input[data-anon-id]").forEach(element => {
    element.addEventListener("change", () => {
      const targetId = element.dataset.anonId;
      if (!targetId) return;
      setReviewNoteDraft(targetId, { anonymous: element.checked });
    });
  });

  document.querySelectorAll(".save-note-button").forEach(button => {
    button.addEventListener("click", async () => {
      if (button.disabled) return;
      const targetId = button.dataset.noteId;
      if (targetId) await saveNoteForTarget(targetId);
    });
  });
}

async function saveOwnProfile() {
  const nameInput = getEl("profileNameInput");
  const avatarInput = getEl("profileAvatarInput");
  const name = nameInput?.value.trim();
  const avatarURL = avatarInput?.value.trim();

  if (!name && !avatarURL) {
    showStatus("Enter a display name or avatar URL before saving.");
    return;
  }

  showStatus("Saving profile...");
  showSpinner();

  const result = await fetchApi("updateStaff", {
    discordId: userId,
    updates: { name, avatarURL }
  });

  if (!result?.success) {
    showError("Failed to save profile.");
    return;
  }

  state.user.name = name || state.user.name;
  state.user.avatarURL = avatarURL || state.user.avatarURL;

  const self = state.staff.find(member => String(member.discordId).trim() === String(userId).trim());
  if (self) {
    self.name = name || self.name;
    self.avatarURL = avatarURL || self.avatarURL;
  }

  renderProfileEditor();
  renderReviews();
  hideSpinner();
  showStatus("Profile updated.");
}

function renderAdminControls() {
  const adminControls = getEl("adminControls");
  if (!adminControls || !state.user) return;

  const role = getUserRole(state.user);
  const canMaintain = canManageMaintenance(state.user);
  const canAddNewAdmins = canAddAdmins(state.user);
  const canMessageStaff = canSendMessages(state.user);

  let html = `<button id="adminAddStaffBtn" type="button">Add Staff Member</button>`;

  if (canMessageStaff) {
    html += `<button id="adminComposeMessageBtn" type="button">Send Message</button>`;
  }

  if (canMaintain) {
    html += `
      <button id="adminMaintenanceBtn" type="button" class="${state.maintenance ? "active" : ""}">
        ${state.maintenance ? "Maintenance: ON" : "Maintenance: OFF"}
      </button>
    `;
  }

  html += `<span class="admin-role-indicator">${escapeHtml(getRoleLabel(role))}</span>`;

  adminControls.innerHTML = html;

  getEl("adminMaintenanceBtn")?.addEventListener("click", async () => {
    await toggleMaintenance(!state.maintenance);
  });

  getEl("adminAddStaffBtn")?.addEventListener("click", openAddStaffModal);
  getEl("adminComposeMessageBtn")?.addEventListener("click", openComposeMessageModal);

  if (!canAddNewAdmins && role === "MEMBER") {
    adminControls.innerHTML = "";
  }
}

async function toggleMaintenance(enabled) {
  showStatus(enabled ? "Enabling maintenance..." : "Disabling maintenance...");
  showSpinner();

  const result = await fetchApi("setMaintenance", { enabled });
  if (!result?.success) {
    showError("Failed to update maintenance mode.");
    return;
  }

  state.maintenance = enabled;
  hideSpinner();

  if (enabled) {
    showPopup("Maintenance Enabled", "<p>Portal is now in maintenance mode. Only administrators and developers can access it.</p>", [
      {
        id: "maintenanceAdminBtn",
        text: "Back to Moderator Panel",
        callback: () => {
          hidePopup();
          loadAdmin();
        }
      }
    ]);
  } else {
    renderAdminControls();
    showStatus("Maintenance disabled.");
  }
}

async function openAddStaffModal() {
  const canAddNewAdmins = canAddAdmins(state.user);

  showPopup("Add new staff member", `
    <label for="newDiscordId">Discord ID</label>
    <input id="newDiscordId" type="text" placeholder="123456789012345678">
    <label for="newName">Display name</label>
    <input id="newName" type="text" placeholder="Nickname">
    <label for="newAvatarURL">Avatar URL</label>
    <input id="newAvatarURL" type="text" placeholder="https://...">
    <label for="newRole">Role</label>
    <select id="newRole">
      <option value="FALSE">Member</option>
      <option value="TRUE">Moderator</option>
      ${canAddNewAdmins ? '<option value="ADMINISTRATOR">Administrator</option>' : ""}
      ${canAddNewAdmins ? '<option value="DEVELOPER">Developer</option>' : ""}
    </select>
    <label for="newIsActive" class="checkbox-row">
      <input type="checkbox" id="newIsActive" checked>
      Account Active
    </label>
  `, [
    { id: "addStaffCancelBtn", text: "Cancel", secondary: true, callback: hidePopup },
    {
      id: "addStaffSaveBtn",
      text: "Create Staff",
      callback: async () => {
        const discordId = getEl("newDiscordId")?.value.trim();
        const name = getEl("newName")?.value.trim();
        const avatarURL = getEl("newAvatarURL")?.value.trim();
        const role = getEl("newRole")?.value || "FALSE";
        const isActive = getEl("newIsActive")?.checked || false;

        if (!discordId || !name) {
          showStatus("Discord ID and display name are required.");
          return;
        }

        showStatus("Creating new staff member...");
        showSpinner();

        const result = await fetchApi("addStaff", {
          discordId,
          name,
          avatarURL,
          isActive,
          isWebAdmin: role
        });

        hideSpinner();

        if (!result?.success) {
          showError("Failed to create staff member.");
          return;
        }

        hidePopup();
        await refreshStaff();
        await loadAdmin();
        showStatus("New staff member added.");
      }
    }
  ]);
}

function getAdminTargetNotes(targetId) {
  return getStandardNotes(state.notes).filter(note => String(note.targetId).trim() === String(targetId).trim());
}

function getAdminTargetRatings(targetId) {
  return state.ratings.filter(rating => String(rating.targetId).trim() === String(targetId).trim());
}

async function saveAdminStaffNote(targetId) {
  const saveKey = getNoteSaveKey("moderator", targetId);
  if (pendingNoteSaves.has(saveKey)) return;

  const draft = getAdminStaffNoteDraft(targetId);
  const type = draft.type || "Positive";
  let noteText = draft.text.trim();

  if (!noteText) {
    showStatus("Enter a staff note before saving.");
    return;
  }

  if (!isStaffNoteText(noteText)) {
    noteText = `[STAFF] ${noteText}`;
  }

  pendingNoteSaves.add(saveKey);

  const optimisticNote = addOptimisticNote(createOptimisticNote({
    reviewerId: userId,
    targetId,
    type,
    note: noteText.trim()
  }));

  clearAdminStaffNoteDraft(targetId);
  showStatus("Saving staff note...");
  refreshAdminStaffModal(targetId);

  const result = await fetchApi("saveNotes", {
    month: state.month,
    reviewerId: userId,
    targetId,
    type,
    note: noteText.trim()
  });

  pendingNoteSaves.delete(saveKey);

  if (!result || result.success === false) {
    removeOptimisticNote(optimisticNote.localId);
    setAdminStaffNoteDraft(targetId, { type, text: stripNotePrefixes(noteText) });
    refreshAdminStaffModal(targetId);
    showStatus("Failed to save staff note.", "error");
    return;
  }

  finalizeOptimisticNote(optimisticNote);
  refreshAdminStaffModal(targetId);
  showStatus("Staff note saved.");
}

async function openAdminStaffModal(targetId) {
  const member = state.staff.find(staffMember => String(staffMember.discordId).trim() === String(targetId).trim());
  if (!member) return;

  activeAdminModalTargetId = String(targetId).trim();

  const ratings = getAdminTargetRatings(targetId);
  const notes = sortNotesForDisplay(getAdminTargetNotes(targetId));
  const staffNotes = notes.filter(note => isStaffNoteText(note.note));
  const regularNotes = notes.filter(note => !isStaffNoteText(note.note));
  const positiveCount = ratings.filter(rating => isPositiveRating(rating.rating)).length;
  const negativeCount = ratings.filter(rating => isNegativeRating(rating.rating)).length;
  const memberAvgRating = computeAverageRating(ratings);
  const memberRole = getUserRole(member);
  const activeStaff = state.staff.filter(staffMember => isTrue(staffMember.isActive));
  const expectedRatings = isTrue(member.isActive) ? Math.max(activeStaff.length - 1, 0) : 0;
  const ratingsGiven = state.ratings.filter(rating =>
    String(rating.reviewerId).trim() === String(targetId).trim() &&
    String(rating.targetId).trim() !== String(targetId).trim() &&
    rating.rating &&
    rating.rating !== "N/A"
  ).length;
  const canAddNewAdmins = canAddAdmins(state.user);
  const adminNoteDraft = getAdminStaffNoteDraft(targetId);
  const staffNoteSavePending = pendingNoteSaves.has(getNoteSaveKey("moderator", targetId));

  const ratingsHtml = buildRatingsHtml(ratings);
  const staffNotesHtml = staffNotes.length
    ? staffNotes.map(note => buildNoteHtml(note)).join("")
    : `<div class="empty-state">No pinned staff notes yet.</div>`;
  const regularNotesHtml = regularNotes.length
    ? regularNotes.map(note => buildNoteHtml(note)).join("")
    : `<div class="empty-state">No other notes yet.</div>`;

  const html = `
    <div class="popup-user-header">
      <img src="${escapeHtml(member.avatarURL || "")}" alt="${escapeHtml(member.name)}">
      <div class="popup-meta">
        <b>${escapeHtml(member.name)}</b>
        <small>ID: ${escapeHtml(targetId)}</small>
        <div class="note-badge-row">
          <span class="role-pill">${escapeHtml(getRoleLabel(memberRole))}</span>
          <span class="review-status ${isTrue(member.isActive) ? "complete" : "incomplete"}">
            ${isTrue(member.isActive) ? "Active" : "Suspended"}
          </span>
        </div>
      </div>
    </div>
    <div class="accordion-stack">
      <details class="accordion-section" open>
        <summary>Overview</summary>
        <div class="accordion-content">
          <div class="modal-grid">
            <div class="mini-stat">
              <b>Avg Rating</b>
              <div class="stat-value accent">${memberAvgRating ? memberAvgRating.toFixed(1) : "N/A"}</div>
              <div class="stat-subtext">out of 5 this month</div>
            </div>
            <div class="mini-stat">
              <b>Reviews Received</b>
              <div class="stat-value">${ratings.length}</div>
              <div class="stat-subtext">submitted for this staff member</div>
            </div>
            <div class="mini-stat">
              <b>Reviews Given</b>
              <div class="stat-value">${ratingsGiven}/${expectedRatings}</div>
              <div class="stat-subtext">${isTrue(member.isActive) ? "expected this month" : "member is suspended"}</div>
            </div>
            <div class="mini-stat">
              <b>Staff Notes</b>
              <div class="stat-value">${staffNotes.length}</div>
              <div class="stat-subtext">pinned moderator notes</div>
            </div>
            <div class="mini-stat">
              <b>Positive Ratings</b>
              <div class="stat-value positive">${positiveCount}</div>
              <div class="stat-subtext">Excels, On Par, Meets Standards</div>
            </div>
            <div class="mini-stat">
              <b>Needs Attention</b>
              <div class="stat-value negative">${negativeCount}</div>
              <div class="stat-subtext">Below Par and Needs Work</div>
            </div>
          </div>
        </div>
      </details>
      <details class="accordion-section" open>
        <summary>Reviews (${ratings.length})</summary>
        <div class="accordion-content">
          <div class="stack-list">${ratingsHtml}</div>
        </div>
      </details>
      <details class="accordion-section" open>
        <summary>Staff Notes (${staffNotes.length})</summary>
        <div class="accordion-content">
          <label for="adminStaffNoteType">Pinned note type</label>
          <select id="adminStaffNoteType">
            <option value="Positive" ${adminNoteDraft.type === "Positive" ? "selected" : ""}>Positive</option>
            <option value="Negative" ${adminNoteDraft.type === "Negative" ? "selected" : ""}>Negative</option>
          </select>
          <label for="adminStaffNoteInput">Pinned note</label>
          <textarea id="adminStaffNoteInput" rows="4" placeholder="[STAFF] Add a moderator-only note for this user, including suspended staff.">${escapeHtml(adminNoteDraft.text)}</textarea>
          <button id="adminAddStaffNoteBtn" class="primary-button" type="button" ${staffNoteSavePending ? "disabled" : ""}>
            ${staffNoteSavePending ? "Saving Staff Note..." : "Save Staff Note"}
          </button>
          <div class="stack-list">${staffNotesHtml}</div>
        </div>
      </details>
      <details class="accordion-section">
        <summary>Other Notes (${regularNotes.length})</summary>
        <div class="accordion-content">
          <div class="stack-list">${regularNotesHtml}</div>
        </div>
      </details>
      <details class="accordion-section">
        <summary>Account Management</summary>
        <div class="accordion-content">
          <label for="adminUserName">Display name</label>
          <input id="adminUserName" type="text" value="${escapeHtml(member.name || "")}" placeholder="Nickname">
          <label for="adminUserAvatar">Avatar URL</label>
          <input id="adminUserAvatar" type="text" value="${escapeHtml(member.avatarURL || "")}" placeholder="https://...">
          <label for="adminUserActive" class="checkbox-row">
            <input type="checkbox" id="adminUserActive" ${isTrue(member.isActive) ? "checked" : ""}>
            Account Active (uncheck to suspend)
          </label>
          ${canAddNewAdmins ? `
            <label for="adminUserRole">Role</label>
            <select id="adminUserRole">
              <option value="FALSE" ${memberRole === "MEMBER" ? "selected" : ""}>Member</option>
              <option value="TRUE" ${memberRole === "ADMIN" ? "selected" : ""}>Moderator</option>
              <option value="ADMINISTRATOR" ${memberRole === "ADMINISTRATOR" ? "selected" : ""}>Administrator</option>
              <option value="DEVELOPER" ${memberRole === "DEVELOPER" ? "selected" : ""}>Developer</option>
            </select>
          ` : `
            <div class="role-pill">${escapeHtml(getRoleLabel(memberRole))}</div>
          `}
          <div class="action-row">
            <button id="adminSaveUserBtn" class="primary-button" type="button">Save Changes</button>
            <button id="adminResetTokenBtn" class="button-secondary" type="button">Reset Token</button>
          </div>
          <div id="adminStaffTokenResult"></div>
        </div>
      </details>
    </div>
  `;

  showPopup(`Moderate: ${member.name}`, html, [
    { id: "adminCloseUserBtn", text: "Close", secondary: true, callback: hidePopup }
  ]);

  getEl("adminStaffNoteType")?.addEventListener("change", event => {
    setAdminStaffNoteDraft(targetId, { type: event.target.value });
  });

  getEl("adminStaffNoteInput")?.addEventListener("input", event => {
    setAdminStaffNoteDraft(targetId, { text: event.target.value });
  });

  getEl("adminAddStaffNoteBtn")?.addEventListener("click", async () => {
    await saveAdminStaffNote(targetId);
  });

  getEl("adminSaveUserBtn")?.addEventListener("click", async () => {
    const name = getEl("adminUserName")?.value.trim();
    const avatarURL = getEl("adminUserAvatar")?.value.trim();
    const isActive = getEl("adminUserActive")?.checked || false;
    const roleSelect = getEl("adminUserRole");
    const isWebAdmin = roleSelect ? roleSelect.value : member.isWebAdmin;

    if (!name) {
      showStatus("Display name cannot be empty.");
      return;
    }

    showStatus("Saving staff member...");
    showSpinner();

    const result = await fetchApi("updateStaff", {
      discordId: targetId,
      updates: { name, avatarURL, isActive, isWebAdmin }
    });

    hideSpinner();

    if (!result?.success) {
      showError("Failed to update staff member.");
      return;
    }

    hidePopup();
    await refreshStaff();
    await loadAdmin();
    showStatus(`${name} has been updated.`);
  });

  getEl("adminResetTokenBtn")?.addEventListener("click", async () => {
    if (!confirm(`Reset token for ${member.name}? They will need a new login link.`)) {
      return;
    }

    showStatus("Resetting token...");
    showSpinner();

    const result = await fetchApi("resetStaffToken", { discordId: targetId });
    hideSpinner();

    if (!result?.success) {
      showError("Failed to reset token.");
      return;
    }

    const tokenResult = getEl("adminStaffTokenResult");
    if (tokenResult) {
      tokenResult.innerHTML = `
        <div class="token-result">
          <small>New token generated:</small>
          <code>${escapeHtml(result.newToken || "")}</code>
        </div>
      `;
    }

    await refreshStaff();
    showStatus("Token reset successfully.");
  });
}

async function saveNoteForTarget(targetId) {
  const saveKey = getNoteSaveKey("review", targetId);
  if (pendingNoteSaves.has(saveKey)) return;

  const draft = getReviewNoteDraft(targetId);
  const noteType = draft.type || "Positive";
  let noteText = draft.text || "";

  if (!noteText.trim()) {
    showStatus("Please enter a note before saving.");
    return;
  }

  if (draft.anonymous && !isAnonymousNoteText(noteText)) {
    noteText = `[ANON]${noteText}`;
  }

  pendingNoteSaves.add(saveKey);
  openReviewNoteSections.add(String(targetId).trim());

  const optimisticNote = addOptimisticNote(createOptimisticNote({
    reviewerId: userId,
    targetId,
    type: noteType,
    note: noteText.trim()
  }));

  clearReviewNoteDraft(targetId);
  renderReviews();
  showStatus("Saving note...");

  const result = await fetchApi("saveNotes", {
    month: state.month,
    reviewerId: userId,
    targetId,
    type: noteType,
    note: noteText.trim()
  });

  pendingNoteSaves.delete(saveKey);

  if (!result || result.success === false) {
    removeOptimisticNote(optimisticNote.localId);
    setReviewNoteDraft(targetId, {
      type: noteType,
      text: draft.text,
      anonymous: draft.anonymous
    });
    renderReviews();
    showStatus("Failed to save note.", "error");
    return;
  }

  finalizeOptimisticNote(optimisticNote);
  renderReviews();
  showStatus("Note saved.");
}

async function refreshStaff() {
  const staff = await fetchApi("getStaff");
  state.staff = Array.isArray(staff) ? staff : state.staff;
}

async function loadReviews() {
  showPage("reviews");
  showStatus("Loading reviews...");
  showSpinner();

  await refreshStaff();

  const [ratings, notes, messages] = await Promise.all([
    fetchApi("getRatings", { month: state.month }),
    fetchApi("getNotes", { month: state.month }),
    fetchApi("getMessages", { userId })
  ]);

  state.ratings = Array.isArray(ratings) ? ratings : [];
  state.notes = Array.isArray(notes) ? notes : [];
  state.messages = Array.isArray(messages) ? messages : [];

  renderProfileEditor();
  renderReviewFilterControls();
  renderReviews();
  maybePromptUnreadMessages();
  hideSpinner();
  showStatus("Reviews loaded.");
}

async function loadAdmin() {
  if (!state.user || !isAdmin(state.user)) {
    showError("Moderator access required.");
    return;
  }

  showPage("admin");
  showStatus("Loading moderator dashboard...");
  showSpinner();

  await refreshStaff();

  const [ratings, notes, messages] = await Promise.all([
    fetchApi("getRatings", { month: state.month }),
    fetchApi("getNotes", { month: state.month }),
    fetchApi("getAllMessages", {})
  ]);

  state.ratings = Array.isArray(ratings) ? ratings : [];
  state.notes = Array.isArray(notes) ? notes : [];
  state.messages = Array.isArray(messages) ? messages : [];

  renderAdminControls();
  renderAdmin();
  hideSpinner();
  showStatus("Moderator dashboard loaded.");
}

function renderAdmin() {
  const statsBox = getEl("adminStats");
  const adminMessages = getEl("adminMessages");
  const adminList = getEl("adminList");
  if (!statsBox || !adminMessages || !adminList) return;

  const allStaff = state.staff;
  const activeStaff = state.staff.filter(member => isTrue(member.isActive));
  const ratingCount = state.ratings.filter(rating => rating.rating && rating.rating !== "N/A").length;
  const standardNotes = getStandardNotes(state.notes);
  const noteCount = standardNotes.length;
  const staffNoteCount = standardNotes.filter(note => isStaffNoteText(note.note)).length;
  const averageRating = computeAverageRating(state.ratings);
  const totalPossibleRatings = activeStaff.length * Math.max(activeStaff.length - 1, 0);
  const ratingCompletion = totalPossibleRatings > 0 ? Math.round((ratingCount / totalPossibleRatings) * 100) : 0;

  statsBox.innerHTML = `
    <div class="stat-card">
      <b>General Rating</b>
      <div class="stat-value accent">${averageRating ? `${averageRating.toFixed(1)} / 5` : "N/A"}</div>
      <div class="stat-subtext">all submitted ratings</div>
    </div>
    <div class="stat-card">
      <b>Active Staff</b>
      <div class="stat-value">${activeStaff.length}/${allStaff.length}</div>
      <div class="stat-subtext">active vs total accounts</div>
    </div>
    <div class="stat-card">
      <b>Ratings Progress</b>
      <div class="stat-value">${ratingCount}/${totalPossibleRatings}</div>
      <div class="stat-subtext">${ratingCompletion}% complete this month</div>
    </div>
    <div class="stat-card">
      <b>Total Notes</b>
      <div class="stat-value">${noteCount}</div>
      <div class="stat-subtext">${staffNoteCount} staff notes pinned</div>
    </div>
  `;

  adminList.innerHTML = allStaff.length ? allStaff.map(member => {
    const targetId = String(member.discordId).trim();
    const memberRatings = state.ratings.filter(rating => String(rating.targetId).trim() === targetId);
    const memberNotes = standardNotes.filter(note => String(note.targetId).trim() === targetId);
    const memberAvgRating = computeAverageRating(memberRatings);
    const ratingsReceived = memberRatings.length;
    const ratingsGiven = state.ratings.filter(rating =>
      String(rating.reviewerId).trim() === targetId &&
      String(rating.targetId).trim() !== targetId &&
      rating.rating &&
      rating.rating !== "N/A"
    ).length;
    const staffNotes = memberNotes.filter(note => isStaffNoteText(note.note)).length;
    const positiveNotes = memberNotes.filter(note => note.type === "Positive").length;
    const negativeNotes = memberNotes.filter(note => note.type === "Negative").length;
    const memberRole = getRoleLabel(getUserRole(member));
    const isActiveMember = isTrue(member.isActive);
    const expectedRatings = isActiveMember ? Math.max(activeStaff.length - 1, 0) : 0;

    return `
      <div class="staff-card ${isActiveMember ? "staff-active" : "staff-suspended"}" data-id="${escapeHtml(targetId)}">
        <div class="staff-card-header">
          <img src="${escapeHtml(member.avatarURL || "")}" alt="${escapeHtml(member.name)}">
          <div>
            <b>${escapeHtml(member.name)}</b>
            <p class="text-muted">
              <span class="status-dot ${isActiveMember ? "active" : "suspended"}"></span>
              ${isActiveMember ? "Active" : "Suspended"}
            </p>
            <span class="role-pill">${escapeHtml(memberRole)}</span>
          </div>
        </div>
        <div class="staff-card-metrics">
          <div>Average rating: <strong>${memberAvgRating ? memberAvgRating.toFixed(1) : "N/A"}</strong></div>
          <div>Reviews received: <strong>${ratingsReceived}</strong></div>
          <div>Reviews given: <strong>${ratingsGiven}/${expectedRatings}</strong></div>
          <div>Notes: <strong>${positiveNotes} positive / ${negativeNotes} negative</strong></div>
          <div>Staff notes: <strong>${staffNotes}</strong></div>
        </div>
      </div>
    `;
  }).join("") : `<div class="card"><p>No staff found.</p></div>`;

  renderAdminMessageCenter();

  adminList.querySelectorAll(".staff-card").forEach(card => {
    card.addEventListener("click", () => {
      const targetId = card.dataset.id;
      if (targetId) openAdminStaffModal(targetId);
    });
  });
}

async function saveReviews() {
  const payload = Array.from(document.querySelectorAll("#reviewsBox .review-rating-select[data-id]")).map(select => {
    const id = select.dataset.id;
    const value = select.value;
    const comment = document.querySelector(`#reviewsBox textarea[data-id='${id}']`)?.value || "";
    return { id, value, comment };
  }).filter(item => item.id && item.value && item.value !== "N/A");

  if (!payload.length) {
    showStatus("No ratings to save.");
    return;
  }

  showStatus("Saving ratings...");

  await fetchApi("saveRatings", {
    reviewerId: userId,
    token,
    month: state.month,
    ratings: payload.map(item => ({
      targetId: item.id,
      rating: item.value,
      comment: item.comment
    }))
  });

  const updatedRatings = await fetchApi("getRatings", { month: state.month });
  state.ratings = Array.isArray(updatedRatings) ? updatedRatings : state.ratings;
  renderReviews();
  showStatus("Ratings saved.");
}

function setupNav() {
  getEl("reviewsTab")?.addEventListener("click", async event => {
    event.preventDefault();
    await loadReviews();
  });

  getEl("adminTab")?.addEventListener("click", async event => {
    event.preventDefault();
    await loadAdmin();
  });
}

(async function init() {
  try {
    showPage("reviews");
    showSpinner();
    buildMonthOptions();

    const verified = await verifyUser();
    if (!verified) return;

    setupNav();
    await loadReviews();
  } catch (error) {
    console.error(error);
    showError("Failed to initialize portal.");
  } finally {
    hideSpinner();
  }
})();
