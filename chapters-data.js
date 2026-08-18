/* ═══════════════════════════════════════════════════════════════
   CHAPTERS-DATA.JS
   ───────────────────────────────────────────────────────────────
   This file is the ONLY place you need to edit when you want to:
     • rename a level or chapter
     • add/remove a chapter
     • add/remove a book (author/source) under a chapter
     • add/remove a question-file (Google Drive fileId) under a book

   It is intentionally separated from app.js (the app logic) and
   from Code.gs (the server). Nothing in here talks to the network —
   it's a plain data map that the rest of the app reads from.

   HIERARCHY (4 levels) — updated 2026-07-15:
   --------------------------------------------
     Level (level5 / level7 / gk / old_question)
       -> Chapter (e.g. "1": "Engineering Survey")
         -> Book (e.g. "Sunil Sah", "DPARSAD", "GATE" -- the author/source
                 a question set came from)
           -> Subtopic (e.g. "1-100", "101-200" -- the question range or
                        label within that book) -> Google Drive fileId

   This mirrors what was already true in the data (every old label like
   "Sunil Sah 1-100" was really "Book=Sunil Sah, Subtopic=1-100" mashed
   into one string) -- it's now an explicit nested level instead of a
   single flat label, and Online Study shows it as its own dropdown:
   Level -> Chapter -> Book -> Subtopic.

   HOW TO ADD A NEW FILE:
   -----------------------
   1. Upload your question JSON to Google Drive.
   2. Right-click the file -> "Share" -> "Anyone with the link".
   3. Copy the long ID from the share link
      (the part between /d/ and /view in
       https://drive.google.com/file/d/THIS_PART/view)
   4. Paste it below under the right level -> chapter -> book -> a
      subtopic label of your choice, e.g. "501-572": "PASTE_ID_HERE".
      If the book only has one file total, use "All" as the subtopic.

   HOW TO ADD A NEW BOOK TO AN EXISTING CHAPTER:
   -----------------------------------------------
   Add a new key under that chapter in DRIVE, e.g.:
        "7": { "Sunil Sah": {...existing...}, "New Author": { "1-100": "fileId" } }

   HOW TO ADD A NEW CHAPTER:
   --------------------------
   1. Add an entry to CH_NAMES under the right level:
        "14":"New Chapter Name"
   2. Add a matching entry to DRIVE under the same level/number:
        "14": { "Some Book": { "All": "fileId" } }
   If a chapter has no files yet, just use an empty object: "14":{}
   The UI will show it as "Coming soon" instead of breaking.

   HOW TO ADD A NEW LEVEL:
   -------------------------
   1. Add a new top-level key to CH_NAMES, e.g. level6: {...}
   2. Add the matching key to DRIVE, e.g. level6: {...}
   3. Add an <option> for it in index.html wherever levels are
      listed (search for "Select Level" in index.html).
═══════════════════════════════════════════════════════════════ */

const CH_NAMES = {
  level5: {
    "1": "Engineering Survey",
    "2": "Construction Materials",
    "3": "Mechanics of Material",
    "4": "Hydraulics",
    "5": "Soil Mechanics",
    "6": "Structural Design",
    "7": "Building Construction Technology",
    "8": "Water Supply & Sanitation",
    "9": "Irrigation Engineering",
    "10": "Highway Engineering",
    "11": "Estimating & Costing",
    "12": "Construction Management",
    "13": "Airport Engineering"
  },
  level7: {
    "1": "Structural Engineering",
    "2": "Engineering Survey",
    "3": "Construction Materials",
    "4": "Concrete Technology",
    "5": "Geotechnical Engineering",
    "6": "Construction Management",
    "7": "Estimating & Costing",
    "8": "Engineering Drawing",
    "9": "Engineering Economics",
    "10": "Professional Practices"
  },
  gk: {
    "1": "Periodic Plans",
    "2": "Sustainable Development",
    "3": "International Affairs",
    "4": "Constitution",
    "5": "Governance",
    "6": "Civil Service",
    "7": "Public Services",
    "8": "Charter",
    "9": "Public Policy",
    "10": "Management",
    "11": "Planning & Accounting"
  },
  old_question: {
    "1": "Level 7 Sets",
    "2": "Level 5 Sets"
  }
};

