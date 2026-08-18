/* ═══════════════════════════════════════════════════════════════
   CHAPTER DATA.js
   ───────────────────────────────────────────────────────────────
   Updated 2026-08-16 (v6).

   Chapters "1" (Structural Engineering), "2" (Engineering Survey),
   "3" (Construction Materials), "4" (Concrete Technology), "7"
   (Estimating & Costing), "8" (Engineering Drawing) and "9"
   (Engineering Economics) under level7 now point to REAL
   question-bank files. All other chapters still point to the
   earlier placeholder subtopic files — swap those in as real
   content gets uploaded/sorted for them.

   Estimating & Costing content (249 questions, #246 absent in the
   user's own source numbering) was pulled from the user's ESTIMATE
   folder (5 source files, Q1-250) and re-sorted into the 6 official
   subtopics.

   Engineering Economics originally had only ONE listed subtopic
   (11.1 Benefit Cost Analysis), but the user's source (127 questions
   from the economics folder, Q1-127) actually spans interest/time
   value, annuities, NPV/IRR/worth methods, cost concepts,
   break-even/sensitivity, and basic economics — so with the user's
   approval the subtopic list for chapter "9" was expanded from 1 to
   6 real subtopics to match. This is the one chapter where the
   official subtopic list itself was changed, not just re-sorted.

   Concrete Technology content (645 questions) was pulled from the
   user's uploaded source files (601-80/681-760/761-842.json and
   Concrete_1-50 through conc_350-405.json), re-sorted into the 7
   official subtopics, and uploaded fresh here — none of the old
   placeholder fileIds were reused.

   Engineering Survey content (455 questions) was pulled from the
   user's older Drive archive (LEVEL 7 / survey folder, 5 source
   files covering Q1-455), re-sorted into the 11 official subtopics,
   and uploaded fresh here — none of the old fileIds were reused.

   HIERARCHY (4 levels, same shape as before):
     Level (level7 / gk)
       -> Chapter (e.g. "2": "Engineering Survey")
         -> Book (single source here: "Abhyas")
           -> Subtopic (e.g. "4.1 INTRO&CLASSIFICATION") -> Google Drive fileId
══════════════════════════════════════════════════════════════ */

const CH_NAMES = {
  level5: {},
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
    "1": "General Awareness and Contemporary Issues",
    "2": "General Reasoning Test"
  },
  old_question: {}
};

const LEVEL_LABELS = {
  level5: "Level 5 — Diploma",
  level7: "Level 7 — Engineering",
  gk: "General Knowledge and IQ",
  old_question: "Old Questions / Sets"
};

