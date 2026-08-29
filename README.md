# Abhyas — Loksewa Civil Engineering Exam Prep

**Offline-first exam prep platform for Nepal's Loksewa (Lok Sewa Aayog) Level 7 Civil Engineering exam, plus Level 5 Engineering and general PSC prep.**

Built as three standalone static HTML pages backed by a single Google Apps Script + Google Sheets backend. There is no build step, no bundler, no server framework — you can open `index.html` in a browser and it works, once the backend URL is wired in.

- **Version:** 1.00 (`APP_VERSION` in `version.js` and `CODE.gs` — kept in sync; `version.js` is the client-side single source of truth, `sw.js` derives its offline cache name from it)
- **Stack:** Vanilla HTML / CSS / JS on the frontend, Google Apps Script + Google Sheets + Google Drive on the backend
- **Distribution:** Installable PWA (Progressive Web App) with offline caching, plus a public marketing/login landing page optimized for search discovery

---

## 1. What this app actually does

Abhyas is a study app for students preparing for:
- **Loksewa Civil Engineering (Level 7)** — the primary focus, covering Structural Engineering, Engineering Survey, Construction Materials, Concrete Technology, Geotechnical Engineering, Construction Management, Estimating & Costing, Engineering Drawing, Engineering Economics, and Professional Practices
- **Level 5 Engineering** and general PSC prep
- General Knowledge (GK) and IQ/reasoning, which appear alongside the technical paper in the real exam

Students sign up, get a free trial (length admin-configurable, defaults to 24 hours), and then submit a manual payment (QR code + transaction ID + screenshot) that an admin reviews and approves before permanent or yearly access is granted. Once inside, they get a full quiz/study app: flashcard-style review, timed exams, bookmarks, a wrong-answer bank with real spaced repetition, progress and study-time tracking, streaks, a personal timetable, and offline access to question sets they've downloaded in advance — including images (embedded or Drive-hosted) attached to individual questions.

Admins can also schedule **Weekly Sets** — a question bank uploaded ahead of time that unlocks automatically at a chosen date/time (e.g., uploaded over the weekend, released the following Wednesday), and which becomes a permanent part of the normal content library once live.

An admin panel lets a site operator manage users, review/approve payments in bulk, edit global settings, see which specific questions students are missing most often, export data to CSV, and manage everything else — all without touching code.

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
       │                      │ app.js, cloud-sync.js   │
       │                      │                          │
       └──────────────────────┴────────────┬─────────────┘
                                            │  HTTP GET/POST
                                            │  ?action=...
                                            ▼
                                 ┌───────────────────────┐
                                 │       CODE.gs          │
                                 │ (Google Apps Script)   │
                                 │  Auth / Payments /     │
                                 │  Weekly Sets / Push /   │
                                 │  Settings / Progress   │
                                 └───────────┬─────────────┘
                                            │
                       ┌────────────────────┼────────────────────┐
                       ▼                    ▼                    ▼
                Google Sheets        Google Drive          Firebase Cloud
          (Users, Payments,      (question-set JSON,        Messaging
           Settings, Logs,        payment screenshots,     (push notifs —
           Admins, Progress,      Weekly Set uploads,        weekly-set
           PushTokens,            question images)            unlocks,
           WeeklySets)                                    trial warnings)
