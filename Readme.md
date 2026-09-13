# Abhyas — Loksewa Civil Engineering Exam Prep

**Offline-first exam prep platform for Nepal's Loksewa (Lok Sewa Aayog) Level 7 Civil Engineering exam, plus Level 5 Engineering and general PSC prep.**

Built as three standalone static HTML pages backed by a single Google Apps Script + Google Sheets backend. There is no build step, no bundler, no server framework — you can open `index.html` in a browser and it works, once the backend URL is wired in.

- **Version:** `1.04` (defined in `version.js` and `CODE.gs` — kept in sync; `version.js` is the client-side single source of truth, `sw.js` derives its offline cache name from it)
- **Stack:** Vanilla HTML / CSS / JS on the frontend, Google Apps Script + Google Sheets + Google Drive on the backend
- **Distribution:** Installable PWA with offline caching, plus a public marketing/login landing page optimized for search discovery

---

## 1. What this app actually does

Abhyas is a study app for students preparing for:

- **Loksewa Civil Engineering (Level 7)** — Structural Engineering, Engineering Survey, Construction Materials, Concrete Technology, Geotechnical Engineering, Construction Management, Estimating & Costing, Engineering Drawing, Engineering Economics, Professional Practices
- **Level 5 Engineering** and general PSC prep
- **General Knowledge (GK)** and IQ/reasoning

Students sign up, get a free trial (length admin-configurable, defaults to 24 hours), and then submit a manual payment (QR code + transaction ID + screenshot) that an admin reviews and approves before permanent or yearly access is granted.

Once inside, they get:

- Chapter / book / subtopic browsing across every configured level
- Flashcard-style review, timed exams, Daily Challenge, Adaptive Practice, Psycho Mode
- Bookmarks, flags, and a **wrong-answer bank with real spaced repetition** (1/3/7/14-day intervals)
- Progress tracking, study-time tracking, streaks, a personal timetable
- **Full offline mode** — question sets download on demand and stay usable without a network
- **Weekly Sets** — a scheduled question drop that unlocks on a specific date/time; a student gets **exactly one graded attempt**, then only review
- Push notifications (trial-expiry warnings, Weekly Set unlocks) — even when the app isn't open

Admins get a management panel: user search/filter/bulk actions, payment review (single or batch), Weekly Set scheduling with a preview-before-publish step, a "Most Missed Questions" analytics view, question-report queue, admin-account management, activity logs, and CSV export — all without touching code.

---

## 2. High-level architecture

```
┌─────────────┐        ┌──────────────┐        ┌──────────────┐
│ index.html  │───────▶│  user.html   │        │  admin.html  │
│  (Gateway)  │        │ (Study App)  │        │(Admin Panel) │
└──────┬──────┘        └──────┬───────┘        └──────┬───────┘
       │                      │                        │
       │ writes               │ loads version.js,      │ own login
       │ localStorage         │ shared.js,              │ ('abhyas_admin')
       │ 'abhyas_session'     │ chapters-data.js,       │
       │                      │ app.js                  │
       │                      │                          │
       └──────────────────────┴────────────┬─────────────┘
                                            │  HTTP GET/POST
                                            │  ?action=...
                                            ▼
                                 ┌───────────────────────┐
                                 │       CODE.gs          │
                                 │ (Google Apps Script)   │
                                 │  Auth / Payments /     │
                                 │  Weekly Sets / Push /  │
                                 │  Settings / Progress / │
                                 │  Weekly Attempts       │
                                 └───────────┬─────────────┘
                                            │
                       ┌────────────────────┼────────────────────┐
                       ▼                    ▼                    ▼
                Google Sheets        Google Drive          Firebase Cloud
          (Users, Payments,      (question-set JSON,        Messaging
           Settings, Logs,        payment screenshots,     (push notifs)
           Admins, Progress,      Weekly Set uploads)
           PushTokens,            question images)
           WeeklySets,
           WeeklyAttempts,
           QuestionReports,
           ProgressImports,
           ProgressBackups)
```

**Two contracts connect the pages:**

1. **The same deployed Apps Script `/exec` URL** — must be identical in `index.html`, `admin.html`, and `app.js`'s `APP_CONFIG.APPS_URL`.
2. **The `abhyas_session` localStorage key** — written by `index.html` after login/signup, read by `app.js` on `user.html`. `admin.html` has its own separate login (`abhyas_admin`) and never touches `abhyas_session`.

There is no traditional database — **Google Sheets is the database** (twelve tabs, see §6), and **Google Drive hosts question content** as JSON files referenced by file ID. **Firebase Cloud Messaging** delivers push notifications.

---

## 3. Files reference

