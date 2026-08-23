/* cloud-sync.js — Abhyas Cloud Sync Module
   Provides:
     - CLOUD.backup()       full progress backup to Google Drive
     - CLOUD.restore()      restore from cloud
     - migrateSessionScopes()  one‑time backfill of old sessions
   Must be loaded after app.js (relies on S, _save, toast, QDB, etc.) */

/* ═══════════════ CLOUD MODULE ═══════════════ */

// Single source of truth for the CURRENT backup format version — used
// by both backup() (what it writes) and restore()'s migration chain
// (what it upgrades everything else TO). Bumping this when the backup
// shape changes is the only step needed on the "write" side; see
// _backupMigrations below for the "read old formats" side.
const CLOUD_BACKUP_VERSION = 2;

// Migration registry: _backupMigrations[N] transforms a payload FROM
// version N TO version N+1. restore() below walks this chain from
// whatever version a backup says it is up to CLOUD_BACKUP_VERSION,
// applying one transform per step — so adding support for a NEW future
// backup version means adding ONE new entry here (the v(N)->v(N+1)
// transform) and bumping CLOUD_BACKUP_VERSION, with no other changes
// needed. Before this existed, restore() only accepted v:1 or v:2
// (identically — see the v1 entry below, a real no-op since v1 and v2
// backups have always shared the same acc/sessions shape in practice)
// and any other version hit a dead-end "unknown format" toast with no
// way forward.
const _backupMigrations = {
  1: (data) => data // v1 -> v2 is a genuine no-op: same acc/sessions shape
};

// Walks a raw parsed backup payload up to CLOUD_BACKUP_VERSION, or
// returns {ok:false, error} if that's not possible — either because the
// backup is OLDER than any version this app still knows how to migrate
// (a genuine format gap, not expected to ever actually happen given the
// v1 entry above, but the check exists so a future dropped-migration
// fails loudly instead of silently mis-reading old data), or because
// it's NEWER than this app understands (e.g. this device is running a
// stale cached build while a newer one already wrote v3+ backups
// elsewhere) — restoring an unrecognized newer format risks silently
// discarding fields this code doesn't know exist, so this refuses
// rather than guessing.
function _migrateBackupData(data) {
  let v = Number(data.v) || 0;
  if (v < 1) return { ok: false, error: 'Cloud backup is missing a version number — too old or corrupted to restore safely.' };
  if (v > CLOUD_BACKUP_VERSION) {
    return { ok: false, error: `This backup (v${v}) is newer than this app version supports (v${CLOUD_BACKUP_VERSION}) — refresh/update the app before restoring, or you may lose newer data.` };
  }
  while (v < CLOUD_BACKUP_VERSION) {
    const step = _backupMigrations[v];
    if (!step) return { ok: false, error: `No migration path from backup version ${v} to ${CLOUD_BACKUP_VERSION} — this shouldn't happen; please contact support.` };
    data = step(data);
    v++;
    data.v = v;
  }
  return { ok: true, data };
}

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
        v: CLOUD_BACKUP_VERSION,
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
      const rawData = await resp.json();
      const migrated = _migrateBackupData(rawData);
      if (!migrated.ok) {
        toast('⚠️ ' + migrated.error);
        return false;
      }
      const data = migrated.data;
      // Merge accuracy and sessions
      Object.assign(S.prog.acc, data.acc || {});
      if (data.sessions) S.prog.sessions = data.sessions;
      _save(LS.PROG, S.prog);
      // Backfill scopes into old sessions
      migrateSessionScopes();
      toast('☁️ Progress restored from cloud');
      return true;
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
