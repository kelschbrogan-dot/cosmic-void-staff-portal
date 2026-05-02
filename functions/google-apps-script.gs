const SHEET_ID = "1BkYdNFS5IknAeKVm3xbplJo_dXtGlPJGR9WQkqXcd2w";

const STAFF_TAB = "Staff";
const RATINGS_TAB = "Ratings";
const NOTES_TAB = "Notes";
const MESSAGES_TAB = "Messages";

function sheet(name) {
  return SpreadsheetApp.openById(SHEET_ID).getSheetByName(name);
}

function json(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function parse(e) {
  try {
    return JSON.parse(e.postData.contents);
  } catch (error) {
    return {};
  }
}

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

function setPlainTextValue(range, value) {
  range.setNumberFormat("@");
  range.setValue(String(value || ""));
}

function appendRowWithTextColumns(targetSheet, rowValues, textColumns) {
  targetSheet.appendRow(rowValues);
  const rowIndex = targetSheet.getLastRow();

  (textColumns || []).forEach(columnNumber => {
    if (!columnNumber) return;
    setPlainTextValue(targetSheet.getRange(rowIndex, columnNumber), rowValues[columnNumber - 1]);
  });

  return rowIndex;
}

function normalizeAdminRole(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!normalized) return "FALSE";
  if (normalized.includes("DEVELOPER")) return "DEVELOPER";
  if (normalized.includes("ADMINISTRATOR")) return "ADMINISTRATOR";
  if (normalized.includes("ADMIN")) return "TRUE";
  if (["TRUE", "YES", "1"].includes(normalized)) return "TRUE";
  return "FALSE";
}

function normalizeFeaturedEmoji(value) {
  return String(value || "").trim();
}

function ensureHeaderColumn(targetSheet, headers, headerName) {
  const existingIndex = headers.indexOf(headerName);
  if (existingIndex >= 0) return existingIndex;

  const nextIndex = headers.length;
  targetSheet.getRange(1, nextIndex + 1).setValue(headerName);
  headers.push(headerName);
  return nextIndex;
}

function getStaff() {
  const data = sheet(STAFF_TAB).getDataRange().getValues();
  const headers = data.shift();

  return data.map(row => {
    const obj = {};
    headers.forEach((header, index) => {
      obj[header] = row[index];
    });
    return obj;
  });
}

function getUser(id) {
  return getStaff().find(user => String(user.discordId) === String(id));
}

function getToken(d) {
  const user = getUser(d.discordId);

  if (!user) {
    return json({
      success: false,
      error: "USER_NOT_FOUND"
    });
  }

  return json({
    success: true,
    token: user.secretToken,
    isActive: isTrue(user.isActive),
    isWebAdmin: normalizeAdminRole(user.isWebAdmin),
    name: user.name,
    avatarURL: user.avatarURL
  });
}

function verifyUser(d) {
  const user = getUser(d.discordId);

  if (!user) {
    return json({ valid: false });
  }

  const ok =
    String(user.secretToken).trim() === String(d.token).trim() &&
    isTrue(user.isActive);

  return json({
    valid: ok,
    isWebAdmin: normalizeAdminRole(user.isWebAdmin)
  });
}

