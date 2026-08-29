/* ══════════════════════════════════════════════════════════════════════
   CHAPTERS-DATA.JS
   ──────────────────────────────────────────────────────────────────────
   COMPLETE COMPILED VERSION — CORRECTED 2026-08-29

   Hierarchy:

   Level
      ↓
   Chapter
      ↓
   Book
      ↓
   Subtopic
      ↓
   Google Drive fileId

   Sources merged:
   • Level 5 original data
   • Level 7 original books
   • Level 7 newer Abhyas question banks
   • General Knowledge
   • Old Questions

   ─────────────────────────────────────────────────────────────────────
   CORRECTIONS APPLIED IN THIS PASS (see chat for full detail):

   1. Chapter 6 (Construction Management) → "Abhyas" book fileIds were
      still pointing at the OLD EMPTY STUB files. Replaced all 9 with
      the real, populated fileIds uploaded 2026-08-27 (310 questions,
      classified from the "construction mangment" source folder).
      Old stub IDs are now in Trash — do not reuse them.

   2. "5.1 MATERIAL PROPERTIES" (chapter 3) was pointing at a stale
      fileId. Corrected to the live file.

   ──────────────────────────────────────────────────────────────────────
   STILL UNRESOLVED — FLAGGING, NOT GUESSED AT:

   • "9.6 VALUATION" (chapter 7) fileId (19b5w82zFWyzfMP6GNDzMsNWs8W6gHfgA)
     was accidentally trashed and has NOT been restored yet. The pointer
     below is left as-is (matches what was live before the accident) but
     will 404 until it's restored from Drive Trash within the 30-day
     window. Restore it, then this note can be deleted.

   • GK RESTRUCTURED to the 11-chapter-by-topic shape (Periodic Plans,
     Sustainable Development, International Affairs, Constitution,
     Governance, Civil Service, Public Services, Charter, Public
     Policy, Management, Planning & Accounting). Verified against
     actual Drive files:
       - Chapters 3-11 already pointed at the correct real source
         files (confirmed by fileId->title lookup, 2026-08-29) - left
         untouched.
       - Chapters "1" and "2" were still carrying leftover data from
         the OLD 2-chapter shape ("General Awareness" 16 subtopics /
         "General Reasoning Test" 3 subtopics, both under a single
         "Abhyas" book) mismatched against their new chapter names.
         Since none of that old content was ever populated (still
         empty stubs), it was safely replaced:
           "1" Periodic Plans      -> Current Plan.json
           "2" Sustainable Dev     -> Sustainable Development.json
     NOTE: the old "General Reasoning Test" (Logical/Numerical/Spatial
     reasoning) subtopics have NO home in this new 11-chapter scheme
     and were dropped along with the rest of the stale chapter "1"/"2"
     data. If you still want a Reasoning section, tell me and I'll add
     it back as its own chapter/key once a source is found or
     provided.
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


/* ========================================================================
   LEVEL LABELS
   ======================================================================== */

const LEVEL_LABELS = {
  level5: "Level 5 — Diploma",
  level7: "Level 7 — Engineering",
  gk: "General Knowledge",
  old_question: "Old Questions / Sets"
};


/* ========================================================================
   DRIVE DATA
   ======================================================================== */

