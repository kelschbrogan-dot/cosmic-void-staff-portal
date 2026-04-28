const API = "https://remoteworker23.jeoliver1fan.workers.dev/";
const params = new URLSearchParams(window.location.search);
const userId = params.get("id");
const token = params.get("token");

// ========== MAINTENANCE MODE ==========
// Set to true to put the portal in hard maintenance mode locally.
const MAINTENANCE_MODE = false;
// =====================================

// ========== AVAILABLE MONTHS ==========
const AVAILABLE_MONTHS = [
  "2026-04",  // April 2026
  "2026-05"   // May 2026
];
// =====================================

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

function computeAverageRating(ratings = []) {
  const values = Array.isArray(ratings)
    ? ratings.map(r => mapRatingToNumber(r.rating)).filter(n => typeof n === "number")
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
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
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

function clearStatus() {
  const status = getEl("statusMessage");
  if (!status) return;
  status.textContent = "";
  status.className = "status-message";
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
  if (!overlay) return;

  getEl("popupTitle").textContent = title;
  getEl("popupBody").innerHTML = html;
  const actionsContainer = getEl("popupActions");
  if (!actionsContainer) return;
  actionsContainer.innerHTML = actions.map(action => `
      <button class="overlay-button ${action.secondary ? "secondary" : ""}" id="${action.id}">${escapeHtml(action.text)}</button>
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
    if (!action.callback || !action.id) return;
    const element = getEl(action.id);
    if (element) {
      element.onclick = action.callback;
    }
  });
}

function hidePopup() {
  const overlay = getEl("popupOverlay");
  if (!overlay) return;
  overlay.classList.add("hidden");
  overlay.setAttribute("aria-hidden", "true");
  getEl("popupBody").innerHTML = "";
  getEl("popupActions").innerHTML = "";
}

function showDeniedOverlay(reason) {
  let title = "Access Denied";
  let message = "You do not have permission to access this portal.";

  if (reason === "INVALID_LOGIN") {
    title = "Access Denied";
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
  showError("❌ Unexpected error occurred while loading. Please refresh the page.");
});

window.addEventListener("error", event => {
  console.error("Unhandled error:", event.error || event.message);
  showError("❌ Unexpected error occurred while loading. Please refresh the page.");
});

async function fetchApi(action, data = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...data }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    console.error(`API ${action} failed`, error);
    return null;
  }
}

async function verifyUser() {
  if (!userId || !token) {
    showDeniedOverlay("INVALID_LOGIN");
    return false;
  }

  showStatus("Verifying credentials...");
  const tokenRes = await fetchApi("getToken", { discordId: userId });
  const verifyRes = await fetchApi("verifyUser", { discordId: userId, token });

  if (!tokenRes || !verifyRes) {
    showDeniedOverlay("MAINTENANCE");
    return false;
  }

  state.maintenance = isTrue(tokenRes.maintenance);

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

  if (state.maintenance && !isTrue(verifyRes.isWebAdmin)) {
    showDeniedOverlay("MAINTENANCE");
    return false;
  }

  state.user = {
    ...tokenRes,
    isWebAdmin: isTrue(verifyRes.isWebAdmin)
  };

  if (state.user.isWebAdmin) {
    getEl("adminTab")?.classList.remove("hidden");
  }

  showStatus(`Signed in as ${state.user.name || "Staff"}`);
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

  const months = AVAILABLE_MONTHS.map(monthStr => {
    const [year, month] = monthStr.split('-');
    const date = new Date(year, parseInt(month) - 1, 1);
    const display = date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
    return { value: monthStr, display };
  });

  select.innerHTML = months.map(m => `<option value="${m.value}">${m.display}</option>`).join("");
  const currentMonthStr = state.month;
  select.value = AVAILABLE_MONTHS.includes(currentMonthStr) ? currentMonthStr : AVAILABLE_MONTHS[0];
  state.month = select.value;

  select.addEventListener("change", async () => {
    state.month = select.value;
    await loadAdmin();
  });
}

function renderProfileEditor() {
  const profileEditor = getEl("profileEditor");
  if (!profileEditor || !state.user) return;

  profileEditor.innerHTML = `
    <div class="profile-card">
      <h3>Your profile</h3>
      <label for="profileNameInput">Display name</label>
      <input id="profileNameInput" type="text" value="${escapeHtml(state.user.name || "")}" placeholder="Nickname" />
      <label for="profileAvatarInput">Avatar URL</label>
      <input id="profileAvatarInput" type="text" value="${escapeHtml(state.user.avatarURL || "")}" placeholder="Avatar image URL" />
      <button id="profileSaveButton" type="button">Save profile</button>
    </div>
  `;

  getEl("profileSaveButton")?.addEventListener("click", saveOwnProfile);
}

function renderReviewFilterControls() {
  const container = getEl("reviewFilterControls");
  if (!container) return;

  container.innerHTML = `
    <button id="filterAll" class="${state.reviewFilter === "all" ? "active" : ""}" type="button">All</button>
    <button id="filterComplete" class="${state.reviewFilter === "complete" ? "active" : ""}" type="button">Complete</button>
    <button id="filterIncomplete" class="${state.reviewFilter === "incomplete" ? "active" : ""}" type="button">Incomplete</button>
  `;

  ["all", "complete", "incomplete"].forEach(filter => {
    const button = getEl(`filter${filter.charAt(0).toUpperCase() + filter.slice(1)}`);
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
  const currentRating = state.ratings.find(r => String(r.targetId).trim() === targetId && String(r.reviewerId).trim() === String(userId).trim());
  return !!currentRating && currentRating.rating && currentRating.rating !== "N/A";
}

function renderReviews() {
  const reviewsBox = getEl("reviewsBox");
  if (!reviewsBox) return;

  const activeStaff = state.staff.filter(member => isTrue(member.isActive));
  const filteredStaff = activeStaff.filter(member => {
    const completed = getReviewCompletion(member);
    if (state.reviewFilter === "complete") return completed;
    if (state.reviewFilter === "incomplete") return !completed;
    return true;
  });

  if (!filteredStaff.length) {
    reviewsBox.innerHTML = `<div class="card"><p>No staff matching this view.</p></div>`;
    return;
  }

  reviewsBox.innerHTML = filteredStaff.map(member => {
    const isYou = String(member.discordId).trim() === String(userId).trim();
    const targetId = String(member.discordId).trim();
    const currentRating = state.ratings.find(r => String(r.targetId).trim() === targetId && String(r.reviewerId).trim() === String(userId).trim());
    const selectedRating = currentRating?.rating ? currentRating.rating : "N/A";
    const myNotes = state.notes.filter(note => String(note.targetId).trim() === targetId && String(note.reviewerId).trim() === String(userId).trim());
    const completed = getReviewCompletion(member);

    if (isYou) {
      return `
        <div class="card no-click">
          <img src="${escapeHtml(member.avatarURL || "")}" alt="${escapeHtml(member.name)}">
          <div class="card-body">
            <b>${escapeHtml(member.name)}</b>
            <p style="opacity:0.6;">This is you! 💜</p>
          </div>
        </div>`;
    }

    const notesHtml = myNotes.length ? myNotes.map(note => {
      const isAnonymous = String(note.note || "").startsWith("[ANON]");
      const displayType = isAnonymous ? "Anonymous" : note.type;
      const displayNote = isAnonymous ? String(note.note || "").substring(6).trim() : String(note.note || "").trim();
      const anonClass = isAnonymous ? " anonymous-note" : "";
      return `
        <div class="note-item${anonClass}">
          <small>${note.type === "Negative" ? "👎" : "👍"} ${escapeHtml(displayType)}</small>
          <p>${escapeHtml(displayNote || "No note content.")}</p>
        </div>
      `;
    }).join("") : `
        <div class="note-item"><p style="opacity: 0.7;">No notes yet.</p></div>
      `;

    return `
      <div class="card" data-id="${escapeHtml(targetId)}">
        <img src="${escapeHtml(member.avatarURL || "")}" alt="${escapeHtml(member.name)}">
        <div class="card-body">
          <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:flex-start;">
            <b>${escapeHtml(member.name)}</b>
            <span class="review-status ${completed ? "complete" : "incomplete"}">${completed ? "Complete" : "Incomplete"}</span>
          </div>
          <select data-id="${escapeHtml(targetId)}">
            ${["Excels", "On Par", "Meets Standards", "Below Par", "Needs Work", "N/A"].map(option => `
              <option value="${option}" ${option === selectedRating ? "selected" : ""}>${option}</option>
            `).join("")}
          </select>
          <textarea data-id="${escapeHtml(targetId)}" placeholder="Leave a comment... (Optional)">${escapeHtml(currentRating?.comment || "")}</textarea>
          <div class="note-summary">
            <button type="button" class="toggle-notes-header collapsed">
              <span>My notes</span>
              <span class="toggle-icon">▼</span>
            </button>
            <div class="toggle-notes-body hidden">
              <div class="note-list">${notesHtml}</div>
              <label for="noteType-${escapeHtml(targetId)}">New note type</label>
              <select id="noteType-${escapeHtml(targetId)}" data-note-id="${escapeHtml(targetId)}">
                <option value="Positive">Positive 👍</option>
                <option value="Negative">Negative 👎</option>
              </select>
              <label for="noteInput-${escapeHtml(targetId)}">Add a note</label>
              <textarea id="noteInput-${escapeHtml(targetId)}" data-note-id="${escapeHtml(targetId)}" rows="3" placeholder="Add a note about this staff member..."></textarea>
              <label for="anon-${escapeHtml(targetId)}"><input type="checkbox" id="anon-${escapeHtml(targetId)}" data-anon-id="${escapeHtml(targetId)}"> Submit anonymously</label>
              <button class="save-note-button" data-note-id="${escapeHtml(targetId)}" type="button">Add note</button>
            </div>
          </div>
        </div>
      </div>`;
  }).join("");

  document.querySelectorAll("#reviewsBox select[data-id], #reviewsBox textarea[data-id]").forEach(element => {
    element.addEventListener("change", saveReviews);
  });

  document.querySelectorAll(".save-note-button").forEach(button => {
    button.addEventListener("click", async () => {
      if (button.disabled) return;
      const targetId = button.dataset.noteId;
      if (targetId) await saveNoteForTarget(targetId, button);
    });
  });

  document.querySelectorAll(".toggle-notes-header").forEach(button => {
    const body = button.closest(".note-summary")?.querySelector(".toggle-notes-body");
    if (!body) return;
    button.addEventListener("click", () => {
      const isHidden = body.classList.toggle("hidden");
      button.classList.toggle("open", !isHidden);
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
    showError("❌ Failed to save profile.");
    hideSpinner();
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
  const maintenanceBtn = getEl("adminMaintenanceBtn");
  const addStaffBtn = getEl("adminAddStaffBtn");
  if (maintenanceBtn) {
    maintenanceBtn.textContent = state.maintenance ? "Maintenance: On" : "Maintenance: Off";
    maintenanceBtn.onclick = async () => {
      await toggleMaintenance(!state.maintenance);
    };
  }
  if (addStaffBtn) {
    addStaffBtn.onclick = openAddStaffModal;
  }
}

async function toggleMaintenance(enabled) {
  showStatus(enabled ? "Enabling maintenance..." : "Disabling maintenance...");
  showSpinner();

  const result = await fetchApi("setMaintenance", { enabled });
  if (!result?.success) {
    showError("❌ Failed to update maintenance mode.");
    hideSpinner();
    return;
  }

  state.maintenance = enabled;
  renderAdminControls();
  hideSpinner();
  showStatus(`Maintenance ${enabled ? "enabled" : "disabled"}.`);
}

async function openAddStaffModal() {
  showPopup("Add new staff member", `
    <label for="newDiscordId">Discord ID</label>
    <input id="newDiscordId" type="text" placeholder="123456789012345678" />
    <label for="newName">Display name</label>
    <input id="newName" type="text" placeholder="Nickname" />
    <label for="newAvatarURL">Avatar URL</label>
    <input id="newAvatarURL" type="text" placeholder="https://..." />
    <label><input type="checkbox" id="newIsWebAdmin" /> Make admin</label>
    <label><input type="checkbox" id="newIsActive" checked /> Active</label>
  `, [
    { id: "addStaffCancelBtn", text: "Cancel", secondary: true, callback: hidePopup },
    { id: "addStaffSaveBtn", text: "Create Staff", callback: async () => {
      const discordId = getEl("newDiscordId")?.value.trim();
      const name = getEl("newName")?.value.trim();
      const avatarURL = getEl("newAvatarURL")?.value.trim();
      const isWebAdmin = getEl("newIsWebAdmin")?.checked || false;
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
        isWebAdmin,
        isActive
      });

      hideSpinner();
      if (!result?.success) {
        showError("❌ Failed to create staff member.");
        return;
      }

      hidePopup();
      await refreshStaff();
      await loadAdmin();
      showStatus("New staff member added.");
    } }
  ]);
}

async function openAdminStaffModal(targetId) {
  const member = state.staff.find(s => String(s.discordId).trim() === String(targetId).trim());
  if (!member) return;

  const ratings = getAdminTargetRatings(targetId);
  const notes = getAdminTargetNotes(targetId);
  const positiveCount = notes.filter(note => note.type === "Positive").length;
  const negativeCount = notes.filter(note => note.type === "Negative").length;
  const memberAvgRating = computeAverageRating(ratings);

  const html = `
    <div class="popup-section">
      <b>Manage staff member</b>
      <label for="adminUserName">Display name</label>
      <input id="adminUserName" type="text" value="${escapeHtml(member.name || "")}" />
      <label for="adminUserAvatar">Avatar URL</label>
      <input id="adminUserAvatar" type="text" value="${escapeHtml(member.avatarURL || "")}" />
      <label><input type="checkbox" id="adminUserActive" ${isTrue(member.isActive) ? "checked" : ""} /> Active</label>
      <label><input type="checkbox" id="adminUserWebAdmin" ${isTrue(member.isWebAdmin) ? "checked" : ""} /> Web admin</label>
      <div style="margin-top: 12px; display:flex; gap:12px; flex-wrap:wrap;">
        <button id="adminSaveUserBtn" type="button">Save changes</button>
        <button id="adminResetTokenBtn" type="button">Reset token</button>
      </div>
      <div id="adminStaffTokenResult" style="margin-top: 12px;"></div>
    </div>
    <div class="popup-section">
      <h3>Performance snapshot</h3>
      <p><strong>Ratings received:</strong> ${ratings.length}</p>
      <p><strong>Avg rating:</strong> ${memberAvgRating ? memberAvgRating.toFixed(1) : "N/A"}</p>
      <p><strong>Notes:</strong> ${notes.length} (${positiveCount} positive, ${negativeCount} negative)</p>
    </div>
  `;

  showPopup(`Manage ${member.name}`, html, [
    { id: "adminCloseUserBtn", text: "Close", secondary: true, callback: hidePopup }
  ]);

  getEl("adminSaveUserBtn")?.addEventListener("click", async () => {
    const name = getEl("adminUserName")?.value.trim();
    const avatarURL = getEl("adminUserAvatar")?.value.trim();
    const isActive = getEl("adminUserActive")?.checked || false;
    const isWebAdmin = getEl("adminUserWebAdmin")?.checked || false;

    showStatus("Saving staff member...");
    showSpinner();

    const result = await fetchApi("updateStaff", {
      discordId: targetId,
      updates: { name, avatarURL, isActive, isWebAdmin }
    });

    hideSpinner();
    if (!result?.success) {
      showError("❌ Failed to update staff member.");
      return;
    }

    hidePopup();
    await refreshStaff();
    await loadAdmin();
    showStatus("Staff member updated.");
  });

  getEl("adminResetTokenBtn")?.addEventListener("click", async () => {
    showStatus("Resetting token...");
    showSpinner();

    const result = await fetchApi("resetStaffToken", { discordId: targetId });
    hideSpinner();
    if (!result?.success) {
      showError("❌ Failed to reset token.");
      return;
    }

    const tokenResult = getEl("adminStaffTokenResult");
    if (tokenResult) {
      tokenResult.innerHTML = `<small style="color:#a7f3d0;">New token: <code>${escapeHtml(result.newToken || "")}</code></small>`;
    }

    await refreshStaff();
    showStatus("Token reset successfully.");
  });
}

function getReviewerName(reviewerId) {
  return state.staff.find(member => String(member.discordId).trim() === String(reviewerId).trim())?.name || reviewerId;
}

function getAdminTargetNotes(targetId) {
  return state.notes.filter(note => String(note.targetId).trim() === String(targetId).trim());
}

function getAdminTargetRatings(targetId) {
  return state.ratings.filter(rating => String(rating.targetId).trim() === String(targetId).trim());
}

async function saveNoteForTarget(targetId, button) {
  button = button || document.querySelector(`.save-note-button[data-note-id='${targetId}']`);
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
    noteText = "[ANON]" + noteText;
  }

  if (button) {
    button.disabled = true;
    button.textContent = "Saving...";
  }

  showStatus("Saving note...");
  showSpinner();
  const result = await fetchApi("saveNotes", {
    month: state.month,
    reviewerId: userId,
    targetId,
    type: noteType,
    note: noteText.trim()
  });

  if (!result) {
    showError("❌ Failed to save note.");
    hideSpinner();
    if (button) {
      button.disabled = false;
      button.textContent = "Add note";
    }
    return;
  }

  const notes = await fetchApi("getNotes", { month: state.month });
  state.notes = Array.isArray(notes) ? notes : state.notes;
  if (noteTextElement) noteTextElement.value = "";
  if (anonCheckbox) anonCheckbox.checked = false;
  renderReviews();
  hideSpinner();
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
  if (!state.user?.isWebAdmin) {
    showError("❌ Admin access required.");
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

  const activeStaff = state.staff.filter(member => isTrue(member.isActive));
  const ratingCount = state.ratings.length;
  const noteCount = state.notes.length;
  const positiveNotes = state.notes.filter(note => note.type === "Positive").length;
  const negativeNotes = state.notes.filter(note => note.type === "Negative").length;
  const averageRating = computeAverageRating(state.ratings);
  const totalPossibleRatings = activeStaff.length * (activeStaff.length - 1);
  const ratingCompletion = totalPossibleRatings > 0 ? Math.round((ratingCount / totalPossibleRatings) * 100) : 0;

  statsBox.innerHTML = `
    <div class="stat-card">
      <b>General rating</b>
      <span style="font-size: 1.4em; color: #3b82f6;">${averageRating ? `${averageRating.toFixed(1)} / 5` : "N/A"}</span>
    </div>
    <div class="stat-card">
      <b>Active staff</b>
      <span style="font-size: 1.4em; color: #10b981;">${activeStaff.length}</span>
    </div>
    <div class="stat-card">
      <b>Ratings progress</b>
      <span style="font-size: 1.4em; color: #f59e0b;">${ratingCount}/${totalPossibleRatings} (${ratingCompletion}%)</span>
    </div>
    <div class="stat-card">
      <b>Total notes</b>
      <span style="font-size: 1.4em; color: #8b5cf6;">${noteCount}</span>
    </div>
    <div class="stat-card">
      <b>Positive notes</b>
      <span style="font-size: 1.4em; color: #10b981;">👍 ${positiveNotes}</span>
    </div>
    <div class="stat-card">
      <b>Negative notes</b>
      <span style="font-size: 1.4em; color: #ef4444;">👎 ${negativeNotes}</span>
    </div>`;

  adminList.innerHTML = activeStaff.length ? activeStaff.map(member => {
    const targetId = String(member.discordId).trim();
    const memberRatings = state.ratings.filter(r => String(r.targetId).trim() === targetId);
    const memberNotes = state.notes.filter(n => String(n.targetId).trim() === targetId);
    const memberAvgRating = computeAverageRating(memberRatings);
    const ratingsReceived = memberRatings.length;
    const positiveCount = memberNotes.filter(n => n.type === "Positive").length;
    const negativeCount = memberNotes.filter(n => n.type === "Negative").length;
    const memberGivenRatings = state.ratings.filter(r => String(r.reviewerId).trim() === targetId);
    const expectedRatings = activeStaff.length - 1;

    return `
      <div class="staff-card" data-id="${escapeHtml(targetId)}">
        <img src="${escapeHtml(member.avatarURL || '')}" alt="${escapeHtml(member.name)}" style="width: 50px; height: 50px; border-radius: 50%; margin-bottom: 8px;">
        <div class="card-body">
          <b>${escapeHtml(member.name)}</b>
          <p style="margin: 4px 0; opacity: 0.8;">Avg: <span style="color: #3b82f6; font-weight: bold;">${memberAvgRating ? memberAvgRating.toFixed(1) : 'N/A'}</span>/5</p>
          <p style="margin: 4px 0; opacity: 0.8;"><span style="color: #94a3b8;">${ratingsReceived}</span> ratings received</p>
          <p style="margin: 4px 0; opacity: 0.8;"><span style="color: #94a3b8;">${memberGivenRatings.length}/${expectedRatings}</span> ratings given</p>
          <p style="margin: 4px 0; opacity: 0.8;">👍${positiveCount} / 👎${negativeCount}</p>
        </div>
      </div>`;
  }).join("") : `<div class="card"><p>No active staff found.</p></div>`;

  adminList.querySelectorAll(".staff-card").forEach(card => {
    card.addEventListener("click", () => {
      const targetId = card.dataset.id;
      if (targetId) openAdminStaffModal(targetId);
    });
  });
}

async function saveReviews() {
  const payload = Array.from(document.querySelectorAll("#reviewsBox select[data-id]")).map(select => {
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
    ratings: payload.map(item => ({ targetId: item.id, rating: item.value, comment: item.comment }))
  });

  const updatedRatings = await fetchApi("getRatings", { month: state.month });
  state.ratings = Array.isArray(updatedRatings) ? updatedRatings : state.ratings;
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
    showError("❌ Failed to initialize portal.");
  } finally {
    hideSpinner();
  }
})();