const DRIVE = {
  level5: {},
  level7: {
    "1": {
      "Abhyas": {
        "3.1 CG&MOI": "1EG0uEIOS9dSx91PmGfWHvDR6UtCRv1D6",
        "3.2 STRESS&TORSION": "19c5aF_fDmwhFn328w6NmCrzgas3FT-c2",
        "3.3 BEAM&FRAME": "1zX9WrcT4wky0-I8vTlzF0wEWgxOl7iBr",
        "3.4 DETERMINATE STR": "1bbVC4CKhpG4WXF2qbem4EpBqRyFlhZoq",
        "3.5 INDETERMINATE STR": "1QCQ_zcsbEG1ozW5b7x2COlLwjaZd6jFl",
        "3.6 PLASTIC ANALYSIS": "1_rbUBhMRiJn-OMjk1Gf8gjFhkzpeZY8a"
      }
    },
    "2": {
      "Abhyas": {
        "4.1 INTRO&CLASSIFICATION": "1wbPJT2kei3KARwCNpYfaMp6zyJS_H3Fy",
        "4.2 LINEAR MEASUREMENT": "1vjeazMh9SHKejUGzS9zpv5yTZEJUTrkO",
        "4.3 COMPASS": "19Uw3ELNKuxqt5xGYtVnyBBV1Hydzd_2N",
        "4.4 PLANE TABLE": "1ffYjw6PACS3Ate0E4TBV3Metsaj-9O7O",
        "4.5 LEVELING": "1g7P_VQ8-sf0WOB4t9AXlUCPCrSkp1kDG",
        "4.6 CONTOURING": "1EIsFNCEkpDcsMdr-CRC8XGkPriVmWGqc",
        "4.7 THEODOLITE TRAVERSE": "1aJmlhaUdz1u_60ZEBMV507wWEoJsCNgw",
        "4.8 TACHEOMETRY": "1tPehSRACcKb39lHQAIyN9qsHk73uXnTi",
        "4.9 TOTAL STATION": "1A6tik-Wn8jhE6cu3m8Bhy6dRnrGeHe65",
        "4.10 CURVES": "1CtK008-ohQtBw-qNdGlDljBvv9OnZQvq",
        "4.11 AREA&VOLUME": "1ywPr6-7BdvgV1vFu6k_MN4r1QdH12VDf"
      }
    },
    "3": {
      "Abhyas": {
        "5.1 MATERIAL PROPERTIES": "13dxdpQPDOnP7npN1bdzsaA1OfriW_Ts3",
        "5.2 STONES": "1FeyTH5YX_oaqwkicY3EOAp_yfVSqcoh3",
        "5.3 CERAMIC MATERIALS": "1EJOdjRII6R3I1qTvGSHJxMTseUAKiMW-",
        "5.4 CEMENTING MATERIALS": "1Kn2zkXYtb8QsgrYwlw9SYBsnvNMtSkyu",
        "5.5 METALS": "1-w2GgK5x_BQOXV1L4PmmX--I6pu2-Pjj",
        "5.6 TIMBER&WOOD": "1xm9bJdbLm-9OA-sj0X4Ros8S_5KVB9qx",
        "5.7 MISC MATERIALS": "1yNLIr5MA5MUYljoa29Bdi_1JTsqvI_hj",
        "5.8 SOIL PROPERTIES": "1gyyZj77lsbMRHsKodEJJqzjHmOY5F7R5",
        "5.9 LOCAL&MODERN MAT": "1dF0aR228CrYtLYEg79C9-n8u6yOlU9Sb"
      }
    },
    "4": {
      "Abhyas": {
        "6.1 CONCRETE CONSTITUENTS": "1iazvTuHBDaQxJCENIhxUwnsqzVjCG2Jx",
        "6.2 W-C RATIO": "1IlHQ-3GXveMhfd_E_hiF-_cdJzaRuoSr",
        "6.3 GRADE&MIX DESIGN": "1te_KTUkxYfalKxdyVA2s-8Uy2NDok0kI",
        "6.4 MIXING&CURING": "14yqGXhxO3SGFBVkBNcwTwxPJG-zQYrUC",
        "6.5 ADMIXTURES": "1fQLh_9juinKD_hV3KLBEcltdd5F-poV3",
        "6.6 HIGH STRENGTH CONC": "1ee6mpS2WoaIEVxjXW8MiJbDxHVvWDKkx",
        "6.7 PRESTRESSED CONC": "1kr7oUnuhWKF1eV57RZWc7ZebNIXpZQc5"
      }
    },
    "5": {
      "Abhyas": {
        "7.1 SOIL FORMATION": "1SyIZ2C2Jpoz4v4mO0_qu5a4Uldp9xjf_",
        "7.2 3-PHASE SOIL": "1KoGtFbARuQ55_DZZ5_Aj6ox5YsxjIIDj",
        "7.3 WATER IN SOIL": "1JY8qtz3biEOuumo999cYJXXTAGPabs2o",
        "7.4 INDEX PROPERTIES": "1dvJxWWytsMT-rp0_ZmfweI0wpxzf36fD",
        "7.5 ROCK&EARTHQUAKE": "1z8VG1QCaR22ADhZFycxFFyPKoSfcKw1U",
        "7.6 TUNNELING": "1BO3UpqbjxApK8fdxp3K_Irv6o3FNSIDa"
      }
    },
    "6": {
      "Abhyas": {
        "8.1 SCHEDULING&PLANNING": "1YsYSgyyQBCg7i-bhjgnGIrkHAxMS8SYT",
        "8.2 CONTRACTUAL PROCEDURE": "1g5SZKQWAWTaCLcUWzI9633BU0cjlrnKX",
        "8.3 MATERIAL MGMT": "1PaQyim1Yi-LtbzwyJIJBWJvh-OgFRNOL",
        "8.4 COST QUALITY TIME": "1Q1PZdA93pNlYZOqjTMAVNOz-hns7HPPS",
        "8.5 PROJECT MGMT": "14cx77ttodTVLkcEP971tvKzmpoiRo2A2",
        "8.6 HEALTH&SAFETY": "1lpQVYz-aGUkidY1n3Ld6oCPVTiJ26KNI",
        "8.7 MONITORING&EVAL": "1tMjk28egri_cXvYAz-U4mm7BH5hWYcXH",
        "8.8 QA PLAN": "1J-NXDvQ-7MT57CtaQQ1CXOEsz7FC3vhL",
        "8.9 VARIATION&ALTERATION": "1LhlLFupso6qxaHmhh40OQ_GHaeRJbN65"
      }
    },
    "7": {
      "Abhyas": {
        "9.1 TYPES OF ESTIMATES": "1MQesOkFEVzpRyZ7f5ZJxmmJixEuYLEVO",
        "9.2 QUANTITY CALC": "1d77m_6-DqGeMHYizeZxlCPzhSgeRmNEB",
        "9.3 RATE ANALYSIS": "1iI4ZsKFdS3VfIRPnt07pmAlpV1Qpjbn1",
        "9.4 BOQ": "1QzTZRC37wpfmtvdr9DF4TaZECyT3gWWZ",
        "9.5 SPECIFICATION": "1zv_Kj1b5OinAqFtTTprikNvMRfWbh8iW",
        "9.6 VALUATION": "19b5w82zFWyzfMP6GNDzMsNWs8W6gHfgA"
      }
    },
    "8": {
      "Abhyas": {
        "10.1 DRAWING SHEET": "1QYmvyWgDEpKZuJCY2PVmT-iapsjYt6bE",
        "10.2 SCALES&SITE PLANS": "1P82yikIheWhYE9lbZXPxLT4FJLn0zJ-g",
        "10.3 PROJECTION THEORY": "1vxdlZFCJhfIrYL0Px3kCllGJb1nQnyS-",
        "10.4 DRAFTING TOOLS": "1u5M7zPP7IcRNWeSh-K7Zkxif2wPFsdCe",
        "10.5 DRAFTING CONVENTIONS": "1P0J4nuGdxfRkUBirAIbZvMl5UYd40okm",
        "10.6 TOPO&SERVICE DWG": "1DR4vlhVXdkFk1OdUqqbiX7K9qjclpTqK",
        "10.7 FREEHAND DRAWING": "1_fhZYcuOynoNlRm-yQjBvx15ct3Hdra_"
      }
    },
    "9": {
      "Abhyas": {
        "11.1 INTEREST&TIME VALUE": "1BXoTkgknjpCG5LzLRtj8k6QJoHPtcZpg",
        "11.2 ANNUITIES&SINKING FUND": "1QMnGhrfoV5F47eVQ-_APk2kxVYnaVOBn",
        "11.3 NPV IRR WORTH METHODS": "1NupM_Qdz5qYrug0WHKLPPfFMnqSsIhXw",
        "11.4 COST CONCEPTS": "1f3JdoFQeQqugV2c1-iMJ2v15A8pQs7gM",
        "11.5 BREAKEVEN&SENSITIVITY": "1Nv2D1WJfWTbX7paoLlQMO87lcnMJLPbU",
        "11.6 ECONOMICS BASICS": "1LJkfj2iru8Ue2ZKkLSrTH3Qk4Mx7ABd4"
      }
    },
    "10": {
      "Abhyas": {
        "12.1 ETHICS&INTEGRITY": "1JtVtoN-z3_fHW9VrMUyTkQg_nzmD3lw2",
        "12.2 NEC ACT": "1xipAp3_uux-3H4ms0bxX3_f7aQOLZTO-",
        "12.3 CLIENT&CONTRACTOR REL": "1ekwh7abKFvBy4ZBhrrFakCjXXWtevw-e",
        "12.4 PUBLIC PROCUREMENT": "1uDwPTlSpubLowyxKB5Bty0yclG_aKyH8",
        "12.5 NBC": "1_JEkzhm07SmcKejscg5hkCB44sQqknR1",
        "12.6 BUILDING BYLAWS": "17mDJyHSvDCYjwnlsAvAoPptHQzss9TWU"
      }
    }
  },
  gk: {
    "1": {
      "Abhyas": {
        "1.1 GEO&DEMO": "1F20fh00eQpPXs45QXW7T3gFT1xlMf734",
        "1.2 NAT RESOURCES": "1VHUZPsulfZHy2iMPDC07kCWyAnBQy8jL",
        "1.3 GEO DIVERSITY&CLIMATE": "1yH-DJSPVgAVRlASd1b0-nCmsPC6Wu6BF",
        "1.4 MODERN HISTORY": "1kl_W3zRZf625Yc_WoRMx-Q552sNDLfsq",
        "1.5 PERIODIC PLAN": "19wKOhaIw1y-yJneyUwQDDv0-fPw0i7tL",
        "1.6 SUST DEV&ENV": "1h6TTxSnMnIcYV8riyTgsDcG4QvCfi9eW",
        "1.7 INTL AFFAIRS": "1XpoO3NsQFwcDDdSks8xBzlTKUpb353vb",
        "1.8 CONSTITUTION": "1ekHVTT84JW1U8xplW_SqsN5I2VDFI-K2",
        "1.9 GOVERNANCE": "1bTztLbaAcEjy9_pJ1jDK_99utkAImae1",
        "1.10 CIVIL SERVICE ACT": "1rnZIF8vRPmYEMXO6B3GWpeSRSz9IzS6x",
        "1.11 FUNCTIONAL SCOPE": "16_eBtRVcS1VvLkEafwTT0ky9vf5I6rB4",
        "1.12 PSC": "1sl2eGivffxVph_TcUTH6p6GqcDcv28Nd",
        "1.13 PUBLIC POLICY": "1Lamc5bwUId2EEZ2eFWl80tpnb999QUQ7",
        "1.14 MGMT FUNDAMENTALS": "1j5xcwSAZCRQ5oBm98N2R79uaOUD7SAUu",
        "1.15 BUDGET&ACCOUNTING": "1fptEiZVBE_jzmVqoeoXzgBbTM9xcAQoY",
        "1.16 CURRENT AFFAIRS": "1RihlAcMkOLvNjGwkFvm_q9IMNLLjlhsI"
      }
    },
    "2": {
      "Abhyas": {
        "2.1 LOGICAL REASONING": "1bwgC1qylMuepvp52rqvW4IleuVWUpOTV",
        "2.2 NUMERICAL REASONING": "1ZWWRRh1ZZc_B__u4cGQsk5bQZc7GKpLX",
        "2.3 SPATIAL REASONING": "1cMGd3B5N-e9NbgShSlF1QAsW8VuYjPwx"
      }
    }
  },
  old_question: {}
};

/* Quick helpers used by app.js — kept here since they're pure data lookups.
   DRIVE is level -> chapter -> book -> subtopic -> fileId.
   allFileRefs() returns a flat {lv,ch,name,fid,key} shape, with `name`
   reading "Book — Subtopic" and `key` including the book. */
const ChapterData = {
  levels(){ return Object.keys(CH_NAMES); },
  levelLabel(lv){ return LEVEL_LABELS[lv] || lv; },
  chapters(lv){ return CH_NAMES[lv] || {}; },
  chapterName(lv, ch){ return (CH_NAMES[lv] || {})[ch] || `Chapter ${ch}`; },

  books(lv, ch){ return (DRIVE[lv] && DRIVE[lv][ch]) || {}; },
  bookNames(lv, ch){ return Object.keys(ChapterData.books(lv, ch)); },

  files(lv, ch, book){ const b = ChapterData.books(lv, ch); return b[book] || {}; },

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

  chapterFileRefs(lv, ch){
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
    return out;
  },

  allFileRefs(){
    const out = [];
    for (const lv of Object.keys(DRIVE)) {
      for (const ch of Object.keys(DRIVE[lv])) {
        out.push(...ChapterData.chapterFileRefs(lv, ch));
      }
    }
    return out;
  }
};
