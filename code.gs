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
   forces every open browser tab into a fresh session on next load).

   v1.01 changelog (backend-only, no client changes required):
     - handleLogin: wrong admin password no longer silently falls
       through to the user world and returns a confusing "no account"
       error for a username that IS an admin.
     - handleGoogleLogin: rate-limited like the plain signup form.
     - adminUpdateUser: email/mobile now validated with the same regex
       as handleSignup.
     - adminUploadWeeklySetFile: refuses uploads over ~5MB.
     - checkYearlyExpiry_: clears accessType/accessExpiresAt columns
       when a yearly grant expires.
     - adminDeleteUser/adminDeleteUsersBatch: purge the deleted user's
       Progress, PushTokens, Payments, and ProgressBackups rows too.
     - Three new admin actions: adminClearProgressBackups,
       adminPruneOldBackups, adminTrimLogs.
     - adminDeleteWeeklySet: cleans up its own wsnotified_<id> flag.
     - requestPasswordReset: removed a dead resetUrl computation.

   v1.02 changelog:
     - Admin tokens now slide.
     - Payment screenshots no longer uploaded ANYONE_WITH_LINK.
     - Google Sign-In has its own rate-limit bucket (30/min).
     - New adminExpiringTrials action.

   v1.03 changelog (formatting/layout only, no behavior changes):
     - Spreadsheet ID hardcoded as DEFAULT_SPREADSHEET_ID.
     - New sortSheetsAlphabetically_().
     - applyTableFormat_ goes through applyBandingOrFallback_.
     - resetAdminPasswordToSeed() emergency helper.

   v1.04 changelog (BUG FIXES + Weekly Set attempt capture):
     SECURITY
       - handleLogin: "No account found" vs "Wrong password" no longer
         allows username enumeration. Both now return the same error.
       - sanitizeSheetField_: leading whitespace no longer bypasses the
         formula-injection guard (was /^[=+\-@]/ — a value starting
         with "\n=..." slipped through).
       - handleSignup / submitPayment: email and contact fields now go
         through sanitizeSheetField_ before being appended.
     BUGS
       - adminListUsers / adminListPayments / adminListQuestionReports /
         adminListWeeklySets / adminMostMissedQuestions: hard row caps
         added so a mature deployment can't time out (or blow past
         the 6-minute execution ceiling) reading every row into memory
         and JSON-serializing it back. Each response now includes
         `truncated` and `totalCount` so the admin UI can warn when
         it's looking at a partial view.
       - resetAll(): now refuses to run unless ALLOW_RESET_ALL is
         explicitly flipped to true, so an accidental click in the
         Apps Script editor can't wipe production.
       - checkTrialExpiryWarnings: now correctly clears the
         trialwarned_ property when a user's trial is reset (payment
         rejected, admin edits trialExpiresAt forward, etc.), so a
         subsequent near-expiry window triggers a fresh warning
         instead of being silently skipped forever.
     FEATURE — Weekly Set attempt capture (one shot, then review only)
       - New WeeklyAttempts sheet. One row per (username, weeklyId).
       - New actions: getWeeklyAttempt, getMyWeeklyAttempts,
         submitWeeklyAttempt.
       - submitWeeklyAttempt is server-authoritative: the row IS the
         lock, so two devices racing on one account can't both land an
         attempt. The raw answers array is stored; adminWeeklySetResults
         re-scores against the source file rather than trusting the
         client's claimed score.
       - adminWeeklySetResults rewritten to read from WeeklyAttempts
         and re-score. Falls back to the client-claimed score when the
         source question file can't be read, and flags that in its
         response (`rescored: false`).
       - purgeUserAuxiliaryRows_: WeeklyAttempts rows are now purged
         along with Progress / PushTokens / Payments / ProgressBackups
         when a user is deleted.
       - adminDeleteWeeklySet now documents (in a comment) that
         WeeklyAttempts rows for the set are intentionally retained —
         a student's submitted record is their own, and shouldn't
         vanish because an admin retired the set.
     FEATURE — Chapter key alignment
       - Sessions now carry both `chapter` (display label, e.g.
         "Structural Engineering — Abhyas") and `chapterKey` (canonical
         key matching the admin filter dropdown, e.g. "Structural
         Engineering"). adminMostMissedQuestions now reads chapterKey
         first, so filtering by chapter actually matches. Existing
         sessions without chapterKey fall back to the old behavior. */
const APP_VERSION = "1.04";

/* ── SPREADSHEET ID ──────────────────────────────────────────────
   Hardcoded so this script can never silently spawn a duplicate
   "Abhyas V1" spreadsheet when the Script Property `SHEET_ID` is
   missing. The Script Property is still honoured first if set. */
const DEFAULT_SPREADSHEET_ID = "1yJF3kIGcwKHHdlcmw7ZUWBoUBMDeRWP7eaGBdDtUD_o";

/* ── ADMIN CREDENTIALS ───────────────────────────────────────────
   Admins live in their own sheet (see getAdminsSheet_ / ADMIN_HEADERS
   below). The constants below are ONLY used once, to seed the very
   first admin row the first time the Admins sheet is created. */
const ADMIN_SEED_USERNAME = "admin";
const ADMIN_SEED_PASSWORD = "ChangeMe123!";   // ⚠️ CHANGE THIS IMMEDIATELY after first login

/* ── SHEET CONFIG ── */
const USERS_SHEET          = "Users";
const PAYMENTS_SHEET       = "Payments";
const SETTINGS_SHEET       = "Settings";
const LOGS_SHEET           = "Logs";
const ADMINS_SHEET         = "Admins";
const PROGRESS_SHEET       = "Progress";
const PUSHTOKENS_SHEET     = "PushTokens";
const WEEKLYSETS_SHEET     = "WeeklySets";
const QREPORTS_SHEET       = "QuestionReports";
const WEEKLYATTEMPTS_SHEET = "WeeklyAttempts";

/* ── BRUTE-FORCE LOGIN PROTECTION ────────────────────────────────
   Tracks failed attempts per-username in PropertiesService. 'user'
   and 'admin' are tracked as separate keyspaces under the same
   username. Locked-out logins are rejected BEFORE the password is
   checked. Applies to both handleLogin() and adminLogin(). */
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
  if (state.lockUntil && Date.now() >= state.lockUntil) state = { count: 0 };
  state.count = (state.count || 0) + 1;
  if (state.count >= MAX_LOGIN_ATTEMPTS) state.lockUntil = Date.now() + LOCKOUT_MINUTES * 60 * 1000;
  props.setProperty(key, JSON.stringify(state));
}

function clearLoginLock_(kind, username) {
  PropertiesService.getScriptProperties().deleteProperty(loginLockKey_(kind, username));
}

/* ── GETFILE RATE LIMIT ──────────────────────────────────────────
   handleGetFile is deliberately the one action that takes no
   username/token — a bare "fileId in, question JSON out" proxy.
   Since this repo is public with every Drive fileId sitting in
   chapters-data.js, without a limiter someone could hit this endpoint
   directly and scrape the entire question bank. Single global
   sliding-window counter — a blunt, whole-API-wide ceiling, generous
   enough that real concurrent student traffic won't hit it. */
const GETFILE_RATE_LIMIT_PER_MINUTE = 120;

/* ── SHARED FIXED-WINDOW RATE LIMITER ─────────────────────────────
   One counter helper backing every non-login rate limit in this file
   (login lockouts are a different mechanism — see checkLoginLock_
   above). When logLabel is given, the FIRST rejection in a given
   window writes one Activity Log entry. */
function checkRateLimit_(bucket, maxCount, windowMs, logLabel) {
  const props = PropertiesService.getScriptProperties();
  const key = "ratelimit_" + bucket;
  const windowBucket = Math.floor(Date.now() / windowMs);
  let state = { windowBucket, count: 0, logged: false };
  const raw = props.getProperty(key);
  if (raw) {
    try { state = JSON.parse(raw); } catch (e) {}
    if (state.windowBucket !== windowBucket) state = { windowBucket, count: 0, logged: false };
  }
  state.count = (state.count || 0) + 1;
  const withinLimit = state.count <= maxCount;
  if (!withinLimit && logLabel && !state.logged) {
    state.logged = true;
    logAction_("system", logLabel, "", "Exceeded " + maxCount + " per " + Math.round(windowMs / 1000) + "s (bucket: " + bucket + "). Further rejections this window are not individually logged.");
  }
  props.setProperty(key, JSON.stringify(state));
  return withinLimit;
}

function checkGetFileRateLimit_() {
  return checkRateLimit_("getfile", GETFILE_RATE_LIMIT_PER_MINUTE, 60000, "GetFile Rate Limited");
}

/* ── SIGNUP RATE LIMIT ────────────────────────────────────────────
   handleSignup has no email verification and no CAPTCHA — a mobile
   number just needs to match the Nepali format regex, it's never
   confirmed to be real. Without any throttle, a script could farm
   unlimited free-trial accounts automatically. Threshold is generous
   enough for a realistic burst (a classroom signing up together)
   while still meaningfully slowing down automated mass creation.

   NOTE: handleGoogleLogin uses its own bucket ("googlelogin") rather
   than sharing this one — an attacker hammering /tokeninfo can no
   longer lock out legitimate signups for the rest of the minute. */
const SIGNUP_RATE_LIMIT_PER_MINUTE = 15;

function checkSignupRateLimit_() {
  return checkRateLimit_("signup", SIGNUP_RATE_LIMIT_PER_MINUTE, 60000, "Signup Rate Limited");
}

/* ── SHEET / CSV FORMULA-INJECTION GUARD ─────────────────────────
   Apps Script's setValue()/appendRow() apply the SAME formula parsing
   as typing into the Sheets UI by hand: a string starting with =, +,
   -, or @ becomes a live formula the instant the cell is written.
   Prefixing with a leading apostrophe is the standard mitigation.

   v1.04: the leading-character check now also rejects leading
   whitespace (space, tab, CR, LF). Without this, "\n=SUM(...)" slipped
   past the old /^[=+\-@]/ test even though Google Sheets itself still
   parses it as a formula after the newline. */