const LEVEL_LABELS = {
  level5: "Level 5 — Diploma",
  level7: "Level 7 — Engineering",
  gk: "General Knowledge",
  old_question: "Old Questions / Sets"
};

const DRIVE = {
  level5: {
    "1": {
      "Sunil Sah": { "1-100": "1cbum1VGlNPm67SIxf6PebWb4u1fomHq7", "101-200": "1ZRhCGPHtJkkuBSub-tT8FGpBHP977iuI", "201-300": "1YnL2MhIhENsmObC38cRcwyQDoGUmN_eW", "301-400": "1wpB3nlapZwJnMDxfitJnUIxU6qLlTcem", "401-500": "1BI97YQZy8e1kEthlY4UmiZkLxJ2tQU8L", "501-572": "1gSrlO_87YotEmbZCAoOBpTH8RG2Q3PNj" }
    },
    "2": {
      "Sunil Sah": { "1-100": "1DCi7TZlsRLXbswMXZ_phkNSvpvR4qEYC", "101-200": "1l2_oKmLGjbMZJAY2EXniIcsXBjgox1LI", "201-300": "1D-Q5Dx7r_PeLb8tuQSJrfdDsSFwje__V", "301-400": "1Ofpj_R63e8ibarImI4Kx4Hjk1GZ5aknd", "401-500": "1WLSUMqyN8bnj9WuQPGRNxK0ssMqDtJ-O", "501-613": "1bQ-eFt4DnPTkejie6Jf435EtGEiwVobO" }
    },
    "3": {
      "Sunil Sah": { "1-100": "18PHUlO1w4w1P6fAJFl1sVA-vuaArgX4c", "101-200": "1WqWfdmpL-boetcfcaRVkAD07U2wScgMz", "201-300": "1P75cTo6Emx6cKMjhKpSHObrcIZK_Q48Z", "301-400": "1iltEhT0DIWa98sAnRSZs7l83Sl5Fp4PA", "401-432": "1H1u78Q95fPXDAzALAwMF2PyrKYqwIluc" }
    },
    "4": {
      "Sunil Sah": { "1-100": "1W0Haw_2D00dCGnytzmtiDG40WXiW356m", "101-200": "1q0lScj2EGQYv7n16ZY2qbluOG_xWtgd_", "201-300": "1--gbS8anKXq77VRjm76vm1JzPBQ81NjY", "301-400": "1TcZcXzv7A7eQP_WK7EEySIfWVESgF-fQ", "401-450": "1YwIBiSps43xKr3d5qeODQpW4bQcEFTNj", "451-520": "1WOcNHBJKZJzcjKDTKz215XvGN7N3o7WR" }
    },
    "5": {
      "Sunil Sah": { "1-100": "11DZsjZfw4WbmglOxGRErYh9VBNv1-yy7", "101-200": "1l6ZBNY7MlRItTKOsglSF9xDGEQ_hrVZI", "201-300": "1ZMPdpgCvJ4LNPVSr0enHKyGxVIr7QLth", "301-400": "1zKOJP55egY2xSu8yxTbQZwRulKyyqwb3" }
    },
    "6": {
      "Sunil Sah": { "1-100": "1ZTRwGwGkdg6DpZzVizUQEkF-Z1IQT3a2", "101-200": "1NJIDXdgssUhX0QcnmIIN0QLWQjuP-gjs", "201-300": "1n7Qn2gqNo6du6XKb7AjwBypuJIKKqXEd", "301-360": "1utWod1N1YyvWcxXTa-UkD6YobEPmVXri", "361-417": "1i9tauS85s-o8G3L49QgmBaE-6isjbRLW" }
    },
    "7": {
      "Sunil Sah": { "1-100": "1H8b2DIcDQQ4dCDRaJctM6mYOyMMa7Rh-", "101-200": "1jYggTJbHhYxZDvroz5XIk-1O-I-trv5A", "201-300": "15f2CiEgfd0y45C6YiAujV35bpvHBpGnG", "301-400": "1upPz6YXp7yLLjz73lnzUP828EFApy-Mb", "401-500": "1eVtbEWc9LGsLty0Y2ZM6PDeIk2ykBP2b", "501-600": "1_tytL1YFi_8glzjswiGKelgkQrvNNAfQ", "601-658": "1V_Cgasu59PipCReiiMRzcqeKDHwTfDoe", "659-716": "161Hw8Db80fggFIBHTkzKwiDqm9oApAA7" },
      "RK": { "1-65": "1kzYm9czns3Do26a2XV8-tTm5VSJ_TUXt", "65-130": "164FLjujhfBl-q2Q_CaYcuW0T89fY1avd", "131-195": "19DsKXwT_RSX1B_xlQHz06tR0J8HLNf1C", "196-265": "1mZP6ujsccyC8OlKwMyGssf9t4st7-sPB" }
    },
    "8": {
      "Sunil Sah": { "1-100": "1oCYIwNj8h6SdiOP4bB5HNG3cyX6ZRygd", "101-200": "1lSJuN-fvaBRsyABUNPApWm09rZn_V0ko", "201-300": "1aEj_hw63qbOfJsIp1AwnyulTRIQ-e1xh", "301-400": "1tHiL_rKWaNRHd0y2yphJpElMNKBLDiGq", "401-500": "1A1Hh0YqmMLsLE7-Ey-9YrYHbRYccE7iZ", "501-554": "1LnUcKO28KnhVXIerrj003UsrLAiTdUoP" }
    },
    "9": {
      "Sunil Sah": { "1-100": "1SFVGZBZCmcsMlBRLuv3rKjOr-ocKuJTy", "101-200": "1CeQH3i49wF9dc0e6mIznjiSA3A9Qxf3u", "201-300": "1ho8sdNzmE9YHBfUCBWg86ti4oH8w_UxE", "301-375": "1Zg4rlXqtmFgUctS53I_ga_gtj-u3KEPC", "376-454": "1rcHJY4DnOgABTsz1JrrwUlLcfU7VWKhm" }
    },
    "10": {
      "Sunil Sah": { "1-100": "1oglXPjLqCifewdj8-0MDx-UI5oCVyJ0G", "101-200": "1DJWlgozHY4-Obn4FAzL4ITZZJIiyCcrD", "201-300": "1NdciqWDMenHJd9Nl2euJaazASJRkYbtE", "301-400": "1ZDhz_MWRSrGpOqNXj69-Plkl2RRaja9M", "401-449": "1KEops4saZRcQGJPtcFAunGue8A392Qwy" }
    },
    "11": {
      "R.K Shrestha": { "1-50": "1ivzRvvI9ZqXyyin4ncwW-GQIzECHOEDF", "50-100": "1RLHdLWtDPgQnpNDpO4fdRGBHwMI0LLsX", "100-183": "1RLHdLWtDPgQnpNDpO4fdRGBHwMI0LLsX" },
      "Sunil Sah": { "1-50": "1PatlHpX83cgMO8VH9bbOq6aRoifCNoNW", "50-100": "1S82Lnx41zlFQx4-H7bGWW1Zt-I7zCeSx", "100-150": "1pN1as3DjClVrYhEWBKXXwR2n4Egd4IIc", "151-200": "1WdqpEn0eSgZzhbT7X5ycF6m57bpRctBZ", "200-260": "1WmIZf9XFN9CUPxJ9rzwBf6NvE_qrje42", "261-312": "1wJZMh8dJYUF4Pm-qa80sU0sYMYX8hhKj" }
    },
    "12": {
      "Sunil Sah": { "1-100": "1atj3Pt2St3Ag_9Lp1IIKfyFfzyES4jCu", "101-200": "1EgH0tKtUJQVmsopLeh61lXTTDzMqbMy6", "201-300": "1ErTJa6lzuCmqtcWMFMH-bwWQnsTPQByU", "301-348": "10YYfufwvVqTi5XKlSlDQRzeap99HI8Lo" }
    },
    "13": {
      "DPARSAD": { "142": "1uxYrB-uf5NSsrjV51lL7hsrvdlDfWP0i" },
      "Sunil Sah": { "1-70": "1W_tOzVueuNMTJEj4Zuwxkk4TxaSyHMm1", "71-154": "1t8HiHvCUclSdZ_le0PzOe-D5a77xsVpj" }
    }
  },
  level7: {
    "1": {
      "DPARSAD": { "1-70": "1h3NQ9AL7DSx-5K3uU7XSb9Q7CvPiRwPD", "71-140": "1mgOsZkjGqWZ1AOhu1oQ6ZWtIOA-R3RwS", "141-228": "1ulh8RD7_hHeBUyrRD95kW_bgyvKQsk51" }
    },
    "2": {
      "DPARSAD": { "1-100": "1LvYcqMIW_r9qRTyIywemx9vpq_SvkHhd", "101-175": "14zRkZBGZnFXkxGylMqplHxDgq53CWayc", "175-250": "1TzBMpOzm-Qp5-yqB5T7y7J3cS06Kt8vs", "250-350": "1jw4nzypzxqQo7xO9JcRUUtyVL1U6kbDq", "350-455": "1K1C4cyYliqsH84pwlxrBmux8HNUtv9Ra" }
    },
    "3": {
      "DPARSAD": { "1-100": "1v1LXYwzNF2TafCQKunBOrxl_UHn8W7NO", "101-175": "1xXcFMVIymWnuTOJF-nh9SSJzuXNQYfWr", "176-255": "1-XkoaqH9T6hRKec8j-dfuJwPKQDKYpFt", "256-350": "1Z-kyfriVVY8ROCOK7_jrzVg2SuL2xP29", "350-477": "1jTaYfKLulzd7heCGJc4BLR5kaaQA0mX2" }
    },
    "4": {
      "DPARSAD": { "1-50": "1jhAs_3b61Cn6YjY45hHqwO2ceJuygbr_", "50-100": "11UWRoG-JKMxE28HF44iUGYidJ46XIi17", "100-150": "13T28p8WnYFPqNguu_4YsRnFJ5zOlaQ5B", "150-200": "1OjdrC5yQ4x8jTijTNm6VmOWG5bqoBpQ5", "201-250": "1hAP5zyfL5MaK1EqS_J-ZSWQXAX3J0UOB", "250-300": "1sRb5evs5CLiK0xDn6wHP0qQmi2sY8f4s", "300-350": "1Bug0gYU7UcILpX9je5xtgfWfHZIEN4W6", "350-405": "1UoQ5GoTD_ggx9AJqAaqYgfLARb10pqOp" },
       "RK SHRESTHA": { "1-80": "1ogn7X2qg57YbNVu_ExzsW4aas-8TKEU_", "80-160": "1EaAqgiwXjaXsiwP9NBB2Vn07RhIBfPTZ", "160-240": "1GgimqtgDGbUjdXAVP6J4KXdfEx5NcFhF" }
    },
    "5": {
      "DPARSAD": { "All": "1ipRrpTWBA7JIdwCuTY73ZZwY0CTM-LAP" }
    },
    "6": {
      "New DPARSAD": { "1-75": "1cQGpQHGzekcDnE2duOkYzx3NAoeuPv5h", "76-150": "1T2tghXwm_6Dqy5FkQgs0wiRrhl0NQuGM", "151-225": "1tro7AirSkoOm9zYvJyQo5W_hlUvoqvlg", "225-310": "12jhiq9Jbp3EwvqJgW_bxyPq77IYfUEAa" },
       "Old DPRASAD ":{ "1-50": "1qtgweA9KWmVLREF4rm7D6sCUdc1NMqLQ", "50-100": "1981sMj5WNTZeKsghbz4N_eEqqxm1XbT5", "100-150": "1KY9GTqB8sTJpGha_JnYYE9Pvnnzotf9h", "150-200": "18HnjG1-leT6OXk5mYPGTJluMw2yiFUEy","200-300": "1KA-3P2cmmQKQRmr_-UU74ik_MmNsJ8F2" }
    },
    "7": {
      "DPARSAD": { "1-50": "1WR0c-cQrD6ZNrpW31pgFTrhekyT_0n4K", "51-100": "1RjkK83GYpLncIqJJ2FGYkHh0FGGksJ_J", "101-150": "1O3bhzDvGZfUTy1T9guFuq_aAn3PAq7Xi", "151-200": "1E22sJNC6miJwVNDD5cz8EW3OXTWKc4XT", "201-250": "17--tjx9xOlDmZD_kFEoZb620aoB-cvQt" }
    },
    "8": {
      "DPARSAD": { "1-100": "1WqQPC_gqQ8gM43tMEatrpvFb91Rzfb5k", "101-183": "1AXIlR6OKS9cG65HU5xZvyJWeNj6-MJk1" }
    },
    "9": {
      "DPARSAD": { "1-75": "1vzp6vp3jscMoDEsNwLTAdX6fw2qoOe55", "75-129": "1abshceD1-c5wygd9L32gAoLpuYdBqkd8" }
    },
    "10": {
      "DPARSAD": { "1-111": "16Yw0SALw-Vk1KR-7HnRZdetJFqarj7S2" }
    }
  },
  gk: {
    "1": {
      "DPARSAD": { "All": "" },
      "GATE": { "All": "1S39S--nt9QVepKlcszdpntB8rRgAEqfd" }
    },
    "2": {
      "DPARSAD": { "All": "" },
      "GATE": { "All": "1922CKz8p81DWUWhimygloqKDNDQXbXXF" }
    },
    "3": {
      "DPARSAD": { "All": "" },
      "GATE": { "All": "1Yh9k58ZRbABVg7H6CEcr1xUIBgzAkl80" }
    },
    "4": {
      "DPARSAD": { "All": "" },
      "GATE": { "All": "1cKROTH8wtJh5-JAR20i5CpQK7a-nvFx_" }
    },
    "5": {
      "DPARSAD": { "All": "" },
      "GATE": { "All": "1xO4bk4QCPzqCORupW07MtNj-60OFlqZE" }
    },
    "6": {
      "GATE": { "All": "1W628YzIRlatpN0BhdtVqv1V7q44Fn8F0" },
      "DPARSAD": { "All": "" }
    },
    "7": {
      "GATE": { "All": "1TdUQchW6i2LBKdWsjMNNTGwB5hAR1iCB" },
      "DPARSAD": { "All": "" }
    },
    "8": {
      "GATE": { "All": "1SkPP7n4nIjmdEzWu8zZ5nywQaY2BmGQD" },
      "DPARSAD": { "All": "" }
    },
    "9": {
      "GATE": { "All": "1u3hA3p7wtUaDvzDioLVrFaq02WUuNCpt" },
      "DPARSAD": { "All": "" }
    },
    "10": {
      "GATE": { "All": "1G5BtPfzG_bnmDhIORtJM6N5cmCEiAt3A" },
      "DPARSAD": { "All": "" }
    },
    "11": {
      "DPARSAD": { "All": "1ZIbu4pcNLDw-N_kGEUtdNVtJqxNX0c_T" },
      "GATE": { "All": "1Z-UfiYm3_OHviX0sHzNl8elsF-lzqlkK" }
    }
  },
  old_question: {
    "1": {
      "PSC": { "81": "", "82": "", "83": "" }
    },
    "2": {
      "PSC": { "81": "", "82": "", "83": "" }
    }
  }
};

