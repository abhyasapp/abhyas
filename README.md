# Abhyas — Your path to mastery

**Offline-first exam prep platform for Nepal Engineering (Level 5 / Level 7) and PSC / Loksewa exams.**

Built as three standalone static HTML pages backed by a single Google Apps Script + Google Sheets backend. There is no build step, no bundler, no server framework — you can literally open `index.html` in a browser and it works, once the backend URL is wired in.

- **Version:** Abhyas V1 (`APP_VERSION` = 1.0 in `app.js` and `CODE.GS`)
- **Stack:** Vanilla HTML / CSS / JS on the frontend, Google Apps Script + Google Sheets + Google Drive on the backend
- **Distribution:** Installable PWA (Progressive Web App) with offline caching

---

## 1. What this app actually does

Abhyas is a study app for students preparing for:
- **Level 5 / Level 7 Engineering** licensing exams
- **PSC / Loksewa** (Nepal Public Service Commission) exams
- General Knowledge (GK) and old-question archives

Students sign up, get a **24-hour free trial**, and then must submit a manual payment (QR code + transaction ID + screenshot) that an admin reviews and approves before permanent access is granted. Once inside, they get a full quiz/study app: flashcard-style review, timed exams, bookmarks, a wrong-answer bank, progress tracking, streaks, a personal timetable, and offline access to question sets they've downloaded in advance.

An admin panel lets a site operator manage users, review/approve payments, and edit global settings (price, QR code image, contact info) — all without touching code.

---

## 2. High-level architecture

```
┌─────────────┐        ┌──────────────┐        ┌──────────────┐
│ index.html  │───────▶│  user.html   │        │  admin.html  │
│  (Gateway)  │        │ (Study App)  │        │(Admin Panel) │
└──────┬──────┘        └──────┬───────┘        └──────┬───────┘
       │                      │                        │
       │ writes               │ loads                  │ own login
       │ localStorage         │ chapters-data.js        │ ('abhyas_admin')
       │ 'abhyas_session'     │ then app.js             │
       │                      │                          │
       └──────────────────────┴────────────┬─────────────┘
                                            │  HTTP GET/POST
                                            │  ?action=...
                                            ▼
                                 ┌───────────────────────┐
                                 │       CODE.GS          │
                                 │ (Google Apps Script)   │
                                 │  Auth / Payments /     │
                                 │  Settings / Progress   │
                                 └───────────┬─────────────┘
                                            │
                       ┌────────────────────┼────────────────────┐
                       ▼                    ▼                    ▼
                Google Sheets        Google Drive          Google Sheets
             (Users, Payments,     (question-set JSON     (Progress sync,
              Settings, Logs,       files + payment          Admins)
              Admins, Progress)     screenshots)
```

**The three frontend pages never share JavaScript code.** They are connected by exactly two contracts:

1. **The same deployed Apps Script `/exec` URL** — must be identical in:
   - `index.html` → `const GAS_URL = "..."`
   - `admin.html` → `const GAS_URL = "..."`
   - `app.js` → `APP_CONFIG.APPS_URL`
2. **The `abhyas_session` localStorage key** — written only by `index.html` after a successful login/signup, and read by `app.js` on `user.html` to decide whether the visitor is allowed in. `admin.html` does **not** use this key; it has a completely separate login (`abhyas_admin`).

There is no traditional database — **Google Sheets is the database** (Users, Payments, Settings, Logs, Admins, Progress tabs), and **Google Drive hosts the actual question content** as JSON files, referenced by file ID.

---

## 3. End-to-end user workflow

1. **Landing (`index.html`)** — a new visitor signs up with username/email/mobile/password. The backend (`handleSignup` in `CODE.GS`) creates a row in the `Users` sheet and starts a 24-hour trial clock (`TRIAL_HOURS`).
2. **Trial period** — for 24 hours, the user has full access to `user.html` (the study app) with `access.level = 'trial'`.
3. **Trial expiry / payment** — once the trial ends, `index.html` shows a payment screen: a QR code (configurable by the admin), a field for the transaction ID, and a screenshot upload. Submitting this calls `submitPayment`, which writes a row to the `Payments` sheet and sets the user's status to `payment_pending`.
4. **Admin review (`admin.html`)** — an admin logs into the separate admin panel, sees the pending payment under "Payments," and approves or rejects it (`adminReviewPayment`).
   - **Approved** → the user's access becomes `permanent`.
   - **Rejected** → the user's status resets to `expired`, and `index.html` shows a "please pay again" screen along with their previously submitted TXN ID/date (`getPaymentStatus`) rather than generic copy.
