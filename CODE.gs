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
   version.js on the client (single client-side source of truth — see
   that file's header — sw.js derives its cache name from it too, so
   bumping BOTH this constant and version.js's APP_VERSION together
   forces every open browser tab into a fresh session on next load). */
const APP_VERSION = "1.00";

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
const PUSHTOKENS_SHEET = "PushTokens";
const WEEKLYSETS_SHEET = "WeeklySets";
const QREPORTS_SHEET = "QuestionReports";

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

/* ── GETFILE RATE LIMIT ──────────────────────────────────────────
   handleGetFile (below) is deliberately the one action in this whole
   API that takes no username/token — it's a bare "fileId in, question
   JSON out" proxy, by design, so a logged-out visitor never gets stuck
   on a login wall just to see cached content their browser already
   fetched. But that also means it's the ONE action with no per-user
   identity to rate-limit against, and since this repo is public with
   every Drive fileId sitting in chapters-data.js on GitHub, someone
   could otherwise hit this endpoint directly, at any volume, without
   ever creating an account, and scrape the entire question bank.

   Rather than requiring auth here (a bigger behavior change, and one
   that would need to keep working for expired/offline users reading
   already-cached content), this is a single global sliding-window
   counter: one PropertiesService key holding {bucket, count}, reset
   whenever the current 60-second bucket rolls over. This deliberately
   does NOT try to distinguish callers (Apps Script's request object
   has no reliable caller IP) — it's a blunt, whole-API-wide ceiling,
   generous enough that real concurrent student traffic won't hit it,
   but low enough to blunt a bulk-scraping script. */
const GETFILE_RATE_LIMIT_PER_MINUTE = 120;

function checkGetFileRateLimit_() {
  const props = PropertiesService.getScriptProperties();
  const key = "getfile_rl";
  const bucket = Math.floor(Date.now() / 60000); // one 60-second window
  let state = { bucket, count: 0, logged: false };
  const raw = props.getProperty(key);
  if (raw) {
    try { state = JSON.parse(raw); } catch (e) {}
    if (state.bucket !== bucket) state = { bucket, count: 0, logged: false }; // new window — reset
  }
  state.count = (state.count || 0) + 1;
  const withinLimit = state.count <= GETFILE_RATE_LIMIT_PER_MINUTE;
  // Log the FIRST rejection per minute-bucket only — a sustained
  // scraping attempt would otherwise generate one log row per rejected
  // request (potentially hundreds/minute), which would itself flood the
  // Logs sheet and bury everything else in it. One entry per minute is
  // enough to make the pattern visible in Activity Logs without that
  // cost. logAction_ is already best-effort/never-throws, so this can't
  // break the rate limit check itself if logging fails.
  if (!withinLimit && !state.logged) {
    state.logged = true;
    logAction_("system", "GetFile Rate Limited", "", "Exceeded " + GETFILE_RATE_LIMIT_PER_MINUTE + " req/min — possible scraping. Further rejections this minute are not individually logged.");
  }
  props.setProperty(key, JSON.stringify(state));
  return withinLimit;
}

/* ── SIGNUP RATE LIMIT ────────────────────────────────────────────
   handleSignup has no email verification and no CAPTCHA — a mobile
   number just needs to match the Nepali format regex, it's never
   confirmed to be real. Without any throttle, a script could farm
   unlimited free-trial accounts automatically (each needs a unique
   username/email/mobile, but generating those programmatically is
   trivial), defeating the entire trial-then-pay model this app is
   built around. Same global sliding-window approach as
   checkGetFileRateLimit_ above (Apps Script has no reliable caller
   IP to rate-limit per-person against), but with a much lower
   threshold — a genuine person signs up exactly once, ever, so a
   burst of many signups in one minute is a far stronger abuse signal
   here than it would be for a read-only action like getFile.
   Threshold is generous enough for a realistic burst (a classroom
   signing up together during an orientation session) while still
   meaningfully slowing down automated mass account creation. */
const SIGNUP_RATE_LIMIT_PER_MINUTE = 15;

