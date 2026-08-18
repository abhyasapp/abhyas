/* ═══════════════════════════════════════════════════════════════
   Abhyas V1 — Complete Google Apps Script Backend
   Flow: Signup → Auto-Trial (24h) → Payment → Admin Verify → Permanent
   Admin login shares endpoint, opens separate admin world.
   Offline-first: Once paid, access never removed.
   ═══════════════════════════════════════════════════════════════ */

/* ── VERSION ──────────────────────────────────────────────────────
   Bump this on every release that ships to production, so a support
   conversation can start with "what version are you on" instead of
   guessing from symptoms. Surfaced via the `ping` action; mirrored in
   app.js/index.html/user.html/admin.html/sw.js so every surface agrees. */
const APP_VERSION = "1.0";

/* ── ADMIN CREDENTIALS ───────────────────────────────────────────
   Admins now live in their own sheet (see getAdminsSheet_ / ADMIN_HEADERS
   below) instead of a single hardcoded username+password — any admin can
   create more admin accounts from admin.html's Settings tab
   (adminCreateAdmin), each with their own login and their own session
   token, so logging in from a second device no longer kicks the first
   one out. The two constants below are ONLY used once, to seed the very
   first admin row the first time the Admins sheet is created. */
const ADMIN_SEED_USERNAME = "admin";
const ADMIN_SEED_PASSWORD = "ChangeMe123!";   // ⚠️ CHANGE THIS IMMEDIATELY after first login (Settings → Change Password), or add a new admin and delete this one.

/* ── SHEET CONFIG ── */
const USERS_SHEET     = "Users";
const PAYMENTS_SHEET  = "Payments";
const SETTINGS_SHEET  = "Settings";
const LOGS_SHEET      = "Logs";
const ADMINS_SHEET    = "Admins";
const PROGRESS_SHEET  = "Progress";

/* ── BRUTE-FORCE LOGIN PROTECTION ────────────────────────────────
   Tracks failed attempts per-username in PropertiesService (not a sheet
   column) so this works on an already-deployed Users/Admins sheet with
   zero migration. 'user' and 'admin' are tracked as separate keyspaces
   under the same username, since a person could plausibly share a
   username across both worlds. Locked-out logins are rejected BEFORE the
   password is checked, so a locked account can't keep being used to
   guess — this applies to both handleLogin() and adminLogin(). */
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

function loginLockKey_(kind, username) {
  return "loginlock_" + kind + "_" + String(username).toLowerCase().trim();
}

function checkLoginLock_(kind, username) {
  const raw = PropertiesService.getScriptProperties().getProperty(loginLockKey_(kind, username));
  if (!raw) return { locked: false };
  let state;
  try { state = JSON.parse(raw); } catch (e) { return { locked: false }; }
  if (state.lockUntil && Date.now() < state.lockUntil) {
    return { locked: true, minutesLeft: Math.ceil((state.lockUntil - Date.now()) / 60000) };
  }
  return { locked: false };
}

function recordLoginFailure_(kind, username) {
  const props = PropertiesService.getScriptProperties();
  const key = loginLockKey_(kind, username);
  let state = { count: 0 };
  const raw = props.getProperty(key);
  if (raw) { try { state = JSON.parse(raw); } catch (e) {} }
  if (state.lockUntil && Date.now() >= state.lockUntil) state = { count: 0 }; // previous lockout expired — start fresh
  state.count = (state.count || 0) + 1;
  if (state.count >= MAX_LOGIN_ATTEMPTS) state.lockUntil = Date.now() + LOCKOUT_MINUTES * 60 * 1000;
  props.setProperty(key, JSON.stringify(state));
}

function clearLoginLock_(kind, username) {
  PropertiesService.getScriptProperties().deleteProperty(loginLockKey_(kind, username));
}

const USER_HEADERS = [
  "username", "passHash", "name", "email", "mobile",
  "contact", "contactType", "status", "createdAt", "approvedAt",
  "role", "trialExpiresAt", "paymentStatus", "permanentAccess",
  "accessType", "accessExpiresAt", "sessionToken", "sessionTokenExpiresAt"
];

const PAYMENT_HEADERS = [
  "username", "name", "email", "mobile", "txId", "remarks",
  "status", "rejectionReason", "screenshotUrl", "submittedAt", "reviewedAt"
];

const SETTINGS_HEADERS = ["key", "value"];
const LOG_HEADERS = ["timestamp", "admin", "action", "target", "details"];

// token/tokenExpires mirror the pattern USER_HEADERS already uses for
// per-user session tokens (see issueUserToken_) — each admin gets their
// own row and their own token, so admin sessions no longer collide.
const ADMIN_HEADERS = [
  "username", "passHash", "createdAt", "createdBy", "token", "tokenExpires"
];

// A DELIBERATELY separate sheet from Users, not new columns on it — that
// way this ships with zero migration risk to anyone's already-deployed
// Users sheet. `data` is one JSON blob (prog/bk/fl/wr/stk — the same
// shape app.js already keeps in localStorage) rather than one column per
// field, since the client-side shape is expected to keep evolving and a
// blob means adding a new tracked field never needs a new column here.
const PROGRESS_HEADERS = ["username", "data", "updatedAt"];

const TRIAL_HOURS = 24;

/* ═══════════════════════════════════════════════════════════════
   ENTRY POINTS — Bulletproof
   ═══════════════════════════════════════════════════════════════ */

function doGet(e) {
  if (!e || typeof e !== 'object') {
    return jsonResponse({
      success: false,
      error: "Invalid request: no event object. Use the deployed Web App URL (/exec)."
    });
  }
  if (!e.parameter) {
    return jsonResponse({
      success: false,
      error: "No parameters. Use the /exec deployment URL with ?action=..."
    });
  }

  const action = (e.parameter.action || "").trim().toLowerCase();
  let result;

  try {
    switch (action) {
      // ── HEALTH CHECK ──
      case "ping":                result = { success: true, pong: true, version: APP_VERSION }; break;

      // ── AUTH ──
      case "login":              result = handleLogin(e.parameter); break;
      case "signup":             result = handleSignup(e.parameter); break;
      case "checksession":       result = checkSession(e.parameter); break;
      case "saveprogress":       result = saveProgress(e.parameter); break;
      case "getprogress":        result = getProgress(e.parameter); break;

      // ── PAYMENT ──
      case "submitpayment":      result = submitPayment(e.parameter); break;
      case "getpaymentstatus":   result = getPaymentStatus(e.parameter); break;
      case "getsettings":        result = getSettings(); break;
      case "getfile":            result = handleGetFile(e.parameter); break;

      // ── ADMIN WORLD ──
      case "adminlogin":         result = adminLogin(e.parameter); break;
      case "adminchangepassword": result = adminChangePassword(e.parameter); break;
      case "adminlistadmins":    result = adminListAdmins(e.parameter); break;
      case "admincreateadmin":   result = adminCreateAdmin(e.parameter); break;
      case "admindeleteadmin":   result = adminDeleteAdmin(e.parameter); break;
      case "adminlistusers":     result = adminListUsers(e.parameter); break;
      case "adminlistpayments":  result = adminListPayments(e.parameter); break;
      case "adminreviewpayment": result = adminReviewPayment(e.parameter); break;
      case "adminreviewpaymentsbatch": result = adminReviewPaymentsBatch(e.parameter); break;
      case "admingrantaccess":   result = adminGrantAccess(e.parameter); break;
      case "adminupdateuser":    result = adminUpdateUser(e.parameter); break;
      case "admindeleteuser":    result = adminDeleteUser(e.parameter); break;
      case "admindeletepayment": result = adminDeletePayment(e.parameter); break;
      case "adminupdatesettings":result = adminUpdateSettings(e.parameter); break;
      case "adminupdatesettingsbatch": result = adminUpdateSettingsBatch(e.parameter); break;
      case "adminstats":         result = adminStats(e.parameter); break;
      case "adminlistlogs":      result = adminListLogs(e.parameter); break;

      default:
        result = {
          success: false,
          error: "Unknown action: '" + action + "'. Valid: ping, login, signup, checkSession, saveProgress, getProgress, submitPayment, getPaymentStatus, getSettings, getFile, adminLogin, adminChangePassword, adminListAdmins, adminCreateAdmin, adminDeleteAdmin, adminListUsers, adminListPayments, adminReviewPayment, adminReviewPaymentsBatch, adminGrantAccess, adminUpdateUser, adminDeleteUser, adminDeletePayment, adminUpdateSettings, adminUpdateSettingsBatch, adminStats, adminListLogs"
        };
    }
  } catch (err) {
    console.error("doGet ERROR [" + action + "]:", err);
    result = { success: false, error: "Server error: " + (err.message || err.toString()) };
  }

  return jsonResponse(result);
}