function sanitizeSheetField_(value) {
  const s = String(value == null ? "" : value);
  return /^[\s]*[=+\-@\t\r]/.test(s) ? "'" + s : s;
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

const ADMIN_HEADERS = [
  "username", "passHash", "createdAt", "createdBy", "token", "tokenExpires"
];

const ADMIN_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

const PROGRESS_HEADERS = ["username", "data", "updatedAt"];
const PUSHTOKENS_HEADERS = ["username", "fcmToken", "updatedAt"];

const WEEKLYSET_HEADERS = ["id", "title", "fileId", "chapterLabel", "status", "uploadedBy", "uploadedAt", "releaseAt"];

const QREPORT_HEADERS = ["id", "uid", "fileId", "questionSnapshot", "reason", "note", "reportedBy", "reportedAt", "status"];

// v1.04 — one row per (username, weeklyId). Enforced by submitWeeklyAttempt's
// lock + check-then-write. The answers array is stored verbatim; scoring is
// derived on read by adminWeeklySetResults, not trusted from the client.
const WEEKLYATTEMPT_HEADERS = [
  "username", "weeklyId", "answersJson", "totalQuestions",
  "correctClaimed", "skippedCount", "startedAt", "submittedAt", "durationSec"
];

const TRIAL_HOURS = 24;

/* ── CREATION-PASS FORMATTING SUPPRESSION FLAG ───────────────────
   When true, each getXSheet_() function skips its applyTableFormat_()
   call, so a single setup() execution bands each sheet exactly ONCE.
   Managed exclusively by setup() via a try/finally. */
let SKIP_CREATION_FORMATTING = false;

/* ── LIST-READ ROW CAPS (v1.04) ──────────────────────────────────
   Every "list everything" admin endpoint reads its sheet in full,
   JSON-serializes every row, and ships the whole thing to the
   browser. Once a deployment matures past a few thousand rows, that
   pattern will hit the 6-minute Apps Script execution ceiling and
   fail with an opaque "Exceeded maximum execution time" — worse, it
   does so only for the biggest, most important deployments.

   Each cap below is a deliberate ceiling, not a target. When the
   response is truncated, the accompanying `truncated: true` and
   `totalCount: N` fields let the admin UI show "showing X of Y —
   refine your filter to see more" rather than silently lying about
   the state of the world. */
const MAX_LIST_USERS = 3000;
const MAX_LIST_PAYMENTS = 3000;
const MAX_LIST_QREPORTS = 2000;
const MAX_LIST_WEEKLYSETS = 500;
const MAX_MISSED_SCAN_ROWS = 5000;

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
      case "googlelogin":        result = handleGoogleLogin(e.parameter); break;
      case "signup":             result = handleSignup(e.parameter); break;
      case "requestpasswordreset": result = requestPasswordReset(e.parameter); break;
      case "resetpassword":      result = resetPassword(e.parameter); break;
      case "updateownmobile":    result = updateOwnMobile(e.parameter); break;
      case "checksession":       result = checkSession(e.parameter); break;
      case "saveprogress":       result = saveProgress(e.parameter); break;
      case "getprogress":        result = getProgress(e.parameter); break;
      case "savepushtoken":      result = savePushToken(e.parameter); break;
      case "listweeklysets":     result = listWeeklySets(e.parameter); break;
      case "reportquestion":     result = reportQuestion(e.parameter); break;

      // v1.04 — Weekly Set attempt capture
      case "getweeklyattempt":    result = getWeeklyAttempt(e.parameter); break;
      case "getmyweeklyattempts": result = getMyWeeklyAttempts(e.parameter); break;
      case "submitweeklyattempt": result = submitWeeklyAttempt(e.parameter); break;

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
      case "adminweeklysetresults": result = adminWeeklySetResults(e.parameter); break; // v1.04
      case "adminlistquestionreports": result = adminListQuestionReports(e.parameter); break;
      case "adminupdatequestionreportstatus": result = adminUpdateQuestionReportStatus(e.parameter); break;
      case "admindeletequestionreport": result = adminDeleteQuestionReport(e.parameter); break;
      case "adminimportprogress": result = adminImportProgress(e.parameter); break;
      case "adminimportstatus":  result = adminImportStatus(e.parameter); break;

      // ── ADMIN CLEANUP (v1.01) ──
      case "adminclearprogressbackups": result = adminClearProgressBackups(e.parameter); break;
      case "adminpruneoldbackups":       result = adminPruneOldBackups(e.parameter); break;
      case "admintrimlogs":              result = adminTrimLogs(e.parameter); break;

      // ── ADMIN MAINTENANCE / REPORTING (v1.02) ──
      case "adminrevokescreenshotsharing": result = adminRevokeScreenshotSharing(e.parameter); break;
      case "adminexpiringtrials":          result = adminExpiringTrials(e.parameter); break;

      default:
        console.warn("Unknown action requested:", action);
        result = { success: false, error: "Unknown action: '" + action + "'. See backend source for the valid action list." };
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
// them — deleteRow() shifts every subsequent row up by one. The lock
// only does its job once every row-mutating function goes through it,
// which is why this helper is used consistently below rather than being
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
  // Suppress per-sheet formatting during the creation pass so each
  // sheet is banded EXACTLY ONCE per setup() execution — in
  // fixSheetFormatting() below. This eliminates the double-band race
  // that used to make native Google banding flake.
  SKIP_CREATION_FORMATTING = true;
  try {
    getUsersSheet_();
    getPaymentsSheet_();
    getSettingsSheet_();
    getLogsSheet_();
    getAdminsSheet_();
    getProgressSheet_();
    getPushTokensSheet_();
    getWeeklySetsSheet_();
    getQReportsSheet_();
    getProgressImportsSheet_();
    getProgressBackupsSheet_();
    getWeeklyAttemptsSheet_();   // v1.04
  } finally {
    SKIP_CREATION_FORMATTING = false;
  }
  initDefaultSettings_();
  ensurePushTriggers_();
  fixSheetFormatting();
  sortSheetsAlphabetically_();
  const ss = getSpreadsheet_();
  Logger.log("✅ Setup complete. Spreadsheet URL: " + ss.getUrl());
  return "Setup complete. Spreadsheet created/verified.";
}

function getSpreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  const ssId = props.getProperty("SHEET_ID") || DEFAULT_SPREADSHEET_ID;
  let spreadsheet = null;
  try {
    spreadsheet = SpreadsheetApp.openById(ssId);
  } catch (e) {
    console.log("Could not open spreadsheet '" + ssId + "': " + (e.message || e) +
                " — falling back to creating a new one.");
  }
  if (!spreadsheet) {
    spreadsheet = SpreadsheetApp.create("Abhyas V1");
    props.setProperty("SHEET_ID", spreadsheet.getId());
    console.log("⚠️ Created a NEW spreadsheet because the configured ID could not be opened: " + spreadsheet.getUrl());
  } else {
    if (props.getProperty("SHEET_ID") !== ssId) props.setProperty("SHEET_ID", ssId);
  }
  return spreadsheet;
}

function sortSheetsAlphabetically_() {
  const ss = getSpreadsheet_();
  const sheets = ss.getSheets();
  if (sheets.length < 2) return;
  const sortedNames = sheets.map(s => s.getName())
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  sortedNames.forEach((name, i) => {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return;
    sheet.activate();
    ss.moveActiveSheet(i + 1);
  });
  SpreadsheetApp.flush();
  console.log("✅ Sheets reordered alphabetically: " + sortedNames.join(", "));
}

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

function applyTableFormat_(sheet, headers, headerColor, bandTheme, maxWidthPx) {
  const numCols = headers.length;
  const maxRows = Math.max(1, sheet.getMaxRows() - 1);

  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, numCols)
    .setFontWeight("bold")
    .setBackground(headerColor)
    .setFontColor("white");

  const fullRange = sheet.getRange(1, 1, maxRows + 1, numCols);
  if (maxRows >= 1) {
    applyBandingOrFallback_(sheet, fullRange, headerColor, bandTheme);
  }
  fullRange.setBorder(true, true, true, true, true, true, "#d0d0d0", SpreadsheetApp.BorderStyle.SOLID);

  autoResizeCapped_(sheet, 1, numCols, maxWidthPx || 300);
}

function applyBandingOrFallback_(sheet, fullRange, headerColor, bandTheme) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
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
      if (fullRange.getNumRows() > 1) {
        sheet.getRange(fullRange.getRow() + 1, fullRange.getColumn(),
                       fullRange.getNumRows() - 1, fullRange.getNumColumns())
          .setBackground(null);
      }
      return;
    } catch (err) {
      if (attempt === 2) {
        console.log("applyBandingOrFallback_: using manual alternating colors for '" +
                    sheet.getName() + "'.");
      } else {
        Utilities.sleep(600);
      }
    }
  }
  applyManualBanding_(sheet, fullRange, bandTheme);
}

function bandThemeStripeColor_(bandTheme) {
  const name = (function () {
    for (const k in SpreadsheetApp.BandingTheme) {
      if (SpreadsheetApp.BandingTheme[k] === bandTheme) return k;
    }
    return "BLUE";
  })();
  const map = {
    BLUE:   "#e8f0fe",
    GREEN:  "#e6f4ea",
    YELLOW: "#fef7e0",
    PURPLE: "#f3e8fd",
    RED:    "#fce8e6",
    ORANGE: "#fef0e0",
    CYAN:   "#e0f7fa",
    PINK:   "#fce4ec",
    GREY:   "#f1f3f4",
    TEAL:   "#e0f2f1"
  };
  return map[name] || "#f3f3f3";
}

function applyManualBanding_(sheet, fullRange, bandTheme) {
  const startRow = fullRange.getRow();
  const numCols = fullRange.getNumColumns();
  const dataRows = fullRange.getNumRows() - 1;
  if (dataRows < 1) return;

  const stripe = bandThemeStripeColor_(bandTheme);
  const base = "#ffffff";
  const colors = [];
  for (let r = 0; r < dataRows; r++) {
    colors.push(new Array(numCols).fill(r % 2 === 0 ? base : stripe));
  }
  sheet.getRange(startRow + 1, fullRange.getColumn(), dataRows, numCols)
       .setBackgrounds(colors);
}

function getUsersSheet_() {
  const spreadsheet = getSpreadsheet_();
  let sheet = spreadsheet.getSheetByName(USERS_SHEET);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(USERS_SHEET);
    sheet.appendRow(USER_HEADERS);
    const maxRows = sheet.getMaxRows() - 1;
    [1, 5, 6].forEach(col => sheet.getRange(2, col, maxRows, 1).setNumberFormat("@"));
    if (!SKIP_CREATION_FORMATTING) {
      applyTableFormat_(sheet, USER_HEADERS, "#4285f4", SpreadsheetApp.BandingTheme.BLUE, 300);
    }
  }
  return sheet;
}

function getPaymentsSheet_() {
  const spreadsheet = getSpreadsheet_();
  let sheet = spreadsheet.getSheetByName(PAYMENTS_SHEET);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(PAYMENTS_SHEET);
    sheet.appendRow(PAYMENT_HEADERS);
    const maxRows = sheet.getMaxRows() - 1;
    [4, 5].forEach(col => sheet.getRange(2, col, maxRows, 1).setNumberFormat("@"));
    if (!SKIP_CREATION_FORMATTING) {
      applyTableFormat_(sheet, PAYMENT_HEADERS, "#34a853", SpreadsheetApp.BandingTheme.GREEN, 300);
    }
  }
  return sheet;
}

function getSettingsSheet_() {
  const spreadsheet = getSpreadsheet_();
  let sheet = spreadsheet.getSheetByName(SETTINGS_SHEET);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(SETTINGS_SHEET);
    sheet.appendRow(SETTINGS_HEADERS);
    const maxRows = sheet.getMaxRows() - 1;
    sheet.getRange(2, 2, maxRows, 1).setNumberFormat("@");
    if (!SKIP_CREATION_FORMATTING) {
      applyTableFormat_(sheet, SETTINGS_HEADERS, "#fbbc04", SpreadsheetApp.BandingTheme.YELLOW, 400);
      sheet.getRange(2, 2, maxRows, 1).setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
    }
  }
  return sheet;
}

function getLogsSheet_() {
  const spreadsheet = getSpreadsheet_();
  let sheet = spreadsheet.getSheetByName(LOGS_SHEET);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(LOGS_SHEET);
    sheet.appendRow(LOG_HEADERS);
    if (!SKIP_CREATION_FORMATTING) {
      applyTableFormat_(sheet, LOG_HEADERS, "#9c27b0", SpreadsheetApp.BandingTheme.PURPLE, 320);
    }
  }
  return sheet;
}

function getAdminsSheet_() {
  const spreadsheet = getSpreadsheet_();
  let sheet = spreadsheet.getSheetByName(ADMINS_SHEET);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(ADMINS_SHEET);
    sheet.appendRow(ADMIN_HEADERS);
    const maxRows = sheet.getMaxRows() - 1;
    sheet.getRange(2, 1, maxRows, 1).setNumberFormat("@");
    if (!SKIP_CREATION_FORMATTING) {
      applyTableFormat_(sheet, ADMIN_HEADERS, "#ea4335", SpreadsheetApp.BandingTheme.RED, 300);
    }

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

function findAdminByToken_(sheet, token) {
  if (!token) return null;
  const data = sheet.getDataRange().getValues();
  const now = Date.now();
  for (let i = 1; i < data.length; i++) {
    const storedToken = data[i][4];
    const expires = Number(data[i][5] || 0);
    if (storedToken && storedToken === token && expires && now <= expires) {
      const SLIDE_THRESHOLD_MS = 60 * 60 * 1000;
      if (expires - now < ADMIN_TOKEN_TTL_MS - SLIDE_THRESHOLD_MS) {
        const newExpires = now + ADMIN_TOKEN_TTL_MS;
        try {
          sheet.getRange(i + 1, 6).setValue(String(newExpires));
        } catch (e) {
          console.error("findAdminByToken_: sliding refresh write failed:", e);
        }
      }
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
    sheet.getRange(2, 1, maxRows, 1).setNumberFormat("@");
    if (!SKIP_CREATION_FORMATTING) {
      applyTableFormat_(sheet, PROGRESS_HEADERS, "#0f9d58", SpreadsheetApp.BandingTheme.GREEN, 300);
    }
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
    [1, 3].forEach(col => sheet.getRange(2, col, maxRows, 1).setNumberFormat("@"));
    if (!SKIP_CREATION_FORMATTING) {
      applyTableFormat_(sheet, WEEKLYSET_HEADERS, "#00acc1", SpreadsheetApp.BandingTheme.CYAN, 320);
    }
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
    [1, 2, 3].forEach(col => sheet.getRange(2, col, maxRows, 1).setNumberFormat("@"));
    if (!SKIP_CREATION_FORMATTING) {
      applyTableFormat_(sheet, QREPORT_HEADERS, "#d81b60", SpreadsheetApp.BandingTheme.PINK, 340);
    }
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
    sheet.getRange(2, 1, maxRows, 1).setNumberFormat("@");
    if (!SKIP_CREATION_FORMATTING) {
      applyTableFormat_(sheet, PUSHTOKENS_HEADERS, "#e67c00", SpreadsheetApp.BandingTheme.ORANGE, 300);
    }
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

/* ═══════════════════════════════════════════════════════════════
   WEEKLY ATTEMPTS — v1.04
   ═══════════════════════════════════════════════════════════════ */

function getWeeklyAttemptsSheet_() {
  const spreadsheet = getSpreadsheet_();
  let sheet = spreadsheet.getSheetByName(WEEKLYATTEMPTS_SHEET);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(WEEKLYATTEMPTS_SHEET);
    sheet.appendRow(WEEKLYATTEMPT_HEADERS);
    const maxRows = sheet.getMaxRows() - 1;
    // username=1 and weeklyId=2 are opaque tokens — same all-digits
    // protection as every other id-shaped column elsewhere in this file.
    [1, 2].forEach(col => sheet.getRange(2, col, maxRows, 1).setNumberFormat("@"));
    if (!SKIP_CREATION_FORMATTING) {
      applyTableFormat_(sheet, WEEKLYATTEMPT_HEADERS, "#00897b", SpreadsheetApp.BandingTheme.TEAL, 300);
    }
  }
  return sheet;
}

function findWeeklyAttemptRow_(sheet, username, weeklyId) {
  if (!username || !weeklyId) return null;
  const target = String(username).toLowerCase().trim();
  const wid = String(weeklyId).trim();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase().trim() === target && String(data[i][1]).trim() === wid) {
      return { rowIndex: i + 1, row: data[i] };
    }
  }
  return null;
}

function rowToWeeklyAttempt_(row) {
  let answers = [];
  try { answers = JSON.parse(row[2] || "[]"); } catch (e) {}
  const total = Number(row[3] || 0);
  const correct = Number(row[4] || 0);
  return {
    weeklyId: row[1] || "",
    answers,
    total,
    correct,
    pct: total ? Math.round((correct / total) * 100) : 0,
    skipped: Number(row[5] || 0),
    startedAt: Number(row[6] || 0),
    submittedAt: Number(row[7] || 0),
    durationSec: Number(row[8] || 0),
    synced: true
  };
}

// Records one row per admin action. Best-effort: a logging failure
// should never break the action itself.
function logAction_(admin, action, target, details) {
  try {
    getLogsSheet_().appendRow([new Date().toISOString(), admin || "admin", action || "", target || "", details || ""]);
  } catch (err) {
    console.error("logAction_ failed:", err);
  }
}

const LOGS_MAX_ROWS_READ = 1000;

function adminListLogs(p) {
  if (!checkAdmin_(p)) return { success: false, error: "Admin auth failed." };
  const sheet = getLogsSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: true, logs: [] };
  const totalDataRows = lastRow - 1;
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
  return { success: true, logs, totalCount: totalDataRows, truncated: totalDataRows > LOGS_MAX_ROWS_READ };
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

function makeSalt_() {
  return Utilities.getUuid().replace(/-/g, "");
}

function hashPassSalted_(password, salt) {
  return hashPass_(salt + password);
}

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

const USER_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function issueUserToken_(sheet, rowIndex) {
  const token = Utilities.getUuid();
  const expires = Date.now() + USER_TOKEN_TTL_MS;
  sheet.getRange(rowIndex, 17).setValue(token);
  sheet.getRange(rowIndex, 18).setValue(String(expires));
  return token;
}

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
    accessType: row[14] || "",
    accessExpiresAt: row[15] || ""
  };
}

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

