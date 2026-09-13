/* ═══════════════════════════════════════════════════════════════
   CLOUD-SYNC.JS — Personal Google Drive backup
   ───────────────────────────────────────────────────────────────
   User-initiated, opt-in backup of progress, bookmarks, flags,
   wrong-bank, streaks, per-chapter accuracy, and timetable into
   the user's OWN Google Drive (hidden App Data folder — only this
   app can read or write it, it does not appear in their normal
   Drive UI, and it doesn't consume visible Drive quota in any way
   that matters).

   Complements PSYNC (the automatic server-side backup in app.js).
   PSYNC keeps a fresh copy on the Abhyas backend so a new device
   "just works". CLOUD lets a user keep their own portable snapshot
   that survives even if the backend is unreachable.

   Auth:
     Google Identity Services (google.accounts.oauth2) with scope
     `drive.appdata` — narrower than `drive.file`, only touches
     files this app itself created. Access token is held in memory
     only (never localStorage) — a persisted OAuth token would be
     an XSS liability, and Google's silent refresh reacquires it
     trivially on the next session if consent is still granted.

   Data shape:
     { v, ts, username, prog, chapStats, bk, fl, wr, stk, tt }
     Migrations handled by _cloudBackupMigrations below. Weekly
     attempts are deliberately NOT backed up — they're server-
     authoritative (see CODE.gs's submitWeeklyAttempt) and re-fetched
     on every login, so a second local copy would just be a source
     of drift.

   Requires:
     <script src="https://accounts.google.com/gsi/client" async defer></script>
     in user.html, before this file. _waitForGsi() polls for up to
     20s if the script hasn't loaded yet.
   ═══════════════════════════════════════════════════════════════ */

const CLOUD_CLIENT_ID = '242226857075-hpkbjoqhlem95fu6vkf712e8ijs33sng.apps.googleusercontent.com';
const CLOUD_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const CLOUD_BACKUP_VERSION = 3;
const CLOUD_BACKUP_FILENAME_PREFIX = 'abhyas-backup-';
const CLOUD_BACKUP_FILENAME_SUFFIX = '.json';
const CLOUD_TOKEN_REFRESH_MARGIN_MS = 60 * 1000;

/* Migration chain: _cloudBackupMigrations[N] transforms a payload
   FROM version N TO version N+1. Adding support for a future backup
   format is a single new entry here plus a CLOUD_BACKUP_VERSION
   bump. */
const _cloudBackupMigrations = {
  // Example of what a future migration would look like:
  // 2: (data) => ({ ...data, v: 3, chapStats: data.chapStats || {} }),
};

function _cloudMigrate(data) {
  let v = Number(data && data.v) || 0;
  if (v < 1) {
    return { ok: false, error: 'Backup is missing a version number — too old or corrupted to restore safely.' };
  }
  if (v > CLOUD_BACKUP_VERSION) {
    return { ok: false, error: `Backup (v${v}) is newer than this app supports (v${CLOUD_BACKUP_VERSION}). Update the app before restoring.` };
  }
  while (v < CLOUD_BACKUP_VERSION) {
    const step = _cloudBackupMigrations[v];
    if (!step) {
      return { ok: false, error: `No migration path from backup v${v} to v${CLOUD_BACKUP_VERSION}.` };
    }
    data = step(data);
    v++;
    data.v = v;
  }
  return { ok: true, data };
}