```

All three frontend pages share `version.js` (single source of truth for `APP_VERSION`) and `shared.js` (a handful of tiny cross-page utilities: `esc()`, `escAttrJs()`, `pluralize()`). `user.html` additionally loads `chapters-data.js` (content data), `app.js` (all application logic), and `cloud-sync.js` (manual cloud backup/restore of progress, separate from the automatic background `PSYNC` sync in `app.js`). `design-system.css` provides the shared visual theme across all three pages.

**Two contracts connect the pages:**

1. **The same deployed Apps Script `/exec` URL** — must be identical in `index.html`, `admin.html`, and `app.js`'s `APP_CONFIG.APPS_URL`.
2. **The `abhyas_session` localStorage key** — written by `index.html` after login/signup, read by `app.js` on `user.html`. `admin.html` has a completely separate login (`abhyas_admin`) and never touches `abhyas_session`.

There is no traditional database — **Google Sheets is the database** (eight tabs, see §7), and **Google Drive hosts question content and Weekly Set uploads** as JSON files, referenced by file ID. **Firebase Cloud Messaging** delivers push notifications (trial-expiry warnings, Weekly Set unlock announcements) when the app isn't open.

---

## 3. End-to-end user workflow

1. **Landing (`index.html`)** — a new visitor signs up with username/email/mobile/password (rate-limited server-side against automated mass account creation). The backend creates a row in `Users` and starts the trial clock.
2. **Trial period** — full access to `user.html` with `access.level = 'trial'`.
3. **Trial expiry / payment** — `index.html` shows a payment screen (admin-configurable QR code, transaction ID field, screenshot upload). Submitting writes a row to `Payments` and sets status to `payment_pending`.
4. **Admin review (`admin.html`)** — an admin approves or rejects, individually or in bulk (both write the whole affected sheet back in a single batched call, not one API round-trip per row). Approved → `permanent` or `yearly` access; rejected → back to `expired` with the reason shown on the user's next visit.
5. **Forgot password** — a self-service flow: request a one-time code emailed via `MailApp` (no third-party service needed), then reset. Rate-limited per account; never reveals whether an email/account actually exists.
6. **Ongoing use (`user.html`)** — chapters, quizzes/exams (with question images where present), progress and study-time tracking, bookmarks, timetable, offline caching, and — once released — Weekly Sets.
7. **Session verification** — every load re-validates against the backend rather than trusting local storage indefinitely. A session that genuinely expires *while the user is active* is now also caught by a periodic recheck (every 10 minutes, or immediately on tab-focus), not just on the next full page load.
8. **Offline** — cached question sets, images, and the full app shell (including its stylesheet — a real bug where the offline cache could lose all CSS was fixed) keep working via the service worker and an IndexedDB-backed question cache; only genuinely network-dependent actions are blocked until connectivity returns.
9. **Weekly Sets** — once an admin schedules a release, students see a locked countdown card on the home screen beforehand and a one-tap-to-open card once it unlocks (plus a push notification, if enabled) — and the set then stays permanently reachable through the normal Online Study picker afterward, not just as a one-off.

---

## 4. File-by-file reference

| File | Role |
|---|---|
| **`index.html`** | **Gateway.** Signup, login, forgot/reset password, trial countdown, the payment flow, and routing into `user.html` or `admin.html`. Owns the `abhyas_session` schema. Also the app's public-facing landing page — has its own SEO metadata, an About section, and an FAQ, all above/below the login card in one naturally scrolling page (no nested scrollbars). |
| **`user.html`** | **The study app shell.** HTML/CSS for every in-app view. Loads `version.js` → `shared.js` → `chapters-data.js` → `app.js` → `cloud-sync.js`, then a small inline `<script>` patch layer for search links, swipe gestures, and bottom-nav behavior. |
| **`app.js`** | **All application logic** (~3,100 lines). Session gating, the quiz engine, bookmarks/flags/wrong-answer bank (real spaced repetition: 1/3/7/14-day intervals), progress + study-time tracking, streaks, timetable, offline cache manager, Weekly Sets client logic, PWA install handling, push notification registration. |
| **`chapters-data.js`** | **Pure content data.** Maps `Level → Chapter → Book → Subtopic → Google Drive file ID`. The only file you edit to add/rename/remove chapters, books, or question sets — has its own instructional header comment. |
| **`shared.js`** | Tiny utilities shared by all three pages: `esc()` (HTML-escaping), `escAttrJs()`, `pluralize()`. |
| **`cloud-sync.js`** | Manual "back up now" / "restore" to a user-chosen cloud target, with a versioned migration chain so a future backup-format change doesn't dead-end old backups. Separate from `PSYNC`'s automatic background sync in `app.js`. |
| **`design-system.css`** | Shared visual theme (CSS custom properties) used by all three pages. |
| **`version.js`** | Single source of truth for `APP_VERSION`. Loaded by every page and by `sw.js` — bumping this value is what forces every open tab to drop its old offline cache and start fresh. |
| **`admin.html`** | **Admin panel.** Users/Payments search & bulk actions, CSV export, Weekly Sets management (upload, schedule, preview before publishing), a "Most Missed Questions" analytics view, settings, stats, admin account management, and an activity log. Independent login (`abhyas_admin`). |
| **`CODE.gs`** | **Backend — Google Apps Script.** Every `?action=...` request from all three pages routes through one `doGet`/`doPost` switch (40 actions — see §7). Manages 8 Google Sheets and reads/writes Drive for question files, payment screenshots, and Weekly Set uploads. |
| **`firebase-config.js`** | Firebase project config for push notifications (client SDK init). |
| **`manifest.json`** | PWA manifest — name, icons, theme colors, start URL, display mode. |
| **`sw.js`** | Service worker. Precaches the full app shell (including `design-system.css` and `cloud-sync.js` — both were previously missing from the precache list, a real bug that could strip all styling when offline) and does network-first caching for API/Drive responses, with a periodic purge of anything not in the current shell list. |
| **`robots.txt` / `sitemap.xml`** | Allow crawling of `index.html` only — `user.html`/`admin.html` are login-gated app shells with no unique public content, explicitly disallowed. |
| **`icon-192.png` / `icon-512.png` / `favicon.png`** | App icons. |
| **`vendor/phosphor/`** | Self-hosted Phosphor icon font, used by `user.html` and `admin.html`. **Not loaded by `index.html`** — that page uses inline SVG icons instead; don't add a `ph-*` class there, it will render as empty space. |
| **`CNAME`** | GitHub Pages custom domain config. |

### Quick "which file do I touch?" guide

| I want to... | Edit this file |
|---|---|
| Add/rename a chapter, book, level, or question-file link | `chapters-data.js` only |
| Change quiz behavior (timer, scoring, results, exam mode) | `app.js` → `QUIZ` module |
| Change bookmarks / flags / wrong-answer bank behavior | `app.js` → `REV` module |
| Change trial length, payment flow, or signup/login validation | `CODE.gs` (`TRIAL_HOURS`, `handleSignup`, `handleLogin`) **and** `index.html` — keep both in sync |
| Change Weekly Sets behavior | `CODE.gs` (`adminCreateWeeklySet` etc. + `listWeeklySets`), `admin.html` (`WEEKLYSETS` module), `app.js` (`WEEKLY` module) |
| Change push notifications | `CODE.gs` (`broadcastPushToAll_`, `checkWeeklySetUnlocks_`, `checkTrialExpiryWarnings`), `app.js` (`PUSH` module), `firebase-config.js` |
| Change how session expiry / offline access is judged | `app.js` → `AUTH` module **and** `index.html`'s matching logic |
| Change the dashboard, streaks, or progress/study-time stats | `app.js` → `PROG` / `STREAK` / `HOME` modules |
| Change the timetable | `app.js` → `TT` module |
| Change offline caching behavior | `app.js` → `CACHE` module and `QDB`, plus `sw.js`'s `SHELL` array |
| Change study-app visual styling | `design-system.css` (shared) or `user.html`'s own `<style>` block |
| Change login/payment/landing-page styling or content (About/FAQ) | `index.html` |
| Change admin panel behavior | `admin.html` (self-contained) |
| Add a brand-new top-level view/tab | HTML section + sidebar link in `user.html`, a new module in `app.js`, a case in `UI`'s view switch |

---

## 5. `app.js` module map

| Module | Responsibility |
|---|---|
| `APP_CONFIG` / `LS` / `S` | Backend URL config, localStorage key names, in-memory app state |
| `QDB` | IndexedDB-backed cache for downloaded question sets (localStorage is capped ~5–10MB per origin, easy to exceed with a real content library) |
| `NETCHECK` | Lightweight connectivity probing, separate from the unreliable `navigator.onLine` |
| `AUTH` | Session gate — validates against the backend, builds the effective access level, bounces to login on a genuinely expired/invalid session (checked periodically, not just on page load) |
| `PSYNC` | Background sync of progress/bookmarks/streaks to the server |
| `PWA` | Service worker registration, install-prompt handling, and the one-tap install banner |
| `PUSH` | Push notification permission + FCM token registration |
| `UI` | Core view-routing/navigation |
| `ON` | "Online Study" — the four-level cascading content browser |
| `LOC` | Local/offline question-set file import |
| `PSY` | "Psycho Mode" — rapid-fire quiz across a whole chapter |
| `REV` | Bookmarks, flags, and the wrong-answer bank (with real spaced repetition) |
| `QUIZ` | The core quiz/exam engine — flashcard + timed-exam modes, scoring, results, Daily Challenge, question image rendering |
| `WEEKLY` | Fetches scheduled Weekly Sets, merges released ones permanently into the content library, renders the home-screen unlock card |
| `PROG` | Progress + study-time tracking and stats |
| `STREAK` | Daily study-streak tracking (timezone-correct — uses local calendar days, not UTC) |
| `HOME` | Home dashboard rendering |
| `TT` | Timetable |
| `CACHE` | Offline cache manager UI/logic |
| `DATA` | Data export/import |
| `TUTORIAL` | First-run onboarding walkthrough |
| `APP` | Boot sequence |
| `NET` | Network-aware fetch wrapper |

---

## 6. Content model (how question sets are organized)

Content is structured **four levels deep**:

```
Level (level5 / level7 / gk / old_question)
  └─ Chapter (e.g. "1": "Structural Engineering")
       └─ Book (the source a question set came from)
            └─ Subtopic (a question range/label) → Google Drive file ID
