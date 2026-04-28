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
      return "Admin";
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

function sortNotesForDisplay(notes) {
  return [...notes].sort((a, b) => {
    const staffPriority = Number(isStaffNoteText(b.note)) - Number(isStaffNoteText(a.note));
    if (staffPriority !== 0) return staffPriority;
    return String(getReviewerName(a.reviewerId)).localeCompare(String(getReviewerName(b.reviewerId)));
  });
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

  badges.push(
    `<span class="note-badge ${note.type === "Negative" ? "negative" : "positive"}">${escapeHtml(note.type || "Note")}</span>`
  );

  if (anonymous && !staffNote) {
    badges.push(`<span class="role-pill">Anonymous</span>`);
  }

  return `
    <div class="note-item ${noteToneClass}${anonymous ? " anonymous-note" : ""}${staffNote ? " staff-note" : ""}">
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
            <button type="button" class="toggle-notes-header" data-target-id="${escapeHtml(targetId)}">
              <span>My notes (${myNotes.length})</span>
              <span class="toggle-icon">v</span>
            </button>
            <div class="toggle-notes-body hidden" id="notes-${escapeHtml(targetId)}">
              <div class="stack-list">${notesHtml}</div>
              <label for="noteType-${escapeHtml(targetId)}">New note type</label>
              <select id="noteType-${escapeHtml(targetId)}" data-note-id="${escapeHtml(targetId)}">
                <option value="Positive">Positive</option>
                <option value="Negative">Negative</option>
              </select>
              <label for="noteInput-${escapeHtml(targetId)}">Add a note</label>
              <textarea id="noteInput-${escapeHtml(targetId)}" data-note-id="${escapeHtml(targetId)}" rows="3" placeholder="Add a note about this staff member..."></textarea>
              <label for="anon-${escapeHtml(targetId)}" class="checkbox-row">
                <input type="checkbox" id="anon-${escapeHtml(targetId)}" data-anon-id="${escapeHtml(targetId)}">
                Submit anonymously
              </label>
              <button class="save-note-button" data-note-id="${escapeHtml(targetId)}" type="button">Add Note</button>
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
    });
  });

  document.querySelectorAll(".save-note-button").forEach(button => {
    button.addEventListener("click", async () => {
      if (button.disabled) return;
      const targetId = button.dataset.noteId;
      if (targetId) await saveNoteForTarget(targetId, button);
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

  let html = `<button id="adminAddStaffBtn" type="button">Add New Staff</button>`;

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
    showPopup("Maintenance Enabled", "<p>Portal is now in maintenance mode. Only Web Admins can access it.</p>", [
      {
        id: "maintenanceAdminBtn",
        text: "Back to Admin Panel",
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
      <option value="TRUE">Admin</option>
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
  const type = getEl("adminStaffNoteType")?.value || "Positive";
  const noteInput = getEl("adminStaffNoteInput");
  let noteText = noteInput?.value.trim() || "";

  if (!noteText) {
    showStatus("Enter a staff note before saving.");
    return;
  }

  if (!isStaffNoteText(noteText)) {
    noteText = `[STAFF] ${noteText}`;
  }

  showStatus("Saving staff note...");
  showSpinner();

  const result = await fetchApi("saveNotes", {
    month: state.month,
    reviewerId: userId,
    targetId,
    type,
    note: noteText.trim()
  });

  if (!result) {
    showError("Failed to save staff note.");
    return;
  }

  const notes = await fetchApi("getNotes", { month: state.month });
  state.notes = Array.isArray(notes) ? notes : state.notes;

  hideSpinner();
  showStatus("Staff note saved.");
  openAdminStaffModal(targetId);
}

async function openAdminStaffModal(targetId) {
  const member = state.staff.find(staffMember => String(staffMember.discordId).trim() === String(targetId).trim());
  if (!member) return;

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
              <div class="stat-subtext">pinned admin notes</div>
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
            <option value="Positive">Positive</option>
            <option value="Negative">Negative</option>
          </select>
          <label for="adminStaffNoteInput">Pinned note</label>
          <textarea id="adminStaffNoteInput" rows="4" placeholder="[STAFF] Add an admin-only note for this user, including suspended staff."></textarea>
          <button id="adminAddStaffNoteBtn" class="primary-button" type="button">Save Staff Note</button>
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
              <option value="TRUE" ${memberRole === "ADMIN" ? "selected" : ""}>Admin</option>
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

  showPopup(`Manage: ${member.name}`, html, [
    { id: "adminCloseUserBtn", text: "Close", secondary: true, callback: hidePopup }
  ]);

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

async function saveNoteForTarget(targetId, button) {
  const noteTypeElement = document.querySelector(`#reviewsBox select[data-note-id='${targetId}']`);
  const noteTextElement = document.querySelector(`#reviewsBox textarea[data-note-id='${targetId}']`);
  const anonCheckbox = document.querySelector(`#reviewsBox input[data-anon-id='${targetId}']`);
  const noteType = noteTypeElement?.value || "Positive";
  let noteText = noteTextElement?.value || "";

  if (!noteText.trim()) {
    showStatus("Please enter a note before saving.");
    return;
  }

  if (anonCheckbox?.checked) {
    noteText = `[ANON]${noteText}`;
  }

  if (button) {
    button.disabled = true;
    button.textContent = "Saving...";
  }

  showStatus("Saving note...");

  const result = await fetchApi("saveNotes", {
    month: state.month,
    reviewerId: userId,
    targetId,
    type: noteType,
    note: noteText.trim()
  });

  if (!result) {
    showError("Failed to save note.");
    if (button) {
      button.disabled = false;
      button.textContent = "Add Note";
    }
    return;
  }

  const notes = await fetchApi("getNotes", { month: state.month });
  state.notes = Array.isArray(notes) ? notes : state.notes;

  if (noteTextElement) noteTextElement.value = "";
  if (anonCheckbox) anonCheckbox.checked = false;

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
    showError("Admin access required.");
    return;
  }

  showPage("admin");
  showStatus("Loading admin dashboard...");
  showSpinner();

  await refreshStaff();

  const ratings = await fetchApi("getRatings", { month: state.month });
  state.ratings = Array.isArray(ratings) ? ratings : [];

  const notes = await fetchApi("getNotes", { month: state.month });
  state.notes = Array.isArray(notes) ? notes : [];

  renderAdminControls();
  renderAdmin();
  hideSpinner();
  showStatus("Admin dashboard loaded.");
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
