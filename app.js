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
  month: getCurrentMonth(),
  user: null,
  reviewFilter: "all",
  maintenance: false
};

const noteDrafts = new Map();
const adminStaffNoteDrafts = new Map();
const openReviewNoteSections = new Set();
const pendingNoteSaves = new Set();
let optimisticNoteSequence = 0;
let activeAdminModalTargetId = null;

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
  return role === "DEVELOPER" || role === "ADMINISTRATOR";
}

function canAddAdmins(user) {
  return getUserRole(user) === "ADMINISTRATOR";
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
  return state.notes.filter(note => {
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

<<<<<<< HEAD
async function fetchApi(action, data = {}) {
=======
// ---------------- CACHE ----------------

let STAFF_CACHE = null;
let RATINGS_CACHE = null;
let NOTES_CACHE = null;
let MESSAGES_CACHE = null;
let RATINGS_MONTH = null;
let USER = null;
let EXPANDED_CARD = null;

// ---------------- API ----------------

async function post(action, data = {}) {
>>>>>>> fcbf1f1 (An Update to Add Messages)
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

  if (state.maintenance && !canManageMaintenance(verifiedUser)) {
    showDeniedOverlay("MAINTENANCE");
    return false;
  }

  state.user = verifiedUser;

  const adminTab = getEl("adminTab");
  if (adminTab) {
    adminTab.classList.toggle("hidden", !isAdmin(state.user));
  }

  return true;
}

<<<<<<< HEAD
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
=======
// ---------------- NAV ----------------

function setupNav() {
  const reviewsTab = document.querySelector("[data-page='reviews']");
  const adminTab = document.querySelector("[data-page='admin']");
  const messagesTab = document.querySelector("[data-page='messages']");

  if (reviewsTab) {
    reviewsTab.addEventListener("click", async (e) => {
      e.preventDefault();
      await loadReviews();
    });
  }

  if (adminTab) {
    adminTab.addEventListener("click", async (e) => {
      e.preventDefault();
      await loadAdmin();
    });

    if (USER?.isWebAdmin) {
      adminTab.classList.remove("hidden");
    }
  }

  if (messagesTab) {
    messagesTab.addEventListener("click", async (e) => {
      e.preventDefault();
      await loadMessages();
    });

    messagesTab.classList.remove("hidden");
  }

  initAdminControls();
}

function setActivePage(page) {
  document.querySelectorAll("[data-page]").forEach(el => {
    el.classList.toggle("active", el.dataset.page === page);
  });

  const reviewsPage = document.getElementById("reviewsPage");
  const adminPage = document.getElementById("adminPage");
  const messagesPage = document.getElementById("messagesPage");
  const revokedPage = document.getElementById("revokedPage");
  const menu = document.querySelector(".menu");

  if (reviewsPage) reviewsPage.classList.toggle("hidden", page !== "reviews");
  if (adminPage) adminPage.classList.toggle("hidden", page !== "admin");
  if (messagesPage) messagesPage.classList.toggle("hidden", page !== "messages");
  if (revokedPage) revokedPage.classList.toggle("hidden", page !== "revoked");
  if (menu) menu.classList.toggle("hidden", page === "revoked");
>>>>>>> fcbf1f1 (An Update to Add Messages)
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

<<<<<<< HEAD
  if (!select.dataset.bound) {
    select.addEventListener("change", async () => {
      state.month = select.value;
      await loadAdmin();
=======
  if (!select.dataset.adminInit) {
    select.addEventListener("change", () => {
      // Only reload if we're on the ratings tab
      const ratingsTab = document.getElementById("ratingsTab");
      if (ratingsTab && !ratingsTab.classList.contains("hidden")) {
        loadAdminRatingsTab();
      }
    });
    select.dataset.adminInit = "true";
  }
}

// ---------------- LOAD REVIEWS ----------------

async function loadReviews() {
  const box = document.getElementById("reviewsBox");
  const spinner = document.getElementById("loadingSpinner");
  if (!box) return;

  setActivePage("reviews");
  box.innerHTML = `<div class="card"><p>Loading staff and ratings...</p></div>`;
  showSpinner();

  const currentMonth = month();
  if (RATINGS_MONTH !== currentMonth) {
    RATINGS_CACHE = null;
    RATINGS_MONTH = currentMonth;
  }

  try {
    // fetch once only
    if (!STAFF_CACHE || RATINGS_MONTH !== currentMonth) {
      STAFF_CACHE = await post("getStaff");
    }

    if (!RATINGS_CACHE || RATINGS_MONTH !== currentMonth) {
      RATINGS_CACHE = await post("getRatings", { month: currentMonth });
      RATINGS_MONTH = currentMonth;
    }

    if (!Array.isArray(STAFF_CACHE) || !Array.isArray(RATINGS_CACHE)) {
      showError("❌ Failed to load data");
      return;
    }

    await loadNotesForMonth(currentMonth);

    hideSpinner();
    box.innerHTML = "";
    setActivePage("reviews");

    const ratingMap = RATINGS_CACHE.reduce((map, row) => {
      const targetId = String(row.targetId ?? "").trim();
      const reviewerId = String(row.reviewerId ?? "").trim();
      if (targetId && reviewerId) {
        map[`${targetId}|${reviewerId}`] = row;
      }
      return map;
    }, {});

    STAFF_CACHE.forEach(s => {
      if (!isTrue(s.isActive)) return;

      const isYou = String(s.discordId) === String(userId);
      const my = ratingMap[`${String(s.discordId).trim()}|${String(userId).trim()}`];
      const selectedRating = my?.rating?.toString().trim().toLowerCase() || "n/a";

      const div = document.createElement("div");
      div.className = "card";
      div.dataset.id = s.discordId;

      if (isYou) {
        div.className += " no-click";
        div.innerHTML = `
          <img src="${s.avatarURL || ''}">
          <div class="card-body">
            <b>${s.name}</b>
            <p style="opacity:0.6;">This is you</p>
          </div>
        `;
      } else {
        div.innerHTML = `
          <img src="${s.avatarURL || ''}">
          <div class="card-body">
            <b>${s.name}</b>
            <select data-id="${s.discordId}">
              ${["Excels","On Par","Meets Standards","Below Par","Needs Work","N/A"]
                .map(v => {
                  const normalized = v.toLowerCase();
                  return `<option value="${v}" ${selectedRating === normalized ? "selected" : ""}>${v}</option>`;
                }).join("")}
            </select>
            <textarea data-id="${s.discordId}">${my?.comment || ""}</textarea>
          </div>
          <div class="card-details"></div>
        `;
        
        div.addEventListener("click", async (e) => {
          if (e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA") return;
          
          if (EXPANDED_CARD === s.discordId) {
            div.classList.remove("expanded");
            EXPANDED_CARD = null;
          } else {
            if (EXPANDED_CARD) {
              document.querySelector(`[data-id="${EXPANDED_CARD}"]`)?.classList.remove("expanded");
            }
            div.classList.add("expanded");
            EXPANDED_CARD = s.discordId;
            await expandStaffCard(s.discordId, div);
          }
        });
      }

      box.appendChild(div);
>>>>>>> fcbf1f1 (An Update to Add Messages)
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
      </div>
    </div>
  `;
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
      state.notes.filter(note =>
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

<<<<<<< HEAD
  if (!name && !avatarURL) {
    showStatus("Enter a display name or avatar URL before saving.");
=======
  const notes = await post("getNotes", { month: monthValue });
  const normalized = Array.isArray(notes) ? notes : [];
  const map = normalized.reduce((acc, note) => {
    const targetId = String(note.targetId || "").trim();
    if (!targetId) return acc;
    if (!acc[targetId]) acc[targetId] = [];
    acc[targetId].push(note);
    return acc;
  }, {});

  NOTES_CACHE = { month: monthValue, map };
  return NOTES_CACHE;
}

async function getNotesForTarget(targetId, monthValue = month()) {
  const cache = await loadNotesForMonth(monthValue);
  return cache.map[String(targetId).trim()] || [];
}

async function loadAdmin() {
  if (!USER?.isWebAdmin) return;

  setActivePage("admin");

  // Setup admin tabs
  setupAdminTabs();

  // Load the default ratings tab
  await loadAdminRatingsTab();
}

function setupAdminTabs() {
  const tabButtons = document.querySelectorAll('.admin-tab-button');
  tabButtons.forEach(button => {
    button.addEventListener('click', async () => {
      // Remove active class from all buttons
      tabButtons.forEach(btn => btn.classList.remove('active'));
      // Add active class to clicked button
      button.classList.add('active');

      // Hide all tab contents
      document.querySelectorAll('.admin-tab-content').forEach(content => {
        content.classList.add('hidden');
      });

      // Show the corresponding tab content
      const tabName = button.dataset.adminTab;
      const tabContent = document.getElementById(tabName + 'Tab');
      if (tabContent) {
        tabContent.classList.remove('hidden');
      }

      // Load content for the tab
      if (tabName === 'ratings') {
        await loadAdminRatingsTab();
      } else if (tabName === 'messages') {
        await loadAdminMessagesTab();
      } else if (tabName === 'staff') {
        await loadAdminStaffTab();
      }
    });
  });
}

async function loadAdminRatingsTab() {
  if (!STAFF_CACHE) {
    STAFF_CACHE = await post("getStaff");
  }

  const monthValue = document.getElementById("adminMonthSelect")?.value || month();
  if (RATINGS_MONTH !== monthValue) {
    RATINGS_CACHE = null;
    RATINGS_MONTH = monthValue;
  }

  if (!RATINGS_CACHE) {
    RATINGS_CACHE = await post("getRatings", { month: monthValue });
  }

  await loadNotesForMonth(monthValue);

  const ratings = RATINGS_CACHE;
  const listBox = document.getElementById("adminList");

  if (!Array.isArray(STAFF_CACHE) || !Array.isArray(ratings)) {
    if (listBox) listBox.innerHTML = "<div class='card'>❌ Failed to load admin data</div>";
>>>>>>> fcbf1f1 (An Update to Add Messages)
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

  let html = `<button id="adminAddStaffBtn" type="button">Add Staff Member</button>`;

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

  if (!canAddNewAdmins && role === "MEMBER") {
    adminControls.innerHTML = "";
  }
}

<<<<<<< HEAD
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
  return state.notes.filter(note => String(note.targetId).trim() === String(targetId).trim());
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
=======
async function loadAdminMessagesTab() {
  const container = document.getElementById("adminMessagesContainer");
  if (!container) return;

  container.innerHTML = `<div class="card"><p>Loading messages...</p></div>`;
  showSpinner();

  try {
    const messages = await post("getAllMessages");
    const staff = await post("getStaff");

    if (!Array.isArray(messages) || !Array.isArray(staff)) {
      showError("❌ Failed to load messages");
      return;
    }

    hideSpinner();
    renderAdminMessagesForTab(messages, staff, container);
  } catch (e) {
    console.error("Messages load failed", e);
    showError("❌ Failed to load messages");
  } finally {
    hideSpinner();
  }
}

function renderAdminMessagesForTab(messages, staff, container) {
  const staffMap = staff.reduce((map, s) => {
    map[s.discordId] = s.name;
    return map;
  }, {});

  const header = `
    <div class="messages-admin-header">
      <h3>All Messages</h3>
      <button class="send-message-btn" onclick="showSendMessageForm()">📝 Send Message</button>
    </div>
  `;

  if (!messages.length) {
    container.innerHTML = `${header}<div class="card"><p>No messages sent yet.</p></div>`;
    return;
  }

  container.innerHTML = `${header}<div class="messages-list">${messages.map(msg => {
    const sender = staffMap[msg.senderId] || msg.senderId;
    const recipients = msg.recipientIds.includes("ALL") ? ["All Staff"] :
      msg.recipientIds.map(id => staffMap[id] || id);

    const readByNames = msg.readBy.map(id => staffMap[id] || id);
    const unreadBy = msg.recipientIds.includes("ALL") ?
      staff.filter(s => isTrue(s.isActive) && !msg.readBy.includes(s.discordId)).map(s => s.name) :
      msg.recipientIds.filter(id => !msg.readBy.includes(id)).map(id => staffMap[id] || id);

    return `
      <div class="message-admin-item ${msg.isUrgent ? 'urgent' : ''}">
        <div class="message-admin-header">
          <div class="message-admin-subject">${msg.subject}</div>
          <div class="message-admin-meta">
            ${new Date(msg.sentAt).toLocaleDateString()} by ${sender}
          </div>
        </div>
        <div class="message-admin-recipients">
          <strong>To:</strong> ${recipients.join(", ")}
        </div>
        <div style="margin: 12px 0; line-height: 1.5;">${msg.message.replace(/\n/g, '<br>')}</div>
        <div class="message-admin-read-status">
          <div class="message-admin-read-count">
            Read by ${readByNames.length} of ${msg.recipientIds.includes("ALL") ? staff.filter(s => isTrue(s.isActive)).length : msg.recipientIds.length} recipients
          </div>
          ${readByNames.length > 0 || unreadBy.length > 0 ? `
            <div class="message-admin-read-list">
              ${readByNames.map(name => `<div class="message-admin-read-item read"><div class="message-admin-read-dot read"></div>${name}</div>`).join('')}
              ${unreadBy.map(name => `<div class="message-admin-read-item unread"><div class="message-admin-read-dot unread"></div>${name}</div>`).join('')}
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }).join('')}</div>`;
}

async function loadAdminStaffTab() {
  const container = document.getElementById("adminStaffContainer");
  if (!container) return;

  container.innerHTML = `<div class="card"><p>Loading staff management...</p></div>`;
  showSpinner();

  try {
    const staff = await post("getStaff");
    if (!Array.isArray(staff)) {
      showError("❌ Failed to load staff");
      return;
    }

    hideSpinner();
    renderAdminStaffTab(staff, container);
  } catch (e) {
    console.error("Staff load failed", e);
    showError("❌ Failed to load staff");
  } finally {
    hideSpinner();
  }
}

function renderAdminStaffTab(staff, container) {
  container.innerHTML = `
    <div style="margin-bottom: 20px;">
      <button class="send-message-btn" onclick="showAddStaffForm()">➕ Add Staff Member</button>
    </div>
    <div class="admin-list">
      ${staff.map(s => `
        <div class="card staff-card" data-id="${s.discordId}">
          <img src="${s.avatarURL || ''}" style="width: 50px; height: 50px;">
          <div class="card-body">
            <b>${s.name}</b>
            <p>Discord ID: ${s.discordId}</p>
            <p>Status: ${isTrue(s.isActive) ? 'Active' : 'Inactive'} | Admin: ${isTrue(s.isWebAdmin) ? 'Yes' : 'No'}</p>
          </div>
          <div class="card-details"></div>
        </div>
      `).join('')}
    </div>
  `;

  // Add click handlers for staff cards
  document.querySelectorAll("#adminStaffContainer .staff-card").forEach(card => {
    card.addEventListener("click", (e) => {
      const staffId = card.dataset.id;
      const detailsDiv = card.querySelector(".card-details");
      
      if (card.classList.contains("expanded")) {
        card.classList.remove("expanded");
      } else {
        // Close other expanded cards
        document.querySelectorAll("#adminStaffContainer .staff-card.expanded").forEach(c => {
          c.classList.remove("expanded");
        });
        card.classList.add("expanded");
        showStaffDetails(staffId, detailsDiv);
      }
    });
  });
}

function showStaffDetails(staffId, container) {
  const staff = STAFF_CACHE.find(s => s.discordId === staffId);
  if (!staff) return;

  container.innerHTML = `
    <div style="padding: 16px; background: #1f2937; border-radius: 8px; margin-top: 12px;">
      <h4>Staff Details</h4>
      <div style="display: grid; gap: 12px;">
        <div>
          <label style="display: block; font-weight: bold; margin-bottom: 4px;">Name</label>
          <input type="text" value="${staff.name}" id="staff-name-${staffId}" style="width: 100%; padding: 8px; background: #111827; border: 1px solid #374151; border-radius: 4px; color: white;">
        </div>
        <div>
          <label style="display: block; font-weight: bold; margin-bottom: 4px;">Avatar URL</label>
          <input type="text" value="${staff.avatarURL || ''}" id="staff-avatar-${staffId}" style="width: 100%; padding: 8px; background: #111827; border: 1px solid #374151; border-radius: 4px; color: white;">
        </div>
        <div style="display: flex; gap: 12px; align-items: center;">
          <label style="display: flex; align-items: center; gap: 8px;">
            <input type="checkbox" id="staff-active-${staffId}" ${isTrue(staff.isActive) ? 'checked' : ''}>
            Active
          </label>
          <label style="display: flex; align-items: center; gap: 8px;">
            <input type="checkbox" id="staff-admin-${staffId}" ${isTrue(staff.isWebAdmin) ? 'checked' : ''}>
            Web Admin
          </label>
        </div>
        <div style="display: flex; gap: 8px; margin-top: 12px;">
          <button onclick="updateStaff('${staffId}')" style="background: #2563eb; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">Update</button>
          <button onclick="resetStaffToken('${staffId}')" style="background: #f59e0b; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">Reset Token</button>
        </div>
      </div>
    </div>
  `;
}

async function updateStaff(staffId) {
  const name = document.getElementById(`staff-name-${staffId}`).value;
  const avatarURL = document.getElementById(`staff-avatar-${staffId}`).value;
  const isActive = document.getElementById(`staff-active-${staffId}`).checked;
  const isWebAdmin = document.getElementById(`staff-admin-${staffId}`).checked;

  try {
    const result = await post("updateStaff", {
      discordId: staffId,
      updates: { name, avatarURL, isActive, isWebAdmin }
    });

    if (result.success) {
      alert("Staff updated successfully!");
      await loadAdminStaffTab(); // Refresh the list
    } else {
      alert("Failed to update staff: " + (result.error || "Unknown error"));
    }
  } catch (e) {
    console.error("Failed to update staff", e);
    alert("Failed to update staff");
  }
}

async function resetStaffToken(staffId) {
  if (!confirm("Are you sure you want to reset this staff member's token? They will need to get a new login link.")) return;

  try {
    const result = await post("resetStaffToken", { discordId: staffId });
    if (result.success) {
      alert(`Token reset successfully! New token: ${result.newToken}`);
    } else {
      alert("Failed to reset token: " + (result.error || "Unknown error"));
    }
  } catch (e) {
    console.error("Failed to reset token", e);
    alert("Failed to reset token");
  }
}

function showAddStaffForm() {
  const overlay = document.createElement('div');
  overlay.className = 'send-message-overlay';
  overlay.innerHTML = `
    <div class="send-message-panel">
      <div class="send-message-header">
        <h3 class="send-message-title">Add Staff Member</h3>
      </div>
      <form class="send-message-form" onsubmit="addStaff(event)">
        <div class="send-message-field">
          <label class="send-message-label">Discord ID *</label>
          <input type="text" class="send-message-input" id="newStaffDiscordId" required>
        </div>
        <div class="send-message-field">
          <label class="send-message-label">Name *</label>
          <input type="text" class="send-message-input" id="newStaffName" required>
        </div>
        <div class="send-message-field">
          <label class="send-message-label">Avatar URL</label>
          <input type="text" class="send-message-input" id="newStaffAvatar">
        </div>
        <div class="send-message-field">
          <label style="display: flex; align-items: center; gap: 8px;">
            <input type="checkbox" id="newStaffActive" checked>
            Active
          </label>
          <label style="display: flex; align-items: center; gap: 8px;">
            <input type="checkbox" id="newStaffAdmin">
            Web Admin
          </label>
        </div>
        <div class="send-message-actions">
          <button type="button" class="send-message-cancel" onclick="closeSendMessageForm()">Cancel</button>
          <button type="submit" class="send-message-submit">Add Staff</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function addStaff(event) {
  event.preventDefault();

  const discordId = document.getElementById('newStaffDiscordId').value.trim();
  const name = document.getElementById('newStaffName').value.trim();
  const avatarURL = document.getElementById('newStaffAvatar').value.trim();
  const isActive = document.getElementById('newStaffActive').checked;
  const isWebAdmin = document.getElementById('newStaffAdmin').checked;

  if (!discordId || !name) {
    alert('Please fill in all required fields.');
    return;
  }

  try {
    const result = await post("addStaff", {
      discordId, name, avatarURL, isActive, isWebAdmin
    });

    if (result.success) {
      alert(`Staff added successfully! Token: ${result.newToken}`);
      closeSendMessageForm();
      await loadAdminStaffTab(); // Refresh the list
    } else {
      alert("Failed to add staff: " + (result.error || "Unknown error"));
    }
  } catch (e) {
    console.error("Failed to add staff", e);
    alert("Failed to add staff");
  }
}

// Make functions global
window.updateStaff = updateStaff;
window.resetStaffToken = resetStaffToken;
window.addStaff = addStaff;
window.showAddStaffForm = showAddStaffForm;

async function expandAdminCard(targetId, cardEl, monthValue = month()) {
  const ratings = (RATINGS_CACHE || []).filter(r => String(r.targetId).trim() === String(targetId).trim());
  const notes = await getNotesForTarget(targetId, monthValue);
  const detailsDiv = cardEl.querySelector(".card-details");
  
  if (!detailsDiv) return;
  
  detailsDiv.innerHTML = `
    <div style="display: flex; gap: 10px; margin-bottom: 14px;">
      <button class="details-tab-button active" data-tab="Ratings">Ratings</button>
      <button class="details-tab-button" data-tab="Notes">Notes</button>
      <button type="button" class="refresh-notes" style="margin-left: auto; background: #3b82f6; padding: 6px 10px; border: none; border-radius: 6px; color: white; cursor: pointer; font-size: 0.9rem;">🔄</button>
    </div>
    <div class="details-content" data-tab="Ratings">
      ${ratings.length ? ratings.map(r => {
        const reviewer = STAFF_CACHE.find(s => String(s.discordId).trim() === String(r.reviewerId).trim());
        const reviewer_name = reviewer?.name || String(r.reviewerId).trim();
        return `
          <div class="review-card">
            <b>${reviewer_name}</b>
            <small>Rating: ${r.rating}</small>
            <p>${String(r.comment || "").trim() || "No comment."}</p>
          </div>
        `;
      }).join("") : "<p>No ratings yet.</p>"}
    </div>
    <div class="details-content" data-tab="Notes" style="display: none;">
      <div class="note-toggle-section">
        <button type="button" class="toggle-notes-header collapsed">
          <span>My notes</span>
          <span class="toggle-icon">▼</span>
        </button>
        <div class="toggle-notes-body hidden">
          <label for="noteType${targetId}"><b>Note type</b></label>
          <select id="noteType${targetId}">
            <option value="Positive">Positive 👍</option>
            <option value="Negative">Negative 👎</option>
          </select>
          <textarea id="noteInput${targetId}" rows="4" placeholder="Add a note..."></textarea>
          <button id="saveAdminNoteBtn${targetId}" class="save-note-action" style="margin-top: 10px;">Save Note</button>
          <div style="margin-top: 20px;">
            <b>All notes</b>
            ${notes.length ? notes.map(note => {
              const reviewer = STAFF_CACHE.find(s => String(s.discordId).trim() === String(note.reviewerId).trim());
              const icon = note.type === "Negative" ? "👎" : "👍";
              return `
                <div class="note-item">
                  <small>${icon} ${reviewer?.name || note.reviewerId}</small>
                  <p>${String(note.note || "").trim() || "No note."}</p>
                </div>
              `;
            }).join("") : "<p>No notes yet.</p>"}
          </div>
>>>>>>> fcbf1f1 (An Update to Add Messages)
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

  const ratings = await fetchApi("getRatings", { month: state.month });
  state.ratings = Array.isArray(ratings) ? ratings : [];

  const notes = await fetchApi("getNotes", { month: state.month });
  state.notes = Array.isArray(notes) ? notes : [];

  renderProfileEditor();
  renderReviewFilterControls();
  renderReviews();
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

  const ratings = await fetchApi("getRatings", { month: state.month });
  state.ratings = Array.isArray(ratings) ? ratings : [];

  const notes = await fetchApi("getNotes", { month: state.month });
  state.notes = Array.isArray(notes) ? notes : [];

  renderAdminControls();
  renderAdmin();
  hideSpinner();
  showStatus("Moderator dashboard loaded.");
}

function renderAdmin() {
  const statsBox = getEl("adminStats");
  const adminList = getEl("adminList");
  if (!statsBox || !adminList) return;

  const allStaff = state.staff;
  const activeStaff = state.staff.filter(member => isTrue(member.isActive));
  const ratingCount = state.ratings.filter(rating => rating.rating && rating.rating !== "N/A").length;
  const noteCount = state.notes.length;
  const staffNoteCount = state.notes.filter(note => isStaffNoteText(note.note)).length;
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
    const memberNotes = state.notes.filter(note => String(note.targetId).trim() === targetId);
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

<<<<<<< HEAD
function setupNav() {
  getEl("reviewsTab")?.addEventListener("click", async event => {
    event.preventDefault();
    await loadReviews();
  });
=======
// ---------------- MESSAGES ----------------

async function loadMessages() {
  setActivePage("messages");
  const container = document.getElementById("messagesContainer");
  if (!container) return;

  container.innerHTML = `<div class="card"><p>Loading messages...</p></div>`;
  showSpinner();

  try {
    if (USER?.isWebAdmin) {
      // Admin view - show all messages
      const messages = await post("getAllMessages");
      const staff = await post("getStaff");

      if (!Array.isArray(messages) || !Array.isArray(staff)) {
        showError("❌ Failed to load messages");
        return;
      }

      hideSpinner();
      renderAdminMessages(messages, staff);
    } else {
      // Regular user view - show user's messages
      const messages = await post("getMessages", { userId });

      if (!Array.isArray(messages)) {
        showError("❌ Failed to load messages");
        return;
      }

      hideSpinner();
      renderUserMessages(messages);
    }
  } catch (e) {
    console.error("Messages load failed", e);
    showError("❌ Failed to load messages");
  } finally {
    hideSpinner();
  }
}

function renderUserMessages(messages) {
  const container = document.getElementById("messagesContainer");
  if (!messages.length) {
    container.innerHTML = `<div class="card"><p>No messages yet.</p></div>`;
    return;
  }

  container.innerHTML = messages.map(msg => `
    <div class="message-admin-item ${msg.isUrgent ? 'urgent' : ''} ${!msg.readBy.includes(userId) ? 'unread' : ''}">
      <div class="message-admin-header">
        <div class="message-admin-subject">${msg.subject}</div>
        <div class="message-admin-meta">
          ${new Date(msg.sentAt).toLocaleDateString()}
        </div>
      </div>
      <div class="message-admin-recipients">
        <strong>From:</strong> ${msg.senderId}
      </div>
      <div style="margin: 12px 0; line-height: 1.5;">${msg.message.replace(/\n/g, '<br>')}</div>
      <div class="message-admin-read-status">
        <div class="message-admin-read-count">
          Status: ${msg.readBy.includes(userId) ? '<span style="color: #10b981;">Read</span>' : '<span style="color: #f59e0b;">Unread</span>'}
        </div>
      </div>
    </div>
  `).join('');
}

function renderAdminMessages(messages, staff) {
  const container = document.getElementById("messagesContainer");

  const header = `
    <div class="messages-admin-header">
      <h3>All Messages</h3>
      <button class="send-message-btn" onclick="showSendMessageForm()">📝 Send Message</button>
    </div>
  `;

  if (!messages.length) {
    container.innerHTML = `${header}<div class="card"><p>No messages sent yet.</p></div>`;
    return;
  }

  const staffMap = staff.reduce((map, s) => {
    map[s.discordId] = s.name;
    return map;
  }, {});

  container.innerHTML = `${header}<div class="messages-list">${messages.map(msg => {
    const sender = staffMap[msg.senderId] || msg.senderId;
    const recipients = msg.recipientIds.includes("ALL") ? ["All Staff"] :
      msg.recipientIds.map(id => staffMap[id] || id);

    const readByNames = msg.readBy.map(id => staffMap[id] || id);
    const unreadBy = msg.recipientIds.includes("ALL") ?
      staff.filter(s => isTrue(s.isActive) && !msg.readBy.includes(s.discordId)).map(s => s.name) :
      msg.recipientIds.filter(id => !msg.readBy.includes(id)).map(id => staffMap[id] || id);

    return `
      <div class="message-admin-item ${msg.isUrgent ? 'urgent' : ''}">
        <div class="message-admin-header">
          <div class="message-admin-subject">${msg.subject}</div>
          <div class="message-admin-meta">
            ${new Date(msg.sentAt).toLocaleDateString()} by ${sender}
          </div>
        </div>
        <div class="message-admin-recipients">
          <strong>To:</strong> ${recipients.join(", ")}
        </div>
        <div style="margin: 12px 0; line-height: 1.5;">${msg.message.replace(/\n/g, '<br>')}</div>
        <div class="message-admin-read-status">
          <div class="message-admin-read-count">
            Read by ${readByNames.length} of ${msg.recipientIds.includes("ALL") ? staff.filter(s => isTrue(s.isActive)).length : msg.recipientIds.length} recipients
          </div>
          ${readByNames.length > 0 || unreadBy.length > 0 ? `
            <div class="message-admin-read-list">
              ${readByNames.map(name => `<div class="message-admin-read-item read"><div class="message-admin-read-dot read"></div>${name}</div>`).join('')}
              ${unreadBy.map(name => `<div class="message-admin-read-item unread"><div class="message-admin-read-dot unread"></div>${name}</div>`).join('')}
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }).join('')}</div>`;
}

async function loadMessageBanners() {
  try {
    const messages = await post("getMessages", { userId });
    if (!Array.isArray(messages)) return;

    const bannersContainer = document.getElementById("messageBanners");
    if (!bannersContainer) return;

    const unreadMessages = messages.filter(msg => !msg.readBy.includes(userId));
    const urgentUnread = unreadMessages.filter(msg => msg.isUrgent);

    // Show urgent messages as popups first
    if (urgentUnread.length > 0) {
      showUrgentMessagePopup(urgentUnread[0]);
      return;
    }

    // Show banners for unread messages
    bannersContainer.innerHTML = unreadMessages.slice(0, 3).map(msg => `
      <div class="message-banner ${msg.isUrgent ? 'urgent' : 'unread'}">
        <div class="message-content">
          <div class="message-subject">[MESSAGE] ${msg.subject}</div>
          <div class="message-text">${msg.message.length > 100 ? msg.message.substring(0, 100) + '...' : msg.message}</div>
          <div class="message-timestamp">${new Date(msg.sentAt).toLocaleDateString()}</div>
        </div>
        <div class="message-actions">
          <button class="message-mark-read" onclick="markMessageRead('${msg.id}')">Mark as Read</button>
        </div>
      </div>
    `).join('');

    // Update tab indicator
    updateMessagesTabIndicator(unreadMessages.length);

  } catch (e) {
    console.error("Failed to load message banners", e);
  }
}

function updateMessagesTabIndicator(unreadCount) {
  const messagesTab = document.querySelector("[data-page='messages']");
  if (!messagesTab) return;

  // Remove existing indicator
  const existing = messagesTab.querySelector('.unread-indicator');
  if (existing) existing.remove();

  if (unreadCount > 0) {
    const indicator = document.createElement('span');
    indicator.className = 'unread-indicator';
    indicator.setAttribute('data-unread', unreadCount > 99 ? '99+' : unreadCount);
    messagesTab.appendChild(indicator);
  }
}

function showUrgentMessagePopup(message) {
  const popup = document.createElement('div');
  popup.className = 'message-popup urgent';
  popup.innerHTML = `
    <div class="message-popup-content">
      <div class="message-popup-header">
        <h3 class="message-popup-title">🚨 Urgent Message</h3>
        <span class="message-popup-urgent">Requires Confirmation</span>
      </div>
      <div class="message-popup-body">
        <strong>${message.subject}</strong><br><br>
        ${message.message.replace(/\n/g, '<br>')}
      </div>
      <div class="message-popup-actions">
        <button class="message-popup-mark-read" onclick="markMessageRead('${message.id}', true)">Mark as Read</button>
      </div>
    </div>
  `;
  document.body.appendChild(popup);

  // Prevent closing by clicking outside
  popup.addEventListener('click', (e) => {
    if (e.target === popup) {
      e.stopPropagation();
    }
  });
}

function showMessagePopup(message) {
  const popup = document.createElement('div');
  popup.className = 'message-popup';
  popup.innerHTML = `
    <div class="message-popup-content">
      <div class="message-popup-header">
        <h3 class="message-popup-title">${message.subject}</h3>
      </div>
      <div class="message-popup-body">
        ${message.message.replace(/\n/g, '<br>')}
      </div>
      <div class="message-popup-actions">
        <button class="message-popup-mark-read" onclick="markMessageRead('${message.id}', true)">Mark as Read</button>
      </div>
    </div>
  `;
  document.body.appendChild(popup);

  popup.addEventListener('click', () => {
    popup.remove();
  });
}

async function markMessageRead(messageId, closePopup = false) {
  try {
    const result = await post("markMessageRead", { messageId, userId });
    if (result?.success) {
      // Refresh banners
      await loadMessageBanners();

      // Close popup if it exists
      if (closePopup) {
        const popup = document.querySelector('.message-popup');
        if (popup) popup.remove();
      }

      // Refresh current page if on messages page
      const messagesPage = document.getElementById("messagesPage");
      if (messagesPage && !messagesPage.classList.contains('hidden')) {
        await loadMessages();
      }
    }
  } catch (e) {
    console.error("Failed to mark message as read", e);
  }
}

function showSendMessageForm() {
  const overlay = document.createElement('div');
  overlay.className = 'send-message-overlay';
  overlay.innerHTML = `
    <div class="send-message-panel">
      <div class="send-message-header">
        <h3 class="send-message-title">Send Message</h3>
      </div>
      <form class="send-message-form" onsubmit="sendMessage(event)">
        <div class="send-message-field">
          <label class="send-message-label">Subject *</label>
          <input type="text" class="send-message-input" id="messageSubject" required>
        </div>
        <div class="send-message-field">
          <label class="send-message-label">Message *</label>
          <textarea class="send-message-textarea" id="messageText" required></textarea>
        </div>
        <div class="send-message-field">
          <label class="send-message-label">Recipients</label>
          <div class="send-message-recipients" id="recipientsList">
            <div class="recipient-option selected" onclick="toggleRecipient('ALL')">
              <input type="checkbox" class="recipient-checkbox" id="recipient_ALL" checked>
              <label for="recipient_ALL">All Staff</label>
            </div>
          </div>
        </div>
        <div class="send-message-field">
          <label class="send-message-label">
            <input type="checkbox" id="messageUrgent"> Mark as Urgent (shows popup)
          </label>
        </div>
        <div class="send-message-actions">
          <button type="button" class="send-message-cancel" onclick="closeSendMessageForm()">Cancel</button>
          <button type="submit" class="send-message-submit">Send Message</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);

  // Load staff list for individual recipients
  loadStaffForRecipients();
}

async function loadStaffForRecipients() {
  try {
    const staff = await post("getStaff");
    if (!Array.isArray(staff)) return;

    const recipientsList = document.getElementById('recipientsList');
    if (!recipientsList) return;

    // Clear existing individual options
    const allOption = recipientsList.querySelector('.recipient-option');
    recipientsList.innerHTML = '';
    recipientsList.appendChild(allOption);

    // Add individual staff options
    staff.filter(s => isTrue(s.isActive)).forEach(s => {
      const option = document.createElement('div');
      option.className = 'recipient-option';
      option.onclick = () => toggleRecipient(s.discordId);
      option.innerHTML = `
        <input type="checkbox" class="recipient-checkbox" id="recipient_${s.discordId}">
        <label for="recipient_${s.discordId}">${s.name}</label>
      `;
      recipientsList.appendChild(option);
    });
  } catch (e) {
    console.error("Failed to load staff for recipients", e);
  }
}

function toggleRecipient(recipientId) {
  const allCheckbox = document.getElementById('recipient_ALL');
  const recipientCheckbox = document.getElementById(`recipient_${recipientId}`);
  const allOption = allCheckbox.closest('.recipient-option');

  if (recipientId === 'ALL') {
    if (allCheckbox.checked) {
      // Uncheck all individual recipients
      document.querySelectorAll('#recipientsList .recipient-checkbox:not(#recipient_ALL)').forEach(cb => {
        cb.checked = false;
        cb.closest('.recipient-option').classList.remove('selected');
      });
    }
  } else {
    // If checking an individual, uncheck "All Staff"
    if (recipientCheckbox.checked) {
      allCheckbox.checked = false;
      allOption.classList.remove('selected');
    }
  }

  // Update selected state
  document.querySelectorAll('#recipientsList .recipient-option').forEach(option => {
    const checkbox = option.querySelector('.recipient-checkbox');
    option.classList.toggle('selected', checkbox.checked);
  });
}

async function sendMessage(event) {
  event.preventDefault();

  const subject = document.getElementById('messageSubject').value.trim();
  const message = document.getElementById('messageText').value.trim();
  const isUrgent = document.getElementById('messageUrgent').checked;

  const selectedRecipients = Array.from(document.querySelectorAll('#recipientsList .recipient-checkbox:checked'))
    .map(cb => cb.id.replace('recipient_', ''));

  if (!subject || !message) {
    alert('Please fill in all required fields.');
    return;
  }

  if (selectedRecipients.length === 0) {
    alert('Please select at least one recipient.');
    return;
  }

  try {
    const result = await post("sendMessage", {
      senderId: userId,
      recipientIds: selectedRecipients,
      subject,
      message,
      isUrgent
    });

    if (result?.success) {
      closeSendMessageForm();
      await loadMessages(); // Refresh the messages page
    } else {
      alert('Failed to send message. Please try again.');
    }
  } catch (e) {
    console.error("Failed to send message", e);
    alert('Failed to send message. Please try again.');
  }
}

function closeSendMessageForm() {
  const overlay = document.querySelector('.send-message-overlay');
  if (overlay) overlay.remove();
}

// Make functions global so they can be called from HTML
window.markMessageRead = markMessageRead;
window.showSendMessageForm = showSendMessageForm;
window.closeSendMessageForm = closeSendMessageForm;
window.sendMessage = sendMessage;
window.toggleRecipient = toggleRecipient;

// ---------------- INIT ----------------
>>>>>>> fcbf1f1 (An Update to Add Messages)

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
<<<<<<< HEAD
  } catch (error) {
    console.error(error);
    showError("Failed to initialize portal.");
  } finally {
    hideSpinner();
=======
    await loadMessageBanners(); // Load message banners on startup
  } catch (e) {
    console.error(e);
    document.body.innerHTML = "❌ Failed to load portal";
>>>>>>> fcbf1f1 (An Update to Add Messages)
  }
})();
