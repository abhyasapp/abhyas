/* ═══════════════════════════════════════════════════════════════
   APP.JS — Abhyas: Your path to mastery  (V1 – Cloud Sync)
   ═══════════════════════════════════════════════════════════════ */

/* ═══════════════ 1. CONFIG & CONSTANTS ═══════════════ */
const APP_CONFIG = {
  APPS_URL: "https://script.google.com/macros/s/AKfycbyZLZxf6VKNiMfhY6memPTKj-dGW7jxyX1c-9GI0OPG8TqazSZi_P-7Y-8DlpT0ZlrjHg/exec",
};
const APPS = APP_CONFIG.APPS_URL;

const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const BK_TAGS = ['Need Check','Interesting','Debating','Confusing','Formulae'];
const SR_INTERVALS = [1, 3, 7, 14]; // days for spaced repetition

const LS = {
  USER:'abhyas_session',
  PROG:'abhyas_prog', BK:'abhyas_bk', FL:'abhyas_fl', WR:'abhyas_wr',
  QC:'abhyas_qc_', TT:'abhyas_tt', TT_NOTIFIED:'abhyas_tt_notified', STK:'abhyas_stk',
  FORCED_OFFLINE:'abhyas_forced_off',
  EXAM_SNAP:'abhyas_exam_snap',
  FCOUNT:'abhyas_fcount',
  CLOUD:'abhyas_cloud',
  PROFILE:'abhyas_profile'          // stores S.profile (including id)
};

/* APP_VERSION now lives in version.js (loaded before this file) so
   sw.js can derive its cache name from the same single source. */
const APP_NAME = 'Abhyas V1';

/* ═══════════════ 2. APP STATE ═══════════════ */
const S = {
  user: null,
  online: navigator.onLine,
  forcedOffline: _load(LS.FORCED_OFFLINE, false),
  bk: _load(LS.BK, []),
  fl: _load(LS.FL, []),
  wr: _load(LS.WR, []),
  prog: _load(LS.PROG, {total:0,correct:0,sessions:[]}),
  tt: _load(LS.TT, {sessions:[], reminders:{enabled:false, leadMinutes:5}}),
  stk: _load(LS.STK, {days:[],last:''}),
  fcount: _load(LS.FCOUNT, {}),
  dpi: null,
  localQs: null,
  quiz: {qs:[],ans:[],mode:'',idx:0,timer:null,elapsed:0,left:0,active:false,ch:'',scope:null},
  cloud: _load(LS.CLOUD, {fid:''}),
  profile: _load(LS.PROFILE, {ver:1, id:''})   // unique user ID
};
// Existing saved S.tt (from before the reminders feature existed) won't
// have a .reminders field — _load() returns saved data as-is, it doesn't
// deep-merge against the default above. Guard it explicitly rather than
// relying on every reader to optional-chain.
if(!S.tt.reminders) S.tt.reminders = {enabled:false, leadMinutes:5};

/* ═══════════════ 3. UTILITIES ═══════════════ */
function _load(k,d){try{const v=localStorage.getItem(k);return v?JSON.parse(v):d}catch{return d}}
const PSYNC_KEYS = new Set([LS.BK, LS.FL, LS.WR, LS.PROG, LS.STK]);
let _lastStorageWarnAt = 0;
function _save(k,v){
  try{
    localStorage.setItem(k,JSON.stringify(v));
    if(PSYNC_KEYS.has(k)) PSYNC.scheduleSync();
    return true;
  }catch(e){
    // A single quiz session can trigger many _save() calls in quick
    // succession (each answer, each bookmark, progress tracking) — if
    // storage is genuinely full, EVERY one of those would otherwise
    // fire its own toast. Cap it to once every 30s so the user gets
    // told once, not spammed, while the underlying saves keep failing
    // silently in between (same as before — this only changes how
    // often they're told, not whether the save itself succeeds).
    const now = Date.now();
    if(now - _lastStorageWarnAt > 30000){
      _lastStorageWarnAt = now;
      const isQuota = e && (e.name==='QuotaExceededError' || e.code===22 || e.code===1014);
      toast(isQuota
        ? '⚠️ Device storage is full — new progress/bookmarks may not be saved. Try removing some old bookmarks or flagged questions to free space.'
        : '⚠️ Could not save — some data may not have been saved.', 5000);
    }
    return false;
  }
}

/* ── QDB: IndexedDB-backed question-set cache ── */
const QDB = (() => {
  const DB_NAME = 'abhyas_question_cache';
  const STORE = 'sets';
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('IndexedDB not supported')); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function get(key) {
    try {
      const db = await open();
      return await new Promise((resolve, reject) => {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result !== undefined ? req.result : null);
        req.onerror = () => reject(req.error);
      });
    } catch (e) { return null; }
  }

  async function set(key, value) {
    try {
      const db = await open();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      return true;
    } catch (e) {
      toast('⚠️ Storage full — some data not saved');
      return false;
    }
  }

  async function del(key) {
    try {
      const db = await open();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) {}
  }

  async function keys() {
    try {
      const db = await open();
      return await new Promise((resolve, reject) => {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    } catch (e) { return []; }
  }

  async function clear() {
    try {
      const db = await open();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) {}
  }

  async function migrateFromLocalStorage() {
    const oldKeys = Object.keys(localStorage).filter(k => k.startsWith(LS.QC));
    if (!oldKeys.length) return;
    for (const k of oldKeys) {
      try {
        const value = JSON.parse(localStorage.getItem(k));
        await set(k.slice(LS.QC.length), value);
      } catch (e) {}
      localStorage.removeItem(k);
    }
  }

  return { get, set, del, keys, clear, migrateFromLocalStorage };
})();