/* Quick helpers used by app.js — kept here since they're pure data lookups.
   NOTE: DRIVE is now 4 levels deep (level -> chapter -> book -> subtopic -> fileId).
   allFileRefs() (used by Psycho Mode, Daily Challenge, Offline Cache) returns
   the same flat {lv,ch,name,fid,key} shape as before, just with `name` now
   reading "Book — Subtopic" and `key` including the book — so any code that
   only consumes allFileRefs() output needed no changes at all. */
const ChapterData = {
  levels(){ return Object.keys(CH_NAMES); },
  levelLabel(lv){ return LEVEL_LABELS[lv] || lv; },
  chapters(lv){ return CH_NAMES[lv] || {}; },
  chapterName(lv, ch){ return (CH_NAMES[lv] || {})[ch] || `Chapter ${ch}`; },

  // All books under a chapter -> { "Sunil Sah": {...subtopics}, "RK": {...} }
  books(lv, ch){ return (DRIVE[lv] && DRIVE[lv][ch]) || {}; },
  bookNames(lv, ch){ return Object.keys(ChapterData.books(lv, ch)); },

  // Subtopics (the actual fileId map) for one specific book.
  files(lv, ch, book){ const b = ChapterData.books(lv, ch); return b[book] || {}; },

  // Non-empty (usable) file count. Used across the whole chapter (all books
  // combined) when `book` is omitted, or just within one book when given.
  fileCount(lv, ch, book){
    if (book !== undefined) {
      return Object.values(ChapterData.files(lv, ch, book)).filter(Boolean).length;
    }
    let n = 0;
    for (const b of Object.values(ChapterData.books(lv, ch))) {
      n += Object.values(b).filter(Boolean).length;
    }
    return n;
  },
  totalFilesInLevel(lv){
    let sum = 0;
    for (const ch of Object.keys(DRIVE[lv] || {})) sum += ChapterData.fileCount(lv, ch);
    return sum;
  },

  // Flat list of every usable file within one chapter (across all its
  // books) — used by Psycho Mode instead of walking DRIVE directly.
  // Memoized per (lv, ch): DRIVE is static content baked into this file,
  // never mutated at runtime, so there's no reason to rebuild the same
  // list every time a screen re-renders. Callers only ever read/filter
  // the result, never mutate it in place, so sharing the cached array is
  // safe.
  _chapterFileRefsCache: {},
  chapterFileRefs(lv, ch){
    const cacheKey = `${lv}_${ch}`;
    const cached = ChapterData._chapterFileRefsCache[cacheKey];
    if (cached) return cached;
    const out = [];
    const books = ChapterData.books(lv, ch);
    for (const book of Object.keys(books)) {
      const subs = books[book];
      for (const subtopic of Object.keys(subs)) {
        const fid = subs[subtopic];
        if (!fid) continue;
        out.push({ lv, ch, book, subtopic, name: `${book} — ${subtopic}`, fid, key: `${lv}_${ch}_${book}_${subtopic}` });
      }
    }
    ChapterData._chapterFileRefsCache[cacheKey] = out;
    return out;
  },

  // Flat list of {lv, ch, name, fid, key} across the whole dataset — used by
  // Psycho Mode "select all", Daily Challenge, and Offline Cache download.
  // Memoized for the same reason as chapterFileRefs() above.
  _allFileRefsCache: null,
  allFileRefs(){
    if (ChapterData._allFileRefsCache) return ChapterData._allFileRefsCache;
    const out = [];
    for (const lv of Object.keys(DRIVE)) {
      for (const ch of Object.keys(DRIVE[lv])) {
        out.push(...ChapterData.chapterFileRefs(lv, ch));
      }
    }
    ChapterData._allFileRefsCache = out;
    return out;
  }
};
