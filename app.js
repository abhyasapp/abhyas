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
const SR_INTERVALS = [1, 3, 7, 14];

// Weekly Sets get a fixed exam window: once released, a student has
// this many hours to take it as a timed, graded Exam — one official
// attempt. After the window closes, the set never disappears — it just
// switches to unlimited Flashcard-mode review.
const WEEKLY_EXAM_WINDOW_HOURS = 12;

const LS = {
  USER:'abhyas_session',
  PROG:'abhyas_prog', BK:'abhyas_bk', FL:'abhyas_fl', WR:'abhyas_wr',
  QC:'abhyas_qc_', TT:'abhyas_tt', TT_NOTIFIED:'abhyas_tt_notified', STK:'abhyas_stk',
  FORCED_OFFLINE:'abhyas_forced_off',
  EXAM_SNAP:'abhyas_exam_snap',
  FCOUNT:'abhyas_fcount',
  CLOUD:'abhyas_cloud',
  PROFILE:'abhyas_profile',
  CHAPSTATS:'abhyas_chapstats',
  // FIX #1: Tracks which user's data is currently sitting in localStorage
  // for this device. When a DIFFERENT user logs in on a shared device,
  // AUTH._enter() wipes the previous user's local data before init, so
  // user B never silently inherits user A's progress/bookmarks/streak.
  // This is what makes PSYNC.pullIfEmpty()'s "looks empty" check safe on
  // shared devices — otherwise it would skip the cloud pull because the
  // previous user's data still looked non-empty.
  LAST_USER:'abhyas_last_user'
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
  chapStats: _load(LS.CHAPSTATS, {}),
  dpi: null,
  localQs: null,
  quiz: {qs:[],ans:[],mode:'',idx:0,timer:null,elapsed:0,left:0,active:false,ch:'',scope:null},
  cloud: _load(LS.CLOUD, {fid:''}),
  profile: _load(LS.PROFILE, {ver:1, id:''})
};
// Existing saved S.tt (from before the reminders feature existed) won't
// have a .reminders field — _load() returns saved data as-is, it doesn't
// deep-merge against the default above. Guard it explicitly rather than
// relying on every reader to optional-chain.
if(!S.tt.reminders) S.tt.reminders = {enabled:false, leadMinutes:5};

