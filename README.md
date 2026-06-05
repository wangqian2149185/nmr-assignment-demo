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
- Sends the mapped data plus `skill.md` to the local backend.
- The backend calls Anthropic with the user's own API key.
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

## Security Notes

- Never put API keys in `index.html`.
- Never commit `.env`.
- This app is intended for local use. If deployed online, add user accounts, rate limits, storage rules, and server-side key management before letting others use it.

## Current Scope

This app does not run SkillOpt training. SkillOpt was used earlier to improve and evaluate the `skill.md`. This app uses that skill at runtime: the uploaded peak lists and sequence are sent to an LLM together with `skill.md`, and the LLM returns assignment rows.