function issueAdminToken_(sheet, rowIndex) {
  const token = Utilities.getUuid();
  const expires = Date.now() + ADMIN_TOKEN_TTL_MS;
  sheet.getRange(rowIndex, 5).setValue(token);
  sheet.getRange(rowIndex, 6).setValue(String(expires));
  return token;
}

function checkYearlyExpiry_(sheet, found, user, status) {
  if (user.accessType === "yearly" && user.accessExpiresAt) {
    const expiresAt = new Date(user.accessExpiresAt);
    if (!isNaN(expiresAt) && new Date() > expiresAt) {
      sheet.getRange(found.rowIndex, 8).setValue("expired");
      sheet.getRange(found.rowIndex, 14).setValue("false");
      sheet.getRange(found.rowIndex, 15).setValue("");
      sheet.getRange(found.rowIndex, 16).setValue("");
      user.permanentAccess = false;
      user.accessType = "";
      user.accessExpiresAt = "";
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

// Best-effort removal of a user's ancillary data from every sheet that
// references them by username. Called from adminDeleteUser and
// adminDeleteUsersBatch AFTER the Users row itself is deleted.
//
// v1.04: also purges WeeklyAttempts. A deleted user's submitted attempt
// rows would otherwise sit forever in the sheet, and — more importantly
// — if the same username were re-registered, they'd immediately inherit
// the previous holder's weekly-set scores and be locked out of taking
// those sets themselves.
function purgeUserAuxiliaryRows_(username) {
  if (!username) return;
  const target = String(username).toLowerCase().trim();

  try {
    const progressSheet = getProgressSheet_();
    const found = findProgressRow_(progressSheet, username);
    if (found) progressSheet.deleteRow(found.rowIndex);
  } catch (e) { console.error("purgeUserAuxiliaryRows_: Progress failed:", e); }

  try {
    const ptSheet = getPushTokensSheet_();
    const found = findPushTokenRow_(ptSheet, username);
    if (found) ptSheet.deleteRow(found.rowIndex);
  } catch (e) { console.error("purgeUserAuxiliaryRows_: PushTokens failed:", e); }

  try {
    const paySheet = getPaymentsSheet_();
    const payData = paySheet.getDataRange().getValues();
    for (let i = payData.length - 1; i >= 1; i--) {
      if (String(payData[i][0]).toLowerCase().trim() === target) {
        paySheet.deleteRow(i + 1);
      }
    }
  } catch (e) { console.error("purgeUserAuxiliaryRows_: Payments failed:", e); }

  try {
    const backupSheet = getProgressBackupsSheet_();
    const backupData = backupSheet.getDataRange().getValues();
    for (let i = backupData.length - 1; i >= 1; i--) {
      if (String(backupData[i][2]).toLowerCase().trim() === target) {
        backupSheet.deleteRow(i + 1);
      }
    }
  } catch (e) { console.error("purgeUserAuxiliaryRows_: ProgressBackups failed:", e); }

  // v1.04 — WeeklyAttempts
  try {
    const waSheet = getWeeklyAttemptsSheet_();
    const waData = waSheet.getDataRange().getValues();
    for (let i = waData.length - 1; i >= 1; i--) {
      if (String(waData[i][0]).toLowerCase().trim() === target) {
        waSheet.deleteRow(i + 1);
      }
    }
  } catch (e) { console.error("purgeUserAuxiliaryRows_: WeeklyAttempts failed:", e); }
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
    // Same generic message the user path returns below — see that branch
    // for the reasoning. Do NOT fall through to the user world: this
    // username IS an admin account.
    return { success: false, error: "Invalid username or password." };
  }

  // ── USER WORLD ──
  const sheet = getUsersSheet_();
  const found = findUserRow_(sheet, username);

  // v1.04 — same generic message whether the username exists or not.
  // Previously this returned "No account found. Please sign up first."
  // for a nonexistent username and "Wrong password." for an existing
  // one — an easy way for anyone to enumerate valid usernames. The
  // brute-force lockout on failed logins still applies (both failures
  // below reach recordLoginFailure_), so this doesn't make attacking
  // an existing account any easier; it just stops the free
  // username-discovery oracle.
  if (!found) {
    recordLoginFailure_('user', username);
    return { success: false, error: "Invalid username or password." };
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
    return { success: false, error: "Invalid username or password." };
  }
  clearLoginLock_('user', username);
  if (verify.upgradedHash) {
    sheet.getRange(found.rowIndex, 2).setValue(verify.upgradedHash);
  }
  return buildLoginResult_(sheet, found);
}

function buildLoginResult_(sheet, found) {
  const row = found.row;
  const sessionToken = issueUserToken_(sheet, found.rowIndex);

  let status = row[7];
  const trialExpiresAt = row[11] ? new Date(row[11]) : null;
  const now = new Date();

  if (status === "trial" && trialExpiresAt && now > trialExpiresAt) {
    status = "expired";
    sheet.getRange(found.rowIndex, 8).setValue("expired");
  }

  const user = rowToUser_(row);
  user.status = status;
  status = checkYearlyExpiry_(sheet, found, user, status);
  user.status = status;

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
   SIGN IN WITH GOOGLE
   ═══════════════════════════════════════════════════════════════ */

const GOOGLE_CLIENT_ID = "242226857075-hpkbjoqhlem95fu6vkf712e8ijs33sng.apps.googleusercontent.com";

function handleGoogleLogin(p) {
  const idToken = String(p.idToken || "").trim();
  if (!idToken) return { success: false, error: "Missing Google ID token." };

  if (!checkRateLimit_("googlelogin", 30, 60000, "GoogleLogin Rate Limited")) {
    return { success: false, error: "Too many sign-in attempts, please try again in a minute." };
  }

  let payload;
  try {
    const resp = UrlFetchApp.fetch(
      "https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken),
      { muteHttpExceptions: true }
    );
    if (resp.getResponseCode() !== 200) {
      return { success: false, error: "Google sign-in could not be verified. Please try again." };
    }
    payload = JSON.parse(resp.getContentText());
  } catch (err) {
    return { success: false, error: "Google sign-in verification failed: " + (err.message || err) };
  }

  if (!payload.aud || payload.aud !== GOOGLE_CLIENT_ID) {
    return { success: false, error: "This Google sign-in was not issued for this app." };
  }
  if (payload.email_verified !== "true" && payload.email_verified !== true) {
    return { success: false, error: "Your Google email is not verified. Please verify it with Google first." };
  }
  const email = String(payload.email || "").trim().toLowerCase();
  if (!email) return { success: false, error: "Google did not return an email address." };
  const name = sanitizeSheetField_(String(payload.name || email.split("@")[0]));

  return withLock_(() => {
    const sheet = getUsersSheet_();
    let found = findUserByField_(sheet, 3, email);

    if (!found) {
      let base = email.split("@")[0].replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 24) || "user";
      let candidate = base;
      let n = 1;
      while (findUserRow_(sheet, candidate)) {
        candidate = base + n;
        n++;
      }
      const now = new Date();
      const trialHours = Number(getSettingValue_("trialHours", TRIAL_HOURS)) || TRIAL_HOURS;
      const trialExpiresAt = new Date(now.getTime() + trialHours * 60 * 60 * 1000);
      const salt = makeSalt_();
      const lockoutProofPassword = Utilities.getUuid() + Utilities.getUuid();

      sheet.appendRow([
        candidate,
        salt + ":" + hashPassSalted_(lockoutProofPassword, salt),
        name,
        sanitizeSheetField_(email),
        "",
        sanitizeSheetField_(email),
        "email",
        "trial",
        now.toISOString(),
        now.toISOString(),
        "user",
        trialExpiresAt.toISOString(),
        "none",
        "false"
      ]);
      const newRowIndex = sheet.getLastRow();
      found = { rowIndex: newRowIndex, row: sheet.getRange(newRowIndex, 1, 1, USER_HEADERS.length).getValues()[0] };
      logAction_("system", "Google Signup", candidate, "email=" + email);
    }

    return buildLoginResult_(sheet, found);
  });
}

function updateOwnMobile(p) {
  const username = String(p.username || "").trim();
  const mobile = String(p.mobile || "").trim();
  if (!username || !p.token) return { success: false, error: "Not logged in." };
  if (!/^(98|97|96|99)\d{8}$/.test(mobile)) {
    return { success: false, error: "Invalid Nepali mobile number. Use 10 digits starting with 98/97/96/99." };
  }

  return withLock_(() => {
    const sheet = getUsersSheet_();
    const found = findUserRow_(sheet, username);
    if (!found) return { success: false, error: "Account not found." };
    if (!verifyUserToken_(found, p.token)) {
      return { success: false, error: "Session expired. Please log in again.", sessionInvalid: true };
    }
    sheet.getRange(found.rowIndex, 5).setValue(mobile);
    return { success: true, message: "Mobile number saved." };
  });
}

/* ═══════════════════════════════════════════════════════════════
   PASSWORD RESET
   ═══════════════════════════════════════════════════════════════ */

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const RESET_REQUEST_COOLDOWN_MS = 5 * 60 * 1000;

function resetTokenKey_(token) { return "pwreset_" + token; }
function resetCooldownKey_(username) { return "pwreset_cd_" + String(username).toLowerCase().trim(); }

function requestPasswordReset(p) {
  const identifier = String(p.identifier || p.username || p.email || "").trim();
  if (!identifier) return { success: false, error: "Enter your username or email." };

  const genericResponse = { success: true, message: "If that account exists, a reset link has been sent to its email address." };

  const sheet = getUsersSheet_();
  let found = findUserRow_(sheet, identifier);
  if (!found) found = findUserByField_(sheet, 3, identifier);
  if (!found) return genericResponse;

  const username = found.row[0];
  const email = found.row[3];
  if (!email) return genericResponse;

  const cooldownKey = resetCooldownKey_(username);
  const props = PropertiesService.getScriptProperties();
  const lastRequestAt = Number(props.getProperty(cooldownKey) || 0);
  if (Date.now() - lastRequestAt < RESET_REQUEST_COOLDOWN_MS) {
    return genericResponse;
  }

  const token = Utilities.getUuid();
  props.setProperty(resetTokenKey_(token), JSON.stringify({ username, expiresAt: Date.now() + RESET_TOKEN_TTL_MS }));
  props.setProperty(cooldownKey, String(Date.now()));

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
  }

  return genericResponse;
}

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
  props.deleteProperty(key);

  if (!state.expiresAt || Date.now() > state.expiresAt) {
    return { success: false, error: "This reset code has expired — request a new one." };
  }

  return withLock_(() => {
    const sheet = getUsersSheet_();
    const found = findUserRow_(sheet, state.username);
    if (!found) return { success: false, error: "Account not found." };

    const salt = makeSalt_();
    sheet.getRange(found.rowIndex, 2).setValue(salt + ":" + hashPassSalted_(newPassword, salt));
    sheet.getRange(found.rowIndex, 17).setValue("");
    sheet.getRange(found.rowIndex, 18).setValue("");
    clearLoginLock_("user", state.username);

    logAction_("system", "Password Reset", state.username, "Self-service reset via emailed code");
    return { success: true, username: state.username, message: "Password reset — please log in with your new password." };
  });
}