// esc() now comes from shared.js (loaded before this file in user.html)
function renderMath(el){
  if(!el || typeof window.renderMathInElement !== 'function') return;
  try{
    window.renderMathInElement(el, {
      delimiters: [
        {left:'$$', right:'$$', display:true},
        {left:'$', right:'$', display:false}
      ],
      throwOnError:false
    });
  }catch(e){}
}
function shuf(a){const b=[...a];for(let i=b.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[b[i],b[j]]=[b[j],b[i]]}return b}
function fmt(s){if(s<0)s=0;return`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`}
function today(){return new Date().toISOString().slice(0,10)}
function isOk(sel,cor){
  if(sel===null||sel===undefined||cor===null||cor===undefined)return false;
  const s=String(sel).trim(),c=String(cor).trim();
  return(!isNaN(s)&&!isNaN(c)&&s!==''&&c!=='')?Number(s)===Number(c):s.toLowerCase()===c.toLowerCase();
}
// Resolves a question's raw img/image field — which an uploaded
// question-bank JSON may express as EITHER an embedded base64 data URI
// OR a bare Google Drive reference — into a URL an <img src> can load
// directly, or null if the value is empty/unrecognized.
//
// Deliberately does NOT proxy Drive images through handleGetFile the
// way question-bank JSON files themselves are proxied — that proxy
// exists because a plain drive.google.com link returns an HTML preview
// page to fetch()/JSON.parse(), which doesn't apply to an <img> tag (the
// browser requests it directly as an image, not via our JS). Instead
// this builds a direct drive.google.com/thumbnail URL, which works for
// any file shared "Anyone with the link" — same sharing level
// adminUploadWeeklySetFile and chapters-data.js's own fileIds already
// use — without adding load on the Apps Script backend or eating into
// handleGetFile's rate limit for every single question that has a
// figure.
function _resolveQImg(raw){
  const v = String(raw || '').trim();
  if(!v) return null;
  if(v.startsWith('data:image')) return v; // already embedded base64 — use as-is
  if(/^https?:\/\//.test(v)){
    // Accepts any drive.google.com share-link shape
    // (.../file/d/FILEID/view, ...?id=FILEID, .../open?id=FILEID) and
    // rewrites it to a thumbnail URL; a non-Drive image URL (someone's
    // own CDN link) is passed through unchanged.
    const m = v.match(/\/d\/([a-zA-Z0-9_-]{10,})/) || v.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
    return m ? `https://drive.google.com/thumbnail?id=${m[1]}&sz=w1200` : v;
  }
  // A bare Drive fileId, same shape as every fileId already in
  // chapters-data.js (no slashes, no "data:" prefix — just the id).
  if(/^[a-zA-Z0-9_-]{10,}$/.test(v)) return `https://drive.google.com/thumbnail?id=${v}&sz=w1200`;
  return null; // unrecognized shape — fail quiet rather than render a broken image
}
// Shared <img> markup for a normalized question — used by every place
// a question gets rendered as an HTML string (review lists, exam-mode
// list) so the img/error/lazy-load handling stays in one spot rather
// than copy-pasted at each call site. _renderFlashcard uses its own
// dedicated #fc-img element instead (flashcard mode renders one
// question at a time into fixed DOM nodes, not a fresh template string
// per question), but resolves the same q.img field.
function qImgHtml(q){
  if(!q.img) return '';
  const alt = q.imgCaption || 'Question figure';
  return `<div style="margin:.4rem 0"><img src="${esc(q.img)}" alt="${esc(alt)}" style="max-width:100%;border-radius:8px;border:1px solid var(--b1);display:block" loading="lazy" onerror="this.parentElement.style.display='none'"></div>`;
}
function normQ(raw,fid){
  if(raw && typeof raw === 'object' && !Array.isArray(raw) && raw.success === false){
    console.warn('[normQ] Server error for', fid, '—', raw.error);
    return [];
  }
  let a = Array.isArray(raw) ? raw
        : (raw?.questions || raw?.data || raw?.quiz || raw?.items || raw?.result || null);
  if(!Array.isArray(a) && a === null && raw && typeof raw === 'object'){
    const vals = Object.values(raw);
    if(vals.length && vals[0] && (vals[0].q || vals[0].question || vals[0].Question)){
      a = vals;
    }
  }
  if(!Array.isArray(a)){
    console.warn('[normQ] Unrecognised format for', fid, '— got:', typeof raw, Array.isArray(raw)?'array':JSON.stringify(raw).slice(0,120));
    return [];
  }
  const result = [];
  let skipped = 0;
  a.forEach((q,i)=>{
    if(!q || typeof q !== 'object'){ skipped++; return; }
    const text = q.q || q.question || q.Question || q.stem || q.ques || q.text || '';
    if(!text){ skipped++; return; }
    let options = q.options || q.opts || q.choices || q.Options;
    if(!Array.isArray(options)){
      const lettered = [q.a||q.A, q.b||q.B, q.c||q.C, q.d||q.D, q.e||q.E].filter(x=>x!==undefined && x!==null && x!=='');
      if(lettered.length >= 2) options = lettered;
    }
    if(!Array.isArray(options) || options.length < 2){ skipped++; return; }
    let correct = q.correct !== undefined ? q.correct
                : q.answer  !== undefined ? q.answer
                : q.ans     !== undefined ? q.ans
                : q.Answer  !== undefined ? q.Answer : undefined;
    if(typeof correct === 'string' && /^[a-eA-E]$/.test(correct.trim())){
      correct = 'abcde'.indexOf(correct.trim().toLowerCase());
    }
    result.push({
      q: String(text).trim(),
      options: options.map(String),
      correct,
      explanation: q.explanation||q.explain||q.exp||q.solution||q.hint||'',
      // A question's diagram/figure can arrive two ways from an uploaded
      // question-bank file: already embedded as a base64 data URI
      // (data:image/png;base64,...), or as a bare Google Drive
      // reference (a fileId, or a full drive.google.com share link) —
      // the same two shapes chapters-data.js and now Weekly Sets both
      // accept for question content itself. _resolveQImg normalizes
      // whichever one shows up into something an <img src> can use
      // directly, or null if the field is absent/unrecognized.
      img: _resolveQImg(q.img || q.image || q.Image || q.figure || q.diagram || ''),
      // Optional per-image description, so a screen-reader user gets
      // something meaningful ("Simply supported beam with point load at
      // midspan") instead of the generic "Question figure" fallback.
      // Purely optional — a question-bank file with no caption field
      // still works exactly as before.
      imgCaption: String(q.imgCaption || q.imgAlt || q.figureCaption || q.caption || '').trim(),
      fileId: fid||'local',
      uid: `${fid||'local'}_${i}`
    });
  });
  if(skipped>0) console.warn(`[normQ] ${skipped}/${a.length} questions skipped in ${fid}`);
  if(!result.length) console.warn('[normQ] Zero valid questions from', fid, '— raw sample:', JSON.stringify(a[0]).slice(0,200));
  return result;
}
function toast(msg,dur=3200){
  const c=document.getElementById('toasts');
  if(!c)return;
  const t=document.createElement('div');t.className='toast';t.textContent=msg;
  c.appendChild(t);
  setTimeout(()=>{t.classList.add('out');setTimeout(()=>t.remove(),300)},dur);
}
// Toast with an inline Undo button, for reversible destructive actions
// that don't need a blocking confirm() dialog — e.g. clearAll() below
// applies the change immediately (list feels instantly responsive) and
// gives a 6s window to reverse it, instead of interrupting the flow with
// a modal that has to be dismissed either way. If the toast times out or
// is dismissed without Undo being pressed, onCommit (if given) runs to
// finalize anything that was only staged, not actually applied yet.
function toastUndo(msg, onUndo, dur=6000){
  const c=document.getElementById('toasts');
  if(!c)return;
  const t=document.createElement('div');
  t.className='toast';
  t.style.cssText='display:flex;align-items:center;gap:.6rem';
  const label=document.createElement('span'); label.textContent=msg;
  const btn=document.createElement('button');
  btn.textContent='Undo';
  btn.style.cssText='background:none;border:none;color:var(--amb);font-weight:700;font-size:.76rem;cursor:pointer;padding:.1rem .3rem;flex-shrink:0';
  let undone=false;
  btn.onclick=()=>{
    undone=true;
    onUndo && onUndo();
    t.classList.add('out'); setTimeout(()=>t.remove(),300);
  };
  t.appendChild(label); t.appendChild(btn);
  c.appendChild(t);
  setTimeout(()=>{ if(!undone){ t.classList.add('out'); setTimeout(()=>t.remove(),300); } }, dur);
}
function openMod(title,html){
  document.getElementById('mtitle').textContent=title;
  document.getElementById('mbody').innerHTML=html;
  document.getElementById('mbg').classList.add('show');
}
function closeMod(){document.getElementById('mbg').classList.remove('show')}
function qs(params){return Object.entries(params).map(([k,v])=>`${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}
async function netFetch(url, opts, timeoutMs=20000){
  if(S.forcedOffline) throw new Error('OFFLINE');
  if(!S.online) throw new Error('OFFLINE');
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), timeoutMs);
  try{
    const res = await fetch(url, {...(opts||{}), signal:controller.signal});
    clearTimeout(timer);
    return res;
  }catch(err){
    clearTimeout(timer);
    if(err.name==='AbortError') throw new Error('Request timed out — the server is taking too long. Try again or check your connection.');
    throw err;
  }
}

/* ═══════════════ 3b. NETCHECK — active reachability check ═══════════════ */
const NETCHECK = {
  _timer: null,
  async ping(){
    if(S.forcedOffline) return S.online;
    const wasOnline = S.online;
    S.online = await pingBackend(APPS);
    if(S.online !== wasOnline){ _updateNetBtn(); _updateOfflineWarn(); }
    return S.online;
  },
  start(){
    if(NETCHECK._timer) return;
    NETCHECK._timer = setInterval(()=>NETCHECK.ping(), 15000);
  }
};

/* ═══════════════ 4. AUTH — SESSION GATE ONLY ═══════════════ */
const AUTH = {
  async restore(){
    const u = _load(LS.USER, null);
    if(!u || u.type !== 'user' || !u.username){
      AUTH._bounce();
      return;
    }
    if(S.forcedOffline || !S.online){
      if(AUTH._isValidOffline(u)) AUTH._enter(u);
      else AUTH._bounce();
      return;
    }
    try{
      const { res } = await AUTH._checkSessionOnce(u);
      if(!res.success){
        if(AUTH._isValidOffline(u)) AUTH._enter(u);
        else AUTH._bounce();
        return;
      }
      const updated = AUTH._buildSession(u, res);
      _save(LS.USER, updated);
      if(updated.access.level === 'permanent' || updated.access.level === 'trial'){
        AUTH._enter(updated);
      } else {
        AUTH._bounce();
      }
    }catch{
      if(AUTH._isValidOffline(u)) AUTH._enter(u);
      else AUTH._bounce();
    }
  },
  // Shared by restore() and the periodic recheck below so the
  // checkSession fetch/parse logic lives in exactly one place.
  async _checkSessionOnce(u){
    const r = await netFetch(`${APPS}?${qs({action:'checkSession', token:u.token, username:u.username})}`, {redirect:'follow'});
    const res = await r.json();
    return { res };
  },
  _isValidOffline(u){
    const a = u.access || {};
    if(a.level === 'permanent') return true;
    if(a.level === 'trial' && a.trialExpiresAt) return new Date(a.trialExpiresAt) > Date.now();
    return false;
  },
  _buildSession(prevSession, res){
    const user = res.user || {};
    const access = {
      level: res.permanentAccess || user.status === 'active' ? 'permanent'
             : res.isTrial ? 'trial'
             : res.needsPayment && user.status === 'payment_pending' ? 'pending_review'
             : res.needsPayment ? 'expired'
             : 'unknown',
      trialExpiresAt: res.trialExpiresAt || user.trialExpiresAt,
      permanent: !!(res.permanentAccess || user.status === 'active'),
      accessType: res.accessType || user.accessType || 'permanent',
      accessExpiresAt: res.accessExpiresAt || user.accessExpiresAt || ''
    };
    return {
      ...prevSession,
      username: user.username || prevSession.username,
      name: user.name || prevSession.name,
      email: user.email || prevSession.email,
      mobile: user.mobile || prevSession.mobile,
      access,
      lastVerified: Date.now()
    };
  },
  _bounce(){
    window.location.href = 'index.html';
  },
  _enter(user){
    S.user = user;
    document.getElementById('sg').style.display='none';
    document.getElementById('app').classList.add('on');
    document.getElementById('uchip').textContent = '👤 ' + (user?.name||user?.username||'Student');
    AUTH._updateSidebarCard(user);
    if(!S.online) document.getElementById('offbar').classList.add('show');
    APP.init();
    TUTORIAL.maybeAutoOpen(user);
    PSYNC.pullIfEmpty();
    TT._startReminderChecker();
    if(typeof PUSH!=='undefined') PUSH.silentRefresh();
    WEEKLY.init();
  },
  _updateSidebarCard(user){
    const nameEl = document.getElementById('sb-uname');
    const statusEl = document.getElementById('sb-ustatus');
    if(nameEl) nameEl.textContent = user?.name || user?.username || 'Student';
    if(statusEl){
      const a = user?.access || {};
      if(a.level==='permanent' && a.accessType==='yearly'){
        statusEl.textContent = a.accessExpiresAt ? `📅 Access until ${new Date(a.accessExpiresAt).toLocaleDateString()}` : '📅 Yearly access';
      } else if(a.level==='permanent'){
        statusEl.textContent = '✅ Permanent access';
      } else if(a.level==='trial'){
        statusEl.textContent = a.trialExpiresAt ? `⏳ Trial until ${new Date(a.trialExpiresAt).toLocaleString()}` : '⏳ Trial access';
      } else {
        statusEl.textContent = '—';
      }
    }
  },
  logout(){
    if(!confirm('Log out?'))return;
    localStorage.removeItem(LS.USER);
    window.location.href = 'index.html';
  },
  _revalidateTimer:null,
  _visibilityBound:false,
  RECHECK_MS: 10*60*1000,
  startPeriodicRecheck(){
    if(AUTH._revalidateTimer) clearInterval(AUTH._revalidateTimer);
    AUTH._revalidateTimer = setInterval(()=>AUTH._periodicRecheckTick(), AUTH.RECHECK_MS);
    // Skip ticks while the tab is backgrounded (no point spending Apps
    // Script quota on a session the person isn't looking at), but catch
    // up immediately when they come back if it's been a while — rather
    // than silently waiting out the rest of a 10-minute timer.
    if(!AUTH._visibilityBound){
      AUTH._visibilityBound = true;
      document.addEventListener('visibilitychange', ()=>{
        if(document.visibilityState === 'visible' && S.user){
          const last = S.user.lastVerified || 0;
          if(Date.now() - last > AUTH.RECHECK_MS) AUTH._periodicRecheckTick();
        }
      });
    }
  },
  async _periodicRecheckTick(){
    if(document.visibilityState === 'hidden') return;
    if(!S.online || S.forcedOffline || !S.user) return;
    try{
      const { res } = await AUTH._checkSessionOnce(S.user);
      if(res.success){
        const updated = AUTH._buildSession(S.user, res);
        _save(LS.USER, updated);
        if(updated.access.level === 'permanent' || updated.access.level === 'trial'){
          S.user = updated;
        } else {
          AUTH._bounce();
        }
      }
    }catch(e){ console.warn('[AUTH] periodic session recheck failed, will retry next interval:', e); }
  }
};

/* ═══════════════ 4b. PSYNC — background progress backup ═══════════════ */
const PSYNC = {
  _timer: null,
  // 'idle' | 'pending' | 'syncing' | 'synced' | 'error' — drives the small
  // dot on the topbar (#tb-sync) so a student can tell at a glance whether
  // their progress is actually saved, without opening the Settings panel
  // where PSYNC's original text-only status line lives. That line (below,
  // via #psync-status) still updates too — this just makes the same state
  // visible from every screen, not only Settings.
  _state: 'idle',
  _setStatus(msg){
    const el = document.getElementById('psync-status');
    if(el) el.textContent = msg;
  },
  _setState(state){
    this._state = state;
    const dot = document.getElementById('tb-sync-dot');
    const btn = document.getElementById('tb-sync-btn');
    if(!dot || !btn) return;
    const cfg = {
      idle:    {color:'var(--t3)', title:'Not synced yet this session', anim:false},
      pending: {color:'var(--amb)', title:'Sync pending…',              anim:false},
      syncing: {color:'var(--sky)', title:'Syncing…',           anim:true},
      synced:  {color:'var(--grn)', title:'Progress backed up',         anim:false},
      error:   {color:'var(--ros)', title:'Sync failed — will retry', anim:false}
    }[state] || {color:'var(--t3)', title:'', anim:false};
    dot.style.background = cfg.color;
    dot.style.animation = cfg.anim ? 'pulse 1s ease-in-out infinite' : 'none';
    btn.title = 'Sync status — ' + cfg.title;
    btn.setAttribute('aria-label', btn.title);
  },
  scheduleSync(){
    if(!S.user || !S.user.token) return;
    this._setState('pending');
    clearTimeout(this._timer);
    this._timer = setTimeout(()=>this.pushNow(), 8000);
  },
  async pushNow(){
    if(!S.online || !S.user || !S.user.token) return;
    this._setState('syncing');
    const payload = JSON.stringify({prog:S.prog, bk:S.bk, fl:S.fl, wr:S.wr, stk:S.stk});
    try{
      const r = await netFetch(APPS, {
        method:'POST',
        headers:{'Content-Type':'text/plain'},
        body: JSON.stringify({action:'saveProgress', username:S.user.username, token:S.user.token, data:payload})
      }, 15000);
      const res = await r.json();
      if(res && res.success){ this._setStatus('Last backed up: ' + new Date().toLocaleString()); this._setState('synced'); }
      else { this._setStatus('Backup failed — will retry automatically.'); this._setState('error'); }
    }catch(e){ this._setStatus('Backup failed (offline?) — will retry automatically.'); this._setState('error'); }
  },
  async pullIfEmpty(){
    if(!S.online || !S.user || !S.user.token) return;
    const looksEmpty = (!S.prog || !S.prog.sessions || !S.prog.sessions.length)
      && (!S.bk || !S.bk.length) && (!S.fl || !S.fl.length) && (!S.wr || !S.wr.length);
    if(!looksEmpty) return;
    await this._pull(false);
  },
  async forceRestore(){
    if(!S.online || !S.user || !S.user.token){ toast('❌ Need internet to restore'); return; }
    await this._pull(true);
  },
  async _pull(force){
    try{
      const r = await netFetch(`${APPS}?${qs({action:'getProgress', username:S.user.username, token:S.user.token})}`, {redirect:'follow'}, 15000);
      const res = await r.json();
      if(!res.success || !res.data){
        if(force) toast('ℹ️ No cloud backup found for this account yet.');
        return;
      }
      const data = JSON.parse(res.data);
      if(data.prog){ S.prog=data.prog; if(typeof migrateSessionScopes === 'function') migrateSessionScopes(); _save(LS.PROG,S.prog); }
      if(data.bk){ S.bk=data.bk; _save(LS.BK,S.bk); }
      if(data.fl){ S.fl=data.fl; _save(LS.FL,S.fl); }
      if(data.wr){ S.wr=data.wr; _save(LS.WR,S.wr); }
      if(data.stk){ S.stk=data.stk; _save(LS.STK,S.stk); }
      toast('☁️ Restored your progress from a previous device');
      this._setStatus('Restored from cloud: ' + (res.updatedAt ? new Date(res.updatedAt).toLocaleString() : new Date().toLocaleString()));
      if(typeof HOME!=='undefined') HOME.render();
      if(typeof PROG!=='undefined') PROG.render();
    }catch(e){
      if(force) toast('❌ Restore failed — check your connection and try again.');
    }
  }
};

/* ═══════════════ 4c. PUSH — Firebase Cloud Messaging notifications ═══════
   Deliberately opt-in via a button (Settings → "Enable Notifications"),
   never an automatic permission prompt on load — an unsolicited browser
   permission popup on first visit is one of the most reliable ways to
   make a new visitor bounce, before they've even seen what the app does.
   See firebase-config.js for the one-time setup this depends on; every
   method below no-ops safely (with a clear toast) if that hasn't been
   done yet, rather than throwing on Firebase rejecting a placeholder
   config. ═══════════════════════════════════════════════════════════ */
const PUSH = {
  _messaging: null,

  supported(){
    return typeof FIREBASE_CONFIGURED !== 'undefined' && FIREBASE_CONFIGURED
      && 'Notification' in window && 'serviceWorker' in navigator
      && typeof firebase !== 'undefined';
  },

  // Reflects current state in the Settings UI: 'unsupported' (browser or
  // config doesn't allow it at all) | 'denied' (user said no — button
  // should explain they need to re-enable via browser site settings,
  // since JS can't re-prompt once denied) | 'granted' | 'default' (never
  // asked yet).
  status(){
    if(!this.supported()) return 'unsupported';
    return Notification.permission; // 'default' | 'granted' | 'denied'
  },

  async enable(){
    if(!this.supported()){
      toast('❌ Notifications need setup on the backend first — ask your admin.');
      return;
    }
    if(Notification.permission === 'denied'){
      toast('🔕 Notifications are blocked for this site — enable them in your browser\'s site settings, then try again.');
      return;
    }
    try{
      const permission = await Notification.requestPermission();
      if(permission !== 'granted'){ toast('Notifications not enabled.'); return; }

      if(!this._messaging){
        firebase.initializeApp(FIREBASE_CONFIG);
        this._messaging = firebase.messaging();
      }
      const reg = await navigator.serviceWorker.ready;
      const token = await this._messaging.getToken({ vapidKey: FIREBASE_VAPID_KEY, serviceWorkerRegistration: reg });
      if(!token){ toast('❌ Could not get a notification token — try again.'); return; }

      if(!S.user || !S.user.token){ toast('✅ Notifications enabled — will sync once you\'re logged in.'); return; }
      const r = await netFetch(APPS, {
        method:'POST',
        headers:{'Content-Type':'text/plain'},
        body: JSON.stringify({action:'savePushToken', username:S.user.username, token:S.user.token, fcmToken:token})
      }, 15000);
      const res = await r.json();
      if(res && res.success) toast('🔔 Notifications enabled');
      else toast('⚠️ Enabled locally, but couldn\'t sync to your account — try again while online.');
    }catch(e){
      toast('❌ Could not enable notifications: ' + (e.message||e));
    }
  },

  // Runs quietly on every load for an already-granted, already-logged-in
  // user — refreshes the stored token in case it rotated (browsers do
  // this periodically), without re-prompting for permission.
  async silentRefresh(){
    if(!this.supported() || Notification.permission !== 'granted') return;
    if(!S.user || !S.user.token) return;
    try{
      if(!this._messaging){
        firebase.initializeApp(FIREBASE_CONFIG);
        this._messaging = firebase.messaging();
      }
      const reg = await navigator.serviceWorker.ready;
      const token = await this._messaging.getToken({ vapidKey: FIREBASE_VAPID_KEY, serviceWorkerRegistration: reg });
      if(!token) return;
      await netFetch(APPS, {
        method:'POST',
        headers:{'Content-Type':'text/plain'},
        body: JSON.stringify({action:'savePushToken', username:S.user.username, token:S.user.token, fcmToken:token})
      }, 15000);
    }catch(e){ /* best-effort — a failed silent refresh isn't worth bothering the user about */ }
  },

  // Reflects current permission state on the Settings button — called
  // whenever the Progress/Settings view is opened (see UI._goRaw above)
  // so it's never stale if the person changed the browser's site
  // permission since their last visit to this screen.
  refreshButtonUI(){
    const btn = document.getElementById('push-enable-btn');
    const desc = document.getElementById('push-status-desc');
    if(!btn || !desc) return;
    const state = this.status();
    if(state === 'unsupported'){
      btn.style.display = 'none';
      desc.textContent = 'Notifications aren\'t set up for this deployment yet.';
    } else if(state === 'granted'){
      btn.innerHTML = '<i class="ph ph-bell-ringing"></i> Notifications Enabled';
      btn.disabled = true;
      btn.style.opacity = '.7';
      desc.textContent = 'You\'ll be notified about trial expiry and payment status, even when the app is closed.';
    } else if(state === 'denied'){
      btn.innerHTML = '<i class="ph ph-bell-slash"></i> Blocked — check browser settings';
      desc.textContent = 'Notifications are blocked for this site. Enable them in your browser\'s site settings, then reload.';
    } else {
      btn.innerHTML = '<i class="ph ph-bell"></i> Enable Notifications';
      btn.disabled = false;
      btn.style.opacity = '1';
    }
  }
};

/* ═══════════════ 5. PWA ═══════════════ */
const PWA = {
  init(){
    window.addEventListener('beforeinstallprompt', e=>{
      e.preventDefault(); S.dpi=e;
      const btn=document.getElementById('installBtn');
      if(btn){ btn.style.display=''; btn.title='Install App'; }
      PWA._showInstallBanner();
    });
    window.addEventListener('appinstalled', ()=>{
      S.dpi=null;
      toast('📲 App installed!');
      const btn=document.getElementById('installBtn');
      if(btn) btn.style.display='none';
      const bar=document.getElementById('pwa-install-banner');
      if(bar) bar.remove();
    });
    if('serviceWorker' in navigator){
      navigator.serviceWorker.register('./sw.js', {scope:'./'}).catch(()=>{});
    }
  },
  // One-tap install banner shown the moment the browser offers it,
  // instead of only a small toolbar icon a student might not notice.
  // Was previously duplicated in user.html's own inline script with a
  // SEPARATE window._dpi variable tracking the same event as S.dpi
  // here — the two only stayed in sync because both listeners always
  // fired together off the same native event; the moment one consumed
  // its copy without the other knowing, the unconsumed one would hold
  // a stale, already-used prompt that throws if ever called. Moved
  // here so S.dpi is the only place this state lives.
  _showInstallBanner(){
    if(document.getElementById('pwa-install-banner')) return;
    const bar = document.createElement('div');
    bar.id = 'pwa-install-banner';
    bar.style.cssText = 'position:fixed;left:.75rem;right:.75rem;bottom:calc(var(--bn-h,0px) + .75rem + var(--safe-b,0px));background:var(--c2);border:1px solid var(--bd);border-radius:var(--r2);padding:.7rem .9rem;display:flex;align-items:center;gap:.6rem;z-index:9997;box-shadow:var(--sh3)';
    bar.innerHTML = `
      <div style="font-size:1.3rem"><i class="ph ph-device-mobile"></i></div>
      <div style="flex:1;font-size:.76rem;color:var(--t2);line-height:1.3">Install this app for faster, offline access</div>
      <button id="pwa-install-go" style="padding:.4rem .75rem;background:linear-gradient(135deg,var(--amb2),var(--amb));border:none;border-radius:var(--r1);color:var(--on-accent,#0F0A00);font-weight:700;font-size:.76rem;cursor:pointer;font-family:var(--ff)">Install</button>
      <button id="pwa-install-x" aria-label="Dismiss install prompt" style="background:none;border:none;color:var(--t3);font-size:.9rem;cursor:pointer;padding:.2rem"><i class="ph ph-x"></i></button>
    `;
    document.body.appendChild(bar);
    document.getElementById('pwa-install-go').onclick = ()=> { PWA.install(); bar.remove(); };
    document.getElementById('pwa-install-x').onclick = ()=> bar.remove();
  },
  install(){
    if(S.dpi){ S.dpi.prompt(); S.dpi.userChoice.then(()=>{ S.dpi=null; }); const b=document.getElementById('installBtn'); if(b) b.style.display='none'; }
    else toast('Install option not available — try your browser\'s "Add to Home Screen" menu.');
  },
  toggleFullscreen(){
    if(!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(()=>toast('Fullscreen not supported here'));
    else document.exitFullscreen?.();
  }
};

/* ═══════════════ 5b. WEEKLY SETS ═══════════════
   Fetches the admin-scheduled weekly sets and does two things with
   them: (1) merges every RELEASED one into ChapterData under the
   existing "old_question" level (CH_NAMES.old_question / DRIVE.old_question
   were already present as an empty "Old Questions / Sets" slot before
   this feature existed) so it becomes a normal, permanent part of the
   Online Study chapter picker forever — reachable the exact same way
   as any chapters-data.js file, with no separate "weekly" concept the
   student has to remember once it's live; and (2) renders a compact
   card list (locked-with-countdown / unlocked-with-open-button) so
   there's still a direct, visible place to see what's new and what's
   still to come, without having to already know to look under
   "Old Questions / Sets" for it. */
const WEEKLY = {
  sets: [],

  async init(){
    if(!S.online || S.forcedOffline) return; // nothing new to merge while offline — cached merges from the last online session (if any) remain in memory for this tab
    try{
      const r = await netFetch(`${APPS}?${qs({action:'listWeeklySets', username:S.user.username, token:S.user.token})}`, {redirect:'follow'}, 15000);
      const res = await r.json();
      if(!res.success) return;
      this.sets = res.sets || [];
      this._mergeIntoChapterData();
      this._renderHomeCard();
    }catch(e){ /* best-effort — Online Study still works normally from chapters-data.js alone if this fails */ }
  },

  // Injects every released set as one subtopic under a single standing
  // "Weekly Sets" chapter inside the old_question level. Re-running this
  // (e.g. on a later WEEKLY.init() this same session) safely overwrites
  // rather than duplicates, since it rebuilds the whole subtopic map
  // from the latest server response each time.
  _mergeIntoChapterData(){
    const released = this.sets.filter(s=>s.released && s.fileId);
    if(!released.length) return;
    CH_NAMES.old_question = CH_NAMES.old_question || {};
    DRIVE.old_question = DRIVE.old_question || {};
    CH_NAMES.old_question['weekly'] = 'Weekly Sets';
    const subtopics = {};
    released.forEach(s=>{
      // Two sets can share a title (e.g. an admin re-uses "Week 12" after
      // editing) — suffix with a short id fragment on collision so both
      // stay individually selectable instead of one silently overwriting
      // the other in this subtopic map.
      let label = s.title || 'Untitled Set';
      if(subtopics[label] !== undefined) label = `${label} (${String(s.id).slice(0,4)})`;
      subtopics[label] = s.fileId;
    });
    DRIVE.old_question['weekly'] = { 'Weekly Sets': subtopics };
  },

  _renderHomeCard(){
    const outer = document.getElementById('weekly-sets-outer');
    const box = document.getElementById('weekly-sets-card');
    if(!box || !outer) return;
    if(!this.sets.length){ outer.style.display = 'none'; box.innerHTML = ''; return; }
    outer.style.display = '';
    box.innerHTML = this.sets.map(s=>{
      if(s.released){
        return `<div class="qb-btn ok" style="cursor:pointer;width:100%;justify-content:flex-start" onclick="WEEKLY.open('${esc(s.id)}')">
          <i class="ph ph-check-circle"></i> ${esc(s.title)}${s.chapterLabel?` <span style="opacity:.6">— ${esc(s.chapterLabel)}</span>`:''}
        </div>`;
      }
      const when = s.releaseAt ? new Date(s.releaseAt) : null;
      const whenTxt = when ? when.toLocaleString([], {weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit'}) : 'soon';
      return `<div class="qb-btn" style="width:100%;justify-content:flex-start;opacity:.6;cursor:default">
        <i class="ph ph-lock-simple"></i> ${esc(s.title)} <span style="opacity:.7">— unlocks ${whenTxt}</span>
      </div>`;
    }).join('');
  },

  open(id){
    const s = this.sets.find(x=>x.id===id);
    if(!s || !s.released || !s.fileId){ toast('Not unlocked yet.'); return; }
    QUIZ.load(s.fileId, `weekly_${s.id}`, 'exam', s.title, null);
  }
};

/* ═══════════════ 6. UI ═══════════════ */
const UI = {
  cur: 'home',
  _goRaw(v){
    document.getElementById('quiz-wrap').style.display='none';
    document.querySelectorAll('.view').forEach(e=>e.classList.remove('on'));
    const el=document.getElementById('view-'+v);
    if(el)el.classList.add('on');
    document.querySelectorAll('.sb-item').forEach(e=>e.classList.remove('active'));
    const ni=document.getElementById('nav-'+v);
    if(ni)ni.classList.add('active');
    UI.cur=v;UI.sidebarClose();window.scrollTo(0,0);
    ({
      home:()=>HOME.render(),
      progress:()=>{ PROG.render(); if(typeof PUSH!=='undefined') PUSH.refreshButtonUI(); },
      online:()=>ONPROG.render(),
      offline:()=>CACHE.render(),
      bookmarks:()=>REV.renderList('bk'),
      flagged:()=>REV.renderList('fl'),
      wrong:()=>REV.renderList('wr'),
      timetable:()=>TT.render(),
      psycho:()=>PSY.init()
    })[v]?.();
  },
  go(v){
    if(S.quiz.active && document.getElementById('quiz-wrap').style.display !== 'none'){
      QUIZ._exitGuard(()=>UI._goRaw(v));
      return;
    }
    UI._goRaw(v);
  },
  sidebarToggle(){
    document.getElementById('sb').classList.toggle('open');
    document.getElementById('ov').classList.toggle('show');
  },
  sidebarClose(){
    document.getElementById('sb').classList.remove('open');
    document.getElementById('ov').classList.remove('show');
  },
  theme(){
    // Default theme is now the light fintech design (no class needed —
    // see :root in user.html). The original dark-navy theme is the
    // opt-in, applied via body.dark.
    document.body.classList.toggle('dark');
    _save('abhyas_theme', document.body.classList.contains('dark')?'dark':'light');
  }
};

/* ═══════════════ 7b. ONLINE STUDY ═══════════════ */
const ON = {
  onLv(){
    const lv=document.getElementById('on-lv').value;
    const cs=document.getElementById('on-ch');
    cs.innerHTML='<option value="">📘 Select Chapter…</option>';cs.disabled=!lv;
    const bs=document.getElementById('on-bk');bs.innerHTML='<option value="">📚 Select Book…</option>';bs.disabled=true;
    const ts=document.getElementById('on-to');ts.innerHTML='<option value="">📑 Select Subtopic…</option>';ts.disabled=true;
    if(lv){
      Object.entries(ChapterData.chapters(lv)).forEach(([k,n])=>{
        const fc=ChapterData.fileCount(lv,k);
        const o=document.createElement('option');o.value=k;o.textContent=`Ch${k}: ${n}${fc?'':' (coming soon)'}`;cs.appendChild(o);
      });
    }
    ONPROG.render();
  },
  onCh(){
    const lv=document.getElementById('on-lv').value,ch=document.getElementById('on-ch').value;
    const bs=document.getElementById('on-bk');
    bs.innerHTML='<option value="">📚 Select Book…</option>';bs.disabled=true;
    const ts=document.getElementById('on-to');ts.innerHTML='<option value="">📑 Select Subtopic…</option>';ts.disabled=true;
    if(lv&&ch){
      const books=ChapterData.books(lv,ch);
      if(!Object.keys(books).length){
        bs.innerHTML='<option value="">No books yet for this chapter</option>';
        toast('ℹ️ This chapter has no question files yet');
      } else {
        Object.keys(books).forEach(book=>{
          const fc=ChapterData.fileCount(lv,ch,book);
          const o=document.createElement('option');o.value=book;o.textContent=`${book}${fc?'':' (coming soon)'}`;bs.appendChild(o);
        });
        bs.disabled=false;
      }
    }
    ONPROG.render();
  },
  async onBook(){
    const lv=document.getElementById('on-lv').value,ch=document.getElementById('on-ch').value,book=document.getElementById('on-bk').value;
    const ts=document.getElementById('on-to');
    ts.innerHTML='<option value="">📑 Select Subtopic…</option>';ts.disabled=true;
    if(lv&&ch&&book){
      const files=ChapterData.files(lv,ch,book);
      if(!Object.keys(files).length){
        ts.innerHTML='<option value="">No files yet for this book</option>';
        toast('ℹ️ This book has no question files yet');
      } else {
        const isOfflineMode = !S.online || S.forcedOffline;
        const cachedKeys = new Set(await QDB.keys());
        let anyEnabled = false;
        Object.entries(files).forEach(([n,id])=>{
          if(!id)return;
          const cacheKey = `${lv}_${ch}_${book}_${n}`;
          const isCached = cachedKeys.has(cacheKey);
          const o=document.createElement('option');
          o.value=id;
          o.dataset.key=cacheKey;
          o.dataset.sub=n;
          if(isOfflineMode && !isCached){
            o.textContent = `🔒 ${n} (not cached)`;
            o.disabled = true;
            o.style.color = 'var(--t3)';
          } else {
            o.textContent = isCached ? `📦 ${n}` : n;
            anyEnabled = true;
          }
          ts.appendChild(o);
        });
        ts.disabled=false;
        if(isOfflineMode && !anyEnabled){
          ts.innerHTML='<option value="">No cached files for this book</option>';
          toast('📡 You\'re offline — no cached files in this book. Cache them first while online.');
        }
      }
    }
    ONPROG.render();
  },
  start(mode){
    const ts=document.getElementById('on-to');
    const fid=ts.value,opt=ts.options[ts.selectedIndex],key=opt?.dataset?.key;
    const ch=document.getElementById('on-ch').value,lv=document.getElementById('on-lv').value,book=document.getElementById('on-bk').value;
    if(!fid||!key){toast('Select a subtopic');return}
    const sub=opt?.dataset?.sub||'';
    const name=`${ChapterData.chapterName(lv,ch)} — ${book}`;
    QUIZ.load(fid,key,mode,name,{lv,ch,book,sub,fid});
  }
};

/* ═══════════════ 7c. LOCAL FILE ═══════════════ */
const LOC = {
  onFile(){
    const f=document.getElementById('loc-file').files[0];if(!f)return;
    const nameEl=document.getElementById('loc-file-name');
    if(nameEl) nameEl.textContent=f.name;
    const r=new FileReader();
    r.onload=e=>{
      try{
        const qs2=normQ(JSON.parse(e.target.result),'local');
        if(!qs2.length){toast('❌ No valid questions found in file');return}
        S.localQs=qs2;
        const info=document.getElementById('loc-info');
        info.style.display='';info.textContent=`✅ ${qs2.length} questions loaded from "${f.name}"`;
        document.getElementById('loc-pr').disabled=false;
        document.getElementById('loc-ex').disabled=false;
        toast(`✅ ${qs2.length} questions ready`);
      }catch{toast('❌ Invalid JSON file')}
    };
    r.onerror=()=>toast('❌ Could not read file');
    r.readAsText(f);
  },
  start(mode){
    if(!S.localQs){toast('Load a JSON file first');return}
    QUIZ.startWith([...S.localQs],mode,'Local File');
  }
};

/* ═══════════════ 7d. PSYCHO MODE ═══════════════ */
const PSY = {
  LEVELS:[['level5','Level 5 — Diploma'],['level7','Level 7 — Civil Engineering'],['gk','General Knowledge']],
  init(){
    const box=document.getElementById('psy-levels');
    box.innerHTML = PSY.LEVELS.map(([lv,label])=>{
      const names=ChapterData.chapters(lv);
      const items=Object.entries(names).map(([k,n])=>{
        const fc=ChapterData.fileCount(lv,k);
        return `<div class="ch-item" onclick="this.querySelector('input').click()">
          <input type="checkbox" value="${k}" data-lv="${lv}" ${fc?'':'disabled'} onclick="event.stopPropagation();PSY._info()">
          <div class="ch-num">${k}</div>
          <div class="ch-name">${n}${fc?'':' <span style=\"color:var(--t3)\">(no files)</span>'}</div>
          <div class="ch-cnt">${fc}f</div>
        </div>`;
      }).join('');
      return `<div class="sb-lbl" style="margin-top:.7rem;display:flex;align-items:center;justify-content:space-between;padding-right:.2rem">
          <span>${label}</span>
          <span style="display:flex;gap:.3rem">
            <button class="btn btn-sm btn-c" style="font-size:.56rem;padding:.15rem .4rem" onclick="PSY.allLv('${lv}')"><i class="ph ph-check"></i> All</button>
            <button class="btn btn-sm btn-r" style="font-size:.56rem;padding:.15rem .4rem" onclick="PSY.noneLv('${lv}')">✕</button>
          </span>
        </div>
        <div class="ch-list" id="psy-lv-${lv}">${items || '<div class="empty"><div class="empty-i"><i class="ph ph-book-open"></i></div><p>No chapters yet</p></div>'}</div>`;
    }).join('');
    PSY._info();
  },
  all(){document.querySelectorAll('#psy-levels input:not(:disabled)').forEach(c=>c.checked=true);PSY._info()},
  none(){document.querySelectorAll('#psy-levels input').forEach(c=>c.checked=false);PSY._info()},
  allLv(lv){document.querySelectorAll(`#psy-lv-${lv} input:not(:disabled)`).forEach(c=>c.checked=true);PSY._info()},
  noneLv(lv){document.querySelectorAll(`#psy-lv-${lv} input`).forEach(c=>c.checked=false);PSY._info()},
  _info(){
    const n=document.querySelectorAll('#psy-levels input:checked').length;
    document.getElementById('psy-info').textContent=n?`${n} chapter${n>1?'s':''} selected — ready to load`:'Select at least 1 chapter to continue';
  },
  async start(type){
    const cbs=[...document.querySelectorAll('#psy-levels input:checked')];
    if(!cbs.length){toast('Select at least one chapter');return}
    const totalFiles = cbs.reduce((n,cb)=>n+ChapterData.chapterFileRefs(cb.dataset.lv,cb.value).length,0);
    QUIZ._showLoader(`Loading ${cbs.length} chapter${cbs.length>1?'s':''} (0/${totalFiles})…`);
    const all=[];
    let done=0,failed=0;
    for(const cb of cbs){
      const lv=cb.dataset.lv;
      const ch=cb.value;
      for(const ref of ChapterData.chapterFileRefs(lv,ch)){
        try{
          const raw=await QUIZ._fetch(ref.fid,ref.key);
          all.push(...normQ(raw,ref.fid));
          done++;
          document.getElementById('quiz-loader-msg').textContent=`Loading files (${done}/${totalFiles})…`;
        }catch{ failed++; }
      }
    }
    QUIZ._hideLoader();
    if(!all.length){toast('❌ No questions loaded. Cache data first if offline.',5000);return}
    if(failed>0) toast(`⚠️ ${failed} file${failed>1?'s':''} failed to load — starting with ${all.length} questions`);
    let qsArr=shuf(all);
    if(type==='exam')qsArr=qsArr.slice(0,100);
    if(type==='weak'){
      const wu=new Set(S.wr.map(w=>w.uid));
      const weak=qsArr.filter(q=>wu.has(q.uid));
      qsArr=weak.length?weak:qsArr.slice(0,50);
      if(!weak.length)toast('ℹ️ No wrong answers yet — showing 50 random instead');
    }
    QUIZ.startWith(qsArr,type==='exam'?'exam':'flashcard','⚡ Psycho Mode');
  }
};

/* ═══════════════ 8. REVIEW LISTS (bookmarks / flagged / wrong) ═══════════════ */
const REV = {
  _store(kind){ return kind==='bk'?S.bk : kind==='fl'?S.fl : S.wr; },
  _lsKey(kind){ return kind==='bk'?LS.BK : kind==='fl'?LS.FL : LS.WR; },
  _listEl(kind){ return kind==='bk'?'bk-list' : kind==='fl'?'fl-list' : 'wr-list'; },

  // Bookmarks/flags/wrong-answer-bank are persisted to localStorage
  // (5-10MB quota, shared across the whole app), NOT IndexedDB (where
  // the actual question cache lives, with a much higher limit) — so
  // storing a full question snapshot here is fine for text, but an
  // embedded base64 img field can easily be 100-300KB PER QUESTION.
  // A handful of bookmarked image-heavy questions could exhaust the
  // entire localStorage quota on their own. The image itself isn't
  // needed to review a bookmarked/flagged/missed question's text and
  // options, so it's dropped here rather than duplicated — this is
  // the single highest-leverage fix for localStorage quota pressure,
  // since every other locally-stored array (sessions, timetable, etc.)
  // is already small and bounded.
  _stripHeavy(q){
    if(!q || !q.img) return q;
    const {img, imgCaption, ...rest} = q;
    return rest;
  },

  toggle(kind, question){
    const arr = REV._store(kind);
    const i = arr.findIndex(x=>x.uid===question.uid);
    if(i>-1){ arr.splice(i,1); toast(kind==='bk'?'⭐ Removed bookmark':'🚩 Removed flag'); }
    else { arr.push(kind==='bk' ? {...REV._stripHeavy(question), tag:''} : REV._stripHeavy(question)); toast(kind==='bk'?'⭐ Bookmarked':'🚩 Flagged'); }
    _save(REV._lsKey(kind), arr);
    HOME.updateBadges();
    return i===-1;
  },
  has(kind, uid){ return REV._store(kind).some(x=>x.uid===uid); },
  getTag(uid){ return S.bk.find(x=>x.uid===uid)?.tag || ''; },
  setTag(uid, tag, questionObj){
    let item = S.bk.find(x=>x.uid===uid);
    if(!item && questionObj){ item = {...REV._stripHeavy(questionObj), tag: ''}; S.bk.push(item); }
    if(!item) return;
    item.tag = tag;
    _save(LS.BK, S.bk);
    REV.renderList('bk');
    HOME.updateBadges?.();
  },

  addWrong(question){
    const existing = S.wr.find(x=>x.uid===question.uid);
    if(existing){ existing._streak = 0; existing._nextDue = Date.now(); _save(LS.WR, S.wr); HOME.updateBadges(); return; }
    S.wr.push({...REV._stripHeavy(question), _streak:0, _nextDue: Date.now()});
    _save(LS.WR, S.wr);
    HOME.updateBadges();
  },
  removeWrong(uid){
    const i=S.wr.findIndex(x=>x.uid===uid);
    if(i>-1){ S.wr.splice(i,1); _save(LS.WR, S.wr); HOME.updateBadges(); }
  },
  trackAnswer(question, isCorrect){
    if(isCorrect){
      const item = S.wr.find(x=>x.uid===question.uid);
      if(!item) return;
      item._streak = (item._streak||0) + 1;
      if(item._streak >= SR_INTERVALS.length){ REV.removeWrong(question.uid); }
      else {
        const days = SR_INTERVALS[item._streak - 1];
        item._nextDue = Date.now() + days*24*60*60*1000;
        _save(LS.WR, S.wr);
      }
    } else {
      REV.addWrong(question);
    }
  },
  dueWrong(){ return S.wr.filter(x => (x._nextDue==null) || x._nextDue <= Date.now()); },
  dueCount(){ return REV.dueWrong().length; },

  renderList(kind){
    let arr = REV._store(kind);
    const el = document.getElementById(REV._listEl(kind));
    if(!el)return;
    if(!arr.length){
      const copy = kind==='bk'
        ? { i:'<i class="ph ph-star"></i>', t:'No bookmarks yet', s:'Tap the star on any question while studying to save it here.' }
        : kind==='fl'
        ? { i:'<i class="ph ph-flag"></i>', t:'No flagged questions yet', s:'Tap the flag on a question you want to come back to.' }
        : { i:'<i class="ph ph-x-circle"></i>', t:'No wrong answers yet', s:'Questions you miss land here automatically, ready for spaced review.' };
      el.innerHTML = `<div class="empty"><div class="empty-i">${copy.i}</div><p>${copy.t}</p><p style="font-size:.72rem;color:var(--t3);margin-top:.15rem">${copy.s}</p></div>`;
      return;
    }
    if(kind==='wr'){
      arr = [...arr].sort((a,b)=>(a._nextDue??0)-(b._nextDue??0));
    }
    el.innerHTML = arr.map((q,i)=>{
      const opts=(q.options||[]).map((o,j)=>{
        const c=String(j)===String(q.correct)||j===Number(q.correct);
        return `<div class="eo${c?' shc':''}">${String.fromCharCode(65+j)}) ${esc(o)}</div>`;
      }).join('');
      const tagPicker = kind==='bk' ? `
        <select class="sel-c" style="margin-top:.4rem;font-size:.7rem;padding:.25rem .4rem;width:auto" onchange="REV.setTag('${esc(q.uid||'')}', this.value)">
          <option value="">🏷 No tag</option>
          ${BK_TAGS.map(t=>`<option value="${t}" ${q.tag===t?'selected':''}>${t}</option>`).join('')}
        </select>` : '';
      let srBadge = '';
      if(kind==='wr'){
        const isDue = (q._nextDue==null) || q._nextDue<=Date.now();
        const streak = q._streak||0;
        if(isDue){ srBadge = `<span class="ctag tr" style="margin-left:.3rem"><i class="ph ph-repeat"></i> Due now</span>`; }
        else {
          const daysLeft = Math.ceil((q._nextDue-Date.now())/(24*60*60*1000));
          srBadge = `<span class="ctag ta" style="margin-left:.3rem">⏳ Due in ${daysLeft}d</span>`;
        }
        if(streak>0) srBadge += `<span class="ctag tg" style="margin-left:.3rem"><i class="ph ph-check"></i>×${streak}</span>`;
      }
      return `<div class="qcard" style="margin-bottom:.5rem">
        <div class="qm"><span class="qn mono">#${i+1}</span>
          ${q.tag ? `<span class="ctag ta" style="margin-left:.3rem"><i class="ph ph-tag"></i> ${esc(q.tag)}</span>` : ''}
          ${srBadge}
          <button class="ib" onclick="REV._removeOne('${kind}','${esc(q.uid||'')}')" title="Remove from review" aria-label="Remove from review"><i class="ph ph-trash"></i></button>
        </div>
        <div class="qt" style="font-size:.82rem">${esc(q.q)}</div>
        ${qImgHtml(q)}
        <div style="margin-top:.3rem">${opts}</div>
        ${q.explanation?`<div class="expl show" style="margin-top:.45rem">${esc(q.explanation)}</div>`:''}
        ${tagPicker}
      </div>`;
    }).join('');
    renderMath(el);
  },
  _removeOne(kind, uid){
    const arr=REV._store(kind);
    const i=arr.findIndex(x=>x.uid===uid);
    if(i>-1){arr.splice(i,1);_save(REV._lsKey(kind),arr);REV.renderList(kind);HOME.updateBadges();}
  },
  clearAll(kind){
    // Snapshot before clearing so Undo can restore exactly what was there,
    // including any tags/streak metadata on individual items — not just
    // an empty-vs-full toggle.
    const prev = JSON.parse(JSON.stringify(REV._store(kind)));
    if(kind==='bk'){S.bk=[];_save(LS.BK,[]);}
    else if(kind==='fl'){S.fl=[];_save(LS.FL,[]);}
    else {S.wr=[];_save(LS.WR,[]);}
    REV.renderList(kind); HOME.updateBadges();
    toastUndo('🗑 List cleared', ()=>{
      if(kind==='bk'){S.bk=prev;_save(LS.BK,prev);}
      else if(kind==='fl'){S.fl=prev;_save(LS.FL,prev);}
      else {S.wr=prev;_save(LS.WR,prev);}
      REV.renderList(kind); HOME.updateBadges();
      toast('↩️ Restored');
    });
  },
  start(kind, mode, dueOnly){
    let arr = [...REV._store(kind)];
    if(kind==='wr' && dueOnly) arr = REV.dueWrong();
    if(!arr.length){toast(dueOnly?'Nothing due for review right now 🎉':'Nothing to study here yet');return}
    QUIZ.startWith(shuf(arr), mode, kind==='bk'?'⭐ Bookmarks':kind==='fl'?'🚩 Flagged':(dueOnly?'🔁 Wrong Bank (Due Today)':'❌ Wrong Bank'));
  }
};

/* ═══════════════ 9. QUIZ ENGINE ═══════════════ */
const QUIZ = {
  async _fetch(fileId, cacheKey, attempt=1){
    function _validCache(v){
      if(!v) return false;
      if(v && typeof v === 'object' && !Array.isArray(v) && v.success === false) return false;
      return true;
    }
    if(!S.online){
      const cached = await QDB.get(cacheKey);
      if(_validCache(cached)) return cached;
      if(cached && !_validCache(cached)) throw new Error('Cached data is invalid (a previous network error was stored). Go online to refresh it.');
      throw new Error('You are offline and this set is not cached yet. Go to the Offline Cache tab to download it while online.');
    }
    try{
      const timeoutMs = attempt === 1 ? 25000 : 15000;
      const r = await netFetch(`${APPS}?${qs({action:'getFile', fileId})}`, {redirect:'follow'}, timeoutMs);
      const text = await r.text();
      if(text.trim().startsWith('<')){
        throw new Error('Server returned an HTML page instead of JSON — the Apps Script may be down or requires re-authorisation.');
      }
      let data;
      try{ data = JSON.parse(text); }
      catch(pe){ throw new Error('Could not parse server response. The file may be corrupted or the server returned an unexpected format.'); }
      if(data && typeof data === 'object' && !Array.isArray(data) && data.success === true){
        if(data.result !== undefined) data = data.result;
        else if(data.data !== undefined) data = data.data;
        else if(data.questions !== undefined) data = data.questions;
      }
      if(data && typeof data === 'object' && !Array.isArray(data) && data.success === false){
        throw new Error(data.error || 'Server returned an error for this file.');
      }
      if(_validCache(data)){
        if(!(await QDB.set(cacheKey, data))){
          throw new Error('Storage full — could not save this set for offline use. Clear some cached sets first.');
        }
      }
      return data;
    } catch(err){
      const cached = await QDB.get(cacheKey);
      if(_validCache(cached)){ toast('📦 Loaded from cache (network error)'); return cached; }
      if(attempt < 2 && (err.message.includes('timed out') || err.message.includes('Failed to fetch') || err.message.includes('NetworkError'))){
        toast('⚠️ Slow connection — retrying…');
        await new Promise(res => setTimeout(res, 1500));
        return QUIZ._fetch(fileId, cacheKey, attempt + 1);
      }
      throw err;
    }
  },

  async load(fileId, cacheKey, mode, chapterName, scope=null){
    if(!S.online || S.forcedOffline){
      const cached = await QDB.get(cacheKey);
      const isValid = cached && !(typeof cached === 'object' && !Array.isArray(cached) && cached.success === false);
      if(!isValid){
        QUIZ._showError('You are offline and this set is not cached yet. Go to the Offline Cache tab while online to download it.', null);
        return;
      }
    }
    QUIZ._showLoader('Connecting to server…');
    const msgTimer = setTimeout(()=>{ QUIZ._showLoader('Still loading… (Apps Script may be warming up)'); }, 5000);
    const msgTimer2 = setTimeout(()=>{ QUIZ._showLoader('Taking longer than usual… please wait or check your connection.'); }, 12000);
    try{
      const raw = await QUIZ._fetch(fileId, cacheKey);
      clearTimeout(msgTimer); clearTimeout(msgTimer2);
      const qsArr = normQ(raw, fileId);
      QUIZ._hideLoader();
      if(!qsArr.length){ toast('❌ No valid questions found in this file. Check the file format.'); return; }
      QUIZ.startWith(qsArr, mode, chapterName, scope);
    } catch(err){
      clearTimeout(msgTimer); clearTimeout(msgTimer2);
      QUIZ._hideLoader();
      const msg = err.message==='OFFLINE'
        ? 'You are offline and this set is not cached. Download it first from the Offline Cache tab.'
        : err.message;
      QUIZ._showError(msg, ()=>QUIZ.load(fileId, cacheKey, mode, chapterName, scope));
    }
  },

  _showError(msg, retryFn){
    let el = document.getElementById('quiz-error-card');
    if(!el){
      el = document.createElement('div');
      el.id = 'quiz-error-card';
      el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;z-index:9999;padding:1.5rem';
      document.body.appendChild(el);
    }
    el._retry = retryFn || null;
    el.innerHTML = `<div style="background:var(--c2);border:1px solid var(--bad-bd);border-radius:var(--r3);padding:1.4rem 1.5rem;max-width:380px;width:100%;box-shadow:var(--sh3)">
      <div style="font-size:1.4rem;margin-bottom:.5rem"><i class="ph ph-x-circle"></i></div>
      <div style="font-family:var(--fd);font-size:.92rem;font-weight:700;color:var(--ros);margin-bottom:.6rem">Failed to Load</div>
      <div style="font-size:.78rem;color:var(--t2);line-height:1.6;margin-bottom:1rem">${esc(msg)}</div>
      <div style="display:flex;gap:.5rem">
        <button id="quiz-err-retry" style="flex:1;padding:.58rem;background:linear-gradient(135deg,var(--amb2),var(--amb));border:none;border-radius:var(--r1);color:var(--on-accent);font-weight:700;font-size:.82rem;cursor:pointer;font-family:var(--ff)"><i class="ph ph-arrow-clockwise"></i> Retry</button>
        <button onclick="document.getElementById('quiz-error-card').remove()" style="padding:.58rem .9rem;background:var(--b0);border:1px solid var(--b1);border-radius:var(--r1);color:var(--t2);font-size:.82rem;cursor:pointer;font-family:var(--ff)"><i class="ph ph-x"></i> Close</button>
      </div>
    </div>`;
    el.style.display = 'flex';
    document.getElementById('quiz-err-retry').onclick = ()=>{ el.remove(); if(el._retry) el._retry(); };
  },

  _showLoader(msg){
    let el = document.getElementById('quiz-loader');
    if(!el){
      el = document.createElement('div');
      el.id = 'quiz-loader';
      el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:9999;gap:1rem;backdrop-filter:blur(4px)';
      el.innerHTML = '<div style="width:44px;height:44px;border:4px solid rgba(255,255,255,.2);border-top-color:var(--neon);border-radius:50%;animation:spin 0.8s linear infinite"></div><div id="quiz-loader-msg" style="color:#fff;font-size:.9rem;font-weight:600;text-align:center;padding:0 1.5rem"></div>';
      document.body.appendChild(el);
      if(!document.getElementById('quiz-loader-style')){
        const st = document.createElement('style');
        st.id = 'quiz-loader-style';
        st.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
        document.head.appendChild(st);
      }
    }
    document.getElementById('quiz-loader-msg').textContent = msg || 'Loading…';
    el.style.display = 'flex';
  },
  _hideLoader(){
    const el = document.getElementById('quiz-loader');
    if(el) el.style.display = 'none';
  },

  startWith(qsArr, mode, chapterName, scope=null){
    if(!qsArr || !qsArr.length){ toast('No questions to study'); return; }
    QUIZ._stopTimer();
    if(qsArr.length > 20){
      QUIZ._showLimitPicker(qsArr, mode, chapterName, scope);
      return;
    }
    QUIZ._doStart(qsArr, mode, chapterName, true, scope);
  },

  _showLimitPicker(qsArr, mode, chapterName, scope=null){
    if(document.getElementById('quiz-limit-modal')) return;
    const total = qsArr.length;
    const presets = [10,20,30,50].filter(n=>n<total);
    const modal = document.createElement('div');
    modal.id = 'quiz-limit-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;z-index:10000;padding:1.5rem;backdrop-filter:blur(4px)';
    modal.innerHTML = `
      <div style="background:var(--c2);border:1px solid var(--bd);border-radius:var(--r3);padding:1.5rem;max-width:340px;width:100%;box-shadow:var(--sh3)">
        <div style="font-size:1.2rem;margin-bottom:.35rem">${mode==='exam'?'<i class="ph ph-note-pencil"></i>':'<i class="ph ph-lightning"></i>'}</div>
        <div style="font-family:var(--fd);font-size:.92rem;font-weight:700;color:var(--t1);margin-bottom:.2rem">${esc(chapterName||'Quiz')}</div>
        <div style="font-size:.74rem;color:var(--t3);margin-bottom:1rem">${total} questions available — how many do you want to do?</div>
        <div style="display:flex;flex-wrap:wrap;gap:.4rem;margin-bottom:.75rem">
          ${presets.map(n=>`<button onclick="document.getElementById('qlm-inp').value=${n}" style="padding:.35rem .7rem;background:var(--b0);border:1px solid var(--b1);border-radius:var(--r1);color:var(--t2);font-size:.76rem;cursor:pointer;font-family:var(--ff)">${n}</button>`).join('')}
          <button onclick="document.getElementById('qlm-inp').value=${total}" style="padding:.35rem .7rem;background:var(--b0);border:1px solid var(--b1);border-radius:var(--r1);color:var(--t2);font-size:.76rem;cursor:pointer;font-family:var(--ff)">All ${total}</button>
        </div>
        <input id="qlm-inp" type="number" min="1" max="${total}" value="${Math.min(20,total)}"
          style="width:100%;background:var(--c1);border:1.5px solid var(--b1);border-radius:var(--r2);padding:.5rem .75rem;color:var(--t1);font-size:.9rem;font-family:var(--ff);outline:none;box-sizing:border-box;margin-bottom:.6rem">
        <label style="display:flex;align-items:center;gap:.5rem;margin-bottom:.75rem;cursor:pointer;font-size:.8rem;color:var(--t2)">
          <input id="qlm-shuffle" type="checkbox" checked style="width:16px;height:16px;accent-color:var(--amb);cursor:pointer">
          <i class="ph ph-shuffle"></i> Shuffle question order
        </label>
        <div style="display:flex;gap:.4rem">
          <button id="qlm-start" style="flex:1;padding:.62rem;background:linear-gradient(135deg,var(--amb2),var(--amb));border:none;border-radius:var(--r2);color:var(--on-accent);font-weight:700;font-size:.85rem;cursor:pointer;font-family:var(--ff)">Start →</button>
          <button onclick="document.getElementById('quiz-limit-modal').remove()" style="padding:.62rem .9rem;background:var(--b0);border:1px solid var(--b1);border-radius:var(--r2);color:var(--t2);font-size:.83rem;cursor:pointer;font-family:var(--ff)"><i class="ph ph-x"></i></button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e=>{ if(e.target===modal) modal.remove(); });
    document.getElementById('qlm-start').onclick = ()=>{
      const n = Math.min(total, Math.max(1, parseInt(document.getElementById('qlm-inp').value)||total));
      const doShuffle = document.getElementById('qlm-shuffle').checked;
      modal.remove();
      const picked = doShuffle ? shuf(qsArr).slice(0,n) : qsArr.slice(0,n);
      QUIZ._doStart(picked, mode, chapterName, false, scope);
    };
  },

  _doStart(qsArr, mode, chapterName, doShuffle=true, scope=null){
    const modeLabel = mode==='exam' ? '📝 Exam' : '⚡ Flashcard';
    toast(`${modeLabel} — ${qsArr.length} question${qsArr.length!==1?'s':''} · ${chapterName||'Study'}`, 2500);
    const examSeconds = mode==='exam' ? qsArr.length*90 : 0;
    S.quiz = {
      qs: doShuffle ? shuf(qsArr) : [...qsArr], ans: new Array(qsArr.length).fill(null),
      mode, idx:0, timer:null, elapsed:0,
      left: examSeconds,
      // Absolute end-of-exam timestamp, computed once here. The ticking
      // countdown below recalculates `left` from THIS on every tick
      // instead of decrementing a counter — see _startTimer's comment
      // for why that distinction matters.
      examEndAt: mode==='exam' ? Date.now() + examSeconds*1000 : 0,
      active:true, ch: chapterName||'Study', scope, skipped:new Set(), shown:new Set()
    };
    document.getElementById('quiz-wrap').style.display='';
    document.querySelectorAll('.view').forEach(e=>e.classList.remove('on'));
    window.scrollTo(0,0);
    try{
      if(mode==='exam'){
        document.getElementById('fc-wrap').style.display='none';
        document.getElementById('ex-wrap').style.display='';
        document.getElementById('res-wrap').style.display='none';
        QUIZ._renderExam();
      } else {
        document.getElementById('ex-wrap').style.display='none';
        document.getElementById('fc-wrap').style.display='';
        document.getElementById('res-wrap').style.display='none';
        QUIZ._renderFlashcard();
      }
    } catch(err){
      console.error('[QUIZ._doStart] render failed:', err);
      S.quiz.active = false;
      document.getElementById('quiz-wrap').style.display = 'none';
      toast('❌ Could not display this quiz — one of the questions may be malformed. Try a different set.', 5000);
      return;
    }
    QUIZ._startTimer();
    if(mode==='exam') QUIZ._snapshotExam();
  },

  daily(){
    const refs = ChapterData.allFileRefs();
    if(!refs.length){ toast('No content configured yet'); return; }
    toast('⏳ Building today\'s challenge…');
    (async()=>{
      const picks = shuf(refs).slice(0, Math.min(10, refs.length));
      const all = [];
      let failed = 0;
      for(const ref of picks){
        try{
          const raw = await QUIZ._fetch(ref.fid, ref.key);
          const qs2 = normQ(raw, ref.fid);
          all.push(...qs2);
        }catch(e){
          failed++;
          console.warn('[daily] Failed to load', ref.key, e.message);
        }
      }
      if(!all.length){ toast('❌ Could not load daily challenge — try caching data first'); return; }
      if(failed>0) toast(`⚠️ ${failed} file(s) failed — challenge uses ${all.length} questions`);
      const qsArr = shuf(all).slice(0,30);
      QUIZ.startWith(qsArr, 'flashcard', '🌟 Daily Challenge');
      STREAK.markToday();
    })();
  },

  async adaptive(){
    const TARGET = 25;
    const seen = new Set();
    const pool = [];
    const addAll = list => { for(const q of list){ if(q && q.uid && !seen.has(q.uid)){ seen.add(q.uid); pool.push(q); } } };

    addAll(REV.dueWrong());
    addAll(S.bk.filter(q => q.tag==='Confusing' || q.tag==='Need Check'));

    if(pool.length >= TARGET){
      QUIZ.startWith(shuf(pool).slice(0,TARGET), 'flashcard', '🎯 Adaptive Practice');
      return;
    }

    const refs = ChapterData.allFileRefs();
    if(!refs.length){
      if(pool.length){ QUIZ.startWith(shuf(pool), 'flashcard', '🎯 Adaptive Practice'); return; }
      toast('No content configured yet'); return;
    }
    toast('⏳ Building your adaptive practice set…');
    const need = TARGET - pool.length;
    const picks = shuf(refs).slice(0, Math.min(8, refs.length));
    let failed = 0;
    for(const ref of picks){
      if(pool.length - (TARGET-need) >= need*2) break;
      try{
        const raw = await QUIZ._fetch(ref.fid, ref.key);
        addAll(normQ(raw, ref.fid));
      }catch(e){
        failed++;
        console.warn('[adaptive] Failed to load', ref.key, e.message);
      }
    }
    if(!pool.length){ toast('❌ Could not build a practice set — try caching data first'); return; }
    if(failed>0) toast(`⚠️ ${failed} file(s) failed — practice set uses what loaded`);
    QUIZ.startWith(shuf(pool).slice(0,TARGET), 'flashcard', '🎯 Adaptive Practice');
  },

  _startTimer(){
    QUIZ._stopTimer();
    S.quiz.timer = setInterval(()=>{
      if(!S.quiz.active)return;
      if(S.quiz.mode==='exam'){
        // Wall-clock based, not a decrementing counter: if this tab was
        // backgrounded/suspended (phone screen locked, browser minimized)
        // for any stretch of time, the browser may skip or throttle
        // intervals while hidden — a counter-based `left--` would then
        // simply not have counted down during that gap, effectively
        // pausing the exam clock for however long the student was away.
        // Recomputing from the fixed examEndAt timestamp on every tick
        // means the FIRST tick after returning immediately reflects the
        // true remaining time, however long that gap actually was —
        // same principle the reload-resume path (checkResumableExam)
        // already uses, just applied to the live in-tab countdown too.
        S.quiz.left = Math.max(0, Math.round((S.quiz.examEndAt - Date.now())/1000));
        const tEl=document.getElementById('ex-tmr'); if(tEl) tEl.textContent=fmt(S.quiz.left);
        if(S.quiz.left<=0){ toast('⏰ Time\'s up!'); QUIZ.submitExam(); return; }
        if(S.quiz.left % 15 === 0) QUIZ._snapshotExam();
      } else {
        S.quiz.elapsed++;
        const tEl=document.getElementById('fc-tmr'); if(tEl) tEl.textContent=fmt(S.quiz.elapsed);
      }
    },1000);
  },
  _stopTimer(){ if(S.quiz.timer){ clearInterval(S.quiz.timer); S.quiz.timer=null; } },

  _snapshotExam(){
    if(!S.quiz || !S.quiz.active || S.quiz.mode!=='exam' || !S.user) return;
    _save(LS.EXAM_SNAP, {
      username: S.user.username,
      ch: S.quiz.ch,
      qs: S.quiz.qs,
      ans: S.quiz.ans,
      left: S.quiz.left,
      savedAt: Date.now()
    });
  },
  _clearExamSnapshot(){ localStorage.removeItem(LS.EXAM_SNAP); },

  checkResumableExam(){
    const snap = _load(LS.EXAM_SNAP, null);
    if(!snap || !S.user || snap.username !== S.user.username || !snap.qs || !snap.qs.length){
      if(snap) QUIZ._clearExamSnapshot();
      return;
    }
    const elapsedSinceSave = Math.floor((Date.now() - snap.savedAt) / 1000);
    const adjustedLeft = snap.left - elapsedSinceSave;

    if(adjustedLeft <= 0){
      QUIZ._resumeSnapshot(snap, 0);
      toast('⏰ Your exam timer ran out while you were away — showing your results.');
      QUIZ.submitExam();
      return;
    }

    const answered = snap.ans.filter(a=>a!==null).length;
    const modal = document.createElement('div');
    modal.id = 'exam-resume-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;z-index:10000;padding:1.5rem;backdrop-filter:blur(4px)';
    modal.innerHTML = `
      <div style="background:var(--c2);border:1px solid var(--bd);border-radius:var(--r3);padding:1.5rem;max-width:340px;width:100%;box-shadow:var(--sh3)">
        <div style="font-size:1.2rem;margin-bottom:.35rem"><i class="ph ph-note-pencil"></i></div>
        <div style="font-family:var(--fd);font-size:.92rem;font-weight:700;color:var(--t1);margin-bottom:.2rem">Unfinished exam found</div>
        <div style="font-size:.78rem;color:var(--t3);margin-bottom:1rem">${esc(snap.ch)} — ${answered}/${snap.qs.length} answered, ${fmt(adjustedLeft)} left on the clock. This was probably interrupted by a reload or a closed tab.</div>
        <div style="display:flex;gap:.4rem">
          <button id="exam-resume-btn" style="flex:1;padding:.62rem;background:linear-gradient(135deg,var(--amb2),var(--amb));border:none;border-radius:var(--r2);color:var(--on-accent);font-weight:700;font-size:.85rem;cursor:pointer;font-family:var(--ff)">▶️ Resume</button>
          <button id="exam-discard-btn" style="padding:.62rem .9rem;background:var(--b0);border:1px solid var(--b1);border-radius:var(--r2);color:var(--t2);font-size:.83rem;cursor:pointer;font-family:var(--ff)">Discard</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    document.getElementById('exam-resume-btn').onclick = ()=>{
      modal.remove();
      QUIZ._resumeSnapshot(snap, adjustedLeft);
    };
    document.getElementById('exam-discard-btn').onclick = ()=>{
      if(!confirm(`Discard this exam? You'll lose ${answered}/${snap.qs.length} answered question${answered!==1?'s':''} — this can't be undone.`)) return;
      modal.remove();
      QUIZ._clearExamSnapshot();
    };
  },
  _resumeSnapshot(snap, adjustedLeft){
    S.quiz = {
      qs: snap.qs, ans: snap.ans, mode:'exam', idx:0, timer:null, elapsed:0,
      left: adjustedLeft,
      examEndAt: Date.now() + adjustedLeft*1000,
      active:true, ch: snap.ch, skipped:new Set(), shown:new Set()
    };
    document.getElementById('quiz-wrap').style.display='';
    document.querySelectorAll('.view').forEach(e=>e.classList.remove('on'));
    document.getElementById('fc-wrap').style.display='none';
    document.getElementById('ex-wrap').style.display='';
    document.getElementById('res-wrap').style.display='none';
    QUIZ._renderExam();
    QUIZ._startTimer();
    toast('▶️ Exam resumed');
  },

  quit(){
    QUIZ._exitGuard(()=>{ UI._goRaw('home'); });
  },

  _exitGuard(afterQuit){
    if(document.getElementById('quiz-exit-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'quiz-exit-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;z-index:10000;padding:1.5rem;backdrop-filter:blur(4px)';
    const isExam = S.quiz.mode === 'exam';
    const answered = S.quiz.ans.filter(a=>a!==null).length;
    const total = S.quiz.qs.length;
    modal.innerHTML = `
      <div style="background:var(--c2);border:1px solid var(--bd);border-radius:var(--r3);padding:1.5rem;max-width:340px;width:100%;box-shadow:var(--sh3)">
        <div style="font-size:1.3rem;margin-bottom:.4rem"><i class="ph ph-warning"></i></div>
        <div style="font-family:var(--fd);font-size:.95rem;font-weight:700;color:var(--t1);margin-bottom:.3rem">Leave this quiz?</div>
        <div style="font-size:.76rem;color:var(--t3);margin-bottom:1.1rem">${isExam ? answered+' of '+total+' answered' : 'Question '+(S.quiz.idx+1)+' of '+total} · ${S.quiz.ch}</div>
        <div style="display:flex;flex-direction:column;gap:.45rem">
          ${isExam ? '<button id="qem-finish" style="padding:.62rem;background:var(--ok-bg);border:1px solid var(--ok-bd);border-radius:var(--r2);color:var(--grn);font-weight:700;font-size:.83rem;cursor:pointer;font-family:var(--ff);text-align:left"><i class="ph ph-check-circle"></i> Submit & See Results — grade what I have answered so far</button>' : ''}
          <button id="qem-quit" style="padding:.62rem;background:var(--bad-bg);border:1px solid var(--bad-bd);border-radius:var(--r2);color:var(--ros);font-weight:700;font-size:.83rem;cursor:pointer;font-family:var(--ff);text-align:left"><i class="ph ph-door"></i> Quit — discard this session</button>
          <button id="qem-cancel" style="padding:.62rem;background:var(--b0);border:1px solid var(--b1);border-radius:var(--r2);color:var(--t2);font-weight:600;font-size:.83rem;cursor:pointer;font-family:var(--ff);text-align:left">↩ Cancel — keep studying</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    const close = ()=> modal.remove();
    if(isExam){
      document.getElementById('qem-finish').onclick = ()=>{ close(); QUIZ.submitExam(); };
    }
    document.getElementById('qem-quit').onclick = ()=>{
      close();
      QUIZ._stopTimer();
      if(isExam) QUIZ._clearExamSnapshot();
      S.quiz.active = false;
      document.getElementById('quiz-wrap').style.display = 'none';
      if(afterQuit) afterQuit();
    };
    document.getElementById('qem-cancel').onclick = close;
    modal.addEventListener('click', e=>{ if(e.target===modal) close(); });
  },

  /* ── FLASHCARD MODE ── */
  _renderFlashcard(){
    const q = S.quiz.qs[S.quiz.idx];
    if(!q)return;
    try{
      document.getElementById('fc-chip').textContent = '⚡ ' + S.quiz.ch;
      document.getElementById('fc-ctr').textContent = `${S.quiz.idx+1}/${S.quiz.qs.length}`;
      document.getElementById('fc-pf').style.width = `${((S.quiz.idx)/S.quiz.qs.length)*100}%`;
      document.getElementById('fc-qn').textContent = 'Q'+(S.quiz.idx+1);
      document.getElementById('fc-q').textContent = q.q;
      const fcImgWrap = document.getElementById('fc-img-wrap');
      const fcImg = document.getElementById('fc-img');
      if(q.img && fcImgWrap && fcImg){ fcImg.src = q.img; fcImg.alt = q.imgCaption || 'Question figure'; fcImgWrap.style.display = ''; }
      else if(fcImgWrap){ fcImgWrap.style.display = 'none'; }

      const isStarred = REV.has('bk', q.uid), isFlagged = REV.has('fl', q.uid);
      document.getElementById('fc-acts').innerHTML = `
        <button class="ib ${isStarred?'bk-on':''}" onclick="QUIZ._star()" title="Bookmark" aria-label="Bookmark this question" aria-pressed="${isStarred?'true':'false'}"><i class="ph ph-star"></i></button>
        <button class="ib ${isFlagged?'fl-on':''}" onclick="QUIZ._flag()" title="Flag" aria-label="Flag this question" aria-pressed="${isFlagged?'true':'false'}"><i class="ph ph-flag"></i></button>
        <button class="ib" onclick="SRCH.toggle()" title="Search (Ctrl+F)" aria-label="Search this question"><i class="ph ph-magnifying-glass"></i></button>
        <select class="sel-c" style="font-size:.68rem;padding:.2rem .35rem;width:auto" onchange="QUIZ._tagCurrent(this.value)">
          <option value="">🏷 Tag…</option>
          ${BK_TAGS.map(t=>`<option value="${t}" ${REV.getTag(q.uid)===t?'selected':''}>${t}</option>`).join('')}
        </select>
      `;

      const ansIdx = S.quiz.ans[S.quiz.idx];
      const answered = ansIdx !== null;
      const optsEl = document.getElementById('fc-opts');
      optsEl.innerHTML = q.options.map((opt,i)=>{
        let cls='eo';
        let isSelected = false;
        if(answered){
          const isCorrect = isOk(i, q.correct);
          isSelected = i===ansIdx;
          if(isCorrect) cls += ' shc';
          else if(isSelected) cls += ' bad2';
        }
        return `<div class="${cls}" role="button" tabindex="${answered?-1:0}" aria-pressed="${isSelected}" aria-label="Option ${String.fromCharCode(65+i)}: ${esc(opt)}${isSelected?', selected':''}" onclick="${answered?'':'QUIZ.fcAnswer('+i+')'}" onkeydown="if((event.key==='Enter'||event.key===' ')&&!${answered}){event.preventDefault();QUIZ.fcAnswer(${i})}" style="${answered?'cursor:default;pointer-events:none':''}">
          <div class="ok">${String.fromCharCode(65+i)}</div><div>${esc(opt)}</div>
        </div>`;
      }).join('');

      const expl = document.getElementById('fc-expl');
      if(answered && q.explanation){ expl.textContent = q.explanation; expl.classList.add('show'); }
      else { expl.classList.remove('show'); expl.textContent=''; }

      document.getElementById('fc-hint').textContent = answered ? 'Use Next →' : 'Tap an option to answer';
      document.getElementById('fc-prev').disabled = S.quiz.idx===0;
      document.getElementById('fc-next').textContent = S.quiz.idx===S.quiz.qs.length-1 ? 'Finish ✔' : 'Next →';

      QUIZ._updateFcCounts();
      renderMath(document.getElementById('fc-wrap'));
    } catch(err){
      console.error('[QUIZ._renderFlashcard] question at idx', S.quiz.idx, 'failed to render:', err, q);
      toast('⚠️ Skipped a malformed question', 2000);
      if(S.quiz.idx < S.quiz.qs.length-1){ S.quiz.idx++; QUIZ._renderFlashcard(); }
      else QUIZ.fcFinish();
    }
  },
  _updateFcCounts(){
    let ok=0,bad=0,skip=0;
    S.quiz.ans.forEach((a,i)=>{
      if(a===null){ if(S.quiz.shown?.has(i)) skip++; return; }
      if(isOk(a, S.quiz.qs[i].correct)) ok++; else bad++;
    });
    document.getElementById('fc-ok').textContent=ok;
    document.getElementById('fc-bad').textContent=bad;
    document.getElementById('fc-skip').textContent=skip;
  },
  fcAnswer(i){
    if(S.quiz.ans[S.quiz.idx]!==null)return;
    S.quiz.ans[S.quiz.idx]=i;
    const q=S.quiz.qs[S.quiz.idx];
    const correct=isOk(i,q.correct);
    if(correct){ PROG.track(true); REV.trackAnswer(q, true); }
    else { PROG.track(false); REV.trackAnswer(q, false); }
    QUIZ._renderFlashcard();
  },
  fcNav(dir){
    if(!S.quiz.shown) S.quiz.shown=new Set();
    S.quiz.shown.add(S.quiz.idx);
    const next = S.quiz.idx+dir;
    if(next<0)return;
    if(next>=S.quiz.qs.length){ QUIZ.fcFinish(); return; }
    S.quiz.idx=next;
    QUIZ._renderFlashcard();
  },
  _star(){
    const q=S.quiz.qs[S.quiz.idx];
    REV.toggle('bk', q);
    QUIZ._renderFlashcard();
  },
  _flag(){
    const q=S.quiz.qs[S.quiz.idx];
    REV.toggle('fl', q);
    QUIZ._renderFlashcard();
  },
  _tagCurrent(tag){
    const q=S.quiz.qs[S.quiz.idx];
    if(!q) return;
    REV.setTag(q.uid, tag, q);
    QUIZ._renderFlashcard();
  },
  fcFinish(){
    QUIZ._stopTimer();
    S.quiz.active=false;
    STREAK.markToday();
    QUIZ._showResults();
  },

  /* ── EXAM MODE ── */
  _renderExam(){
    document.getElementById('ex-chip').textContent = '📝 ' + S.quiz.ch;
    document.getElementById('ex-tmr').textContent = fmt(S.quiz.left);
    const el = document.getElementById('ex-qs');
    el.innerHTML = S.quiz.qs.map((q,qi)=>{
      const gq = encodeURIComponent(q.q.slice(0,120));
      const savedAns = S.quiz.ans[qi];
      return `
      <div class="eqc${savedAns!==null?' answered':''}" id="eqc-${qi}">
        <div class="qm"><span class="qn mono">Q${qi+1}</span><a class="ib" href="https://www.google.com/search?q=${gq}" target="_blank" rel="noopener" title="Search on Google" aria-label="Search this question on Google" style="text-decoration:none"><i class="ph ph-magnifying-glass"></i></a></div>
        <div class="qt" style="font-size:.85rem">${esc(q.q)}</div>
        ${qImgHtml(q)}
        ${q.options.map((opt,oi)=>{
          const sel = savedAns===oi;
          return `<div class="eo${sel?' sel':''}" role="button" tabindex="0" aria-pressed="${sel}" aria-label="Option ${String.fromCharCode(65+oi)}: ${esc(opt)}" onclick="QUIZ.exAnswer(${qi},${oi})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();QUIZ.exAnswer(${qi},${oi})}" id="eo-${qi}-${oi}">
            <div class="ok">${String.fromCharCode(65+oi)}</div><div>${esc(opt)}</div>
          </div>`;
        }).join('')}
      </div>
    `}).join('');
    renderMath(el);
    const answeredCount = S.quiz.ans.filter(a=>a!==null).length;
    document.getElementById('ex-ctr').textContent = `${answeredCount}/${S.quiz.qs.length}`;
    document.getElementById('ex-ans').textContent = answeredCount;
    document.getElementById('ex-pf').style.width = `${(answeredCount/S.quiz.qs.length)*100}%`;
  },
  exAnswer(qi, oi){
    if(!S.quiz.active)return;
    S.quiz.ans[qi]=oi;
    document.querySelectorAll(`#eqc-${qi} .eo`).forEach((e,i)=>{
      const sel = i===oi;
      e.classList.toggle('sel', sel);
      e.setAttribute('aria-pressed', String(sel));
    });
    document.getElementById(`eqc-${qi}`).classList.add('answered');
    const answered = S.quiz.ans.filter(a=>a!==null).length;
    document.getElementById('ex-ctr').textContent = `${answered}/${S.quiz.qs.length}`;
    document.getElementById('ex-ans').textContent = answered;
    document.getElementById('ex-pf').style.width = `${(answered/S.quiz.qs.length)*100}%`;
    QUIZ._snapshotExam();
  },
  submitExam(){
    if(!S.quiz.active)return;
    const unanswered = S.quiz.ans.filter(a=>a===null).length;
    if(unanswered>0 && S.quiz.left>0 && !confirm(`${unanswered} question(s) unanswered. Submit anyway?`))return;
    QUIZ._stopTimer();
    QUIZ._clearExamSnapshot();
    S.quiz.active=false;
    STREAK.markToday();
    S.quiz.qs.forEach((q,qi)=>{
      document.querySelectorAll(`#eqc-${qi} .eo`).forEach((e,oi2)=>{
        e.style.pointerEvents='none';
        const correct = isOk(oi2,q.correct);
        if(correct) e.classList.add('shc');
        else if(oi2===S.quiz.ans[qi]) e.classList.add('bad2');
      });
      const correctPick = isOk(S.quiz.ans[qi], q.correct);
      PROG.track(correctPick);
      REV.trackAnswer(q, correctPick);
    });
    QUIZ._showResults();
  },

  /* ── RETRY ── */
  retryWrong(){
    const wrongIdx = S.quiz.qs.map((q,i)=>({q,i})).filter(({i})=>!isOk(S.quiz.ans[i], S.quiz.qs[i].correct));
    if(!wrongIdx.length){ toast('🎉 Nothing to retry — all correct!'); UI.go('home'); return; }
    QUIZ.startWith(wrongIdx.map(x=>x.q), 'flashcard', S.quiz.ch + ' (Retry)');
  },

  /* ── RESULTS ── */
  _showResults(){
    document.getElementById('fc-wrap').style.display='none';
    document.getElementById('ex-wrap').style.display='none';
    document.getElementById('res-wrap').style.display='';
    const total = S.quiz.qs.length;
    let correct=0;
    S.quiz.qs.forEach((q,i)=>{ if(isOk(S.quiz.ans[i], q.correct)) correct++; });
    const wrong = S.quiz.ans.filter((a,i)=> a!==null && !isOk(a,S.quiz.qs[i].correct)).length;
    const skipped = S.quiz.ans.filter(a=>a===null).length;
    const pct = total ? Math.round((correct/total)*100) : 0;

    document.getElementById('res-ring').style.setProperty('--p', pct+'%');
    document.getElementById('res-pct').textContent = pct+'%';
    document.getElementById('res-chap').textContent = S.quiz.ch;
    const grade = pct>=90?'🏆 Outstanding!':pct>=75?'🎯 Great job!':pct>=50?'👍 Keep practicing':'📚 Needs more review';
    document.getElementById('res-grade').textContent = grade;

    document.getElementById('res-stats').innerHTML = `
      <div class="sc"><div class="sv tcy">${total}</div><div class="stat-lbl">Total</div></div>
      <div class="sc"><div class="sv tc2">${correct}</div><div class="stat-lbl">Correct</div></div>
      <div class="sc"><div class="sv tb2">${wrong}</div><div class="stat-lbl">Wrong</div></div>
      <div class="sc"><div class="sv ta2">${skipped}</div><div class="stat-lbl">Skipped</div></div>
    `;

    document.getElementById('res-review').innerHTML = S.quiz.qs.map((q,i)=>{
      const a = S.quiz.ans[i];
      const correctPick = isOk(a,q.correct);
      return `<div class="qcard" style="border-left-color:${correctPick?'var(--ok)':'var(--bad)'}">
        <div class="qm"><span class="qn mono">Q${i+1}</span><span class="ctag ${correctPick?'tg':'tr'}">${correctPick?'Correct':a===null?'Skipped':'Wrong'}</span></div>
        <div class="qt" style="font-size:.82rem">${esc(q.q)}</div>
        ${qImgHtml(q)}
        ${q.options.map((opt,oi)=>{
          let cls='eo';
          if(isOk(oi,q.correct)) cls+=' shc';
          else if(oi===a) cls+=' bad2';
          return `<div class="${cls}" style="cursor:default;pointer-events:none"><div class="ok">${String.fromCharCode(65+oi)}</div><div>${esc(opt)}</div></div>`;
        }).join('')}
        ${q.explanation?`<div class="expl show">${esc(q.explanation)}</div>`:''}
      </div>`;
    }).join('');
    renderMath(document.getElementById('res-review'));

    if(pct>=70 && window.confetti){ confetti({particleCount:90,spread:75,origin:{y:0.6}}); }
    const qres = S.quiz.qs
      .map((q,i)=> S.quiz.ans[i]===null ? null : {uid:q.uid, ok:isOk(S.quiz.ans[i], q.correct)})
      .filter(Boolean);
    const scope = S.quiz.scope || {};
    PROG.recordSession({
      chapter:S.quiz.ch, mode:S.quiz.mode, total, correct, wrong, skipped, pct, at:Date.now(),
      lv:scope.lv||'', ch:scope.ch||'', book:scope.book||'', sub:scope.sub||'', fid:scope.fid||'',
      qres
    });

    // ══════════ Cloud backup after every quiz ══════════
    if (typeof CLOUD !== 'undefined' && CLOUD.backup) {
      CLOUD.backup(true);
    }
  }
};

/* keyboard support during quizzes */
document.addEventListener('keydown', e=>{
  if(!S.quiz.active) return;
  if(document.getElementById('quiz-wrap').style.display==='none') return;
  if(e.key==='Escape'){ if(S.quiz.active) QUIZ.quit(); }
  if(S.quiz.mode!=='exam'){
    if(e.key==='ArrowRight') QUIZ.fcNav(1);
    if(e.key==='ArrowLeft') QUIZ.fcNav(-1);
    if(['1','2','3','4','5'].includes(e.key)){
      const i=Number(e.key)-1;
      if(S.quiz.qs[S.quiz.idx]?.options[i]!==undefined) QUIZ.fcAnswer(i);
    }
    const letterIdx = 'abcdABCD'.indexOf(e.key);
    if(letterIdx > -1){
      const i = letterIdx % 4;
      if(S.quiz.qs[S.quiz.idx]?.options[i]!==undefined) QUIZ.fcAnswer(i);
    }
  }
});

/* ═══════════════ 10a. PROGRESS TRACKING ═══════════════ */
const PROG = {
  track(correct){
    S.prog.total++;
    if(correct) S.prog.correct++;
    _save(LS.PROG, S.prog);
    HOME.updateStats();
  },
  recordSession(sess){
    S.prog.sessions.unshift(sess);
    S.prog.sessions = S.prog.sessions.slice(0,50);
    _save(LS.PROG, S.prog);
    HOME.render();
  },
  predict(){
    const sessions = S.prog.sessions.filter(s=>s.total>0).slice(0,20);
    if(sessions.length < 3) return null;
    let wSum=0, vSum=0;
    sessions.forEach((s,i)=>{
      const recencyW = 1 - (i/sessions.length)*0.5;
      const modeW = s.mode==='exam' ? 1.5 : 1.0;
      const w = recencyW * modeW;
      vSum += (s.pct||0) * w;
      wSum += w;
    });
    const predicted = Math.round(vSum/wSum);
    const pcts = sessions.map(s=>s.pct||0);
    const mean = pcts.reduce((a,b)=>a+b,0)/pcts.length;
    const variance = pcts.reduce((a,b)=>a+(b-mean)**2,0)/pcts.length;
    const stdDev = Math.round(Math.sqrt(variance));
    const confidence = sessions.length>=10 && stdDev<15 ? 'High' : sessions.length>=5 ? 'Medium' : 'Low';
    return { predicted, margin: Math.max(3,stdDev), confidence, sampleSize: sessions.length };
  },
  renderPredict(){
    const el = document.getElementById('predict-card');
    if(!el) return;
    const p = PROG.predict();
    if(!p){
      el.innerHTML = `<div class="card"><div class="card-hd"><h3><i class="ph ph-target"></i> Predicted Exam Score</h3></div>
        <div class="empty"><div class="empty-i"><i class="ph ph-target"></i></div><p>Complete at least 3 quizzes (exam mode helps most) to unlock a prediction</p></div></div>`;
      return;
    }
    const barColor = p.predicted>=70?'var(--grn)':p.predicted>=50?'var(--amb)':'var(--ros)';
    const confColor = p.confidence==='High'?'tg':p.confidence==='Medium'?'ta':'tr';
    el.innerHTML = `<div class="card">
      <div class="card-hd"><h3><i class="ph ph-target"></i> Predicted Exam Score</h3><span class="ctag ${confColor}">${p.confidence} confidence</span></div>
      <div style="display:flex;align-items:baseline;gap:.5rem;margin:.3rem 0 .5rem">
        <span style="font-size:2rem;font-weight:800;color:var(--t1);font-family:var(--fd)">${p.predicted}%</span>
        <span style="font-size:.76rem;color:var(--t3)">± ${p.margin}% · based on your last ${p.sampleSize} session${p.sampleSize!==1?'s':''}</span>
      </div>
      <div class="pb"><div class="pb-f" style="width:${p.predicted}%;background:${barColor}"></div></div>
      <div style="font-size:.7rem;color:var(--t3);margin-top:.55rem">Recent and exam-mode sessions count more. Not a guarantee — use it to gauge where you stand.</div>
    </div>`;
  },
  render(){
    PROG.renderPredict();
    const total=S.prog.total, correct=S.prog.correct, wrong=total-correct;
    const pct = total ? Math.round((correct/total)*100) : 0;
    document.getElementById('prog-stats').innerHTML = `
      <div class="sc"><div class="sv tcy">${total}</div><div class="stat-lbl">Answered</div></div>
      <div class="sc"><div class="sv tc2">${correct}</div><div class="stat-lbl">Correct</div></div>
      <div class="sc"><div class="sv tb2">${wrong}</div><div class="stat-lbl">Wrong</div></div>
      <div class="sc"><div class="sv ta2">${pct}%</div><div class="stat-lbl">Accuracy</div></div>
    `;
    const byChap = {};
    S.prog.sessions.forEach(s=>{
      const k=s.chapter||'Unknown';
      if(!byChap[k]) byChap[k]={correct:0,total:0,sessions:0,lastAt:0};
      byChap[k].correct+=s.correct||0;
      byChap[k].total+=s.total||0;
      byChap[k].sessions++;
      if((s.at||0)>byChap[k].lastAt) byChap[k].lastAt=s.at||0;
    });
    const chapEl = document.getElementById('chap-acc');
    const entries = Object.entries(byChap).sort((a,b)=>b[1].lastAt-a[1].lastAt);
    if(!entries.length){
      chapEl.innerHTML = '<div class="empty"><div class="empty-i"><i class="ph ph-chart-bar"></i></div><p>Complete a quiz to see chapter breakdowns</p></div>';
    } else {
      const weak = entries.filter(([,d])=> d.total>=5 && d.total ? Math.round((d.correct/d.total)*100)<60 : false);
      const weakHtml = weak.length ? `
        <div style="background:var(--bad-bg);border:1px solid var(--bad-bd);border-radius:var(--r2);padding:.75rem 1rem;margin-bottom:.8rem">
          <div style="font-size:.72rem;font-weight:800;color:var(--ros);text-transform:uppercase;letter-spacing:.5px;margin-bottom:.4rem"><i class="ph ph-warning"></i> Weak Topics — needs attention</div>
          ${weak.map(([name,d])=>{
            const p=d.total?Math.round((d.correct/d.total)*100):0;
            return `<div style="display:flex;justify-content:space-between;align-items:center;padding:.2rem 0;font-size:.76rem"><span style="color:var(--t2)">${esc(name)}</span><span class="ctag tr">${p}%</span></div>`;
          }).join('')}
          <div style="margin-top:.5rem;font-size:.7rem;color:var(--t3)">Tip: Use <i class="ph ph-x-circle"></i> Wrong Bank to drill these topics</div>
        </div>` : '';
      chapEl.innerHTML = weakHtml + entries.map(([name,d])=>{
        const p = d.total ? Math.round((d.correct/d.total)*100) : 0;
        const barColor = p>=70?'var(--grn)':p>=50?'var(--amb)':'var(--ros)';
        return `<div class="pb-w">
          <div class="pb-l">
            <span style="font-size:.78rem">${esc(name)}</span>
            <div style="display:flex;align-items:center;gap:.35rem">
              <span style="font-size:.68rem;color:var(--t3)">${d.sessions} session${d.sessions!==1?'s':''} · ${d.correct}/${d.total}</span>
              <span class="ctag t${p>=70?'g':p>=50?'a':'r'}" style="font-size:.65rem">${p}%</span>
            </div>
          </div>
          <div class="pb"><div class="pb-f" style="width:${p}%;background:${barColor}"></div></div>
        </div>`;
      }).join('');
    }
  }
};

/* ═══════════════ 10a2. ONLINE STUDY — SCOPE PROGRESS ═══════════════ */
function scopeLeaves(lv,ch,book,sub){
  let refs;
  if(!lv){ refs = ChapterData.allFileRefs(); }
  else if(!ch){
    refs=[];
    Object.keys(ChapterData.chapters(lv)).forEach(c=>refs.push(...ChapterData.chapterFileRefs(lv,c)));
  } else {
    refs = ChapterData.chapterFileRefs(lv,ch);
  }
  if(book) refs = refs.filter(r=>r.book===book);
  if(sub) refs = refs.filter(r=>r.subtopic===sub);
  return refs;
}

const CNT_AUTO_LIMIT = 20;

const CNT = {
  async forFile(ref){
    if(!ref.fid) return null;
    if(S.fcount[ref.fid]!=null) return S.fcount[ref.fid];
    try{
      const raw = await QUIZ._fetch(ref.fid, ref.key);
      const n = normQ(raw, ref.fid).length;
      S.fcount[ref.fid]=n;
      _save(LS.FCOUNT,S.fcount);
      return n;
    }catch{ return null; }
  },
  knownTotal(leaves){
    let sum=0, unknown=0;
    leaves.forEach(ref=>{
      const n = S.fcount[ref.fid];
      if(n==null) unknown++; else sum+=n;
    });
    return {total:sum, files:leaves.length, unknown};
  },
  async totalFor(lv,ch,book,sub,{force=false, onTick}={}){
    const leaves = scopeLeaves(lv,ch,book,sub);
    const known = CNT.knownTotal(leaves);
    if(known.unknown===0) return known;
    if(!force && leaves.length>CNT_AUTO_LIMIT) return {...known, needsConfirm:true};
    let sum=0, unknown=0, done=0;
    const CONC=4; let i=0;
    async function worker(){
      while(i<leaves.length){
        const ref=leaves[i++];
        const n = await CNT.forFile(ref);
        if(n==null) unknown++; else sum+=n;
        done++; onTick&&onTick(done,leaves.length);
      }
    }
    await Promise.all(Array.from({length:Math.max(1,Math.min(CONC,leaves.length))},worker));
    return {total:sum, files:leaves.length, unknown};
  }
};

// uid format is always `${fid}_${index}` (see normQ). Google Drive fileIds
// can themselves contain underscores, so we split on the LAST underscore —
// everything before it is the source file id, everything after is the
// in-file index (always a plain number, never has an underscore).
function fidFromUid(uid){
  const i = uid.lastIndexOf('_');
  return i > -1 ? uid.slice(0,i) : uid;
}

// Per-file (fid) practise stats, built from every recorded session's qres —
// regardless of *how* that session was started (Online Study, Psycho Mode,
// Daily Challenge, Adaptive Practice, Wrong Bank retry, Bookmarks review,
// etc). Session-level lv/ch/book/sub tags are only ever set by Online Study,
// so filtering on them (the old approach) silently dropped every other
// mode's practice from the scoped progress card. Matching by the file id
// embedded in each answered question's uid instead means it doesn't matter
// which screen the user practised from — it always counts.
function fileStatsMap(leaves){
  const map = new Map();
  leaves.forEach(ref=>{ if(!map.has(ref.fid)) map.set(ref.fid, {practised:new Set(), attempted:0, correct:0, wrong:0}); });
  S.prog.sessions.forEach(s=>{
    (s.qres||[]).forEach(q=>{
      if(!q || !q.uid) return;
      const rec = map.get(fidFromUid(q.uid));
      if(!rec) return;
      rec.practised.add(q.uid);
      rec.attempted++;
      if(q.ok) rec.correct++; else rec.wrong++;
    });
  });
  return map;
}

function scopedStats(leaves){
  const fileMap = fileStatsMap(leaves);
  const uids = new Set();
  let attempted=0, correct=0, wrong=0;
  fileMap.forEach(rec=>{
    rec.practised.forEach(u=>uids.add(u));
    attempted += rec.attempted; correct += rec.correct; wrong += rec.wrong;
  });
  return {practised:uids.size, attempted, correct, wrong, fileMap};
}

const ONPROG = {
  metric:'practised',
  filewiseOpen:false,
  _seq:0,
  setMetric(m){
    ONPROG.metric = m;
    document.querySelectorAll('#on-prog-tabs .mtab').forEach(b=>b.classList.toggle('active', b.dataset.m===m));
    ONPROG.render();
  },
  toggleFilewise(){
    ONPROG.filewiseOpen = !ONPROG.filewiseOpen;
    ONPROG.render();
  },
  // Clears ONLY the Practised/Attempted/Correct/Wrong counts for one
  // specific file (fid) — never bookmarks, flags, or the wrong-answer
  // bank, and never anything on Google Drive (the question sets
  // themselves). This edits S.prog.sessions in localStorage, which is
  // the exact same data saveProgress() already syncs to the backend —
  // so the next background sync (triggered automatically by _save())
  // carries the reset to the cloud copy too, with no separate backend
  // action needed.
  _lastLeaves:[],
  resetFile(fid){
    if(!fid) return;
    const ref = ONPROG._lastLeaves.find(l=>l.fid===fid);
    const label = ref ? `${ref.book} — ${ref.subtopic}` : 'this file';
    if(!confirm(`Reset practice progress for "${label}"?\n\nThis clears only the Practised/Attempted/Correct/Wrong counts for this one file. Bookmarks, flags, and your wrong-answer bank are not touched — and the question file itself is never modified.`)) return;
    let removedTotal=0, removedCorrectTotal=0;
    S.prog.sessions.forEach(s=>{
      if(!s.qres || !s.qres.length) return;
      const kept=[];
      let removedHere=0, removedCorrectHere=0;
      s.qres.forEach(q=>{
        if(q && q.uid && fidFromUid(q.uid)===fid){
          removedHere++;
          if(q.ok) removedCorrectHere++;
        } else kept.push(q);
      });
      if(removedHere){
        s.qres = kept;
        s.correct = Math.max(0,(s.correct||0)-removedCorrectHere);
        s.wrong = Math.max(0,(s.wrong||0)-(removedHere-removedCorrectHere));
        s.total = Math.max(0,(s.total||0)-removedHere);
        removedTotal += removedHere;
        removedCorrectTotal += removedCorrectHere;
      }
    });
    // Drop sessions fully consumed by the reset so Recent Sessions
    // doesn't show zeroed ghost entries.
    S.prog.sessions = S.prog.sessions.filter(s=> (s.qres&&s.qres.length) || (s.total||0)>0);
    S.prog.total = Math.max(0,(S.prog.total||0)-removedTotal);
    S.prog.correct = Math.max(0,(S.prog.correct||0)-removedCorrectTotal);
    _save(LS.PROG, S.prog);
    toast(removedTotal ? `✅ Reset "${label}" — ${removedTotal} record(s) cleared` : `Nothing to reset for "${label}"`);
    ONPROG.render();
    if(typeof HOME!=='undefined' && HOME.render) HOME.render();
  },
  _scope(){
    const lv = document.getElementById('on-lv')?.value || '';
    const ch = document.getElementById('on-ch')?.value || '';
    const book = document.getElementById('on-bk')?.value || '';
    const ts = document.getElementById('on-to');
    const opt = ts && ts.selectedIndex>=0 ? ts.options[ts.selectedIndex] : null;
    const valid = opt && opt.dataset && opt.dataset.sub && !opt.disabled;
    return {lv, ch, book, sub: valid?opt.dataset.sub:'', fid: valid?opt.value:''};
  },
  async render(force=false){
    const el = document.getElementById('on-progress-card');
    const titleEl = document.getElementById('on-prog-title');
    const bodyEl = document.getElementById('on-prog-body');
    if(!el||!titleEl||!bodyEl) return;
    const {lv,ch,book,sub,fid} = ONPROG._scope();
    const mySeq = ++ONPROG._seq;

    if(!lv){
      titleEl.textContent = '📊 Overall Progress';
      const total=S.prog.total, correct=S.prog.correct, wrong=total-correct;
      const pct = total ? Math.round((correct/total)*100) : 0;
      bodyEl.innerHTML = `
        <div class="prog-grid">
          <div class="sc"><div class="sv tcy">${total}</div><div class="stat-lbl">Attempted</div></div>
          <div class="sc"><div class="sv tc2">${correct}</div><div class="stat-lbl">Correct</div></div>
          <div class="sc"><div class="sv tb2">${wrong}</div><div class="stat-lbl">Wrong</div></div>
        </div>
        <div class="pb-w" style="margin-top:.6rem"><div class="pb-l"><span>Accuracy</span><span>${pct}%</span></div><div class="pb"><div class="pb-f" style="width:${pct}%"></div></div></div>
        <div style="font-size:.68rem;color:var(--t3);margin-top:.5rem">Pick a Level, Chapter, Book or Subtopic above to see coverage for that scope.</div>`;
      return;
    }

    const lvLabel = document.getElementById('on-lv').selectedOptions[0]?.textContent.replace(/^📖\s*/,'') || lv;
    const label = fid ? `${ChapterData.chapterName(lv,ch)} — ${book} — ${sub}`
      : book ? `${ChapterData.chapterName(lv,ch)} — ${book}`
      : ch ? ChapterData.chapterName(lv,ch)
      : lvLabel;
    titleEl.textContent = `📊 ${label}`;

    const leaves = scopeLeaves(lv,ch,book,sub);
    ONPROG._lastLeaves = leaves;
    const scoped = scopedStats(leaves);
    const known = CNT.knownTotal(leaves);

    const paint = (info)=>{
      if(mySeq!==ONPROG._seq) return;
      const total = info.total;
      const vals = {practised:scoped.practised, attempted:scoped.attempted, correct:scoped.correct, wrong:scoped.wrong};
      const metricVal = vals[ONPROG.metric];
      const metricLabel = {practised:'Practised',attempted:'Attempted',correct:'Correct',wrong:'Wrong'}[ONPROG.metric];
      const barColor = ONPROG.metric==='wrong' ? 'var(--ros)' : ONPROG.metric==='correct' ? 'var(--grn)' : 'var(--amb)';
      const pct = total ? Math.min(100, Math.round((metricVal/total)*100)) : 0;
      const unknownNote = info.unknown ? `<div style="font-size:.66rem;color:var(--t3);margin-top:.45rem"><i class="ph ph-warning"></i> ${info.unknown} of ${info.files} file${info.files>1?'s':''} not counted yet (offline, or not cached)</div>` : '';
      const confirmBtn = info.needsConfirm ? `<button class="btn btn-sm btn-a" style="margin-top:.5rem" onclick="ONPROG.render(true)"><i class="ph ph-list-numbers"></i> Count questions (${info.files} files)</button>` : '';

      // ── Filewise breakdown — one row per subtopic/file in the current
      // scope, shown alongside the compiled (aggregate) numbers above.
      // Skipped when there's only one file (nothing to break down) or the
      // scope is too wide (100+ files — narrow the selection instead of
      // dumping a huge list).
      let filewiseHtml = '';
      if(leaves.length>1 && leaves.length<=100){
        const showBook = !book; // book not yet chosen -> leaves span multiple books, show book too
        const rows = leaves.map(ref=>{
          const rec = scoped.fileMap.get(ref.fid) || {practised:new Set(),attempted:0,correct:0,wrong:0};
          const fVals = {practised:rec.practised.size, attempted:rec.attempted, correct:rec.correct, wrong:rec.wrong};
          const fVal = fVals[ONPROG.metric];
          const fTotal = S.fcount[ref.fid];
          const fPct = fTotal ? Math.min(100, Math.round((fVal/fTotal)*100)) : 0;
          const rowLabel = showBook ? `${ref.book} — ${ref.subtopic}` : ref.subtopic;
          return `<div class="pb-w fw-row">
            <div class="pb-l">
              <span>${esc(rowLabel)}</span>
              <span class="fw-row-right">${fVal} / ${fTotal!=null?fTotal:'?'}${fTotal!=null?` (${fPct}%)`:''}
                <button class="fw-reset" title="Reset progress for this file" aria-label="Reset progress for this file" onclick="event.stopPropagation();ONPROG.resetFile('${ref.fid}')"><i class="ph ph-trash"></i></button>
              </span>
            </div>
            <div class="pb"><div class="pb-f" style="width:${fTotal!=null?fPct:0}%;background:${barColor}"></div></div>
          </div>`;
        }).join('');
        filewiseHtml = `
          <div class="fw-toggle" onclick="ONPROG.toggleFilewise()">
            <span>${ONPROG.filewiseOpen?'▾':'▸'}</span> <i class="ph ph-folder"></i> Filewise breakdown (${leaves.length} files)
          </div>
          <div id="on-fw-list" style="display:${ONPROG.filewiseOpen?'block':'none'}">${rows}</div>`;
      }

      bodyEl.innerHTML = `
        <div class="prog-grid">
          <div class="sc"><div class="sv tcy">${scoped.practised}</div><div class="stat-lbl">Practised</div></div>
          <div class="sc"><div class="sv ta2">${scoped.attempted}</div><div class="stat-lbl">Attempted</div></div>
          <div class="sc"><div class="sv tc2">${scoped.correct}</div><div class="stat-lbl">Correct</div></div>
          <div class="sc"><div class="sv tb2">${scoped.wrong}</div><div class="stat-lbl">Wrong</div></div>
        </div>
        ${info.needsConfirm ? confirmBtn : `
          <div class="pb-w" style="margin-top:.65rem">
            <div class="pb-l">
              <span>${metricLabel} coverage (compiled)</span>
              <span>${metricVal} / ${total||'?'} (${pct}%)${fid ? ` <button class="fw-reset" title="Reset progress for this file" aria-label="Reset progress for this file" onclick="ONPROG.resetFile('${fid}')"><i class="ph ph-trash"></i></button>` : ''}</span>
            </div>
            <div class="pb"><div class="pb-f" style="width:${pct}%;background:${barColor}"></div></div>
          </div>`}
        ${unknownNote}
        ${info.needsConfirm ? '' : filewiseHtml}
      `;
    };

    if(known.unknown===0){ paint(known); return; }
    bodyEl.innerHTML = `<div class="empty" style="padding:.8rem 0"><div class="empty-i">⏳</div><p>Counting questions…</p></div>`;
    const info = await CNT.totalFor(lv,ch,book,sub,{force, onTick:(done,files)=>{
      if(mySeq!==ONPROG._seq) return;
      const p = bodyEl.querySelector('p');
      if(p && files>1) p.textContent = `Counting questions… ${done}/${files} files`;
    }});
    paint(info);
  }
};

/* ═══════════════ 10b. STREAK ═══════════════ */
const STREAK = {
  markToday(){
    const t = today();
    if(!S.stk.days.includes(t)) S.stk.days.push(t);
    S.stk.last = t;
    S.stk.days = S.stk.days.slice(-60);
    _save(LS.STK, S.stk);
    HOME.render();
  },
  currentStreak(){
    let n=0; let d=new Date();
    while(true){
      const ds=d.toISOString().slice(0,10);
      if(S.stk.days.includes(ds)){ n++; d.setDate(d.getDate()-1); }
      else break;
    }
    return n;
  },
  renderBar(){
    const el = document.getElementById('sk-bar');
    if(!el)return;
    const days=[];
    const d=new Date();
    for(let i=6;i>=0;i--){
      const dd=new Date(d); dd.setDate(d.getDate()-i);
      days.push(dd.toISOString().slice(0,10));
    }
    el.innerHTML = days.map(ds=>{
      const done = S.stk.days.includes(ds);
      const isToday = ds===today();
      const label = new Date(ds).toLocaleDateString(undefined,{weekday:'short'})[0];
      return `<div class="sk-d ${done?'done':''} ${isToday?'today':''}">${label}</div>`;
    }).join('');
    document.getElementById('stk-tag').textContent = `🔥 ${STREAK.currentStreak()} day streak`;
  }
};

/* ═══════════════ 10c. HOME / DASHBOARD ═══════════════ */
const HOME = {
  render(){
    const h=new Date().getHours();
    const G=[
      {t:'Burning midnight oil?',i:'🌙',r:[0,5]},
      {t:'Good morning!',i:'🌅',r:[5,12]},
      {t:'Good afternoon!',i:'☀️',r:[12,17]},
      {t:'Good evening!',i:'🌆',r:[17,21]},
      {t:'Working late?',i:'🌙',r:[21,24]}
    ];
    const g=G.find(x=>h>=x.r[0]&&h<x.r[1])||G[1];
    const gt=document.getElementById('greeting-title'); if(gt) gt.textContent=g.t;
    const gi=document.getElementById('greeting-icon'); if(gi) gi.textContent=g.i;
    document.getElementById('greeting').textContent = `${S.user?.name||S.user?.username||'Student'} — Nepal Engineering & PSC exam prep.`;
    HOME.updateStats();
    HOME.updateBadges();
    STREAK.renderBar();
    HOME.renderRecent();
    HOME.tickClock();
  },
  updateStats(){
    const total=S.prog.total, correct=S.prog.correct, wrong=total-correct;
    const pct = total ? Math.round((correct/total)*100) : 0;
    const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v};
    set('hs-tot', total); set('hs-cor', correct); set('hs-wrg', wrong); set('hs-pct', pct+'%');
  },
  updateBadges(){
    const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v};
    const dueWr = REV.dueCount();
    set('bkc', S.bk.length); set('flc', S.fl.length); set('wrc', S.wr.length);
    const wrDueEl = document.getElementById('wrc-due');
    if(wrDueEl) wrDueEl.textContent = dueWr;
    const total = S.bk.length + S.fl.length + dueWr;
    const bnBadge = document.getElementById('bn-badge');
    if(bnBadge){
      if(total>0){ bnBadge.textContent = total>99?'99+':total; bnBadge.style.display=''; }
      else { bnBadge.style.display='none'; }
    }
  },
  renderRecent(){
    const el = document.getElementById('recent-sessions');
    if(!el)return;
    const sessions = S.prog.sessions.slice(0,6);
    if(!sessions.length){ el.innerHTML='<div class="empty"><div class="empty-i"><i class="ph ph-trend-up"></i></div><p>No sessions yet — start a quiz!</p></div>'; return; }
    const mIc=m=>m==='exam'?'<i class="ph ph-note-pencil"></i>':m==='flashcard'?'<i class="ph ph-lightning"></i>':'<i class="ph ph-chart-bar"></i>';
    el.innerHTML = sessions.map(s=>{
      const ic=(s.chapter||'').includes('Wrong')?'<i class="ph ph-x-circle"></i>':(s.chapter||'').includes('Daily')?'<i class="ph ph-star"></i>':(s.chapter||'').includes('Bookmarks')?'<i class="ph ph-star"></i>':mIc(s.mode);
      const cls=s.pct>=70?'tg':s.pct>=40?'ta':'tr';
      const dt=new Date(s.at).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
      return `<div class="sess-row"><span class="sess-ic">${ic}</span><div class="sess-info"><div class="sess-ch">${esc(s.chapter||'Study')}</div><div class="sess-ts">${dt}</div></div><span class="ctag ${cls}">${s.pct}%</span></div>`;
    }).join('');
  },
  _clockTimer:null,
  tickClock(){
    if(HOME._clockTimer) clearInterval(HOME._clockTimer);
    const tick=()=>{
      const now=new Date();
      const cl=document.getElementById('hclock'); if(cl) cl.textContent=now.toLocaleTimeString();
      const dt=document.getElementById('hdate'); if(dt) dt.textContent=now.toLocaleDateString(undefined,{weekday:'long',year:'numeric',month:'long',day:'numeric'});
      TT.renderCurrentSessionWidget('h-session');
    };
    tick();
    HOME._clockTimer=setInterval(tick,1000);
  }
};