function doPost(e) {
  if (e && e.postData && e.postData.contents) {
    try {
      const payload = JSON.parse(e.postData.contents);
      e.parameter = e.parameter || {};
      for (const key in payload) {
        if (payload.hasOwnProperty(key)) {
          e.parameter[key] = payload[key];
        }
      }
    } catch (parseErr) {
      console.log("doPost: JSON parse failed, using raw parameters");
    }
  }
  return doGet(e);
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// Runs fn() while holding the script-wide lock, returning a friendly
// error instead of throwing if the lock can't be acquired in time.
//
// IMPORTANT: a lock only protects what it wraps. Row indices captured by
// findUserRow_/findAdminRow_/a manual getDataRange() scan become stale
// the instant ANY concurrent execution inserts or deletes a row above
// them — deleteRow() shifts every subsequent row up by one. Before this
// helper existed, only a few functions (handleSignup, adminCreateAdmin,
// saveProgress, adminReviewPaymentsBatch) took the lock; every other
// row-mutating admin action ran unlocked. That's not "less protected" —
// it's *unprotected entirely*, because an unlocked deleteRow() can still
// shift a row a locked function already read the index for, just after
// it released the lock (or one that never took it at all). The lock only
// does its job once every row-mutating function goes through it, which
// is why this helper is now used consistently below rather than being
// opt-in per function.
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    return { success: false, error: "Server is busy, please try again in a moment." };
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/* ═══════════════════════════════════════════════════════════════
   SETUP
   ═══════════════════════════════════════════════════════════════ */

function setup() {
  getUsersSheet_();
  getPaymentsSheet_();
  getSettingsSheet_();
  getLogsSheet_(); // was missing here — previously only got created lazily on the first admin action, so a fresh setup() run left the Logs tab absent until then.
  getAdminsSheet_(); // seeds the first admin login (see ADMIN_SEED_USERNAME/PASSWORD above)
  getProgressSheet_();
  initDefaultSettings_();
  // Idempotent — guarantees every sheet has the correct text-formatting
  // and column widths whether it was just created above or already
  // existed from before this update.
  fixSheetFormatting();
  const ss = getSpreadsheet_();
  Logger.log("✅ Setup complete. Spreadsheet URL: " + ss.getUrl());
  return "Setup complete. Spreadsheet created/verified.";
}

function getSpreadsheet_() {
  let ssId = PropertiesService.getScriptProperties().getProperty("SHEET_ID");
  let spreadsheet;
  if (ssId) {
    try {
      spreadsheet = SpreadsheetApp.openById(ssId);
    } catch (e) {
      spreadsheet = null;
      console.log("Could not open existing spreadsheet, creating new one.");
    }
  }
  if (!spreadsheet) {
    spreadsheet = SpreadsheetApp.create("Abhyas V1");
    PropertiesService.getScriptProperties().setProperty("SHEET_ID", spreadsheet.getId());
  }
  return spreadsheet;
}

// Auto-fits columns [colStart..colStart+colCount-1] to their actual content
// (so short values — paymentAmount "100", a log action name, etc. — get a
// tight, readable width) and then clamps any column that ended up wider
// than maxWidthPx back down to it, switching that column to CLIP wrap.
// This only kicks in for genuine outliers (a ~48,000-char QR data: URI,
// a long admin log note) — everything else is left at its natural
// autosized width instead of being flattened to one fixed width.
function autoResizeCapped_(sheet, colStart, colCount, maxWidthPx) {
  sheet.autoResizeColumns(colStart, colCount);
  const maxRows = Math.max(1, sheet.getMaxRows() - 1);
  for (let c = colStart; c < colStart + colCount; c++) {
    if (sheet.getColumnWidth(c) > maxWidthPx) {
      sheet.setColumnWidth(c, maxWidthPx);
      sheet.getRange(2, c, maxRows, 1).setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
    }
  }
}

function getUsersSheet_() {
  const spreadsheet = getSpreadsheet_();
  let sheet = spreadsheet.getSheetByName(USERS_SHEET);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(USERS_SHEET);
    sheet.appendRow(USER_HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, USER_HEADERS.length)
      .setFontWeight("bold")
      .setBackground("#4285f4")
      .setFontColor("white");
    // Force plain text on every column a person can type digits-only into —
    // otherwise Sheets silently converts it to a Number, which strips
    // leading zeros and can round or reformat long digit strings.
    // username=1 (a person can choose an all-digit username), mobile=5,
    // contact=6 (mirrors email OR mobile, so carries the same risk).
    const maxRows = sheet.getMaxRows() - 1;
    [1, 5, 6].forEach(col => sheet.getRange(2, col, maxRows, 1).setNumberFormat("@"));
    autoResizeCapped_(sheet, 1, USER_HEADERS.length, 300);
  }
  return sheet;
}

function getPaymentsSheet_() {
  const spreadsheet = getSpreadsheet_();
  let sheet = spreadsheet.getSheetByName(PAYMENTS_SHEET);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(PAYMENTS_SHEET);
    sheet.appendRow(PAYMENT_HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, PAYMENT_HEADERS.length)
      .setFontWeight("bold")
      .setBackground("#34a853")
      .setFontColor("white");
    // mobile=4 and txId=5 are both free-typed and frequently all-digits
    // (a transaction ID is very often numeric) — same auto-typing risk as
    // Users.mobile, and previously the actual cause of the payment-upload
    // crash. Force text on both so they're never silently coerced.
    const maxRows = sheet.getMaxRows() - 1;
    [4, 5].forEach(col => sheet.getRange(2, col, maxRows, 1).setNumberFormat("@"));
    autoResizeCapped_(sheet, 1, PAYMENT_HEADERS.length, 300);
  }
  return sheet;
}

function getSettingsSheet_() {
  const spreadsheet = getSpreadsheet_();
  let sheet = spreadsheet.getSheetByName(SETTINGS_SHEET);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(SETTINGS_SHEET);
    sheet.appendRow(SETTINGS_HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, SETTINGS_HEADERS.length)
      .setFontWeight("bold")
      .setBackground("#fbbc04")
      .setFontColor("white");
    // value=2 holds a mix of plain numeric-looking strings (paymentAmount
    // "100", trialHours "24") AND the QR code as a data:image base64
    // string tens of thousands of characters long. Force text so the
    // numeric-looking ones are never coerced to Number (getSettings()
    // would then hand back 100 instead of "100" — usually harmless, but
    // not the honest type — and trialHours math depends on it staying a
    // clean string→Number conversion happening once, deliberately, in
    // getSettingValue_/handleSignup, not silently in the sheet).
    const maxRows = sheet.getMaxRows() - 1;
    sheet.getRange(2, 2, maxRows, 1).setNumberFormat("@");
    autoResizeCapped_(sheet, 1, 2, 400);
    sheet.getRange(2, 2, maxRows, 1).setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  }
  return sheet;
}

function getLogsSheet_() {
  const spreadsheet = getSpreadsheet_();
  let sheet = spreadsheet.getSheetByName(LOGS_SHEET);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(LOGS_SHEET);
    sheet.appendRow(LOG_HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, LOG_HEADERS.length)
      .setFontWeight("bold")
      .setBackground("#9c27b0")
      .setFontColor("white");
    autoResizeCapped_(sheet, 1, LOG_HEADERS.length, 320); // details=5 is free text and the usual outlier
  }
  return sheet;
}

// Creates the Admins sheet on first use and seeds it with exactly one
// account (ADMIN_SEED_USERNAME/PASSWORD) so there's always at least one
// way in on a fresh deploy. Every admin after that is created via
// adminCreateAdmin (admin.html → Settings → Admin Accounts), each with
// their own hashed password and their own session token/expiry columns
// — see ADMIN_HEADERS. Existing sheets are left alone (idempotent).
function getAdminsSheet_() {
  const spreadsheet = getSpreadsheet_();
  let sheet = spreadsheet.getSheetByName(ADMINS_SHEET);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(ADMINS_SHEET);
    sheet.appendRow(ADMIN_HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, ADMIN_HEADERS.length)
      .setFontWeight("bold")
      .setBackground("#ea4335")
      .setFontColor("white");
    const maxRows = sheet.getMaxRows() - 1;
    sheet.getRange(2, 1, maxRows, 1).setNumberFormat("@"); // username, same all-digits protection as Users
    autoResizeCapped_(sheet, 1, ADMIN_HEADERS.length, 300);

    const salt = makeSalt_();
    sheet.appendRow([
      ADMIN_SEED_USERNAME,
      salt + ":" + hashPassSalted_(ADMIN_SEED_PASSWORD, salt),
      new Date().toISOString(),
      "system",
      "",
      ""
    ]);
  }
  return sheet;
}

function findAdminRow_(sheet, username) {
  if (!username) return null;
  const data = sheet.getDataRange().getValues();
  const target = String(username).toLowerCase().trim();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase().trim() === target) {
      return { rowIndex: i + 1, row: data[i] };
    }
  }
  return null;
}

// Token is column 5, expiry is column 6 (0-indexed 4/5) per ADMIN_HEADERS.
function findAdminByToken_(sheet, token) {
  if (!token) return null;
  const data = sheet.getDataRange().getValues();
  const now = Date.now();
  for (let i = 1; i < data.length; i++) {
    const storedToken = data[i][4];
    const expires = Number(data[i][5] || 0);
    if (storedToken && storedToken === token && expires && now <= expires) {
      return { rowIndex: i + 1, row: data[i] };
    }
  }
  return null;
}

function getProgressSheet_() {
  const spreadsheet = getSpreadsheet_();
  let sheet = spreadsheet.getSheetByName(PROGRESS_SHEET);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(PROGRESS_SHEET);
    sheet.appendRow(PROGRESS_HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, PROGRESS_HEADERS.length)
      .setFontWeight("bold")
      .setBackground("#0f9d58")
      .setFontColor("white");
    const maxRows = sheet.getMaxRows() - 1;
    sheet.getRange(2, 1, maxRows, 1).setNumberFormat("@"); // username, same all-digits protection as Users
    autoResizeCapped_(sheet, 1, PROGRESS_HEADERS.length, 300);
  }
  return sheet;
}

function findProgressRow_(sheet, username) {
  if (!username) return null;
  const data = sheet.getDataRange().getValues();
  const target = String(username).toLowerCase().trim();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase().trim() === target) {
      return { rowIndex: i + 1, row: data[i] };
    }
  }
  return null;
}


// Records one row per admin action. admin.html's "Activity Logs" tab
// (LOGS module) has always called action=adminListLogs to read this, but
// nothing ever wrote to it and the action didn't exist on the backend —
// so the tab was permanently empty. Called from every admin mutation
// below. Kept best-effort: a logging failure should never break the
// action itself.
function logAction_(admin, action, target, details) {
  try {
    getLogsSheet_().appendRow([new Date().toISOString(), admin || "admin", action || "", target || "", details || ""]);
  } catch (err) {
    console.error("logAction_ failed:", err);
  }
}