| File | Role |
|---|---|
| **`index.html`** | **Gateway.** Signup, login, forgot/reset password, trial countdown, the payment flow, and routing into `user.html` or `admin.html`. Owns the `abhyas_session` schema. Also the app's public-facing landing page — SEO metadata, an About section, and an FAQ, all in one naturally scrolling page (three full-viewport "posts" you scroll between — login, about, FAQ). |
| **`user.html`** | **The study app shell.** HTML/CSS for every in-app view. Loads `version.js` → `shared.js` → `chapters-data.js` → `app.js`, then a small inline `<script>` **patch layer** that widens search links, adds swipe gestures, keeps the bottom-nav highlight correct, and fixes a handful of small visual issues in `app.js`'s rendering. |
| **`app.js`** | **All study-app logic** (~3,300 lines). Session gating, quiz engine (flashcard + exam), bookmarks/flags/wrong-bank with spaced repetition, progress + study-time tracking, streaks, timetable, offline cache, Weekly Sets client logic, PWA install, push registration. See §4 for the module map. |
| **`chapters-data.js`** | **Pure content data.** Maps `Level → Chapter → Book → Subtopic → Google Drive file ID`. The only file you edit to add/rename/remove chapters, books, or question sets. Has an instructional header comment. |
| **`shared.js`** | Tiny utilities used by all three pages: `esc()` (HTML-escaping), `escAttrJs()` (JS-in-attribute escaping), `pluralize()`, and `pingBackend()` (reachability check). |
| **`design-system.css`** | Shared visual theme (CSS custom properties, neumorphic elevation system) used by all three pages. |
| **`version.js`** | Single source of truth for `APP_VERSION`. Loaded by every page and by `sw.js` — bumping this value is what forces every open tab to drop its old offline cache and load fresh. |
| **`admin.html`** | **Admin panel.** Users/Payments search & bulk actions, CSV export, Weekly Set management (upload, schedule, preview, view results), "Most Missed Questions" analytics, settings, stats, admin account management, activity log. Independent login (`abhyas_admin`). |
| **`CODE.gs`** | **Backend — Google Apps Script.** Every `?action=...` request from all three pages routes through one `doGet`/`doPost` switch (~50 actions). Manages 12 Google Sheets and reads/writes Drive for question files, payment screenshots, and Weekly Set uploads. See §5. |
| **`firebase-config.js`** | Firebase project config for push notifications (client SDK init). |
| **`manifest.json`** | PWA manifest — name, icons, theme colors, start URL, display mode. |
| **`sw.js`** | Service worker. Precaches the app shell, caches API/getFile responses, posts a `SW_ACTIVATED` message to open tabs when a new version takes over so `app.js` can show a "reload to update" toast. |
| **`robots.txt` / `sitemap.xml`** | Allow crawling of `index.html` only — `user.html`/`admin.html` are login-gated app shells with no unique public content. |
| **`icon-192.png` / `icon-512.png` / `favicon.png`** | App icons. |
| **`vendor/phosphor/`** | Self-hosted Phosphor icon font, used by `user.html` and `admin.html`. **Not loaded by `index.html`** — that page uses inline SVG icons instead; don't add a `ph-*` class there. |
| **`CNAME`** | GitHub Pages custom domain config. |

### "Which file do I touch?" guide

| I want to... | Edit this file |
|---|---|
| Add/rename a chapter, book, level, or question-file link | `chapters-data.js` only |
| Change quiz behavior (timer, scoring, results, exam mode) | `app.js` → `QUIZ` module |
| Change bookmarks / flags / wrong-answer bank | `app.js` → `REV` module |
| Change trial length, payment flow, or signup/login validation | `CODE.gs` **and** `index.html` — keep both in sync |
| Change Weekly Sets behavior | `CODE.gs` + `admin.html` (`WEEKLYSETS` module) + `app.js` (`WEEKLY` module) |
| Change Weekly Attempt capture (one-attempt rule) | `CODE.gs` (`submitWeeklyAttempt` / `getWeeklyAttempt` / `getMyWeeklyAttempts`) + `app.js` (`WEEKLY` module) |
| Change push notifications | `CODE.gs` (`broadcastPushToAll_`, `checkWeeklySetUnlocks_`, `checkTrialExpiryWarnings`) + `app.js` (`PUSH` module) + `firebase-config.js` |
| Change session expiry / offline access rules | `app.js` → `AUTH` module **and** `index.html`'s matching logic |
| Change dashboard, streaks, or progress stats | `app.js` → `PROG` / `STREAK` / `HOME` modules |
| Change the timetable | `app.js` → `TT` module |
| Change offline caching | `app.js` → `CACHE` module and `QDB`, plus `sw.js`'s `SHELL` array |
| Change study-app visual styling | `design-system.css` or `user.html`'s own `<style>` block |
| Change login/payment/landing page | `index.html` |
| Change admin panel behavior | `admin.html` (self-contained) |
| Add a new top-level view/tab | HTML section + sidebar link in `user.html`, a new module in `app.js`, a case in `UI`'s view switch |

