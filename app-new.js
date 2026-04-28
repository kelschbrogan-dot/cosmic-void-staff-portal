const API = "https://remoteworker23.jeoliver1fan.workers.dev/";
const params = new URLSearchParams(window.location.search);
const userId = params.get("id");
const token = params.get("token");

// ========== MAINTENANCE MODE ==========
// Set to true to put the portal in maintenance mode
// Set to false to allow normal access
const MAINTENANCE_MODE = false;
// =====================================

// ========== AVAILABLE MONTHS ==========
// Add/remove months that have data here
// Format: "YYYY-MM" (e.g., "2026-04" for April 2026)
// Example: ["2026-04", "2026-05", "2026-06"]
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
  user: null
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
    reviewsBox.innerHTML = `<div class="card"><p>${message}</p></div>`;
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
      <button class="overlay-button ${action.secondary ? "secondary" : ""}" id="${action.id}">${action.text}</button>
    `).join("");

  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");

  getEl("popupClose")?.addEventListener("click", hidePopup);
  overlay.onclick = event => {
    if (event.target === overlay) hidePopup();
  };

  actions.forEach(action => {
    if (!action.callback || !action.id) return;
    getEl(action.id)?.addEventListener("click", action.callback);
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

  showPopup(title, `<p>${message}</p>`, [
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

  // Check if maintenance mode is enabled
  if (MAINTENANCE_MODE) {
    showDeniedOverlay("MAINTENANCE");
    return false;
  }

  showStatus("Verifying credentials...");
  const tokenRes = await fetchApi("getToken", { discordId: userId });
  const verifyRes = await fetchApi("verifyUser", { discordId: userId, token });

  if (!tokenRes || !verifyRes) {
    showDeniedOverlay("MAINTENANCE");
    return false;
  }

  if (tokenRes?.error === "MAINTENANCE" || verifyRes?.error === "MAINTENANCE") {
    showDeniedOverlay("MAINTENANCE");
    return false;
  }

  if (!isTrue(tokenRes.success)) {
    showDeniedOverlay("INVALID_LOGIN");
    return false;
  }

  if (!isTrue(tokenRes.isActive)) {
    showDeniedOverlay("SUSPENDED");
    return false;
  }

  if (!isTrue(verifyRes.valid)) {
    showDeniedOverlay("INVALID_LOGIN");
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
  
  // Set to current month if available, otherwise first available month
  const currentMonthStr = state.month;
  select.value = AVAILABLE_MONTHS.includes(currentMonthStr) ? currentMonthStr : AVAILABLE_MONTHS[0];
  state.month = select.value;
  
  select.addEventListener("change", async () => {
    state.month = select.value;
    await loadAdmin();
  });
}

function renderReviews() {
  const reviewsBox = getEl("reviewsBox");
  if (!reviewsBox) return;

  const activeStaff = state.staff.filter(member => isTrue(member.isActive));
  if (!activeStaff.length) {
    reviewsBox.innerHTML = `<div class="card"><p>No active staff found.</p></div>`;
    return;
  }

  reviewsBox.innerHTML = activeStaff.map(member => {
    const isYou = String(member.discordId).trim() === String(userId).trim();
    const currentRating = state.ratings.find(r => String(r.targetId).trim() === String(member.discordId).trim() && String(r.reviewerId).trim() === String(userId).trim());
    const selectedRating = currentRating?.rating ? currentRating.rating : "N/A";
    const targetId = String(member.discordId).trim();
    const myNotes = state.notes.filter(note => String(note.targetId).trim() === targetId && String(note.reviewerId).trim() === String(userId).trim());

    if (isYou) {
      return `
        <div class="card no-click">
          <img src="${member.avatarURL || ""}" alt="${member.name}">
          <div class="card-body">
            <b>${member.name}</b>
            <p style="opacity:0.6;">This is you! 💜</p>
          </div>
        </div>`;
    }

    const notesHtml = myNotes.length ? myNotes.map(note => `
        <div class="note-item">
          <small>${note.type === "Negative" ? "👎" : "👍"} ${note.type}</small>
          <p>${String(note.note || "").trim() || "No note content."}</p>
        </div>
      `).join("") : `
        <div class="note-item"><p style="opacity: 0.7;">No notes yet.</p></div>
      `;

    return `
      <div class="card" data-id="${targetId}">
        <img src="${member.avatarURL || ""}" alt="${member.name}">
        <div class="card-body">
          <b>${member.name}</b>
          <select data-id="${targetId}">
            ${["Excels", "On Par", "Meets Standards", "Below Par", "Needs Work", "N/A"].map(option => `
              <option value="${option}" ${option === selectedRating ? "selected" : ""}>${option}</option>
            `).join("")}
          </select>
          <textarea data-id="${targetId}" placeholder="Leave a comment...">${currentRating?.comment || ""}</textarea>
          <div class="note-summary">
            <button type="button" class="toggle-notes-header collapsed">
              <span>My notes</span>
              <span class="toggle-icon">▼</span>
            </button>
            <div class="toggle-notes-body hidden">
              <div class="note-list">${notesHtml}</div>
              <label for="noteType-${targetId}">New note type</label>
              <select id="noteType-${targetId}" data-note-id="${targetId}">
                <option value="Positive">Positive 👍</option>
                <option value="Negative">Negative 👎</option>
              </select>
              <label for="noteInput-${targetId}">Add a note</label>
              <textarea id="noteInput-${targetId}" data-note-id="${targetId}" rows="3" placeholder="Add a note about this staff member..."></textarea>
              <button class="save-note-button" data-note-id="${targetId}" type="button">Add note</button>
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
      const targetId = button.dataset.noteId;
      if (targetId) await saveNoteForTarget(targetId);
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