function checkSignupRateLimit_() {
  const props = PropertiesService.getScriptProperties();
  const key = "signup_rl";
  const bucket = Math.floor(Date.now() / 60000);
  let state = { bucket, count: 0, logged: false };
  const raw = props.getProperty(key);
  if (raw) {
    try { state = JSON.parse(raw); } catch (e) {}
    if (state.bucket !== bucket) state = { bucket, count: 0, logged: false };
  }
  state.count = (state.count || 0) + 1;
  const withinLimit = state.count <= SIGNUP_RATE_LIMIT_PER_MINUTE;
  if (!withinLimit && !state.logged) {
    state.logged = true;
    logAction_("system", "Signup Rate Limited", "", "Exceeded " + SIGNUP_RATE_LIMIT_PER_MINUTE + " signups/min — possible automated account farming. Further rejections this minute are not individually logged.");
  }
  props.setProperty(key, JSON.stringify(state));
  return withinLimit;
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

// One row per user's current FCM registration token. A user can only ever
// have ONE row here (unlike Progress, this isn't meant to accumulate
// history) — re-subscribing (new device, cleared browser data, token
// rotated by the browser) overwrites the existing row rather than adding
// a new one, since sendPushNotification_ only ever needs the LATEST
// token to reach a user, never their subscription history.
const PUSHTOKENS_HEADERS = ["username", "fcmToken", "updatedAt"];

// Admin uploads a question-bank fileId (same Drive fileId shape as
// chapters-data.js — read through the SAME handleGetFile proxy, so it
// gets the same rate limiting and read-only guarantees) together with a
// releaseAt timestamp, typically over the weekend, for a set that should
// only become solvable partway through the following week. status lets
// an admin retire a set from the user-facing list (listWeeklySets)
// without losing its row history — deleting is still available via
// adminDeleteWeeklySet for a genuine mistake, but archiving is the
// normal path once a set is no longer current.
//
// Deliberately does NOT store the question content itself — same
// reasoning as chapters-data.js: one Drive file is the single source of
// truth for a given set's questions, referenced by id everywhere else,
// so re-uploading a corrected file to the same Drive fileId propagates
// instantly without touching this sheet at all.
const WEEKLYSET_HEADERS = ["id", "title", "fileId", "chapterLabel", "status", "uploadedBy", "uploadedAt", "releaseAt"];

// A student's "Report" is deliberately separate from the existing
// "Flag" feature (which only ever meant "remind me to review this" —
// a personal study tool, never a content-quality signal). This is
// specifically for "something about this question itself is wrong."
// questionSnapshot stores the question text at report time (not just
// the uid) so an admin reviewing it later doesn't need to re-fetch
// the source Drive file just to see what was actually reported.
const QREPORT_HEADERS = ["id", "uid", "fileId", "questionSnapshot", "reason", "note", "reportedBy", "reportedAt", "status"];

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
      case "requestpasswordreset": result = requestPasswordReset(e.parameter); break;
      case "resetpassword":      result = resetPassword(e.parameter); break;
      case "checksession":       result = checkSession(e.parameter); break;
      case "saveprogress":       result = saveProgress(e.parameter); break;
      case "getprogress":        result = getProgress(e.parameter); break;
      case "savepushtoken":      result = savePushToken(e.parameter); break;
      case "listweeklysets":     result = listWeeklySets(e.parameter); break;
      case "reportquestion":     result = reportQuestion(e.parameter); break;

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
      case "admindownloadscreenshot": result = adminDownloadScreenshot(e.parameter); break;
      case "admingrantaccess":   result = adminGrantAccess(e.parameter); break;
      case "admingrantaccessbatch": result = adminGrantAccessBatch(e.parameter); break;
      case "adminupdateuser":    result = adminUpdateUser(e.parameter); break;
      case "admindeleteuser":    result = adminDeleteUser(e.parameter); break;
      case "admindeleteusersbatch": result = adminDeleteUsersBatch(e.parameter); break;
      case "admindeletepayment": result = adminDeletePayment(e.parameter); break;
      case "adminupdatesettings":result = adminUpdateSettings(e.parameter); break;
      case "adminupdatesettingsbatch": result = adminUpdateSettingsBatch(e.parameter); break;
      case "adminstats":         result = adminStats(e.parameter); break;
      case "adminmostmissedquestions": result = adminMostMissedQuestions(e.parameter); break;
      case "adminlistlogs":      result = adminListLogs(e.parameter); break;
      case "admincreateweeklyset": result = adminCreateWeeklySet(e.parameter); break;
      case "adminuploadweeklysetfile": result = adminUploadWeeklySetFile(e.parameter); break;
      case "adminupdateweeklyset": result = adminUpdateWeeklySet(e.parameter); break;
      case "admindeleteweeklyset": result = adminDeleteWeeklySet(e.parameter); break;
      case "adminlistweeklysets":  result = adminListWeeklySets(e.parameter); break;
      case "adminlistquestionreports": result = adminListQuestionReports(e.parameter); break;
      case "adminupdatequestionreportstatus": result = adminUpdateQuestionReportStatus(e.parameter); break;
      case "admindeletequestionreport": result = adminDeleteQuestionReport(e.parameter); break;

      default:
        result = {
          success: false,
          error: "Unknown action: '" + action + "'. Valid: ping, login, signup, requestPasswordReset, resetPassword, checkSession, saveProgress, getProgress, savePushToken, listWeeklySets, reportQuestion, submitPayment, getPaymentStatus, getSettings, getFile, adminLogin, adminChangePassword, adminListAdmins, adminCreateAdmin, adminDeleteAdmin, adminListUsers, adminListPayments, adminReviewPayment, adminReviewPaymentsBatch, adminDownloadScreenshot, adminGrantAccess, adminGrantAccessBatch, adminUpdateUser, adminDeleteUser, adminDeleteUsersBatch, adminDeletePayment, adminUpdateSettings, adminUpdateSettingsBatch, adminStats, adminMostMissedQuestions, adminListLogs, adminCreateWeeklySet, adminUploadWeeklySetFile, adminUpdateWeeklySet, adminDeleteWeeklySet, adminListWeeklySets, adminListQuestionReports, adminUpdateQuestionReportStatus, adminDeleteQuestionReport"
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
  getPushTokensSheet_();
  getWeeklySetsSheet_();
  getQReportsSheet_();
  initDefaultSettings_();
  ensurePushTriggers_();
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

// One shared "auto format" pass for every sheet: bold/colored header,
// frozen header row, alternating row bands (readable at a glance without
// manually shading), a border around the whole table, and capped
// auto-resized columns. Centralized here so every sheet gets the same
// treatment and a new sheet added later can't accidentally be left out
// (which is what happened before — Admins and Progress had header color
// but no banding/borders, and were missing entirely from
// fixSheetFormatting()'s retrofit pass).
//
// bandTheme must be one of SpreadsheetApp.BandingTheme (e.g. BLUE,
// GREEN, PURPLE, YELLOW, CYAN, ORANGE, RED, GREY) — pick the one that
// visually matches each sheet's existing header color so old sheets
// don't suddenly look like they belong to a different table.
function applyTableFormat_(sheet, headers, headerColor, bandTheme, maxWidthPx) {
  const numCols = headers.length;
  const maxRows = Math.max(1, sheet.getMaxRows() - 1);

  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, numCols)
    .setFontWeight("bold")
    .setBackground(headerColor)
    .setFontColor("white");

  // Banding needs a >1-row range (header + at least one data row) or
  // Sheets throws — on a brand-new sheet maxRows can be 0 rows tall in
  // practice-safe terms, so guard rather than let this throw on setup.
  const fullRange = sheet.getRange(1, 1, maxRows + 1, numCols);
  if (maxRows >= 1) {
    // Up to 2 attempts. A single flush isn't always enough to fully
    // settle a remove-then-reapply when many sheets are being created
    // and banded back-to-back in one execution (setup() creates and
    // bands all 8 sheets twice — once via getXSheet_(), once via
    // fixSheetFormatting()'s retrofit pass — in well under a minute,
    // which is enough rapid-fire structural activity that Sheets'
    // backend occasionally needs a second attempt to catch up, even
    // after a flush). The 400ms sleep only ever runs on a retry, not
    // on the normal/successful path, so this adds no delay when
    // banding just works the first time.
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        // Remove any existing banding on this sheet that overlaps our
        // target range — NOT just fullRange.getBandings() (which only
        // reliably catches bandings whose range exactly matches this
        // call's range). A previous run's banding can persist at a
        // slightly different extent, and Sheets refuses to apply new
        // banding anywhere it thinks old banding still overlaps,
        // throwing "Unexpected error...on object SpreadsheetApp.Range"
        // — a generic, unhelpful message for what is actually just
        // "banding already exists here".
        sheet.getBandings().forEach(b => {
          const r = b.getRange();
          const overlaps = r.getSheet().getSheetId() === sheet.getSheetId() &&
            r.getRow() <= fullRange.getLastRow() && r.getLastRow() >= fullRange.getRow() &&
            r.getColumn() <= fullRange.getLastColumn() && r.getLastColumn() >= fullRange.getColumn();
          if (overlaps) b.remove();
        });
        SpreadsheetApp.flush();
        const banding = fullRange.applyRowBanding(bandTheme, true, false);
        banding.setHeaderRowColor(headerColor);
        break; // success — don't consume the second attempt
      } catch (err) {
        if (attempt === 2) {
          // Banding is purely cosmetic — never let it abort setup()/
          // fixSheetFormatting(), which also seed the first admin
          // account and create every other sheet in the same run. Log
          // and move on; the sheet is still fully usable without
          // banding, just less pretty.
          console.error("applyTableFormat_: banding failed for '" + sheet.getName() + "' after 2 attempts — continuing without it:", err);
        } else {
          Utilities.sleep(400);
        }
      }
    }
  }
  fullRange.setBorder(true, true, true, true, true, true, "#d0d0d0", SpreadsheetApp.BorderStyle.SOLID);

  autoResizeCapped_(sheet, 1, numCols, maxWidthPx || 300);
}

function getUsersSheet_() {
  const spreadsheet = getSpreadsheet_();
  let sheet = spreadsheet.getSheetByName(USERS_SHEET);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(USERS_SHEET);
    sheet.appendRow(USER_HEADERS);
    // Force plain text on every column a person can type digits-only into —
    // otherwise Sheets silently converts it to a Number, which strips
    // leading zeros and can round or reformat long digit strings.
    // username=1 (a person can choose an all-digit username), mobile=5,
    // contact=6 (mirrors email OR mobile, so carries the same risk).
    const maxRows = sheet.getMaxRows() - 1;
    [1, 5, 6].forEach(col => sheet.getRange(2, col, maxRows, 1).setNumberFormat("@"));
    applyTableFormat_(sheet, USER_HEADERS, "#4285f4", SpreadsheetApp.BandingTheme.BLUE, 300);
  }
  return sheet;
}

function getPaymentsSheet_() {
  const spreadsheet = getSpreadsheet_();
  let sheet = spreadsheet.getSheetByName(PAYMENTS_SHEET);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(PAYMENTS_SHEET);
    sheet.appendRow(PAYMENT_HEADERS);
    // mobile=4 and txId=5 are both free-typed and frequently all-digits
    // (a transaction ID is very often numeric) — same auto-typing risk as
    // Users.mobile, and previously the actual cause of the payment-upload
    // crash. Force text on both so they're never silently coerced.
    const maxRows = sheet.getMaxRows() - 1;
    [4, 5].forEach(col => sheet.getRange(2, col, maxRows, 1).setNumberFormat("@"));
    applyTableFormat_(sheet, PAYMENT_HEADERS, "#34a853", SpreadsheetApp.BandingTheme.GREEN, 300);
  }
  return sheet;
}

function getSettingsSheet_() {
  const spreadsheet = getSpreadsheet_();
  let sheet = spreadsheet.getSheetByName(SETTINGS_SHEET);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(SETTINGS_SHEET);
    sheet.appendRow(SETTINGS_HEADERS);
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
    applyTableFormat_(sheet, SETTINGS_HEADERS, "#fbbc04", SpreadsheetApp.BandingTheme.YELLOW, 400);
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
    applyTableFormat_(sheet, LOG_HEADERS, "#9c27b0", SpreadsheetApp.BandingTheme.PURPLE, 320); // details=5 is free text and the usual outlier
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
    const maxRows = sheet.getMaxRows() - 1;
    sheet.getRange(2, 1, maxRows, 1).setNumberFormat("@"); // username, same all-digits protection as Users
    applyTableFormat_(sheet, ADMIN_HEADERS, "#ea4335", SpreadsheetApp.BandingTheme.RED, 300);

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
    const maxRows = sheet.getMaxRows() - 1;
    sheet.getRange(2, 1, maxRows, 1).setNumberFormat("@"); // username, same all-digits protection as Users
    applyTableFormat_(sheet, PROGRESS_HEADERS, "#0f9d58", SpreadsheetApp.BandingTheme.GREEN, 300);
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

function getWeeklySetsSheet_() {
  const spreadsheet = getSpreadsheet_();
  let sheet = spreadsheet.getSheetByName(WEEKLYSETS_SHEET);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(WEEKLYSETS_SHEET);
    sheet.appendRow(WEEKLYSET_HEADERS);
    const maxRows = sheet.getMaxRows() - 1;
    // id=1 and fileId=3 are both opaque tokens (a UUID and a Drive fileId)
    // that can start with digits — same all-digits protection as every
    // other id/fileId-shaped column elsewhere in this file.
    [1, 3].forEach(col => sheet.getRange(2, col, maxRows, 1).setNumberFormat("@"));
    applyTableFormat_(sheet, WEEKLYSET_HEADERS, "#00acc1", SpreadsheetApp.BandingTheme.CYAN, 320);
  }
  return sheet;
}