5. **Ongoing use (`user.html`)** — once access is `trial`, `permanent`, this page loads the actual study app: browsing chapters, taking quizzes/exams, tracking progress, managing bookmarks, using the timetable, and caching content for offline use.
6. **Session verification** — every time `user.html` loads, `app.js`'s `AUTH` module re-validates the session against the backend (`checkSession`) rather than trusting the local copy indefinitely, so a revoked or expired account is caught even if `localStorage` still has stale data.
7. **Offline** — if the device goes offline, cached question sets and previously loaded UI keep working thanks to the service worker (`sw.js`) and an IndexedDB-backed question cache (`QDB` in `app.js`); only network-dependent actions (login check, downloading new question sets) are blocked until connectivity returns.

---

## 4. File-by-file reference

| File | Role |
|---|---|
| **`index.html`** | **Gateway.** Signup, login, the 24-hour trial countdown, the payment flow (QR + TXN ID + screenshot), and routing into `user.html` or `admin.html`. Owns the `abhyas_session` schema — it's the only file that writes it. Talks directly to `CODE.GS`; loads no other local JS file. |
| **`user.html`** | **The study app shell.** All HTML structure and CSS for every in-app view: home dashboard, quiz/exam screens, bookmarks, timetable, offline cache manager, settings, etc. Loads `chapters-data.js`, then `app.js`, then a small inline `<script>` "patch layer" at the bottom that wires up search links, swipe gestures, bottom-nav behavior, and the PWA install button. |
| **`app.js`** | **All application logic.** ~2,400+ lines covering: session gating, the quiz engine (flashcard mode + timed exam mode), bookmarks/flags/wrong-answer bank, progress tracking, streaks, the timetable, the offline cache manager, data export/import, and PWA registration. This is the file you touch for almost any feature change. Reads its data model from `chapters-data.js` and talks to `CODE.GS` for `checkSession` and `getFile` (question-set downloads). |
| **`chapters-data.js`** | **Pure content data** — no logic. Maps `Level → Chapter → Book → Subtopic → Google Drive file ID`, four levels deep. This is the only file you edit to add, rename, or remove chapters, books, or question sets. Has a large instructional comment block at the top for exactly how to do that. |
| **`admin.html`** | **Admin panel.** List/search users, approve or reject pending payments, edit global settings (payment amount, QR image, contact info, instructions), view usage stats, manage admin accounts, view an audit log, and change the admin password. Fully self-contained with its own login gate (`abhyas_admin`), independent of `index.html`'s session. Talks directly to `CODE.GS`. |
| **`CODE.GS`** | **Backend — Google Apps Script.** A single script handling every `?action=...` request from all three pages: authentication, signup, session checks, progress sync, payment submission/review, settings, question-file proxying, and the full admin action set. Manages Google Sheets (`Users`, `Payments`, `Settings`, `Logs`, `Admins`, `Progress`) and reads/writes Google Drive for question files and payment screenshots. |
| **`manifest.json`** | **PWA manifest** — app name, icons, theme colors, start URL, display mode. Lets the app be "installed" to a phone or desktop home screen. Referenced from `user.html`'s `<link rel="manifest">`. |
| **`sw.js`** | **Service worker.** Caches the app shell for offline use (stale-while-revalidate) and Drive/API responses (network-first with an offline fallback). Registered by `PWA.init()` in `app.js`. Also handles clicks on timetable-reminder notifications (focuses/opens the app). It does **not** handle server-sent push notifications — see [Known gaps](#10-known-gaps--roadmap). |
| **`icon-192.png` / `icon-512.png`** | App icons used by the PWA manifest for home-screen/install icons at two resolutions. |

### Quick "which file do I touch?" guide

| I want to... | Edit this file |
|---|---|
| Add/rename a chapter, book, level, or question-file link | `chapters-data.js` only |
| Change quiz behavior (timer, question limit, shuffle, retry logic, exam auto-submit, scoring, results screen) | `app.js` → `QUIZ` module |
| Add a new quiz mode | `app.js` → new module alongside `QUIZ` / `PSY`, plus matching HTML in `user.html` |
| Change bookmarks / flags / wrong-answer bank behavior | `app.js` → `REV` module |
| Change trial length, payment flow, or login/signup validation | `CODE.GS` (`TRIAL_HOURS`, `handleSignup`, `handleLogin`) **and** `index.html` (form/validation) — keep both in sync |
| Change how session expiry / offline access is judged | `app.js` → `AUTH` module **and** `index.html`'s matching logic |
| Change the dashboard, streaks, or progress stats | `app.js` → `PROG` / `STREAK` / `HOME` modules |
| Change the timetable | `app.js` → `TT` module |
| Change offline caching behavior | `app.js` → `CACHE` module and `QDB`, plus `sw.js` for the underlying cache strategy |
| Change study-app visual styling | `user.html` `<style>` block (CSS variables at the top control the whole theme) |
| Change login/payment screen styling | `index.html` `<style>` block |
| Change admin panel behavior | `admin.html` (self-contained) |
| Add a brand-new top-level view/tab | HTML section + sidebar link in `user.html`, a new module in `app.js`, and a case in `UI._goRaw()`'s view switch |

---

## 5. `app.js` module map

`app.js` is organized into clearly named modules (each a top-level `const`):

| Module | Responsibility |
|---|---|
| `APP_CONFIG` / `LS` / `S` | Backend URL config, localStorage key names, and the in-memory app state object |
| `QDB` | IndexedDB-backed cache for downloaded question sets (chosen over localStorage because localStorage is capped around 5–10 MB per origin, easy to exceed once a student caches a large content library) |
| `NETCHECK` | Lightweight connectivity probing (separate from the browser's `navigator.onLine`, which can be unreliable) |
| `AUTH` | Session gate — validates `abhyas_session` against the backend, builds the effective access level (`trial` / `permanent` / `expired` / `pending_review` / `unknown`) |
| `PSYNC` | Background sync of local data (progress, bookmarks, streaks) back to the server |
| `PWA` | Service worker registration and install-prompt handling |
| `UI` | Core view-routing / navigation (`_goRaw()` switches between top-level views) |
| `ON` | "Online Study" — the four-level cascading dropdown browser (Level → Chapter → Book → Subtopic) |
| `LOC` | Local/offline question-set access helpers |
| `PSY` | "Psycho Mode" — a rapid-fire quiz mode pulling from an entire chapter across all its books |
| `REV` | Review lists: bookmarks, flags, and the wrong-answer bank |
| `QUIZ` | The core quiz/exam engine — flashcard and timed-exam modes, scoring, results, Daily Challenge |
| `PROG` | Progress tracking and stats |
| `STREAK` | Daily study-streak tracking |
| `HOME` | Home dashboard rendering |
| `TT` | Timetable — creating and viewing weekly study sessions |
| `CACHE` | Offline cache manager UI/logic |
| `DATA` | Data export/import |
| `TUTORIAL` | First-run/onboarding walkthrough |
| `APP` | Boot sequence — ties everything together on page load |
| `NET` | Network-aware fetch wrapper used throughout the app |

---

## 6. Content model (how question sets are organized)

Content is structured **four levels deep**:

```
Level (level5 / level7 / gk / old_question)
  └─ Chapter (e.g. "7": "Building Construction Technology")
       └─ Book (the source/author a question set came from, e.g. "Sunil Sah", "DPARSAD", "GATE")
            └─ Subtopic (a question range/label, e.g. "1–100") → Google Drive file ID
```

`user.html`'s Online Study view exposes this as **four cascading dropdowns**: Level → Chapter → Book → Subtopic.

### Adding a new question set (no code changes needed)

1. Upload the question JSON to Google Drive → Share → "Anyone with the link."
2. Copy the file ID from the share link.
3. Open `chapters-data.js`, find the right `level → chapter → book` in the `DRIVE` object, and add `"Your Subtopic Label": "fileId"`.
   - New book in an existing chapter → add a new key at the book level, e.g. `"New Author": { "1-100": "fileId" }`.
   - Book has only one file total → use `"All"` as the subtopic label (as `GATE` and `DPARSAD` do).
4. New chapter or level → follow the step-by-step instructions in `chapters-data.js`'s own header comment.

### Expected question JSON shape

```json
[
  {
    "q": "Question text",
    "options": ["A", "B", "C", "D"],
    "correct": 0,
    "explanation": "Why A is correct"
  }
]
```
`normQ()` in `app.js` is deliberately flexible and accepts a few variants of this shape.

### `ChapterData` helper API (used throughout `app.js`)

- `ChapterData.chapters(lv)` — chapter list for a level
- `ChapterData.books(lv, ch)` — book list for a chapter
- `ChapterData.files(lv, ch, book)` — subtopic → file ID map for one book
- `ChapterData.fileCount(lv, ch[, book])` — usable (non-empty) file count across all books in a chapter, or just one book
- `ChapterData.chapterFileRefs(lv, ch)` — flat `{lv, ch, book, subtopic, name, fid, key}` list for one chapter, used by Psycho Mode
- `ChapterData.allFileRefs()` — the same flat shape across the entire dataset, used by Daily Challenge and Offline Cache

---

## 7. Backend (`CODE.GS`) — actions and data model

The backend is a **single Google Apps Script Web App** exposing everything through one `/exec` URL and an `action` query parameter (`doGet`/`doPost` both route to the same switch statement).

### Google Sheets used as the database
- **`Users`** — accounts, credentials, trial/access state, login-attempt lockout tracking
- **`Payments`** — submitted payment records (TXN ID, screenshot reference, review status)
- **`Settings`** — key/value store for admin-editable global config (payment amount, QR image, contact info, trial hours, etc.)
- **`Logs`** — admin audit log
- **`Admins`** — admin accounts (separate from `Users`)
- **`Progress`** — server-side backup/sync of each user's local progress data

### Available actions

| Category | Actions |
|---|---|
| Health | `ping` |
| Auth / session | `login`, `signup`, `checkSession`, `saveProgress`, `getProgress` |
| Payment | `submitPayment`, `getPaymentStatus`, `getSettings`, `getFile` |
| Admin | `adminLogin`, `adminChangePassword`, `adminListAdmins`, `adminCreateAdmin`, `adminDeleteAdmin`, `adminListUsers`, `adminListPayments`, `adminReviewPayment`, `adminGrantAccess`, `adminUpdateUser`, `adminDeleteUser`, `adminDeletePayment`, `adminUpdateSettings`, `adminUpdateSettingsBatch`, `adminStats`, `adminListLogs` |

### Notable backend behavior
- **`TRIAL_HOURS`** (default 24) controls the free-trial length, overridable via the `Settings` sheet.
- **Login lockout** — `MAX_LOGIN_ATTEMPTS` (5) and `LOCKOUT_MINUTES` (15) throttle brute-force attempts.
- **`setup()`** is an idempotent one-time function you run manually in the Apps Script editor to create every sheet, seed the first admin account, and initialize default settings.
- **First admin account** — seeded from `ADMIN_SEED_USERNAME` / `ADMIN_SEED_PASSWORD` in `CODE.GS`; change the seed password immediately after first login (or create a new admin and delete the seed one).
- **`APP_VERSION`** is defined independently in both `CODE.GS` and `app.js` (surfaced via the `ping` action and the user.html sidebar footer respectively) — bump both by hand together on release.

---

## 8. Deployment — getting it running (no build step)

1. **Deploy the backend:**
   - Open [script.google.com](https://script.google.com), create a new project, and paste in `CODE.GS`.
   - Change `ADMIN_SEED_PASSWORD` away from the default before deploying.
   - Run `setup()` once from the Apps Script editor to create the Sheets and seed the first admin.
   - Deploy → New deployment → Web app → Execute as "Me" → Who has access "Anyone."
   - Copy the resulting `.../exec` URL.
2. **Wire the frontend to it** — paste that URL into all three places:
   - `index.html` → `const GAS_URL = "..."`
   - `admin.html` → `const GAS_URL = "..."`
   - `app.js` → `APP_CONFIG.APPS_URL`
3. **Host the static files** — any static host works (GitHub Pages, Netlify, Firebase Hosting), or open `index.html` locally for testing. Note: the service worker / PWA install only works over HTTPS or `localhost`.
4. **Content** — upload question-set JSON files to Google Drive (shared "Anyone with the link") and register their file IDs in `chapters-data.js` as described in [§6](#6-content-model-how-question-sets-are-organized).
5. Log into `admin.html` with the seeded admin credentials, change the password immediately, and configure payment settings (amount, QR image, contact info) before going live.

---

## 9. Things that must stay in sync across files

- **`GAS_URL` / `APP_CONFIG.APPS_URL`** — must be identical in `index.html`, `admin.html`, and `app.js`. If you redeploy the Apps Script and get a new URL, update all three.
- **`abhyas_session` shape** — `index.html` writes `{ type, username, name, email, mobile, token, access:{level, trialExpiresAt, permanent}, settings, lastVerified }`. `app.js`'s `AUTH` module reads/writes this exact shape — change one side, change the other.
- **Access-level rules** (`permanent` / `trial` / `expired` / `pending_review` / `unknown`) — computed independently in `index.html`'s `handleUserAuth()` and `app.js`'s `AUTH._buildSession()`. They must be kept logically identical.
- **Offline cache keys** — built as `` `${level}_${chapter}_${book}_${subtopic}` `` in one place (`ChapterData.chapterFileRefs()` / `allFileRefs()`) and consumed consistently by `ON`, `PSY`, `CACHE`, and `QUIZ.daily()`. A set cached from one screen must appear as cached everywhere else.
- **Global settings** (payment amount / QR / contact / instructions) — written by `admin.html` via `adminUpdateSettingsBatch`, read by `index.html` via `getSettings`. `index.html`'s `loadPaymentUI()` re-fetches live settings every time it's online — don't reintroduce a "skip fetch if already cached" shortcut, or admin changes will stop reaching users with a stale cached copy.
- **`APP_VERSION`** — defined separately in `app.js` and `CODE.GS`; bump both together on release.

---

## 10. Known gaps / roadmap

- **Timetable reminders only work while the app is open.** `TT` (in `app.js`) can now notify a configurable number of minutes before each scheduled session, via `Notification`/`ServiceWorkerRegistration.showNotification()`, with a toggle and lead-time setting on the Timetable page. This fires as long as Abhyas is open in a tab or running as an installed PWA — closing the browser entirely stops it, same as any other in-page timer. True background delivery (reminders even when the browser/PWA isn't running at all) needs **server-side Web Push**: a VAPID key pair, the browser's push subscription stored server-side, and `CODE.gs` (or a separate worker) waking up on a schedule to send pushes — a materially bigger backend feature than this app currently has, not something to bolt on casually.

---

## 11. Feature summary

**Gateway (`index.html`)**
- Signup / login
- 24-hour free trial with live countdown
- Manual payment submission (QR + transaction ID + screenshot)
- Payment status screen (pending / rejected, with resubmission)

**Study App (`user.html` + `app.js`)**
- Home dashboard with progress overview
- Online Study — four-level cascading content browser
- Flashcard-style review and timed exam modes
- Psycho Mode — rapid quiz across a whole chapter
- Daily Challenge
- Bookmarks, flags, and a wrong-answer bank
- Progress tracking and daily streaks
- Personal weekly timetable
- Offline content caching (IndexedDB-backed) for use without a network connection
- Data export/import
- Installable PWA with offline app-shell caching
- First-run tutorial/onboarding

**Admin Panel (`admin.html`)**
- Independent admin login
- User list/search and management
- Payment review (approve/reject) with audit trail
- Global settings management (price, QR, contact info)
- Usage statistics
- Admin account management
- Action log viewer
