/* ═══════════════════════════════════════════════════════════════
   SHARED.JS — small utilities used by index.html, user.html (via
   app.js), and admin.html.

   This project intentionally has no build step (see README §2), so
   this can't be an ES module import — it's a plain script loaded
   with a <script src="shared.js"> tag before each page's own logic.
   That's enough to stop copy-pasting the same handful of helper
   functions into three separate <script> blocks.
   ═══════════════════════════════════════════════════════════════ */

/**
 * Escape a value for safe interpolation into onclick="...('${value}')"
 * style attributes — i.e. inside an HTML double-quoted attribute that
 * itself contains a JS single-quoted string literal. esc() alone isn't
 * enough here: the browser HTML-decodes the attribute value BEFORE
 * handing it to the JS parser, so a plain HTML-escaped `"` would still
 * close the JS string wrapper (after decoding) even though it looks
 * "escaped". This handles both layers in the right order.
 */
function escAttrJs(s) {
  return String(s || '').replace(/[\\'"<>]/g, c => ({
    '\\': '\\\\', "'": "\\'", '"': '&quot;', '<': '&lt;', '>': '&gt;'
  }[c]));
}

/** HTML-escape a value for safe interpolation into innerHTML. */
function esc(s) {
  return String(s || '').replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

/**
 * "1 question" vs "5 questions" — several chapters/subtopics
 * genuinely have exactly 1 question (e.g. Geotechnical Engineering's
 * Rock & Earthquake subtopic, noted in chapters-data.js), so this
 * isn't just a theoretical singular case that never happens in
 * practice. Pass an explicit pluralWord for irregular nouns (e.g.
 * pluralize(1, 'file', 'files') already reads fine without one, since
 * the default is just word+'s' — only needed for words that don't
 * pluralize by simply appending 's').
 */
function pluralize(n, word, pluralWord) {
  return `${n} ${n === 1 ? word : (pluralWord || word + 's')}`;
}

/**
 * One-shot reachability check against the Apps Script backend.
 * Every page previously hand-rolled its own AbortController + timeout +
 * ping fetch; this is that logic in one place. Callers own their own
 * online-state variable and UI updates — this just answers "can we
 * reach the backend right now, yes or no".
 *
 * @param {string} gasUrl   The deployed Apps Script /exec URL.
 * @param {number} timeoutMs
 * @returns {Promise<boolean>}
 */
async function pingBackend(gasUrl, timeoutMs = 8000) {
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(`${gasUrl}?action=ping&_=${Date.now()}`, {
      signal: ctrl.signal,
      cache: 'no-store'
    });
    clearTimeout(to);
    if (!r.ok) return false;
    const data = await r.json();
    return !!(data.pong || data.success);
  } catch (e) {
    return false;
  }
}
