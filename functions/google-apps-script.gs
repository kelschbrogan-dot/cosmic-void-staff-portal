const SHEET_ID = "1BkYdNFS5IknAeKVm3xbplJo_dXtGlPJGR9WQkqXcd2w";

const STAFF_TAB = "Staff";
const RATINGS_TAB = "Ratings";
const NOTES_TAB = "Notes";
const MESSAGES_TAB = "Messages";

// ---------------- SHEET HELPERS ----------------

function sheet(name){
  return SpreadsheetApp.openById(SHEET_ID).getSheetByName(name);
}

function json(data){
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function parse(e){
  try {
    return JSON.parse(e.postData.contents);
  } catch {
    return {};
  }
}

// ---------------- NORMALIZERS ----------------

function normalizeMonth(value) {
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
  }
  return String(value || "").trim();
}

function normalizeId(value) {
  return String(value || "").trim();
}

function isTrue(value) {
  return value === true || String(value || "").trim().toLowerCase() === "true";
}

// ---------------- STAFF ----------------

function getStaff(){
  const data = sheet(STAFF_TAB).getDataRange().getValues();
  const headers = data.shift();

  return data.map(row=>{
    let obj={};
    headers.forEach((h,i)=>obj[h]=row[i]);
    return obj;
  });
}

function getUser(id){
  return getStaff().find(u=>String(u.discordId)===String(id));
}

// ---------------- 🔑 TOKEN ----------------

function getToken(d){
  const user = getUser(d.discordId);

  if(!user){
    return json({
      success:false,
      error:"USER_NOT_FOUND"
    });
  }

  return json({
    success:true,
    token: user.secretToken,
    isActive: isTrue(user.isActive),
    isWebAdmin: isTrue(user.isWebAdmin),
    name: user.name,
    avatarURL: user.avatarURL
  });
}

// ---------------- VERIFY ----------------

function verifyUser(d){
  const user = getUser(d.discordId);

  if(!user){
    return json({ valid:false });
  }

  const ok =
    String(user.secretToken).trim() === String(d.token).trim() &&
    isTrue(user.isActive);

  return json({
    valid: ok,
    isWebAdmin: isTrue(user.isWebAdmin)
  });
}

// ---------------- RATINGS ----------------

function getRatings(d){
  const rows = sheet(RATINGS_TAB).getDataRange().getValues();
  const month = normalizeMonth(d.month);

  let out = [];

  for (let i = 1; i < rows.length; i++) {
    if (normalizeMonth(rows[i][0]) === month) {
      out.push({
        month,
        reviewerId: normalizeId(rows[i][1]),
        targetId: normalizeId(rows[i][2]),
        rating: rows[i][3],
        comment: rows[i][4]
      });
    }
  }

  return json(out);
}

function saveRatings(d){
  const rows = sheet(RATINGS_TAB).getDataRange().getValues();

  const month = normalizeMonth(d.month);
  const reviewerId = normalizeId(d.reviewerId);

  (d.ratings || []).forEach(r => {
    if (!r.targetId) return;

    const targetId = normalizeId(r.targetId);
    let found = false;

    for (let i = 1; i < rows.length; i++) {
      if (
        normalizeMonth(rows[i][0]) === month &&
        normalizeId(rows[i][1]) === reviewerId &&
        normalizeId(rows[i][2]) === targetId
      ) {
        sheet(RATINGS_TAB).getRange(i + 1, 4).setValue(r.rating);
        sheet(RATINGS_TAB).getRange(i + 1, 5).setValue(r.comment || "");
        found = true;
        break;
      }
    }

    if (!found) {
      sheet(RATINGS_TAB).appendRow([
        month,
        reviewerId,
        targetId,
        r.rating,
        r.comment || ""
      ]);
    }
  });

  return json({ success: true });
}

// ---------------- NOTES ----------------

function getNotes(d) {
  const rows = sheet(NOTES_TAB).getDataRange().getValues();
  const month = normalizeMonth(d.month);
  const targetId = normalizeId(d.targetId);

  let out = [];

  for (let i = 1; i < rows.length; i++) {
    if (
      normalizeMonth(rows[i][0]) === month &&
      (!targetId || normalizeId(rows[i][2]) === targetId)
    ) {
      out.push({
        month,
        reviewerId: normalizeId(rows[i][1]),
        targetId: normalizeId(rows[i][2]),
        type: String(rows[i][3] || "Positive").trim() || "Positive",
        note: rows[i][4],
        updatedAt: rows[i][5]
      });
    }
  }

  return json(out);
}

