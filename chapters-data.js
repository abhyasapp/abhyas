/* ══════════════════════════════════════════════════════════════════════
   CHAPTERS-DATA.JS
   ──────────────────────────────────────────────────────────────────────
   LEVEL 5 + LEVEL 7 + GK — compiled from live Google Drive crawls:

   LEVEL 5
   • 'level 5' folder shared with you by 077bce046@gmail.com
     (shared 2026-09-05)

   LEVEL 7
   • 'Abhyas' book       -> your own Drive, ABHYAS / LEVEL 7 folder tree
   • all other books     -> the separate 'LEVEL 7' folder shared with you
                            by 077bce046@gmail.com

   GK (this section)
   • RE-FLATTENED on request: every individual Abhyas subtopic number is
     now its OWN top-level chapter key (no more grouping into just "1" and
     "2"). So instead of Chapter "1" containing subtopics 1.1-1.17, there
     are now 17 separate chapters keyed "1.1", "1.2", ... "1.17", plus 3
     more keyed "2.1", "2.2", "2.3" for the old Reasoning-Test chapter.
     Chapter names are the Abhyas topic titles (e.g. "1.7": "INTL AFFAIRS").
   • Under each of these chapters, the BOOK layer is the source: 'Abhyas',
     'GATE', 'SAARC', or 'Planning and Management' — whichever of those
     actually has a file for that subtopic. (No 'DPARSAD' book exists for
     GK specifically — that source only shows up in Level 5 / Level 7.)
   • Below the book, the leaf key is 'All' for single-file books, or a
     short descriptor when a book has more than one file for that chapter,
     e.g. chapter "1.7" / book 'GATE' has 'General', '101-150', '151-180';
     chapter "1.7" / book 'SAARC' has 'Batch 1', 'Batch 2'; chapter "1.14"
     / book 'Planning and Management' has 'Fundamentals of management' and
     'Part 2'.
   • Chapters "1.1"-"1.4", "1.12", "1.15", "1.16" and all of "2.1"-"2.3"
     are Abhyas-only (no shared-folder equivalent exists yet). Chapter
     "1.17" (Charter) is GATE-only (no Abhyas equivalent — added earlier
     on request, extending Abhyas's numbering by one).

   Hierarchy: Chapter -> Book -> Subtopic -> Google Drive fileId

   NOTES / FLAGS — LEVEL 5 / LEVEL 7: unchanged from prior passes — see
   in-repo history/chat for full detail (book-name normalization, the
   3-book Construction Management chapter in Level 7, excluded stub files,
   etc.)
   ══════════════════════════════════════════════════════════════════════ */


/* ========================================================================
   CHAPTER NAMES
   ======================================================================== */

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
    "1.1": "GEO&DEMO",
    "1.2": "NAT RESOURCES",
    "1.3": "GEO DIVERSITY&CLIMATE",
    "1.4": "MODERN HISTORY",
    "1.5": "PERIODIC PLAN",
    "1.6": "SUST DEV&ENV",
    "1.7": "INTL AFFAIRS",
    "1.8": "CONSTITUTION",
    "1.9": "GOVERNANCE",
    "1.10": "CIVIL SERVICE ACT",
    "1.11": "FUNCTIONAL SCOPE",
    "1.12": "PSC",
    "1.13": "PUBLIC POLICY",
    "1.14": "MGMT FUNDAMENTALS",
    "1.15": "BUDGET&ACCOUNTING",
    "1.16": "CURRENT AFFAIRS",
    "1.17": "CHARTER",
    "2.1": "LOGICAL REASONING",
    "2.2": "NUMERICAL REASONING",
    "2.3": "SPATIAL REASONING"
  }

};


const LEVEL_LABELS = {
  level5: "Level 5 — Diploma",
  level7: "Level 7 — Engineering",
  gk: "General Knowledge (shared)"
};


/* ========================================================================
   DRIVE DATA
   ======================================================================== */