// Logs append chronologically, and admin.html's "Activity Logs" tab
// already paginates client-side — no admin session needs every log
// entry ever written in one response. Unlike Users/Payments (bounded by
// active account count), this sheet grows forever, so it's the one read
// worth capping rather than reading getDataRange() in full every time.
const LOGS_MAX_ROWS_READ = 1000;

// Returns logs newest-first; admin.html paginates/filters client-side.
function adminListLogs(p) {
  if (!checkAdmin_(p)) return { success: false, error: "Admin auth failed." };
  const sheet = getLogsSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: true, logs: [] };
  const totalDataRows = lastRow - 1; // row 1 is the header
  const rowsToRead = Math.min(totalDataRows, LOGS_MAX_ROWS_READ);
  const startRow = lastRow - rowsToRead + 1;
  const data = sheet.getRange(startRow, 1, rowsToRead, LOG_HEADERS.length).getValues();
  const logs = data.map(row => ({
    timestamp: row[0],
    admin: row[1],
    action: row[2],
    target: row[3],
    details: row[4]
  }));
  logs.reverse();
  return { success: true, logs };
}

function initDefaultSettings_() {
  const sheet = getSettingsSheet_();
  const data = sheet.getDataRange().getValues();
  const existingKeys = new Set();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) existingKeys.add(String(data[i][0]));
  }

  const defaults = [
    ["qrCodeUrl", ""],
    ["contactPhone", "9863200285"],
    ["paymentAmount", "100"],
    ["paymentInstructions", "Scan the QR code and submit your transaction ID for verification."],
    ["trialHours", "24"],
    ["appName", "Abhyas"]
  ];

  defaults.forEach(([key, value]) => {
    if (!existingKeys.has(key)) {
      sheet.appendRow([key, value]);
    }
  });
}

/* ═══════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════ */

function hashPass_(s) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  return bytes.map(b => ((b < 0 ? b + 256 : b).toString(16)).padStart(2, "0")).join("");
}

// Plain unsalted SHA-256 (the original hashPass_ above) means two users
// with the same password get the identical stored hash, and the whole
// Users sheet is crackable in one pass with a rainbow table if it's ever
// exposed. New passwords are hashed as "salt:sha256(salt+password)"
// instead. verifyPassword_ below still accepts the old bare-hash format
// for existing accounts and silently upgrades them to the salted format
// on their next successful login — nobody gets locked out, and every
// password converges to the stronger scheme over time.
function makeSalt_() {
  return Utilities.getUuid().replace(/-/g, "");
}

function hashPassSalted_(password, salt) {
  return hashPass_(salt + password);
}

// Returns {ok: true/false}. On success via the legacy unsalted scheme,
// also returns upgradedHash — the caller should write that back over the
// stored hash so this account is on the salted scheme from now on.
function verifyPassword_(password, storedHash) {
  const s = String(storedHash || "");
  const sep = s.indexOf(":");
  if (sep === -1) {
    if (s !== hashPass_(password)) return { ok: false };
    const salt = makeSalt_();
    return { ok: true, upgradedHash: salt + ":" + hashPassSalted_(password, salt) };
  }
  const salt = s.slice(0, sep);
  const hash = s.slice(sep + 1);
  return { ok: hash === hashPassSalted_(password, salt) };
}

// Session tokens live in columns 17/18 (0-indexed 16/17) of the Users
// sheet — see USER_HEADERS. 30-day expiry matches how long the frontend
// otherwise keeps a session cached in localStorage before requiring a
// fresh login.
const USER_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function issueUserToken_(sheet, rowIndex) {
  const token = Utilities.getUuid();
  const expires = Date.now() + USER_TOKEN_TTL_MS;
  sheet.getRange(rowIndex, 17).setValue(token);
  sheet.getRange(rowIndex, 18).setValue(String(expires));
  return token;
}

// found.row is the raw row array from findUserRow_ (0-indexed) — token is
// row[16], expiry is row[17].
function verifyUserToken_(found, token) {
  if (!token) return false;
  const storedToken = found.row[16];
  const expires = Number(found.row[17] || 0);
  if (!storedToken || storedToken !== token) return false;
  if (!expires || Date.now() > expires) return false;
  return true;
}

function findUserRow_(sheet, username) {
  if (!username) return null;
  const data = sheet.getDataRange().getValues();
  const target = String(username).toLowerCase().trim();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase().trim() === target) {
      return { rowIndex: i + 1, row: data[i] };
    }
  }
  return null;
}

// Generic column lookup, used by handleSignup to dedupe email/mobile —
// findUserRow_ above only ever checked column 0 (username), so two
// accounts could previously share the same email or phone number and
// each grab their own fresh 24h trial.
function findUserByField_(sheet, colIndex, value) {
  if (!value) return null;
  const data = sheet.getDataRange().getValues();
  const target = String(value).toLowerCase().trim();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][colIndex]).toLowerCase().trim() === target) {
      return { rowIndex: i + 1, row: data[i] };
    }
  }
  return null;
}

function rowToUser_(row) {
  return {
    username: row[0] || "",
    name: row[2] || "",
    email: row[3] || "",
    mobile: String(row[4] || ""),
    contact: row[5] || "",
    contactType: row[6] || "",
    status: row[7] || "trial",
    createdAt: row[8] || "",
    approvedAt: row[9] || "",
    role: row[10] || "user",
    trialExpiresAt: row[11] || "",
    paymentStatus: row[12] || "none",
    permanentAccess: row[13] === "true" || row[13] === true || false,
    // "permanent" | "yearly" | "" — set by adminGrantAccess. Only meaningful
    // when permanentAccess/status="active" is true.
    accessType: row[14] || "",
    // Only set (and only checked) when accessType === "yearly".
    accessExpiresAt: row[15] || ""
  };
}

// Returns the acting admin's username on success (truthy string — use
// this in logAction_ so the Activity Log shows who really did what now
// that there's more than one admin), or null on failure. Every
// admin-mutating action does `const actor = checkAdmin_(p); if (!actor) ...`
// instead of a bare true/false check.
function checkAdmin_(p) {
  const sheet = getAdminsSheet_();
  if (p.adminUser && p.adminPass) {
    const found = findAdminRow_(sheet, p.adminUser);
    if (!found) return null;
    const verify = verifyPassword_(p.adminPass, found.row[1]);
    if (!verify.ok) return null;
    if (verify.upgradedHash) sheet.getRange(found.rowIndex, 2).setValue(verify.upgradedHash);
    return found.row[0];
  }
  if (!p.adminToken) return null;
  const found = findAdminByToken_(sheet, p.adminToken);
  return found ? found.row[0] : null;
}

// Issues a token scoped to ONE admin's row (24h lifetime, matching
// admin.html's own client-side `expires: Date.now() + 86400000`) instead
// of a single script-wide token — so a second admin (or the same admin on
// a second device) logging in no longer invalidates anyone else's session.
function issueAdminToken_(sheet, rowIndex) {
  const token = Utilities.getUuid();
  const expires = Date.now() + 24 * 60 * 60 * 1000;
  sheet.getRange(rowIndex, 5).setValue(token);
  sheet.getRange(rowIndex, 6).setValue(String(expires));
  return token;
}

// A "yearly" grant is stored as permanentAccess=true + accessType="yearly"
// + accessExpiresAt=<date>. Once that date passes, downgrade back to
// "expired" so the person is routed to the payment/renewal screen again.
// Permanent grants (accessType="permanent" or accessExpiresAt empty) never expire.
function checkYearlyExpiry_(sheet, found, user, status) {
  if (user.accessType === "yearly" && user.accessExpiresAt) {
    const expiresAt = new Date(user.accessExpiresAt);
    if (!isNaN(expiresAt) && new Date() > expiresAt) {
      sheet.getRange(found.rowIndex, 8).setValue("expired");
      sheet.getRange(found.rowIndex, 14).setValue("false");
      user.permanentAccess = false;
      return "expired";
    }
  }
  return status;
}

function getOrCreateFolder_(folderName) {
  const iter = DriveApp.getFoldersByName(folderName);
  if (iter.hasNext()) return iter.next();
  return DriveApp.createFolder(folderName);
}

/* ═══════════════════════════════════════════════════════════════
   AUTH API
   ═══════════════════════════════════════════════════════════════ */