function saveNotes(d) {
  const month = normalizeMonth(d.month);
  const reviewerId = normalizeId(d.reviewerId);
  const targetId = normalizeId(d.targetId);
  const type = String(d.type || "Positive").trim() || "Positive";
  const note = String(d.note || "").trim();
  const updatedAt = new Date();

  sheet(NOTES_TAB).appendRow([
    month,
    reviewerId,
    targetId,
    type,
    note,
    updatedAt
  ]);

  return json({ success: true });
}

// ---------------- MESSAGES ----------------

function getMessages(d) {
  const rows = sheet(MESSAGES_TAB).getDataRange().getValues();
  const userId = normalizeId(d.userId);

  let out = [];

  for (let i = 1; i < rows.length; i++) {
    const message = {
      id: rows[i][0],
      senderId: normalizeId(rows[i][1]),
      recipientIds: String(rows[i][2] || "").split(",").map(id => normalizeId(id.trim())).filter(id => id),
      subject: rows[i][3] || "",
      message: rows[i][4] || "",
      isUrgent: isTrue(rows[i][5]),
      sentAt: rows[i][6],
      readBy: String(rows[i][7] || "").split(",").map(id => normalizeId(id.trim())).filter(id => id)
    };

    // Include messages where user is recipient or it's sent to all staff
    const isRecipient = message.recipientIds.includes(userId) || message.recipientIds.includes("ALL");
    if (isRecipient) {
      out.push(message);
    }
  }

  return json(out);
}

function sendMessage(d) {
  const senderId = normalizeId(d.senderId);
  const recipientIds = Array.isArray(d.recipientIds) ? d.recipientIds.map(id => normalizeId(id)) : [normalizeId(d.recipientIds)];
  const subject = String(d.subject || "").trim();
  const message = String(d.message || "").trim();
  const isUrgent = isTrue(d.isUrgent);
  const sentAt = new Date();
  const messageId = generateRandomToken(16); // Generate unique message ID

  if (!subject || !message) {
    return json({ success: false, error: "MISSING_FIELDS" });
  }

  sheet(MESSAGES_TAB).appendRow([
    messageId,
    senderId,
    recipientIds.join(","),
    subject,
    message,
    isUrgent,
    sentAt,
    "" // readBy starts empty
  ]);

  return json({ success: true, messageId });
}

function markMessageRead(d) {
  const messageId = String(d.messageId || "").trim();
  const userId = normalizeId(d.userId);

  if (!messageId || !userId) {
    return json({ success: false, error: "MISSING_FIELDS" });
  }

  const rows = sheet(MESSAGES_TAB).getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === messageId) {
      const currentReadBy = String(rows[i][7] || "").split(",").map(id => normalizeId(id.trim())).filter(id => id);
      
      if (!currentReadBy.includes(userId)) {
        currentReadBy.push(userId);
        sheet(MESSAGES_TAB).getRange(i + 1, 8).setValue(currentReadBy.join(","));
      }
      
      return json({ success: true });
    }
  }

  return json({ success: false, error: "MESSAGE_NOT_FOUND" });
}

function getAllMessages(d) {
  const rows = sheet(MESSAGES_TAB).getDataRange().getValues();

  let out = [];

  for (let i = 1; i < rows.length; i++) {
    out.push({
      id: rows[i][0],
      senderId: normalizeId(rows[i][1]),
      recipientIds: String(rows[i][2] || "").split(",").map(id => normalizeId(id.trim())).filter(id => id),
      subject: rows[i][3] || "",
      message: rows[i][4] || "",
      isUrgent: isTrue(rows[i][5]),
      sentAt: rows[i][6],
      readBy: String(rows[i][7] || "").split(",").map(id => normalizeId(id.trim())).filter(id => id)
    });
  }

  return json(out);
}

// ---------------- DASHBOARD ----------------

function getDashboard(d){
  const staff = getStaff().filter(s=>isTrue(s.isActive));
  const rows = sheet(RATINGS_TAB).getDataRange().getValues();

  let map = {};

  staff.forEach(s=>{
    map[s.discordId] = {
      name: s.name,
      avatarURL: s.avatarURL,
      ratings: 0
    };
  });

  for(let i=1;i<rows.length;i++){
    if(normalizeMonth(rows[i][0]) === normalizeMonth(d.month)){
      if(map[rows[i][2]]){
        map[rows[i][2]].ratings++;
      }
    }
  }

  return json(Object.values(map));
}

// ---------------- TOKEN GENERATION ----------------

