const SHEET_ID = "1BkYdNFS5IknAeKVm3xbplJo_dXtGlPJGR9WQkqXcd2w";

const STAFF_TAB = "Staff";
const RATINGS_TAB = "Ratings";
const NOTES_TAB = "Notes";
const MESSAGES_TAB = "Messages";
const LOAS_TAB = "LOAs";
const SESSION_LOG_TAB = "SessionLogs";
const QUOTA_TAB = "QuotaRecords";
const STRIKES_TAB = "Strikes";
const DEFAULT_API_KEY = "cosmic-void-api-key-v1";

function sheet(name) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let target = ss.getSheetByName(name);
  if (!target) {
    target = ss.insertSheet(name);
  }
  return target;
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

function getApiKey() {
  const props = PropertiesService.getScriptProperties();
  return String(props.getProperty("API_KEY") || DEFAULT_API_KEY).trim();
}

function getRequestApiKey(e, d) {
  let key = "";
  if (e && e.headers) {
    key = String(e.headers["x-api-key"] || e.headers["X-API-Key"] || e.headers["X-API-KEY"] || "").trim();
  }
  if (!key && d && d.apiKey) {
    key = String(d.apiKey).trim();
  }
  return key;
}

function requireApiKey(e, d) {
  return getRequestApiKey(e, d) === getApiKey();
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

function parseDateForSheet(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function extractMentionedIds(text) {
  const raw = String(text || "");
  const mentions = [];
  const mentionRegex = /<@!?([0-9]+)>/g;
  let match;
  while ((match = mentionRegex.exec(raw)) !== null) {
    mentions.push(match[1]);
  }
  return mentions;
}

function uniqueIds(ids) {
  const list = Array.isArray(ids) ? ids : String(ids || "").split(",");
  return [...new Set(list.map(id => String(id || "").trim()).filter(Boolean))];
}

function parseSessionPayload(raw, discordId) {
  const normalizedDiscordId = normalizeId(discordId);
  const hostIds = extractMentionedIds(raw);
  let hostId = normalizedDiscordId || (hostIds.length ? hostIds[0] : "");
  const cohostLine = raw.match(/co-?host[s]?\s*[:\-]\s*([^\n\r]*)/i);
  const cohostIds = cohostLine ? extractMentionedIds(cohostLine[1]) : [];
  const notesMatch = raw.match(/notes\s*[:\-]\s*([\s\S]*)/i);
  const notes = notesMatch ? String(notesMatch[1] || "").trim() : "";
  return {
    hostId,
    cohostIds: uniqueIds(cohostIds),
    notes,
    parsedOk: !!hostId
  };
}

function getSheetRows(sheetName) {
  const rows = sheet(sheetName).getDataRange().getValues();
  const headers = rows.shift();
  return rows.map(row => {
    const obj = {};
    headers.forEach((header, index) => {
      obj[header] = row[index];
    });
    return obj;
  });
}

function getLOAs(d) {
  const rows = sheet(LOAS_TAB).getDataRange().getValues();
  const headers = rows.shift();
  const out = [];

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const item = {};
    headers.forEach((header, idx) => {
      item[header] = row[idx];
    });
    item.status = String(item.status || "Pending").trim();
    item.meetsSessionQuota = isTrue(item.meetsSessionQuota);
    item.meetsMessageQuota = isTrue(item.meetsMessageQuota);
    item.excused = isTrue(item.excused);
    item.deleted = isTrue(item.deleted);
    out.push(item);
  }

  if (d.userId) {
    return json(out.filter(item => String(item.discordId).trim() === String(d.userId).trim() && !item.deleted));
  }

  return json(out.filter(item => !item.deleted));
}

function getOverlappingLoas(allLoas, startDate, endDate, discordId, currentId) {
  return allLoas.filter(loa =>
    String(loa.discordId).trim() === String(discordId).trim() &&
    !isTrue(loa.deleted) &&
    String(loa.loaId).trim() !== String(currentId || "").trim() &&
    loa.startDate && loa.endDate &&
    new Date(loa.startDate).getTime() <= new Date(endDate).getTime() &&
    new Date(loa.endDate).getTime() >= new Date(startDate).getTime()
  );
}

function mergeLoaRange(existing, newRange) {
  const ranges = existing.map(item => ({
    start: new Date(item.startDate).getTime(),
    end: new Date(item.endDate).getTime()
  }));
  ranges.push({ start: new Date(newRange.startDate).getTime(), end: new Date(newRange.endDate).getTime() });
  ranges.sort((a, b) => a.start - b.start);
  const merged = [];

  ranges.forEach(range => {
    if (!merged.length || range.start > merged[merged.length - 1].end) {
      merged.push({ ...range });
    } else {
      merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, range.end);
    }
  });

  return merged[0] ? {
    startDate: new Date(merged[0].start).toISOString().slice(0, 10),
    endDate: new Date(merged[0].end).toISOString().slice(0, 10)
  } : null;
}