/* ═══════════════════════════════════════════════════════════════
   SIGNUP
   ═══════════════════════════════════════════════════════════════ */

function handleSignup(p) {
  if (!checkSignupRateLimit_()) {
    return { success: false, error: "Too many signups right now, please try again in a minute." };
  }
  const username = String(p.username || "").trim();
  const password = p.password || "";
  const name = sanitizeSheetField_(String(p.name || "").trim());
  // v1.04 — email and mobile are user-typed values that go straight into
  // the sheet via appendRow. Without sanitizeSheetField_ a value like
  // "=IMPORTXML(...)@x.co" satisfies the email regex and lands as a live
  // formula the moment an admin opens the Users tab. The contact column
  // mirrors whichever is present, so it needs the same treatment.
  const email = sanitizeSheetField_(String(p.email || "").trim());
  const mobile = String(p.mobile || "").trim();
  const contact = sanitizeSheetField_(email || mobile);
  const contactType = email ? "email" : (mobile ? "phone" : "other");

  if (!username || !password || !name || !email || !mobile) {
    return { success: false, error: "All fields required (username, password, name, email, mobile)." };
  }
  if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(username)) {
    return { success: false, error: "Username must be 3-30 characters: letters, numbers, dots, dashes, underscores only." };
  }
  if (password.length < 6) {
    return { success: false, error: "Password must be at least 6 characters." };
  }
  // Note: because email was sanitized above, the stored value may now
  // start with a leading apostrophe for a hostile input like
  // "'=SUM(...)@x.co" — the regex below runs against the CLEANED value,
  // which is fine: a genuinely valid email never starts with that
  // character, so a hostile one fails validation here and never reaches
  // the sheet at all.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.replace(/^'/, ''))) {
    return { success: false, error: "Invalid email address." };
  }
  if (!/^(98|97|96|99)\d{8}$/.test(mobile)) {
    return { success: false, error: "Invalid Nepali mobile number. Use 10 digits starting with 98/97/96/99." };
  }

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
      "trial",
      now.toISOString(),
      now.toISOString(),
      "user",
      trialExpiresAt.toISOString(),
      "none",
      "false"
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

  // Every branch echoes `token: p.token` — see the historical comment in
  // the original. This is deliberate: index.html's handleUserAuth() reads
  // res.token and persists whatever it gets. If this field were absent,
  // index.html would save `token: undefined` over the real one.
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
   PROGRESS SYNC
   ═══════════════════════════════════════════════════════════════ */

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
  const name = sanitizeSheetField_(String(p.name || "").trim());
  // v1.04 — same formula-injection treatment as handleSignup.
  const email = sanitizeSheetField_(String(p.email || "").trim());
  const mobile = String(p.mobile || "").trim();
  const txId = sanitizeSheetField_(String(p.txId || "").trim());
  const remarks = sanitizeSheetField_(String(p.remarks || "").trim());
  const screenshotData = p.screenshot || "";

  if (!username) return { success: false, error: "Username required." };
  if (!txId) return { success: false, error: "Transaction ID required." };

  const userSheet = getUsersSheet_();
  const userFound = findUserRow_(userSheet, username);
  if (!userFound) return { success: false, error: "User not found." };

  if (!verifyUserToken_(userFound, p.token)) {
    return { success: false, error: "Session expired. Please log in again.", sessionInvalid: true };
  }

  if (!checkRateLimit_("submitpayment_" + username.toLowerCase(), 10, 60 * 60 * 1000)) {
    return { success: false, error: "Too many payment submissions — please wait a few minutes and try again." };
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

  if (screenshotData && screenshotData.startsWith("data:image")) {
    try {
      const base64Data = screenshotData.split(",")[1];
      const blob = Utilities.newBlob(Utilities.base64Decode(base64Data), "image/png", username + "_payment.png");
      const folder = getOrCreateFolder_("PaymentScreenshots");
      const file = folder.createFile(blob);
      screenshotUrl = file.getDownloadUrl();
    } catch (e) {
      console.log("Screenshot upload failed: " + e.message);
    }
  } else if (screenshotData && screenshotData.startsWith("http")) {
    screenshotUrl = screenshotData;
  }

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

function getSettingValue_(key, fallback) {
  const settings = getSettings().settings || {};
  const v = settings[key];
  return (v === undefined || v === null || v === "") ? fallback : v;
}

/* ── QUESTION-FILE PROXY (READ-ONLY) ── */
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
   PUSH NOTIFICATIONS — FCM
   ═══════════════════════════════════════════════════════════════ */

function getFcmAccessToken_() {
  const props = PropertiesService.getScriptProperties();
  const clientEmail = props.getProperty("FCM_CLIENT_EMAIL");
  const privateKey = props.getProperty("FCM_PRIVATE_KEY");
  if (!clientEmail || !privateKey) {
    throw new Error("Push notifications not configured: missing FCM_CLIENT_EMAIL or FCM_PRIVATE_KEY in Script Properties.");
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
    if (result.unregistered) sheet.deleteRow(found.rowIndex);
    return { success: false, error: result.error };
  }
  return { success: true };
}

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
  const deadRows = [];
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
  deadRows.sort((a, b) => b - a).forEach(rowIndex => sheet.deleteRow(rowIndex));

  return { success: true, sent, failed };
}

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

const TRIAL_WARNING_WINDOW_MS = 2 * 60 * 60 * 1000;

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
    const warnKey = "trialwarned_" + String(username).toLowerCase();

    // v1.04 — the "already warned" flag is cleared whenever a user is
    // NOT in the warning window. Previously, once a warning was sent,
    // the flag persisted forever — so an admin extending a trial (or
    // re-verifying a rejected payment that resets status) would find
    // that the next near-expiry window produced NO warning at all,
    // silently. Clearing on the not-near-expiry path means the flag's
    // presence is a true "warning sent for THIS trial window" signal.
    const inWindow = status === "trial" && trialExpiresAt &&
                     (trialExpiresAt - now) > 0 &&
                     (trialExpiresAt - now) <= TRIAL_WARNING_WINDOW_MS;
    if (!inWindow) {
      if (props.getProperty(warnKey)) props.deleteProperty(warnKey);
      continue;
    }

    if (props.getProperty(warnKey)) continue;

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