function handleLogin(p) {
  const username = String(p.username || "").trim();
  const password = p.password || "";

  if (!username || !password) {
    return { success: false, error: "Enter username and password." };
  }

  // ── ADMIN WORLD ──
  // Checked against the Admins sheet now (any admin, not just one
  // hardcoded username). Note: admin.html doesn't trust this response for
  // sign-in anyway — it always re-authenticates independently (see
  // index.html's goAdmin()) — but the token is now real/valid either way,
  // where before it was silently never persisted.
  const adminSheet = getAdminsSheet_();
  const adminFound = findAdminRow_(adminSheet, username);
  if (adminFound) {
    const adminLock = checkLoginLock_('admin', username);
    if (adminLock.locked) {
      return { success: false, error: `Too many failed attempts. Try again in ${adminLock.minutesLeft} minute(s).` };
    }
    const adminVerify = verifyPassword_(password, adminFound.row[1]);
    if (adminVerify.ok) {
      clearLoginLock_('admin', username);
      if (adminVerify.upgradedHash) adminSheet.getRange(adminFound.rowIndex, 2).setValue(adminVerify.upgradedHash);
      const adminToken = issueAdminToken_(adminSheet, adminFound.rowIndex);
      return {
        success: true,
        isAdmin: true,
        adminToken: adminToken,
        user: { username: adminFound.row[0], name: "Administrator", role: "admin" },
        message: "Welcome to Admin World"
      };
    }
    recordLoginFailure_('admin', username);
  }

  // ── USER WORLD ──
  const sheet = getUsersSheet_();
  const found = findUserRow_(sheet, username);
  if (!found) {
    return { success: false, error: "No account found. Please sign up first." };
  }

  const userLock = checkLoginLock_('user', username);
  if (userLock.locked) {
    return { success: false, error: `Too many failed attempts. Try again in ${userLock.minutesLeft} minute(s).` };
  }

  const row = found.row;
  const storedHash = row[1];
  const verify = verifyPassword_(password, storedHash);
  if (!verify.ok) {
    recordLoginFailure_('user', username);
    return { success: false, error: "Wrong password." };
  }
  clearLoginLock_('user', username);
  if (verify.upgradedHash) {
    sheet.getRange(found.rowIndex, 2).setValue(verify.upgradedHash);
  }
  const sessionToken = issueUserToken_(sheet, found.rowIndex);

  let status = row[7];
  const trialExpiresAt = row[11] ? new Date(row[11]) : null;
  const now = new Date();

  // Auto-expire trial if past due
  if (status === "trial" && trialExpiresAt && now > trialExpiresAt) {
    status = "expired";
    sheet.getRange(found.rowIndex, 8).setValue("expired");
  }

  const user = rowToUser_(row);
  user.status = status;
  status = checkYearlyExpiry_(sheet, found, user, status);
  user.status = status;

  // Paid users = permanent OR active (non-expired) yearly access
  if (user.permanentAccess || status === "active") {
    return {
      success: true,
      user: user,
      token: sessionToken,
      permanentAccess: true,
      accessType: user.accessType || "permanent",
      accessExpiresAt: user.accessExpiresAt || "",
      message: user.accessType === "yearly"
        ? "Welcome back! Yearly access active."
        : "Welcome back! Permanent access active."
    };
  }

  // Trial active
  if (status === "trial") {
    const hoursLeft = Math.max(0, Math.ceil((trialExpiresAt - now) / (1000 * 60 * 60)));
    return {
      success: true,
      user: user,
      token: sessionToken,
      isTrial: true,
      hoursLeft: hoursLeft,
      trialExpiresAt: user.trialExpiresAt,
      message: "You got 1-day free trial. Pay to get long-term access."
    };
  }

  // Expired or payment pending
  if (status === "expired" || status === "payment_pending") {
    const settings = getSettings();
    return {
      success: true,
      user: user,
      token: sessionToken,
      needsPayment: true,
      settings: settings.success ? settings.settings : {},
      message: "Your trial has expired. Please complete payment to continue."
    };
  }

  if (status === "rejected") {
    return { success: false, error: "Account rejected. Contact admin." };
  }

  return { success: true, user: user, token: sessionToken };
}

function handleSignup(p) {
  const username = String(p.username || "").trim();
  const password = p.password || "";
  const name = String(p.name || "").trim();
  const email = String(p.email || "").trim();
  const mobile = String(p.mobile || "").trim();
  const contact = email || mobile;
  const contactType = email ? "email" : (mobile ? "phone" : "other");

  if (!username || !password || !name || !email || !mobile) {
    return { success: false, error: "All fields required (username, password, name, email, mobile)." };
  }
  // admin.html renders username inside onclick="...('${username}')" handlers
  // (see USERS.renderPage, PAYMENTS.renderPage). HTML-escaping the *display*
  // text elsewhere doesn't protect that context — a quote or backslash in
  // the username could still break out of the inline JS string. Locking the
  // charset here removes that injection vector at the source, for every
  // username that will ever exist from this point on.
  if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(username)) {
    return { success: false, error: "Username must be 3-30 characters: letters, numbers, dots, dashes, underscores only." };
  }
  // index.html's signup form already enforces (and its placeholder
  // promises) a 6-character minimum client-side — this used to say 4
  // here, so anyone signing up through the API directly (or a modified
  // client) could set a password weaker than what the UI claims to
  // require. Matches adminChangePassword/adminCreateAdmin's own 6-char
  // floor too.
  if (password.length < 6) {
    return { success: false, error: "Password must be at least 6 characters." };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { success: false, error: "Invalid email address." };
  }
  // Nepali mobile numbers: 10 digits starting with 98/97/96/99 (covers
  // NTC, Ncell, and Smart Cell) — matches index.html's own client-side
  // check exactly (see APP.signup()) so a request that gets past the UI
  // can't fail here with a different rule, and vice versa. Nothing
  // validated this server-side before, so a typo'd or garbled mobile
  // number could get stored as-is — and mobile doubles as a dedup key
  // (findUserByField_) and the fallback contact method admins use to
  // reach a student about their payment, so a malformed one silently
  // breaks both.
  if (!/^(98|97|96|99)\d{8}$/.test(mobile)) {
    return { success: false, error: "Invalid Nepali mobile number. Use 10 digits starting with 98/97/96/99." };
  }

  // The uniqueness checks below and the appendRow() that follows are a
  // classic check-then-write race: two signups for the same username
  // (or email/mobile) arriving within the same script execution window
  // could both pass "not taken" and both get written, silently breaking
  // the dedup guarantees findUserByField_ exists for in the first place.
  // A script-wide lock serializes signups so that can't happen — the
  // small wait cost only affects the rare case of two people signing up
  // in the same instant, not normal traffic.
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    return { success: false, error: "Server is busy, please try signing up again in a moment." };
  }

  try {
    const sheet = getUsersSheet_();
    if (findUserRow_(sheet, username)) {
      return { success: false, error: "Username already taken." };
    }
    // email is column 3, mobile is column 4 in USER_HEADERS — see
    // findUserByField_ above for why this check exists.
    if (findUserByField_(sheet, 3, email)) {
      return { success: false, error: "An account with this email already exists. Please log in instead." };
    }
    if (findUserByField_(sheet, 4, mobile)) {
      return { success: false, error: "An account with this mobile number already exists. Please log in instead." };
    }

    const now = new Date();
    const trialHours = Number(getSettingValue_("trialHours", TRIAL_HOURS)) || TRIAL_HOURS;
    const trialExpiresAt = new Date(now.getTime() + trialHours * 60 * 60 * 1000);
    const salt = makeSalt_();

    sheet.appendRow([
      username,
      salt + ":" + hashPassSalted_(password, salt),
      name,
      email,
      mobile,
      contact,
      contactType,
      "trial",              // status
      now.toISOString(),    // createdAt
      now.toISOString(),    // approvedAt
      "user",               // role
      trialExpiresAt.toISOString(), // trialExpiresAt
      "none",               // paymentStatus
      "false"               // permanentAccess
    ]);

    const newRowIndex = sheet.getLastRow();
    const sessionToken = issueUserToken_(sheet, newRowIndex);

    return {
      success: true,
      isTrial: true,
      token: sessionToken,
      trialExpiresAt: trialExpiresAt.toISOString(),
      message: "Account created! You got 1-day free trial. Pay to get long-term access."
    };
  } finally {
    lock.releaseLock();
  }
}

function checkSession(p) {
  const username = String(p.username || "").trim();
  if (!username) return { success: false, error: "Username required." };

  const sheet = getUsersSheet_();
  const found = findUserRow_(sheet, username);
  if (!found) return { success: false, error: "User not found." };

  // Previously this endpoint returned full account data (email, mobile,
  // trial/payment status) for any username with no proof of identity —
  // the frontend has sent a token here since it was written, but nothing
  // on this end ever checked it. That's fixed now: no valid token, no data.
  if (!verifyUserToken_(found, p.token)) {
    return { success: false, error: "Session expired. Please log in again.", sessionInvalid: true };
  }

  const row = found.row;
  let status = row[7];
  const trialExpiresAt = row[11] ? new Date(row[11]) : null;
  const now = new Date();
  const permanentAccess = row[13] === "true" || row[13] === true;

  if (status === "trial" && trialExpiresAt && now > trialExpiresAt) {
    status = "expired";
    sheet.getRange(found.rowIndex, 8).setValue("expired");
  }

  const user = rowToUser_(row);
  user.status = status;
  status = checkYearlyExpiry_(sheet, found, user, status);
  user.status = status;

  // NOTE: every branch below echoes back `token: p.token`. checkSession
  // never issues a NEW token (it only verifies the one already proven
  // valid above via verifyUserToken_), but index.html's handleUserAuth()
  // reads `res.token` and persists whatever it gets into the session it
  // saves to localStorage. Before this fix, that field was simply absent
  // here — so any resumeUserSession() path that fell through to
  // checkSession()+handleUserAuth() (an unrecognized access.level) saved
  // `token: undefined` over the real one, and the NEXT checkSession call
  // silently sent the literal string "undefined" as the token and got
  // rejected — a real, if narrow, path to a permanently broken session
  // with a confusing "session expired" message and no obvious cause.
  // app.js/user.html were never affected (AUTH._buildSession there
  // rebuilds the session by spreading the previous one and never reads
  // res.token), but fixing it here — matching login()'s shape — closes
  // the gap for every current and future consumer, not just index.html.
  if (user.permanentAccess || status === "active") {
    return {
      success: true,
      user: user,
      token: p.token,
      permanentAccess: true,
      accessType: user.accessType || "permanent",
      accessExpiresAt: user.accessExpiresAt || ""
    };
  }

  if (status === "trial") {
    const hoursLeft = Math.max(0, Math.ceil((trialExpiresAt - now) / (1000 * 60 * 60)));
    return { success: true, user: user, token: p.token, isTrial: true, hoursLeft: hoursLeft };
  }

  if (status === "expired" || status === "payment_pending") {
    const settings = getSettings();
    return { success: true, user: user, token: p.token, needsPayment: true, settings: settings.success ? settings.settings : {} };
  }

  return { success: true, user: user, token: p.token };
}

/* ═══════════════════════════════════════════════════════════════
   PROGRESS SYNC — prog/bk/fl/wr/stk, mirrored from localStorage
   ═══════════════════════════════════════════════════════════════ */