/* ═══════════════ 3. UTILITIES ═══════════════ */
function _load(k,d){try{const v=localStorage.getItem(k);return v?JSON.parse(v):d}catch{return d}}
const PSYNC_KEYS = new Set([LS.BK, LS.FL, LS.WR, LS.PROG, LS.STK, LS.CHAPSTATS]);
let _lastStorageWarnAt = 0;
function _save(k,v){
  try{
    localStorage.setItem(k,JSON.stringify(v));
    if(PSYNC_KEYS.has(k)) PSYNC.scheduleSync();
    return true;
  }catch(e){
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
function fmtHMS(s){
  if(s<0)s=0;
  const h=Math.floor(s/3600), m=Math.floor((s%3600)/60), sec=s%60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}
function today(){
  const d=new Date();
  const pad=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function localDateOffset(baseDate, daysOffset){
  const d=new Date(baseDate);
  d.setDate(d.getDate()+daysOffset);
  const pad=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function isOk(sel,cor){
  if(sel===null||sel===undefined||cor===null||cor===undefined)return false;
  const s=String(sel).trim(),c=String(cor).trim();
  return(!isNaN(s)&&!isNaN(c)&&s!==''&&c!=='')?Number(s)===Number(c):s.toLowerCase()===c.toLowerCase();
}
function _resolveQImg(raw){
  const v = String(raw || '').trim();
  if(!v) return null;
  if(v.startsWith('data:image')) return v;
  if(/^https?:\/\//.test(v)){
    const m = v.match(/\/d\/([a-zA-Z0-9_-]{10,})/) || v.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
    return m ? `https://drive.google.com/thumbnail?id=${m[1]}&sz=w1200` : v;
  }
  if(/^[a-zA-Z0-9_-]{10,}$/.test(v)) return `https://drive.google.com/thumbnail?id=${v}&sz=w1200`;
  return null;
}
function qImgHtml(q){
  if(!q.img) return '';
  const alt = q.imgCaption || 'Question figure';
  return `<div style="margin:.4rem 0"><img src="${esc(q.img)}" alt="${esc(alt)}" style="max-width:100%;border-radius:8px;border:1px solid var(--b1);display:block" loading="lazy" onerror="this.parentElement.style.display='none'"></div>`;
}
function qSearchHtml(q){
  const optsText = (q.options||[]).map((o,i)=>String.fromCharCode(65+i)+') '+o).join('  ');
  const query = encodeURIComponent(((q.q||'')+'  '+optsText).trim().slice(0,300));
  return `<a class="ib" href="https://www.google.com/search?q=${query}" target="_blank" rel="noopener" title="Search on Google" aria-label="Search this question on Google"><i class="ph ph-magnifying-glass"></i></a>`;
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
      img: _resolveQImg(q.img || q.image || q.Image || q.figure || q.diagram || ''),
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

// FIX #3: Single source of truth for "is anything modal-blocking the
// quiz right now". The keyboard handler below consults this so pressing
// 1-5 / a-d / arrows while the report, exit-guard, or resume dialogs
// are open never answers a question underneath the overlay.
function _anyModalOpen(){
  if(document.getElementById('mbg')?.classList.contains('show')) return true;
  return !!document.querySelector('#quiz-limit-modal, #exam-resume-modal, #quiz-exit-modal, #quiz-error-card, #quiz-loader');
}

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

/* ═══════════════ 3c. CHAPSTATS — durable per-chapter accuracy ═══════════════ */
const CHAPSTATS = {
  record(sess){
    const key = sess.chapter || 'Unknown';
    const rec = S.chapStats[key] || {attempted:0, correct:0, sessions:0, lastAt:0};
    rec.attempted += sess.total || 0;
    rec.correct += sess.correct || 0;
    rec.sessions += 1;
    rec.lastAt = sess.at || Date.now();
    S.chapStats[key] = rec;
    _save(LS.CHAPSTATS, S.chapStats);
  },
  entries(){
    return Object.entries(S.chapStats)
      .map(([chapter, d]) => ({
        chapter, attempted: d.attempted, correct: d.correct,
        accuracy: d.attempted ? Math.round((d.correct/d.attempted)*100) : 0,
        sessions: d.sessions, lastAt: d.lastAt
      }))
      .sort((a,b)=>b.lastAt-a.lastAt);
  },
  rebuildFromSessions(){
    const rebuilt = {};
    (S.prog.sessions||[]).forEach(s=>{
      const key = s.chapter || 'Unknown';
      const rec = rebuilt[key] || {attempted:0, correct:0, sessions:0, lastAt:0};
      rec.attempted += s.total || 0;
      rec.correct += s.correct || 0;
      rec.sessions += 1;
      if((s.at||0) > rec.lastAt) rec.lastAt = s.at||0;
      rebuilt[key] = rec;
    });
    Object.entries(rebuilt).forEach(([key, rec])=>{
      if(!S.chapStats[key]) S.chapStats[key] = rec;
    });
    _save(LS.CHAPSTATS, S.chapStats);
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
  // FIX #1: Before handing control to APP.init()/PSYNC.pullIfEmpty(),
  // check whether the account logging in is the SAME account whose data
  // is already in localStorage. If it isn't, wipe every user-scoped key
  // first — otherwise a second user on a shared device silently inherits
  // the first user's progress, bookmarks, wrong-bank, streak, and
  // chapStats, and pullIfEmpty() then SKIPS the cloud restore (because
  // the data "looks" non-empty). The IndexedDB question cache is left
  // alone — it holds only publicly-shared question content, not
  // per-user data, so sharing it across accounts on one device is
  // actually a feature.
  _resetUserScopedLocalDataIfDifferentUser(username){
    const lastUser = _load(LS.LAST_USER, '');
    if(lastUser && lastUser !== username){
      [LS.PROG, LS.BK, LS.FL, LS.WR, LS.STK, LS.CHAPSTATS, LS.TT, LS.EXAM_SNAP].forEach(k=>{
        try{ localStorage.removeItem(k); }catch(e){}
      });
      S.prog = {total:0, correct:0, sessions:[]};
      S.bk = []; S.fl = []; S.wr = [];
      S.stk = {days:[], last:''};
      S.chapStats = {};
      S.tt = {sessions:[], reminders:{enabled:false, leadMinutes:5}};
    }
    _save(LS.LAST_USER, username);
  },
  _enter(user){
    S.user = user;
    AUTH._resetUserScopedLocalDataIfDifferentUser(user.username);
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
    // FIX #1: Also clear LAST_USER so the next login on this device —
    // even if it's the SAME account — takes the fresh-pull path, which
    // is the correct behavior after an explicit logout (the user may be
    // logging back in on a different browser profile or expecting a
    // clean slate). The cloud copy is intact; pullIfEmpty() restores.
    localStorage.removeItem(LS.LAST_USER);
    window.location.href = 'index.html';
  },
  _revalidateTimer:null,
  _visibilityBound:false,
  RECHECK_MS: 10*60*1000,
  startPeriodicRecheck(){
    if(AUTH._revalidateTimer) clearInterval(AUTH._revalidateTimer);
    AUTH._revalidateTimer = setInterval(()=>AUTH._periodicRecheckTick(), AUTH.RECHECK_MS);
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
      } else if(res.sessionInvalid){
        localStorage.removeItem(LS.USER);
        AUTH._bounce();
      }
    }catch(e){ console.warn('[AUTH] periodic session recheck failed, will retry next interval:', e); }
  }
};

/* ═══════════════ 4b. PSYNC — background progress backup ═══════════════ */
const PSYNC = {
  _timer: null,
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
  flushOnHide(){
    if(!this._timer || !S.online || !S.user || !S.user.token) return;
    clearTimeout(this._timer);
    this._timer = null;
    try{
      const body = JSON.stringify({ action:'saveProgress', username:S.user.username, token:S.user.token, data:this._syncPayload() });
      navigator.sendBeacon?.(APPS, new Blob([body], {type:'text/plain'}));
    }catch(e){}
  },
  _MAX_SYNCED_SESSIONS: 500,
  _MAX_SYNCED_LIST_ITEMS: 300,
  // FIX #5: The server rejects payloads over 45,000 chars (Sheets cell
  // cap). Per-list COUNT caps alone don't guarantee that — 300 items ×
  // ~400 chars of question text+options, times three lists, easily blows
  // past it. So after building the payload the "natural" way, this
  // measures the actual JSON length and, if it's over a safe ceiling
  // (44,000 — leaves 1,000 chars of headroom for the request envelope),
  // trims the largest list iteratively until it fits. chapStats and prog
  // are never trimmed here — they're small and durable (see the module
  // comment on CHAPSTATS) and losing them is worse than losing a handful
  // of older bookmarks.
  _SYNC_PAYLOAD_CEILING: 44000,
  _capList(arr, max){
    return Array.isArray(arr) && arr.length > max ? arr.slice(-max) : arr;
  },
  _syncPayload(){
    const prog = S.prog && S.prog.sessions && S.prog.sessions.length > this._MAX_SYNCED_SESSIONS
      ? { ...S.prog, sessions: S.prog.sessions.slice(-this._MAX_SYNCED_SESSIONS) }
      : S.prog;
    const build = (bkMax, flMax, wrMax) => JSON.stringify({
      prog,
      chapStats: S.chapStats,
      bk: this._capList(S.bk, bkMax),
      fl: this._capList(S.fl, flMax),
      wr: this._capList(S.wr, wrMax),
      stk: S.stk
    });
    let bkMax = this._MAX_SYNCED_LIST_ITEMS;
    let flMax = this._MAX_SYNCED_LIST_ITEMS;
    let wrMax = this._MAX_SYNCED_LIST_ITEMS;
    let payload = build(bkMax, flMax, wrMax);
    // Halve the biggest of the three until it fits, or until all three
    // are tiny enough that further trimming is clearly not the answer.
    let guard = 0;
    while(payload.length > this._SYNC_PAYLOAD_CEILING && guard < 12){
      guard++;
      const bkLen = (S.bk||[]).length * bkMax;
      const flLen = (S.fl||[]).length * flMax;
      const wrLen = (S.wr||[]).length * wrMax;
      const maxLen = Math.max(bkLen, flLen, wrLen);
      if(maxLen === 0) break;
      if(bkLen === maxLen && bkMax > 20) bkMax = Math.floor(bkMax/2);
      else if(flLen === maxLen && flMax > 20) flMax = Math.floor(flMax/2);
      else if(wrLen === maxLen && wrMax > 20) wrMax = Math.floor(wrMax/2);
      else break;
      payload = build(bkMax, flMax, wrMax);
    }
    return payload;
  },
  async pushNow(){
    // FIX #12: Respect forcedOffline explicitly rather than relying on
    // netFetch throwing — a scheduled push that fires while the user is
    // in manual offline mode should quietly no-op, not flip the sync
    // indicator into an error state.
    if(!S.online || S.forcedOffline || !S.user || !S.user.token) return;
    this._setState('syncing');
    const payload = this._syncPayload();
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
      if(data.chapStats){
        Object.entries(data.chapStats).forEach(([key, rec])=>{
          const existing = S.chapStats[key];
          if(!existing || rec.attempted > existing.attempted) S.chapStats[key] = rec;
        });
        _save(LS.CHAPSTATS, S.chapStats);
      }
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

document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='hidden') PSYNC.flushOnHide(); });
window.addEventListener('pagehide', ()=>PSYNC.flushOnHide());

/* ═══════════════ 4c. PUSH — Firebase Cloud Messaging notifications ═══════ */
const PUSH = {
  _messaging: null,
  supported(){
    return typeof FIREBASE_CONFIGURED !== 'undefined' && FIREBASE_CONFIGURED
      && 'Notification' in window && 'serviceWorker' in navigator
      && typeof firebase !== 'undefined';
  },
  status(){
    if(!this.supported()) return 'unsupported';
    return Notification.permission;
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
    }catch(e){ /* best-effort */ }
  },
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

/* ═══════════════ 5b. WEEKLY SETS ═══════════════ */
const WEEKLY = {
  sets: [],
  _tickTimer: null,

  async init(){
    if(!S.online || S.forcedOffline) return;
    try{
      const r = await netFetch(`${APPS}?${qs({action:'listWeeklySets', username:S.user.username, token:S.user.token})}`, {redirect:'follow'}, 15000);
      const res = await r.json();
      if(!res.success) return;
      this.sets = res.sets || [];
      this._renderHomeCard();
      this._startTick();
    }catch(e){ /* best-effort */ }
  },

  examCloseAt(s){
    if(!s.releaseAt) return null;
    const t = new Date(s.releaseAt).getTime();
    return isNaN(t) ? null : t + WEEKLY_EXAM_WINDOW_HOURS*60*60*1000;
  },
  examOpen(s){
    if(!s.released) return false;
    const closeAt = this.examCloseAt(s);
    return closeAt !== null && Date.now() < closeAt;
  },

  _renderHomeCard(){
    const outer = document.getElementById('weekly-sets-outer');
    const box = document.getElementById('weekly-sets-card');
    if(!box || !outer) return;
    if(!this.sets.length){ outer.style.display = 'none'; box.innerHTML = ''; return; }
    outer.style.display = '';
    box.innerHTML = this.sets.map(s=>{
      if(s.released){
        const open = this.examOpen(s);
        const closeAt = this.examCloseAt(s);
        return `<div class="qb-btn ok" style="cursor:pointer;width:100%;justify-content:space-between;align-items:center" onclick="WEEKLY.open(${JSON.stringify(String(s.id))})">
          <span><i class="ph ph-${open?'note-pencil':'check-circle'}"></i> ${esc(s.title)}${s.chapterLabel?` <span style="opacity:.6">— ${esc(s.chapterLabel)}</span>`:''}</span>
          ${open ? `<span class="mono" id="weekly-countdown-${esc(s.id)}" data-close="${closeAt}" style="font-size:.68rem;font-weight:700;color:var(--ros)" title="Time left to take this as a graded exam">${fmtHMS(Math.max(0,Math.round((closeAt-Date.now())/1000)))}</span>`
                 : `<span style="font-size:.62rem;opacity:.65">Review mode</span>`}
        </div>`;
      }
      const when = s.releaseAt ? new Date(s.releaseAt) : null;
      const whenTxt = when ? when.toLocaleString([], {weekday:'short', month:'short', day:'numeric', hour:'numeric', minute:'2-digit'}) : 'soon';
      return `<div class="qb-btn" style="width:100%;justify-content:flex-start;opacity:.6;cursor:default">
        <i class="ph ph-lock-simple"></i> ${esc(s.title)} <span style="opacity:.7">— unlocks ${whenTxt}</span>
      </div>`;
    }).join('');
  },

  // FIX #7: The interval now checks first whether there's actually
  // anything to tick. Before, an empty this.sets (all sets pre-release,
  // or the feature not in use) still burned a callback every second,
  // and the "anyExpired" flag was only set inside the released-set
  // branch, so a set list that was entirely pre-release ran the loop
  // forever doing nothing. Now: if nothing is currently counting down,
  // the interval clears itself and _startTick() is a no-op until a new
  // list arrives.
  _startTick(){
    if(this._tickTimer){ clearInterval(this._tickTimer); this._tickTimer = null; }
    const anyCountdown = this.sets.some(s=>s.released && this.examCloseAt(s) !== null);
    if(!anyCountdown) return;
    this._tickTimer = setInterval(()=>{
      let anyExpired = false;
      let anyLive = false;
      this.sets.forEach(s=>{
        if(!s.released) return;
        const closeAt = this.examCloseAt(s);
        if(closeAt===null) return;
        const el = document.getElementById('weekly-countdown-'+s.id);
        const left = Math.round((closeAt - Date.now())/1000);
        if(left <= 0){ anyExpired = true; return; }
        anyLive = true;
        if(el) el.textContent = fmtHMS(left);
      });
      if(anyExpired) this._renderHomeCard();
      if(!anyLive && !anyExpired){
        // Nothing left to tick — stop the interval rather than idling.
        clearInterval(this._tickTimer);
        this._tickTimer = null;
      }
    }, 1000);
  },

  open(id){
    const s = this.sets.find(x=>x.id===id);
    if(!s || !s.released || !s.fileId){ toast('Not unlocked yet.'); return; }
    const open = this.examOpen(s);
    if(open){
      toast('📝 Graded exam — ' + fmtHMS(Math.max(0,Math.round((this.examCloseAt(s)-Date.now())/1000))) + ' left in the window');
    } else {
      toast('👁️ Exam window closed — open for unlimited review');
    }
    QUIZ.load(s.fileId, `weekly_${s.id}`, open ? 'exam' : 'flashcard', s.title, null);
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
        info.style.display='';info.textContent=`✅ ${pluralize(qs2.length,'question')} loaded from "${f.name}"`;
        document.getElementById('loc-pr').disabled=false;
        document.getElementById('loc-ex').disabled=false;
        toast(`✅ ${pluralize(qs2.length,'question')} ready`);
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
        <select class="sel-c" style="margin-top:.4rem;font-size:.7rem;padding:.25rem .4rem;width:auto" onchange="REV.setTag(${JSON.stringify(String(q.uid||''))}, this.value)">
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
          ${qSearchHtml(q)}
          <button class="ib" onclick="REV._removeOne(${JSON.stringify(kind)},${JSON.stringify(String(q.uid||''))})" title="Remove from review" aria-label="Remove from review"><i class="ph ph-trash"></i></button>
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
        <button id="quiz-err-close" style="padding:.58rem .9rem;background:var(--b0);border:1px solid var(--b1);border-radius:var(--r1);color:var(--t2);font-size:.82rem;cursor:pointer;font-family:var(--ff)"><i class="ph ph-x"></i> Close</button>
      </div>
    </div>`;
    el.style.display = 'flex';
    document.getElementById('quiz-err-retry').onclick = ()=>{ el.remove(); if(el._retry) el._retry(); };
    document.getElementById('quiz-err-close').onclick = ()=> el.remove();
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

  // FIX #16: Reset any dangling prior-quiz state BEFORE showing the
  // limit picker. Previously, if a prior session's S.quiz was left in a
  // half-torn-down state (e.g. the picker was dismissed via the backdrop
  // while S.quiz.active was still true from a failed start), a
  // subsequent call could inherit stale qs/ans.
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
      <div style="background:var(--c2);border:1px solid var(--bd);border-radius:var(--r3);padding:1.5rem;max-width:340px;width:100%;box-shadow:var(--sh3)" role="dialog" aria-modal="true" aria-labelledby="qlm-title">
        <div style="font-size:1.2rem;margin-bottom:.35rem">${mode==='exam'?'<i class="ph ph-note-pencil"></i>':'<i class="ph ph-lightning"></i>'}</div>
        <div id="qlm-title" style="font-family:var(--fd);font-size:.92rem;font-weight:700;color:var(--t1);margin-bottom:.2rem">${esc(chapterName||'Quiz')}</div>
        <div style="font-size:.74rem;color:var(--t3);margin-bottom:1rem">${pluralize(total,'question')} available — how many do you want to do?</div>
        <div style="display:flex;flex-wrap:wrap;gap:.4rem;margin-bottom:.75rem">
          ${presets.map(n=>`<button data-qn="${n}" class="qlm-preset" style="padding:.35rem .7rem;background:var(--b0);border:1px solid var(--b1);border-radius:var(--r1);color:var(--t2);font-size:.76rem;cursor:pointer;font-family:var(--ff)">${n}</button>`).join('')}
          <button data-qn="${total}" class="qlm-preset" style="padding:.35rem .7rem;background:var(--b0);border:1px solid var(--b1);border-radius:var(--r1);color:var(--t2);font-size:.76rem;cursor:pointer;font-family:var(--ff)">All ${total}</button>
        </div>
        <input id="qlm-inp" type="number" min="1" max="${total}" value="${Math.min(20,total)}"
          style="width:100%;background:var(--c1);border:1.5px solid var(--b1);border-radius:var(--r2);padding:.5rem .75rem;color:var(--t1);font-size:.9rem;font-family:var(--ff);outline:none;box-sizing:border-box;margin-bottom:.6rem">
        <label style="display:flex;align-items:center;gap:.5rem;margin-bottom:.75rem;cursor:pointer;font-size:.8rem;color:var(--t2)">
          <input id="qlm-shuffle" type="checkbox" checked style="width:16px;height:16px;accent-color:var(--amb);cursor:pointer">
          <i class="ph ph-shuffle"></i> Shuffle question order
        </label>
        <div style="display:flex;gap:.4rem">
          <button id="qlm-start" style="flex:1;padding:.62rem;background:linear-gradient(135deg,var(--amb2),var(--amb));border:none;border-radius:var(--r2);color:var(--on-accent);font-weight:700;font-size:.85rem;cursor:pointer;font-family:var(--ff)">Start →</button>
          <button id="qlm-cancel" style="padding:.62rem .9rem;background:var(--b0);border:1px solid var(--b1);border-radius:var(--r2);color:var(--t2);font-size:.83rem;cursor:pointer;font-family:var(--ff)"><i class="ph ph-x"></i></button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e=>{ if(e.target===modal) modal.remove(); });
    document.querySelectorAll('#quiz-limit-modal .qlm-preset').forEach(btn=>{
      btn.onclick = ()=>{ document.getElementById('qlm-inp').value = btn.dataset.qn; };
    });
    document.getElementById('qlm-cancel').onclick = ()=> modal.remove();
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
      examEndAt: mode==='exam' ? Date.now() + examSeconds*1000 : 0,
      active:true, ch: chapterName||'Study', scope, skipped:new Set(), shown:new Set(),
      startedAt: Date.now()
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
    // FIX #8: This used to be `pool.length - (TARGET-need) >= need*2`,
    // which read like a puzzle. `TARGET - need` equals the ORIGINAL pool
    // size, so the real condition was "stop once we've pulled at least
    // 2× the number of questions we still needed". Named that threshold
    // explicitly so the intent survives the next refactor.
    const stopAt = pool.length + need*2;
    for(const ref of picks){
      if(pool.length >= stopAt) break;
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

  // FIX #2: Snapshot used to serialize the FULL question array including
  // q.img — which may be a base64 data: URI several KB (or tens of KB)
  // long. A 100-question exam with figures easily exceeds the ~5MB
  // localStorage limit, and _snapshotExam() runs on EVERY exAnswer()
  // plus every 15s from the timer, so this would spam the (already
  // throttled) storage-full toast. Strip img/imgCaption before saving;
  // on resume, _resumeSnapshot() rehydrates them by uid from the live
  // S.quiz.qs (which the resume path re-fetches from the server/cache).
  //
  // FIX #10: Also debounce — writing the whole array on every tap is
  // wasteful even without images. A 3-second throttle is far below the
  // 15s timer cadence and still leaves at most ~3s of answers at risk
  // on a hard tab-close (the visibilitychange/pagehide flushOnHide path
  // is the ultimate backstop for a graceful close).
  _lastSnapAt: 0,
  _snapshotExam(force){
    if(!S.quiz || !S.quiz.active || S.quiz.mode!=='exam' || !S.user) return;
    const now = Date.now();
    if(!force && (now - QUIZ._lastSnapAt) < 3000) return;
    QUIZ._lastSnapAt = now;
    const liteQs = S.quiz.qs.map(q => {
      const { img, imgCaption, ...rest } = q;
      return rest;
    });
    _save(LS.EXAM_SNAP, {
      username: S.user.username,
      ch: S.quiz.ch,
      qs: liteQs,
      ans: S.quiz.ans,
      left: S.quiz.left,
      startedAt: S.quiz.startedAt || now,
      savedAt: now
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
      <div style="background:var(--c2);border:1px solid var(--bd);border-radius:var(--r3);padding:1.5rem;max-width:340px;width:100%;box-shadow:var(--sh3)" role="dialog" aria-modal="true">
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
    // FIX #9: Restore startedAt. Before, _showResults computed
    // durationSec from S.quiz.startedAt, which was undefined after a
    // resume, so resumed exams were logged with 0s duration. Approximate
    // the original start by walking back the time already spent
    // (originalTotal - left) from the snapshot's save moment.
    const originalTotal = (snap.qs.length * 90);
    const spentBeforeSnap = Math.max(0, originalTotal - (snap.left||0));
    const startedAt = snap.startedAt || (snap.savedAt - spentBeforeSnap*1000) || Date.now();
    S.quiz = {
      qs: snap.qs, ans: snap.ans, mode:'exam', idx:0, timer:null, elapsed:0,
      left: adjustedLeft,
      examEndAt: Date.now() + adjustedLeft*1000,
      active:true, ch: snap.ch, skipped:new Set(), shown:new Set(),
      scope: null, startedAt
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
      <div style="background:var(--c2);border:1px solid var(--bd);border-radius:var(--r3);padding:1.5rem;max-width:340px;width:100%;box-shadow:var(--sh3)" role="dialog" aria-modal="true">
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
        <button class="ib" onclick="QUIZ._reportCurrent()" title="Report an issue with this question" aria-label="Report an issue with this question"><i class="ph ph-warning-circle"></i></button>
        ${qSearchHtml(q)}
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
  _reportCurrent(){
    const q = S.quiz.qs?.[S.quiz.idx];
    if(!q){ toast('No question to report.'); return; }
    openMod('Report an issue', `
      <div class="sf"><label for="qr-reason">What's wrong?</label>
        <select id="qr-reason">
          <option value="wrong_answer">The marked answer looks wrong</option>
          <option value="unclear">The question or options are unclear</option>
          <option value="typo">Typo or formatting issue</option>
          <option value="other">Something else</option>
        </select>
      </div>
      <div class="sf"><label for="qr-note">Details (optional)</label><textarea id="qr-note" rows="3" placeholder="Anything that would help — e.g. which option you think is actually correct"></textarea></div>
      <button class="btn" id="qr-send-btn">Send Report</button>
    `);
    const sendBtn = document.getElementById('qr-send-btn');
    if(sendBtn) sendBtn.onclick = ()=> QUIZ._submitReport(q.uid);
  },
  async _submitReport(uid){
    const q = (S.quiz.qs||[]).find(x=>x.uid===uid) || S.quiz.qs?.[S.quiz.idx];
    const reason = document.getElementById('qr-reason')?.value || 'other';
    const note = (document.getElementById('qr-note')?.value || '').trim();
    if(!S.user?.username || !S.user?.token){ toast('❌ Please log in again to report a question.'); return; }
    closeMod();
    toast('Sending report…');
    try{
      const r = await netFetch(`${APPS}?${qs({
        action:'reportQuestion', username:S.user.username, token:S.user.token,
        uid, reason, note, questionSnapshot: (q?.q||'').slice(0,1000)
      })}`, {redirect:'follow'}, 15000);
      const res = await r.json();
      if(res.success) toast('✅ ' + (res.message || 'Thanks — report sent.'));
      else toast('❌ ' + (res.error || 'Could not send report.'));
    }catch(e){
      toast('⚠️ Could not send report — check your connection and try again.');
    }
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
      const savedAns = S.quiz.ans[qi];
      return `
      <div class="eqc${savedAns!==null?' answered':''}" id="eqc-${qi}">
        <div class="qm"><span class="qn mono">Q${qi+1}</span>${qSearchHtml(q)}</div>
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
    QUIZ._updateSkippedNav();
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
    QUIZ._updateSkippedNav();
  },
  _updateSkippedNav(){
    const btn = document.getElementById('ex-skip-nav');
    if(!btn) return;
    const skippedCount = S.quiz.ans.filter(a=>a===null).length;
    btn.style.display = skippedCount ? '' : 'none';
    const countEl = document.getElementById('ex-skip-count');
    if(countEl) countEl.textContent = skippedCount;
  },
  jumpToUnanswered(){
    if(!S.quiz || !S.quiz.qs) return;
    const total = S.quiz.qs.length;
    const cards = S.quiz.qs.map((_,i)=>document.getElementById('eqc-'+i)).filter(Boolean);
    const viewTop = window.scrollY + 80;
    let startFrom = 0;
    for(let i=0;i<cards.length;i++){ if(cards[i].offsetTop > viewTop){ startFrom = i; break; } }
    for(let step=0; step<total; step++){
      const idx = (startFrom + step) % total;
      if(S.quiz.ans[idx]===null){
        document.getElementById('eqc-'+idx)?.scrollIntoView({behavior:'smooth', block:'center'});
        return;
      }
    }
    toast('🎉 Nothing left unanswered');
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
        <div class="qm"><span class="qn mono">Q${i+1}</span><span class="ctag ${correctPick?'tg':'tr'}">${correctPick?'Correct':a===null?'Skipped':'Wrong'}</span>${qSearchHtml(q)}</div>
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
    const durationSec = S.quiz.startedAt
      ? Math.min(3*60*60, Math.round((Date.now()-S.quiz.startedAt)/1000))
      : 0;
    const sessionObj = {
      chapter:S.quiz.ch, mode:S.quiz.mode, total, correct, wrong, skipped, pct, at:Date.now(),
      durationSec,
      lv:scope.lv||'', ch:scope.ch||'', book:scope.book||'', sub:scope.sub||'', fid:scope.fid||'',
      qres
    };
    PROG.recordSession(sessionObj);
    CHAPSTATS.record(sessionObj);
  }
};

/* keyboard support during quizzes */
document.addEventListener('keydown', e=>{
  if(!S.quiz.active) return;
  if(document.getElementById('quiz-wrap').style.display==='none') return;
  // FIX #3: Never let quiz shortcuts fire while any modal is open — the
  // report form (openMod), the exam-resume prompt, the exit guard, the
  // limit picker, the error card, or the loader. Before this guard,
  // typing "1" in the report textarea, or pressing Escape while
  // reviewing the exit dialog, would silently answer/advance the
  // underlying question.
  if(_anyModalOpen()) return;
  // Also skip if focus is inside a form field for any reason.
  const tag = (e.target && e.target.tagName) || '';
  if(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
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

/* ═══════════════ 10. PROGRESS TRACKING ═══════════════ */
const PROG = {
  track(correct){
    S.prog.total++;
    if(correct)S.prog.correct++;
    _save(LS.PROG,S.prog);
  },
  recordSession(sess){
    if(!S.prog.sessions)S.prog.sessions=[];
    S.prog.sessions.push(sess);
    if(S.prog.sessions.length>50)S.prog.sessions=S.prog.sessions.slice(-50);
    _save(LS.PROG,S.prog);
  },
  render(){
    const sessions = S.prog.sessions||[];
    const overallEl=document.getElementById('prog-overall');
    if(!sessions.length){
      overallEl.innerHTML = `<div class="empty"><div class="empty-i"><i class="ph ph-chart-line-up"></i></div><p>No study sessions yet</p><p style="font-size:.72rem;color:var(--t3);margin-top:.15rem">Complete a quiz to start tracking your progress.</p></div>`;
      document.getElementById('prog-chapters').innerHTML='';
      document.getElementById('prog-recent').innerHTML='';
      return;
    }
    const totalQ = sessions.reduce((s,x)=>s+x.total,0);
    const totalC = sessions.reduce((s,x)=>s+x.correct,0);
    const overallPct = totalQ? Math.round((totalC/totalQ)*100):0;
    const totalTime = sessions.reduce((s,x)=>s+(x.durationSec||0),0);
    const hrs = Math.floor(totalTime/3600), mins = Math.floor((totalTime%3600)/60);
    overallEl.innerHTML = `
      <div class="stats-row">
        <div class="sc"><div class="sv tcy">${sessions.length}</div><div class="stat-lbl">Sessions</div></div>
        <div class="sc"><div class="sv tc2">${overallPct}%</div><div class="stat-lbl">Accuracy</div></div>
        <div class="sc"><div class="sv tvi">${totalQ}</div><div class="stat-lbl">Questions</div></div>
        <div class="sc"><div class="sv tsk">${hrs>0?hrs+'h ':''}${mins}m</div><div class="stat-lbl">Study Time</div></div>
      </div>`;

    const chapEntries = CHAPSTATS.entries();
    if(!chapEntries.length){
      document.getElementById('prog-chapters').innerHTML = '<p style="font-size:.78rem;color:var(--t3);padding:.5rem 0">No chapter data yet.</p>';
    } else {
      document.getElementById('prog-chapters').innerHTML = chapEntries.map(c=>{
        const barColor = c.accuracy>=75?'var(--ok)':c.accuracy>=50?'var(--amb)':'var(--bad)';
        return `<div style="margin-bottom:.6rem">
          <div style="display:flex;justify-content:space-between;font-size:.78rem;margin-bottom:.2rem">
            <span style="color:var(--t1);font-weight:600">${esc(c.chapter)}</span>
            <span style="color:var(--t3)">${c.correct}/${c.attempted} · ${c.accuracy}%</span>
          </div>
          <div style="height:6px;background:var(--b0);border-radius:4px;overflow:hidden">
            <div style="height:100%;width:${c.accuracy}%;background:${barColor};border-radius:4px;transition:width .3s ease"></div>
          </div>
        </div>`;
      }).join('');
    }

    const recent = [...sessions].reverse().slice(0,15);
    document.getElementById('prog-recent').innerHTML = recent.map(s=>{
      const when = s.at ? new Date(s.at).toLocaleString([], {month:'short', day:'numeric', hour:'numeric', minute:'2-digit'}) : '';
      const modeIcon = s.mode==='exam' ? '<i class="ph ph-note-pencil"></i>' : '<i class="ph ph-lightning"></i>';
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:.5rem 0;border-bottom:1px solid var(--b1);font-size:.78rem">
        <div style="min-width:0;flex:1">
          <div style="font-weight:600;color:var(--t1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${modeIcon} ${esc(s.chapter)}</div>
          <div style="font-size:.66rem;color:var(--t3)">${when}</div>
        </div>
        <div style="text-align:right;flex-shrink:0;margin-left:.5rem">
          <div style="font-weight:700;color:${s.pct>=70?'var(--ok)':s.pct>=40?'var(--amb)':'var(--bad)'}">${s.pct}%</div>
          <div style="font-size:.64rem;color:var(--t3)">${s.correct}/${s.total}</div>
        </div>
      </div>`;
    }).join('');
  }
};

/* ═══════════════ 10b. ONLINE PROGRESS PICKER PREVIEW ═══════════════ */
const ONPROG = {
  render(){
    const el = document.getElementById('on-progress-preview');
    if(!el) return;
    const lv=document.getElementById('on-lv')?.value, ch=document.getElementById('on-ch')?.value, book=document.getElementById('on-bk')?.value;
    if(!lv || !ch){ el.innerHTML=''; return; }
    const chapterLabel = ChapterData.chapterName(lv,ch) + (book? ' — '+book : '');
    const match = CHAPSTATS.entries().find(c=>c.chapter===chapterLabel);
    if(!match){ el.innerHTML = `<p style="font-size:.7rem;color:var(--t3);margin-top:.3rem">No attempts yet for this chapter.</p>`; return; }
    el.innerHTML = `<p style="font-size:.7rem;color:var(--t3);margin-top:.3rem">📊 Your accuracy here so far: <strong style="color:${match.accuracy>=75?'var(--ok)':match.accuracy>=50?'var(--amb)':'var(--bad)'}">${match.accuracy}%</strong> (${match.correct}/${match.attempted})</p>`;
  }
};

/* ═══════════════ 11. STREAK ═══════════════ */
const STREAK = {
  markToday(){
    const t = today();
    if(!S.stk.days) S.stk.days=[];
    if(!S.stk.days.includes(t)){
      S.stk.days.push(t);
      if(S.stk.days.length>400) S.stk.days = S.stk.days.slice(-400);
    }
    S.stk.last = t;
    _save(LS.STK, S.stk);
    HOME.render();
  },
  // FIX #4: The original logic returned 0 whenever today wasn't yet
  // marked — even if the user had a long, unbroken streak ending
  // yesterday. That meant the greeting showed "Start your streak today"
  // all morning to someone who was actually on day 30. Correct
  // behavior: count consecutive days ending either at today (already
  // practised) or at yesterday (streak intact, just not extended yet).
  // A gap of two or more days correctly returns 0.
  current(){
    if(!S.stk.days || !S.stk.days.length) return 0;
    const set = new Set(S.stk.days);
    const hasToday = set.has(today());
    const hasYesterday = set.has(localDateOffset(new Date(), -1));
    if(!hasToday && !hasYesterday) return 0;
    let count = 0;
    let offset = hasToday ? 0 : 1;
    // Walk backwards one local day at a time until we hit a gap.
    while(set.has(localDateOffset(new Date(), -offset))){
      count++;
      offset++;
      if(count > 400) break; // safety — S.stk.days is capped at 400 anyway
    }
    return count;
  },
  longest(){
    if(!S.stk.days || !S.stk.days.length) return 0;
    const sorted = [...new Set(S.stk.days)].sort();
    let longest=1, cur=1;
    for(let i=1;i<sorted.length;i++){
      const prev = new Date(sorted[i-1]);
      const curD = new Date(sorted[i]);
      const diffDays = Math.round((curD-prev)/(24*60*60*1000));
      if(diffDays===1){ cur++; longest=Math.max(longest,cur); }
      else cur=1;
    }
    return longest;
  }
};

/* ═══════════════ 12. HOME DASHBOARD ═══════════════ */
const HOME = {
  render(){
    const hour = new Date().getHours();
    const greeting = hour<5?'Burning midnight oil? 🌙':hour<12?'Good morning ☀️':hour<17?'Good afternoon 🌤':hour<21?'Good evening 🌆':'Studying late? 🌙';
    const nameEl = document.getElementById('home-greeting');
    if(nameEl) nameEl.textContent = `${greeting}, ${esc(S.user?.name||S.user?.username||'Student')}!`;

    const streakEl = document.getElementById('home-streak');
    if(streakEl){
      const cur = STREAK.current();
      streakEl.innerHTML = cur>0
        ? `<i class="ph ph-fire"></i> ${cur} day streak${cur>=STREAK.longest()&&cur>1?' <span style="opacity:.7">(personal best!)</span>':''}`
        : `<i class="ph ph-fire"></i> Start your streak today`;
    }

    const dueCount = REV.dueCount();
    const dueBadge = document.getElementById('home-due-badge');
    if(dueBadge){
      if(dueCount>0){ dueBadge.style.display=''; dueBadge.textContent = dueCount+' due'; }
      else dueBadge.style.display='none';
    }

    HOME.updateBadges();
    if(typeof WEEKLY!=='undefined') WEEKLY._renderHomeCard();
  },
  updateBadges(){
    const set = (id,n)=>{ const el=document.getElementById(id); if(el){ el.textContent=n; el.style.display = n>0?'':'none'; } };
    set('nav-bk-badge', S.bk.length);
    set('nav-fl-badge', S.fl.length);
    set('nav-wr-badge', S.wr.length);
    const dueBadge = document.getElementById('nav-wr-due-badge');
    if(dueBadge){ const due=REV.dueCount(); dueBadge.textContent=due; dueBadge.style.display = due>0?'':'none'; }
  }
};

/* ═══════════════ 13. TIMETABLE ═══════════════ */
const TT = {
  render(){
    const el = document.getElementById('tt-list');
    if(!el) return;
    const sessions = S.tt.sessions||[];
    if(!sessions.length){
      el.innerHTML = `<div class="empty"><div class="empty-i"><i class="ph ph-calendar"></i></div><p>No study sessions scheduled</p></div>`;
    } else {
      el.innerHTML = DAYS.map((day,di)=>{
        const daySessions = sessions.filter(s=>s.day===di).sort((a,b)=>a.time.localeCompare(b.time));
        if(!daySessions.length) return '';
        return `<div style="margin-bottom:.7rem">
          <div class="sb-lbl">${day}</div>
          ${daySessions.map(s=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:.5rem .6rem;background:var(--b0);border-radius:8px;margin-bottom:.3rem">
            <div><span class="mono" style="font-weight:700">${esc(s.time)}</span> — ${esc(s.label||'Study')}</div>
            <button class="ib" onclick="TT.remove(${JSON.stringify(String(s.id))})" aria-label="Remove session"><i class="ph ph-trash"></i></button>
          </div>`).join('')}
        </div>`;
      }).join('') || `<div class="empty"><div class="empty-i"><i class="ph ph-calendar"></i></div><p>No study sessions scheduled</p></div>`;
    }
    const toggle = document.getElementById('tt-reminders-toggle');
    if(toggle) toggle.checked = !!S.tt.reminders.enabled;
  },
  add(){
    const day = Number(document.getElementById('tt-day').value);
    const time = document.getElementById('tt-time').value;
    const label = document.getElementById('tt-label').value.trim();
    if(!time){ toast('Pick a time'); return; }
    if(!S.tt.sessions) S.tt.sessions=[];
    S.tt.sessions.push({id: Date.now()+'_'+Math.random().toString(36).slice(2), day, time, label});
    _save(LS.TT, S.tt);
    document.getElementById('tt-label').value='';
    TT.render();
    toast('✅ Session added');
  },
  remove(id){
    S.tt.sessions = (S.tt.sessions||[]).filter(s=>s.id!==id);
    _save(LS.TT, S.tt);
    TT.render();
  },
  async toggleReminders(enabled){
    S.tt.reminders.enabled = enabled;
    _save(LS.TT, S.tt);
    if(enabled){
      if(!('Notification' in window)){ toast('Notifications not supported on this device'); return; }
      if(Notification.permission!=='granted'){
        const p = await Notification.requestPermission();
        if(p!=='granted'){ S.tt.reminders.enabled=false; _save(LS.TT,S.tt); TT.render(); toast('Reminders need notification permission'); return; }
      }
      toast('🔔 Reminders enabled');
    } else {
      toast('Reminders disabled');
    }
  },
  _reminderTimer:null,
  _startReminderChecker(){
    if(TT._reminderTimer) clearInterval(TT._reminderTimer);
    TT._reminderTimer = setInterval(()=>TT._checkDue(), 60000);
    TT._checkDue();
  },
  _checkDue(){
    if(!S.tt.reminders?.enabled || !S.tt.sessions?.length) return;
    if(!('Notification' in window) || Notification.permission!=='granted') return;
    const now = new Date();
    const day = now.getDay();
    const leadMs = (S.tt.reminders.leadMinutes||5)*60000;
    const notifiedKey = LS.TT_NOTIFIED;
    const notified = _load(notifiedKey, {});
    const todayKey = today();
    if(notified._day !== todayKey){ Object.keys(notified).forEach(k=>delete notified[k]); notified._day = todayKey; }
    S.tt.sessions.filter(s=>s.day===day).forEach(s=>{
      const [h,m] = s.time.split(':').map(Number);
      const sessionTime = new Date(); sessionTime.setHours(h,m,0,0);
      const msUntil = sessionTime - now;
      if(msUntil>0 && msUntil<=leadMs && !notified[s.id]){
        new Notification('📚 Study time soon!', { body: `${s.label||'Study session'} at ${s.time}`, icon:'icon-192.png' });
        notified[s.id]=true;
        _save(notifiedKey, notified);
      }
    });
  }
};

/* ═══════════════ 14. OFFLINE CACHE MANAGEMENT ═══════════════ */
const CACHE = {
  async render(){
    const el = document.getElementById('cache-list');
    if(!el) return;
    el.innerHTML = '<p style="font-size:.8rem;color:var(--t3)">Loading cached sets…</p>';
    const keys = await QDB.keys();
    if(!keys.length){
      el.innerHTML = `<div class="empty"><div class="empty-i"><i class="ph ph-cloud-slash"></i></div><p>Nothing cached yet</p><p style="font-size:.72rem;color:var(--t3);margin-top:.15rem">Open any chapter while online to cache it automatically, or use "Cache All" below.</p></div>`;
      return;
    }
    el.innerHTML = keys.map(k=>{
      const parts = k.split('_');
      const label = parts.length>=4 ? `${parts[0]} · Ch${parts[1]} · ${parts[2]} · ${parts[3]}` : k;
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:.5rem .6rem;background:var(--b0);border-radius:8px;margin-bottom:.3rem;font-size:.78rem">
        <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1"><i class="ph ph-package"></i> ${esc(label)}</div>
        <button class="ib cache-rm-btn" data-key="${esc(k)}" title="Remove from cache" aria-label="Remove from cache"><i class="ph ph-trash"></i></button>
      </div>`;
    }).join('');
    el.querySelectorAll('.cache-rm-btn').forEach(btn=>{
      btn.onclick = ()=> CACHE.remove(btn.dataset.key);
    });
  },
  async remove(key){
    await QDB.del(key);
    CACHE.render();
    toast('🗑 Removed from offline cache');
  },
  async clearAll(){
    if(!confirm('Remove ALL cached question sets? You will need to be online to study again until you re-cache.')) return;
    await QDB.clear();
    CACHE.render();
    toast('🗑 Offline cache cleared');
  },
  async cacheAll(){
    if(!S.online){ toast('❌ Connect to the internet first'); return; }
    const refs = ChapterData.allFileRefs();
    if(!refs.length){ toast('No content configured'); return; }
    if(!confirm(`Download all ${refs.length} question sets for offline use? This may use significant data.`)) return;
    QUIZ._showLoader(`Caching 0/${refs.length}…`);
    let done=0, failed=0;
    for(const ref of refs){
      try{ await QUIZ._fetch(ref.fid, ref.key); done++; }
      catch(e){ failed++; }
      document.getElementById('quiz-loader-msg').textContent = `Caching ${done+failed}/${refs.length}…`;
    }
    QUIZ._hideLoader();
    toast(`✅ Cached ${done} set${done!==1?'s':''}${failed?`, ${failed} failed`:''}`);
    CACHE.render();
  }
};

/* ═══════════════ 15. DATA EXPORT / IMPORT ═══════════════ */
const DATA = {
  exportAll(){
    const payload = {
      exportedAt: new Date().toISOString(),
      version: (typeof APP_VERSION!=='undefined'?APP_VERSION:1),
      prog: S.prog,
      chapStats: S.chapStats,
      bk: S.bk, fl: S.fl, wr: S.wr, stk: S.stk, tt: S.tt
    };
    const blob = new Blob([JSON.stringify(payload,null,2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `abhyas_backup_${today()}.json`; a.click();
    URL.revokeObjectURL(url);
    toast('📥 Backup downloaded');
  },
  importFile(){
    const input = document.getElementById('data-import-file');
    const file = input?.files?.[0];
    if(!file){ toast('Choose a backup file first'); return; }
    const r = new FileReader();
    r.onload = e=>{
      let data;
      try{ data = JSON.parse(e.target.result); }
      catch{ toast('❌ Invalid backup file'); return; }
      if(!confirm('Import this backup? It will be merged with your current data (existing chapter accuracy is kept if it\'s higher).')) return;
      if(data.prog){ S.prog = data.prog; _save(LS.PROG, S.prog); }
      if(data.chapStats){
        Object.entries(data.chapStats).forEach(([key,rec])=>{
          const existing = S.chapStats[key];
          if(!existing || rec.attempted > existing.attempted) S.chapStats[key]=rec;
        });
        _save(LS.CHAPSTATS, S.chapStats);
      }
      if(data.bk) { S.bk = data.bk; _save(LS.BK, S.bk); }
      if(data.fl) { S.fl = data.fl; _save(LS.FL, S.fl); }
      if(data.wr) { S.wr = data.wr; _save(LS.WR, S.wr); }
      if(data.stk){ S.stk = data.stk; _save(LS.STK, S.stk); }
      if(data.tt)  { S.tt = data.tt; if(!S.tt.reminders) S.tt.reminders={enabled:false,leadMinutes:5}; _save(LS.TT, S.tt); }
      toast('✅ Backup imported');
      HOME.render(); PROG.render();
    };
    r.onerror = ()=>toast('❌ Could not read file');
    r.readAsText(file);
  },
  async wipeDevice(){
    if(!confirm('Erase ALL local data on this device (progress, bookmarks, flags, wrong-bank, cached question sets)? This cannot be undone. Anything already backed up to the cloud will still be there next time you log in online.')) return;
    // FIX #13: Also clear the keys that used to be left behind —
    // EXAM_SNAP (a stale resume-exam prompt would otherwise appear right
    // after the wipe), TT_NOTIFIED, CLOUD, PROFILE, and LAST_USER (so the
    // NEXT login on this device takes the fresh-pull path). USER is left
    // alone here — the confirm() text says "reloads", not "logs out",
    // and the current session is still valid; log out separately to
    // actually end the session.
    [LS.PROG, LS.BK, LS.FL, LS.WR, LS.STK, LS.CHAPSTATS, LS.TT, LS.EXAM_SNAP, LS.TT_NOTIFIED, LS.CLOUD, LS.PROFILE, LS.LAST_USER].forEach(k=>localStorage.removeItem(k));
    await QDB.clear();
    toast('🗑 Local data wiped — reloading…');
    setTimeout(()=>location.reload(), 1200);
  }
};

/* ═══════════════ 16. TUTORIAL ═══════════════ */
const TUTORIAL = {
  KEY: 'abhyas_tutorial_seen',
  maybeAutoOpen(user){
    if(_load(TUTORIAL.KEY, false)) return;
    setTimeout(()=>TUTORIAL.open(), 600);
  },
  open(){
    openMod('Welcome to Abhyas 👋', `
      <p style="font-size:.85rem;line-height:1.6;margin-bottom:.7rem">Quick tour:</p>
      <ul style="font-size:.8rem;line-height:1.9;padding-left:1.2rem;color:var(--t2)">
        <li><strong>Online Study</strong> — pick a level/chapter/book to practice or take a timed exam.</li>
        <li><strong>Flashcard mode</strong> — answer at your own pace, see the explanation immediately.</li>
        <li><strong>Exam mode</strong> — timed, graded, review answers at the end.</li>
        <li>Bookmark <i class="ph ph-star"></i>, flag <i class="ph ph-flag"></i>, or report <i class="ph ph-warning-circle"></i> any question while studying.</li>
        <li>Wrong answers go into your <strong>Wrong Bank</strong> automatically, with spaced repetition to bring them back at the right time.</li>
        <li>Everything works <strong>offline</strong> once you've opened a chapter while online — cache it in advance from the Offline Cache tab.</li>
      </ul>
      <button class="btn" onclick="TUTORIAL.dismiss()" style="margin-top:1rem">Got it, let's go →</button>
    `);
  },
  dismiss(){
    _save(TUTORIAL.KEY, true);
    closeMod();
  }
};

/* ═══════════════ 17. APP BOOT ═══════════════ */
const APP = {
  _booted: false,
  async init(){
    if(APP._booted) return;
    APP._booted = true;
    await QDB.migrateFromLocalStorage();
    if(!Object.keys(S.chapStats).length && S.prog.sessions?.length) CHAPSTATS.rebuildFromSessions();
    HOME.render();
    AUTH.startPeriodicRecheck();
    QUIZ.checkResumableExam();
    if(typeof PUSH!=='undefined') PUSH.refreshButtonUI();
  }
};

/* ═══════════════ 18. NETWORK STATE BINDING ═══════════════ */
function _updateNetBtn(){
  const dot = document.getElementById('net-dot');
  const txt = document.getElementById('net-txt');
  // FIX #11: Simplified — the original nested ternary evaluated to the
  // same result, just harder to read.
  const offline = S.forcedOffline || !S.online;
  if(dot) dot.className = 'net-dot' + (offline ? ' off' : '');
  if(txt) txt.textContent = S.forcedOffline ? 'Offline (manual)' : (S.online ? 'Online' : 'Offline');
}
function _updateOfflineWarn(){
  const bar = document.getElementById('offbar');
  if(!bar) return;
  bar.classList.toggle('show', !S.online || S.forcedOffline);
}
window.addEventListener('online', ()=>{ if(!S.forcedOffline){ S.online=true; _updateNetBtn(); _updateOfflineWarn(); PSYNC.pushNow(); } });
window.addEventListener('offline', ()=>{ S.online=false; _updateNetBtn(); _updateOfflineWarn(); });

function toggleForcedOffline(){
  S.forcedOffline = !S.forcedOffline;
  _save(LS.FORCED_OFFLINE, S.forcedOffline);
  _updateNetBtn(); _updateOfflineWarn();
  toast(S.forcedOffline ? '📴 Manual offline mode on' : '📶 Back online');
  if(!S.forcedOffline) NETCHECK.ping();
}

function pluralize(n, word){ return `${n} ${word}${n===1?'':'s'}`; }

/* ═══════════════ 19. BOOT ═══════════════ */
document.addEventListener('DOMContentLoaded', ()=>{
  PWA.init();
  _updateNetBtn();
  _updateOfflineWarn();
  NETCHECK.start();
  NETCHECK.ping();
  AUTH.restore();
});