function checkWeeklySetUnlocks_() {
  const sheet = getWeeklySetsSheet_();
  const data = sheet.getDataRange().getValues();
  const props = PropertiesService.getScriptProperties();
  const now = Date.now();
  let notified = 0;

  for (let i = 1; i < data.length; i++) {
    const s = rowToWeeklySet_(data[i]);
    if (s.status !== "active") continue;
    const releaseTime = new Date(s.releaseAt).getTime();
    if (isNaN(releaseTime) || now < releaseTime) continue;

    const notifyKey = "wsnotified_" + s.id;
    if (props.getProperty(notifyKey)) continue;

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

function ensurePushTriggers_() {
  const already = ScriptApp.getProjectTriggers()
    .some(t => t.getHandlerFunction() === "checkTrialExpiryWarnings");
  if (!already) ScriptApp.newTrigger("checkTrialExpiryWarnings").timeBased().everyMinutes(30).create();

  const weeklyAlready = ScriptApp.getProjectTriggers()
    .some(t => t.getHandlerFunction() === "checkWeeklySetUnlocks_");
  if (!weeklyAlready) ScriptApp.newTrigger("checkWeeklySetUnlocks_").timeBased().everyMinutes(15).create();
}

/* ═══════════════════════════════════════════════════════════════
   ADMIN API
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

// v1.04 — hard cap. Response includes `truncated` and `totalCount` so
// the admin UI can warn when it's looking at a partial list; refine
// via the search/filter to see specific users.
function adminListUsers(p) {
  if (!checkAdmin_(p)) return { success: false, error: "Admin auth failed." };
  const sheet = getUsersSheet_();
  const data = sheet.getDataRange().getValues();
  const totalCount = Math.max(0, data.length - 1);
  const users = [];
  const limit = Math.min(totalCount, MAX_LIST_USERS);
  for (let i = 1; i <= limit; i++) {
    users.push(rowToUser_(data[i]));
  }
  return { success: true, users, totalCount, truncated: totalCount > MAX_LIST_USERS };
}

// v1.04 — hard cap (see adminListUsers).
function adminListPayments(p) {
  if (!checkAdmin_(p)) return { success: false, error: "Admin auth failed." };
  const sheet = getPaymentsSheet_();
  const data = sheet.getDataRange().getValues();
  const totalCount = Math.max(0, data.length - 1);

  const txIdOwners = {};
  for (let i = 1; i < data.length; i++) {
    const txId = String(data[i][4] || "").trim().toLowerCase();
    const username = String(data[i][0] || "");
    if (!txId) continue;
    if (!txIdOwners[txId]) txIdOwners[txId] = new Set();
    txIdOwners[txId].add(username);
  }

  const payments = [];
  const limit = Math.min(totalCount, MAX_LIST_PAYMENTS);
  for (let i = 1; i <= limit; i++) {
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
  return { success: true, payments, totalCount, truncated: totalCount > MAX_LIST_PAYMENTS };
}

function adminReviewPayment(p) {
  const actor = checkAdmin_(p);
  if (!actor) return { success: false, error: "Admin auth failed." };

  const username = String(p.username || "").trim();
  const status = String(p.status || "").trim();
  const rejectionReason = sanitizeSheetField_(String(p.rejectionReason || "").trim());

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

  const userSheet = getUsersSheet_();
  const userFound = findUserRow_(userSheet, username);
  if (userFound) {
    if (status === "verified") {
      userSheet.getRange(userFound.rowIndex, 8).setValue("active");
      userSheet.getRange(userFound.rowIndex, 13).setValue("verified");
      userSheet.getRange(userFound.rowIndex, 14).setValue("true");
      userSheet.getRange(userFound.rowIndex, 10).setValue(new Date().toISOString());
      userSheet.getRange(userFound.rowIndex, 15).setValue("permanent");
      userSheet.getRange(userFound.rowIndex, 16).setValue("");
    } else if (status === "rejected") {
      userSheet.getRange(userFound.rowIndex, 8).setValue("expired");
      userSheet.getRange(userFound.rowIndex, 13).setValue("rejected");
      userSheet.getRange(userFound.rowIndex, 14).setValue("false");
    }
  }

  logAction_(actor, "Review Payment", username, "Status: " + status + (rejectionReason ? " (" + rejectionReason + ")" : ""));

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
  const rejectionReason = sanitizeSheetField_(String(p.rejectionReason || "").trim());
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

    usernames.forEach(rawUsername => {
      const username = String(rawUsername || "").trim();
      const payRow = payRowByUser[username.toLowerCase()];
      if (!payRow) { results.push({ username, success: false, error: "Payment not found." }); return; }

      const pRow = payData[payRow - 1];
      pRow[6] = status;
      if (rejectionReason && status === "rejected") pRow[7] = rejectionReason;
      pRow[10] = nowIso;
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

function adminGrantAccess(p) {
  const actor = checkAdmin_(p);
  if (!actor) return { success: false, error: "Admin auth failed." };

  const username = String(p.username || "").trim();
  const duration = String(p.duration || "").trim();
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

    sheet.getRange(found.rowIndex, 8).setValue("active");
    sheet.getRange(found.rowIndex, 10).setValue(new Date().toISOString());
    sheet.getRange(found.rowIndex, 13).setValue("verified");
    sheet.getRange(found.rowIndex, 14).setValue("true");
    sheet.getRange(found.rowIndex, 15).setValue(duration === "year" ? "yearly" : "permanent");
    sheet.getRange(found.rowIndex, 16).setValue(expiresAtIso);

    logAction_(actor, "Grant Access", username, "Duration: " + duration);
    return { success: true, username, duration, accessExpiresAt: expiresAtIso };
  });
}

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

    usernames.forEach(rawUsername => {
      const username = String(rawUsername || "").trim();
      const rowIndex = rowByUser[username.toLowerCase()];
      if (!rowIndex) { results.push({ username, success: false, error: "User not found." }); return; }

      const row = data[rowIndex - 1];
      row[7] = "active";
      row[9] = nowIso;
      row[12] = "verified";
      row[13] = "true";
      row[14] = duration === "year" ? "yearly" : "permanent";
      row[15] = expiresAtIso;
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
    if (p.name !== undefined) { sheet.getRange(found.rowIndex, 3).setValue(sanitizeSheetField_(p.name)); changes.push("name"); }
    if (p.email !== undefined) {
      const email = String(p.email).trim();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return { success: false, error: "Invalid email address." };
      }
      sheet.getRange(found.rowIndex, 4).setValue(sanitizeSheetField_(email));
      changes.push("email");
    }
    if (p.mobile !== undefined) {
      const mobile = String(p.mobile).trim();
      if (mobile && !/^(98|97|96|99)\d{8}$/.test(mobile)) {
        return { success: false, error: "Invalid Nepali mobile number. Use 10 digits starting with 98/97/96/99." };
      }
      sheet.getRange(found.rowIndex, 5).setValue(mobile);
      changes.push("mobile");
    }
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
    purgeUserAuxiliaryRows_(username);
    logAction_(actor, "Delete User", username, "Purged Progress/PushTokens/Payments/Backups/WeeklyAttempts");
    return { success: true, deleted: username };
  });
}

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
    const toDelete = [];
    usernames.forEach(rawUsername => {
      const username = String(rawUsername || "").trim();
      const rowIndex = rowByUser[username.toLowerCase()];
      if (!rowIndex) { results.push({ username, success: false, error: "User not found." }); return; }
      toDelete.push({ username, rowIndex });
    });

    toDelete.sort((a, b) => b.rowIndex - a.rowIndex);
    toDelete.forEach(({ username, rowIndex }) => {
      sheet.deleteRow(rowIndex);
      purgeUserAuxiliaryRows_(username);
      results.push({ username, success: true });
    });

    const okCount = results.filter(r => r.success).length;
    logAction_(actor, "Bulk Delete User", usernames.join(", "),
      okCount + "/" + usernames.length + " succeeded (auxiliary rows purged)");

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

/* ═══════════════════════════════════════════════════════════════
   WEEKLY SETS
   ═══════════════════════════════════════════════════════════════ */

function adminUploadWeeklySetFile(p) {
  const actor = checkAdmin_(p);
  if (!actor) return { success: false, error: "Admin auth failed." };

  const fileData = String(p.fileData || "");
  const filename = String(p.filename || "weeklyset.json").trim();
  if (!fileData) return { success: false, error: "No file data provided." };

  if (fileData.length > 5 * 1024 * 1024) {
    return { success: false, error: "File too large — question-bank JSON should be well under 4MB." };
  }

  let jsonText;
  try {
    jsonText = fileData.startsWith("data:")
      ? Utilities.newBlob(Utilities.base64Decode(fileData.split(",")[1])).getDataAsString("UTF-8")
      : fileData;
    JSON.parse(jsonText);
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

function adminCreateWeeklySet(p) {
  const actor = checkAdmin_(p);
  if (!actor) return { success: false, error: "Admin auth failed." };

  const title = sanitizeSheetField_(String(p.title || "").trim());
  const fileId = String(p.fileId || "").trim();
  const chapterLabel = sanitizeSheetField_(String(p.chapterLabel || "").trim());
  const releaseAtRaw = String(p.releaseAt || "").trim();

  if (!title) return { success: false, error: "Title required." };
  if (!fileId) return { success: false, error: "Drive fileId required." };

  const releaseAt = new Date(releaseAtRaw);
  if (!releaseAtRaw || isNaN(releaseAt)) {
    return { success: false, error: "A valid release date/time is required." };
  }

  return withLock_(() => {
    const sheet = getWeeklySetsSheet_();
    const existing = sheet.getDataRange().getValues();
    let duplicateOf = null;
    for (let i = 1; i < existing.length; i++) {
      if (String(existing[i][2]).trim() === fileId) { duplicateOf = existing[i][1]; break; }
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

// v1.04 note (in addition to the wsnotified_ cleanup): WeeklyAttempts
// rows for this set are intentionally NOT deleted. A student's submitted
// result is their own historical record — it shouldn't vanish because an
// admin retired the set. Orphaned attempt rows are harmless: they're
// never queried against a set that no longer exists, and if the set is
// somehow restored (uuid collision is effectively impossible, but
// restoring from a backup is not), the attempts resurface with it.
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
    PropertiesService.getScriptProperties().deleteProperty("wsnotified_" + id);
    logAction_(actor, "Delete Weekly Set", id, "");
    return { success: true, deleted: id };
  });
}

// v1.04 — hard cap (see adminListUsers).
function adminListWeeklySets(p) {
  if (!checkAdmin_(p)) return { success: false, error: "Admin auth failed." };
  const sheet = getWeeklySetsSheet_();
  const data = sheet.getDataRange().getValues();
  const totalCount = Math.max(0, data.length - 1);
  const sets = [];
  const limit = Math.min(totalCount, MAX_LIST_WEEKLYSETS);
  for (let i = 1; i <= limit; i++) sets.push(rowToWeeklySet_(data[i]));
  sets.sort((a, b) => new Date(a.releaseAt) - new Date(b.releaseAt));
  return { success: true, sets, totalCount, truncated: totalCount > MAX_LIST_WEEKLYSETS };
}

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
  sets.sort((a, b) => new Date(a.releaseAt) - new Date(b.releaseAt));
  return { success: true, sets };
}

/* ═══════════════════════════════════════════════════════════════
   WEEKLY ATTEMPT CAPTURE — v1.04
   ═══════════════════════════════════════════════════════════════ */

function getWeeklyAttempt(p) {
  const username = String(p.username || "").trim();
  const weeklyId = String(p.weeklyId || "").trim();
  if (!username || !weeklyId) return { success: false, error: "Missing parameters." };
  const userSheet = getUsersSheet_();
  const userFound = findUserRow_(userSheet, username);
  if (!userFound) return { success: false, error: "User not found." };
  if (!verifyUserToken_(userFound, p.token)) {
    return { success: false, error: "Session expired. Please log in again.", sessionInvalid: true };
  }
  const sheet = getWeeklyAttemptsSheet_();
  const found = findWeeklyAttemptRow_(sheet, username, weeklyId);
  return { success: true, attempt: found ? rowToWeeklyAttempt_(found.row) : null };
}

function getMyWeeklyAttempts(p) {
  const username = String(p.username || "").trim();
  if (!username) return { success: false, error: "Username required." };
  const userSheet = getUsersSheet_();
  const userFound = findUserRow_(userSheet, username);
  if (!userFound) return { success: false, error: "User not found." };
  if (!verifyUserToken_(userFound, p.token)) {
    return { success: false, error: "Session expired. Please log in again.", sessionInvalid: true };
  }
  const sheet = getWeeklyAttemptsSheet_();
  const data = sheet.getDataRange().getValues();
  const target = username.toLowerCase().trim();
  const attempts = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).toLowerCase().trim() === target) {
      attempts.push(rowToWeeklyAttempt_(data[i]));
    }
  }
  return { success: true, attempts };
}

// The one-shot write. Under the script-wide lock, checks for an existing
// row and refuses if one is found — so two devices racing on the same
// account can't both land an attempt; the first write wins and the
// second device gets the recorded attempt back so it can display it.
//
// Deliberately stores the raw answers array, not just a score:
// adminWeeklySetResults re-scores independently by re-fetching the
// source question file, so a forged correctCount here can't inflate
// anything an admin sees. correctClaimed is stored only as a display
// value for the student's own client.
function submitWeeklyAttempt(p) {
  const username = String(p.username || "").trim();
  const weeklyId = String(p.weeklyId || "").trim();
  if (!username || !weeklyId) return { success: false, error: "Missing parameters." };

  const userSheet = getUsersSheet_();
  const userFound = findUserRow_(userSheet, username);
  if (!userFound) return { success: false, error: "User not found." };
  if (!verifyUserToken_(userFound, p.token)) {
    return { success: false, error: "Session expired. Please log in again.", sessionInvalid: true };
  }

  const wsSheet = getWeeklySetsSheet_();
  const wsFound = findWeeklySetRow_(wsSheet, weeklyId);
  if (!wsFound) return { success: false, error: "Weekly set not found." };
  const ws = rowToWeeklySet_(wsFound.row);
  const releaseTime = new Date(ws.releaseAt).getTime();
  if (isNaN(releaseTime) || Date.now() < releaseTime) {
    return { success: false, error: "This weekly set hasn't been released yet." };
  }

  let answers;
  try {
    answers = JSON.parse(p.answers || "[]");
  } catch (e) {
    return { success: false, error: "Malformed answers array." };
  }
  if (!Array.isArray(answers) || !answers.length || answers.length > 500) {
    return { success: false, error: "Invalid answers array." };
  }
  const normalizedAnswers = answers.map(a => {
    if (a === null || a === undefined) return null;
    const n = Number(a);
    return Number.isInteger(n) && n >= 0 && n < 10 ? n : null;
  });

  const totalQuestions = normalizedAnswers.length;
  const skippedCount = normalizedAnswers.filter(a => a === null).length;

  return withLock_(() => {
    const sheet = getWeeklyAttemptsSheet_();
    const existing = findWeeklyAttemptRow_(sheet, username, weeklyId);
    if (existing) {
      return {
        success: false,
        alreadyAttempted: true,
        attempt: rowToWeeklyAttempt_(existing.row),
        error: "This weekly set has already been submitted."
      };
    }

    const correctClaimed = Math.max(0, Math.min(totalQuestions, Number(p.correctCount) || 0));
    const durationSec = Math.max(0, Math.min(6 * 60 * 60, Number(p.durationSec) || 0));
    const startedAt = Number(p.startedAt) || Date.now();
    const submittedAt = Date.now();

    sheet.appendRow([
      username,
      weeklyId,
      JSON.stringify(normalizedAnswers),
      totalQuestions,
      correctClaimed,
      skippedCount,
      startedAt,
      submittedAt,
      durationSec
    ]);

    logAction_("system", "Weekly Set Attempt", username,
      `${weeklyId} — ${correctClaimed}/${totalQuestions} in ${durationSec}s`);

    return {
      success: true,
      attempt: {
        weeklyId,
        answers: normalizedAnswers,
        total: totalQuestions,
        correct: correctClaimed,
        pct: totalQuestions ? Math.round((correctClaimed / totalQuestions) * 100) : 0,
        skipped: skippedCount,
        startedAt,
        submittedAt,
        durationSec,
        synced: true
      }
    };
  });
}

// Aggregates every submitted attempt for one Weekly Set. Re-scores each
// attempt from the raw answers array against the set's source question
// file, so the numbers an admin sees don't depend on anything the client
// claimed. Falls back to the stored correctClaimed if the source file
// can't be read (deleted from Drive, wrong fileId, etc.) — the response
// flags which path was taken via `rescored`.
function adminWeeklySetResults(p) {
  const actor = checkAdmin_(p);
  if (!actor) return { success: false, error: "Admin auth failed." };
  const weeklyId = String(p.weeklyId || "").trim();
  if (!weeklyId) return { success: false, error: "weeklyId required." };

  const wsSheet = getWeeklySetsSheet_();
  const wsFound = findWeeklySetRow_(wsSheet, weeklyId);
  if (!wsFound) return { success: false, error: "Weekly set not found." };
  const ws = rowToWeeklySet_(wsFound.row);

  // Fetch + parse the source file once for re-scoring.
  let correctAnswers = null;
  try {
    const fileRes = handleGetFile({ fileId: ws.fileId });
    if (fileRes.success) {
      const raw = fileRes.result;
      const qs = Array.isArray(raw)
        ? raw
        : (raw?.questions || raw?.data || raw?.quiz || raw?.items || []);
      correctAnswers = qs.map(q => {
        let c = q.correct !== undefined ? q.correct
              : q.answer  !== undefined ? q.answer
              : q.ans     !== undefined ? q.ans
              : q.Answer  !== undefined ? q.Answer : undefined;
        if (typeof c === "string" && /^[a-eA-E]$/.test(c.trim())) {
          c = "abcde".indexOf(c.trim().toLowerCase());
        }
        return c;
      });
    }
  } catch (e) {
    console.error("adminWeeklySetResults: could not re-score from source file:", e);
  }

  const sheet = getWeeklyAttemptsSheet_();
  const data = sheet.getDataRange().getValues();
  const attempts = [];

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]).trim() !== weeklyId) continue;
    const at = rowToWeeklyAttempt_(data[i]);

    let pct, correct, wrong, skipped;
    if (correctAnswers && at.answers.length === correctAnswers.length) {
      correct = 0; wrong = 0; skipped = 0;
      at.answers.forEach((a, idx) => {
        const expected = correctAnswers[idx];
        if (a === null) { skipped++; return; }
        const ok = (typeof expected === "number" && a === expected)
                || (typeof expected === "string" && String(a) === String(expected));
        if (ok) correct++; else wrong++;
      });
      const denom = at.total || correctAnswers.length;
      pct = denom ? Math.round((correct / denom) * 100) : 0;
    } else {
      correct = at.correct;
      skipped = at.skipped;
      wrong = Math.max(0, at.total - correct - skipped);
      pct = at.total ? Math.round((correct / at.total) * 100) : 0;
    }

    attempts.push({
      username: String(data[i][0] || ""),
      pct, correct, wrong, skipped,
      total: at.total,
      durationSec: at.durationSec,
      submittedAt: at.submittedAt
    });
  }

  if (!attempts.length) {
    return {
      success: true, weeklyId, title: ws.title,
      attempts: 0, uniqueStudents: 0,
      rescored: !!correctAnswers
    };
  }

  const pcts = attempts.map(a => a.pct);
  const mean = pcts.reduce((a, b) => a + b, 0) / pcts.length;
  const sorted = [...pcts].sort((a, b) => a - b);
  const variance = pcts.reduce((acc, v) => acc + (v - mean) ** 2, 0) / pcts.length;

  const buckets = Array.from({ length: 10 }, (_, i) => ({ range: `${i*10}-${i*10+9}`, count: 0 }));
  pcts.forEach(v => { buckets[Math.min(9, Math.floor(v / 10))].count++; });

  return {
    success: true,
    weeklyId,
    title: ws.title,
    attempts: attempts.length,
    uniqueStudents: attempts.length,
    avgPct: Math.round(mean),
    minPct: sorted[0],
    maxPct: sorted[sorted.length - 1],
    stdDev: Math.round(Math.sqrt(variance)),
    distribution: buckets,
    recent: attempts.sort((a, b) => b.submittedAt - a.submittedAt).slice(0, 50),
    rescored: !!correctAnswers
  };
}