// Saves the caller's own study progress (prog/bk/fl/wr/stk — the same
// shape app.js already keeps in localStorage) to a per-user row here, so
// it survives a lost device, a cleared browser, or a switch to a new
// phone instead of being local-only. Identity is proven the same way
// checkSession proves it — a valid session token — so this can never let
// one user overwrite another's progress. A client-side "reset progress
// for this file" action (clearing matching entries from S.prog before
// saving) is just a smaller `data` blob through this SAME endpoint —
// there is no separate reset action here, and there never needs to be,
// because this endpoint only ever stores whatever prog/bk/fl/wr/stk blob
// the signed-in user's own browser sends. It has no path to the
// Drive-hosted question JSON files at all (see handleGetFile below,
// which is the only action that ever reads them, and does so read-only)
// — so nothing an ordinary user (or a bug in this endpoint) does here can
// ever touch the shared question content every student relies on.
function saveProgress(p) {
  const username = String(p.username || "").trim();
  if (!username) return { success: false, error: "Username required." };
  const userSheet = getUsersSheet_();
  const userFound = findUserRow_(userSheet, username);
  if (!userFound) return { success: false, error: "User not found." };
  if (!verifyUserToken_(userFound, p.token)) {
    return { success: false, error: "Session expired. Please log in again.", sessionInvalid: true };
  }

  const dataStr = String(p.data || "");
  if (!dataStr) return { success: false, error: "No data provided." };
  // Sheets caps a single cell at 50,000 characters — stay comfortably
  // under that so a save never silently truncates.
  if (dataStr.length > 45000) {
    return { success: false, error: "Progress data too large to sync." };
  }
  try { JSON.parse(dataStr); } catch (e) {
    return { success: false, error: "Malformed progress data." };
  }

  return withLock_(() => {
    const sheet = getProgressSheet_();
    const found = findProgressRow_(sheet, username);
    const now = new Date().toISOString();
    if (found) {
      sheet.getRange(found.rowIndex, 2, 1, 2).setValues([[dataStr, now]]);
    } else {
      sheet.appendRow([username, dataStr, now]);
    }
    return { success: true, updatedAt: now };
  });
}

// Returns the caller's own synced progress blob, or data:null if they've
// never synced from any device (brand new account, or an existing one
// that pre-dates this feature) — the client treats null as "nothing to
// merge" and just keeps using whatever's already in its own localStorage.
function getProgress(p) {
  const username = String(p.username || "").trim();
  if (!username) return { success: false, error: "Username required." };
  const userSheet = getUsersSheet_();
  const userFound = findUserRow_(userSheet, username);
  if (!userFound) return { success: false, error: "User not found." };
  if (!verifyUserToken_(userFound, p.token)) {
    return { success: false, error: "Session expired. Please log in again.", sessionInvalid: true };
  }
  const sheet = getProgressSheet_();
  const found = findProgressRow_(sheet, username);
  if (!found) return { success: true, data: null };
  return { success: true, data: found.row[1], updatedAt: found.row[2] };
}

/* ═══════════════════════════════════════════════════════════════
   PAYMENT API
   ═══════════════════════════════════════════════════════════════ */

function submitPayment(p) {
  const username = String(p.username || "").trim();
  const name = String(p.name || "").trim();
  const email = String(p.email || "").trim();
  const mobile = String(p.mobile || "").trim();
  const txId = String(p.txId || "").trim();
  const remarks = String(p.remarks || "").trim();
  const screenshotData = p.screenshot || "";

  if (!username) return { success: false, error: "Username required." };
  if (!txId) return { success: false, error: "Transaction ID required." };

  // Update user status
  const userSheet = getUsersSheet_();
  const userFound = findUserRow_(userSheet, username);
  if (!userFound) return { success: false, error: "User not found." };

  // Without this, anyone could submit a payment record under someone
  // else's username — not enough to steal their access (admin still
  // reviews manually), but enough to spam a stranger's account into
  // payment_pending and mess with their status.
  if (!verifyUserToken_(userFound, p.token)) {
    return { success: false, error: "Session expired. Please log in again.", sessionInvalid: true };
  }

  const currentStatus = userFound.row[7];
  if (currentStatus !== "expired" && currentStatus !== "payment_pending" && currentStatus !== "trial") {
    return { success: false, error: "Payment not required at this time." };
  }

  userSheet.getRange(userFound.rowIndex, 8).setValue("payment_pending");
  userSheet.getRange(userFound.rowIndex, 13).setValue("pending");

  const sheet = getPaymentsSheet_();
  const now = new Date().toISOString();
  let screenshotUrl = "";

  // Deliberately outside the lock below: a Drive upload can be the
  // slowest part of this request, and the script-wide lock is shared by
  // every other action (signups, other payments, admin edits). Holding
  // it here would serialize all of those behind one person's upload.
  if (screenshotData && screenshotData.startsWith("data:image")) {
    try {
      const base64Data = screenshotData.split(",")[1];
      const blob = Utilities.newBlob(Utilities.base64Decode(base64Data), "image/png", username + "_payment.png");
      const folder = getOrCreateFolder_("PaymentScreenshots");
      const file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      screenshotUrl = file.getDownloadUrl();
    } catch (e) {
      console.log("Screenshot upload failed: " + e.message);
    }
  } else if (screenshotData && screenshotData.startsWith("http")) {
    screenshotUrl = screenshotData;
  }

  // The existingRow scan + write DOES need the lock: two submissions for
  // the same user arriving close together (double-tap, or a client retry
  // after a slow/timed-out response) could otherwise both read "no
  // existing row" and both append — leaving two payment rows for one
  // user, which then confuses every admin-side lookup keyed by username.
  return withLock_(() => {
    const data = sheet.getDataRange().getValues();
    let existingRow = null;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).toLowerCase() === username.toLowerCase()) {
        existingRow = i + 1;
        break;
      }
    }

    if (existingRow) {
      if (name) sheet.getRange(existingRow, 2).setValue(name);
      if (email) sheet.getRange(existingRow, 3).setValue(email);
      if (mobile) sheet.getRange(existingRow, 4).setValue(mobile);
      sheet.getRange(existingRow, 5).setValue(txId);
      if (remarks) sheet.getRange(existingRow, 6).setValue(remarks);
      sheet.getRange(existingRow, 7).setValue("pending");
      sheet.getRange(existingRow, 8).setValue("");
      if (screenshotUrl) sheet.getRange(existingRow, 9).setValue(screenshotUrl);
      sheet.getRange(existingRow, 10).setValue(now);
    } else {
      sheet.appendRow([username, name, email, mobile, txId, remarks, "pending", "", screenshotUrl, now, ""]);
    }

    return {
      success: true,
      message: "Payment submitted successfully. Waiting for admin verification."
    };
  });
}

function getPaymentStatus(p) {
  const username = String(p.username || "").trim();
  if (!username) return { success: false, error: "Username required." };

  // This returns email/mobile/txId and a link to the payment screenshot —
  // it needs the same proof-of-identity as checkSession, not just a
  // matching username string.
  const usersSheet = getUsersSheet_();
  const userFound = findUserRow_(usersSheet, username);
  if (!userFound) return { success: false, error: "User not found." };
  if (!verifyUserToken_(userFound, p.token)) {
    return { success: false, error: "Session expired. Please log in again.", sessionInvalid: true };
  }

  const sheet = getPaymentsSheet_();
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase() === username.toLowerCase()) {
      return {
        success: true,
        payment: {
          username: data[i][0],
          name: data[i][1],
          email: data[i][2],
          mobile: String(data[i][3] || ""),
          txId: data[i][4],
          remarks: data[i][5],
          status: data[i][6],
          rejectionReason: data[i][7],
          screenshotUrl: data[i][8],
          submittedAt: data[i][9],
          reviewedAt: data[i][10]
        }
      };
    }
  }
  return { success: false, error: "No payment submission found." };
}

function getSettings() {
  const sheet = getSettingsSheet_();
  const data = sheet.getDataRange().getValues();
  const settings = {};
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) settings[String(data[i][0])] = data[i][1];
  }
  return { success: true, settings };
}

// Reads one setting value from the Settings sheet (via getSettings()),
// falling back to `fallback` if the key is missing/blank. Use this instead
// of hardcoded constants for anything admin.html exposes as an editable
// setting (trialHours, paymentAmount, etc.) — otherwise admin edits save to
// the sheet but the backend keeps using the old hardcoded value, which is
// exactly the bug this fixed for trialHours.
function getSettingValue_(key, fallback) {
  const settings = getSettings().settings || {};
  const v = settings[key];
  return (v === undefined || v === null || v === "") ? fallback : v;
}

// ── QUESTION-FILE PROXY (READ-ONLY) ──
// app.js (QUIZ._fetch / CACHE.dl / CACHE.autoSync) downloads every question
// set through this single action instead of hitting Google Drive directly,
// because a plain https://drive.google.com/... link returns an HTML preview
// page in fetch(), not raw JSON. Reading the file server-side with DriveApp
// (running "as Me") sidesteps that entirely, and works even if the file's
// sharing is left at "Anyone with the link" or tighter, as long as the
// script owner's account can see it.
//
// This function only ever calls DriveApp.getFileById(...).getBlob() — it
// never calls setContent(), setTrashed(), or anything else that could
// modify or delete a question file. Every student's chapters-data.js
// points at the SAME Drive file ids, so a write here would corrupt
// content for everyone at once — deliberately, this code path has no
// write capability at all, not even a guarded/conditional one.
function handleGetFile(p) {
  const fileId = String(p.fileId || "").trim();
  if (!fileId) {
    return { success: false, error: "Missing fileId parameter." };
  }
  let file;
  try {
    file = DriveApp.getFileById(fileId);
  } catch (err) {
    return {
      success: false,
      error: "Could not open Drive file '" + fileId + "'. Check the fileId in chapters-data.js and make sure the file hasn't been deleted or moved. (" + (err.message || err) + ")"
    };
  }
  let text;
  try {
    text = file.getBlob().getDataAsString("UTF-8");
  } catch (err) {
    return { success: false, error: "Could not read file contents: " + (err.message || err) };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return {
      success: false,
      error: "File '" + file.getName() + "' is not valid JSON (" + (err.message || err) + "). Re-check the uploaded question file."
    };
  }
  return { success: true, result: parsed };
}