const DRIVE = {

  /* ======================================================================
     LEVEL 5
     ===================================================================== */

  level5: {

    "1": {
      "Sunil Sah": {
        "1-100": "1OAlD5XUf-Ecmj4hNViPAqInI5GUcMExG",
        "101-200": "1Q6E7isqILUnHG9ZPxTsIltIlEodqr05i",
        "201-300": "1vZRNltiqTuJxJn8RVCzrSojNeyRYFEfp",
        "301-400": "13z92Vn1uV7Gw217q-GXQVuOQoV9gUrJO",
        "401-500": "1OikW1FEi5Zuei4IrWpbjsTr3-O_hY8PQ",
        "501-572": "1WUg2w7SlHVpAEyOlFyfbnymQ-xivfwNi"
      }
    },

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

    "3": {
      "Sunil Sah": {
        "1-100": "18PHUlO1w4w1P6fAJFl1sVA-vuaArgX4c",
        "101-200": "1WqWfdmpL-boetcfcaRVkAD07U2wScgMz",
        "201-300": "1P75cTo6Emx6cKMjhKpSHObrcIZK_Q48Z",
        "301-400": "1iltEhT0DIWa98sAnRSZs7l83Sl5Fp4PA",
        "401-432": "1H1u78Q95fPXDAzALAwMF2PyrKYqwIluc"
      }
    },

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

    "5": {
      "Sunil Sah": {
        "1-100": "11DZsjZfw4WbmglOxGRErYh9VBNv1-yy7",
        "101-200": "1l6ZBNY7MlRItTKOsglSF9xDGEQ_hrVZI",
        "201-300": "1ZMPdpgCvJ4LNPVSr0enHKyGxVIr7QLth",
        "301-400": "1zKOJP55egY2xSu8yxTbQzwRulKyyqwb3"
      }
    },

    "6": {
      "Sunil Sah": {
        "1-100": "1ZTRwGwGkdg6DpZzVizUQEkF-Z1IQT3a2",
        "101-200": "1NJIDXdgssUhX0QcnmIIN0QLWQjuP-gjs",
        "201-300": "1n7Qn2gqNo6du6XKb7AjwBypuJIKKqXEd",
        "301-360": "1utWod1N1YyvWcxXTa-UkD6YobEPmVXri",
        "361-417": "1i9tauS85s-o8G3L49QgmBaE-6isjbRLW"
      }
    },

    "7": {
      "Sunil Sah": {
        "1-100": "1H8b2DIcDQQ4dCDRaJctM6mYOyMMa7Rh-",
        "101-200": "1jYggTJbHhYxZDvroz5XIk-1O-I-trv5A",
        "201-300": "15f2CiEgfd0y45C6YiAujV35bpvHBpGnG",
        "301-400": "1upPz6YXp7yLLjz38lnzUP828EFApy-Mb",
        "401-500": "1eVtbEWc9LGsLty0Y2ZM6PDeIk2ykBP2b",
        "501-600": "1_tytL1YFi_8glzjswiGKelgkQrvNNAfQ",
        "601-658": "1V_Cgasu59PipCReiiMRzcqeKDHwTfDoe",
        "659-716": "161Hw8Db80fggFIBHTkzKwiDqm9oApAA7"
      },

      "RK": {
        "1-65": "1kzYm9czns3Do26a2XV8-tTm5VSJ_TUXt",
        "65-130": "164FLjujhfBl-q2Q_CaYcuW0T89fY1avd",
        "131-195": "19DsKXwT_RSX1B_xlQHz06tR0J8HLNf1C",
        "196-265": "1mZP6ujsccyC8OlKwMyGssf9t4st7-sPB"
      }
    },

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

    "9": {
      "Sunil Sah": {
        "1-100": "1SFVGZBZCmcsMlBRLuv3rKjOr-ocKuJTy",
        "101-200": "1CeQH3i49wF9dc0e6mIzpiSA3A9Qxf3u",
        "201-300": "1ho8sdNzmE9YHBfUCBWg86ti4oH8w_UxE",
        "301-375": "1Zg4rlXqtmFgUctS53I_ga_gtj-u3KEPC",
        "376-454": "1rcHJY4DnOgABTsz1JrrwUlLcfU7VWKhm"
      }
    },

    "10": {
      "Sunil Sah": {
        "1-100": "1oglXPjLqCifewdj8-0MDx-UI5oCVyJ0G",
        "101-200": "1DJWlgozHY4-Obn4FAzL4ITZZJIiyCcrD",
        "201-300": "1NdciqWDMenHJd9Nl2euJaazASJRkYbtE",
        "301-400": "1ZDhz_MWRSrGpOqNXj69-Plkl2RRaja9M",
        "401-449": "1KEops4saZRcQGJPtcFAunGue8A392Qwy"
      }
    },

    "11": {
      "R.K Shrestha": {
        "1-50": "1ivzRvvI9ZqXyyin4ncwW-GQIzECHOEDF",
        "50-100": "1RLHdLWtDPgQnpNDpO4fdRGBHwMI0LLsX",
        "100-183": "1RLHdLWtDPgQnpNDpO4fdRGBHwMI0LLsX"
      },

      "Sunil Sah": {
        "1-50": "1PatlHpX83cgMO8VH9bbOq6aRoifCNoNW",
        "50-100": "1S82Lnx41zlFQx4-H7bGWW1Zt-I7zCeSx",
        "100-150": "1pN1as3DjClVrYhEWBKXXwR2n4Egd4IIc",
        "151-200": "1WdqpEn0eSgZzhbT7X5ycF6m57bpRctBZ",
        "200-260": "1WmIZf9XFN9CUPxJ9rzwBf6NvE_qrje42",
        "261-312": "1wJZMh8dJYUF4Pm-qa80sU0sYMYX8hhKj"
      }
    },

    "12": {
      "Sunil Sah": {
        "1-100": "1atj3Pt2St3Ag_9Lp1IIKfyFfzyES4jCu",
        "101-200": "1EgH0tKtUJQVmsopLeh61lXTTDzMqbMy6",
        "201-300": "1ErTJa6lzuCmqtcWMFMH-bwWQnsTPQByU",
        "301-348": "10YYfufwvVqTi5XKlSlDQRzeap99HI8Lo"
      }
    },

    "13": {
      "DPARSAD": {
        "142": "1uxYrB-uf5NSsrjV51lL7hsrvdlDfWP0i"
      },

      "Sunil Sah": {
        "1-70": "1W_tOzVueuNMTJEj4Zuwxkk4TxaSyHMm1",
        "71-154": "1t8HiHvCUclSdZ_le0PzOe-D5a77xsVpj"
      }
    }

  },


  /* ======================================================================
     LEVEL 7
     ====================================================================== */

  level7: {

    /* --------------------------------------------------------------------
       CHAPTER 1 — STRUCTURAL ENGINEERING
       -------------------------------------------------------------------- */

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
        "71-140": "1mgOsZkjGqWZ1AOhu1oQ6ZWtIOA-R3RwS",
        "141-228": "1ulh8RD7_hHeBUyrRD95kW_bgyvKQsk51"
      }

    },


    /* --------------------------------------------------------------------
       CHAPTER 2 — ENGINEERING SURVEY
       -------------------------------------------------------------------- */

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
      },

      "DPARSAD": {
        "1-100": "1yXZHd56UGxIi5RGl4XA-600dDaq8PpDR",
        "101-175": "14zRkZBGZnFXkxGylMqplHxDgq53CWayc",
        "175-250": "1TzBMpOzm-Qp5-yqB5T7y7J3cS06Kt8vs",
        "250-350": "1jw4nzypzxqQo7xO9JcRUUtyVL1U6kbDq",
        "350-455": "1K1C4cyYliqsH84pwlxrBmux8HNUtv9Ra"
      }

    },


    /* --------------------------------------------------------------------
       CHAPTER 3 — CONSTRUCTION MATERIALS
       -------------------------------------------------------------------- */

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

      "DPARSAD": {
        "1-100": "1v1LXYwzNF2TafCQKunBOrxl_UHn8W7NO",
        "101-175": "1xXcFMVIymWnuTOJF-nh9SSJzuXNQYfWr",
        "176-255": "1-XkoaqH9T6hRKec8j-dfuJwPKQDKYpFt",
        "256-350": "1Z-kyfriVVY8ROCOK7_jrzVg2SuL2xP29",
        "350-477": "1jTaYfKLulzd7heCGJc4BLR5kaaQA0mX2"
      }

    },


    /* --------------------------------------------------------------------
       CHAPTER 4 — CONCRETE TECHNOLOGY
       -------------------------------------------------------------------- */

    "4": {

      "Abhyas": {
        "6.1 CONCRETE CONSTITUENTS": "1iazvTuHBDaQxJCENIhxUwnsqzVjCG2Jx",
        "6.2 W-C RATIO": "1IlHQ-3GXveMhfd_E_hiF-_cdJzaRuoSr",
        "6.3 GRADE&MIX DESIGN": "1te_KTUkxYfalKxdyVA2s-8Uy2NDok0kI",
        "6.4 MIXING&CURING": "14yqGXhxO3SGFBVkBNcwTwxPJG-zQYrUC",
        "6.5 ADMIXTURES": "1fQLh_9juinKD_hV3KLBEcltdd5F-poV3",
        "6.6 HIGH STRENGTH CONC": "1ee6mpS2WoaIEVxjXW8MiJbDxHVvWDKkx",
        "6.7 PRESTRESSED CONC": "1kr7oUnuhWKF1eV57RZWc7ZebNIXpZQc5"
      },

      "DPARSAD": {
        "1-50": "1jhAs_3b61Cn6YjY45hHqwO2ceJuygbr_",
        "50-100": "11UWRoG-JKMxE28HF44iUGYidJ46XIi17",
        "100-150": "13T28p8WnYFPqNguu_4YsRnFJ5zOlaQ5B",
        "150-200": "1OjdrC5yQ4x8jTijTNm6VmOWG5bqoBpQ5",
        "201-250": "1hAP5zyfL5MaK1EqS_J-ZSWQXAX3J0UOB",
        "250-300": "1sRb5evs5CLiK0xDn6wHP0qQmi2sY8f4s",
        "300-350": "1Bug0gYU7UcILpX9je5xtgfWfHZIEN4W6",
        "350-405": "1UoQ5GoTD_ggx9AJqAaqYgfLARb10pqOp"
      },

      "RK SHRESTHA": {
        "1-80": "1ogn7X2qg57YbNVu_ExzsW4aas-8TKEU_",
        "80-160": "1EaAqgiwXjaXsiwP9NBB2Vn07RhIBfPTZ",
        "160-240": "1GgimqtgDGbUjdXAVP6J4KXdfEx5NcFhF"
      }

    },


    /* --------------------------------------------------------------------
       CHAPTER 5 — GEOTECHNICAL ENGINEERING
       -------------------------------------------------------------------- */

    "5": {

      "Abhyas": {
        "7.1 SOIL FORMATION": "1SyIZ2C2Jpoz4v4mO0_qu5a4Uldp9xjf_",
        "7.2 3-PHASE SOIL": "1KoGtFbARuQ55_DZZ5_Aj6ox5YsxjIIDj",
        "7.3 WATER IN SOIL": "1JY8qtz3biEOuumo999cYJXXTAGPabs2o",
        "7.4 INDEX PROPERTIES": "1dvJxWWytsMT-rp0_ZmfweI0wpxzf36fD",
        "7.5 ROCK&EARTHQUAKE": "1z8VG1QCaR22ADhZFycxFFyPKoSfcKw1U",
        "7.6 TUNNELING": "1BO3UpqbjxApK8fdxp3K_Irv6o3FNSIDa"
      },

      "DPARSAD": {
        "All": "1ipRrpTWBA7JIdwCuTY73ZZwY0CTM-LAP"
      },

      "RK SHRESTHA": {
        "1-69": "1AJlI1Dsf1vugz-e76IOnrLcDUi8ANSvv",
        "70-138": "1ovVEkUtHsU_Wb2Kw39b88a7sAonr3vd3",
        "139-207": "1-V9v81h_LcJIdqWLhqFz5I64taLLYx_1",
        "207-276": "17E7qw-1-Q3cIy8e6Gt76WdDlC-gQsubc"
      }

    },


    /* --------------------------------------------------------------------
       CHAPTER 6 — CONSTRUCTION MANAGEMENT
       CORRECTED: "Abhyas" now points to the real, populated files
       (310 questions, uploaded 2026-08-27). Old stub IDs are trashed.
       -------------------------------------------------------------------- */

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
        "76-150": "1T2tghXwm_6Dqy5FkQgs0wiRrhl0NQuGM",
        "151-225": "1tro7AirSkoOm9zYvJyQo5W_hlUvoqvlg",
        "225-310": "12jhiq9Jbp3EwvqJgW_bxyPq77IYfUEAa"
      },

      "Old DPRASAD": {
        "1-50": "1IYG4gFrvXBJ8n2kJRFL1UCRZdUOZsZCv",
        "50-100": "1981sMj5WNTZeKsghbz4N_eEqqxm1XbT5",
        "100-150": "1KY9GTqB8sTJpGha_JnYYE9Pvnnzotf9h",
        "150-200": "18HnjG1-leT6OXk5mYPGTJluMw2yiFUEy",
        "200-300": "1KA-3P2cmmQKQRmr_-UU74ik_MmNsJ8F2"
      }

    },


    /* --------------------------------------------------------------------
       CHAPTER 7 — ESTIMATING & COSTING
       NOTE: "9.6 VALUATION" fileId below was accidentally trashed and
       is NOT yet restored — see header note. Restore it from Drive
       Trash (within the 30-day window) to make this pointer live again.
       -------------------------------------------------------------------- */

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
        "51-100": "1RjkK83GYpLncIqJJ2FGYkHh0FGGksJ_J",
        "101-150": "1O3bhzDvGZfUTy1T9guFuq_aAn3PAq7Xi",
        "151-200": "1E22sJNC6miJwVNDD5cz8EW3OXTWKc4XT",
        "201-250": "1-VeNFb81ynETihERKfWNUOZSqrYopyOH"
      },

      "RK SHRESTHA": {
        "1-81": "1x38YE2cp5xh0HDOS4MxJ4lvPqu3BdGdc",
        "82-162": "1XNc9kD0zGUJ1x3c-0wmL71XalNg46W42",
        "163-242": "1_QL2BkJ0KasZes4mlPqRdxygRCctGMS5"
      }

    },


    /* --------------------------------------------------------------------
       CHAPTER 8 — ENGINEERING DRAWING
       -------------------------------------------------------------------- */

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
        "72-143": "1YrxxoZ0IPON3ycUL0sa8sjiRHEtKip5r",
        "143-213": "1EvRKn9B2I8jjT1UeWzB8IYiDKRhz0NSs"
      }

    },


    /* --------------------------------------------------------------------
       CHAPTER 9 — ENGINEERING ECONOMICS
       -------------------------------------------------------------------- */

    "9": {

      "Abhyas": {
        "11.1 INTEREST&TIME VALUE": "1BXoTkgknjpCG5LzLRtj8k6QJoHPtcZpg",
        "11.2 ANNUITIES&SINKING FUND": "1QMnGhrfoV5F47eVQ-_APk2kxVYnaVOBn",
        "11.3 NPV IRR WORTH METHODS": "1NupM_Qdz5qYrug0WHKLPPfFMnqSsIhXw",
        "11.4 COST CONCEPTS": "1f3JdoFQeQqugV2c1-iMJ2v15A8pQs7gM",
        "11.5 BREAKEVEN&SENSITIVITY": "1Nv2D1WJfWTbX7paoLlQMO87lcnMJLPbU",
        "11.6 ECONOMICS BASICS": "1LJkfj2iru8Ue2ZKkLSrTH3Qk4Mx7ABd4"
      },

      "DPARSAD": {
        "1-75": "1vzp6vp3jscMoDEsNwLTAdX6fw2qoOe55",
        "75-129": "1abshceD1-c5wygd9L32gAoLpuYdBqkd8"
      },

      "RK SHRESTHA": {
        "1-54": "1OJYDYMCCYbayimPJzRlf7ZNI3C48YJIw",
        "55-108": "1VBxr0CbRm7LYah9FBTC3Cnl2-ddyIV39"
      }

    },


    /* --------------------------------------------------------------------
       CHAPTER 10 — PROFESSIONAL PRACTICES
       -------------------------------------------------------------------- */

    "10": {

      "Abhyas": {
        "12.1 ETHICS&INTEGRITY": "1JtVtoN-z3_fHW9VrMUyTkQg_nzmD3lw2",
        "12.2 NEC ACT": "1xipAp3_uux-3H4ms0bxX3_f7aQOLZTO-",
        "12.3 CLIENT&CONTRACTOR REL": "1ekwh7abKFvBy4ZBhrrFakCjXXWtevw-e",
        "12.4 PUBLIC PROCUREMENT": "1uDwPTlSpubLowyxKB5Bty0yclG_aKyH8",
        "12.5 NBC": "1_JEkzhm07SmcKejscg5hkCB44sQqknR1",
        "12.6 BUILDING BYLAWS": "17mDJyHSvDCYjwnlsAvAoPptHQzss9TWU"
      },

      "DPARSAD": {
        "1-111": "16Yw0SALw-Vk1KR-7HnRZdetJFqarj7S2"
      },

      "RK SHRESTHA": {
        "1-50": "1TsbaxhfnQdqsR31Qc0m48q3aIO2rqHfy",
        "51-101": "1hTK4XCovy30ZCZ5j5AmCOcTdfQCYLsTq"
      }

    }

  },


  /* ======================================================================
     GENERAL KNOWLEDGE
     RESTRUCTURED to the 11-chapter-by-topic shape. See header note.
     ====================================================================== */

  gk: {

    "1": {
      "GATE": {
        "All": "1S39S--nt9QVepKlcszdpntB8rRgAEqfd"
      },
      "DPARSAD": {
        "All": ""
      }
    },

    "2": {
      "GATE": {
        "All": "1922CKz8p81DWUWhimygloqKDNDQXbXXF"
      },
      "DPARSAD": {
        "All": ""
      }
    },

    "3": {
      "GATE": {
        "1-100": "1pomfoXhK1mWU7QAO-oihx2SMsPJqxOCh",
        "101-150": "1TTD1aKKl_P6nGcUxzyyDkpbH2O7hPx_u",
        "150-181": "1dEdvbPuxrSKys_jlMAJkaHGLuSHQ47fF"
      },
      "DPARSAD": {
        "All": ""
      }
    },

    "4": {
      "GATE": {
        "All": "1HRlsrjjxF8tW89R4fT9wTGjAnFt0gfVS"
      },
      "DPARSAD": {
        "All": ""
      }
    },

    "5": {
      "GATE": {
        "All": "1xO4bk4QCPzqCORupW07MtNj-60OFlqZE"
      },
      "DPARSAD": {
        "All": ""
      }
    },

    "6": {
      "GATE": {
        "All": "1W628YzIRlatpN0BhdtVqv1V7q44Fn8F0"
      },
      "DPARSAD": {
        "All": ""
      }
    },

    "7": {
      "GATE": {
        "All": "1TdUQchW6i2LBKdWsjMNNTGwB5hAR1iCB"
      },
      "DPARSAD": {
        "All": ""
      }
    },

    "8": {
      "GATE": {
        "All": "1SkPP7n4nIjmdEzWu8zZ5nywQaY2BmGQD"
      },
      "DPARSAD": {
        "All": ""
      }
    },

    "9": {
      "GATE": {
        "All": "1u3hA3p7wtUaDvzDioLVrFaq02WUuNCpt"
      },
      "DPARSAD": {
        "All": ""
      }
    },

    "10": {
      "GATE": {
        "All": "1G5BtPfzG_bnmDhIORtJM6N5cmCEiAt3A"
      },
      "DPARSAD": {
        "All": ""
      }
    },

    "11": {
      "DPARSAD": {
        "All": "1ZIbu4pcNLDw-N_kGEUtdNVtJqxNX0c_T"
      },

      "GATE": {
        "All": "1Z-UfiYm3_OHviX0sHzNl8elsF-lzqlkK"
      }
    }

  },


  /* ======================================================================
     OLD QUESTIONS
     ====================================================================== */

  old_question: {

    "1": {
      "PSC": {
        "81": "",
        "82": "",
        "83": ""
      }
    },

    "2": {
      "PSC": {
        "81": "",
        "82": "",
        "83": ""
      }
    }

  }

};