/* ═══════════════════════════════════════════════════════════════
   QUESTION REPORTS
   ═══════════════════════════════════════════════════════════════ */

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
  const note = sanitizeSheetField_(String(p.note || "").trim().slice(0, 500));
  const questionSnapshot = String(p.questionSnapshot || "").trim().slice(0, 1000);
  if (!uid) return { success: false, error: "Missing question reference." };
  if (!["wrong_answer", "unclear", "typo", "other"].includes(reason)) {
    return { success: false, error: "Invalid report reason." };
  }

  const m = uid.match(/^(.+)_(\d+)$/);
  const fileId = m ? m[1] : uid;

  return withLock_(() => {
    const sheet = getQReportsSheet_();
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

// v1.04 — hard cap (see adminListUsers).
function adminListQuestionReports(p) {
  if (!checkAdmin_(p)) return { success: false, error: "Admin auth failed." };
  const sheet = getQReportsSheet_();
  const data = sheet.getDataRange().getValues();
  const totalCount = Math.max(0, data.length - 1);
  const reports = [];
  const limit = Math.min(totalCount, MAX_LIST_QREPORTS);
  for (let i = 1; i <= limit; i++) reports.push(rowToQReport_(data[i]));
  reports.sort((a, b) => {
    if (a.status === "open" && b.status !== "open") return -1;
    if (a.status !== "open" && b.status === "open") return 1;
    return new Date(b.reportedAt) - new Date(a.reportedAt);
  });
  return { success: true, reports, totalCount, truncated: totalCount > MAX_LIST_QREPORTS };
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

/* ═══════════════════════════════════════════════════════════════
   REPORTING & PROGRESS IMPORT
   ═══════════════════════════════════════════════════════════════ */

const PROGRESS_IMPORTS_SHEET = "ProgressImports";
const PROGRESS_BACKUPS_SHEET = "ProgressBackups";

const PROGRESS_IMPORT_HEADERS = [
  "importId", "admin", "mode", "status", "recordsReceived",
  "recordsAccepted", "recordsSkipped", "errorCount", "createdAt",
  "completedAt", "details"
];

const PROGRESS_BACKUP_HEADERS = [
  "backupId", "importId", "username", "data", "createdAt", "createdBy"
];

const MAX_IMPORT_BODY_CHARS = 450000;
const MAX_IMPORT_RECORDS = 500;
const MAX_IMPORT_DATA_CHARS_PER_USER = 45000;
const MAX_REPORT_LIMIT = 500;
const MAX_REPORT_MIN_ATTEMPTS = 1000000;

function getProgressImportsSheet_() {
  const spreadsheet = getSpreadsheet_();
  let sheet = spreadsheet.getSheetByName(PROGRESS_IMPORTS_SHEET);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(PROGRESS_IMPORTS_SHEET);
    sheet.appendRow(PROGRESS_IMPORT_HEADERS);
    if (!SKIP_CREATION_FORMATTING) {
      applyTableFormat_(sheet, PROGRESS_IMPORT_HEADERS, "#5e35b1", SpreadsheetApp.BandingTheme.PURPLE, 320);
    }
  }
  return sheet;
}

function getProgressBackupsSheet_() {
  const spreadsheet = getSpreadsheet_();
  let sheet = spreadsheet.getSheetByName(PROGRESS_BACKUPS_SHEET);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(PROGRESS_BACKUPS_SHEET);
    sheet.appendRow(PROGRESS_BACKUP_HEADERS);
    if (!SKIP_CREATION_FORMATTING) {
      applyTableFormat_(sheet, PROGRESS_BACKUP_HEADERS, "#455a64", SpreadsheetApp.BandingTheme.GREY, 320);
    }
  }
  return sheet;
}

function createProgressImportLog_(admin, mode, recordCount) {
  const importId = Utilities.getUuid();
  getProgressImportsSheet_().appendRow([
    importId, admin || "admin", mode || "preview", "started",
    Number(recordCount) || 0, 0, 0, 0, new Date().toISOString(), "", ""
  ]);
  return importId;
}

function updateProgressImportLog_(importId, status, recordsAccepted, recordsSkipped, errorCount, details) {
  const sheet = getProgressImportsSheet_();
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(importId)) {
      sheet.getRange(i + 1, 4, 1, 8).setValues([[
        status || "",
        values[i][4] || 0,
        Number(recordsAccepted) || 0,
        Number(recordsSkipped) || 0,
        Number(errorCount) || 0,
        values[i][8] || "",
        new Date().toISOString(),
        String(details || "").slice(0, 30000)
      ]]);
      return;
    }
  }
}

function safeImportString_(value, maxLength) {
  const result = String(value == null ? "" : value).trim();
  return (maxLength && result.length > maxLength) ? result.slice(0, maxLength) : result;
}

function normalizeImportMode_(mode) {
  const value = String(mode || "preview").trim().toLowerCase();
  return ["preview", "merge", "replace"].includes(value) ? value : "";
}

function normalizeImportRecords_(payload) {
  if (!payload || typeof payload !== "object") return [];
  if (Array.isArray(payload.records)) return payload.records;
  if (Array.isArray(payload.users)) return payload.users;
  if (payload.username && payload.data) return [{ username: payload.username, data: payload.data }];
  return [];
}

function parseImportData_(value) {
  if (value && typeof value === "object") return value;
  const raw = String(value || "").trim();
  if (!raw) throw new Error("Progress data is empty.");
  if (raw.length > MAX_IMPORT_DATA_CHARS_PER_USER) throw new Error("Progress data exceeds the 45,000 character limit.");
  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) { throw new Error("Progress data is not valid JSON."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Progress data must be a JSON object.");
  return parsed;
}

function validateProgressObject_(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { valid: false, error: "Progress data must be an object." };
  }
  const allowedKeys = { prog: true, bk: true, fl: true, wr: true, stk: true, chapStats: true, schemaVersion: true, updatedAt: true };
  for (const key of Object.keys(data)) {
    if (!allowedKeys[key]) return { valid: false, error: "Unsupported progress field: " + key };
  }
  for (const arrayField of ["bk", "fl", "wr"]) {
    if (data[arrayField] !== undefined && !Array.isArray(data[arrayField])) {
      return { valid: false, error: arrayField + " must be an array." };
    }
  }
  if (data.prog !== undefined) {
    if (!data.prog || typeof data.prog !== "object" || Array.isArray(data.prog)) {
      return { valid: false, error: "prog must be an object." };
    }
    if (data.prog.sessions !== undefined && !Array.isArray(data.prog.sessions)) {
      return { valid: false, error: "prog.sessions must be an array." };
    }
    for (const numericField of ["total", "correct", "studySec"]) {
      const v = data.prog[numericField];
      if (v !== undefined && (typeof v !== "number" || !isFinite(v))) {
        return { valid: false, error: "prog." + numericField + " must be numeric." };
      }
    }
  }
  return { valid: true };
}

function serializeProgressObject_(data) {
  const json = JSON.stringify(data);
  if (json.length > MAX_IMPORT_DATA_CHARS_PER_USER) throw new Error("Merged progress exceeds the 45,000 character limit.");
  return json;
}

function cloneJson_(value) {
  return JSON.parse(JSON.stringify(value));
}

function itemUid_(item) {
  return (item && typeof item === "object") ? String(item.uid || item.id || "").trim() : "";
}

function mergeUniqueItemsByUid_(first, second) {
  const result = [];
  const seen = {};
  for (const list of [Array.isArray(first) ? first : [], Array.isArray(second) ? second : []]) {
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const uid = itemUid_(item);
      if (!uid) continue;
      if (!seen[uid]) {
        seen[uid] = true;
        result.push(cloneJson_(item));
      } else {
        const idx = result.findIndex(r => itemUid_(r) === uid);
        if (idx !== -1) result[idx] = Object.assign({}, result[idx], cloneJson_(item));
      }
    }
  }
  return result;
}

function sessionIdentity_(session) {
  if (!session || typeof session !== "object") return "";
  if (session.id) return String(session.id);
  return [String(session.at || session.startedAt || ""), String(session.mode || ""), String(session.chapter || ""), String(session.total || 0)].join("|");
}

function mergeSessions_(first, second) {
  const result = [];
  const index = {};
  for (const list of [Array.isArray(first) ? first : [], Array.isArray(second) ? second : []]) {
    for (const session of list) {
      if (!session || typeof session !== "object") continue;
      const identity = sessionIdentity_(session);
      if (!identity) continue;
      if (index[identity] === undefined) {
        index[identity] = result.length;
        result.push(cloneJson_(session));
      } else {
        const i = index[identity];
        const existing = result[i];
        result[i] = Object.assign({}, existing, cloneJson_(session));
        if (existing.qres || session.qres) {
          result[i].qres = mergeQuestionResults_(existing.qres, session.qres);
        }
      }
    }
  }
  result.sort((a, b) => Number(a.at || 0) - Number(b.at || 0));
  return result.slice(-500);
}

function questionResultIdentity_(result) {
  return (result && typeof result === "object") ? [String(result.uid || ""), String(result.at || ""), result.ok ? "1" : "0"].join("|") : "";
}

function mergeQuestionResults_(first, second) {
  const result = [];
  const seen = {};
  for (const list of [Array.isArray(first) ? first : [], Array.isArray(second) ? second : []]) {
    for (const item of list) {
      if (!item || typeof item !== "object" || !item.uid) continue;
      const identity = questionResultIdentity_(item);
      if (!seen[identity]) {
        seen[identity] = true;
        result.push(cloneJson_(item));
      }
    }
  }
  return result.slice(-10000);
}

function mergeProgressData_(existing, incoming) {
  existing = existing || {};
  incoming = incoming || {};
  const result = Object.assign({}, cloneJson_(existing), cloneJson_(incoming));
  const existingProg = existing.prog || {};
  const incomingProg = incoming.prog || {};
  result.prog = Object.assign({}, cloneJson_(existingProg), cloneJson_(incomingProg));
  result.prog.sessions = mergeSessions_(existingProg.sessions, incomingProg.sessions);
  result.prog.total = result.prog.sessions.reduce((t, s) => t + Number(s.total || 0), 0);
  result.prog.correct = result.prog.sessions.reduce((t, s) => t + Number(s.correct || 0), 0);
  result.bk = mergeUniqueItemsByUid_(existing.bk, incoming.bk);
  result.fl = mergeUniqueItemsByUid_(existing.fl, incoming.fl);
  result.wr = mergeUniqueItemsByUid_(existing.wr, incoming.wr);
  result.schemaVersion = 2;
  result.updatedAt = new Date().toISOString();
  return result;
}