---

## 4. `app.js` module reference

Every module below is an object literal on `window`. Each is exposed globally so inline `onclick="..."` handlers in the HTML can reach them.

### Core

| Module | Responsibility |
|---|---|
| `APP_CONFIG` / `LS` / `S` | Backend URL, localStorage key names, in-memory app state |
| `APP` | Boot sequence — theme, cache migration, id/profile bootstrapping, initial renders |
| `_load(k,d)` / `_save(k,v)` | localStorage read/write with quota-error handling. `_save` also schedules a `PSYNC` backup for tracked keys |
| `QDB` | IndexedDB-backed cache for downloaded question sets. `get` / `set` / `del` / `keys` / `clear` / `migrateFromLocalStorage` |

### Network & session

| Module | Responsibility |
|---|---|
| `netFetch(url, opts, timeoutMs)` | `fetch` with AbortController timeout, forced-offline short-circuit, custom timeout error |
| `NETCHECK` | Lightweight connectivity probe (calls `pingBackend`) on a 15s interval. Separate from `navigator.onLine`, which is unreliable |
| `AUTH` | Session gate. Validates against the backend, builds the effective access level, bounces to login on a genuinely expired/invalid session. Periodically rechecks (10 min, or immediately on tab-focus) |
| `PSYNC` | Background sync of progress/bookmarks/streaks/wrong-bank to the server. Debounced 8s after a write; also flushes on tab-hide via `sendBeacon` |
| `PUSH` | Firebase Cloud Messaging registration and refresh. `enable()`, `silentRefresh()`, `refreshButtonUI()` |

### Study surface

| Module | Responsibility |
|---|---|
| `UI` | View routing, sidebar toggle, theme toggle |
| `HOME` | Dashboard rendering — greeting, stats, weekly sets card, recent sessions, live clock |
| `ON` | "Online Study" — the four-level cascading content browser (Level → Chapter → Book → Subtopic) |
| `LOC` | Local file import (offline JSON question bank) |
| `PSY` | "Psycho Mode" — mixed-chapter quiz across selected chapters |
| `ONPROG` | Scoped progress panel for the Online Study tab — per-level / chapter / book / subtopic coverage |
| `CNT` | Question-count cache. Fetches + counts questions per file, with concurrency-4 loading and a `needsConfirm` gate for large scans |

### Quiz engine

| Module | Responsibility |
|---|---|
| `QUIZ` | The core engine. `load()` fetches + normalizes a file; `startWith()` / `_doStart()` initialize state; `_renderFlashcard()` / `_renderExam()` render; `fcAnswer()` / `exAnswer()` record answers; `submitExam()` / `fcFinish()` grade and finalize |
| `QUIZ._doStart` | Initializes `S.quiz`. Handles three modes: plain quiz, exam, and **weekly one-attempt** (forced `shuffle=false`, sets `reviewOnly` for review) |
| `QUIZ._snapshotExam` | Debounced 3s snapshot of an in-progress exam to localStorage, so a tab close / page reload can resume |
| `QUIZ.checkResumableExam` | On boot, offers to resume a saved exam — unless it was a Weekly Set, which is one-shot and cannot be resumed |

### Review lists

| Module | Responsibility |
|---|---|
| `REV` | Bookmarks (`bk`), flags (`fl`), and the Wrong Bank (`wr`) with real spaced repetition. `toggle()` for bookmark/flag, `trackAnswer()` for the SR schedule (1/3/7/14 days), `renderList()` to draw the list, `start()` to launch a review quiz from a list |

### Progress & stats

| Module | Responsibility |
|---|---|
| `PROG` | Progress panel. `track()` increments totals, `recordSession()` prepends a session, `predict()` computes a recency-weighted exam score forecast, `render()` draws every progress element |
| `CHAPSTATS` | Durable per-chapter accuracy aggregate. One record per chapter (`{attempted, correct, sessions, lastAt}`) — survives device switch via the cloud sync |
| `STREAK` | Daily study streak. `markToday()` records today, `currentStreak()` counts backwards with a "yesterday counts" exception, `renderBar()` draws the 7-day strip |

### Weekly Sets