async function saveNoteForTarget(targetId) {
  const noteTypeElement = document.querySelector(`#reviewsBox select[data-note-id='${targetId}']`);
  const noteTextElement = document.querySelector(`#reviewsBox textarea[data-note-id='${targetId}']`);
  const noteType = noteTypeElement?.value || "Positive";
  const noteText = noteTextElement?.value || "";

  if (!noteText.trim()) {
    showStatus("Please enter a note before saving.");
    return;
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
    return;
  }

  const notes = await fetchApi("getNotes", { month: state.month });
  state.notes = Array.isArray(notes) ? notes : state.notes;
  if (noteTextElement) noteTextElement.value = "";
  renderReviews();
  hideSpinner();
  showStatus("Note saved.");
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

  // Calculate completion stats
  const totalPossibleRatings = activeStaff.length * (activeStaff.length - 1); // Everyone rates everyone except themselves
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

    return `
      <div class="staff-card" data-id="${targetId}">
        <img src="${member.avatarURL || ''}" alt="${member.name}" style="width: 50px; height: 50px; border-radius: 50%; margin-bottom: 8px;">
        <div class="card-body">
          <b>${member.name}</b>
          <p style="margin: 4px 0; opacity: 0.8;">Avg: <span style="color: #3b82f6; font-weight: bold;">${memberAvgRating ? memberAvgRating.toFixed(1) : 'N/A'}</span>/5</p>
          <p style="margin: 4px 0; opacity: 0.8;"><span style="color: #94a3b8;">${ratingsReceived}</span> ratings</p>
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

function getReviewerName(reviewerId) {
  return state.staff.find(member => String(member.discordId).trim() === String(reviewerId).trim())?.name || reviewerId;
}

function getAdminTargetNotes(targetId) {
  return state.notes.filter(note => String(note.targetId).trim() === String(targetId).trim());
}

function getAdminTargetRatings(targetId) {
  return state.ratings.filter(rating => String(rating.targetId).trim() === String(targetId).trim());
}

async function openAdminStaffModal(targetId) {
  const member = state.staff.find(s => String(s.discordId).trim() === String(targetId).trim());
  if (!member) return;

  const ratings = getAdminTargetRatings(targetId);
  const notes = getAdminTargetNotes(targetId);

  const ratingsHtml = ratings.length ? ratings.map(r => `
      <div class="review-card">
        <b>${getReviewerName(r.reviewerId)}</b>
        <small>Rating: ${r.rating}</small>
        <p>${String(r.comment || "").trim() || "No comment."}</p>
      </div>
    `).join("") : "<p>No ratings yet.</p>";

  const positiveCount = notes.filter(note => note.type === "Positive").length;
  const negativeCount = notes.filter(note => note.type === "Negative").length;
  const notesHtml = notes.length ? notes.map(note => `
      <div class="note-item">
        <small>${note.type === "Negative" ? "👎" : "👍"} ${getReviewerName(note.reviewerId)}</small>
        <p>${String(note.note || "").trim() || "No note."}</p>
      </div>
    `).join("") : "<p>No notes yet.</p>";

  showPopup(`Staff details for ${member.name}`, `
    <div class="popup-section">
      <h3>Ratings</h3>
      ${ratingsHtml}
    </div>
    <div class="popup-section">
      <h3>Notes (${notes.length})</h3>
      <p>${positiveCount} positive • ${negativeCount} negative</p>
      ${notesHtml}
    </div>
  `, [
    { id: "popupCloseBtn", text: "Close", secondary: true, callback: hidePopup }
  ]);
}


async function loadReviews() {
  showPage("reviews");
  showStatus("Loading reviews...");
  showSpinner();

  if (!state.staff.length) {
    const staff = await fetchApi("getStaff");
    state.staff = Array.isArray(staff) ? staff : [];
  }

  const ratings = await fetchApi("getRatings", { month: state.month });
  state.ratings = Array.isArray(ratings) ? ratings : [];

  const notes = await fetchApi("getNotes", { month: state.month });
  state.notes = Array.isArray(notes) ? notes : [];

  if (!Array.isArray(state.staff)) {
    showError("❌ Failed to load staff.");
    hideSpinner();
    return;
  }

  renderReviews();
  hideSpinner();
  showStatus("Reviews loaded. /n Made with 💜 by Jason");
}

async function loadAdmin() {
  if (!state.user?.isWebAdmin) {
    showError("❌ Admin access required.");
    return;
  }

  showPage("admin");
  showStatus("Loading admin dashboard...");
  showSpinner();

  if (!state.staff.length) {
    const staff = await fetchApi("getStaff");
    state.staff = Array.isArray(staff) ? staff : [];
  }

  const ratings = await fetchApi("getRatings", { month: state.month });
  state.ratings = Array.isArray(ratings) ? ratings : [];

  const notes = await fetchApi("getNotes", { month: state.month });
  state.notes = Array.isArray(notes) ? notes : [];

  renderAdmin();
  hideSpinner();
  showStatus("Admin dashboard loaded.");
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