function findWeeklySetRow_(sheet, id) {
  if (!id) return null;
  const data = sheet.getDataRange().getValues();
  const target = String(id).trim();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === target) {
      return { rowIndex: i + 1, row: data[i] };
    }
  }
  return null;
}

function rowToWeeklySet_(row) {
  return {
    id: row[0] || "",
    title: row[1] || "",
    fileId: row[2] || "",
    chapterLabel: row[3] || "",
    status: row[4] || "active",
    uploadedBy: row[5] || "",
    uploadedAt: row[6] || "",
    releaseAt: row[7] || ""
  };
}

function getQReportsSheet_() {
  const spreadsheet = getSpreadsheet_();
  let sheet = spreadsheet.getSheetByName(QREPORTS_SHEET);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(QREPORTS_SHEET);
    sheet.appendRow(QREPORT_HEADERS);
    const maxRows = sheet.getMaxRows() - 1;
    // id/uid/fileId can all start with digits (UUID, uid=fileId_index,
    // Drive fileId) — same all-digits protection used everywhere else.
    [1, 2, 3].forEach(col => sheet.getRange(2, col, maxRows, 1).setNumberFormat("@"));
    applyTableFormat_(sheet, QREPORT_HEADERS, "#d81b60", SpreadsheetApp.BandingTheme.PINK, 340);
  }
  return sheet;
}

function findQReportRow_(sheet, id) {
  if (!id) return null;
  const data = sheet.getDataRange().getValues();
  const target = String(id).trim();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === target) {
      return { rowIndex: i + 1, row: data[i] };
    }
  }
  return null;
}

function rowToQReport_(row) {
  return {
    id: row[0] || "",
    uid: row[1] || "",
    fileId: row[2] || "",
    questionSnapshot: row[3] || "",
    reason: row[4] || "",
    note: row[5] || "",
    reportedBy: row[6] || "",
    reportedAt: row[7] || "",
    status: row[8] || "open"
  };
}

function getPushTokensSheet_() {
  const spreadsheet = getSpreadsheet_();
  let sheet = spreadsheet.getSheetByName(PUSHTOKENS_SHEET);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(PUSHTOKENS_SHEET);
    sheet.appendRow(PUSHTOKENS_HEADERS);
    const maxRows = sheet.getMaxRows() - 1;
    sheet.getRange(2, 1, maxRows, 1).setNumberFormat("@"); // username, same all-digits protection as Users
    applyTableFormat_(sheet, PUSHTOKENS_HEADERS, "#e67c00", SpreadsheetApp.BandingTheme.ORANGE, 300);
  }
  return sheet;
}

function findPushTokenRow_(sheet, username) {
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

/* ═══════════════════════════════════════════════════════════════
   PASSWORD RESET — request a token via email, then consume it
   ═══════════════════════════════════════════════════════════════ */

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const RESET_REQUEST_COOLDOWN_MS = 5 * 60 * 1000; // don't let one account's inbox get bombed by repeated requests

function resetTokenKey_(token) { return "pwreset_" + token; }
function resetCooldownKey_(username) { return "pwreset_cd_" + String(username).toLowerCase().trim(); }

// Accepts a username OR the email on file for that account (whichever
// the person actually remembers), generates a one-time token, and
// emails a reset link containing it via MailApp — no third-party email
// service needed, Apps Script's free MailApp quota (roughly 100/day on
// a consumer Google account) is enough at this app's current scale.
//
// ALWAYS returns success:true regardless of whether a matching account
// was actually found — this is deliberate, standard practice for
// password-reset endpoints: an error message that reveals "no account
// with that email" lets anyone enumerate which emails/usernames are
// registered. The person only ever sees "if that account exists, an
// email was sent", whether it was or wasn't.
function requestPasswordReset(p) {
  const identifier = String(p.identifier || p.username || p.email || "").trim();
  if (!identifier) return { success: false, error: "Enter your username or email." };

  const genericResponse = { success: true, message: "If that account exists, a reset link has been sent to its email address." };

  const sheet = getUsersSheet_();
  let found = findUserRow_(sheet, identifier); // try as username first
  if (!found) found = findUserByField_(sheet, 3, identifier); // then as email (column 3)
  if (!found) return genericResponse; // deliberately identical response — see comment above

  const username = found.row[0];
  const email = found.row[3];
  if (!email) return genericResponse; // account has no email on file to send to

  const cooldownKey = resetCooldownKey_(username);
  const props = PropertiesService.getScriptProperties();
  const lastRequestAt = Number(props.getProperty(cooldownKey) || 0);
  if (Date.now() - lastRequestAt < RESET_REQUEST_COOLDOWN_MS) {
    return genericResponse; // silently no-op on cooldown — same generic response, doesn't confirm/deny anything to a possible abuser
  }

  const token = Utilities.getUuid();
  props.setProperty(resetTokenKey_(token), JSON.stringify({ username, expiresAt: Date.now() + RESET_TOKEN_TTL_MS }));
  props.setProperty(cooldownKey, String(Date.now()));

  const resetUrl = ScriptApp.getService().getUrl().replace(/\/exec$/, "") + "/exec?resetToken=" + token;
  // NOTE: the link above points at THIS Apps Script web app URL, not the
  // actual hosted index.html — this app has no server-rendered pages to
  // redirect through. The email body below instead tells the person to
  // open the app and paste the code, which index.html's client-side
  // resetToken handling (checks both a pasted code AND a ?resetToken=
  // URL param, in case a future deploy does host index.html at a fixed
  // domain) already supports either way.
  try {
    MailApp.sendEmail({
      to: email,
      subject: "Reset your Abhyas password",
      body: `Hi ${found.row[2] || username},\n\n` +
        `Someone (hopefully you) requested a password reset for your Abhyas account (${username}).\n\n` +
        `Open the Abhyas app and paste this reset code when prompted:\n\n${token}\n\n` +
        `This code expires in 1 hour. If you didn't request this, you can safely ignore this email — your password hasn't been changed.`
    });
  } catch (err) {
    console.error("requestPasswordReset: MailApp send failed:", err);
    // Still return the generic success response — from the requester's
    // perspective this genuinely is indistinguishable from "no matching
    // account", and a specific "email failed to send" error would leak
    // the same account-existence signal this function otherwise protects.
  }

  return genericResponse;
}

// Consumes a reset token (one-time use — deleted immediately on success
// OR failure past this point, so a token can't be retried after a wrong
// attempt) and sets a new password for the account it was issued to.
function resetPassword(p) {
  const token = String(p.token || "").trim();
  const newPassword = p.newPassword || "";
  if (!token) return { success: false, error: "Reset code required." };
  if (!newPassword || newPassword.length < 6) {
    return { success: false, error: "New password must be at least 6 characters." };
  }

  const props = PropertiesService.getScriptProperties();
  const key = resetTokenKey_(token);
  const raw = props.getProperty(key);
  if (!raw) return { success: false, error: "This reset code is invalid or has already been used." };

  let state;
  try { state = JSON.parse(raw); } catch (e) { props.deleteProperty(key); return { success: false, error: "This reset code is invalid." }; }
  props.deleteProperty(key); // one-time use, consumed regardless of what happens next

  if (!state.expiresAt || Date.now() > state.expiresAt) {
    return { success: false, error: "This reset code has expired — request a new one." };
  }

  return withLock_(() => {
    const sheet = getUsersSheet_();
    const found = findUserRow_(sheet, state.username);
    if (!found) return { success: false, error: "Account not found." };

    const salt = makeSalt_();
    sheet.getRange(found.rowIndex, 2).setValue(salt + ":" + hashPassSalted_(newPassword, salt));
    // Invalidate any existing session so a device that had the OLD
    // password's session token doesn't stay logged in indefinitely
    // after a reset that was presumably triggered by losing control of
    // the account (or just forgetting the password) — force a fresh
    // login with the new password everywhere.
    sheet.getRange(found.rowIndex, 17).setValue("");
    sheet.getRange(found.rowIndex, 18).setValue("");
    clearLoginLock_("user", state.username); // a forgotten-password lockout shouldn't persist through a successful reset

    logAction_("system", "Password Reset", state.username, "Self-service reset via emailed code");
    return { success: true, username: state.username, message: "Password reset — please log in with your new password." };
  });
}

function handleSignup(p) {
  if (!checkSignupRateLimit_()) {
    return { success: false, error: "Too many signups right now, please try again in a minute." };
  }
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
  if (!checkGetFileRateLimit_()) {
    return { success: false, error: "Server is busy, please try again in a moment.", rateLimited: true };
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

// ── PAYMENT SCREENSHOT DOWNLOAD PROXY (ADMIN ONLY, READ-ONLY) ──
// admin.html previously linked straight to Drive's file.getDownloadUrl()
// in a plain <a target="_blank">. For an image, that URL's response has
// no Content-Disposition: attachment header, so browsers just render it
// inline in a new tab instead of downloading it — clicking "View
// Screenshot" never actually saved a file, no matter what the link text
// said. The same fetch()-can't-read-a-plain-Drive-link problem that
// handleGetFile works around for question JSON applies here too, so this
// uses the identical pattern: read the file server-side with DriveApp
// (works regardless of the file's public sharing setting, as long as the
// script owner's account can see it), hand back base64 + mimeType, and
// let the client turn that into a real same-origin blob: URL, which
// browsers WILL respect a download attribute on.
//
// Accepts EITHER a bare fileId or the full getDownloadUrl() string
// already stored in the Payments sheet's screenshotUrl column (so this
// works against every existing row without a schema migration) — the
// fileId is extracted from the URL's `id=` query param if a full URL is
// passed. Admin-gated via checkAdmin_ since payment screenshots can
// contain a student's personal payment app UI (name, phone, bank details
// depending on what they screenshotted), not just a bare transaction ID.
function adminDownloadScreenshot(p) {
  if (!checkAdmin_(p)) return { success: false, error: "Admin auth failed." };

  let fileId = String(p.fileId || "").trim();
  if (!fileId && p.url) {
    const match = String(p.url).match(/[?&]id=([^&]+)/);
    if (match) fileId = decodeURIComponent(match[1]);
  }
  if (!fileId) return { success: false, error: "Missing fileId or url parameter." };

  let file;
  try {
    file = DriveApp.getFileById(fileId);
  } catch (err) {
    return { success: false, error: "Could not open screenshot file. It may have been deleted or moved. (" + (err.message || err) + ")" };
  }

  let blob;
  try {
    blob = file.getBlob();
  } catch (err) {
    return { success: false, error: "Could not read screenshot contents: " + (err.message || err) };
  }

  return {
    success: true,
    base64: Utilities.base64Encode(blob.getBytes()),
    mimeType: blob.getContentType() || "image/png",
    filename: file.getName() || "payment_screenshot.png"
  };
}

/* ═══════════════════════════════════════════════════════════════
   PUSH NOTIFICATIONS — Firebase Cloud Messaging (FCM)
   ───────────────────────────────────────────────────────────────
   SETUP REQUIRED (one-time, must be done by a project owner in the
   Apps Script editor — nothing here works until this is done):

   1. Create a Firebase project at console.firebase.google.com (free
      tier). Project Settings → Cloud Messaging → note the Sender ID.
      Project Settings → Cloud Messaging → Web configuration →
      generate a "Web Push certificate" (this is a VAPID key pair —
      copy the public key into firebase-config.js on the client).
   2. Project Settings → Service Accounts → "Generate new private
      key" — downloads a JSON file. NEVER commit this file or its
      contents to the repo (it's public on GitHub). Instead:
   3. In the Apps Script editor: Project Settings (gear icon) →
      Script Properties → add three properties from that JSON file:
        FCM_PROJECT_ID    = the "project_id" field
        FCM_CLIENT_EMAIL  = the "client_email" field
        FCM_PRIVATE_KEY   = the full "private_key" field, INCLUDING
                            the -----BEGIN/END PRIVATE KEY----- lines
   Every function below reads these via PropertiesService — if any
   are missing, sendPushNotification_ fails loudly with a clear error
   naming which property is unset, rather than silently doing nothing.
   ═══════════════════════════════════════════════════════════════ */

// Google's service-account OAuth flow needs a JWT signed with RS256
// (RSA) — NOT the ES256/elliptic-curve signing that raw Web Push's own
// VAPID auth requires. Apps Script's Utilities class has no EC signing
// at all, which is what makes implementing Web Push directly in Apps
// Script impractical — but it DOES have computeRsaSha256Signature,
// which is exactly what RS256 needs. That's what makes going through
// FCM (rather than raw Web Push) actually buildable here.
function getFcmAccessToken_() {
  const props = PropertiesService.getScriptProperties();
  const clientEmail = props.getProperty("FCM_CLIENT_EMAIL");
  const privateKey = props.getProperty("FCM_PRIVATE_KEY");
  if (!clientEmail || !privateKey) {
    throw new Error("Push notifications not configured: missing FCM_CLIENT_EMAIL or FCM_PRIVATE_KEY in Script Properties. See the setup comment above sendPushNotification_.");
  }

  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claimSet = {
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now
  };

  const b64url = obj => Utilities.base64EncodeWebSafe(JSON.stringify(obj)).replace(/=+$/, "");
  const unsigned = b64url(header) + "." + b64url(claimSet);
  const signatureBytes = Utilities.computeRsaSha256Signature(unsigned, privateKey);
  const signature = Utilities.base64EncodeWebSafe(signatureBytes).replace(/=+$/, "");
  const jwt = unsigned + "." + signature;

  const resp = UrlFetchApp.fetch("https://oauth2.googleapis.com/token", {
    method: "post",
    contentType: "application/x-www-form-urlencoded",
    payload: {
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt
    },
    muteHttpExceptions: true
  });
  const body = JSON.parse(resp.getContentText());
  if (!body.access_token) {
    throw new Error("Could not get FCM access token: " + (body.error_description || resp.getContentText()));
  }
  return body.access_token;
}

// Sends one push notification to one user's most recently registered
// device (see PUSHTOKENS_HEADERS — only the latest token is kept, not a
// history). Best-effort by design: every call site below wraps this in
// try/catch, because a failed push should never break the underlying
// action (payment review, signup, etc.) that triggered it. A stale/
// invalid token (UNREGISTERED, from an uninstalled PWA or revoked
// permission) is treated as a normal "nothing to do" case, not an error
// worth surfacing — FCM returns that as a 404/400 from the send call.
// Raw FCM send to a single already-known token — no sheet lookup, no
// username involved. Factored out of sendPushNotification_ so a
// broadcast-to-everyone job (see broadcastPushToAll_ below, used for
// weekly-set unlock notifications) doesn't have to re-scan PushTokens
// once per recipient just to get back to this same HTTP call.
function _fcmSendToToken(accessToken, projectId, token, title, body) {
  const resp = UrlFetchApp.fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + accessToken },
    payload: JSON.stringify({
      message: {
        token,
        notification: { title, body },
        webpush: { fcm_options: { link: "/" } }
      }
    }),
    muteHttpExceptions: true
  });
  const result = JSON.parse(resp.getContentText() || "{}");
  if (resp.getResponseCode() >= 400) {
    const isUnregistered = result.error && result.error.details &&
      result.error.details.some(d => d.errorCode === "UNREGISTERED");
    return { success: false, unregistered: !!isUnregistered, error: (result.error && result.error.message) || resp.getContentText() };
  }
  return { success: true };
}