/* ═══════════════════════════════════════════════════════════════
   ADMIN API — The Admin World
   ═══════════════════════════════════════════════════════════════ */

function adminLogin(p) {
  const username = String(p.username || "").trim();
  const password = p.password || "";
  if (!username || !password) return { success: false, error: "Enter admin username and password." };

  const sheet = getAdminsSheet_();
  const found = findAdminRow_(sheet, username);
  if (!found) return { success: false, error: "Invalid admin credentials." };

  const lock = checkLoginLock_('admin', username);
  if (lock.locked) {
    return { success: false, error: `Too many failed attempts. Try again in ${lock.minutesLeft} minute(s).` };
  }

  const verify = verifyPassword_(password, found.row[1]);
  if (!verify.ok) {
    recordLoginFailure_('admin', username);
    return { success: false, error: "Invalid admin credentials." };
  }
  clearLoginLock_('admin', username);
  if (verify.upgradedHash) sheet.getRange(found.rowIndex, 2).setValue(verify.upgradedHash);

  const token = issueAdminToken_(sheet, found.rowIndex);
  logAction_(found.row[0], "Admin Login", "", "");
  return {
    success: true,
    isAdmin: true,
    adminToken: token,
    user: { username: found.row[0], name: "Administrator", role: "admin" },
    message: "Welcome to Admin World"
  };
}

// Changes the CALLING admin's own password (their row is found via their
// adminToken, resolved through checkAdmin_) — not a single shared secret
// anymore, so this only ever affects the account that's actually logged
// in, never any other admin.
function adminChangePassword(p) {
  const actor = checkAdmin_(p);
  if (!actor) return { success: false, error: "Admin auth failed." };
  const currentPassword = p.currentPassword || "";
  const newPassword = p.newPassword || "";
  if (!newPassword || newPassword.length < 6) {
    return { success: false, error: "New password must be at least 6 characters." };
  }
  const sheet = getAdminsSheet_();
  return withLock_(() => {
    const found = findAdminRow_(sheet, actor);
    if (!found) return { success: false, error: "Admin account not found." };
    const verify = verifyPassword_(currentPassword, found.row[1]);
    if (!verify.ok) return { success: false, error: "Current password is incorrect." };

    const salt = makeSalt_();
    sheet.getRange(found.rowIndex, 2).setValue(salt + ":" + hashPassSalted_(newPassword, salt));
    logAction_(actor, "Change Admin Password", actor, "");
    return { success: true, message: "Password changed." };
  });
}

// Any already-authenticated admin can create another admin account —
// this is the "increase admins later" path. New accounts start with no
// active session token until they log in themselves.
function adminCreateAdmin(p) {
  const actor = checkAdmin_(p);
  if (!actor) return { success: false, error: "Admin auth failed." };
  const username = String(p.username || "").trim();
  const password = p.password || "";
  if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(username)) {
    return { success: false, error: "Username must be 3-30 characters: letters, numbers, dots, dashes, underscores only." };
  }
  if (!password || password.length < 6) {
    return { success: false, error: "Password must be at least 6 characters." };
  }
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    return { success: false, error: "Server is busy, please try again in a moment." };
  }
  try {
    const sheet = getAdminsSheet_();
    if (findAdminRow_(sheet, username)) {
      return { success: false, error: "That admin username already exists." };
    }
    const salt = makeSalt_();
    sheet.appendRow([username, salt + ":" + hashPassSalted_(password, salt), new Date().toISOString(), actor, "", ""]);
    logAction_(actor, "Create Admin", username, "");
    return { success: true, message: "Admin account created." };
  } finally {
    lock.releaseLock();
  }
}

// Lists admin usernames/createdAt only — never password hashes or tokens.
function adminListAdmins(p) {
  const actor = checkAdmin_(p);
  if (!actor) return { success: false, error: "Admin auth failed." };
  const sheet = getAdminsSheet_();
  const data = sheet.getDataRange().getValues();
  const admins = [];
  for (let i = 1; i < data.length; i++) {
    admins.push({ username: data[i][0], createdAt: data[i][2], createdBy: data[i][3] });
  }
  return { success: true, admins };
}

// Refuses to delete the last remaining admin (would lock everyone out)
// and refuses to let an admin delete their own account while logged in
// (avoids an accidental self-lockout mid-session — log in as someone
// else first, then remove the old account).
function adminDeleteAdmin(p) {
  const actor = checkAdmin_(p);
  if (!actor) return { success: false, error: "Admin auth failed." };
  const username = String(p.username || "").trim();
  if (!username) return { success: false, error: "Username required." };
  if (username.toLowerCase() === actor.toLowerCase()) {
    return { success: false, error: "You can't delete the admin account you're currently logged in as." };
  }
  const sheet = getAdminsSheet_();
  return withLock_(() => {
    if (sheet.getLastRow() - 1 <= 1) {
      return { success: false, error: "Can't delete the last remaining admin account." };
    }
    const found = findAdminRow_(sheet, username);
    if (!found) return { success: false, error: "Admin not found." };
    sheet.deleteRow(found.rowIndex);
    logAction_(actor, "Delete Admin", username, "");
    return { success: true, message: "Admin account deleted." };
  });
}

function adminListUsers(p) {
  if (!checkAdmin_(p)) return { success: false, error: "Admin auth failed." };
  const sheet = getUsersSheet_();
  const data = sheet.getDataRange().getValues();
  const users = [];
  for (let i = 1; i < data.length; i++) {
    users.push(rowToUser_(data[i]));
  }
  return { success: true, users };
}

function adminListPayments(p) {
  if (!checkAdmin_(p)) return { success: false, error: "Admin auth failed." };
  const sheet = getPaymentsSheet_();
  const data = sheet.getDataRange().getValues();
  const payments = [];

  // Verification here is manual (admin eyeballs the screenshot), so nothing
  // ever stopped two different usernames from submitting the exact same
  // transaction ID — e.g. someone resubmitting a real payer's txId hoping
  // it slips through review. We don't block it (a legit user's own retry
  // after a rejection reuses their own txId too), just surface it so the
  // reviewing admin can cross-check before approving.
  const txIdOwners = {};
  for (let i = 1; i < data.length; i++) {
    const txId = String(data[i][4] || "").trim().toLowerCase();
    const username = String(data[i][0] || "");
    if (!txId) continue;
    if (!txIdOwners[txId]) txIdOwners[txId] = new Set();
    txIdOwners[txId].add(username);
  }

  for (let i = 1; i < data.length; i++) {
    const txId = String(data[i][4] || "");
    const username = String(data[i][0] || "");
    const owners = txIdOwners[txId.trim().toLowerCase()];
    const sharedWith = owners ? [...owners].filter(u => u !== username) : [];
    payments.push({
      username: username,
      name: data[i][1],
      email: data[i][2],
      mobile: String(data[i][3] || ""),
      txId: txId,
      remarks: data[i][5],
      status: data[i][6],
      rejectionReason: data[i][7],
      screenshotUrl: data[i][8],
      submittedAt: data[i][9],
      reviewedAt: data[i][10],
      duplicateTxId: sharedWith.length > 0,
      duplicateTxIdUsers: sharedWith
    });
  }
  return { success: true, payments };
}

function adminReviewPayment(p) {
  const actor = checkAdmin_(p);
  if (!actor) return { success: false, error: "Admin auth failed." };

  const username = String(p.username || "").trim();
  const status = String(p.status || "").trim();
  const rejectionReason = String(p.rejectionReason || "").trim();

  if (!username || !status) return { success: false, error: "Username and status required." };
  if (!["verified", "rejected", "pending"].includes(status)) {
    return { success: false, error: "Status must be verified, rejected, or pending." };
  }

  return withLock_(() => {
  const sheet = getPaymentsSheet_();
  const data = sheet.getDataRange().getValues();
  let paymentRow = null;

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase() === username.toLowerCase()) {
      paymentRow = i + 1;
      break;
    }
  }

  if (!paymentRow) return { success: false, error: "Payment not found." };

  sheet.getRange(paymentRow, 7).setValue(status);
  if (rejectionReason && status === "rejected") {
    sheet.getRange(paymentRow, 8).setValue(rejectionReason);
  }
  sheet.getRange(paymentRow, 11).setValue(new Date().toISOString());

  // Update user based on payment status
  const userSheet = getUsersSheet_();
  const userFound = findUserRow_(userSheet, username);
  if (userFound) {
    if (status === "verified") {
      userSheet.getRange(userFound.rowIndex, 8).setValue("active");
      userSheet.getRange(userFound.rowIndex, 13).setValue("verified");
      userSheet.getRange(userFound.rowIndex, 14).setValue("true"); // PERMANENT ACCESS
      userSheet.getRange(userFound.rowIndex, 10).setValue(new Date().toISOString());
      userSheet.getRange(userFound.rowIndex, 15).setValue("permanent"); // accessType
      userSheet.getRange(userFound.rowIndex, 16).setValue("");          // no expiry
    } else if (status === "rejected") {
      userSheet.getRange(userFound.rowIndex, 8).setValue("expired");
      userSheet.getRange(userFound.rowIndex, 13).setValue("rejected");
      userSheet.getRange(userFound.rowIndex, 14).setValue("false");
    }
  }

  logAction_(actor, "Review Payment", username, "Status: " + status + (rejectionReason ? " (" + rejectionReason + ")" : ""));
  return { success: true, username, status };
  });
}

