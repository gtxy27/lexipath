# Proficiency mapping (CEFR as the base)

LexiPath stores user proficiency internally as **CEFR** (`A1/A2/B1/B2/C1/C2`). This keeps prompts and difficulty labels consistent across features.

However, many learners think in exam-oriented scales (e.g. IELTS, JLPT, TOPIK, CET). This doc describes how LexiPath *roughly* aligns those scales to CEFR.

## English: CEFR ↔ IELTS (official reference)

LexiPath uses CEFR as the internal value. When the target language is English, prompts may include a reference mapping to IELTS band scores.

This mapping follows the IELTS “IELTS and the CEFR” comparison diagram (B1+ is the main focus):

- `B1` ≈ IELTS **4.0–5.0**
- `B2` ≈ IELTS **5.5–6.5** (6.5–7.0 is a common C1 borderline)
- `C1` ≈ IELTS **7.0–8.0** (8.0–8.5 is a common C2 borderline)
- `C2` ≈ IELTS **8.5–9.0**

`A1/A2` are typically below IELTS 4.0; the exact cut varies a lot by skill and test-taker profile.

## English (China): CET-4/CET-6 (non-official heuristic)

There is no universally accepted official conversion between CET and CEFR/IELTS. LexiPath treats this as a *rough* UX hint only:

- `CET-4` (pass) ≈ `B1` (some learners approach `B2`)
- `CET-6` (pass) ≈ `B2`

If you want this to be more precise, we should model it as a **range** and possibly split by skill (listening/reading/writing/speaking).

## Japanese: CEFR ↔ JLPT (approximate)

Onboarding lets users pick JLPT levels for Japanese and converts them into CEFR internally.

- `N5` → `A1`
- `N4` → `A2`
- `N3` → `B1`
- `N2` → `B2`
- `N1` → `C1` (JLPT does not reliably separate `C1` vs `C2`)

## Korean: CEFR ↔ TOPIK (approximate)

Onboarding lets users pick TOPIK levels for Korean and converts them into CEFR internally:

- `1` → `A1`
- `2` → `A2`
- `3` → `B1`
- `4` → `B2`
- `5` → `C1`
- `6` → `C2`

## Caveats (important)

- These mappings are inherently approximate. Two learners with the same exam score can have different vocabulary/grammar strengths.
- CEFR is a **skill-based framework**; any “word list range” is necessarily fuzzy unless we adopt a specific CEFR-graded vocabulary source.
- LexiPath uses CEFR to keep prompt constraints stable, and adds exam mappings only as an optional reference line in prompts.

## CEFR default guidance (quantitative, for prompts)

LexiPath keeps CEFR as the default proficiency input, but prompts can include a short “output constraint” section to make the level more actionable for the LLM.

This guidance is intentionally **lightweight** and “quantified” mainly via:

- Sentence count (e.g. A1/A2: 1–2 sentences; B1: within 2 sentences)
- Definition length budget (rough limits, to keep the explanation readable)
- Allowing a small amount of **i+1** (a couple of slightly harder words), but requiring in-line clarification

These numbers are not an official CEFR vocabulary quota; they are a pragmatic prompt control to reduce verbosity and keep the language accessible.