function getProgressRecordForImport_(sheet, username) {
  const found = findProgressRow_(sheet, username);
  if (!found || !found.row || !found.row[1]) return { found: false, rowIndex: null, data: null };
  try {
    return { found: true, rowIndex: found.rowIndex, data: parseImportData_(found.row[1]) };
  } catch (e) {
    return { found: true, rowIndex: found.rowIndex, data: null, error: "Existing server progress is malformed." };
  }
}

function backupProgressRecord_(importId, admin, username, data) {
  const json = serializeProgressObject_(data);
  const backupId = Utilities.getUuid();
  getProgressBackupsSheet_().appendRow([backupId, importId, username, json, new Date().toISOString(), admin || "admin"]);
  return backupId;
}

function adminImportProgress(p) {
  const actor = checkAdmin_(p);
  if (!actor) return { success: false, error: "Admin auth failed." };

  const mode = normalizeImportMode_(p.mode);
  if (!mode) return { success: false, error: "mode must be preview, merge, or replace." };

  let rawPayload = (p.payload !== undefined && p.payload !== null) ? p.payload : p.data;
  if (typeof rawPayload === "string") {
    if (rawPayload.length > MAX_IMPORT_BODY_CHARS) return { success: false, error: "Import payload is too large." };
    try { rawPayload = JSON.parse(rawPayload); } catch (e) { return { success: false, error: "Import payload is not valid JSON." }; }
  }
  if (!rawPayload || typeof rawPayload !== "object") return { success: false, error: "Import payload must be a JSON object." };

  const records = normalizeImportRecords_(rawPayload);
  if (!records.length) return { success: false, error: "No import records found." };
  if (records.length > MAX_IMPORT_RECORDS) return { success: false, error: "Import is limited to " + MAX_IMPORT_RECORDS + " records." };

  const importId = createProgressImportLog_(actor, mode, records.length);
  const validationErrors = [];
  const accepted = [];
  let skipped = 0;

  records.forEach((record, i) => {
    record = record || {};
    const username = safeImportString_(record.username, 120);
    if (!username) {
      skipped++;
      validationErrors.push({ index: i, error: "username is required." });
      return;
    }
    let importedData;
    try {
      importedData = parseImportData_(record.data !== undefined ? record.data : record.progress);
    } catch (e) {
      skipped++;
      validationErrors.push({ index: i, username, error: e.message });
      return;
    }
    const validation = validateProgressObject_(importedData);
    if (!validation.valid) {
      skipped++;
      validationErrors.push({ index: i, username, error: validation.error });
      return;
    }
    accepted.push({ username, data: importedData });
  });

  if (mode === "preview") {
    updateProgressImportLog_(importId, "preview", accepted.length, skipped, validationErrors.length, JSON.stringify(validationErrors).slice(0, 30000));
    return {
      success: true, importId, mode, preview: true,
      recordsReceived: records.length, recordsAccepted: accepted.length,
      recordsSkipped: skipped, errors: validationErrors
    };
  }

  try {
    return withLock_(() => applyProgressImport_(importId, actor, mode, accepted, validationErrors));
  } catch (e) {
    updateProgressImportLog_(importId, "failed", 0, skipped, validationErrors.length + 1, e.message);
    return { success: false, importId, error: "Import failed: " + e.message };
  }
}

function applyProgressImport_(importId, actor, mode, accepted, validationErrors) {
  const progressSheet = getProgressSheet_();
  const userSheet = getUsersSheet_();
  let acceptedCount = 0;
  let skippedCount = validationErrors.length;
  const errors = validationErrors.slice();

  accepted.forEach(item => {
    const username = item.username;
    const incoming = item.data;
    const userFound = findUserRow_(userSheet, username);
    if (!userFound) {
      skippedCount++;
      errors.push({ username, error: "User account does not exist." });
      return;
    }

    const current = getProgressRecordForImport_(progressSheet, username);
    if (current.error) {
      skippedCount++;
      errors.push({ username, error: current.error });
      return;
    }

    let finalData = incoming;
    if (mode === "merge" && current.found && current.data) {
      finalData = mergeProgressData_(current.data, incoming);
    } else if (mode === "replace" && current.found && current.data) {
      backupProgressRecord_(importId, actor, username, current.data);
    }

    try {
      const json = serializeProgressObject_(finalData);
      const now = new Date().toISOString();
      if (current.found) {
        progressSheet.getRange(current.rowIndex, 2, 1, 2).setValues([[json, now]]);
      } else {
        progressSheet.appendRow([username, json, now]);
      }
      acceptedCount++;
    } catch (e) {
      skippedCount++;
      errors.push({ username, error: e.message });
    }
  });

  const status = errors.length ? "completed_with_errors" : "completed";
  updateProgressImportLog_(importId, status, acceptedCount, skippedCount, errors.length, JSON.stringify(errors).slice(0, 30000));
  logAction_(actor, "Import Progress Data", importId, "Mode: " + mode + "; accepted: " + acceptedCount + "; skipped: " + skippedCount);

  return { success: true, importId, mode, preview: false, recordsAccepted: acceptedCount, recordsSkipped: skippedCount, errors };
}

function adminImportStatus(p) {
  if (!checkAdmin_(p)) return { success: false, error: "Admin auth failed." };
  const importId = safeImportString_(p.importId, 100);
  if (!importId) return { success: false, error: "importId is required." };

  const values = getProgressImportsSheet_().getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]) === importId) {
      let errors = [];
      if (values[i][10]) {
        try { errors = JSON.parse(values[i][10]); } catch (e) { errors = [{ error: String(values[i][10]) }]; }
      }
      return {
        success: true,
        import: {
          importId: values[i][0], admin: values[i][1], mode: values[i][2], status: values[i][3],
          recordsReceived: Number(values[i][4] || 0), recordsAccepted: Number(values[i][5] || 0),
          recordsSkipped: Number(values[i][6] || 0), errorCount: Number(values[i][7] || 0),
          createdAt: values[i][8], completedAt: values[i][9], errors
        }
      };
    }
  }
  return { success: false, error: "Import not found." };
}

// v1.04 — hard row cap on the Progress scan. Response includes
// `truncated` so the admin UI can warn that aggregation stopped short.
function adminMostMissedQuestions(p) {
  const actor = checkAdmin_(p);
  if (!actor) return { success: false, error: "Admin auth failed." };

  const filters = {
    level: safeImportString_(p.level, 120),
    chapter: safeImportString_(p.chapter, 200),
    book: safeImportString_(p.book, 200),
    subtopic: safeImportString_(p.subtopic, 200),
    dateFrom: safeImportString_(p.dateFrom, 30),
    dateTo: safeImportString_(p.dateTo, 30),
    minAttempts: Math.max(1, Math.min(MAX_REPORT_MIN_ATTEMPTS, Number(p.minAttempts) || 3)),
    limit: Math.max(1, Math.min(MAX_REPORT_LIMIT, Number(p.limit) || 30))
  };

  const fromTime = parseReportDateFrom_(filters.dateFrom);
  const toTime = parseReportDateTo_(filters.dateTo);
  if (filters.dateFrom && fromTime === null) return { success: false, error: "dateFrom must use YYYY-MM-DD format." };
  if (filters.dateTo && toTime === null) return { success: false, error: "dateTo must use YYYY-MM-DD format." };
  if (fromTime !== null && toTime !== null && fromTime > toTime) return { success: false, error: "dateFrom cannot be later than dateTo." };

  const sheet = getProgressSheet_();
  const data = sheet.getDataRange().getValues();
  const totalRows = Math.max(0, data.length - 1);
  const rowsToScan = Math.min(totalRows, MAX_MISSED_SCAN_ROWS);
  const tally = {};

  for (let i = 1; i <= rowsToScan; i++) {
    const username = String(data[i][0] || "").trim();
    const raw = data[i][1];
    if (!username || !raw) continue;

    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) { continue; }

    const sessions = (parsed && parsed.prog && Array.isArray(parsed.prog.sessions)) ? parsed.prog.sessions : [];
    for (const session of sessions) {
      if (!session || typeof session !== "object") continue;

      const sessionTime = normalizeReportTime_(session.at);
      if (sessionTime !== null && fromTime !== null && sessionTime < fromTime) continue;
      if (sessionTime !== null && toTime !== null && sessionTime > toTime) continue;

      const qres = Array.isArray(session.qres) ? session.qres : [];
      for (const qr of qres) {
        if (!qr || !qr.uid) continue;

        const metadata = reportMetadataForQuestion_(qr, session);
        if (!reportMetadataMatches_(metadata, filters)) continue;

        const uid = String(qr.uid);
        if (!tally[uid]) {
          tally[uid] = {
            uid, fileId: reportFileIdFromUid_(uid), index: reportIndexFromUid_(uid),
            level: metadata.level, chapter: metadata.chapter, book: metadata.book, subtopic: metadata.subtopic,
            wrong: 0, total: 0, students: {}, lastAttemptAt: null
          };
        }
        const record = tally[uid];
        record.total++;
        if (!qr.ok) record.wrong++;
        record.students[username] = true;

        const attemptTime = normalizeReportTime_(qr.at || session.at);
        if (attemptTime !== null && (record.lastAttemptAt === null || attemptTime > record.lastAttemptAt)) {
          record.lastAttemptAt = attemptTime;
        }
        if (!record.level && metadata.level) record.level = metadata.level;
        if (!record.chapter && metadata.chapter) record.chapter = metadata.chapter;
        if (!record.book && metadata.book) record.book = metadata.book;
        if (!record.subtopic && metadata.subtopic) record.subtopic = metadata.subtopic;
      }
    }
  }

  const results = Object.keys(tally)
    .map(uid => {
      const record = tally[uid];
      const studentCount = Object.keys(record.students).length;
      return {
        uid: record.uid, fileId: record.fileId, index: record.index,
        level: record.level || "", chapter: record.chapter || "", book: record.book || "", subtopic: record.subtopic || "",
        wrong: record.wrong, total: record.total,
        wrongRate: record.total ? Math.round((record.wrong / record.total) * 100) : 0,
        accuracy: record.total ? Math.round(((record.total - record.wrong) / record.total) * 100) : 0,
        uniqueStudents: studentCount,
        lastAttemptAt: record.lastAttemptAt ? new Date(record.lastAttemptAt).toISOString() : ""
      };
    })
    .filter(record => record.total >= filters.minAttempts && record.fileId !== "local")
    .sort((a, b) => b.wrongRate - a.wrongRate || b.total - a.total || b.uniqueStudents - a.uniqueStudents)
    .slice(0, filters.limit);

  logAction_(actor, "View Filtered Question Report", "", JSON.stringify(filters).slice(0, 1000));

  return {
    success: true, results, filters, minAttempts: filters.minAttempts, limit: filters.limit,
    generatedAt: new Date().toISOString(),
    truncated: totalRows > MAX_MISSED_SCAN_ROWS,
    totalRowsScanned: rowsToScan,
    totalRowsAvailable: totalRows
  };
}

// v1.04 — chapterKey is now preferred over chapter. Sessions recorded by
// app.js v1.04+ carry both: `chapter` is the display label
// ("Structural Engineering — Abhyas"), `chapterKey` is the canonical key
// matching the admin filter dropdown ("Structural Engineering"). Older
// sessions without chapterKey still fall back to `chapter`, which works
// for legacy data and is what the previous behavior always did.
function reportMetadataForQuestion_(questionResult, session) {
  const metadata = (questionResult && questionResult.meta && typeof questionResult.meta === "object") ? questionResult.meta : {};
  return {
    level: String(questionResult.level || metadata.level || questionResult.lv || session.lv || "").trim(),
    chapter: String(
      questionResult.chapterKey || metadata.chapterKey || session.chapterKey
      || questionResult.chapter || metadata.chapter || questionResult.ch || session.ch || session.chapter || ""
    ).trim(),
    book: String(questionResult.book || metadata.book || session.book || "").trim(),
    subtopic: String(questionResult.subtopic || metadata.subtopic || questionResult.sub || session.sub || "").trim()
  };
}

function reportMetadataMatches_(metadata, filters) {
  if (filters.level && metadata.level.toLowerCase() !== filters.level.toLowerCase()) return false;
  if (filters.chapter && metadata.chapter.toLowerCase() !== filters.chapter.toLowerCase()) return false;
  if (filters.book && metadata.book.toLowerCase() !== filters.book.toLowerCase()) return false;
  if (filters.subtopic && metadata.subtopic.toLowerCase() !== filters.subtopic.toLowerCase()) return false;
  return true;
}

function parseReportDateFrom_(value) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value + "T00:00:00.000Z");
  return isNaN(date.getTime()) ? null : date.getTime();
}

function parseReportDateTo_(value) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value + "T23:59:59.999Z");
  return isNaN(date.getTime()) ? null : date.getTime();
}

