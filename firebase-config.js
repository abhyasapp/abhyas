/* ═══════════════════════════════════════════════════════════════
   FIREBASE-CONFIG.js — Push notification setup
   ───────────────────────────────────────────────────────────────
   Fill in every value below from your own Firebase project before
   push notifications will work — see the setup comment above
   sendPushNotification_ in CODE.gs for how to create the project and
   where to find these. All six values here (apiKey, authDomain, etc.)
   come from Firebase Console → Project Settings → General → Your apps
   → Web app → SDK setup and configuration. VAPID_KEY comes from
   Project Settings → Cloud Messaging → Web configuration → Web Push
   certificates.

   Everything in this file is PUBLIC by design (Firebase's client-side
   config is meant to be visible in browser devtools — it identifies
   your project, it doesn't authenticate as it) — safe to commit,
   unlike the FCM_PRIVATE_KEY which must only ever live in Apps
   Script's Script Properties, never in a file.
   ═══════════════════════════════════════════════════════════════ */
const FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// The "Web Push certificate" public key from Cloud Messaging settings —
// different from apiKey above, this is the VAPID public key used only
// for the getToken() call below.
const FIREBASE_VAPID_KEY = "YOUR_VAPID_PUBLIC_KEY";

// True once every placeholder above has been replaced — PUSH.init() in
// app.js checks this before doing anything, so an unconfigured deploy
// just silently skips push setup instead of throwing on Firebase's SDK
// rejecting the placeholder config.
const FIREBASE_CONFIGURED = FIREBASE_CONFIG.apiKey !== "YOUR_API_KEY";