function sendPushNotification_(username, title, body) {
  const sheet = getPushTokensSheet_();
  const found = findPushTokenRow_(sheet, username);
  if (!found || !found.row[1]) return { success: false, error: "No push token on file for this user." };

  const projectId = PropertiesService.getScriptProperties().getProperty("FCM_PROJECT_ID");
  if (!projectId) return { success: false, error: "Push notifications not configured: missing FCM_PROJECT_ID." };

  let accessToken;
  try {
    accessToken = getFcmAccessToken_();
  } catch (err) {
    console.error("sendPushNotification_ auth failed:", err);
    return { success: false, error: err.message || String(err) };
  }

  const result = _fcmSendToToken(accessToken, projectId, found.row[1], title, body);
  if (!result.success) {
    // UNREGISTERED means the token is dead (uninstalled, permission revoked,
    // browser data cleared) — clean it up so future attempts don't keep
    // hitting the same dead end.
    if (result.unregistered) sheet.deleteRow(found.rowIndex);
    return { success: false, error: result.error };
  }
  return { success: true };
}

// Sends the same notification to EVERY registered device — used for
// announcements that aren't about one specific user's account state
// (unlike checkTrialExpiryWarnings, which is inherently per-user). A
// weekly set unlocking is the first thing that needs this, but it's
// written generically since any future "tell everyone" notification
// can reuse it as-is.
//
// Runs sequentially rather than in parallel — Apps Script's
// UrlFetchApp has no built-in concurrency primitive, and FCM's
// messages:send endpoint is one-token-per-call, so this is the
// straightforward approach at the scale this app runs at. If the
// registered-device count ever grows large enough for this to risk
// the 6-minute execution ceiling, this would need batching (FCM does
// support a batch send endpoint) — not implemented here since it's
// not a real risk yet at this app's current scale.
function broadcastPushToAll_(title, body) {
  const sheet = getPushTokensSheet_();
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { success: true, sent: 0, failed: 0 };

  const projectId = PropertiesService.getScriptProperties().getProperty("FCM_PROJECT_ID");
  if (!projectId) return { success: false, error: "Push notifications not configured: missing FCM_PROJECT_ID." };

  let accessToken;
  try {
    accessToken = getFcmAccessToken_();
  } catch (err) {
    console.error("broadcastPushToAll_ auth failed:", err);
    return { success: false, error: err.message || String(err) };
  }

  let sent = 0, failed = 0;
  const deadRows = []; // collect first, delete after the loop — deleteRow mid-iteration would shift indices out from under us
  for (let i = 1; i < data.length; i++) {
    const token = data[i][1];
    if (!token) continue;
    const result = _fcmSendToToken(accessToken, projectId, token, title, body);
    if (result.success) sent++;
    else {
      failed++;
      if (result.unregistered) deadRows.push(i + 1);
    }
  }
  // Delete highest row index first so earlier indices in this same
  // batch stay valid as each deleteRow shifts everything below it up.
  deadRows.sort((a, b) => b - a).forEach(rowIndex => sheet.deleteRow(rowIndex));

  return { success: true, sent, failed };
}