// Batched sibling of adminReviewPayment() above — takes p.usernames as a
// JSON array and applies the same status/rejectionReason to all of them
// in ONE execution (one Payments read, one Users read, both turned into
// lookup maps up front) instead of the admin panel firing N sequential
// adminReviewPayment requests, one per selected checkbox. Same column
// writes as the single-record version above; keep the two in sync if the
// sheet schema ever changes.
function adminReviewPaymentsBatch(p) {
  const actor = checkAdmin_(p);
  if (!actor) return { success: false, error: "Admin auth failed." };

  let usernames;
  try {
    usernames = JSON.parse(p.usernames || "[]");
  } catch (e) {
    return { success: false, error: "usernames must be a JSON array." };
  }
  if (!Array.isArray(usernames) || !usernames.length) {
    return { success: false, error: "No usernames provided." };
  }

  const status = String(p.status || "").trim();
  const rejectionReason = String(p.rejectionReason || "").trim();
  if (!["verified", "rejected", "pending"].includes(status)) {
    return { success: false, error: "Status must be verified, rejected, or pending." };
  }

  return withLock_(() => {
    const paymentSheet = getPaymentsSheet_();
    const payData = paymentSheet.getDataRange().getValues();
    const payRowByUser = {};
    for (let i = 1; i < payData.length; i++) {
      payRowByUser[String(payData[i][0]).toLowerCase().trim()] = i + 1;
    }

    const userSheet = getUsersSheet_();
    const userData = userSheet.getDataRange().getValues();
    const userRowByUser = {};
    for (let i = 1; i < userData.length; i++) {
      userRowByUser[String(userData[i][0]).toLowerCase().trim()] = i + 1;
    }

    const nowIso = new Date().toISOString();
    const results = [];

    usernames.forEach(rawUsername => {
      const username = String(rawUsername || "").trim();
      const payRow = payRowByUser[username.toLowerCase()];
      if (!payRow) { results.push({ username, success: false, error: "Payment not found." }); return; }

      paymentSheet.getRange(payRow, 7).setValue(status);
      if (rejectionReason && status === "rejected") paymentSheet.getRange(payRow, 8).setValue(rejectionReason);
      paymentSheet.getRange(payRow, 11).setValue(nowIso);

      const userRow = userRowByUser[username.toLowerCase()];
      if (userRow) {
        if (status === "verified") {
          userSheet.getRange(userRow, 8).setValue("active");
          userSheet.getRange(userRow, 13).setValue("verified");
          userSheet.getRange(userRow, 14).setValue("true");
          userSheet.getRange(userRow, 10).setValue(nowIso);
          userSheet.getRange(userRow, 15).setValue("permanent");
          userSheet.getRange(userRow, 16).setValue("");
        } else if (status === "rejected") {
          userSheet.getRange(userRow, 8).setValue("expired");
          userSheet.getRange(userRow, 13).setValue("rejected");
          userSheet.getRange(userRow, 14).setValue("false");
        }
      }

      results.push({ username, success: true });
    });

    const okCount = results.filter(r => r.success).length;
    logAction_(actor, "Bulk Review Payment", usernames.join(", "),
      "Status: " + status + (rejectionReason ? " (" + rejectionReason + ")" : "") + " — " + okCount + "/" + usernames.length + " succeeded");

    return { success: true, status, results };
  });
}

// duration is either "permanent" (never expires)
// or "year" (expires exactly 365 days from now, then the person is routed
// back to the payment/renewal screen automatically on their next login or
// session check — see checkYearlyExpiry_()).
function adminGrantAccess(p) {
  const actor = checkAdmin_(p);
  if (!actor) return { success: false, error: "Admin auth failed." };

  const username = String(p.username || "").trim();
  const duration = String(p.duration || "").trim(); // "permanent" | "year"
  if (!username) return { success: false, error: "Username required." };
  if (!["permanent", "year"].includes(duration)) {
    return { success: false, error: "Duration must be 'permanent' or 'year'." };
  }

  const sheet = getUsersSheet_();

  return withLock_(() => {
    const found = findUserRow_(sheet, username);
    if (!found) return { success: false, error: "User not found." };

    let expiresAtIso = "";
    if (duration === "year") {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 365);
      expiresAtIso = expiresAt.toISOString();
    }

    sheet.getRange(found.rowIndex, 8).setValue("active");           // status
    sheet.getRange(found.rowIndex, 10).setValue(new Date().toISOString()); // approvedAt
    sheet.getRange(found.rowIndex, 13).setValue("verified");        // paymentStatus
    sheet.getRange(found.rowIndex, 14).setValue("true");            // permanentAccess
    sheet.getRange(found.rowIndex, 15).setValue(duration === "year" ? "yearly" : "permanent"); // accessType
    sheet.getRange(found.rowIndex, 16).setValue(expiresAtIso);      // accessExpiresAt

    logAction_(actor, "Grant Access", username, "Duration: " + duration);
    return { success: true, username, duration, accessExpiresAt: expiresAtIso };
  });
}

// Column indices below follow USER_HEADERS: name=3, email=4, mobile=5,
// status=8, permanentAccess=14 (1-indexed sheet columns).
function adminUpdateUser(p) {
  const actor = checkAdmin_(p);
  if (!actor) return { success: false, error: "Admin auth failed." };
  const username = String(p.username || "").trim();
  if (!username) return { success: false, error: "Username required." };

  const sheet = getUsersSheet_();

  return withLock_(() => {
    const found = findUserRow_(sheet, username);
    if (!found) return { success: false, error: "User not found." };

    const changes = [];
    if (p.name !== undefined) { sheet.getRange(found.rowIndex, 3).setValue(p.name); changes.push("name"); }
    if (p.email !== undefined) { sheet.getRange(found.rowIndex, 4).setValue(p.email); changes.push("email"); }
    if (p.mobile !== undefined) { sheet.getRange(found.rowIndex, 5).setValue(p.mobile); changes.push("mobile"); }
    if (p.status !== undefined && p.status !== "") { sheet.getRange(found.rowIndex, 8).setValue(p.status); changes.push("status→" + p.status); }
    if (p.permanentAccess !== undefined) {
      const val = (p.permanentAccess === true || p.permanentAccess === "true") ? "true" : "false";
      sheet.getRange(found.rowIndex, 14).setValue(val);
      changes.push("permanentAccess→" + val);
    }
    if (p.password) {
      if (String(p.password).length < 6) return { success: false, error: "Password must be at least 6 characters." };
      const salt = makeSalt_();
      sheet.getRange(found.rowIndex, 2).setValue(salt + ":" + hashPassSalted_(p.password, salt));
      changes.push("password reset");
    }

    logAction_(actor, "Update User", username, changes.join(", "));
    return { success: true, username };
  });
}

function adminDeleteUser(p) {
  const actor = checkAdmin_(p);
  if (!actor) return { success: false, error: "Admin auth failed." };
  const username = String(p.username || "").trim();
  const sheet = getUsersSheet_();
  return withLock_(() => {
    const found = findUserRow_(sheet, username);
    if (!found) return { success: false, error: "User not found." };
    sheet.deleteRow(found.rowIndex);
    logAction_(actor, "Delete User", username, "");
    return { success: true, deleted: username };
  });
}

function adminDeletePayment(p) {
  const actor = checkAdmin_(p);
  if (!actor) return { success: false, error: "Admin auth failed." };
  const username = String(p.username || "").trim();
  const sheet = getPaymentsSheet_();
  return withLock_(() => {
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]).toLowerCase() === username.toLowerCase()) {
        sheet.deleteRow(i + 1);
        logAction_(actor, "Delete Payment", username, "");
        return { success: true, deleted: username };
      }
    }
    return { success: false, error: "Payment not found." };
  });
}

function adminUpdateSettings(p) {
  const actor = checkAdmin_(p);
  if (!actor) return { success: false, error: "Admin auth failed." };
  const key = String(p.key || "").trim();
  const value = (p.value !== undefined) ? p.value : "";
  if (!key) return { success: false, error: "Setting key required." };

  return withLock_(() => {
  const sheet = getSettingsSheet_();
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === key) {
      sheet.getRange(i + 1, 2).setValue(value);
      logAction_(actor, "Update Setting", key, "New value: " + value);
      return { success: true, key, value };
    }
  }
  sheet.appendRow([key, value]);
  logAction_(actor, "Update Setting", key, "New value: " + value);
  return { success: true, key, value };
  });
}

function adminUpdateSettingsBatch(p) {
  const actor = checkAdmin_(p);
  if (!actor) return { success: false, error: "Admin auth failed." };
  const incoming = p.settings;
  if (!Array.isArray(incoming) || !incoming.length) {
    return { success: false, error: "settings array required." };
  }

  return withLock_(() => {
  const sheet = getSettingsSheet_();
  const data = sheet.getDataRange().getValues();
  const rowByKey = {};
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) rowByKey[String(data[i][0])] = i + 1;
  }

  const applied = [];
  for (const s of incoming) {
    const key = String(s.key || "").trim();
    if (!key) continue;
    const value = (s.value !== undefined) ? s.value : "";
    if (rowByKey[key]) {
      sheet.getRange(rowByKey[key], 2).setValue(value);
    } else {
      sheet.appendRow([key, value]);
      rowByKey[key] = sheet.getLastRow();
    }
    applied.push(key);
  }

  logAction_(actor, "Update Settings (batch)", applied.join(", "), "");
  return { success: true, updated: applied };
  });
}

function adminStats(p) {
  if (!checkAdmin_(p)) return { success: false, error: "Admin auth failed." };

  const userSheet = getUsersSheet_();
  const userData = userSheet.getDataRange().getValues();
  const paymentSheet = getPaymentsSheet_();
  const payData = paymentSheet.getDataRange().getValues();

  let totalUsers = 0, trialUsers = 0, activeUsers = 0, expiredUsers = 0, paymentPending = 0;
  for (let i = 1; i < userData.length; i++) {
    totalUsers++;
    const status = userData[i][7];
    if (status === "trial") trialUsers++;
    else if (status === "active") activeUsers++;
    else if (status === "expired") expiredUsers++;
    else if (status === "payment_pending") paymentPending++;
  }

  let totalPayments = 0, pendingPayments = 0, verifiedPayments = 0, rejectedPayments = 0;
  for (let i = 1; i < payData.length; i++) {
    totalPayments++;
    const status = payData[i][6];
    if (status === "pending") pendingPayments++;
    else if (status === "verified") verifiedPayments++;
    else if (status === "rejected") rejectedPayments++;
  }

  return {
    success: true,
    stats: {
      users: { total: totalUsers, trial: trialUsers, active: activeUsers, expired: expiredUsers, paymentPending: paymentPending },
      payments: { total: totalPayments, pending: pendingPayments, verified: verifiedPayments, rejected: rejectedPayments }
    }
  };
}