function normalizeReportTime_(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return isFinite(value) ? value : null;
  const numeric = Number(value);
  if (!isNaN(numeric) && numeric > 0) return numeric;
  const parsed = new Date(String(value));
  return isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function reportFileIdFromUid_(uid) {
  const value = String(uid || "");
  const match = value.match(/^(.+)_(\d+)$/);
  return match ? match[1] : value;
}

function reportIndexFromUid_(uid) {
  const value = String(uid || "");
  const match = value.match(/^(.+)_(\d+)$/);
  return match ? Number(match[2]) : null;
}

/* ═══════════════════════════════════════════════════════════════
   ADMIN CLEANUP
   ═══════════════════════════════════════════════════════════════ */

function adminClearProgressBackups(p) {
  const actor = checkAdmin_(p);
  if (!actor) return { success: false, error: "Admin auth failed." };
  return withLock_(() => {
    const sheet = getProgressBackupsSheet_();
    const lastRow = sheet.getLastRow();
    const deleted = Math.max(0, lastRow - 1);
    if (deleted > 0) sheet.deleteRows(2, deleted);
    logAction_(actor, "Clear Progress Backups", "", "Deleted " + deleted + " backup row(s)");
    return { success: true, deleted };
  });
}

function adminPruneOldBackups(p) {
  const actor = checkAdmin_(p);
  if (!actor) return { success: false, error: "Admin auth failed." };
  const days = Math.max(1, Math.min(3650, Number(p.daysToKeep) || 30));
  return withLock_(() => {
    const sheet = getProgressBackupsSheet_();
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: true, deleted: 0, daysToKeep: days };
    const data = sheet.getRange(2, 1, lastRow - 1, PROGRESS_BACKUP_HEADERS.length).getValues();
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const rowsToDelete = [];
    data.forEach((row, i) => {
      const t = new Date(row[4]).getTime();
      if (!isNaN(t) && t < cutoff) rowsToDelete.push(i + 2);
    });
    rowsToDelete.sort((a, b) => b - a).forEach(r => sheet.deleteRow(r));
    logAction_(actor, "Prune Progress Backups", "", "Kept last " + days + "d, deleted " + rowsToDelete.length + " row(s)");
    return { success: true, deleted: rowsToDelete.length, daysToKeep: days };
  });
}

function adminTrimLogs(p) {
  const actor = checkAdmin_(p);
  if (!actor) return { success: false, error: "Admin auth failed." };
  const keepLast = Math.max(100, Math.min(100000, Number(p.keepLast) || 5000));
  return withLock_(() => {
    const sheet = getLogsSheet_();
    const lastRow = sheet.getLastRow();
    const totalDataRows = Math.max(0, lastRow - 1);
    const toDelete = Math.max(0, totalDataRows - keepLast);
    if (toDelete > 0) sheet.deleteRows(2, toDelete);
    logAction_(actor, "Trim Logs", "", "Kept " + keepLast + ", deleted " + toDelete + " row(s)");
    return { success: true, deleted: toDelete, kept: keepLast };
  });
}

function adminRevokeScreenshotSharing(p) {
  const actor = checkAdmin_(p);
  if (!actor) return { success: false, error: "Admin auth failed." };

  const folderIter = DriveApp.getFoldersByName("PaymentScreenshots");
  if (!folderIter.hasNext()) {
    return { success: true, processed: 0, revoked: 0, alreadyPrivate: 0, failed: 0, message: "No PaymentScreenshots folder yet — nothing to do." };
  }
  const folder = folderIter.next();
  const files = folder.getFiles();
  let processed = 0, revoked = 0, alreadyPrivate = 0, failed = 0;
  while (files.hasNext()) {
    processed++;
    const f = files.next();
    try {
      if (f.getSharingAccess() === DriveApp.Access.PRIVATE) {
        alreadyPrivate++;
        continue;
      }
      f.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
      revoked++;
    } catch (e) {
      failed++;
      console.error("adminRevokeScreenshotSharing: could not revoke " + f.getId() + " — " + (e.message || e));
    }
  }
  logAction_(actor, "Revoke Screenshot Sharing", "",
    `Processed ${processed}, revoked ${revoked}, already-private ${alreadyPrivate}, failed ${failed}`);
  return { success: true, processed, revoked, alreadyPrivate, failed };
}

function adminExpiringTrials(p) {
  if (!checkAdmin_(p)) return { success: false, error: "Admin auth failed." };
  const hours = Math.max(1, Math.min(168, Number(p.hours) || 24));
  const sheet = getUsersSheet_();
  const data = sheet.getDataRange().getValues();
  const now = Date.now();
  const cutoff = now + hours * 60 * 60 * 1000;
  const users = [];
  for (let i = 1; i < data.length; i++) {
    const u = rowToUser_(data[i]);
    if (u.status !== "trial" || !u.trialExpiresAt) continue;
    const t = new Date(u.trialExpiresAt).getTime();
    if (isNaN(t) || t <= now || t > cutoff) continue;
    users.push(u);
  }
  users.sort((a, b) => new Date(a.trialExpiresAt) - new Date(b.trialExpiresAt));
  return { success: true, hours, count: users.length, users };
}

/* ═══════════════════════════════════════════════════════════════
   SHEET FORMATTING RETROFIT
   ═══════════════════════════════════════════════════════════════ */

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

  const pi = getProgressImportsSheet_();
  applyTableFormat_(pi, PROGRESS_IMPORT_HEADERS, "#5e35b1", SpreadsheetApp.BandingTheme.PURPLE, 320);

  const pb = getProgressBackupsSheet_();
  applyTableFormat_(pb, PROGRESS_BACKUP_HEADERS, "#455a64", SpreadsheetApp.BandingTheme.GREY, 320);

  // v1.04 — WeeklyAttempts (twelfth sheet)
  const wa = getWeeklyAttemptsSheet_();
  maxRows = wa.getMaxRows() - 1;
  [1, 2].forEach(col => wa.getRange(2, col, maxRows, 1).setNumberFormat("@"));
  applyTableFormat_(wa, WEEKLYATTEMPT_HEADERS, "#00897b", SpreadsheetApp.BandingTheme.TEAL, 300);

  sortSheetsAlphabetically_();

  console.log("✅ Sheet formatting fixed/retrofitted on all twelve sheets, tabs sorted A→Z.");
  return "Sheet formatting fixed and tabs sorted. Check View → Logs for details.";
}

/* ═══════════════════════════════════════════════════════════════
   DEBUG / TEST
   ═══════════════════════════════════════════════════════════════ */

function testAll() {
  const testAdminPass = ADMIN_SEED_PASSWORD;

  console.log("═══════════════════════════════════════════════════════");
  console.log("  Abhyas V1 — FULL SYSTEM TEST");
  console.log("═══════════════════════════════════════════════════════");

  console.log("\n[1/10] Running setup...");
  setup();
  console.log("✅ Setup complete");

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

  console.log("\n[3/10] Testing login (trial)...");
  const loginTrial = handleLogin({
    username: "testuser",
    password: "testpass"
  });
  console.log("Login (trial):", JSON.stringify(loginTrial));
  if (!loginTrial.success || !loginTrial.isTrial) throw new Error("TRIAL LOGIN FAILED");

  console.log("\n[4/10] Testing admin login...");
  const adminResult = adminLogin({
    username: "admin",
    password: testAdminPass
  });
  console.log("Admin login:", JSON.stringify(adminResult));
  if (!adminResult.success || !adminResult.isAdmin) throw new Error("ADMIN LOGIN FAILED");

  console.log("\n[5/10] Testing admin list users...");
  const listUsers = adminListUsers({ adminUser: "admin", adminPass: testAdminPass });
  console.log("Users count:", listUsers.users.length);
  if (!listUsers.success) throw new Error("ADMIN LIST USERS FAILED");

  console.log("\n[6/10] Simulating trial expiration...");
  const sheet = getUsersSheet_();
  const found = findUserRow_(sheet, "testuser");
  const pastDate = new Date(Date.now() - 25 * 60 * 60 * 1000);
  sheet.getRange(found.rowIndex, 12).setValue(pastDate.toISOString());
  console.log("✅ Trial date set to past");

  console.log("\n[7/10] Testing login (expired)...");
  const loginExpired = handleLogin({
    username: "testuser",
    password: "testpass"
  });
  console.log("Login (expired):", JSON.stringify(loginExpired));
  if (!loginExpired.success || !loginExpired.needsPayment) throw new Error("EXPIRED LOGIN FAILED");

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

  console.log("\n[9/10] Testing admin verify payment...");
  const verifyResult = adminReviewPayment({
    adminUser: "admin",
    adminPass: testAdminPass,
    username: "testuser",
    status: "verified"
  });
  console.log("Verify:", JSON.stringify(verifyResult));
  if (!verifyResult.success) throw new Error("ADMIN VERIFY FAILED");

  console.log("\n[10/10] Testing login (permanent)...");
  const loginActive = handleLogin({
    username: "testuser",
    password: "testpass"
  });
  console.log("Login (active):", JSON.stringify(loginActive));
  if (!loginActive.success || !loginActive.permanentAccess) throw new Error("PERMANENT ACCESS LOGIN FAILED");

  console.log("\n[EXTRA] Admin stats...");
  const stats = adminStats({ adminUser: "admin", adminPass: testAdminPass });
  console.log("Stats:", JSON.stringify(stats));

  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  ✅ ALL TESTS PASSED — SYSTEM READY");
  console.log("═══════════════════════════════════════════════════════");

  return "All tests passed. Check View → Logs for details.";
}

/* ═══════════════════════════════════════════════════════════════
   DANGEROUS RESET — DO NOT RUN CASUALLY
   ═══════════════════════════════════════════════════════════════

   v1.04: guarded behind ALLOW_RESET_ALL. Previously this function was
   live-runnable from the Apps Script editor with a single misclick in
   the function dropdown — which would have wiped every user, every
   payment, and every setting in production. Flipping the constant to
   true is a deliberate act, and the function refuses to run otherwise
   with a loud log message.

   Do NOT set this to true and commit. Set it to true in the editor
   as a temporary local override, run the function, then set it back. */
const ALLOW_RESET_ALL = false;

function resetAll() {
  if (!ALLOW_RESET_ALL) {
    const msg = "🚫 resetAll() refused: ALLOW_RESET_ALL is false. " +
                "Flip it to true (in the editor, temporarily) if you really mean to wipe production data.";
    console.error(msg);
    return msg;
  }

  const ss = getSpreadsheet_();
  const sheets = ss.getSheets();
  const keep = [USERS_SHEET, PAYMENTS_SHEET, SETTINGS_SHEET, ADMINS_SHEET];
  sheets.forEach(sheet => {
    if (!keep.includes(sheet.getName())) {
      ss.deleteSheet(sheet);
    }
  });

  keep.forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (sheet && sheet.getLastRow() > 1) {
      sheet.deleteRows(2, sheet.getLastRow() - 1);
    }
  });

  initDefaultSettings_();
  console.log("All data reset. Note: Admins sheet was preserved (headers only if it was empty; existing admin rows were cleared unless they were re-seeded).");
  return "All data has been reset.";
}

function diagnose() {
  console.log("═══ DIAGNOSTIC ═══");
  const ss = getSpreadsheet_();
  console.log("Spreadsheet URL:", ss.getUrl());
  console.log("Sheets:", ss.getSheets().map(s => s.getName()).join(", "));
  console.log("Backend version:", APP_VERSION);

  const u = getUsersSheet_();
  console.log("Users rows:", u.getLastRow());
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

  const wa = getWeeklyAttemptsSheet_();
  console.log("WeeklyAttempts rows:", wa.getLastRow());

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

/* ═══════════════════════════════════════════════════════════════
   EMERGENCY ADMIN RECOVERY
   ═══════════════════════════════════════════════════════════════ */

function resetAdminPasswordToSeed() {
  const sheet = getAdminsSheet_();
  const found = findAdminRow_(sheet, ADMIN_SEED_USERNAME);
  const salt = makeSalt_();
  const hash = salt + ":" + hashPassSalted_(ADMIN_SEED_PASSWORD, salt);

  if (found) {
    sheet.getRange(found.rowIndex, 2).setValue(hash);
    sheet.getRange(found.rowIndex, 5).setValue("");
    sheet.getRange(found.rowIndex, 6).setValue("");
    Logger.log("✅ Reset password for existing admin '" + ADMIN_SEED_USERNAME + "'.");
  } else {
    sheet.appendRow([
      ADMIN_SEED_USERNAME, hash, new Date().toISOString(), "system", "", ""
    ]);
    Logger.log("✅ Re-created admin account '" + ADMIN_SEED_USERNAME + "'.");
  }

  clearLoginLock_("admin", ADMIN_SEED_USERNAME);

  Logger.log("   Login with:  " + ADMIN_SEED_USERNAME + "  /  " + ADMIN_SEED_PASSWORD);
  Logger.log("   ⚠️  Change this password immediately via Settings → Change Password.");
  return "Admin password reset. Use " + ADMIN_SEED_USERNAME + " / " + ADMIN_SEED_PASSWORD + " — then change it immediately.";
}