// Called from the client right after the browser grants Notification
// permission and Firebase hands back an FCM registration token (see
// user.html's PUSH module). Auth mirrors saveProgress/getProgress — a
// valid session token, not just a matching username — since a forged
// call here could otherwise redirect another user's notifications to an
// attacker's own device.
function savePushToken(p) {
  const username = String(p.username || "").trim();
  const token = String(p.fcmToken || "").trim();
  if (!username || !token) return { success: false, error: "Username and fcmToken required." };

  const userSheet = getUsersSheet_();
  const userFound = findUserRow_(userSheet, username);
  if (!userFound) return { success: false, error: "User not found." };
  if (!verifyUserToken_(userFound, p.token)) {
    return { success: false, error: "Session expired. Please log in again.", sessionInvalid: true };
  }

  return withLock_(() => {
    const sheet = getPushTokensSheet_();
    const found = findPushTokenRow_(sheet, username);
    const now = new Date().toISOString();
    if (found) {
      sheet.getRange(found.rowIndex, 2, 1, 2).setValues([[token, now]]);
    } else {
      sheet.appendRow([username, token, now]);
    }
    return { success: true };
  });
}

// Scans for users whose trial expires within the next TRIAL_WARNING_WINDOW_MS
// and haven't been warned yet (tracked in PropertiesService, not a sheet
// column — same lightweight pattern as the login-lockout tracking above).
// Intended to run on a time-driven trigger (see ensurePushTriggers_ below),
// not called directly from doGet — there's no user-facing action for this,
// it's purely a scheduled background job.
const TRIAL_WARNING_WINDOW_MS = 2 * 60 * 60 * 1000; // warn when ≤2h left

function checkTrialExpiryWarnings() {
  const sheet = getUsersSheet_();
  const data = sheet.getDataRange().getValues();
  const props = PropertiesService.getScriptProperties();
  const now = Date.now();
  let sent = 0;

  for (let i = 1; i < data.length; i++) {
    const status = data[i][7];
    const username = data[i][0];
    const trialExpiresAt = data[i][11] ? new Date(data[i][11]).getTime() : null;
    if (status !== "trial" || !trialExpiresAt) continue;

    const msLeft = trialExpiresAt - now;
    if (msLeft <= 0 || msLeft > TRIAL_WARNING_WINDOW_MS) continue;

    const warnKey = "trialwarned_" + String(username).toLowerCase();
    if (props.getProperty(warnKey)) continue; // already warned this user for this trial

    try {
      const result = sendPushNotification_(username, "Your trial is ending soon",
        "Your Abhyas trial expires in under 2 hours. Complete payment to keep your access.");
      if (result.success) { props.setProperty(warnKey, "1"); sent++; }
    } catch (err) {
      console.error("checkTrialExpiryWarnings failed for " + username + ":", err);
    }
  }
  if (sent) console.log("Sent " + sent + " trial-expiry warning(s).");
  return "Checked. Sent " + sent + " warning(s).";
}

// Scans WeeklySets for anything that just crossed its releaseAt since
// the last check, and broadcasts one notification per newly-unlocked
// set to every registered device. "Just crossed" is tracked the same
// way trial warnings are — a PropertiesService flag per set id — so
// this can safely run every few minutes without re-notifying everyone
// each time it runs; each set fires exactly once, the first check
// after its release moment passes.
function checkWeeklySetUnlocks_() {
  const sheet = getWeeklySetsSheet_();
  const data = sheet.getDataRange().getValues();
  const props = PropertiesService.getScriptProperties();
  const now = Date.now();
  let notified = 0;

  for (let i = 1; i < data.length; i++) {
    const s = rowToWeeklySet_(data[i]);
    if (s.status !== "active") continue; // an archived-before-release set was cancelled — never notify for it
    const releaseTime = new Date(s.releaseAt).getTime();
    if (isNaN(releaseTime) || now < releaseTime) continue; // not released yet

    const notifyKey = "wsnotified_" + s.id;
    if (props.getProperty(notifyKey)) continue; // already notified for this set

    try {
      const result = broadcastPushToAll_("New weekly set unlocked! 🎉",
        s.title + (s.chapterLabel ? " — " + s.chapterLabel : "") + " is now available to solve.");
      if (result.success) {
        props.setProperty(notifyKey, "1");
        notified++;
        logAction_("system", "Weekly Set Unlock Notification", s.title, `Sent to ${result.sent}, failed ${result.failed}`);
      }
    } catch (err) {
      console.error("checkWeeklySetUnlocks_ failed for " + s.id + ":", err);
    }
  }
  if (notified) console.log("Sent unlock notifications for " + notified + " weekly set(s).");
  return "Checked. Notified for " + notified + " newly-unlocked set(s).";
}