function getRatings(d) {
  const rows = sheet(RATINGS_TAB).getDataRange().getValues();
  const month = normalizeMonth(d.month);
  const out = [];

  for (let i = 1; i < rows.length; i += 1) {
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

function saveRatings(d) {
  const rows = sheet(RATINGS_TAB).getDataRange().getValues();
  const month = normalizeMonth(d.month);
  const reviewerId = normalizeId(d.reviewerId);

  (d.ratings || []).forEach(rating => {
    if (!rating.targetId) return;

    const targetId = normalizeId(rating.targetId);
    let found = false;

    for (let i = 1; i < rows.length; i += 1) {
      if (
        normalizeMonth(rows[i][0]) === month &&
        normalizeId(rows[i][1]) === reviewerId &&
        normalizeId(rows[i][2]) === targetId
      ) {
        sheet(RATINGS_TAB).getRange(i + 1, 4).setValue(rating.rating);
        sheet(RATINGS_TAB).getRange(i + 1, 5).setValue(rating.comment || "");
        found = true;
        break;
      }
    }

    if (!found) {
      appendRowWithTextColumns(sheet(RATINGS_TAB), [
        month,
        reviewerId,
        targetId,
        rating.rating,
        rating.comment || ""
      ], [1, 2, 3]);
    }
  });

  return json({ success: true });
}

function getNotes(d) {
  const rows = sheet(NOTES_TAB).getDataRange().getValues();
  const month = normalizeMonth(d.month);
  const targetId = normalizeId(d.targetId);
  const out = [];

  for (let i = 1; i < rows.length; i += 1) {
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

  appendRowWithTextColumns(sheet(NOTES_TAB), [
    month,
    reviewerId,
    targetId,
    type,
    note,
    updatedAt
  ], [1, 2, 3]);

  return json({ success: true });
}

function getMessages(d) {
  const rows = sheet(MESSAGES_TAB).getDataRange().getValues();
  const userId = normalizeId(d.userId);
  const out = [];

  for (let i = 1; i < rows.length; i += 1) {
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

    const isRecipient = message.recipientIds.includes(userId) || message.recipientIds.includes("ALL");
    if (isRecipient) {
      out.push(message);
    }
  }

  return json(out);
}

function sendMessage(d) {
  const senderId = normalizeId(d.senderId);
  const recipientIds = Array.isArray(d.recipientIds)
    ? d.recipientIds.map(id => normalizeId(id))
    : [normalizeId(d.recipientIds)];
  const subject = String(d.subject || "").trim();
  const message = String(d.message || "").trim();
  const isUrgent = isTrue(d.isUrgent);
  const sentAt = new Date();
  const messageId = generateRandomToken(16);

  if (!subject || !message) {
    return json({ success: false, error: "MISSING_FIELDS" });
  }

  appendRowWithTextColumns(sheet(MESSAGES_TAB), [
    messageId,
    senderId,
    recipientIds.join(","),
    subject,
    message,
    isUrgent,
    sentAt,
    ""
  ], [1, 2, 3, 8]);

  return json({ success: true, messageId });
}

function markMessageRead(d) {
  const messageId = String(d.messageId || "").trim();
  const userId = normalizeId(d.userId);

  if (!messageId || !userId) {
    return json({ success: false, error: "MISSING_FIELDS" });
  }

  const rows = sheet(MESSAGES_TAB).getDataRange().getValues();

  for (let i = 1; i < rows.length; i += 1) {
    if (String(rows[i][0]) === messageId) {
      const currentReadBy = String(rows[i][7] || "").split(",").map(id => normalizeId(id.trim())).filter(id => id);

      if (!currentReadBy.includes(userId)) {
        currentReadBy.push(userId);
        setPlainTextValue(sheet(MESSAGES_TAB).getRange(i + 1, 8), currentReadBy.join(","));
      }

      return json({ success: true });
    }
  }

  return json({ success: false, error: "MESSAGE_NOT_FOUND" });
}

function getAllMessages() {
  const rows = sheet(MESSAGES_TAB).getDataRange().getValues();
  const out = [];

  for (let i = 1; i < rows.length; i += 1) {
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

function getDashboard(d) {
  const staff = getStaff().filter(member => isTrue(member.isActive));
  const rows = sheet(RATINGS_TAB).getDataRange().getValues();
  const map = {};

  staff.forEach(member => {
    map[member.discordId] = {
      name: member.name,
      avatarURL: member.avatarURL,
      ratings: 0
    };
  });

  for (let i = 1; i < rows.length; i += 1) {
    if (normalizeMonth(rows[i][0]) === normalizeMonth(d.month) && map[rows[i][2]]) {
      map[rows[i][2]].ratings += 1;
    }
  }

  return json(Object.values(map));
}

function generateRandomToken(length = 32) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let token = "";
  for (let i = 0; i < length; i += 1) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

function addStaff(d) {
  if (!d.discordId || !d.name) {
    return json({ success: false, error: "MISSING_FIELDS" });
  }

  const newToken = generateRandomToken(32);
  const staffData = sheet(STAFF_TAB).getDataRange().getValues();

  for (let i = 1; i < staffData.length; i += 1) {
    if (normalizeId(staffData[i][0]) === normalizeId(d.discordId)) {
      return json({ success: false, error: "USER_EXISTS" });
    }
  }

  appendRowWithTextColumns(sheet(STAFF_TAB), [
    d.discordId,
    d.name,
    d.avatarURL || "",
    newToken,
    isTrue(d.isActive) ? true : false,
    normalizeAdminRole(d.isWebAdmin)
  ], [1, 4, 6]);

  return json({ success: true, newToken });
}

function updateStaff(d) {
  if (!d.discordId) {
    return json({ success: false, error: "MISSING_DISCORD_ID" });
  }

  const staffSheet = sheet(STAFF_TAB);
  const staffData = staffSheet.getDataRange().getValues();
  const headers = staffData[0];
  let found = false;

  for (let i = 1; i < staffData.length; i += 1) {
    if (normalizeId(staffData[i][0]) === normalizeId(d.discordId)) {
      const updates = d.updates || {};

      if (updates.name !== undefined) {
        const nameIdx = headers.indexOf("name");
        if (nameIdx >= 0) {
          staffSheet.getRange(i + 1, nameIdx + 1).setValue(updates.name);
        }
      }

      if (updates.avatarURL !== undefined) {
        const avatarIdx = headers.indexOf("avatarURL");
        if (avatarIdx >= 0) {
          staffSheet.getRange(i + 1, avatarIdx + 1).setValue(updates.avatarURL);
        }
      }

      if (updates.isActive !== undefined) {
        const activeIdx = headers.indexOf("isActive");
        if (activeIdx >= 0) {
          staffSheet.getRange(i + 1, activeIdx + 1).setValue(isTrue(updates.isActive) ? true : false);
        }
      }

      if (updates.isWebAdmin !== undefined) {
        const adminIdx = headers.indexOf("isWebAdmin");
        if (adminIdx >= 0) {
          setPlainTextValue(staffSheet.getRange(i + 1, adminIdx + 1), normalizeAdminRole(updates.isWebAdmin));
        }
      }

      if (updates.isFeatured !== undefined) {
        const featuredIdx = ensureHeaderColumn(staffSheet, headers, "isFeatured");
        staffSheet.getRange(i + 1, featuredIdx + 1).setValue(isTrue(updates.isFeatured) ? true : false);
      }

      if (updates.featuredEmoji !== undefined) {
        const featuredEmojiIdx = ensureHeaderColumn(staffSheet, headers, "featuredEmoji");
        setPlainTextValue(staffSheet.getRange(i + 1, featuredEmojiIdx + 1), normalizeFeaturedEmoji(updates.featuredEmoji));
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

  for (let i = 1; i < staffData.length; i += 1) {
    if (normalizeId(staffData[i][0]) === normalizeId(d.discordId)) {
      const tokenIdx = headers.indexOf("secretToken");
      if (tokenIdx >= 0) {
        setPlainTextValue(sheet(STAFF_TAB).getRange(i + 1, tokenIdx + 1), newToken);
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

function doPost(e) {
  const d = parse(e);

  switch (d.action) {
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
      return json({ error: "INVALID_ACTION" });
  }
}