| Module | Responsibility |
|---|---|
| `WEEKLY` | The full Weekly Set lifecycle. `init()` fetches sets + this user's attempts in parallel. `_renderHomeCard()` shows one of four states per set: **locked**, **unattempted with countdown**, **attempted (shows score)**, **window-closed review-only**. `open()` decides which mode to enter. `_recordAttempt()` + `_syncAttempt()` capture the one submission. `retryUnsynced()` retries on reconnect |

### Timetable

| Module | Responsibility |
|---|---|
| `TT` | Weekly study-session planner. `add()` / `remove()`, `render()` builds today's list and the week grid, reminders (browser notifications a configurable number of minutes before each session, while a tab/PWA is open) |

### Offline

| Module | Responsibility |
|---|---|
| `CACHE` | Offline cache manager. `render()` shows per-level status, `dl()` downloads all sets with a progress bar, `clr()` clears, `purgeStale()` removes broken cache entries, `autoSync()` runs a background top-up (gated on connection type: skips on cellular for new users) |

### Data management & onboarding

| Module | Responsibility |
|---|---|
| `DATA` | Export / import / reset. `exportAll()` writes a JSON backup, `imp()` / `importFile()` restore, `syncNow()` / `restoreCloud()` push/pull to the server, `reset()` wipes local data, `wipeDevice()` does a broader wipe |
| `TUTORIAL` | First-run onboarding walkthrough. Multi-step modal, auto-opens once per user, tracks "seen" state in `abhyas_tut_seen` |

### Network mode

| Module | Responsibility |
|---|---|
| `NET` | Manual online/offline toggle (top-bar button). Forces network requests to fail fast when offline is forced |
| `toggleForcedOffline()` | Legacy global helper — same effect as `NET.toggle()`, kept for HTML compatibility |

### Utility

| Function | Purpose |
|---|---|
| `toast(msg, dur)` | Non-blocking top-of-list notification |
| `toastUndo(msg, onUndo, dur)` | Same, plus an Undo button |
| `openMod(title, html)` / `closeMod()` | Shared modal (the `#mbg` element in `user.html`) |
| `_anyModalOpen()` | Used by the quiz keyboard handler — a modal is open if any of the quiz-overlay elements is currently **visible** (not merely in the DOM) |
| `qs(obj)` | Query-string encoder |
| `fmt(s)` / `fmtHMS(s)` | `MM:SS` and `HH:MM:SS` formatting |
| `today()` / `localDateOffset(date, n)` | Local-calendar date strings |
| `isOk(sel, cor)` | Answer-correctness check (handles both index and letter forms) |
| `shuf(arr)` | Fisher-Yates shuffle |
| `normQ(raw, fid)` | Normalizes any supported question-bank shape into `{q, options, correct, explanation, img, imgCaption, fileId, uid}` |
| `_resolveQImg(raw)` | Turns a raw image field (Drive fileId, share link, data URI, direct URL) into a usable `src` |
| `qImgHtml(q)` / `qSearchHtml(q)` | Render helpers — question image, "search this on Google" icon link |
| `renderMath(el)` | KaTeX auto-render wrapper (delimiters `$...$`, `$$...$$`) |

---

## 5. `CODE.gs` backend reference

A single Google Apps Script Web App exposing everything through one `/exec` URL and an `action` query parameter. `doGet` and `doPost` both route to the same switch. Actions are grouped below by what they do.

### Health

| Action | Purpose |
|---|---|
| `ping` | Returns `{success, pong: true, version}`. Used by every client's reachability probe |

### Auth & session

| Action | Purpose |
|---|---|
| `login` | Username + password. Checks the Admins sheet first (admin world), then the Users sheet. Returns `{success, user, token, ...}` on success, or a generic `"Invalid username or password."` on failure (deliberately never reveals whether the account exists) |
| `googlelogin` | Verifies a Google ID token against Google's `tokeninfo` endpoint, matches by email, creates a trial account if new |
| `signup` | Creates a trial account. Rate-limited per-minute globally, and per-field deduped (email, mobile, username) |
| `requestpasswordreset` | Emails a one-time reset code. Always returns the generic "if that account exists…" response |
| `resetpassword` | Consumes a reset code, sets a new password, invalidates the existing session |
| `updateownmobile` | Lets a logged-in user add/change their own mobile number (needed for Google-signin accounts) |
| `checksession` | Verifies a session token and returns the account's current access state |
| `saveprogress` | Stores the caller's `prog / bk / fl / wr / stk / chapStats` blob (capped at 45,000 chars) |
| `getprogress` | Returns the caller's stored progress blob, or `data: null` if they've never synced |
| `savepushtoken` | Registers a Firebase Cloud Messaging token for the caller |

### Content