const CLOUD = {
  _tokenClient: null,
  _accessToken: null,
  _accessExpiresAt: 0,
  _email: '',
  _initPromise: null,

  // ── Public API ────────────────────────────────────────────────

  isSignedIn() {
    return !!this._accessToken && Date.now() < this._accessExpiresAt;
  },

  status() {
    return {
      signedIn: this.isSignedIn(),
      email: this._email,
      ready: !!this._tokenClient
    };
  },

  // Sets up the token client but does NOT prompt the user — no Google
  // UI appears until signIn() / backup() / restore() are called.
  async init() {
    if (this._initPromise) return this._initPromise;
    this._initPromise = (async () => {
      try {
        await this._waitForGsi();
        this._tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: CLOUD_CLIENT_ID,
          scope: CLOUD_SCOPE,
          callback: () => {}   // set per-request in _getToken
        });
      } catch (err) {
        // Reset so a later attempt can retry — the first call may have
        // raced the GSI script's async load and timed out.
        this._initPromise = null;
        throw err;
      }
    })();
    return this._initPromise;
  },

  async signIn() {
    try {
      await this.init();
      const resp = await this._getToken({ prompt: '' });
      this._storeToken(resp);
      await this._fetchEmail();
      return { success: true, email: this._email };
    } catch (err) {
      return { success: false, error: err.message || 'Sign-in failed.' };
    }
  },

  async signOut() {
    try {
      if (this._accessToken && window.google?.accounts?.oauth2?.revoke) {
        google.accounts.oauth2.revoke(this._accessToken, () => {});
      }
    } catch (e) { /* non-fatal */ }
    this._accessToken = null;
    this._accessExpiresAt = 0;
    this._email = '';
  },

  async backup() {
    if (!S.user) return { success: false, error: 'Not signed in to Abhyas.' };
    try {
      await this.init();
      if (!this.isSignedIn()) {
        const r = await this.signIn();
        if (!r.success) return r;
      }
      const payload = JSON.stringify(this._snapshot());
      const filename = this._filename();
      const fileId = await this._findOrCreate(filename);
      const resp = await this._fetch(
        `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: payload
        }
      );
      if (!resp.ok) {
        const t = await resp.text().catch(() => '');
        throw new Error('Upload failed: ' + (t || resp.status));
      }
      return { success: true, filename, bytes: payload.length, ts: Date.now() };
    } catch (err) {
      return { success: false, error: err.message || 'Backup failed.' };
    }
  },

  async restore() {
    if (!S.user) return { success: false, error: 'Not signed in to Abhyas.' };
    try {
      await this.init();
      if (!this.isSignedIn()) {
        const r = await this.signIn();
        if (!r.success) return r;
      }
      const filename = this._filename();
      const fileId = await this._find(filename);
      if (!fileId) {
        return { success: false, error: 'No cloud backup found for this account.' };
      }
      const resp = await this._fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`
      );
      if (!resp.ok) throw new Error('Download failed: ' + resp.status);
      const raw = await resp.json();
      const migrated = _cloudMigrate(raw);
      if (!migrated.ok) return { success: false, error: migrated.error };
      this._apply(migrated.data);
      return { success: true, ts: migrated.data.ts };
    } catch (err) {
      return { success: false, error: err.message || 'Restore failed.' };
    }
  },

  // Fetch the file's last-modified timestamp without downloading it —
  // used by the UI to show "last backed up: ..." without a full fetch.
  async lastBackupInfo() {
    try {
      await this.init();
      if (!this.isSignedIn()) return null;
      const fileId = await this._find(this._filename());
      if (!fileId) return null;
      const resp = await this._fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=modifiedTime,size`
      );
      if (!resp.ok) return null;
      const data = await resp.json();
      return { modifiedTime: data.modifiedTime, size: data.size };
    } catch (err) {
      return null;
    }
  },

  // ── Internals ─────────────────────────────────────────────────

  _snapshot() {
    return {
      v: CLOUD_BACKUP_VERSION,
      ts: Date.now(),
      username: S.user?.username || '',
      prog: S.prog,
      chapStats: S.chapStats,
      bk: S.bk,
      fl: S.fl,
      wr: S.wr,
      stk: S.stk,
      tt: S.tt
    };
  },

  _filename() {
    // Username is already [a-zA-Z0-9_.-] via the signup regex; the
    // extra replace is belt-and-suspenders for an old session value.
    const u = String(S.user?.username || 'user')
      .replace(/[^a-zA-Z0-9_.-]/g, '_')
      .slice(0, 60);
    return CLOUD_BACKUP_FILENAME_PREFIX + u + CLOUD_BACKUP_FILENAME_SUFFIX;
  },

  async _waitForGsi(timeoutMs = 20000) {
    if (window.google?.accounts?.oauth2) return;
    const start = Date.now();
    while (!window.google?.accounts?.oauth2) {
      if (Date.now() - start > timeoutMs) {
        throw new Error("Google Identity Services didn't load. Check your connection and reload.");
      }
      await new Promise(r => setTimeout(r, 100));
    }
  },

  _getToken({ prompt = '' } = {}) {
    return new Promise((resolve, reject) => {
      this._tokenClient.callback = (resp) => {
        if (!resp || resp.error) {
          const msg = resp?.error_description || resp?.error || 'Authorization failed.';
          if (resp?.error === 'popup_closed' || /closed/i.test(msg)) {
            return reject(new Error('Sign-in cancelled.'));
          }
          return reject(new Error(msg));
        }
        resolve(resp);
      };
      try {
        this._tokenClient.requestAccessToken({ prompt });
      } catch (err) {
        reject(err);
      }
    });
  },

  _storeToken(resp) {
    this._accessToken = resp.access_token;
    const expiresIn = Number(resp.expires_in) || 3600;
    // Refresh a minute early so an in-flight request near the boundary
    // never races a stale token.
    const effectiveSeconds = Math.max(30, expiresIn - CLOUD_TOKEN_REFRESH_MARGIN_MS / 1000);
    this._accessExpiresAt = Date.now() + effectiveSeconds * 1000;
  },

  async _fetchEmail() {
    try {
      const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: 'Bearer ' + this._accessToken }
      });
      if (!r.ok) return;
      const u = await r.json();
      this._email = u.email || '';
    } catch (e) { /* non-fatal — email is display-only */ }
  },

  async _ensureFreshToken() {
    if (this._accessToken && Date.now() < this._accessExpiresAt) return;
    // Silent refresh — Google returns a fresh token with no UI if the
    // user has already granted consent for this browser session.
    const resp = await this._getToken({ prompt: '' });
    this._storeToken(resp);
  },

  async _fetch(url, opts = {}) {
    await this._ensureFreshToken();
    const headers = { ...(opts.headers || {}), Authorization: 'Bearer ' + this._accessToken };
    let r = await fetch(url, { ...opts, headers });

    // A 401 despite a "fresh" token can happen if Google revoked it
    // out-of-band (user removed the app's access in their Google
    // account settings). One retry, then propagate.
    if (r.status === 401) {
      this._accessToken = null;
      this._accessExpiresAt = 0;
      const resp = await this._getToken({ prompt: '' });
      this._storeToken(resp);
      r = await fetch(url, {
        ...opts,
        headers: { ...headers, Authorization: 'Bearer ' + this._accessToken }
      });
    }
    return r;
  },

  async _find(filename) {
    // Escape single quotes for the Drive query language.
    const safeName = filename.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const q = encodeURIComponent(`name='${safeName}'`);
    const resp = await this._fetch(
      `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,name,modifiedTime)`
    );
    if (!resp.ok) throw new Error('Could not search Drive: ' + resp.status);
    const data = await resp.json();
    return data.files?.[0]?.id || null;
  },

  async _findOrCreate(filename) {
    const existing = await this._find(filename);
    if (existing) return existing;
    const resp = await this._fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: filename,
        parents: ['appDataFolder']
      })
    });
    if (!resp.ok) throw new Error('Could not create backup file: ' + resp.status);
    const data = await resp.json();
    return data.id;
  },

  // Apply a migrated backup to local state. chapStats merges by taking
  // the higher attempt count per chapter — restoring an older backup
  // can never roll a chapter's lifetime accuracy backwards. Everything
  // else overwrites, because the user explicitly asked to restore.
  _apply(data) {
    if (data.prog) {
      S.prog = data.prog;
      if (!Array.isArray(S.prog.sessions)) S.prog.sessions = [];
      _save(LS.PROG, S.prog);
    }
    if (data.chapStats && typeof data.chapStats === 'object') {
      Object.entries(data.chapStats).forEach(([key, rec]) => {
        const existing = S.chapStats[key];
        if (!existing || (rec.attempted || 0) > (existing.attempted || 0)) {
          S.chapStats[key] = JSON.parse(JSON.stringify(rec));
        }
      });
      _save(LS.CHAPSTATS, S.chapStats);
    }
    if (Array.isArray(data.bk)) { S.bk = data.bk; _save(LS.BK, S.bk); }
    if (Array.isArray(data.fl)) { S.fl = data.fl; _save(LS.FL, S.fl); }
    if (Array.isArray(data.wr)) { S.wr = data.wr; _save(LS.WR, S.wr); }
    if (data.stk && typeof data.stk === 'object') {
      S.stk = data.stk;
      if (!Array.isArray(S.stk.days)) S.stk.days = [];
      _save(LS.STK, S.stk);
    }
    if (data.tt && typeof data.tt === 'object') {
      S.tt = data.tt;
      if (!S.tt.reminders) S.tt.reminders = { enabled: false, leadMinutes: 5 };
      _save(LS.TT, S.tt);
    }

    // Refresh every UI surface that reads the state we replaced.
    try {
      if (typeof HOME !== 'undefined' && HOME.render) HOME.render();
      if (typeof PROG !== 'undefined' && PROG.render) PROG.render();
      if (typeof REV !== 'undefined') {
        REV.renderList('bk'); REV.renderList('fl'); REV.renderList('wr');
      }
      if (typeof TT !== 'undefined' && typeof UI !== 'undefined' && UI.cur === 'timetable') {
        TT.render();
      }
    } catch (e) { /* UI refresh is best-effort */ }
  }
};


/* ═══════════════════════════════════════════════════════════════
   migrateSessionScopes — one-shot backfill for old sessions.
   Called from three places in app.js:
     • APP.init() on every page load
     • PSYNC._pull() after restoring a server backup
     • DATA._applyImport() after importing a manual backup
   Idempotent — only touches sessions that don't already have .lv.
   ═══════════════════════════════════════════════════════════════ */
function migrateSessionScopes() {
  if (!S.prog || !S.prog.sessions) return;
  let changed = false;
  S.prog.sessions.forEach(s => {
    if (s.lv || !s.chapter) return;
    outer:
    for (const lv of ChapterData.levels()) {
      for (const ch of Object.keys(ChapterData.chapters(lv))) {
        for (const book of ChapterData.bookNames(lv, ch)) {
          if (`${ChapterData.chapterName(lv, ch)} — ${book}` === s.chapter) {
            s.lv = lv;
            s.ch = ch;
            s.book = book;
            s.sub = '';
            s.fid = '';
            s.qres = s.qres || [];
            changed = true;
            break outer;
          }
        }
      }
    }
  });
  if (changed) _save(LS.PROG, S.prog);
}


if (typeof window !== 'undefined') {
  window.CLOUD = CLOUD;
  window.migrateSessionScopes = migrateSessionScopes;
}