/**
 * Run this ONCE from the Apps Script editor if your spreadsheet already
 * existed before this update — the text-formatting fixes in
 * getUsersSheet_/getPaymentsSheet_/getSettingsSheet_/getLogsSheet_ above
 * only apply automatically when a sheet is first CREATED, so an existing
 * spreadsheet needs this to retrofit the same protection (and won't be
 * touched again after — safe to re-run any time, it's idempotent).
 */
function fixSheetFormatting() {
  const u = getUsersSheet_();
  let maxRows = u.getMaxRows() - 1;
  [1, 5, 6].forEach(col => u.getRange(2, col, maxRows, 1).setNumberFormat("@"));
  autoResizeCapped_(u, 1, USER_HEADERS.length, 300);

  const p = getPaymentsSheet_();
  maxRows = p.getMaxRows() - 1;
  [4, 5].forEach(col => p.getRange(2, col, maxRows, 1).setNumberFormat("@"));
  autoResizeCapped_(p, 1, PAYMENT_HEADERS.length, 300);

  const s = getSettingsSheet_();
  maxRows = s.getMaxRows() - 1;
  s.getRange(2, 2, maxRows, 1).setNumberFormat("@");
  autoResizeCapped_(s, 1, 2, 400);
  s.getRange(2, 2, maxRows, 1).setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);

  const l = getLogsSheet_();
  autoResizeCapped_(l, 1, LOG_HEADERS.length, 320);

  console.log("✅ Sheet formatting fixed/retrofitted on all four sheets.");
  return "Sheet formatting fixed. Check View → Logs for details.";
}

/* ═══════════════════════════════════════════════════════════════
   DEBUG / TEST — Run testAll() from the editor to verify everything
   ═══════════════════════════════════════════════════════════════ */

function testAll() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  Abhyas V1 — FULL SYSTEM TEST");
  console.log("═══════════════════════════════════════════════════════");

  // 1. Setup
  console.log("\n[1/10] Running setup...");
  setup();
  console.log("✅ Setup complete");

  // 2. Signup
  console.log("\n[2/10] Testing signup...");
  const signupResult = handleSignup({
    username: "testuser",
    password: "testpass",
    name: "Test User",
    email: "test@example.com",
    mobile: "9800000000"
  });
  console.log("Signup:", JSON.stringify(signupResult));
  if (!signupResult.success) throw new Error("SIGNUP FAILED");

  // 3. Login during trial
  console.log("\n[3/10] Testing login (trial)...");
  const loginTrial = handleLogin({
    username: "testuser",
    password: "testpass"
  });
  console.log("Login (trial):", JSON.stringify(loginTrial));
  if (!loginTrial.success || !loginTrial.isTrial) throw new Error("TRIAL LOGIN FAILED");

  // 4. Admin login
  console.log("\n[4/10] Testing admin login...");
  const adminResult = adminLogin({
    username: "admin",
    password: "ChangeMe123!"
  });
  console.log("Admin login:", JSON.stringify(adminResult));
  if (!adminResult.success || !adminResult.isAdmin) throw new Error("ADMIN LOGIN FAILED");

  // 5. Admin list users
  console.log("\n[5/10] Testing admin list users...");
  const listUsers = adminListUsers({ adminUser: "admin", adminPass: "ChangeMe123!" });
  console.log("Users count:", listUsers.users.length);
  if (!listUsers.success) throw new Error("ADMIN LIST USERS FAILED");

  // 6. Simulate expired trial
  console.log("\n[6/10] Simulating trial expiration...");
  const sheet = getUsersSheet_();
  const found = findUserRow_(sheet, "testuser");
  const pastDate = new Date(Date.now() - 25 * 60 * 60 * 1000);
  sheet.getRange(found.rowIndex, 12).setValue(pastDate.toISOString());
  console.log("✅ Trial date set to past");

  // 7. Login after expiry
  console.log("\n[7/10] Testing login (expired)...");
  const loginExpired = handleLogin({
    username: "testuser",
    password: "testpass"
  });
  console.log("Login (expired):", JSON.stringify(loginExpired));
  if (!loginExpired.success || !loginExpired.needsPayment) throw new Error("EXPIRED LOGIN FAILED");

  // 8. Submit payment
  console.log("\n[8/10] Testing payment submission...");
  const payResult = submitPayment({
    username: "testuser",
    token: loginExpired.token,
    name: "Test User",
    email: "test@example.com",
    mobile: "9800000000",
    txId: "TXN123456",
    remarks: "Test payment"
  });
  console.log("Payment:", JSON.stringify(payResult));
  if (!payResult.success) throw new Error("PAYMENT SUBMIT FAILED");

  // 9. Admin verify payment
  console.log("\n[9/10] Testing admin verify payment...");
  const verifyResult = adminReviewPayment({
    adminUser: "admin",
    adminPass: "ChangeMe123!",
    username: "testuser",
    status: "verified"
  });
  console.log("Verify:", JSON.stringify(verifyResult));
  if (!verifyResult.success) throw new Error("ADMIN VERIFY FAILED");

  // 10. Login as permanent user
  console.log("\n[10/10] Testing login (permanent)...");
  const loginActive = handleLogin({
    username: "testuser",
    password: "testpass"
  });
  console.log("Login (active):", JSON.stringify(loginActive));
  if (!loginActive.success || !loginActive.permanentAccess) throw new Error("PERMANENT ACCESS LOGIN FAILED");

  // Stats
  console.log("\n[EXTRA] Admin stats...");
  const stats = adminStats({ adminUser: "admin", adminPass: "ChangeMe123!" });
  console.log("Stats:", JSON.stringify(stats));

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  ✅ ALL TESTS PASSED — SYSTEM READY");
  console.log("═══════════════════════════════════════════════════════");

  return "All tests passed. Check View → Logs for details.";
}

/**
 * Reset all data — USE WITH CAUTION
 */
function resetAll() {
  const ss = getSpreadsheet_();
  const sheets = ss.getSheets();
  sheets.forEach(sheet => {
    if (sheet.getName() !== USERS_SHEET && sheet.getName() !== PAYMENTS_SHEET && sheet.getName() !== SETTINGS_SHEET) {
      ss.deleteSheet(sheet);
    }
  });

  // Clear data rows (keep headers)
  [USERS_SHEET, PAYMENTS_SHEET, SETTINGS_SHEET].forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (sheet && sheet.getLastRow() > 1) {
      sheet.deleteRows(2, sheet.getLastRow() - 1);
    }
  });

  initDefaultSettings_();
  console.log("All data reset.");
  return "All data has been reset.";
}

/**
 * Quick diagnostic — run this to verify your deployment
 */
function diagnose() {
  console.log("═══ DIAGNOSTIC ═══");
  const ss = getSpreadsheet_();
  console.log("Spreadsheet URL:", ss.getUrl());
  console.log("Sheets:", ss.getSheets().map(s => s.getName()).join(", "));

  const u = getUsersSheet_();
  console.log("Users rows:", u.getLastRow());
  // Column type check: username(1)/mobile(5)/contact(6) must read back as
  // strings. If any of these come back as "number", the sheet's text
  // formatting fix (fixSheetFormatting()) hasn't been applied/run yet —
  // re-run setup() or fixSheetFormatting() to correct it.
  if (u.getLastRow() > 1) {
    const sample = u.getRange(2, 1, 1, 6).getValues()[0];
    console.log("Users row 2 types — username:", typeof sample[0], "mobile:", typeof sample[4], "contact:", typeof sample[5]);
  }

  const p = getPaymentsSheet_();
  console.log("Payments rows:", p.getLastRow());
  if (p.getLastRow() > 1) {
    const sample = p.getRange(2, 4, 1, 2).getValues()[0];
    console.log("Payments row 2 types — mobile:", typeof sample[0], "txId:", typeof sample[1]);
  }

  const l = getLogsSheet_();
  console.log("Logs rows:", l.getLastRow());

  const s = getSettingsSheet_();
  console.log("Settings rows:", s.getLastRow());

  const settings = getSettings();
  console.log("Settings:", JSON.stringify(settings));
  const st = settings.settings || {};
  ["paymentAmount", "contactPhone", "trialHours"].forEach(k => {
    console.log("  " + k + ": typeof=" + typeof st[k] + " value=" + st[k]);
  });
  if (st.qrCodeUrl) {
    const isDataUri = String(st.qrCodeUrl).startsWith("data:image");
    console.log("  qrCodeUrl: " + (isDataUri
      ? "✅ stored as data:image URI (self-contained, always readable) — length " + st.qrCodeUrl.length
      : "⚠️ stored as an external link (" + st.qrCodeUrl + ") — Drive share links often fail to load for users; re-upload via admin.html's QR uploader instead"));
  } else {
    console.log("  qrCodeUrl: (not set yet)");
  }

  console.log("═══ END ═══");
  return "Diagnostic complete. Check logs.";
}

// Standalone check for a single Google Drive question-file ID (the kind
// pasted into chapters-data.js) — run testFileAccess("YOUR_FILE_ID") from
// the editor to confirm the script's account can actually read it and
// that it's valid JSON, before wiring it into chapters-data.js.
function testFileAccess(fileId) {
  const result = handleGetFile({ fileId: fileId });
  if (result.success) {
    const count = Array.isArray(result.result) ? result.result.length : Object.keys(result.result || {}).length;
    console.log("✅ File '" + fileId + "' is readable and valid JSON (" + count + " top-level items).");
  } else {
    console.log("❌ File '" + fileId + "' failed: " + result.error);
  }
  return result;
}