/* ========================================================================
   CHAPTER DATA HELPERS
   ========================================================================

   These helpers work with the complete 4-level structure:

   DRIVE[level][chapter][book][subtopic] = fileId

   Example:

   ChapterData.books("level7", "4")

   returns:

   {
     Abhyas: {...},
     DPARSAD: {...},
     RK SHRESTHA: {...}
   }

   ======================================================================== */

const ChapterData = {


  /* ----------------------------------------------------------------------
     Get all available levels
     ---------------------------------------------------------------------- */

  levels() {
    return Object.keys(CH_NAMES);
  },


  /* ----------------------------------------------------------------------
     Get human-readable level label
     ---------------------------------------------------------------------- */

  levelLabel(lv) {
    return LEVEL_LABELS[lv] || lv;
  },


  /* ----------------------------------------------------------------------
     Get chapters for a level
     ---------------------------------------------------------------------- */

  chapters(lv) {
    return CH_NAMES[lv] || {};
  },


  /* ----------------------------------------------------------------------
     Get a single chapter name
     ---------------------------------------------------------------------- */

  chapterName(lv, ch) {
    return (
      (CH_NAMES[lv] || {})[ch]
      || `Chapter ${ch}`
    );
  },


  /* ----------------------------------------------------------------------
     Get ALL books under a chapter
     ---------------------------------------------------------------------- */

  books(lv, ch) {
    return (
      DRIVE[lv] &&
      DRIVE[lv][ch]
    ) || {};
  },


  /* ----------------------------------------------------------------------
     Get only book names
     ---------------------------------------------------------------------- */

  bookNames(lv, ch) {
    return Object.keys(
      ChapterData.books(lv, ch)
    );
  },


  /* ----------------------------------------------------------------------
     Get files/subtopics for one specific book
     ---------------------------------------------------------------------- */

  files(lv, ch, book) {

    const books = ChapterData.books(lv, ch);

    return books[book] || {};
  },


  /* ----------------------------------------------------------------------
     Count usable files.

     With book:
       count only that book.

     Without book:
       count every book in the chapter.
     ---------------------------------------------------------------------- */

  fileCount(lv, ch, book) {

    if (book !== undefined) {

      return Object
        .values(
          ChapterData.files(lv, ch, book)
        )
        .filter(Boolean)
        .length;

    }


    let count = 0;


    for (
      const bookFiles
      of Object.values(
        ChapterData.books(lv, ch)
      )
    ) {

      count += Object
        .values(bookFiles)
        .filter(Boolean)
        .length;

    }


    return count;
  },


  /* ----------------------------------------------------------------------
     Count every usable file in a level
     ---------------------------------------------------------------------- */

  totalFilesInLevel(lv) {

    let total = 0;


    for (
      const ch
      of Object.keys(
        DRIVE[lv] || {}
      )
    ) {

      total += ChapterData.fileCount(
        lv,
        ch
      );

    }


    return total;
  },


  /* ----------------------------------------------------------------------
     Get a flat list of usable files inside one chapter.

     Every result looks like:

     {
       lv,
       ch,
       book,
       subtopic,
       name,
       fid,
       key
     }
     ---------------------------------------------------------------------- */

  chapterFileRefs(lv, ch) {

    const out = [];

    const books =
      ChapterData.books(lv, ch);


    for (
      const book
      of Object.keys(books)
    ) {

      const subtopics =
        books[book];


      for (
        const subtopic
        of Object.keys(subtopics)
      ) {

        const fid =
          subtopics[subtopic];


        /* Ignore empty file IDs */
        if (!fid) continue;


        out.push({

          lv,

          ch,

          book,

          subtopic,

          name:
            `${book} — ${subtopic}`,

          fid,

          key:
            `${lv}_${ch}_${book}_${subtopic}`

        });

      }

    }


    return out;
  },


  /* ----------------------------------------------------------------------
     Get EVERY usable file across the entire dataset.

     This automatically includes every book:

       Level 5
       Level 7
         • Abhyas
         • DPARSAD
         • RK SHRESTHA
         • New DPARSAD
         • Old DPRASAD
       GK
       Old Questions
     ---------------------------------------------------------------------- */

  allFileRefs() {

    const out = [];


    for (
      const lv
      of Object.keys(DRIVE)
    ) {

      for (
        const ch
        of Object.keys(
          DRIVE[lv]
        )
      ) {

        out.push(
          ...ChapterData.chapterFileRefs(
            lv,
            ch
          )
        );

      }

    }


    return out;
  }

};


/* ========================================================================
   OPTIONAL GLOBAL EXPORT
   ========================================================================

   This makes the data accessible from other scripts when this file is
   loaded normally in the browser.

   It does NOT use ES modules, so it remains compatible with a normal
   <script src="chapters-data.js"></script> setup.
   ======================================================================== */

if (typeof window !== "undefined") {

  window.CH_NAMES = CH_NAMES;
  window.LEVEL_LABELS = LEVEL_LABELS;
  window.DRIVE = DRIVE;
  window.ChapterData = ChapterData;

}
