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
   ═══════════════════════════════════════════════════════════════ */
const APP_VERSION = '1.2';