const DRIVE = {

  /* ======================================================================
     LEVEL 5
     ===================================================================== */

  level5: {

    /* Chapter 1 — Engineering Survey */
    "1": {
      "Sunil Sah": {
        "1-100": "1OAlD5XUf-Ecmj4hNViPAqInI5GUcMExG",
        "101-200": "1Q6E7isqILUnHG9ZPxTsIltIlEodqr05i",
        "201-300": "1vZRNltiqTuJxJn8RVCzrSojNeyRYFEfp",
        "301-400": "13z92Vn1uV7Gw217q-GXQVuOQoV9gUrJO",
        "401-500": "1OikW1FEi5Zuei4IrWpbjsTr3-O_hY8PQ",
        "501-575": "1WUg2w7SlHVpAEyOlFyfbnymQ-xivfwNi"
      }
    },

    /* Chapter 2 — Construction Materials */
    "2": {
      "Sunil Sah": {
        "1-100": "1DCi7TZlsRLXbswMXZ_phkNSvpvR4qEYC",
        "101-200": "1l2_oKmLGjbMZJAY2EXniIcsXBjgox1LI",
        "201-300": "1D-Q5Dx7r_PeLb8tuQSJrfdDsSFwje__V",
        "301-400": "1Ofpj_R63e8ibarImI4Kx4Hjk1GZ5aknd",
        "401-500": "1WLSUMqyN8bnj9WuQPGRNxK0ssMqDtJ-O",
        "501-613": "1bQ-eFt4DnPTkejie6Jf435EtGEiwVobO"
      }
    },

    /* Chapter 3 — Mechanics of Material */
    "3": {
      "Sunil Sah": {
        "1-100": "18PHUlO1w4w1P6fAJFl1sVA-vuaArgX4c",
        "101-200": "1WqWfdmpL-boetcfcaRVkAD07U2wScgMz",
        "201-300": "1P75cTo6Emx6cKMjhKpSHObrcIZK_Q48Z",
        "301-400": "1iltEhT0DIWa98sAnRSZs7l83Sl5Fp4PA",
        "401-432": "1H1u78Q95fPXDAzALAwMF2PyrKYqwIluc"
      },

      "DPARSAD": {
        "Beam Diagram Relations & Thrust (Q165-187)": "1ZOWTP4bQeuvcwui5xkjqppdCUBY_WT-0",
        "Bending & Deflection Theory (Q117-164)": "1zkZh7YFEn_-fyk1QfxBtl3VvQ5aY-Euk",
        "Columns, Struts, Ties & Trusses (Q188-221)": "1_1IxcEHCZPlqN5JfT0agDZXoUxBmiroN",
        "General SOM Revision - Mixed (Q222-250)": "1q3-aYC9cL7u7Ga4r5kGgGVE9BCiipX8J",
        "Shear Force & Bending Moment Basics (Q54-116)": "18XMCDrjLIHKW8aHJYleGOgsnBFX5ANyH",
        "Stress-Strain & Elastic Properties (Q1-53)": "1RWIKVWCl9djWzUyAL0fMOoeNLIYQfQAo"
      }
    },

    /* Chapter 4 — Hydraulics */
    "4": {
      "Sunil Sah": {
        "1-100": "1W0Haw_2D00dCGnytzmtiDG40WXiW356m",
        "101-200": "1q0lScj2EGQYv7n16ZY2qbluOG_xWtgd_",
        "201-300": "1--gbS8anKXq77VRjm76vm1JzPBQ81NjY",
        "301-400": "1TcZcXzv7A7eQP_WK7EEySIfWVESgF-fQ",
        "401-450": "1YwIBiSps43xKr3d5qeODQpW4bQcEFTNj",
        "451-520": "1WOcNHBJKZJzcjKDTKz215XvGN7N3o7WR"
      }
    },

    /* Chapter 5 — Soil Mechanics */
    "5": {
      "Sunil Sah": {
        "1-100": "11DZsjZfw4WbmglOxGRErYh9VBNv1-yy7",
        "101-200": "1l6ZBNY7MlRItTKOsglSF9xDGEQ_hrVZI",
        "201-300": "1ZMPdpgCvJ4LNPVSr0enHKyGxVIr7QLth",
        "301-400": "1zKOJP55egY2xSu8yxTbQZwRulKyyqwb3"
      }
    },

    /* Chapter 6 — Structural Design */
    "6": {
      "Sunil Sah": {
        "1-100": "1ZTRwGwGkdg6DpZzVizUQEkF-Z1IQT3a2",
        "101-200": "1NJIDXdgssUhX0QcnmIIN0QLWQjuP-gjs",
        "201-300": "1n7Qn2gqNo6du6XKb7AjwBypuJIKKqXEd",
        "301-360": "1utWod1N1YyvWcxXTa-UkD6YobEPmVXri",
        "361-417": "1i9tauS85s-o8G3L49QgmBaE-6isjbRLW"
      }
    },

    /* Chapter 7 — Building Construction Technology */
    "7": {
      "R.K Shrestha": {
        "1-65": "1kzYm9czns3Do26a2XV8-tTm5VSJ_TUXt",
        "131-195": "19DsKXwT_RSX1B_xlQHz06tR0J8HLNf1C",
        "196-260": "1mZP6ujsccyC8OlKwMyGssf9t4st7-sPB",
        "65-130": "164FLjujhfBl-q2Q_CaYcuW0T89fY1avd"
      },

      "Sunil Sah": {
        "1-100": "1H8b2DIcDQQ4dCDRaJctM6mYOyMMa7Rh-",
        "101-200": "1jYggTJbHhYxZDvroz5XIk-1O-I-trv5A",
        "201-300": "15f2CiEgfd0y45C6YiAujV35bpvHBpGnG",
        "301-400": "1upPz6YXp7yLLjz73lnzUP828EFApy-Mb",
        "401-500": "1eVtbEWc9LGsLty0Y2ZM6PDeIk2ykBP2b",
        "501-600": "1_tytL1YFi_8glzjswiGKelgkQrvNNAfQ",
        "601-658": "1V_Cgasu59PipCReiiMRzcqeKDHwTfDoe",
        "659-716": "161Hw8Db80fggFIBHTkzKwiDqm9oApAA7"
      }
    },

    /* Chapter 8 — Water Supply & Sanitation */
    "8": {
      "Sunil Sah": {
        "1-100": "1oCYIwNj8h6SdiOP4bB5HNG3cyX6ZRygd",
        "101-200": "1lSJuN-fvaBRsyABUNPApWm09rZn_V0ko",
        "201-300": "1aEj_hw63qbOfJsIp1AwnyulTRIQ-e1xh",
        "301-400": "1tHiL_rKWaNRHd0y2yphJpElMNKBLDiGq",
        "401-500": "1A1Hh0YqmMLsLE7-Ey-9YrYHbRYccE7iZ",
        "501-554": "1LnUcKO28KnhVXIerrj003UsrLAiTdUoP"
      }
    },

    /* Chapter 9 — Irrigation Engineering */
    "9": {
      "Sunil Sah": {
        "1-100": "1SFVGZBZCmcsMlBRLuv3rKjOr-ocKuJTy",
        "101-200": "1CeQH3i49wF9dc0e6mIznjiSA3A9Qxf3u",
        "201-300": "1ho8sdNzmE9YHBfUCBWg86ti4oH8w_UxE",
        "301-376": "1Zg4rlXqtmFgUctS53I_ga_gtj-u3KEPC",
        "376-408": "1rcHJY4DnOgABTsz1JrrwUlLcfU7VWKhm"
      }
    },

    /* Chapter 10 — Highway Engineering */
    "10": {
      "Sunil Sah": {
        "1-100": "1oglXPjLqCifewdj8-0MDx-UI5oCVyJ0G",
        "101-200": "1DJWlgozHY4-Obn4FAzL4ITZZJIiyCcrD",
        "201-300": "1NdciqWDMenHJd9Nl2euJaazASJRkYbtE",
        "301-400": "1ZDhz_MWRSrGpOqNXj69-Plkl2RRaja9M",
        "401-449": "1KEops4saZRcQGJPtcFAunGue8A392Qwy"
      }
    },

    /* Chapter 11 — Estimating & Costing */
    "11": {
      "R.K Shrestha": {
        "1-50": "1ivzRvvI9ZqXyyin4ncwW-GQIzECHOEDF",
        "101-183": "193NC9O8OnKkqdC8dXCxjzvB-sYnD49_q",
        "50-100": "1RLHdLWtDPgQnpNDpO4fdRGBHwMI0LLsX"
      },

      "Sunil Sah": {
        "1-50": "1PatlHpX83cgMO8VH9bbOq6aRoifCNoNW",
        "101-150": "1pN1as3DjClVrYhEWBKXXwR2n4Egd4IIc",
        "151-200": "1WdqpEn0eSgZzhbT7X5ycF6m57bpRctBZ",
        "201-260": "1WmIZf9XFN9CUPxJ9rzwBf6NvE_qrje42",
        "261-312": "1wJZMh8dJYUF4Pm-qa80sU0sYMYX8hhKj",
        "50-100": "1S82Lnx41zlFQx4-H7bGWW1Zt-I7zCeSx"
      }
    },

    /* Chapter 12 — Construction Management */
    "12": {
      "Sunil Sah": {
        "1-100": "1atj3Pt2St3Ag_9Lp1IIKfyFfzyES4jCu",
        "101-200": "1EgH0tKtUJQVmsopLeh61lXTTDzMqbMy6",
        "201-300": "1ErTJa6lzuCmqtcWMFMH-bwWQnsTPQByU",
        "301-348": "10YYfufwvVqTi5XKlSlDQRzeap99HI8Lo"
      }
    },

    /* Chapter 13 — Airport Engineering */
    "13": {
      "Sunil Sah": {
        "1-70": "1W_tOzVueuNMTJEj4Zuwxkk4TxaSyHMm1",
        "71-154": "1t8HiHvCUclSdZ_le0PzOe-D5a77xsVpj"
      },

      "DPARSAD": {
        "All": "1uxYrB-uf5NSsrjV51lL7hsrvdlDfWP0i"
      }
    }

  },


  /* ======================================================================
     LEVEL 7
     ===================================================================== */

  level7: {

    /* Chapter 1 — Structural Engineering */
    "1": {
      "Abhyas": {
        "3.1 CG&MOI": "1EG0uEIOS9dSx91PmGfWHvDR6UtCRv1D6",
        "3.2 STRESS&TORSION": "19c5aF_fDmwhFn328w6NmCrzgas3FT-c2",
        "3.3 BEAM&FRAME": "1zX9WrcT4wky0-I8vTlzF0wEWgxOl7iBr",
        "3.4 DETERMINATE STR": "1bbVC4CKhpG4WXF2qbem4EpBqRyFlhZoq",
        "3.5 INDETERMINATE STR": "1QCQ_zcsbEG1ozW5b7x2COlLwjaZd6jFl",
        "3.6 PLASTIC ANALYSIS": "1_rbUBhMRiJn-OMjk1Gf8gjFhkzpeZY8a"
      },

      "DPARSAD": {
        "1-70": "1h3NQ9AL7DSx-5K3uU7XSb9Q7CvPiRwPD",
        "141-228": "1ulh8RD7_hHeBUyrRD95kW_bgyvKQsk51",
        "71-140": "1mgOsZkjGqWZ1AOhu1oQ6ZWtIOA-R3RwS"
      }
    },

    /* Chapter 2 — Engineering Survey */
    "2": {
      "Abhyas": {
        "4.1 INTRO&CLASSIFICATION": "1wbPJT2kei3KARwCNpYfaMp6zyJS_H3Fy",
        "4.10 CURVES": "1CtK008-ohQtBw-qNdGlDljBvv9OnZQvq",
        "4.11 AREA&VOLUME": "1ywPr6-7BdvgV1vFu6k_MN4r1QdH12VDf",
        "4.2 LINEAR MEASUREMENT": "1vjeazMh9SHKejUGzS9zpv5yTZEJUTrkO",
        "4.3 COMPASS": "19Uw3ELNKuxqt5xGYtVnyBBV1Hydzd_2N",
        "4.4 PLANE TABLE": "1ffYjw6PACS3Ate0E4TBV3Metsaj-9O7O",
        "4.5 LEVELING": "1g7P_VQ8-sf0WOB4t9AXlUCPCrSkp1kDG",
        "4.6 CONTOURING": "1EIsFNCEkpDcsMdr-CRC8XGkPriVmWGqc",
        "4.7 THEODOLITE TRAVERSE": "1aJmlhaUdz1u_60ZEBMV507wWEoJsCNgw",
        "4.8 TACHEOMETRY": "1tPehSRACcKb39lHQAIyN9qsHk73uXnTi",
        "4.9 TOTAL STATION": "1A6tik-Wn8jhE6cu3m8Bhy6dRnrGeHe65"
      },

      "RK SHRESTHA": {
        "1-77": "1dCqKCDCgIyoNobRilOdP50bbqmOdTSWg",
        "155-231": "1qHHhdU_TtWnM4uvp5EwHQx8m9N5GAk05",
        "232-307": "1vNqbQIhOgiFmeGsmZj6AhKGmnqNm7Yr-",
        "78-154": "1cCrVquPYs1VH7b2eKv9yqhiDttbjoDgT"
      },

      "DPARSAD": {
        "1-100": "1yXZHd56UGxIi5RGl4XA-600dDaq8PpDR",
        "101-175": "14zRkZBGZnFXkxGylMqplHxDgq53CWayc",
        "175-250": "1TzBMpOzm-Qp5-yqB5T7y7J3cS06Kt8vs",
        "251-350": "1jw4nzypzxqQo7xO9JcRUUtyVL1U6kbDq",
        "350-455": "1K1C4cyYliqsH84pwlxrBmux8HNUtv9Ra"
      }
    },

    /* Chapter 3 — Construction Materials */
    "3": {
      "Abhyas": {
        "5.1 MATERIAL PROPERTIES": "1xq0qJg_DCtEcFMa8ALVsercbpC1Wo1UL",
        "5.2 STONES": "1FeyTH5YX_oaqwkicY3EOAp_yfVSqcoh3",
        "5.3 CERAMIC MATERIALS": "1EJOdjRII6R3I1qTvGSHJxMTseUAKiMW-",
        "5.4 CEMENTING MATERIALS": "1Kn2zkXYtb8QsgrYwlw9SYBsnvNMtSkyu",
        "5.5 METALS": "1-w2GgK5x_BQOXV1L4PmmX--I6pu2-Pjj",
        "5.6 TIMBER&WOOD": "1xm9bJdbLm-9OA-sj0X4Ros8S_5KVB9qx",
        "5.7 MISC MATERIALS": "1yNLIr5MA5MUYljoa29Bdi_1JTsqvI_hj",
        "5.8 SOIL PROPERTIES": "1gyyZj77lsbMRHsKodEJJqzjHmOY5F7R5",
        "5.9 LOCAL&MODERN MAT": "1dF0aR228CrYtLYEg79C9-n8u6yOlU9Sb"
      },

      "RK SHRESTHA": {
        "1-75": "149Jiv13N8z5n2UdmhfE8RaXnGiQPz21z",
        "151-225": "1MKSdWQ_63uRElC6Zlr4cMIru1csvwEdQ",
        "226-300": "1rDmevr2rOcf894F7agAPNtN_ku6i8HWU",
        "301-375": "1GuCW5aF4k2IMHGOJoKKUDw4vvAGb8THc",
        "76-150": "1QW_IbwgQyEyfqVeDezET5dZHRqb1fMDq"
      },

      "DPARSAD": {
        "1-100": "1v1LXYwzNF2TafCQKunBOrxl_UHn8W7NO",
        "101-175": "1xXcFMVIymWnuTOJF-nh9SSJzuXNQYfWr",
        "176-255": "1-XkoaqH9T6hRKec8j-dfuJwPKQDKYpFt",
        "255-350": "1Z-kyfriVVY8ROCOK7_jrzVg2SuL2xP29",
        "351-447": "1jTaYfKLulzd7heCGJc4BLR5kaaQA0mX2"
      }
    },

    /* Chapter 4 — Concrete Technology */
    "4": {
      "Abhyas": {
        "6.1 CONCRETE CONSTITUENTS": "1iazvTuHBDaQxJCENIhxUwnsqzVjCG2Jx",
        "6.2 W-C RATIO": "1IlHQ-3GXveMhfd_E_hiF-_cdJzaRuoSr",
        "6.3 GRADE&MIX DESIGN": "1te_KTUkxYfalKxdyVA2s-8Uy2NDok0kI",
        "6.4 MIXING&CURING": "14yqGXhxO3SGFBVkBNcwTwxPJG-zQYrUC",
        "6.5 ADMIXTURES": "1fQLh_9juinKD_hV3KLBEcltdd5F-poV3",
        "6.6 HIGH STRENGTH CONC": "1ee6mpS2WoaIEVxjXW8MiJbDxHVvWDKkx",
        "6.7 PRESTRESSED CONC (sorted)": "1kr7oUnuhWKF1eV57RZWc7ZebNIXpZQc5"
      },

      "RK SHRESTHA": {
        "1-80": "1ogn7X2qg57YbNVu_ExzsW4aas-8TKEU_",
        "161-240": "1GgimqtgDGbUjdXAVP6J4KXdfEx5NcFhF",
        "81-160": "1EaAqgiwXjaXsiwP9NBB2Vn07RhIBfPTZ"
      },

      "DPARSAD": {
        "1-50": "1jhAs_3b61Cn6YjY45hHqwO2ceJuygbr_",
        "101-150": "13T28p8WnYFPqNguu_4YsRnFJ5zOlaQ5B",
        "151-200": "1OjdrC5yQ4x8jTijTNm6VmOWG5bqoBpQ5",
        "201-250": "1hAP5zyfL5MaK1EqS_J-ZSWQXAX3J0UOB",
        "250-300": "1sRb5evs5CLiK0xDn6wHP0qQmi2sY8f4s",
        "301-350": "1Bug0gYU7UcILpX9je5xtgfWfHZIEN4W6",
        "350-405": "1UoQ5GoTD_ggx9AJqAaqYgfLARb10pqOp",
        "50-100": "11UWRoG-JKMxE28HF44iUGYidJ46XIi17"
      }
    },

    /* Chapter 5 — Geotechnical Engineering */
    "5": {
      "Abhyas": {
        "7.1 SOIL FORMATION": "1Jfg5Gji1MLsQ4tSRfhnE5LpVhD7j4Vcc",
        "7.2 3-PHASE SOIL": "1rHR8T3Ndwhf8wbe7gKH-CB8hvA9H3m9C",
        "7.3 WATER IN SOIL": "1_PABQhwTxdMN2HZy0IpGELAWXMhIwFO1",
        "7.4 INDEX PROPERTIES": "17_MfKmOWTwIRDqcwhykTOHYNc2CViaqp",
        "7.5 ROCK&EARTHQUAKE": "1bfoKt4uKYaL4AaSimTSv2SbBo6HZxLX_",
        "7.6 TUNNELING": "1BO3UpqbjxApK8fdxp3K_Irv6o3FNSIDa"
      },

      "D PARSAD": {
        "All": "1ipRrpTWBA7JIdwCuTY73ZZwY0CTM-LAP"
      },

      "RK SHRESTHA": {
        "1-69": "1AJlI1Dsf1vugz-e76IOnrLcDUi8ANSvv",
        "139-207": "1E4vRDqK86c23Ki-reszLKuMIg5-QUsEU",
        "208-276": "17E7qw-1-Q3cIy8e6Gt76WdDlC-gQsubc",
        "70-138": "1a5xfPk5LFN8t5C5MSlFupxUw2zf9rGS8"
      }
    },

    /* Chapter 6 — Construction Management */
    "6": {
      "Abhyas": {
        "8.1 SCHEDULING&PLANNING": "1lsPuaKBIuAM7WRirGfVBNNU05mbOmnZl",
        "8.2 CONTRACTUAL PROCEDURE": "1-unallplP0bXzlQZpN8uUoNxOA9w5HfK",
        "8.3 MATERIAL MGMT": "1Isu1oOsqnLv-UE0KmwcCPOt7YbhJcU0A",
        "8.4 COST QUALITY TIME": "117x7V5t0exDB2k4OTCC10OINNIhB9HZH",
        "8.5 PROJECT MGMT": "1gzkQSJuV0SVTovgVDeJzY_ib0Dkddcrn",
        "8.6 HEALTH&SAFETY": "18JlIjTuUxMVq3-mrl3vGE7wvTr4v_xns",
        "8.7 MONITORING&EVAL": "1sXc6hx-sryLUDt-ScG9EAb9sl1r9g8Nz",
        "8.8 QA PLAN": "18BwOWW5dpnffF17T9CC7GxIGRtpV1VZ4",
        "8.9 VARIATION&ALTERATION": "1YNQk_Lyzg8AGMwCk5ykYKgR5tFi7-mlb"
      },

      "New DPARSAD": {
        "1-75": "1cQGpQHGzekcDnE2duOkYzx3NAoeuPv5h",
        "151-225": "1tro7AirSkoOm9zYvJyQo5W_hlUvoqvlg",
        "226-310": "12jhiq9Jbp3EwvqJgW_bxyPq77IYfUEAa",
        "75-150": "1T2tghXwm_6Dqy5FkQgs0wiRrhl0NQuGM"
      },

      "Old DPRASAD": {
        "1-100": "1IYG4gFrvXBJ8n2kJRFL1UCRZdUOZsZCv",
        "100-150": "1KY9GTqB8sTJpGha_JnYYE9Pvnnzotf9h",
        "150-200": "18HnjG1-leT6OXk5mYPGTJluMw2yiFUEy",
        "200-205": "1KA-3P2cmmQKQRmr_-UU74ik_MmNsJ8F2",
        "50-100": "1981sMj5WNTZeKsghbz4N_eEqqxm1XbT5"
      },

      "RK SHRESTHA": {
        "Batch 1": "1_KH4l09hI0GeH6J5tGd6vGCQZzNjj7_J",
        "Batch 2": "1V9EtSiGB2_jaOpTdna_0VGt6iSVh6WmG",
        "Batch 3": "1vdN4MvatiJJ-7Qjz4epjV6FluEVf5a-m",
        "Batch 4": "1nz3Tvjl6THGuXYKTnXLH8ZbYKxyfRy-w",
        "Batch 5": "1CJfsghP6UOy5qv29ktUrhhNBhqnmqRj7"
      }
    },

    /* Chapter 7 — Estimating & Costing */
    "7": {
      "Abhyas": {
        "9.1 TYPES OF ESTIMATES": "1MQesOkFEVzpRyZ7f5ZJxmmJixEuYLEVO",
        "9.2 QUANTITY CALC": "1d77m_6-DqGeMHYizeZxlCPzhSgeRmNEB",
        "9.3 RATE ANALYSIS": "1iI4ZsKFdS3VfIRPnt07pmAlpV1Qpjbn1",
        "9.4 BOQ": "1QzTZRC37wpfmtvdr9DF4TaZECyT3gWWZ",
        "9.5 SPECIFICATION": "1zv_Kj1b5OinAqFtTTprikNvMRfWbh8iW",
        "9.6 VALUATION": "19b5w82zFWyzfMP6GNDzMsNWs8W6gHfgA"
      },

      "DPARSAD": {
        "1-50": "1WR0c-cQrD6ZNrpW31pgFTrhekyT_0n4K",
        "101-151": "1O3bhzDvGZfUTy1T9guFuq_aAn3PAq7Xi",
        "151-200": "1E22sJNC6miJwVNDD5cz8EW3OXTWKc4XT",
        "201-250": "1-VeNFb81ynETihERKfWNUOZSqrYopyOH",
        "51-100": "1RjkK83GYpLncIqJJ2FGYkHh0FGGksJ_J"
      },

      "RK SHRESTHA": {
        "1-81": "1x38YE2cp5xh0HDOS4MxJ4lvPqu3BdGdc",
        "163-242": "1_QL2BkJ0KasZes4mlPqRdxygRCctGMS5",
        "82-162": "1XNc9kD0zGUJ1x3c-0wmL71XalNg46W42"
      }
    },

    /* Chapter 8 — Engineering Drawing */
    "8": {
      "Abhyas": {
        "10.1 DRAWING SHEET": "1QYmvyWgDEpKZuJCY2PVmT-iapsjYt6bE",
        "10.2 SCALES&SITE PLANS": "1P82yikIheWhYE9lbZXPxLT4FJLn0zJ-g",
        "10.3 PROJECTION THEORY": "1vxdlZFCJhfIrYL0Px3kCllGJb1nQnyS-",
        "10.4 DRAFTING TOOLS": "1u5M7zPP7IcRNWeSh-K7Zkxif2wPFsdCe",
        "10.5 DRAFTING CONVENTIONS": "1P0J4nuGdxfRkUBirAIbZvMl5UYd40okm",
        "10.6 TOPO&SERVICE DWG": "1DR4vlhVXdkFk1OdUqqbiX7K9qjclpTqK",
        "10.7 FREEHAND DRAWING": "1_fhZYcuOynoNlRm-yQjBvx15ct3Hdra_"
      },

      "DPARSAD": {
        "1-100": "1WqQPC_gqQ8gM43tMEatrpvFb91Rzfb5k",
        "101-183": "1AXIlR6OKS9cG65HU5xZvyJWeNj6-MJk1"
      },

      "RK SHRESTHA": {
        "1-71": "172V_845Zdr84U69dr0bmMDbxz56Ya74M",
        "143-213": "1EvRKn9B2I8jjT1UeWzB8IYiDKRhz0NSs",
        "72-142": "1YrxxoZ0IPON3ycUL0sa8sjiRHEtKip5r"
      }
    },

    /* Chapter 9 — Engineering Economics */
    "9": {
      "Abhyas": {
        "11.1 INTEREST&TIME VALUE": "1BXoTkgknjpCG5LzLRtj8k6QJoHPtcZpg",
        "11.2 ANNUITIES&SINKING FUND": "1QMnGhrfoV5F47eVQ-_APk2kxVYnaVOBn",
        "11.3 NPV IRR WORTH METHODS": "1NupM_Qdz5qYrug0WHKLPPfFMnqSsIhXw",
        "11.4 COST CONCEPTS": "1f3JdoFQeQqugV2c1-iMJ2v15A8pQs7gM",
        "11.5 BREAKEVEN&SENSITIVITY": "1Nv2D1WJfWTbX7paoLlQMO87lcnMJLPbU",
        "11.6 ECONOMICS BASICS": "1LJkfj2iru8Ue2ZKkLSrTH3Qk4Mx7ABd4"
      },

      "RK SHRESTHA": {
        "1-54": "1OJYDYMCCYbayimPJzRlf7ZNI3C48YJIw",
        "55-108": "1VBxr0CbRm7LYah9FBTC3Cnl2-ddyIV39"
      },

      "DPARSAD": {
        "1-75": "1vzp6vp3jscMoDEsNwLTAdX6fw2qoOe55",
        "76-end": "1abshceD1-c5wygd9L32gAoLpuYdBqkd8"
      }
    },

    /* Chapter 10 — Professional Practices */
    "10": {
      "Abhyas": {
        "12.1 ETHICS&INTEGRITY": "1n0iZ2dKnUYjv1AtjMmQyndEWHNY52-0g",
        "12.2 NEC ACT": "1As0-bXhVE4B0av_iSdQhgnPi8DA3WAsw",
        "12.3 CLIENT&CONTRACTOR REL": "1JJZwp5_uUx1CmOS4vgbeZkl_aF0bQnKG",
        "12.4 PUBLIC PROCUREMENT": "1oVdr1E2GWPvS-cpSohUjeNgIcd7DP7r3",
        "12.5 NBC": "1_JEkzhm07SmcKejscg5hkCB44sQqknR1",
        "12.6 BUILDING BYLAWS": "17mDJyHSvDCYjwnlsAvAoPptHQzss9TWU"
      },

      "RK SHRESTHA": {
        "Batch 1": "1TsbaxhfnQdqsR31Qc0m48q3aIO2rqHfy",
        "Batch 2": "1hTK4XCovy30ZCZ5j5AmCOcTdfQCYLsTq"
      },

      "DPARSAD": {
        "All": "16Yw0SALw-Vk1KR-7HnRZdetJFqarj7S2"
      },

      "_meta": {
        "subtopics.json (metadata, not questions)": "1cKJlBecxKWCezPotU8qncwWSpQyhK57u"
      }
    }

  },


  /* ======================================================================
     GK (shared 'GK' folder only — see header note re: Abhyas GK)
     ===================================================================== */

  gk: {

    /* Chapter 1.1 — GEO&DEMO */
    "1.1": {
      "Abhyas": {
        "All": "1F20fh00eQpPXs45QXW7T3gFT1xlMf734"
      }
    },

    /* Chapter 1.2 — NAT RESOURCES */
    "1.2": {
      "Abhyas": {
        "All": "1VHUZPsulfZHy2iMPDC07kCWyAnBQy8jL"
      }
    },

    /* Chapter 1.3 — GEO DIVERSITY&CLIMATE */
    "1.3": {
      "Abhyas": {
        "All": "1yH-DJSPVgAVRlASd1b0-nCmsPC6Wu6BF"
      }
    },

    /* Chapter 1.4 — MODERN HISTORY */
    "1.4": {
      "Abhyas": {
        "All": "1kl_W3zRZf625Yc_WoRMx-Q552sNDLfsq"
      }
    },

    /* Chapter 1.5 — PERIODIC PLAN */
    "1.5": {
      "Abhyas": {
        "All": "19wKOhaIw1y-yJneyUwQDDv0-fPw0i7tL"
      },

      "GATE": {
        "All": "1S39S--nt9QVepKlcszdpntB8rRgAEqfd"
      }
    },

    /* Chapter 1.6 — SUST DEV&ENV */
    "1.6": {
      "Abhyas": {
        "All": "1h6TTxSnMnIcYV8riyTgsDcG4QvCfi9eW"
      },

      "GATE": {
        "All": "1922CKz8p81DWUWhimygloqKDNDQXbXXF"
      }
    },

    /* Chapter 1.7 — INTL AFFAIRS */
    "1.7": {
      "Abhyas": {
        "All": "1XpoO3NsQFwcDDdSks8xBzlTKUpb353vb"
      },

      "GATE": {
        "101-150": "1TTD1aKKl_P6nGcUxzyyDkpbH2O7hPx_u",
        "151-180": "1dEdvbPuxrSKys_jlMAJkaHGLuSHQ47fF",
        "General": "1pomfoXhK1mWU7QAO-oihx2SMsPJqxOCh"
      },

      "SAARC": {
        "Saarc batch 1": "1mgbD6Zr3t5zu7oGAraj1BeIXOqbGSojp",
        "Saarc batch 2": "1SWybO9ZCwzFPvAY6k_8StQk9Nf04MZzm"
      }
    },

    /* Chapter 1.8 — CONSTITUTION */
    "1.8": {
      "Abhyas": {
        "All": "1ekHVTT84JW1U8xplW_SqsN5I2VDFI-K2"
      },

      "GATE": {
        "All": "1HRlsrjjxF8tW89R4fT9wTGjAnFt0gfVS"
      }
    },

    /* Chapter 1.9 — GOVERNANCE */
    "1.9": {
      "Abhyas": {
        "All": "1bTztLbaAcEjy9_pJ1jDK_99utkAImae1"
      },

      "GATE": {
        "All": "1xO4bk4QCPzqCORupW07MtNj-60OFlqZE"
      }
    },

    /* Chapter 1.10 — CIVIL SERVICE ACT */
    "1.10": {
      "Abhyas": {
        "All": "1rnZIF8vRPmYEMXO6B3GWpeSRSz9IzS6x"
      },

      "GATE": {
        "All": "1W628YzIRlatpN0BhdtVqv1V7q44Fn8F0"
      }
    },

    /* Chapter 1.11 — FUNCTIONAL SCOPE */
    "1.11": {
      "Abhyas": {
        "All": "16_eBtRVcS1VvLkEafwTT0ky9vf5I6rB4"
      },

      "GATE": {
        "All": "1TdUQchW6i2LBKdWsjMNNTGwB5hAR1iCB"
      }
    },

    /* Chapter 1.12 — PSC */
    "1.12": {
      "Abhyas": {
        "All": "1sl2eGivffxVph_TcUTH6p6GqcDcv28Nd"
      }
    },

    /* Chapter 1.13 — PUBLIC POLICY */
    "1.13": {
      "Abhyas": {
        "All": "1Lamc5bwUId2EEZ2eFWl80tpnb999QUQ7"
      },

      "GATE": {
        "All": "1u3hA3p7wtUaDvzDioLVrFaq02WUuNCpt"
      }
    },

    /* Chapter 1.14 — MGMT FUNDAMENTALS */
    "1.14": {
      "Abhyas": {
        "All": "1j5xcwSAZCRQ5oBm98N2R79uaOUD7SAUu"
      },

      "GATE": {
        "All": "1G5BtPfzG_bnmDhIORtJM6N5cmCEiAt3A"
      },

      "Planning and Management": {
        "Duplicate": "1Gzu0Or4R4TufdNbRAfIvuWsstiNRJzJ3",
        "Part 2": "1pqYGgBageMaEsa6QZoCcqzpjr1Bpd3DA"
      }
    },

    /* Chapter 1.15 — BUDGET&ACCOUNTING */
    "1.15": {
      "Abhyas": {
        "All": "1fptEiZVBE_jzmVqoeoXzgBbTM9xcAQoY"
      }
    },

    /* Chapter 1.16 — CURRENT AFFAIRS */
    "1.16": {
      "Abhyas": {
        "All": "1RihlAcMkOLvNjGwkFvm_q9IMNLLjlhsI"
      }
    },

    /* Chapter 1.17 — CHARTER */
    "1.17": {
      "GATE": {
        "All": "1SkPP7n4nIjmdEzWu8zZ5nywQaY2BmGQD"
      }
    },

    /* Chapter 2.1 — LOGICAL REASONING */
    "2.1": {
      "Abhyas": {
        "All": "1bwgC1qylMuepvp52rqvW4IleuVWUpOTV"
      }
    },

    /* Chapter 2.2 — NUMERICAL REASONING */
    "2.2": {
      "Abhyas": {
        "All": "1ZWWRRh1ZZc_B__u4cGQsk5bQZc7GKpLX"
      }
    },

    /* Chapter 2.3 — SPATIAL REASONING */
    "2.3": {
      "Abhyas": {
        "All": "1cMGd3B5N-e9NbgShSlF1QAsW8VuYjPwx"
      }
    }

  }

};