| Action | Purpose |
|---|---|
| `listweeklysets` | Lists Weekly Sets visible to the current user — released ones with their `fileId`, upcoming ones without |
| `getfile` | Read-only Drive-file proxy. Takes a `fileId`, returns the parsed JSON. Rate-limited globally (120/min). The one action with no auth, by design — it's how offline/expired users read already-cached content |

### Weekly Attempts (v1.04)

| Action | Purpose |
|---|---|
| `getweeklyattempt` | Returns the caller's single attempt for one weekly set, or `null` |
| `getmyweeklyattempts` | Returns **all** of the caller's weekly attempts (used by `WEEKLY.init()` to populate the home card in one round trip) |
| `submitweeklyattempt` | Records the caller's one attempt. Under a script-wide lock, checks for an existing row and refuses if found. Stores the raw `answers[]` array — the admin side re-scores independently, so a forged `correctCount` can't inflate admin-visible numbers |

### Payment

| Action | Purpose |
|---|---|
| `submitpayment` | Records a payment submission (username, txId, remarks, screenshot). Rate-limited per account (10/hr) |
| `getpaymentstatus` | Returns the caller's payment record |
| `getsettings` | Returns all Settings sheet key/value pairs |

### Admin — accounts

| Action | Purpose |
|---|---|
| `adminlogin` | Admin login. Returns a per-admin token and flags `mustChangePassword` if still on the seed credentials |
| `adminchangepassword` | Change the calling admin's own password |
| `adminlistadmins` / `admincreateadmin` / `admindeleteadmin` | Manage admin accounts |

### Admin — users

| Action | Purpose |
|---|---|
| `adminlistusers` | Lists users (capped, with `truncated: true` if the cap was hit) |
| `adminupdateuser` | Edit name / email / mobile / status / permanentAccess / password |
| `admingrantaccess` / `admingrantaccessbatch` | Grant permanent or 1-year access to one or many users |
| `admindeleteuser` / `admindeleteusersbatch` | Delete user + purge their Progress / PushTokens / Payments / ProgressBackups / WeeklyAttempts rows |

### Admin — payments

| Action | Purpose |
|---|---|
| `adminlistpayments` | Lists payments (capped). Flags duplicate txIds |
| `adminreviewpayment` / `adminreviewpaymentsbatch` | Verify or reject one or many payment submissions |
| `admindeletepayment` | Delete a payment record |
| `admindownloadscreenshot` | Downloads a payment screenshot via the DriveApp proxy (works regardless of file sharing settings) |

### Admin — Weekly Sets

