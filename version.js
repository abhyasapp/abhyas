/* ═══════════════════════════════════════════════════════════════
   VERSION.JS — single source of truth for the client app version.
   Loaded via <script src="version.js"> on every page (before
   shared.js/app.js) AND via importScripts() in sw.js.

   Bump APP_VERSION on every release. sw.js derives its CACHE_NAME
   directly from this value, so bumping the version here is what
   forces every open browser tab to drop its old cached shell and
   start a fresh session — no separate manual cache-name bump needed.

   Keep in sync with CODE.gs's own APP_VERSION constant (the backend
   runs in a different runtime and can't import this file directly).

   ── Version history ──
   1.00 — initial release
   1.04 — security + correctness + Weekly Set attempt capture:
            • Weeky Attempts: one-attempt-then-review-only
            • login error enumeration fix
            • sanitizeSheetField_ whitespace bypass fixed
            • email/contact formula-injection guard
            • _anyModalOpen() visibility check (restores keyboard
              shortcuts after the first quiz load)
            • UI._goRaw scrolls #main, not window
            • weeklyId forces shuffle OFF (aligns recorded answers
              with source file for review mode)
            • scope forwarding in the startWith patch layer
              (fixes chapter filter matching in admin analytics)
            • SW posts SW_ACTIVATED to open tabs after update
            • CACHE.autoSync gates on connection type
            • PSY.start loads files with concurrency 4
            • IndexedDB cache-write failure no longer aborts a
              successful online fetch
            • DATA "Back Up Now" rewired to PSYNC (was calling a
              never-initialized cloud-sync module)
   ═══════════════════════════════════════════════════════════════ */
const APP_VERSION = '1.04';