function saveLOA(d) {
  if (!d.discordId || !d.startDate || !d.endDate || !d.notes) {
    return json({ success: false, error: "MISSING_FIELDS" });
  }

  const discordId = normalizeId(d.discordId);
  const startDate = parseDateForSheet(d.startDate);
  const endDate = parseDateForSheet(d.endDate);
  if (!startDate || !endDate) {
    return json({ success: false, error: "INVALID_DATE" });
  }

  const now = new Date();
  const start = new Date(startDate);
  if (start.getTime() < now.getTime() + 48 * 60 * 60 * 1000) {
    return json({ success: false, error: "START_TOO_SOON" });
  }

  const meetsSessionQuota = isTrue(d.meetsSessionQuota);
  const meetsMessageQuota = isTrue(d.meetsMessageQuota);
  const status = meetsSessionQuota && meetsMessageQuota ? "Auto-Approved" : "Pending";
  const excused = status === "Approved" && (!meetsSessionQuota || !meetsMessageQuota);

  const existingItems = getSheetRows(LOAS_TAB)
    .map(item => ({
      ...item,
      meetsSessionQuota: isTrue(item.meetsSessionQuota),
      meetsMessageQuota: isTrue(item.meetsMessageQuota),
      excused: isTrue(item.excused),
      deleted: isTrue(item.deleted)
    }))
    .filter(item => String(item.discordId).trim() === discordId && !item.deleted);

  const overlapping = getOverlappingLoas(existingItems, startDate, endDate, discordId, d.loaId);
  if (d.loaId) {
    const currentItem = existingItems.find(item => String(item.loaId).trim() === String(d.loaId).trim());
    if (currentItem && !overlapping.some(item => String(item.loaId).trim() === String(currentItem.loaId).trim())) {
      overlapping.push(currentItem);
    }
  }
  const mergedRange = overlapping.length
    ? mergeLoaRange(overlapping, { startDate, endDate })
    : { startDate: startDate.slice(0, 10), endDate: endDate.slice(0, 10) };
  const mergedId = d.loaId || `loa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = now.toISOString();
  const updatedAt = now.toISOString();

  // Expire overlapping entries
  if (overlapping.length) {
    const rawRows = sheet(LOAS_TAB).getDataRange().getValues();
    const existingHeaders = rawRows[0];
    const idIndex = existingHeaders.indexOf("loaId");
    const statusIndex = existingHeaders.indexOf("status");
    const deletedIndex = existingHeaders.indexOf("deleted");
    const updatedAtIndex = existingHeaders.indexOf("updatedAt");

    for (let i = 1; i < rawRows.length; i += 1) {
      if (idIndex >= 0 && overlapping.some(existing => String(existing.loaId).trim() === String(rawRows[i][idIndex]).trim())) {
        if (statusIndex >= 0) sheet(LOAS_TAB).getRange(i + 1, statusIndex + 1).setValue("Expired");
        if (deletedIndex >= 0) sheet(LOAS_TAB).getRange(i + 1, deletedIndex + 1).setValue(true);
        if (updatedAtIndex >= 0) sheet(LOAS_TAB).getRange(i + 1, updatedAtIndex + 1).setValue(updatedAt);
      }
    }
  }

  const loaRow = [
    normalizeMonth(startDate),
    mergedId,
    discordId,
    mergedRange.startDate,
    mergedRange.endDate,
    String(d.notes || "").trim(),
    meetsSessionQuota,
    meetsMessageQuota,
    status,
    String(d.statusReason || "").trim(),
    String(d.adminId || "").trim(),
    updatedAt,
    createdAt,
    excused,
    overlapping.map(item => item.loaId).join(","),
    false
  ];

  const targetSheet = sheet(LOAS_TAB);
  const headersRow = targetSheet.getDataRange().getValues()[0] || [];
  const columns = [
    "month",
    "loaId",
    "discordId",
    "startDate",
    "endDate",
    "notes",
    "meetsSessionQuota",
    "meetsMessageQuota",
    "status",
    "statusReason",
    "statusUpdatedBy",
    "updatedAt",
    "createdAt",
    "excused",
    "mergedFrom",
    "deleted"
  ];

  headersRow.forEach((header, idx) => {
    if (!columns.includes(header)) return;
  });

  columns.forEach((header, idx) => {
    ensureHeaderColumn(targetSheet, headersRow, header);
  });

  appendRowWithTextColumns(targetSheet, loaRow, [2, 3, 4, 5, 8, 11, 12, 14, 15]);

  return json({ success: true, loaId: mergedId });
}

function setLOAStatus(d) {
  if (!d.loaId || !d.status) {
    return json({ success: false, error: "MISSING_FIELDS" });
  }

  const rawRows = sheet(LOAS_TAB).getDataRange().getValues();
  const headers = rawRows[0] || [];
  const idIndex = headers.indexOf("loaId");
  const statusIndex = headers.indexOf("status");
  const reasonIndex = headers.indexOf("statusReason");
  const adminIndex = headers.indexOf("statusUpdatedBy");
  const updatedAtIndex = headers.indexOf("updatedAt");
  const excusedIndex = headers.indexOf("excused");

  let found = false;
  for (let i = 1; i < rawRows.length; i += 1) {
    if (String(rawRows[i][idIndex]).trim() === String(d.loaId).trim()) {
      found = true;
      if (statusIndex >= 0) sheet(LOAS_TAB).getRange(i + 1, statusIndex + 1).setValue(String(d.status).trim());
      if (reasonIndex >= 0) sheet(LOAS_TAB).getRange(i + 1, reasonIndex + 1).setValue(String(d.statusReason || "").trim());
      if (adminIndex >= 0) sheet(LOAS_TAB).getRange(i + 1, adminIndex + 1).setValue(String(d.adminId || "").trim());
      if (updatedAtIndex >= 0) sheet(LOAS_TAB).getRange(i + 1, updatedAtIndex + 1).setValue(new Date());
      if (excusedIndex >= 0) {
        const currentRow = rawRows[i];
        const meetsSession = isTrue(currentRow[headers.indexOf("meetsSessionQuota")]);
        const meetsMessage = isTrue(currentRow[headers.indexOf("meetsMessageQuota")]);
        const shouldExcuse = String(d.status).trim() === "Approved" && (!meetsSession || !meetsMessage);
        sheet(LOAS_TAB).getRange(i + 1, excusedIndex + 1).setValue(shouldExcuse);
      }
      break;
    }
  }

  return json({ success: found, error: found ? null : "LOA_NOT_FOUND" });
}

function getQuotaRecords(d) {
  const rows = sheet(QUOTA_TAB).getDataRange().getValues();
  const headers = rows.shift();
  const out = [];

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const record = {};
    headers.forEach((header, idx) => {
      record[header] = row[idx];
    });
    record.sessions = Number(record.sessions || 0);
    record.messages = Number(record.messages || 0);
    record.ptoUsed = Number(record.ptoUsed || 0);
    record.excused = isTrue(record.excused);
    record.completed = isTrue(record.completed);
    out.push(record);
  }

  return json(out.filter(record => {
    if (d.userId && String(record.discordId).trim() !== String(d.userId).trim()) return false;
    if (d.month && normalizeMonth(record.month) !== normalizeMonth(d.month)) return false;
    return true;
  }));
}

function saveQuotaRecord(d) {
  if (!d.discordId || !d.month) {
    return json({ success: false, error: "MISSING_FIELDS" });
  }

  const normalizedMonth = normalizeMonth(d.month);
  const discordId = normalizeId(d.discordId);
  const targetSheet = sheet(QUOTA_TAB);
  const rows = targetSheet.getDataRange().getValues();
  const headers = rows.shift();
  let updated = false;
  let rowIndex = -1;

  for (let i = 0; i < rows.length; i += 1) {
    if (normalizeMonth(rows[i][headers.indexOf("month")]) === normalizedMonth && normalizeId(rows[i][headers.indexOf("discordId")]) === discordId) {
      rowIndex = i + 2;
      updated = true;
      break;
    }
  }

  const changes = {
    sessions: Number(d.sessions || 0),
    messages: Number(d.messages || 0),
    ptoUsed: Number(d.ptoUsed || 0),
    excused: isTrue(d.excused),
    completed: isTrue(d.completed),
    notes: String(d.notes || "").trim(),
    updatedAt: new Date()
  };

  const columnMap = headers.reduce((map, header, idx) => {
    map[String(header).trim()] = idx + 1;
    return map;
  }, {});

  const requiredColumns = ["month", "discordId", "sessions", "messages", "ptoUsed", "excused", "completed", "notes", "updatedAt"];
  requiredColumns.forEach(column => ensureHeaderColumn(targetSheet, headers, column));

  if (!updated) {
    appendRowWithTextColumns(targetSheet, [normalizedMonth, discordId, changes.sessions, changes.messages, changes.ptoUsed, changes.excused, changes.completed, changes.notes, changes.updatedAt], [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    return json({ success: true, created: true });
  }

  Object.entries(changes).forEach(([key, value]) => {
    const column = columnMap[key];
    if (column) {
      setPlainTextValue(targetSheet.getRange(rowIndex, column), value);
    }
  });

  return json({ success: true, updated: true });
}

function getSessions(d) {
  const rows = sheet(SESSION_LOG_TAB).getDataRange().getValues();
  const headers = rows.shift();
  const out = [];

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const session = {};
    headers.forEach((header, idx) => {
      session[header] = row[idx];
    });
    session.cohostIds = String(session.cohostIds || "").split(",").map(id => normalizeId(id.trim())).filter(Boolean);
    session.parsedOk = isTrue(session.parsedOk);
    session.deleted = isTrue(session.deleted);
    out.push(session);
  }

  return json(out.filter(session => {
    if (d.userId && String(session.hostId).trim() !== String(d.userId).trim() && !session.cohostIds.includes(String(d.userId).trim())) return false;
    if (d.month && normalizeMonth(session.month) !== normalizeMonth(d.month)) return false;
    if (session.deleted) return false;
    return true;
  }));
}

function saveSession(d) {
  const now = new Date();
  if (!d.fullMessage && !d.message) {
    return json({ success: false, error: "MISSING_FIELDS" });
  }

  const raw = String(d.fullMessage || d.message || "").trim();
  const sessionData = parseSessionPayload(raw, d.discordId);
  const month = normalizeMonth(new Date());
  const sessionId = d.sessionId || `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  appendRowWithTextColumns(sheet(SESSION_LOG_TAB), [month, sessionId, raw, normalizeId(d.discordId), sessionData.hostId, sessionData.cohostIds.join(","), sessionData.notes, sessionData.parsedOk, now, false], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

  const participants = uniqueIds([sessionData.hostId, ...sessionData.cohostIds]);
  participants.forEach(participant => {
    if (!participant) return;
    const quotaRows = sheet(QUOTA_TAB).getDataRange().getValues();
    const headers = quotaRows[0] || [];
    let rowIndex = -1;

    for (let i = 1; i < quotaRows.length; i += 1) {
      if (normalizeMonth(quotaRows[i][headers.indexOf("month")]) === month && normalizeId(quotaRows[i][headers.indexOf("discordId")]) === participant) {
        rowIndex = i + 1;
        break;
      }
    }

    if (rowIndex < 0) {
      appendRowWithTextColumns(sheet(QUOTA_TAB), [month, participant, 1, 0, 0, false, false, "", now], [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    } else {
      const sessionsIndex = headers.indexOf("sessions");
      const currentSessions = Number(quotaRows[rowIndex - 1][sessionsIndex] || 0) + 1;
      setPlainTextValue(sheet(QUOTA_TAB).getRange(rowIndex, sessionsIndex + 1), currentSessions);
      const updatedAtIndex = headers.indexOf("updatedAt");
      if (updatedAtIndex >= 0) {
        setPlainTextValue(sheet(QUOTA_TAB).getRange(rowIndex, updatedAtIndex + 1), now);
      }
    }
  });

  return json({ success: true, sessionId, parsedOk });
}

function deleteSession(d) {
  if (!d.sessionId) {
    return json({ success: false, error: "MISSING_FIELDS" });
  }

  const rows = sheet(SESSION_LOG_TAB).getDataRange().getValues();
  const headers = rows.shift();
  const idIndex = headers.indexOf("sessionId");
  const deletedIndex = ensureHeaderColumn(sheet(SESSION_LOG_TAB), headers, "deleted");
  let found = false;

  for (let i = 1; i < rows.length; i += 1) {
    if (String(rows[i][idIndex]).trim() === String(d.sessionId).trim()) {
      sheet(SESSION_LOG_TAB).getRange(i + 1, deletedIndex + 1).setValue(true);
      found = true;
      break;
    }
  }

  return json({ success: found, error: found ? null : "SESSION_NOT_FOUND" });
}

function getStrikes(d) {
  const rows = sheet(STRIKES_TAB).getDataRange().getValues();
  const headers = rows.shift();
  const out = [];

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const strike = {};
    headers.forEach((header, idx) => {
      strike[header] = row[idx];
    });
    strike.active = isTrue(strike.active);
    strike.expired = isTrue(strike.expired);
    strike.blockHeld = isTrue(strike.blockHeld);
    out.push(strike);
  }

  return json(out.filter(strike => {
    if (d.userId && String(strike.discordId).trim() !== String(d.userId).trim()) return false;
    return true;
  }));
}

function saveStrike(d) {
  if (!d.discordId || !d.reason || !d.issuedBy) {
    return json({ success: false, error: "MISSING_FIELDS" });
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString();
  const strikeId = d.strikeId || `strike-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const targetSheet = sheet(STRIKES_TAB);
  const rows = targetSheet.getDataRange().getValues();
  const headers = rows.shift();
  let found = false;
  let rowIndex = -1;

  for (let i = 0; i < rows.length; i += 1) {
    if (String(rows[i][headers.indexOf("strikeId")]).trim() === String(strikeId).trim()) {
      found = true;
      rowIndex = i + 2;
      break;
    }
  }

  const values = [
    normalizeMonth(now),
    strikeId,
    normalizeId(d.discordId),
    String(d.reason).trim(),
    String(d.issuedBy).trim(),
    now.toISOString(),
    expiresAt,
    false,
    "",
    true,
    false
  ];
  const columns = ["month", "strikeId", "discordId", "reason", "issuedBy", "issuedAt", "expiresAt", "expired", "expiredAt", "active", "blockHeld"];

  columns.forEach(header => ensureHeaderColumn(targetSheet, headers, header));

  if (!found) {
    appendRowWithTextColumns(targetSheet, values, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    rowIndex = targetSheet.getLastRow();
  } else {
    columns.forEach((header, idx) => {
      setPlainTextValue(targetSheet.getRange(rowIndex, headers.indexOf(header) + 1), values[idx]);
    });
  }

  const activeCount = getSheetRows(STRIKES_TAB).filter(strike =>
    normalizeId(strike.discordId) === normalizeId(d.discordId) && isTrue(strike.active)
  ).length;
  const blockHeldIndex = ensureHeaderColumn(targetSheet, headers, "blockHeld");
  if (activeCount >= 3) {
    setPlainTextValue(targetSheet.getRange(rowIndex, blockHeldIndex + 1), true);
  }

  return json({ success: true, strikeId });
}

function expireStrike(d) {
  if (!d.strikeId || !d.adminId) {
    return json({ success: false, error: "MISSING_FIELDS" });
  }

  const rows = sheet(STRIKES_TAB).getDataRange().getValues();
  const headers = rows.shift();
  const idIndex = headers.indexOf("strikeId");
  const expiredIndex = ensureHeaderColumn(sheet(STRIKES_TAB), headers, "expired");
  const expiredAtIndex = ensureHeaderColumn(sheet(STRIKES_TAB), headers, "expiredAt");
  const activeIndex = ensureHeaderColumn(sheet(STRIKES_TAB), headers, "active");
  const adminIndex = ensureHeaderColumn(sheet(STRIKES_TAB), headers, "expiredBy");
  let found = false;

  let expiredUserId = "";
  for (let i = 1; i < rows.length; i += 1) {
    if (String(rows[i][idIndex]).trim() === String(d.strikeId).trim()) {
      sheet(STRIKES_TAB).getRange(i + 1, expiredIndex + 1).setValue(true);
      sheet(STRIKES_TAB).getRange(i + 1, expiredAtIndex + 1).setValue(new Date());
      sheet(STRIKES_TAB).getRange(i + 1, activeIndex + 1).setValue(false);
      sheet(STRIKES_TAB).getRange(i + 1, adminIndex + 1).setValue(String(d.adminId).trim());
      expiredUserId = String(rows[i][headers.indexOf("discordId")]).trim();
      found = true;
      break;
    }
  }

  if (found && expiredUserId) {
    const strikeRows = sheet(STRIKES_TAB).getDataRange().getValues();
    const strikeHeaders = strikeRows[0] || [];
    const discordIdIndex = strikeHeaders.indexOf("discordId");
    const blockHeldIndex = ensureHeaderColumn(sheet(STRIKES_TAB), strikeHeaders, "blockHeld");
    const activeCount = strikeRows.slice(1).reduce((count, row) => {
      if (normalizeId(row[discordIdIndex]) !== expiredUserId) return count;
      if (isTrue(row[strikeHeaders.indexOf("active")])) return count + 1;
      return count;
    }, 0);

    if (activeCount < 3) {
      for (let i = 1; i < strikeRows.length; i += 1) {
        if (normalizeId(strikeRows[i][discordIdIndex]) !== expiredUserId) continue;
        sheet(STRIKES_TAB).getRange(i + 1, blockHeldIndex + 1).setValue(false);
      }
    }
  }

  return json({ success: found, error: found ? null : "STRIKE_NOT_FOUND" });
}

function autoExpireStrikes() {
  const rows = sheet(STRIKES_TAB).getDataRange().getValues();
  const headers = rows.shift();
  const expiresAtIndex = headers.indexOf("expiresAt");
  const expiredIndex = ensureHeaderColumn(sheet(STRIKES_TAB), headers, "expired");
  const activeIndex = ensureHeaderColumn(sheet(STRIKES_TAB), headers, "active");
  const now = new Date();

  for (let i = 1; i < rows.length; i += 1) {
    const expiresAt = new Date(rows[i][expiresAtIndex]);
    if (expiresAt && expiresAt.getTime() <= now.getTime() && !isTrue(rows[i][expiredIndex])) {
      sheet(STRIKES_TAB).getRange(i + 1, expiredIndex + 1).setValue(true);
      sheet(STRIKES_TAB).getRange(i + 1, activeIndex + 1).setValue(false);
    }
  }
}

function logMessage(d) {
  if (!d.discordId) {
    return json({ success: false, error: "MISSING_FIELDS" });
  }

  const discordId = normalizeId(d.discordId);
  const month = normalizeMonth(new Date());
  const targetSheet = sheet(QUOTA_TAB);
  const rows = targetSheet.getDataRange().getValues();
  const headers = rows.shift();
  const monthIndex = headers.indexOf("month");
  const discordIndex = headers.indexOf("discordId");
  const messagesIndex = ensureHeaderColumn(targetSheet, headers, "messages");
  const updatedAtIndex = ensureHeaderColumn(targetSheet, headers, "updatedAt");
  let foundIndex = -1;

  for (let i = 0; i < rows.length; i += 1) {
    if (normalizeMonth(rows[i][monthIndex]) === month && normalizeId(rows[i][discordIndex]) === discordId) {
      foundIndex = i + 2;
      break;
    }
  }

  if (foundIndex < 0) {
    appendRowWithTextColumns(targetSheet, [month, discordId, 0, 1, 0, false, false, "", new Date()], [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    return json({ success: true, month, discordId, messages: 1 });
  }

  const currentMessages = Number(rows[foundIndex - 2][messagesIndex] || 0) + 1;
  setPlainTextValue(targetSheet.getRange(foundIndex, messagesIndex + 1), currentMessages);
  setPlainTextValue(targetSheet.getRange(foundIndex, updatedAtIndex + 1), new Date());

  return json({ success: true, month, discordId, messages: currentMessages });
}

function logSession(d) {
  if (!d.message) {
    return json({ success: false, error: "MISSING_FIELDS" });
  }

  const raw = String(d.message || "").trim();
  const sessionData = parseSessionPayload(raw, d.discordId);
  const month = normalizeMonth(new Date());
  const sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  appendRowWithTextColumns(sheet(SESSION_LOG_TAB), [month, sessionId, raw, normalizeId(d.discordId), sessionData.hostId, sessionData.cohostIds.join(","), sessionData.notes, sessionData.parsedOk, new Date(), false], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

  const participants = uniqueIds([sessionData.hostId, ...sessionData.cohostIds]);
  participants.forEach(participant => {
    if (!participant) return;
    const quotaRows = sheet(QUOTA_TAB).getDataRange().getValues();
    const quotaHeaders = quotaRows.shift();
    let quotaRowIndex = -1;
    const monthIndex = quotaHeaders.indexOf("month");
    const discordIndex = quotaHeaders.indexOf("discordId");
    const sessionsIndex = ensureHeaderColumn(sheet(QUOTA_TAB), quotaHeaders, "sessions");
    const updatedAtIndex = ensureHeaderColumn(sheet(QUOTA_TAB), quotaHeaders, "updatedAt");

    for (let i = 0; i < quotaRows.length; i += 1) {
      if (normalizeMonth(quotaRows[i][monthIndex]) === month && normalizeId(quotaRows[i][discordIndex]) === participant) {
        quotaRowIndex = i + 2;
        break;
      }
    }

    if (quotaRowIndex < 0) {
      appendRowWithTextColumns(sheet(QUOTA_TAB), [month, participant, 1, 0, 0, false, false, "", new Date()], [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    } else {
      const currentSessions = Number(quotaRows[quotaRowIndex - 2][sessionsIndex] || 0) + 1;
      setPlainTextValue(sheet(QUOTA_TAB).getRange(quotaRowIndex, sessionsIndex + 1), currentSessions);
      setPlainTextValue(sheet(QUOTA_TAB).getRange(quotaRowIndex, updatedAtIndex + 1), new Date());
    }
  });

  return json({ success: true, sessionId, parsedOk });
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
  if (!requireApiKey(e, d)) {
    return json({ error: "MISSING_API_KEY" });
  }

  const path = String(e.pathInfo || "").trim().toLowerCase();
  if (path.endsWith("/log-message") || path.endsWith("log-message")) {
    return logMessage(d);
  }
  if (path.endsWith("/log-session") || path.endsWith("log-session")) {
    return logSession(d);
  }

  switch (String(d.action || "").trim()) {
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

    case "getLOAs":
      return getLOAs(d);

    case "saveLOA":
      return saveLOA(d);

    case "setLOAStatus":
      return setLOAStatus(d);

    case "getQuotaRecords":
      return getQuotaRecords(d);

    case "saveQuotaRecord":
      return saveQuotaRecord(d);

    case "getSessions":
      return getSessions(d);

    case "saveSession":
      return saveSession(d);

    case "deleteSession":
      return deleteSession(d);

    case "getStrikes":
      return getStrikes(d);

    case "saveStrike":
      return saveStrike(d);

    case "expireStrike":
      return expireStrike(d);

    case "logMessage":
      return logMessage(d);

    case "logSession":
      return logSession(d);

    default:
      return json({ error: "INVALID_ACTION" });
  }
}