function generateRandomToken(length = 32) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let token = "";
  for (let i = 0; i < length; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

// ---------------- ADMIN FUNCTIONS ----------------

function addStaff(d) {
  if (!d.discordId || !d.name) {
    return json({ success: false, error: "MISSING_FIELDS" });
  }

  const newToken = generateRandomToken(32);
  const staffData = sheet(STAFF_TAB).getDataRange().getValues();
  
  // Check if user already exists
  for (let i = 1; i < staffData.length; i++) {
    if (normalizeId(staffData[i][0]) === normalizeId(d.discordId)) {
      return json({ success: false, error: "USER_EXISTS" });
    }
  }

  sheet(STAFF_TAB).appendRow([
    d.discordId,
    d.name,
    d.avatarURL || "",
    newToken,
    isTrue(d.isActive) ? true : false,
    isTrue(d.isWebAdmin) ? true : false
  ]);

  return json({ success: true, newToken });
}

function updateStaff(d) {
  if (!d.discordId) {
    return json({ success: false, error: "MISSING_DISCORD_ID" });
  }

  const staffData = sheet(STAFF_TAB).getDataRange().getValues();
  const headers = staffData[0];
  let found = false;

  for (let i = 1; i < staffData.length; i++) {
    if (normalizeId(staffData[i][0]) === normalizeId(d.discordId)) {
      const updates = d.updates || {};

      // Update name
      if (updates.name !== undefined) {
        const nameIdx = headers.indexOf("name");
        if (nameIdx >= 0) {
          sheet(STAFF_TAB).getRange(i + 1, nameIdx + 1).setValue(updates.name);
        }
      }

      // Update avatarURL
      if (updates.avatarURL !== undefined) {
        const avatarIdx = headers.indexOf("avatarURL");
        if (avatarIdx >= 0) {
          sheet(STAFF_TAB).getRange(i + 1, avatarIdx + 1).setValue(updates.avatarURL);
        }
      }

      // Update isActive
      if (updates.isActive !== undefined) {
        const activeIdx = headers.indexOf("isActive");
        if (activeIdx >= 0) {
          sheet(STAFF_TAB).getRange(i + 1, activeIdx + 1).setValue(isTrue(updates.isActive) ? true : false);
        }
      }

      // Update isWebAdmin
      if (updates.isWebAdmin !== undefined) {
        const adminIdx = headers.indexOf("isWebAdmin");
        if (adminIdx >= 0) {
          sheet(STAFF_TAB).getRange(i + 1, adminIdx + 1).setValue(isTrue(updates.isWebAdmin) ? true : false);
        }
      }

      found = true;
      break;
    }
  }

  return json({ success: found, error: found ? null : "USER_NOT_FOUND" });
}

function resetStaffToken(d) {
  if (!d.discordId) {
    return json({ success: false, error: "MISSING_DISCORD_ID" });
  }

  const newToken = generateRandomToken(32);
  const staffData = sheet(STAFF_TAB).getDataRange().getValues();
  const headers = staffData[0];
  let found = false;

  for (let i = 1; i < staffData.length; i++) {
    if (normalizeId(staffData[i][0]) === normalizeId(d.discordId)) {
      const tokenIdx = headers.indexOf("secretToken");
      if (tokenIdx >= 0) {
        sheet(STAFF_TAB).getRange(i + 1, tokenIdx + 1).setValue(newToken);
        found = true;
      }
      break;
    }
  }

  return json({ success: found, newToken, error: found ? null : "USER_NOT_FOUND" });
}

function setMaintenance(d) {
  const scriptProperties = PropertiesService.getScriptProperties();
  scriptProperties.setProperty("MAINTENANCE_MODE", isTrue(d.enabled) ? "true" : "false");
  return json({ success: true });
}

function getMaintenanceMode() {
  const scriptProperties = PropertiesService.getScriptProperties();
  const mode = scriptProperties.getProperty("MAINTENANCE_MODE") || "false";
  return json({ maintenance: isTrue(mode) });
}

// ---------------- ROUTER ----------------

function doPost(e){
  const d = parse(e);

  switch(d.action){

    case "getStaff":
      return json(getStaff());

    case "getToken":
      return getToken(d);

    case "verifyUser":
      return verifyUser(d);

    case "getRatings":
      return getRatings(d);

    case "saveRatings":
      return saveRatings(d);

    case "getNotes":
      return getNotes(d);

    case "saveNotes":
      return saveNotes(d);

    case "getMessages":
      return getMessages(d);

    case "sendMessage":
      return sendMessage(d);

    case "markMessageRead":
      return markMessageRead(d);

    case "getAllMessages":
      return getAllMessages(d);

    case "getDashboard":
      return getDashboard(d);

    case "addStaff":
      return addStaff(d);

    case "updateStaff":
      return updateStaff(d);

    case "resetStaffToken":
      return resetStaffToken(d);

    case "setMaintenance":
      return setMaintenance(d);

    case "getMaintenanceMode":
      return getMaintenanceMode(d);

    default:
      return json({ error:"INVALID_ACTION" });
  }
}