/* ═══════════════ 10d. TIMETABLE ═══════════════ */
const TT = {
  add(){
    const day=Number(document.getElementById('tt-day').value);
    const name=document.getElementById('tt-name').value.trim();
    const start=document.getElementById('tt-s').value;
    const end=document.getElementById('tt-e').value;
    if(!name||!start||!end){ toast('Fill in all fields'); return; }
    S.tt.sessions.push({id:Date.now()+'', day, name, start, end});
    _save(LS.TT, S.tt);
    document.getElementById('tt-name').value='';
    TT.render();
    toast('✅ Session added');
  },
  remove(id){
    S.tt.sessions = S.tt.sessions.filter(s=>s.id!==id);
    _save(LS.TT, S.tt);
    TT.render();
  },

  /* ── Session reminders ─────────────────────────────────────────
     Notifies a configurable number of minutes before each scheduled
     session starts, while this tab/PWA is open. This is NOT push
     notifications — closing the browser/PWA stops reminders, same as
     any setInterval-based in-page feature. True background delivery
     needs server-side Web Push (a VAPID key pair + a subscription
     store on the backend), which is a materially bigger feature than
     this app's Apps Script backend currently supports — noted here
     rather than silently pretending this covers that case. */
  _reminderTimer:null,
  _notifiedToday:null,   // Set of `${dateStr}_${sessionId}` already notified

  async toggleReminders(enabled){
    if(enabled){
      if(!('Notification' in window)){
        toast('❌ Notifications aren\'t supported in this browser');
        document.getElementById('tt-remind-toggle').checked = false;
        return;
      }
      let perm = Notification.permission;
      if(perm === 'default') perm = await Notification.requestPermission();
      if(perm !== 'granted'){
        toast('❌ Notifications blocked — enable them in your browser/site settings');
        document.getElementById('tt-remind-toggle').checked = false;
        return;
      }
    }
    S.tt.reminders.enabled = enabled;
    _save(LS.TT, S.tt);
    TT._startReminderChecker();
    toast(enabled ? '🔔 Reminders on' : '🔕 Reminders off');
  },

  setLeadMinutes(mins){
    const n = Math.max(0, Math.min(60, Number(mins)||0));
    S.tt.reminders.leadMinutes = n;
    _save(LS.TT, S.tt);
  },

  _startReminderChecker(){
    if(TT._reminderTimer) clearInterval(TT._reminderTimer);
    if(!S.tt.reminders.enabled) return;
    TT._loadNotifiedToday();
    TT._checkReminders(); // catch anything due right now, then poll
    TT._reminderTimer = setInterval(TT._checkReminders, 20000);
  },

  _todayKey(){ return new Date().toISOString().slice(0,10); },

  _loadNotifiedToday(){
    const saved = _load(LS.TT_NOTIFIED, {date:'', ids:[]});
    TT._notifiedToday = (saved.date === TT._todayKey()) ? new Set(saved.ids) : new Set();
  },

  _saveNotifiedToday(){
    _save(LS.TT_NOTIFIED, {date: TT._todayKey(), ids:[...TT._notifiedToday]});
  },

  async _checkReminders(){
    if(!S.tt.reminders.enabled || !('Notification' in window) || Notification.permission !== 'granted') return;
    if(!TT._notifiedToday || TT._notifiedToday.size === undefined) TT._loadNotifiedToday();
    const now = new Date();
    const todayKey = TT._todayKey();
    if(TT._lastCheckedDay !== todayKey){ TT._lastCheckedDay = todayKey; TT._loadNotifiedToday(); }

    const lead = S.tt.reminders.leadMinutes || 0;
    const nowMs = now.getTime();
    const todayDay = now.getDay();

    for(const s of S.tt.sessions){
      if(s.day !== todayDay) continue;
      const dedupKey = `${todayKey}_${s.id}`;
      if(TT._notifiedToday.has(dedupKey)) continue;
      const [h,m] = s.start.split(':').map(Number);
      const startMs = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m).getTime();
      const fireAt = startMs - lead*60000;
      // Fire once we've reached the trigger time, but skip sessions
      // whose start already passed more than a few minutes ago (e.g.
      // the tab was closed/asleep through it) — a late reminder for a
      // session that already ended is just noise.
      if(nowMs >= fireAt && nowMs < startMs + 5*60000){
        TT._fireReminder(s, lead);
        TT._notifiedToday.add(dedupKey);
        TT._saveNotifiedToday();
      }
    }
  },

  async _fireReminder(s, lead){
    const title = lead > 0 ? `Starting in ${lead} min: ${s.name}` : `Now: ${s.name}`;
    const body = `${s.start}–${s.end}`;
    try{
      if(navigator.serviceWorker && navigator.serviceWorker.ready){
        const reg = await navigator.serviceWorker.ready;
        reg.showNotification(title, { body, icon:'./icon-192.png', tag:'tt-'+s.id });
      } else {
        new Notification(title, { body, icon:'./icon-192.png' });
      }
    }catch(e){ /* notification failures are non-fatal — the app keeps working either way */ }
  },
  /* ────────────────────────────────────────────────────────────── */

  _clockTimer:null,
  render(){
    const remindToggle = document.getElementById('tt-remind-toggle');
    const remindLead = document.getElementById('tt-remind-lead');
    if(remindToggle) remindToggle.checked = !!S.tt.reminders.enabled;
    if(remindLead) remindLead.value = S.tt.reminders.leadMinutes ?? 5;
    TT._startReminderChecker();
    if(TT._clockTimer) clearInterval(TT._clockTimer);
    const tick=()=>{
      const now=new Date();
      const cl=document.getElementById('tt-clock'); if(cl) cl.textContent=now.toLocaleTimeString();
      const dt=document.getElementById('tt-date'); if(dt) dt.textContent=now.toLocaleDateString(undefined,{weekday:'long',year:'numeric',month:'long',day:'numeric'});
      TT.renderCurrentSessionWidget('tt-now');
    };
    tick();
    TT._clockTimer=setInterval(tick,1000);

    const todayDay = new Date().getDay();
    const nowHHMM = new Date().toTimeString().slice(0,5);
    const todaySessions = S.tt.sessions.filter(s=>s.day===todayDay).sort((a,b)=>a.start.localeCompare(b.start));
    const todayEl = document.getElementById('tt-today');
    todayEl.innerHTML = todaySessions.length ? todaySessions.map(s=>{
      const isNow = s.start<=nowHHMM && nowHHMM<s.end;
      return `
      <div class="tt-row" style="${isNow?'background:rgba(245,166,35,.08);border-radius:8px;padding-left:.4rem':''}">
        <div class="tt-ti">${s.start}–${s.end}</div>
        <div class="tt-na">${isNow?'<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--ros);margin-right:.35rem"></span>':''}${esc(s.name)}</div>
        <button class="ib" onclick="TT.remove('${s.id}')" title="Remove this slot" aria-label="Remove this slot"><i class="ph ph-trash"></i></button>
      </div>
    `;}).join('') : '<div class="empty"><div class="empty-i"><i class="ph ph-calendar-blank"></i></div><p>Nothing scheduled today</p></div>';

    const weekEl = document.getElementById('tt-week');
    const todayIdx = new Date().getDay();
    weekEl.innerHTML = `
      <div style="overflow-x:auto;-webkit-overflow-scrolling:touch">
      <div style="display:grid;grid-template-columns:repeat(7,minmax(78px,1fr));gap:4px;margin-bottom:.5rem;min-width:560px">
        ${DAYS.map((d,i)=>`
          <div style="text-align:center;font-size:.62rem;font-weight:800;text-transform:uppercase;letter-spacing:.6px;
            color:${i===todayIdx?'var(--neon)':'var(--t3)'};
            padding:.3rem .2rem;
            border-bottom:2px solid ${i===todayIdx?'var(--neon)':'var(--bd)'}">
            ${d.slice(0,3)}
          </div>
        `).join('')}
      </div>
      <div style="display:grid;grid-template-columns:repeat(7,minmax(78px,1fr));gap:4px;align-items:start;min-width:560px">
        ${DAYS.map((d,di)=>{
          const sess = S.tt.sessions.filter(s=>s.day===di).sort((a,b)=>a.start.localeCompare(b.start));
          const isToday = di===todayIdx;
          return `<div style="min-height:60px;background:${isToday?'rgba(0,229,255,.04)':'var(--bg1)'};border-radius:var(--r1);border:1px solid ${isToday?'rgba(0,229,255,.18)':'var(--bd)'};padding:.3rem .25rem">
            ${sess.length ? sess.map(s=>`
              <div style="background:${isToday?'rgba(0,229,255,.1)':'var(--surf2)'};border:1px solid ${isToday?'rgba(0,229,255,.25)':'var(--bd)'};border-radius:6px;padding:.28rem .35rem;margin-bottom:3px;cursor:default"
                title="${esc(s.name)} ${s.start}–${s.end}">
                <div style="font-size:.6rem;font-weight:700;color:${isToday?'var(--neon)':'var(--t3)'}">${s.start}</div>
                <div style="font-size:.65rem;font-weight:600;color:var(--t1);overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${esc(s.name)}</div>
                <button onclick="TT.remove('${s.id}')" style="background:none;border:none;color:var(--t3);font-size:.65rem;cursor:pointer;padding:0;float:right"><i class="ph ph-x"></i></button>
              </div>
            `).join('') : `<div style="text-align:center;color:var(--t3);font-size:.6rem;margin-top:.5rem">—</div>`}
          </div>`;
        }).join('')}
      </div>
      </div>
    `;
  },
  renderCurrentSessionWidget(elId){
    const el=document.getElementById(elId);
    if(!el)return;
    const now=new Date();
    const hhmm = now.toTimeString().slice(0,5);
    const todayDay = now.getDay();
    const active = S.tt.sessions.find(s=>s.day===todayDay && s.start<=hhmm && hhmm<s.end);
    const next = S.tt.sessions.filter(s=>s.day===todayDay && s.start>hhmm).sort((a,b)=>a.start.localeCompare(b.start))[0];
    if(active){
      el.innerHTML = `<div class="tt-now"><div class="tt-nl">Now</div><div class="tt-nn">${esc(active.name)}</div><div class="tt-nt">until ${active.end}</div></div>`;
    } else if(next){
      el.innerHTML = `<div class="tt-now"><div class="tt-nl">Next</div><div class="tt-nn">${esc(next.name)}</div><div class="tt-nt">starts ${next.start}</div></div>`;
    } else {
      el.innerHTML = `<div style="font-size:.74rem;color:var(--t3);text-align:center;padding:.4rem 0">No more sessions today</div>`;
    }
  },
  exportJ(){
    const blob=new Blob([JSON.stringify(S.tt,null,2)],{type:'application/json'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='timetable.json';a.click();
  },
  importJ(){
    const inp=document.createElement('input');inp.type='file';inp.accept='.json';
    inp.onchange=()=>{
      const f=inp.files[0]; if(!f)return;
      const r=new FileReader();
      r.onload=e=>{
        try{
          const data=JSON.parse(e.target.result);
          if(data && Array.isArray(data.sessions)){ S.tt=data; if(!S.tt.reminders) S.tt.reminders={enabled:false, leadMinutes:5}; _save(LS.TT,S.tt); TT.render(); toast('✅ Timetable imported'); }
          else toast('❌ Invalid timetable file');
        }catch{toast('❌ Invalid JSON')}
      };
      r.readAsText(f);
    };
    inp.click();
  }
};

/* ═══════════════ 10e. OFFLINE CACHE ═══════════════ */
const CACHE = {
  async render(){
    const refs = ChapterData.allFileRefs();
    const cachedKeys = new Set(await QDB.keys());
    function _isCached(key){ return cachedKeys.has(key); }
    let cachedCount=0;
    refs.forEach(r=>{ if(_isCached(r.key)) cachedCount++; });
    const tag=document.getElementById('cache-tag');
    tag.textContent = cachedCount===refs.length && refs.length ? 'Fully cached' : cachedCount>0 ? 'Partially cached' : 'Not cached';
    tag.className = 'ctag ' + (cachedCount===refs.length && refs.length ? 'tg' : cachedCount>0 ? 'ta' : 'tr');
    document.getElementById('cache-txt').textContent = `${cachedCount} of ${refs.length} question sets cached on this device for offline use.`;

    const grid=document.getElementById('cache-grid');
    const levels = ChapterData.levels();
    grid.innerHTML = levels.map(lv=>{
      const lvRefs = refs.filter(r=>r.lv===lv);
      const lvCached = lvRefs.filter(r=>_isCached(r.key)).length;
      return `<div class="ci"><div class="ci-n">${esc(ChapterData.levelLabel(lv))}</div>
        <div class="ci-s"><div class="cd ${lvCached===lvRefs.length&&lvRefs.length?'y':'n'}"></div>${lvCached}/${lvRefs.length} cached</div></div>`;
    }).join('');
  },
  async dl(){
    const refs = ChapterData.allFileRefs();
    if(!refs.length){ toast('No content configured to cache'); return; }
    if(!S.online){ toast('❌ You need to be online to download the cache'); return; }
    const pb=document.getElementById('cpb'), pf=document.getElementById('cpf'), txt=document.getElementById('cptxt');
    pb.style.display='';
    let done=0, failed=0;
    for(const ref of refs){
      txt.textContent = `Caching: ${ref.name} (${done+1}/${refs.length})…`;
      pf.style.width = `${(done/refs.length)*100}%`;
      try{
        await QUIZ._fetch(ref.fid, ref.key);
      }catch(err){
        failed++;
        txt.textContent = `⚠️ Failed: ${ref.name} — retrying…`;
        try{ await new Promise(r=>setTimeout(r,2000)); await QUIZ._fetch(ref.fid, ref.key); failed--; }catch{}
      }
      done++;
      pf.style.width = `${(done/refs.length)*100}%`;
    }
    const ok = done - failed;
    txt.textContent = failed>0 ? `⚠️ Cached ${ok}/${refs.length} sets (${failed} failed — check connection)` : `✅ All ${done} sets cached successfully`;
    toast(failed>0 ? `⚠️ ${ok}/${refs.length} cached — ${failed} failed` : '✅ Offline cache complete');
    CACHE.render();
  },
  async clr(){
    if(!confirm('Clear all cached question data? You will need internet to reload it.'))return;
    await QDB.clear();
    toast('🗑 Cache cleared');
    CACHE.render();
  },
  async purgeStale(){
    let purged = 0;
    const keys = await QDB.keys();
    for(const k of keys){
      const v = await QDB.get(k);
      if(v && typeof v === 'object' && !Array.isArray(v) && v.success === false){
        await QDB.del(k);
        purged++;
      }
    }
    if(purged > 0){ toast(`🧹 Removed ${purged} stale error cache entry${purged>1?'s':''}`); CACHE.render(); }
    else toast('✅ No stale cache entries found');
  },

  async autoSync(){
    if(!S.online || S.forcedOffline) return;
    const cachedKeys = new Set(await QDB.keys());
    const missing = ChapterData.allFileRefs().filter(r=>!cachedKeys.has(r.key));
    if(!missing.length) return;
    CACHE._badge(`📦 Downloading 0/${missing.length}…`);
    let done=0;
    for(const ref of missing){
      try{ await QUIZ._fetch(ref.fid, ref.key); }catch{ /* skip failures quietly */ }
      done++;
      CACHE._badge(`📦 Downloading ${done}/${missing.length}…`);
    }
    CACHE._badge(null);
    if(UI.cur==='offline') CACHE.render();
  },
  _badge(msg){
    let el = document.getElementById('cache-autobadge');
    if(msg===null){ if(el) el.style.display='none'; return; }
    if(!el){
      el = document.createElement('div');
      el.id = 'cache-autobadge';
      el.style.cssText = 'position:fixed;bottom:calc(var(--bn-h,0px) + 1rem + var(--safe-b,0px));left:1rem;background:var(--c2);border:1px solid var(--bd);border-radius:999px;padding:.4rem .8rem;font-size:.7rem;color:var(--t2);z-index:9998;box-shadow:var(--sh3);display:flex;align-items:center;gap:.4rem';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.display = 'flex';
  }
};

/* ═══════════════ 10f. DATA MANAGEMENT ═══════════════ */
const DATA = {
  async syncNow(){
    if(!S.online){ toast('❌ Need internet to back up'); return; }
    PSYNC._setStatus('Backing up…');
    await PSYNC.pushNow();
  },
  async restoreCloud(){
    if(!S.online){ toast('❌ Need internet to restore'); return; }
    if(!confirm('Replace progress, bookmarks, flags, and wrong-answer bank on THIS device with your last cloud backup? This cannot be undone.')) return;
    PSYNC._setStatus('Restoring…');
    await PSYNC.forceRestore();
  },
  exp(){
    const payload = { prog:S.prog, bk:S.bk, fl:S.fl, wr:S.wr, tt:S.tt, stk:S.stk, exportedAt:new Date().toISOString() };
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='abhyas-backup.json';a.click();
    toast('📤 Exported');
  },
  imp(){
    const inp=document.createElement('input');inp.type='file';inp.accept='.json';
    inp.onchange=()=>{
      const f=inp.files[0]; if(!f)return;
      const r=new FileReader();
      r.onload=e=>{
        try{
          const data=JSON.parse(e.target.result);
          if(data.prog){ S.prog=data.prog; if(typeof migrateSessionScopes === 'function') migrateSessionScopes(); _save(LS.PROG,S.prog); }
          if(data.bk){ S.bk=data.bk; _save(LS.BK,S.bk); }
          if(data.fl){ S.fl=data.fl; _save(LS.FL,S.fl); }
          if(data.wr){ S.wr=data.wr; _save(LS.WR,S.wr); }
          if(data.tt){ S.tt=data.tt; if(!S.tt.reminders) S.tt.reminders={enabled:false, leadMinutes:5}; _save(LS.TT,S.tt); }
          if(data.stk){ S.stk=data.stk; _save(LS.STK,S.stk); }
          toast('✅ Data imported');
          HOME.render(); PROG.render();
        }catch{ toast('❌ Invalid backup file'); }
      };
      r.readAsText(f);
    };
    inp.click();
  },
  async clearQ(){
    if(!confirm('Clear cached question downloads? Your progress/bookmarks stay intact.'))return;
    await QDB.clear();
    toast('🧹 Question cache cleared');
  },
  reset(){
    if(!confirm('⚠️ This deletes ALL progress, bookmarks, flags, wrong answers, and timetable on this device. Continue?'))return;
    if(!confirm('Are you absolutely sure? This cannot be undone.'))return;
    [LS.PROG,LS.BK,LS.FL,LS.WR,LS.TT,LS.STK].forEach(k=>localStorage.removeItem(k));
    toast('⚠️ All data reset');
    location.reload();
  }
};

/* ═══════════════ TUTORIAL ═══════════════ */
const TUTORIAL = {
  _seenKey: 'abhyas_tut_seen',
  _steps: [
    {
      icon: '<i class="ph ph-hand-waving"></i>',
      title: 'Welcome to Abhyas',
      body: `<p>This is your Smart Study Hub for Nepal Engineering (Level 5/7) and PSC/Loksewa prep. Once a chapter is cached it works fully offline — handy for load-shedding or weak signal.</p>`
    },
    {
      icon: '<i class="ph ph-key"></i>',
      title: 'Your account status',
      body: `
        <p>Check the sidebar under your name for your current status:</p>
        <ul style="margin:0 0 0 1.1rem;padding:0">
          <li><b><i class="ph ph-hourglass"></i> Trial</b> — free access, counts down live. Pay anytime from the payment screen to go permanent.</li>
          <li><b><i class="ph ph-check-circle"></i> Permanent</b> — verified, unlimited access forever, fully usable offline.</li>
          <li><b><i class="ph ph-calendar-blank"></i> Yearly</b> — active until the renewal date shown in the sidebar.</li>
        </ul>
        <p style="margin-top:.5rem">Once you're Trial, Permanent, or active Yearly, you land straight here next time — no re-login needed on this device, even offline.</p>`
    },
    {
      icon: '<i class="ph ph-house"></i>',
      title: 'Your Dashboard',
      body: `
        <p>The Dashboard (<i class="ph ph-house"></i>) is home base:</p>
        <ul style="margin:0 0 0 1.1rem;padding:0">
          <li><b><i class="ph ph-star"></i> Daily Challenge</b> — 30 mixed questions, keeps your streak alive.</li>
          <li><b><i class="ph ph-lightning"></i> Adaptive Practice</b> — pulls the questions you're actually struggling with first.</li>
          <li>Quick stats and Quick Action tiles for everything else in the app.</li>
        </ul>`
    },
    {
      icon: '<i class="ph ph-book-open"></i>',
      title: 'Studying a chapter',
      body: `
        <p>Open <b>Online Study</b> or <b>Local File</b> from the sidebar, pick a chapter, choose how many questions and whether to shuffle, then pick a mode:</p>
        <ul style="margin:0 0 0 1.1rem;padding:0">
          <li><b>Practice</b> — instant feedback, no time pressure.</li>
          <li><b><i class="ph ph-note-pencil"></i> Exam</b> — timed, graded at the end.</li>
          <li><b><i class="ph ph-lightning"></i> Flashcard</b> — quick flip-through review.</li>
        </ul>
        <p style="margin-top:.5rem">Shortcuts while answering: <b>A/B/C/D</b> or <b>1–5</b> to pick an option, <b>←/→</b> between cards, <b>Esc</b> to quit.</p>`
    },
    {
      icon: '<i class="ph ph-star"></i>',
      title: 'Bookmarks, Flags & Wrong Bank',
      body: `
        <p>Tag any question while studying:</p>
        <ul style="margin:0 0 0 1.1rem;padding:0">
          <li><b><i class="ph ph-star"></i> Bookmarks</b> — save with a label (Need Check, Interesting, Debating, Confusing, Formulae).</li>
          <li><b><i class="ph ph-flag"></i> Flagged</b> — a quick "come back to this" marker.</li>
          <li><b><i class="ph ph-x-circle"></i> Wrong Bank</b> — anything you get wrong lands here automatically, and needs two correct answers in a row, spaced a few days apart, before it's considered mastered.</li>
        </ul>`
    },
    {
      icon: '<i class="ph ph-calendar-blank"></i>',
      title: 'Timetable & Progress',
      body: `<p><b>Timetable</b> lets you block out study sessions by day/time — the Dashboard clock shows what's happening right now. <b>Progress</b> tracks your accuracy over time and predicts your likely exam marks from recent sessions.</p>`
    },
    {
      icon: '<i class="ph ph-package"></i>',
      title: 'Offline & installing the app',
      body: `
        <p>Chapters you open get cached automatically for offline use — check <b>Offline Cache</b> in the sidebar to manage what's stored on this device.</p>
        <p style="margin-top:.5rem">Tap the <b><i class="ph ph-device-mobile"></i></b> icon in the top bar to install Abhyas to your home screen — it then opens like a normal app, even with no signal. You can reopen this tutorial anytime from the sidebar or the Dashboard's Quick Actions.</p>`
    }
  ],
  _idx: 0,

  maybeAutoOpen(user) {
    if (!user || !user.username) return;
    const seen = _load(TUTORIAL._seenKey, {});
    if (seen[user.username]) return;
    setTimeout(() => TUTORIAL.open(), 600);
  },

  open() {
    if (document.getElementById('tut-modal')) return;
    TUTORIAL._idx = 0;
    const modal = document.createElement('div');
    modal.id = 'tut-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.78);display:flex;align-items:center;justify-content:center;z-index:10001;padding:1.2rem;backdrop-filter:blur(4px)';
    modal.innerHTML = `
      <div style="background:var(--c2);border:1px solid var(--bd);border-radius:var(--r3);padding:1.4rem;max-width:420px;width:100%;box-shadow:var(--sh3);max-height:88vh;display:flex;flex-direction:column">
        <div id="tut-dots" style="display:flex;gap:.3rem;margin-bottom:.9rem;justify-content:center"></div>
        <div style="flex:1;overflow-y:auto;min-height:0" id="tut-body"></div>
        <div style="display:flex;gap:.4rem;margin-top:1rem">
          <button id="tut-back" style="padding:.6rem .9rem;background:var(--b0);border:1px solid var(--b1);border-radius:var(--r2);color:var(--t2);font-size:.82rem;cursor:pointer;font-family:var(--ff)">← Back</button>
          <button id="tut-next" style="flex:1;padding:.62rem;background:linear-gradient(135deg,var(--amb2),var(--amb));border:none;border-radius:var(--r2);color:var(--on-accent);font-weight:700;font-size:.85rem;cursor:pointer;font-family:var(--ff)">Next →</button>
        </div>
        <button id="tut-skip" style="margin-top:.55rem;background:none;border:none;color:var(--t3);font-size:.72rem;cursor:pointer;font-family:var(--ff);text-decoration:underline">Skip tutorial</button>
      </div>`;
    document.body.appendChild(modal);
    document.getElementById('tut-back').onclick = () => TUTORIAL._go(-1);
    document.getElementById('tut-next').onclick = () => TUTORIAL._go(1);
    document.getElementById('tut-skip').onclick = () => TUTORIAL._finish();
    TUTORIAL._render();
  },

  _go(dir) {
    const n = TUTORIAL._idx + dir;
    if (n < 0) return;
    if (n >= TUTORIAL._steps.length) { TUTORIAL._finish(); return; }
    TUTORIAL._idx = n;
    TUTORIAL._render();
  },

  _render() {
    const step = TUTORIAL._steps[TUTORIAL._idx];
    const body = document.getElementById('tut-body');
    if (!body) return;
    body.innerHTML = `
      <div style="font-size:1.6rem;margin-bottom:.3rem">${step.icon}</div>
      <div style="font-family:var(--fd);font-size:1rem;font-weight:700;color:var(--t1);margin-bottom:.5rem">${step.title}</div>
      <div style="font-size:.82rem;color:var(--t2);line-height:1.55">${step.body}</div>`;
    const dots = document.getElementById('tut-dots');
    if (dots) {
      dots.innerHTML = TUTORIAL._steps.map((_, i) =>
        `<div style="width:${i === TUTORIAL._idx ? '18px' : '6px'};height:6px;border-radius:3px;background:${i === TUTORIAL._idx ? 'var(--amb)' : 'var(--b1)'};transition:.2s"></div>`
      ).join('');
    }
    const backBtn = document.getElementById('tut-back');
    if (backBtn) backBtn.style.visibility = TUTORIAL._idx === 0 ? 'hidden' : 'visible';
    const nextBtn = document.getElementById('tut-next');
    if (nextBtn) nextBtn.textContent = TUTORIAL._idx === TUTORIAL._steps.length - 1 ? "Got it — let's study! →" : 'Next →';
  },

  _finish() {
    const modal = document.getElementById('tut-modal');
    if (modal) modal.remove();
    if (S.user && S.user.username) {
      const seen = _load(TUTORIAL._seenKey, {});
      seen[S.user.username] = true;
      _save(TUTORIAL._seenKey, seen);
    }
  }
};

/* ═══════════════ 11. APP BOOT ═══════════════ */
const APP = {
  async init(){
    if(_load('abhyas_theme','light')==='dark') document.body.classList.add('dark');
    const verEl = document.getElementById('sb-version');
    if(verEl) verEl.textContent = `${APP_NAME} (v${APP_VERSION})`;

    await QDB.migrateFromLocalStorage();
    // Migrate old session scopes (function in cloud-sync.js)
    if (typeof migrateSessionScopes === 'function') migrateSessionScopes();

    // Clear stale QDB entries
    const qKeys = await QDB.keys();
    for(const k of qKeys){
      try{
        const v = await QDB.get(k);
        if(v && typeof v==='object' && !Array.isArray(v) && v.success===false) await QDB.del(k);
      }catch{}
    }

    // Generate unique user ID if missing
    if (!S.profile.id) {
      S.profile.id = 'ha-' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 9);
      _save(LS.PROFILE, S.profile);
    }

    UI.go('home');
    CACHE.render();
    _updateNetBtn();
    _updateOfflineWarn();
    AUTH.startPeriodicRecheck();
    CACHE.autoSync();
    QUIZ.checkResumableExam();
  }
};

/* ── network status wiring ── */
function _updateOfflineWarn(){
  const el = document.getElementById('on-offline-warn');
  if(el) el.style.display = (S.online && !S.forcedOffline) ? 'none' : 'flex';
}
function _updateNetBtn(){
  const btn = document.getElementById('net-mode-btn');
  if(!btn) return;
  const effectivelyOnline = S.online && !S.forcedOffline;
  // A colored icon SHAPE (wifi vs wifi-off), not just a colored dot —
  // two similarly-sized colored circles sitting next to each other in
  // the header (this button + the sync-status dot) were only
  // distinguishable by hue, which is both an accessibility problem and
  // a genuine "which one is which" recognition problem at a glance.
  btn.innerHTML = `<i class="ph ${effectivelyOnline ? 'ph-wifi-high' : 'ph-wifi-slash'}"></i>`;
  btn.title = effectivelyOnline ? 'Online mode — click to force offline' : S.forcedOffline ? 'Forced offline mode — click to go online' : 'Network offline — no connection';
  btn.setAttribute('aria-label', btn.title);
  btn.style.color = effectivelyOnline ? 'var(--grn)' : 'var(--ros)';
  btn.style.borderColor = effectivelyOnline ? 'rgba(34,197,94,.35)' : 'var(--bad-bd)';
  btn.style.background = effectivelyOnline ? 'rgba(34,197,94,.08)' : 'var(--bad-bg)';
  btn.classList.toggle('forced', S.forcedOffline);
  const offbar = document.getElementById('offbar');
  if(offbar){
    if(!S.online){
      offbar.textContent = '📡 Network offline — serving from local cache';
      offbar.classList.add('show');
    } else if(S.forcedOffline){
      offbar.textContent = '🔴 Offline mode forced — network blocked by you';
      offbar.classList.add('show');
    } else {
      offbar.classList.remove('show');
    }
  }
}

/* ═══════════════ NET – manual online/offline toggle ═══════════════ */
const NET = {
  toggle(){
    if(!S.online && !S.forcedOffline){
      toast('📡 No network connection — connect to the internet first');
      return;
    }
    S.forcedOffline = !S.forcedOffline;
    _save(LS.FORCED_OFFLINE, S.forcedOffline);
    if(S.forcedOffline){
      toast('🔴 Offline mode on — all network requests blocked');
    } else {
      toast('🟢 Online mode restored — network requests allowed');
    }
    _updateNetBtn();
    _updateOfflineWarn();
  }
};

window.addEventListener('online', async ()=>{
  const reallyOnline = await NETCHECK.ping();
  if(!reallyOnline) return;
  if(!S.forcedOffline) toast('🌐 Back online');
  else toast('🌐 Network restored — still in forced offline mode');
});
window.addEventListener('offline', ()=>{
  const wasForcedOff = S.forcedOffline;
  S.online=false;
  if(!wasForcedOff){
    toast('📡 Network lost — switched to offline mode automatically');
  }
  _updateNetBtn();
  _updateOfflineWarn();
});

/* ── boot sequence ── */
document.addEventListener('DOMContentLoaded', ()=>{
  if(_load('abhyas_theme','light')==='dark') document.body.classList.add('dark');
  PWA.init();
  AUTH.restore();
  NETCHECK.start();
});

/* ═══════════════ EXPLICIT GLOBAL EXPOSURE ═══════════════ */
window.AUTH = AUTH;
window.NET = NET;
window.UI = UI;
window.ON = ON;
window.LOC = LOC;
window.PSY = PSY;
window.REV = REV;
window.QUIZ = QUIZ;
window.PWA = PWA;
window.PROG = PROG;
window.HOME = HOME;
window.STREAK = STREAK;
window.TT = TT;
window.CACHE = CACHE;
window.DATA = DATA;
window.TUTORIAL = TUTORIAL;
window.APP = APP;
window.WEEKLY = WEEKLY;
// CLOUD is exposed from cloud-sync.js
