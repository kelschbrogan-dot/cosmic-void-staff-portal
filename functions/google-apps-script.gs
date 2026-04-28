const SHEET_ID = "1BkYdNFS5IknAeKVm3xbplJo_dXtGlPJGR9WQkqXcd2w";

const STAFF_TAB = "Staff";
const RATINGS_TAB = "Ratings";
const NOTES_TAB = "Notes";

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

    case "getDashboard":
      return getDashboard(d);

    default:
      return json({ error:"INVALID_ACTION" });
  }
}
