# NMR Assignment Demo

This is a small local app for protein NMR peak-list assignment. It lets a user upload peak lists and a protein sequence, map peak-list columns to NMR dimensions, then run assignment using an LLM backend guided by the bundled `skill.md`.

The API key stays on the user's own computer in `.env`; it is not stored in `index.html` and should not be committed to GitHub.

## Files Needed

You can publish this folder by itself:

```text
nmr-assignment-demo/
  index.html
  server.js
  skill.md
  skills/
    stage_1_column_mapping.md
    stage_2_anchor_selection.md
    stage_3_residue_map.md
    stage_4_apply_peak_labels.md
    stage_5_refine_ambiguous.md
    stage_6_validation.md
  package.json
  .env.example
  .gitignore
  README.md
```

Do not include your SkillOpt training folders, `.env.skillopt`, benchmark outputs, or API keys.

## Setup

1. Install Node.js 18 or newer.
2. Clone or download this folder.
3. Copy `.env.example` to `.env`.
4. Put your own Anthropic API key in `.env`.

```bash
cp .env.example .env
```

Edit `.env`:

```text
ANTHROPIC_API_KEY=<your-anthropic-api-key>
ANTHROPIC_MODEL=claude-sonnet-4-5
PORT=8765
```

Then start the local app:

```bash
npm start
```

Open:

```text
http://localhost:8765
```

## What The App Does

- Provides one upload/drop box per NMR experiment.
- Parses CSV, TSV, whitespace-delimited TXT, simple sequence TXT, and FASTA sequence files.
- Shows uploaded peak lists immediately as tables.
- Lets the user map columns to dimensions such as `HN`, `Hx`, `N`, `CA`, `CO`, and `Cx`.
- Lets the user upload a protein sequence as FASTA, one-letter text, or tabular index/residue columns.
- Sends the mapped data plus only the relevant stage skills to the local backend.
- The backend calls Anthropic with the user's own API key.
- The backend builds a compact `residue_assignment_map` programmatically, then fills peak-list rows from that map.
- Only medium/low-confidence or blank rows are sent to a small LLM review/refinement prompt.
- Shows assigned peak lists in tables.
- Draws three NMR-style reversed-axis plots:
  - HSQC: `HN` vs `N`
  - HNCACB: `HN` vs `Cx`
  - HN(CO)CACB / CBCA(CO)NH: `HN` vs `Cx`
- Downloads the assigned table as `assigned_peak_lists.csv`.

## Assignment Modes

The UI has two modes:

- `LLM backend`: calls `server.js`, which calls Anthropic using `.env`.
- `Browser heuristic`: runs a simple built-in fallback in the browser without an API key.

For real assignment work, use `LLM backend`.

## Anchor Modes

The UI also has two anchor modes:

- `Auto anchors`: the model searches for the best sequence placement using HSQC, HNCACB, HN(CO)CACB/CBCA(CO)NH, residue-type CA/CB patterns, Gly/Pro clues, and sequential walks.
- `Custom seed anchors`: the user supplies one or more known anchors, then the model uses those seeds first and walks from them.

Accepted seed examples:

```text
HSQC_12,E31
8.786,121.04,E31
E31N-HN
```

## Runtime Workflow

The app avoids asking the LLM to do large numeric matching or write one JSON row for every peak. That was expensive and often lost cross-experiment evidence. The current workflow is:

1. Programmatically group peaks with matching `HN` and `N` into `observed_residue_terms` with temporary IDs such as `R001`.
2. Programmatically connect terms into one or more `connected_fragments` by matching each term's `i-1` Cx evidence against another term's intra Cx evidence.
3. Send compact connected fragments, not full peak tables, to the LLM for sequence-fragment validation.
4. Break rejected links and retry validation until all possible terms are placed or three validation rounds produce no new assignments.
5. Programmatically apply accepted fragment placements back to all uploaded peak lists.

This reduces token use and keeps the global backbone-walk context intact.

## Skill Files

`skill.md` is now a short controller skill. Detailed instructions are split into six stage-specific files in `skills/`.

The backend uses the stage files this way:

- Stage 2/3: implemented programmatically in `server.js` as pseudo-residue grouping and fragment building
- Stage 4: programmatic fill from LLM-validated fragment placements
- Stage 5/6 LLM call: controller + compact fragments + stage 5 + stage 6

This keeps input tokens smaller and avoids asking the LLM to perform large-scale ppm matching.

Fragment validation is batched so the model does not hit output-token limits. Useful `.env` controls:

- `FRAGMENT_VALIDATION_BATCH_SIZE=4`
- `FRAGMENT_VALIDATION_MAX_BATCHES=8`
- `FRAGMENT_VALIDATION_MAX_TOKENS=4000`

If the model still hits `max_tokens`, lower `FRAGMENT_VALIDATION_BATCH_SIZE` to `2` before raising token limits.

The fragment-validation LLM output uses a compact plain-text line protocol, not JSON, for example `F001|31|m|R001:E31,R002:G32` and `!R002>R003`. The backend parses those lines back into internal JSON objects.

## Default Tolerances

The app and `skill.md` use two-stage tolerances:

- Candidate search: `H = 0.20 ppm`, `C = 0.50 ppm`, `N = 0.80 ppm`
- Confirmation: `H = 0.04 ppm`, `C = 0.25 ppm`, `N = 0.30 ppm`

The loose set is used to collect possible correlation peaks. The tight set is used to confirm matches and raise confidence.

## Security Notes

- Never put API keys in `index.html`.
- Never commit `.env`.
- This app is intended for local use. If deployed online, add user accounts, rate limits, storage rules, and server-side key management before letting others use it.

## Current Scope

This app does not run SkillOpt training. SkillOpt was used earlier to improve and evaluate the assignment instructions. This app uses programmatic pseudo-residue grouping and fragment linking, then sends compact fragment-validation context plus relevant stage instructions to the LLM.