```

`old_question` is also where released **Weekly Sets** get merged in automatically, under a standing "Weekly Sets" chapter/book — so once a scheduled set unlocks, it's permanently reachable through the same four-dropdown Online Study picker, not a separate mechanism a student has to remember.

`user.html`'s Online Study view exposes this as four cascading dropdowns: Level → Chapter → Book → Subtopic.

### Adding a new question set (no code changes needed)

1. Upload the question JSON to Google Drive → Share → "Anyone with the link."
2. Copy the file ID from the share link.
3. Open `chapters-data.js`, add `"Your Subtopic Label": "fileId"` under the right `level → chapter → book`.
4. New chapter or level → follow the instructions in `chapters-data.js`'s own header comment.

(Or, for a time-limited/scheduled release instead of an always-visible chapter entry, use **Weekly Sets** from the admin panel instead — it handles the Drive upload for you.)

### Question JSON shape

```json
[
  {
    "q": "Question text",
    "options": ["A", "B", "C", "D"],
    "correct": 0,
    "explanation": "Why A is correct",
    "img": "driveFileIdOrBase64DataUri",
    "imgCaption": "Alt text for the image"
  }
]
```

`normQ()` in `app.js` accepts several field-name variants for each of these (question text: `q`/`question`/`stem`/`ques`/`text`; options: `options`/`opts`/`choices`, or lettered `a`/`b`/`c`/`d`; correct answer: 0-based index or a letter). `img`/`imgCaption` are both optional — `img` accepts either an embedded base64 data URI or a Drive fileId/share-link, resolved client-side with no extra backend load either way.

### `ChapterData` helper API (used throughout `app.js`)

- `ChapterData.chapters(lv)`, `ChapterData.books(lv, ch)`, `ChapterData.files(lv, ch, book)`
- `ChapterData.fileCount(lv, ch[, book])` — usable file count
- `ChapterData.chapterFileRefs(lv, ch)` / `ChapterData.allFileRefs()` — flat `{lv, ch, book, subtopic, name, fid, key}` lists, used by Psycho Mode, Daily Challenge, and Offline Cache

---

## 7. Backend (`CODE.gs`) — actions and data model

A single Google Apps Script Web App exposing everything through one `/exec` URL and an `action` query parameter (`doGet`/`doPost` both route to the same switch).

### Google Sheets used as the database

- **`Users`** — accounts, credentials, trial/access state, login-attempt lockout tracking
- **`Payments`** — submitted payment records
- **`Settings`** — admin-editable global config (key/value)
- **`Logs`** — admin + system audit log (including rate-limit trips, so abuse attempts leave a trace)
- **`Admins`** — admin accounts (separate from `Users`)
- **`Progress`** — server-side backup/sync of each user's local progress data (also the source for the admin "Most Missed Questions" aggregate)
- **`PushTokens`** — registered FCM tokens for push notifications
- **`WeeklySets`** — scheduled question-set releases

Every sheet gets consistent auto-formatting (header color, alternating row banding, borders, sized columns) via a shared `applyTableFormat_()` helper, with a retry-with-backoff around the banding step specifically (a known Apps Script timing quirk when many sheets are created/formatted in rapid succession within one `setup()` run).

### Available actions (40 total)

| Category | Actions |
|---|---|
| Health | `ping` |
| Auth / session | `login`, `signup`, `requestPasswordReset`, `resetPassword`, `checkSession`, `saveProgress`, `getProgress`, `savePushToken` |
| Content | `listWeeklySets`, `getFile` (rate-limited: 120 req/min globally — the one action with no auth, by design, so offline/expired users can still read already-cached content) |
| Payment | `submitPayment`, `getPaymentStatus`, `getSettings` |
| Admin — accounts | `adminLogin`, `adminChangePassword`, `adminListAdmins`, `adminCreateAdmin`, `adminDeleteAdmin` |
| Admin — users | `adminListUsers`, `adminUpdateUser`, `adminDeleteUser`, `adminDeleteUsersBatch`, `adminGrantAccess`, `adminGrantAccessBatch` |
| Admin — payments | `adminListPayments`, `adminReviewPayment`, `adminReviewPaymentsBatch`, `adminDeletePayment`, `adminDownloadScreenshot` |
| Admin — settings & ops | `adminUpdateSettings`, `adminUpdateSettingsBatch`, `adminStats`, `adminMostMissedQuestions`, `adminListLogs` |
| Admin — Weekly Sets | `adminCreateWeeklySet`, `adminUploadWeeklySetFile`, `adminUpdateWeeklySet`, `adminDeleteWeeklySet`, `adminListWeeklySets` |

Batch actions (`adminGrantAccessBatch`, `adminReviewPaymentsBatch`) mutate the already-loaded sheet data in memory and write each affected sheet back in exactly one `setValues()` call, regardless of how many rows are in the batch — not one API round-trip per row per column.

### Notable backend behavior

- **`TRIAL_HOURS`** (default 24) is overridable via the `Settings` sheet.
- **Login lockout** — 5 attempts, 15-minute lockout, checked before the password itself so a locked account can't keep being used to guess.
- **Password hashing** — salted SHA-256, with transparent on-the-fly upgrade of any legacy unsalted hash on next successful login.
- **Signup rate limiting** — 15/minute globally, since there's no email verification or CAPTCHA to otherwise stop scripted mass account creation.
- **Admin seed account** — `adminLogin` flags `mustChangePassword: true` if the literal seed credentials are still in use (they're visible in this public repo's source), forcing the change-password modal on next login rather than relying on a comment.
- **`setup()`** is idempotent — safe to re-run any time. Creates every sheet, seeds the first admin, initializes default settings, and registers the time-driven triggers for trial-expiry warnings and Weekly Set unlock notifications.
- **`APP_VERSION`** is defined in both `CODE.gs` and `version.js` — bump both together on release.

---

## 8. Security notes

- **Clickjacking mitigation** on all three pages via a client-side frame-busting script — GitHub Pages doesn't support custom HTTP response headers, so `X-Frame-Options`/CSP `frame-ancestors` (header-only per spec) aren't available; this is the best mitigation possible under that hosting constraint.
- **Rate limiting** on `getFile` (120/min) and `signup` (15/min), both logged to the `Logs` sheet on the first trip per minute so sustained abuse leaves a visible trace without flooding the log.
- **Session tokens** are per-account (users) and per-admin-account (admins) — logging in on a second device no longer invalidates the first session.
- **Admin logout only clears the admin's own session** — a past bug meant it also silently cleared any unrelated student session saved in the same browser (a real risk on shared/school devices).
- **Password reset** never reveals whether an email/account exists, uses one-time codes with expiry, and is rate-limited per account.
- Every admin action that mutates data is gated by `checkAdmin_()` and wrapped in `withLock_()` to serialize concurrent writes.

---

## 9. Deployment — getting it running (no build step)

1. **Deploy the backend:**
   - Open [script.google.com](https://script.google.com), create a new project, paste in `CODE.gs`.
   - Change `ADMIN_SEED_PASSWORD` away from the default before deploying.
   - Set up Firebase Cloud Messaging if you want push notifications; put the project config in `firebase-config.js` and set `FCM_PROJECT_ID` in Script Properties.
   - Run `setup()` once from the Apps Script editor.
   - Deploy → New deployment → Web app → Execute as "Me" → Who has access "Anyone."
   - Copy the resulting `.../exec` URL.
2. **Wire the frontend to it** — paste that URL into `index.html`, `admin.html`, and `app.js`'s `APP_CONFIG.APPS_URL`.
3. **Host the static files** — GitHub Pages, Netlify, Firebase Hosting, or open `index.html` locally for testing. The service worker/PWA install only works over HTTPS or `localhost`.
4. **Content** — upload question-set JSON to Drive (shared "Anyone with the link") and register file IDs in `chapters-data.js`, or use Weekly Sets from the admin panel for scheduled releases.
5. Log into `admin.html` with the seeded credentials, change the password immediately (the app will prompt you), and configure payment settings before going live.
6. **SEO** — once the domain is live, submit `sitemap.xml` to Google Search Console; that's the fastest way to get it actually crawled and indexed.

---

## 10. Things that must stay in sync across files

- **`GAS_URL` / `APP_CONFIG.APPS_URL`** — identical in `index.html`, `admin.html`, `app.js`.
- **`abhyas_session` shape** — written by `index.html`, read/written the same way by `app.js`'s `AUTH` module.
- **Access-level rules** — computed independently in `index.html` and `app.js`'s `AUTH._buildSession()`; must stay logically identical.
- **Offline cache keys** — `` `${level}_${chapter}_${book}_${subtopic}` ``, built once in `ChapterData`, consumed consistently by `ON`, `PSY`, `CACHE`, `QUIZ`.
- **`sw.js`'s `SHELL` array** — must list every file the app actually loads, or it silently gets purged from the offline cache by the periodic stale-entry cleanup (this happened for real with `design-system.css`/`cloud-sync.js` — fixed, but worth remembering if a new shared file is ever added).
- **`APP_VERSION`** — `version.js` and `CODE.gs`; bump both together.
- **Global settings** — written by `admin.html`, read live by `index.html` on every load; don't cache them client-side without a refresh path, or admin changes stop reaching users.

---

## 11. Known gaps / roadmap

- **`app.js` (~3,100 lines) and `CODE.gs` (~3,200 lines) are both large single files.** Splitting either into modules would help long-term maintainability, but hasn't been done — it's a real structural risk to attempt without a live test environment to validate against.
- **No CAPTCHA on signup.** The rate limiter blunts *bulk* automated account farming but not a slow, patient script staying under the per-minute threshold.
- **No email verification.** Combined with the rate limit the realistic abuse risk is lower, but not eliminated.
- **No Nepali-language UI option.** The entire interface is English-only, despite being built for a Nepali government exam's candidates specifically — likely the single highest-impact feature not yet built.
- **No Privacy Policy / Terms of Service.** The app collects email, mobile number, and payment screenshots — worth adding given the real personal/financial data involved.
- **"Most Missed Questions" (admin analytics) reflects a rolling recent-activity window**, not complete historical data — each user's session history is capped at their most recent 50 quiz sessions.
- **True background push delivery** (notifications even when the browser/PWA isn't running at all) needs the Firebase/service-worker push pipeline to stay correctly configured — this now exists (trial-expiry warnings, Weekly Set unlocks), but any future notification type needs to go through `broadcastPushToAll_`/`sendPushNotification_` rather than assuming delivery "just works."

---

## 12. Feature summary

**Gateway (`index.html`)**
- Signup / login / forgot & reset password
- Free trial with live countdown (admin-configurable length)
- Manual payment submission (QR + transaction ID + screenshot, with client-side size check)
- Payment status screen (pending/rejected, with resubmission)
- Public landing page: SEO metadata, structured data (WebApplication + FAQPage), About section, FAQ — one naturally scrolling page, no nested scrollbars

**Study App (`user.html` + `app.js`)**
- Home dashboard with progress overview and weekly study-time tracking
- Online Study — four-level cascading content browser, permanently including any released Weekly Sets
- Flashcard-style review and timed exam modes, with question images (embedded or Drive-hosted)
- Psycho Mode and Daily Challenge
- Bookmarks, flags, and a wrong-answer bank with real spaced repetition (1/3/7/14-day intervals)
- Progress tracking, study-time tracking, and timezone-correct daily streaks
- Personal weekly timetable with reminders
- Offline content caching (IndexedDB-backed), including a fully offline app shell
- Push notifications (Weekly Set unlocks, trial-expiry warnings)
- Data export/import, cloud backup/restore
- Installable PWA
- First-run tutorial

**Admin Panel (`admin.html`)**
- Independent admin login, forced password change if still on the seed default
- User list/search/filter and bulk actions (grant access, delete)
- Payment review (individual and bulk approve/reject) with audit trail
- Weekly Sets: upload, schedule, preview before publishing, duplicate-upload warning
- "Most Missed Questions" — which specific questions students get wrong most often
- CSV export for Users and Payments
- Global settings management
- Usage statistics
- Admin account management
- Activity log (including rate-limit trips)