| Action | Purpose |
|---|---|
| `adminuploadweeklysetfile` | Uploads a JSON question-bank file to Drive, returns the fileId |
| `admincreateweeklyset` | Creates a scheduled set. Flags duplicate fileIds (non-blocking) |
| `adminupdateweeklyset` | Edit title / fileId / chapterLabel / status / releaseAt |
| `admindeleteweeklyset` | Delete a set (WeeklyAttempts rows for it are intentionally kept — a student's submitted record is theirs) |
| `adminlistweeklysets` | Lists every set with full fileId |
| `adminweeklysetresults` | **v1.04** — aggregates attempts for one set. Re-scores from the source file (independent of the client-claimed score), returns summary stats, histogram buckets, and recent attempts |

### Admin — question reports

| Action | Purpose |
|---|---|
| `adminlistquestionreports` | Lists student-submitted question reports (capped) |
| `adminupdatequestionreportstatus` | Mark open / resolved / dismissed |
| `admindeletequestionreport` | Delete a report |

### Admin — settings, stats, ops

| Action | Purpose |
|---|---|
| `adminupdatesettings` / `adminupdatesettingsbatch` | Write Settings sheet entries |
| `adminstats` | Dashboard totals: users by status, payments by status |
| `adminmostmissedquestions` | Aggregates wrong-rate across all students, with level/chapter/date filters |
| `adminlistlogs` | Activity log (latest 1000 rows) |
| `adminimportprogress` / `adminimportstatus` | Preview / merge / replace a device's exported progress data. Pre-replace backups go to `ProgressBackups` |
| `adminclearprogressbackups` / `adminpruneoldbackups` / `admintrimlogs` | Housekeeping for grow-forever sheets |
| `adminrevokescreenshotsharing` | One-time fixup — pulls every old payment screenshot back to private |
| `adminexpiringtrials` | Lists users whose trial expires within N hours |

---

## 6. Data model

### Google Sheets (12 tabs)

| Sheet | Columns | Purpose |
|---|---|---|
| `Users` | username, passHash, name, email, mobile, contact, contactType, status, createdAt, approvedAt, role, trialExpiresAt, paymentStatus, permanentAccess, accessType, accessExpiresAt, sessionToken, sessionTokenExpiresAt | Account records |
| `Payments` | username, name, email, mobile, txId, remarks, status, rejectionReason, screenshotUrl, submittedAt, reviewedAt | Payment submissions |
| `Settings` | key, value | Admin-editable global config |
| `Logs` | timestamp, admin, action, target, details | Audit log |
| `Admins` | username, passHash, createdAt, createdBy, token, tokenExpires | Admin accounts |
| `Progress` | username, data (JSON blob), updatedAt | Per-user study progress. Same shape as localStorage: `{prog, chapStats, bk, fl, wr, stk}` |
| `PushTokens` | username, fcmToken, updatedAt | One row per user, always the latest token |
| `WeeklySets` | id, title, fileId, chapterLabel, status, uploadedBy, uploadedAt, releaseAt | Scheduled question releases |
| `WeeklyAttempts` | username, weeklyId, answersJson, totalQuestions, correctClaimed, skippedCount, startedAt, submittedAt, durationSec | **One row per (username, weeklyId)** — the recorded attempt |
| `QuestionReports` | id, uid, fileId, questionSnapshot, reason, note, reportedBy, reportedAt, status | Student-submitted content-quality reports |
| `ProgressImports` | importId, admin, mode, status, recordsReceived, recordsAccepted, recordsSkipped, errorCount, createdAt, completedAt, details | Admin import history |
| `ProgressBackups` | backupId, importId, username, data, createdAt, createdBy | Pre-replace snapshots (undo path for progress imports) |

### Client localStorage keys

| Key | Content |
|---|---|
| `abhyas_session` | `{type, username, token, access, settings, lastVerified, ...}` — the session object written by `index.html`, read by `app.js` |
| `abhyas_prog` | `{total, correct, sessions: [...]}` — progress totals + last 50 sessions |
| `abhyas_bk` / `abhyas_fl` / `abhyas_wr` | Bookmarks / flags / wrong-bank arrays |
| `abhyas_stk` | `{days: [...], last}` — streak tracking |
| `abhyas_chapstats` | `{chapter: {attempted, correct, sessions, lastAt}}` — durable per-chapter accuracy |
| `abhyas_tt` | Timetable + reminder config |
| `abhyas_weekly_attempts` | `{weeklyId: {answers, total, correct, pct, synced, ...}}` — v1.04 |
| `abhyas_exam_snap` | In-progress exam snapshot (auto-cleared on submit / discard) |
| `abhyas_fcount` | Cached question counts per fileId |
| `abhyas_theme` | `'light'` or `'dark'` |
| `abhyas_forced_off` | Manual offline-mode flag |
| `abhyas_last_user` | Tracks which user's data currently sits on this device |
| `abhyas_tut_seen` | `{username: true}` — per-user tutorial-seen marker |

### IndexedDB (`abhyas_question_cache` database, `sets` store)

- **Key:** `` `${level}_${chapter}_${book}_${subtopic}` ``
- **Value:** the raw server response for that file (or a normalized question array)

Higher-quota than localStorage, so full question sets and their embedded images fit.

---

## 7. Key flows

### Signup → trial → payment → permanent

1. **`index.html`** — visitor fills the signup form (username, password, name, email, mobile). Client-side validation mirrors the server's regexes.
2. `POST /exec {action:'signup', ...}` — server creates a `Users` row with `status='trial'`, sets `trialExpiresAt`, issues a session token.
3. **Trial active** — `index.html` shows a live countdown, offers "Enter Study Dashboard" and "Pay Now".
4. **Pay Now** — `index.html` shows the QR code, transaction-ID input, screenshot upload. Submitting sets the user's status to `payment_pending` and creates a `Payments` row.
5. **Admin reviews** — `admin.html` Users/Payments tab. Approve → `status='active'`, `permanentAccess=true`, `accessType='permanent'` (or `'yearly'` with an expiry). Reject → `status='expired'`.
6. **Session recheck** — on the user's next `checkSession` (or on focus), the newly-permanent status flows through `AUTH._buildSession` and `access.level` becomes `'permanent'`.

### Studying a chapter

1. **Online Study tab** — cascade: Level → Chapter → Book → Subtopic.
2. **Start** — `ON.start(mode)` calls `QUIZ.load(fid, key, mode, name, {lv, ch, book, sub, fid})`.
3. **Fetch** — `QUIZ._fetch` requests `getFile`; on success caches the response in IndexedDB; on failure falls back to the cache.
4. **Normalize** — `normQ(raw, fid)` converts whatever shape the file has into standard `{q, options, correct, ...}` records with `${fid}_${i}` UIDs.
5. **Limit picker** — for >20 questions, the picker appears: how many, shuffle on/off.
6. **Start** — `_doStart` initializes `S.quiz`. Flashcard mode runs the option-tap → immediate-feedback loop; exam mode runs a scored, timed run.
7. **Results** — `_showResults` renders the review card, records the session (via `PROG.recordSession` + `CHAPSTATS.record`), and updates the dashboard.

### Weekly Set — one attempt, then review

1. **Scheduled set** — admin uploads a JSON file and picks a release date/time.
2. **Unlock** — a time-driven trigger (`checkWeeklySetUnlocks_`) fires a broadcast push notification the first time the release moment passes.
3. **Student sees the set** — `WEEKLY.init()` on `user.html` fetches sets + this user's attempts in parallel. The home card renders one of four states:
   - **Locked** (not released): "unlocks Wed 8:00 AM"
   - **Open** (released, no attempt): countdown + "not attempted"
   - **Attempted**: "✓ 78% · Review"
   - **Window closed, never attempted**: "Review only"
4. **Student clicks** — `WEEKLY.open(id)`:
   - If there's a local or server-recorded attempt → **review mode** (`reviewOnly: true`, answers pre-filled)
   - Else if the exam window is open → **graded exam** (shuffle forced off, one-attempt confirmation on submit)
   - Else → **review only** (unscored)
5. **Submit** — `QUIZ.submitExam` grades, then `WEEKLY._recordAttempt` writes the attempt to localStorage **first** (the submission must survive a network failure), then `WEEKLY._syncAttempt` POSTs to `submitweeklyattempt`. If the POST fails, `synced: false` remains and `retryUnsynced()` retries on reconnect.
6. **Admin views results** — `admin.html` Weekly Sets → Results button → `adminweeklysetresults` reads the `WeeklyAttempts` sheet, **re-scores** each attempt against the source file, and renders summary stats + histogram + recent attempts.

### Offline caching

1. **First visit while online** — `APP.init` calls `CACHE.autoSync()` (skipped on slow cellular for new users; a toast offers the Offline Cache tab instead).
2. **Per-file download** — `QUIZ._fetch` writes to IndexedDB. Every subsequent offline read for that file works.
3. **Preloading a chapter** — opening any file triggers the same cache-write.
4. **Cache-all** — the Offline Cache tab has a "Cache All Data" button with a progress bar.
5. **Service worker** — precaches the app shell on install; on fetch, does network-first for the shell and API calls, with cache fallback.

---

## 8. Offline strategy

Two layers, deliberately distinct:

**Layer 1 — Service worker (`sw.js`)**
- Precaches the app shell (`SHELL` array — HTML, CSS, JS, fonts, manifest).
- Network-first with cache fallback for the shell.
- Network-first for API calls, except `getFile` which caches responses in Cache Storage.
- Admin panel is **never** intercepted (always live network).
- Cache name derives from `APP_VERSION`. Bumping the version in `version.js` invalidates every tab's cached shell on next activation.
- On activate, posts `SW_ACTIVATED` to open tabs so `app.js` can show a "reload to update" toast.

**Layer 2 — IndexedDB (`QDB` in `app.js`)**
- Per-file question-set cache with a much higher quota than localStorage.
- Keyed by `level_chapter_book_subtopic`.
- `QUIZ._fetch` reads here when offline; writes here when online.
- Survives page reloads, browser restarts, and version bumps (only `CACHE.clear()` removes it).

**Why two?**
Cache Storage (used by the service worker) caches *responses*; IndexedDB caches *application data* that has been normalized and indexed. Keeping them separate means the app can be fully offline (both layers populated) but also can be "cache-storage-only" for shell files without needing every question set pre-fetched.

**Force-offline mode** — the top-bar network button. When active, `netFetch` throws immediately and the app behaves as if offline. Useful for testing.

---

## 9. Security model

- **Password storage** — salted SHA-256 (`salt:sha256(salt+password)`). Old unsalted hashes upgrade transparently on next successful login.
- **Session tokens** — per-account, 30-day expiry for users; per-admin, 24-hour sliding expiry for admins (an active admin's token extends automatically).
- **Brute-force lockout** — 5 failed attempts, 15-minute lockout, checked BEFORE password verification.
- **Rate limiting**
  - `getFile`: 120/min globally (blunts automated scraping, generous enough for real traffic)
  - `signup`: 15/min globally
  - `googlelogin`: 30/min (its own bucket so it can't lock out signups)
  - `submitPayment`: 10/hour per account
- **CSV formula injection** — every user-typed string that lands in a sheet passes through `sanitizeSheetField_`, which prefixes a leading apostrophe if the value starts with `=` `+` `-` `@` (after any whitespace). This stops a signup "name" of `=IMPORTXML(...)` from becoming a live formula.
- **Clickjacking mitigation** — client-side frame-busting script on every page (GitHub Pages doesn't support custom HTTP headers, so CSP `frame-ancestors` isn't available).
- **Payment screenshots** — uploaded private to the script owner. The admin panel reads them through the authenticated DriveApp proxy, which ignores sharing settings.
- **Login error parity** — same generic "Invalid username or password." whether the account exists or not. Prevents username enumeration.
- **Admin auth** — every mutating action goes through `checkAdmin_()` and (for row mutations) `withLock_()` to serialize concurrent writes.

---

## 10. Deployment

1. **Deploy the backend**
   - Open [script.google.com](https://script.google.com), create a new project, paste in `CODE.gs`.
   - Change `ADMIN_SEED_PASSWORD` away from the default before deploying.
   - Optional (for push): create a Firebase project, upload the FCM service-account JSON as Script Properties (`FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY`). See the setup comment above `sendPushNotification_` in `CODE.gs`.
   - Run `setup()` once from the editor. This creates all 12 sheets, seeds the first admin, initializes default settings, and registers the two time-driven triggers.
   - Deploy → New deployment → Web app → Execute as "Me" → Who has access "Anyone."
   - Copy the resulting `.../exec` URL.

2. **Wire the frontend**
   - Paste the `/exec` URL into `index.html`, `admin.html`, and `app.js`'s `APP_CONFIG.APPS_URL`. All three must match exactly.

3. **Host the static files**
   - GitHub Pages, Netlify, Firebase Hosting, or open `index.html` locally for testing.
   - The service worker / PWA install only works over HTTPS or `localhost`.

4. **Add content**
   - Upload question-set JSON to Drive (shared "Anyone with the link") and register file IDs in `chapters-data.js` — or use Weekly Sets from the admin panel for scheduled releases.

5. **First admin login**
   - Log into `admin.html` with the seeded credentials.
   - Change the password immediately (the app prompts you).
   - Configure payment settings (QR, phone, amount, trial length) before going live.

6. **SEO**
   - Submit `sitemap.xml` to Google Search Console once the domain is live.

---

## 11. Things that must stay in sync

- **`GAS_URL` / `APP_CONFIG.APPS_URL`** — identical in `index.html`, `admin.html`, `app.js`.
- **`abhyas_session` shape** — written by `index.html`, read/written the same way by `app.js`'s `AUTH` module.
- **Access-level rules** — computed independently in `index.html` and `app.js`'s `AUTH._buildSession()`; must stay logically identical.
- **Offline cache keys** — `` `${level}_${chapter}_${book}_${subtopic}` `` — built once in `ChapterData`, consumed consistently by `ON`, `PSY`, `CACHE`, `QUIZ`.
- **`sw.js`'s `SHELL` array** — must list every file the app actually loads, or the periodic stale-cleanup silently purges it from the offline cache.
- **`APP_VERSION`** — `version.js` and `CODE.gs`; bump both together.
- **Global settings** — written by `admin.html`, read live by `index.html` on every load; don't cache them client-side without a refresh path.
- **Login error message regex** — `admin.html`'s auto-logout watches for `/admin auth failed/i` in responses. If that string changes in `CODE.gs`, the auto-logout silently stops firing.

---

## 12. Known gaps / roadmap

- **`app.js` (~3,300 lines) and `CODE.gs` (~2,800 lines) are both large single files.** Splitting either into modules would help long-term maintainability, but hasn't been done.
- **No CAPTCHA on signup.** The rate limiter blunts bulk automated account farming but not a patient script staying under the per-minute threshold.
- **No email verification.** Combined with the rate limit the abuse risk is lower, but not eliminated.
- **No Nepali-language UI option.** The interface is English-only, despite being built for a Nepali government exam's candidates — likely the single highest-impact feature not yet built.
- **No Privacy Policy / Terms of Service.** The app collects email, mobile number, and payment screenshots — worth adding given the personal/financial data involved.
- **"Most Missed Questions" reflects a rolling window**, not complete history — the Progress scan is capped at 5,000 rows; each user's session history keeps the most recent 50.
- **Timetable's week grid scrolls horizontally on narrow phones.** An accordion day-view would be better on mobile.
- **Modal / confirm / toast styles aren't fully unified** across `index.html`, `user.html`, and `admin.html`. Each page has its own toasts, and confirmations use the native `confirm()` / `prompt()`.
- **The `esc()` / `escAttrJs()` fix is applied**, but downstream code that relied on the old (incorrect) `0 → ''` behavior isn't audited. Any place that did `esc(count)` where count could be 0 now correctly renders `"0"` where it previously rendered `""`.