// Creates the time-driven trigger for checkTrialExpiryWarnings if one
// doesn't already exist — called from setup() so a fresh deploy gets
// this automatically, but safe to re-run any time without creating
// duplicate triggers (which would send duplicate warnings).
function ensurePushTriggers_() {
  const already = ScriptApp.getProjectTriggers()
    .some(t => t.getHandlerFunction() === "checkTrialExpiryWarnings");
  if (!already) ScriptApp.newTrigger("checkTrialExpiryWarnings").timeBased().everyMinutes(30).create();

  const weeklyAlready = ScriptApp.getProjectTriggers()
    .some(t => t.getHandlerFunction() === "checkWeeklySetUnlocks_");
  if (!weeklyAlready) ScriptApp.newTrigger("checkWeeklySetUnlocks_").timeBased().everyMinutes(15).create();
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

  // The seed account's credentials are printed in this very source file's
  // comments (ADMIN_SEED_USERNAME/PASSWORD above) — anyone who's ever seen
  // this repo knows them. There was previously nothing stopping that
  // account from staying on "ChangeMe123!" forever; this flag lets the
  // client force a password-change prompt on login instead of just
  // hoping the deploying admin remembers the warning comment. Checked
  // against the RAW password the caller just typed (not the stored hash)
  // since that's the only point this script ever sees it in plaintext —
  // once changed, verifyPassword_ above would have already failed against
  // this literal string, so this check naturally stops firing forever.
  const stillOnSeedPassword = username.toLowerCase() === ADMIN_SEED_USERNAME.toLowerCase()
    && password === ADMIN_SEED_PASSWORD;

  return {
    success: true,
    isAdmin: true,
    adminToken: token,
    mustChangePassword: stillOnSeedPassword,
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

  // Best-effort: a push failure (no token on file, FCM not configured
  // yet, etc.) should never make the review itself fail or roll back —
  // the payment status change above is the important part and always
  // succeeds regardless of notification outcome.
  if (status === "verified" || status === "rejected") {
    try {
      sendPushNotification_(username,
        status === "verified" ? "Payment verified! 🎉" : "Payment rejected",
        status === "verified"
          ? "Your payment has been verified. You now have full access to Abhyas."
          : "Your payment was rejected" + (rejectionReason ? ": " + rejectionReason : ". Please check and resubmit."));
    } catch (err) {
      console.error("Push notification failed for " + username + ":", err);
    }
  }

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
    let paymentsChanged = false, usersChanged = false;

    // Same optimization as adminGrantAccessBatch: mutate the
    // already-loaded 2D arrays in memory instead of a getRange()+
    // setValue() round-trip per column per row (up to 9 individual API
    // calls per user here — 3 on Payments, up to 6 on Users), then
    // write each sheet back ONCE at the end regardless of batch size.
    usernames.forEach(rawUsername => {
      const username = String(rawUsername || "").trim();
      const payRow = payRowByUser[username.toLowerCase()];
      if (!payRow) { results.push({ username, success: false, error: "Payment not found." }); return; }

      const pRow = payData[payRow - 1];
      pRow[6] = status;                                              // column 7
      if (rejectionReason && status === "rejected") pRow[7] = rejectionReason; // column 8
      pRow[10] = nowIso;                                             // column 11
      paymentsChanged = true;

      const userRow = userRowByUser[username.toLowerCase()];
      if (userRow) {
        const uRow = userData[userRow - 1];
        if (status === "verified") {
          uRow[7] = "active"; uRow[12] = "verified"; uRow[13] = "true";
          uRow[9] = nowIso; uRow[14] = "permanent"; uRow[15] = "";
        } else if (status === "rejected") {
          uRow[7] = "expired"; uRow[12] = "rejected"; uRow[13] = "false";
        }
        usersChanged = true;
      }

      results.push({ username, success: true });
    });

    if (paymentsChanged) paymentSheet.getRange(1, 1, payData.length, payData[0].length).setValues(payData);
    if (usersChanged) userSheet.getRange(1, 1, userData.length, userData[0].length).setValues(userData);

    const okCount = results.filter(r => r.success).length;
    logAction_(actor, "Bulk Review Payment", usernames.join(", "),
      "Status: " + status + (rejectionReason ? " (" + rejectionReason + ")" : "") + " — " + okCount + "/" + usernames.length + " succeeded");

    // Same best-effort push as the single-record adminReviewPayment —
    // one notification per successfully-updated user, never blocking or
    // failing the batch itself.
    if (status === "verified" || status === "rejected") {
      results.filter(r => r.success).forEach(r => {
        try {
          sendPushNotification_(r.username,
            status === "verified" ? "Payment verified! 🎉" : "Payment rejected",
            status === "verified"
              ? "Your payment has been verified. You now have full access to Abhyas."
              : "Your payment was rejected" + (rejectionReason ? ": " + rejectionReason : ". Please check and resubmit."));
        } catch (err) {
          console.error("Push notification failed for " + r.username + ":", err);
        }
      });
    }

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

// Batched sibling of adminGrantAccess() above, same rationale as
// adminReviewPaymentsBatch() for payments: one Users read turned into a
// lookup map, applied to every selected username in one execution,
// instead of the admin panel firing N sequential adminGrantAccess
// requests for a multi-select "grant access" action.
function adminGrantAccessBatch(p) {
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

  const duration = String(p.duration || "").trim();
  if (!["permanent", "year"].includes(duration)) {
    return { success: false, error: "Duration must be 'permanent' or 'year'." };
  }

  return withLock_(() => {
    const sheet = getUsersSheet_();
    const data = sheet.getDataRange().getValues();
    const rowByUser = {};
    for (let i = 1; i < data.length; i++) {
      rowByUser[String(data[i][0]).toLowerCase().trim()] = i + 1;
    }

    let expiresAtIso = "";
    if (duration === "year") {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 365);
      expiresAtIso = expiresAt.toISOString();
    }
    const nowIso = new Date().toISOString();
    const results = [];
    let anyChanged = false;

    // Mutate the already-loaded 2D array in memory (zero API cost per
    // access) instead of one getRange()+setValue() round-trip per
    // column per user — for a 50-user batch that was up to 300
    // individual Sheets API calls; this is the same 300 mutations
    // against a plain JS array, then ONE setValues() write for the
    // whole sheet at the end, regardless of batch size.
    usernames.forEach(rawUsername => {
      const username = String(rawUsername || "").trim();
      const rowIndex = rowByUser[username.toLowerCase()];
      if (!rowIndex) { results.push({ username, success: false, error: "User not found." }); return; }

      const row = data[rowIndex - 1]; // data is 0-indexed, sheet rows are 1-indexed
      row[7] = "active";              // column 8
      row[9] = nowIso;                // column 10
      row[12] = "verified";           // column 13
      row[13] = "true";               // column 14
      row[14] = duration === "year" ? "yearly" : "permanent"; // column 15
      row[15] = expiresAtIso;         // column 16
      anyChanged = true;

      results.push({ username, success: true });
    });

    if (anyChanged) {
      sheet.getRange(1, 1, data.length, data[0].length).setValues(data);
    }

    const okCount = results.filter(r => r.success).length;
    logAction_(actor, "Bulk Grant Access", usernames.join(", "),
      "Duration: " + duration + " — " + okCount + "/" + usernames.length + " succeeded");

    return { success: true, duration, accessExpiresAt: expiresAtIso, results };
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

// Batched sibling of adminDeleteUser() above. Row indices are deleted
// HIGH-TO-LOW deliberately — deleteRow() shifts every row below it up by
// one, so deleting in the order the rows were originally found (low to
// high) would silently delete the WRONG row for every username after the
// first one. Sorting descending first means each deleteRow() only ever
// affects rows that haven't been touched yet.
function adminDeleteUsersBatch(p) {
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

  return withLock_(() => {
    const sheet = getUsersSheet_();
    const data = sheet.getDataRange().getValues();
    const rowByUser = {};
    for (let i = 1; i < data.length; i++) {
      rowByUser[String(data[i][0]).toLowerCase().trim()] = i + 1;
    }

    const results = [];
    const toDelete = []; // [{username, rowIndex}]
    usernames.forEach(rawUsername => {
      const username = String(rawUsername || "").trim();
      const rowIndex = rowByUser[username.toLowerCase()];
      if (!rowIndex) { results.push({ username, success: false, error: "User not found." }); return; }
      toDelete.push({ username, rowIndex });
    });

    toDelete.sort((a, b) => b.rowIndex - a.rowIndex); // high-to-low, see comment above
    toDelete.forEach(({ username, rowIndex }) => {
      sheet.deleteRow(rowIndex);
      results.push({ username, success: true });
    });

    const okCount = results.filter(r => r.success).length;
    logAction_(actor, "Bulk Delete User", usernames.join(", "),
      okCount + "/" + usernames.length + " succeeded");

    return { success: true, results };
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

// Aggregates per-question wrong/total attempt counts across EVERY
// user's synced progress data, to surface which specific questions
// are tripping students up most often — the single most actionable
// signal for improving question quality, and previously invisible
// entirely (per-user wrong-answer data existed, but nothing ever
// aggregated it across students).
//
// Deliberately stays Drive-free: this only reads the Progress sheet
// and parses each row's already-stored JSON blob, tallying by the
// question uid string (fileId_index — see normQ() in app.js) without
// ever resolving what that uid actually IS. Resolving a uid into
// readable question text requires reading the source Drive file,
// which is comparatively expensive (network I/O) and only worth
// doing for the tiny number of TOP results an admin will actually
// look at — that resolution happens client-side in admin.html,
// reusing the existing getFile action, once per unique fileId among
// the top results actually shown.
//
// A session's qres[] only exists on sessions recorded after this
// feature shipped, and each user's sessions array is capped at their
// most recent 50 — so this is a rolling recent-activity signal, not a
// complete historical record. Still highly actionable: it reflects
// what students are struggling with lately, which is exactly the
// window that matters for deciding what to fix or clarify next.
function adminMostMissedQuestions(p) {
  if (!checkAdmin_(p)) return { success: false, error: "Admin auth failed." };
  const minAttempts = Math.max(1, Number(p.minAttempts) || 3);
  const limit = Math.min(100, Math.max(1, Number(p.limit) || 30));

  const sheet = getProgressSheet_();
  const data = sheet.getDataRange().getValues();
  const tally = {}; // uid -> {wrong, total}

  for (let i = 1; i < data.length; i++) {
    const raw = data[i][1]; // data column
    if (!raw) continue;
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) { continue; } // one corrupted row shouldn't kill the whole aggregate
    const sessions = (parsed && parsed.prog && Array.isArray(parsed.prog.sessions)) ? parsed.prog.sessions : [];
    sessions.forEach(sess => {
      if (!Array.isArray(sess.qres)) return;
      sess.qres.forEach(qr => {
        if (!qr || !qr.uid) return;
        if (!tally[qr.uid]) tally[qr.uid] = { wrong: 0, total: 0 };
        tally[qr.uid].total++;
        if (!qr.ok) tally[qr.uid].wrong++;
      });
    });
  }

  const results = Object.keys(tally)
    .map(uid => {
      const t = tally[uid];
      // uid = fileId_index — index is always a plain integer with no
      // extra characters, but Drive fileIds can themselves contain
      // underscores, so splitting on the FIRST underscore would break.
      // Matching a trailing _<digits> and treating everything before
      // it as the fileId is unambiguous regardless of how many
      // underscores the fileId itself contains.
      const m = uid.match(/^(.+)_(\d+)$/);
      return {
        uid,
        fileId: m ? m[1] : uid,
        index: m ? Number(m[2]) : null,
        wrong: t.wrong,
        total: t.total,
        wrongRate: t.total ? Math.round((t.wrong / t.total) * 100) : 0
      };
    })
    .filter(r => r.total >= minAttempts && r.fileId !== 'local') // exclude locally-imported files — no shared fileId to resolve text from
    .sort((a, b) => b.wrongRate - a.wrongRate || b.total - a.total)
    .slice(0, limit);

  return { success: true, results, minAttempts };
}

/* ═══════════════════════════════════════════════════════════════
   WEEKLY SETS — admin uploads a fileId over the weekend, scheduled to
   unlock on a specific date/time (typically the following Wednesday).
   ═══════════════════════════════════════════════════════════════ */

// Uploads the actual question-bank JSON to a dedicated Drive folder and
// hands back the resulting fileId — the admin panel calls this FIRST
// (from a plain <input type=file>, base64-encoded client-side), then
// passes the returned fileId into adminCreateWeeklySet below. This
// means an admin no longer needs to separately upload to Drive by hand
// and copy a fileId over — same pattern as submitPayment's screenshot
// upload (getOrCreateFolder_ + createFile), except the resulting file
// is set to ANYONE_WITH_LINK so it reads through handleGetFile exactly
// like every chapters-data.js fileId already does.
//
// Deliberately validates the upload is parseable JSON before it ever
// reaches Drive — an admin fat-fingering the wrong file (a screenshot,
// a .docx) fails immediately with a clear error instead of silently
// creating a WeeklySets row that points at unreadable content.
function adminUploadWeeklySetFile(p) {
  const actor = checkAdmin_(p);
  if (!actor) return { success: false, error: "Admin auth failed." };

  const fileData = String(p.fileData || "");
  const filename = String(p.filename || "weeklyset.json").trim();
  if (!fileData) return { success: false, error: "No file data provided." };

  let jsonText;
  try {
    // Accept either a raw data: URI (from <input type=file> + FileReader)
    // or already-decoded plain text, so this also works for a future
    // "paste JSON directly" admin UI path without changing this function.
    jsonText = fileData.startsWith("data:")
      ? Utilities.newBlob(Utilities.base64Decode(fileData.split(",")[1])).getDataAsString("UTF-8")
      : fileData;
    JSON.parse(jsonText); // validate only — never modify/re-serialize the student's original file
  } catch (e) {
    return { success: false, error: "That file isn't valid JSON — check it's the same format as other question-bank files before uploading." };
  }

  try {
    const blob = Utilities.newBlob(jsonText, "application/json", filename);
    const folder = getOrCreateFolder_("WeeklySets");
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    logAction_(actor, "Upload Weekly Set File", filename, "fileId: " + file.getId());
    return { success: true, fileId: file.getId(), filename: file.getName() };
  } catch (e) {
    return { success: false, error: "Drive upload failed: " + (e.message || e) };
  }
}

// fileId here is normally the RESULT of adminUploadWeeklySetFile above
// (upload-then-create, two calls from the admin panel) — kept as a
// separate parameter rather than folding the upload into this function
// so an admin can still paste an existing chapters-data.js-style fileId
// directly here too, without a redundant re-upload of content that's
// already on Drive.
function adminCreateWeeklySet(p) {
  const actor = checkAdmin_(p);
  if (!actor) return { success: false, error: "Admin auth failed." };

  const title = String(p.title || "").trim();
  const fileId = String(p.fileId || "").trim();
  const chapterLabel = String(p.chapterLabel || "").trim();
  const releaseAtRaw = String(p.releaseAt || "").trim();

  if (!title) return { success: false, error: "Title required." };
  if (!fileId) return { success: false, error: "Drive fileId required." };

  const releaseAt = new Date(releaseAtRaw);
  if (!releaseAtRaw || isNaN(releaseAt)) {
    return { success: false, error: "A valid release date/time is required." };
  }

  return withLock_(() => {
    const sheet = getWeeklySetsSheet_();
    // Non-blocking check, same philosophy as adminListPayments' duplicate
    // txId flag: a re-used fileId is USUALLY a genuine mistake (an admin
    // accidentally re-uploading, or copy-pasting the wrong existing
    // fileId under "advanced") rather than something to actively
    // prevent, so this warns rather than rejects — an admin might
    // legitimately want the same file to appear as two differently-
    // timed sets in rare cases.
    const existing = sheet.getDataRange().getValues();
    let duplicateOf = null;
    for (let i = 1; i < existing.length; i++) {
      if (String(existing[i][2]).trim() === fileId) { duplicateOf = existing[i][1]; break; } // column 3 (index 2) = fileId, column 2 (index 1) = title
    }

    const id = Utilities.getUuid();
    const now = new Date().toISOString();
    sheet.appendRow([id, title, fileId, chapterLabel, "active", actor, now, releaseAt.toISOString()]);
    logAction_(actor, "Create Weekly Set", title, "Releases: " + releaseAt.toISOString() + (duplicateOf ? " — WARNING: fileId already used by \"" + duplicateOf + "\"" : ""));
    return {
      success: true,
      id,
      title,
      releaseAt: releaseAt.toISOString(),
      duplicateWarning: duplicateOf ? `This fileId is already used by weekly set "${duplicateOf}" — double check this wasn't a mistake.` : null
    };
  });
}

// Partial update — only fields present in p are changed, so the admin
// panel can send just {id, status:'archived'} to retire a set without
// having to resend title/fileId/releaseAt it already had.
function adminUpdateWeeklySet(p) {
  const actor = checkAdmin_(p);
  if (!actor) return { success: false, error: "Admin auth failed." };
  const id = String(p.id || "").trim();
  if (!id) return { success: false, error: "id required." };

  return withLock_(() => {
    const sheet = getWeeklySetsSheet_();
    const found = findWeeklySetRow_(sheet, id);
    if (!found) return { success: false, error: "Weekly set not found." };

    const changes = [];
    if (p.title !== undefined) { sheet.getRange(found.rowIndex, 2).setValue(String(p.title).trim()); changes.push("title"); }
    if (p.fileId !== undefined) { sheet.getRange(found.rowIndex, 3).setValue(String(p.fileId).trim()); changes.push("fileId"); }
    if (p.chapterLabel !== undefined) { sheet.getRange(found.rowIndex, 4).setValue(String(p.chapterLabel).trim()); changes.push("chapterLabel"); }
    if (p.status !== undefined && ["active", "archived"].includes(p.status)) { sheet.getRange(found.rowIndex, 5).setValue(p.status); changes.push("status→" + p.status); }
    if (p.releaseAt !== undefined) {
      const d = new Date(p.releaseAt);
      if (isNaN(d)) return { success: false, error: "Invalid release date/time." };
      sheet.getRange(found.rowIndex, 8).setValue(d.toISOString());
      changes.push("releaseAt→" + d.toISOString());
    }

    logAction_(actor, "Update Weekly Set", id, changes.join(", "));
    return { success: true, id };
  });
}

function adminDeleteWeeklySet(p) {
  const actor = checkAdmin_(p);
  if (!actor) return { success: false, error: "Admin auth failed." };
  const id = String(p.id || "").trim();
  if (!id) return { success: false, error: "id required." };

  return withLock_(() => {
    const sheet = getWeeklySetsSheet_();
    const found = findWeeklySetRow_(sheet, id);
    if (!found) return { success: false, error: "Weekly set not found." };
    sheet.deleteRow(found.rowIndex);
    logAction_(actor, "Delete Weekly Set", id, "");
    return { success: true, deleted: id };
  });
}

// Admin-facing list — returns EVERY set (active or archived, released or
// not yet) with its full fileId, so the admin panel can show and edit
// what's actually scheduled. Contrast with listWeeklySets() below, which
// is what students see and deliberately withholds fileId pre-release.
function adminListWeeklySets(p) {
  if (!checkAdmin_(p)) return { success: false, error: "Admin auth failed." };
  const sheet = getWeeklySetsSheet_();
  const data = sheet.getDataRange().getValues();
  const sets = [];
  for (let i = 1; i < data.length; i++) sets.push(rowToWeeklySet_(data[i]));
  // Soonest-releasing first, so an admin managing several upcoming sets
  // sees what's next without having to scan/sort themselves.
  sets.sort((a, b) => new Date(a.releaseAt) - new Date(b.releaseAt));
  return { success: true, sets };
}

// Student-facing list. Requires the same proof-of-identity as
// getProgress/checkSession (a valid session token) — not because the
// list itself is sensitive, but so a logged-out visitor can't probe it
// for upcoming fileIds before release the same way handleGetFile's rate
// limiter exists to slow down direct scraping.
//
// A set that has ALREADY been released stays visible here forever,
// even after an admin later archives it — "archived" only ever means
// "stop featuring this as current/upcoming", never "take this away
// from students who could already solve it". That's deliberate: once a
// weekly set unlocks, it becomes a permanent part of the library
// exactly like any other chapters-data.js file, reachable through the
// same Online Study flow indefinitely, not a one-off that disappears
// once the next week's set replaces it as "current". Only a genuine
// adminDeleteWeeklySet removes a set from this list entirely.
//
// A set that has NOT yet been released and gets archived (an admin
// cancelling something before it ever went live) is correctly hidden —
// there's nothing to preserve access to yet. Active-but-not-yet-
// released sets ARE included (as a teaser — title/chapterLabel/
// releaseAt only, so students see what's coming and when) but fileId
// is stripped, since handing it out early would let anyone bypass the
// schedule by calling handleGetFile directly with a fileId lifted from
// the response.
function listWeeklySets(p) {
  const username = String(p.username || "").trim();
  if (!username) return { success: false, error: "Username required." };
  const userSheet = getUsersSheet_();
  const userFound = findUserRow_(userSheet, username);
  if (!userFound) return { success: false, error: "User not found." };
  if (!verifyUserToken_(userFound, p.token)) {
    return { success: false, error: "Session expired. Please log in again.", sessionInvalid: true };
  }

  const sheet = getWeeklySetsSheet_();
  const data = sheet.getDataRange().getValues();
  const now = Date.now();
  const sets = [];
  for (let i = 1; i < data.length; i++) {
    const s = rowToWeeklySet_(data[i]);
    const releaseTime = new Date(s.releaseAt).getTime();
    const released = !isNaN(releaseTime) && now >= releaseTime;
    if (s.status !== "active" && !(s.status === "archived" && released)) continue;
    sets.push({
      id: s.id,
      title: s.title,
      chapterLabel: s.chapterLabel,
      releaseAt: s.releaseAt,
      released: released,
      fileId: released ? s.fileId : undefined
    });
  }
  // Soonest-releasing (or most recently released) first.
  sets.sort((a, b) => new Date(a.releaseAt) - new Date(b.releaseAt));
  return { success: true, sets };
}

/* ═══════════════════════════════════════════════════════════════
   QUESTION REPORTS — deliberately separate from the existing "Flag"
   feature, which only ever meant "remind me to review this question
   later" (a personal study tool, tracked entirely client-side, never
   sent to the backend). This is specifically for "something about
   this question is actually wrong" — a content-quality signal a
   student sends TO the admin, not a self-reminder.
   ═══════════════════════════════════════════════════════════════ */

// Requires the same proof-of-identity as saveProgress/getProgress — a
// valid session token — so a report can't be filed by a logged-out
// visitor, and reportedBy reflects a real username rather than
// whatever the client claims.
function reportQuestion(p) {
  const username = String(p.username || "").trim();
  if (!username) return { success: false, error: "Username required." };
  const userSheet = getUsersSheet_();
  const userFound = findUserRow_(userSheet, username);
  if (!userFound) return { success: false, error: "User not found." };
  if (!verifyUserToken_(userFound, p.token)) {
    return { success: false, error: "Session expired. Please log in again.", sessionInvalid: true };
  }

  const uid = String(p.uid || "").trim();
  const reason = String(p.reason || "").trim();
  const note = String(p.note || "").trim().slice(0, 500); // generous but bounded — this is a short note, not a support ticket
  const questionSnapshot = String(p.questionSnapshot || "").trim().slice(0, 1000);
  if (!uid) return { success: false, error: "Missing question reference." };
  if (!["wrong_answer", "unclear", "typo", "other"].includes(reason)) {
    return { success: false, error: "Invalid report reason." };
  }

  const m = uid.match(/^(.+)_(\d+)$/);
  const fileId = m ? m[1] : uid;

  return withLock_(() => {
    const sheet = getQReportsSheet_();
    // One open report per (uid, reporter) is enough — a student
    // mashing the report button repeatedly on the same question
    // shouldn't create duplicate rows an admin then has to de-dupe
    // manually. A DIFFERENT student reporting the same question is a
    // separate, valuable signal (multiple independent reports on one
    // question is itself informative), so this only dedupes per-user.
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][1]) === uid && String(data[i][6]) === username && String(data[i][8]) === "open") {
        return { success: true, message: "You've already reported this question — it's in the queue for review." };
      }
    }
    const id = Utilities.getUuid();
    sheet.appendRow([id, uid, fileId, questionSnapshot, reason, note, username, new Date().toISOString(), "open"]);
    return { success: true, message: "Thanks — this has been sent for review." };
  });
}

function adminListQuestionReports(p) {
  if (!checkAdmin_(p)) return { success: false, error: "Admin auth failed." };
  const sheet = getQReportsSheet_();
  const data = sheet.getDataRange().getValues();
  const reports = [];
  for (let i = 1; i < data.length; i++) reports.push(rowToQReport_(data[i]));
  // Newest first, and open reports before resolved/dismissed ones —
  // an admin opening this page should see what needs attention first.
  reports.sort((a, b) => {
    if (a.status === "open" && b.status !== "open") return -1;
    if (a.status !== "open" && b.status === "open") return 1;
    return new Date(b.reportedAt) - new Date(a.reportedAt);
  });
  return { success: true, reports };
}

function adminUpdateQuestionReportStatus(p) {
  const actor = checkAdmin_(p);
  if (!actor) return { success: false, error: "Admin auth failed." };
  const id = String(p.id || "").trim();
  const status = String(p.status || "").trim();
  if (!id) return { success: false, error: "id required." };
  if (!["open", "resolved", "dismissed"].includes(status)) {
    return { success: false, error: "Status must be open, resolved, or dismissed." };
  }
  return withLock_(() => {
    const sheet = getQReportsSheet_();
    const found = findQReportRow_(sheet, id);
    if (!found) return { success: false, error: "Report not found." };
    sheet.getRange(found.rowIndex, 9).setValue(status);
    logAction_(actor, "Update Question Report", id, "Status: " + status);
    return { success: true, id, status };
  });
}

function adminDeleteQuestionReport(p) {
  const actor = checkAdmin_(p);
  if (!actor) return { success: false, error: "Admin auth failed." };
  const id = String(p.id || "").trim();
  if (!id) return { success: false, error: "id required." };
  return withLock_(() => {
    const sheet = getQReportsSheet_();
    const found = findQReportRow_(sheet, id);
    if (!found) return { success: false, error: "Report not found." };
    sheet.deleteRow(found.rowIndex);
    logAction_(actor, "Delete Question Report", id, "");
    return { success: true, deleted: id };
  });
}

/**
 * Run this ONCE from the Apps Script editor if your spreadsheet already
 * existed before this update — the text-formatting fixes in
 * getUsersSheet_/getPaymentsSheet_/getSettingsSheet_/getLogsSheet_ above
 * only apply automatically when a sheet is first CREATED, so an existing
 * spreadsheet needs this to retrofit the same protection (and won't be
 * touched again after — safe to re-run any time, it's idempotent).
 */
// Retrofits the shared auto-format (header/banding/borders/column widths)
// onto every sheet that already exists, since getXSheet_()'s formatting
// only runs once, at creation, and won't touch a sheet made before a
// formatting change like this one. Previously this only covered Users,
// Payments, Settings, and Logs — Admins and Progress were silently left
// on old-style formatting with no way to catch up short of deleting and
// recreating the sheet. Now covers all six, and is idempotent (safe to
// re-run any time — applyTableFormat_ clears old bandings before
// reapplying rather than stacking duplicates).
function fixSheetFormatting() {
  const u = getUsersSheet_();
  let maxRows = u.getMaxRows() - 1;
  [1, 5, 6].forEach(col => u.getRange(2, col, maxRows, 1).setNumberFormat("@"));
  applyTableFormat_(u, USER_HEADERS, "#4285f4", SpreadsheetApp.BandingTheme.BLUE, 300);

  const p = getPaymentsSheet_();
  maxRows = p.getMaxRows() - 1;
  [4, 5].forEach(col => p.getRange(2, col, maxRows, 1).setNumberFormat("@"));
  applyTableFormat_(p, PAYMENT_HEADERS, "#34a853", SpreadsheetApp.BandingTheme.GREEN, 300);

  const s = getSettingsSheet_();
  maxRows = s.getMaxRows() - 1;
  s.getRange(2, 2, maxRows, 1).setNumberFormat("@");
  applyTableFormat_(s, SETTINGS_HEADERS, "#fbbc04", SpreadsheetApp.BandingTheme.YELLOW, 400);
  s.getRange(2, 2, maxRows, 1).setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);

  const l = getLogsSheet_();
  applyTableFormat_(l, LOG_HEADERS, "#9c27b0", SpreadsheetApp.BandingTheme.PURPLE, 320);

  const a = getAdminsSheet_();
  maxRows = a.getMaxRows() - 1;
  a.getRange(2, 1, maxRows, 1).setNumberFormat("@");
  applyTableFormat_(a, ADMIN_HEADERS, "#ea4335", SpreadsheetApp.BandingTheme.RED, 300);

  const pr = getProgressSheet_();
  maxRows = pr.getMaxRows() - 1;
  pr.getRange(2, 1, maxRows, 1).setNumberFormat("@");
  applyTableFormat_(pr, PROGRESS_HEADERS, "#0f9d58", SpreadsheetApp.BandingTheme.GREEN, 300);

  const pt = getPushTokensSheet_();
  maxRows = pt.getMaxRows() - 1;
  pt.getRange(2, 1, maxRows, 1).setNumberFormat("@");
  applyTableFormat_(pt, PUSHTOKENS_HEADERS, "#e67c00", SpreadsheetApp.BandingTheme.ORANGE, 300);

  const ws = getWeeklySetsSheet_();
  maxRows = ws.getMaxRows() - 1;
  [1, 3].forEach(col => ws.getRange(2, col, maxRows, 1).setNumberFormat("@"));
  applyTableFormat_(ws, WEEKLYSET_HEADERS, "#00acc1", SpreadsheetApp.BandingTheme.CYAN, 320);

  const qr = getQReportsSheet_();
  maxRows = qr.getMaxRows() - 1;
  [1, 2, 3].forEach(col => qr.getRange(2, col, maxRows, 1).setNumberFormat("@"));
  applyTableFormat_(qr, QREPORT_HEADERS, "#d81b60", SpreadsheetApp.BandingTheme.PINK, 340);

  console.log("✅ Sheet formatting fixed/retrofitted on all nine sheets.");
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