/* ========================================================================
   CHAPTER DATA HELPERS
   ======================================================================== */

const ChapterData = {
  levels() {
    return Object.keys(CH_NAMES);
  },

  levelLabel(lv) {
    return LEVEL_LABELS[lv] || lv;
  },

  chapters(lv) {
    return CH_NAMES[lv] || {};
  },

  chapterName(lv, ch) {
    return (CH_NAMES[lv] || {})[ch] || `Chapter ${ch}`;
  },

  books(lv, ch) {
    return (DRIVE[lv] && DRIVE[lv][ch]) || {};
  },

  bookNames(lv, ch) {
    return Object.keys(ChapterData.books(lv, ch));
  },

  files(lv, ch, book) {
    const books = ChapterData.books(lv, ch);
    return books[book] || {};
  },

  fileCount(lv, ch, book) {
    if (book !== undefined) {
      return Object.values(ChapterData.files(lv, ch, book)).filter(Boolean).length;
    }
    let count = 0;
    for (const bookFiles of Object.values(ChapterData.books(lv, ch))) {
      count += Object.values(bookFiles).filter(Boolean).length;
    }
    return count;
  },

  totalFilesInLevel(lv) {
    let total = 0;
    for (const ch of Object.keys(DRIVE[lv] || {})) {
      total += ChapterData.fileCount(lv, ch);
    }
    return total;
  },

  chapterFileRefs(lv, ch) {
    const out = [];
    const books = ChapterData.books(lv, ch);
    for (const book of Object.keys(books)) {
      const subtopics = books[book];
      for (const subtopic of Object.keys(subtopics)) {
        const fid = subtopics[subtopic];
        if (!fid) continue;
        out.push({
          lv, ch, book, subtopic,
          name: `${book} — ${subtopic}`,
          fid,
          key: `${lv}_${ch}_${book}_${subtopic}`
        });
      }
    }
    return out;
  },

  allFileRefs() {
    const out = [];
    for (const lv of Object.keys(DRIVE)) {
      for (const ch of Object.keys(DRIVE[lv])) {
        out.push(...ChapterData.chapterFileRefs(lv, ch));
      }
    }
    return out;
  }
};


if (typeof window !== "undefined") {
  window.CH_NAMES = CH_NAMES;
  window.LEVEL_LABELS = LEVEL_LABELS;
  window.DRIVE = DRIVE;
  window.ChapterData = ChapterData;
}
