/* cloud-sync.js — Abhyas Cloud Sync Module
   Provides:
     - CLOUD.backup()       full progress backup to Google Drive
     - CLOUD.restore()      restore from cloud
     - migrateSessionScopes()  one‑time backfill of old sessions
   Must be loaded after app.js (relies on S, _save, toast, QDB, etc.) */

/* ═══════════════ CLOUD MODULE ═══════════════ */
const CLOUD = {
  token: null,

  // Initialise OAuth – this uses the same Google Identity Services as before.
  init() {
    google.accounts.id.initialize({
      client_id: '1069469345191-4qahupbgvg5is8hs4kbmso2qptq3e2nh.apps.googleusercontent.com',
      callback: async (response) => {
        CLOUD.token = response.credential;
        // Try a silent backup to make sure everything is set up
        CLOUD.backup(true);
      },
      scope: 'https://www.googleapis.com/auth/drive.file'
    });
    google.accounts.id.prompt();
  },

  // Finds or creates a file with the given name in the app's Drive folder.
  async _findOrCreate(filename) {
    try {
      const listRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=name='${encodeURIComponent(filename)}'&fields=files(id)&spaces=appDataFolder`,
        { headers: { Authorization: `Bearer ${CLOUD.token}` } }
      );
      const listData = await listRes.json();
      if (listData.files && listData.files.length > 0) {
        return listData.files[0].id;
      }
    } catch (e) { /* fall through to create */ }

    // Create new file
    const createRes = await fetch(
      'https://www.googleapis.com/drive/v3/files',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${CLOUD.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: filename,
          parents: ['appDataFolder']
        })
      }
    );
    const createData = await createRes.json();
    return createData.id;
  },

  /* ── BACKUP: upload full progress to cloud ── */
  backup: async function (silent) {
    if (!CLOUD.token) {
      if (!silent) toast('⚠️ Not signed in – can\'t sync');
      return;
    }
    try {
      const pack = JSON.stringify({
        v: 2,
        ts: Date.now(),
        acc: S.prog.acc,
        sessions: S.prog.sessions.slice(-2000)   // keep last 2000 sessions
      });
      const fname = 'abhyas-backup-' + S.profile.id + '.json';
      let fid = S.cloud.fid;
      if (!fid) fid = await CLOUD._findOrCreate(fname);
      const resp = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files/' + fid +
        '?uploadType=media',
        {
          method: 'PATCH',
          headers: {
            Authorization: 'Bearer ' + CLOUD.token,
            'Content-Type': 'application/json'
          },
          body: pack
        }
      );
      if (resp.ok) {
        S.cloud.fid = fid;
        _save(LS.CLOUD, S.cloud);
        if (!silent) toast('☁️ Progress synced to cloud');
      } else {
        if (!silent) toast('⚠️ Cloud sync failed (server error)');
      }
    } catch (e) {
      if (!silent) toast('⚠️ Cloud sync failed – check connection');
    }
  },

  /* ── RESTORE: pull progress from cloud ── */
  restore: async function () {
    if (!CLOUD.token) {
      toast('⚠️ Not signed in – can\'t restore');
      return false;
    }
    try {
      const fname = 'abhyas-backup-' + S.profile.id + '.json';
      const fid = await CLOUD._findOrCreate(fname);
      const resp = await fetch(
        'https://www.googleapis.com/drive/v3/files/' + fid + '?alt=media',
        { headers: { Authorization: 'Bearer ' + CLOUD.token } }
      );
      if (!resp.ok) throw new Error('Not found');
      const data = await resp.json();
      if (data.v === 1 || data.v === 2) {
        // Merge accuracy and sessions
        Object.assign(S.prog.acc, data.acc || {});
        if (data.sessions) S.prog.sessions = data.sessions;
        _save(LS.PROG, S.prog);
        // Backfill scopes into old sessions
        migrateSessionScopes();
        toast('☁️ Progress restored from cloud');
        return true;
      } else {
        toast('⚠️ Cloud backup is an unknown format');
        return false;
      }
    } catch (e) {
      toast('⚠️ No cloud backup found for this account');
      return false;
    }
  }
};

/* ═══════════════ MIGRATE OLD SESSIONS ═══════════════
   Backfills lv/ch/book onto sessions recorded before this update.
   Idempotent — only runs on sessions that don't already have .lv.
   Called once at boot (from app.js) and after cloud restore. */
function migrateSessionScopes() {
  if (!S.prog || !S.prog.sessions) return;
  let changed = false;
  S.prog.sessions.forEach(s => {
    if (s.lv || !s.chapter) return;  // already tagged or nothing to match
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

// Make CLOUD and migrateSessionScopes globally accessible
window.CLOUD = CLOUD;
window.migrateSessionScopes = migrateSessionScopes;
