---
name: nmr-assignment
description: Use when assigning protein NMR peak lists from 1H-15N HSQC, 1H-13C HSQC, HNCA, HN(CO)CA, HNCACB, CBCA(CO)NH, HNCO, HBHA(CO)NH, HCCH-TOCSY, TOCSY/NOESY/COSY-HSQC, or related Excel/CSV peak tables. Helps inspect chemical shifts, build residue/spin-system assignments, fill assignment spreadsheets, validate conflicts, and prepare SkillOpt benchmark submissions.
---

# NMR Assignment

Use this skill to assign protein NMR pseudo or experimental peak lists in Excel/CSV files. The goal is to produce a conservative, auditable assignment table, not to force every peak into a residue.

## Core Workflow

1. Inspect the input workbook or CSV files first. Identify sheets for sequence, peak lists, existing assignments, tolerances, and the output template.
2. If the task includes hidden gold/reference data, do not read it during assignment. Use only agent-visible `input/` files unless the user explicitly asks for evaluation.
3. Normalize the sequence into residue labels like `K3`, `G31`, `E40`. Keep the original residue numbering; do not renumber gaps away.
4. Anchor amide correlations from `1H-15N HSQC`, then use triple-resonance experiments to connect each amide to intra-residue and `i-1` carbon/proton shifts.
5. Prefer deterministic matching and tabular evidence over narrative guessing. Compare candidate shifts within tolerance, record alternatives, and mark ambiguity when multiple candidates remain.
6. Start with backbone assignment before side-chain expansion. The minimal backbone evidence set is usually `1H-15N HSQC`, `HNCACB`, `HN(CO)CACB`/`CBCA(CO)NH`, and the protein sequence.
7. Fill the assignment output with one row per peak or requested entity. Preserve `peak_id`; never invent peak IDs.
8. Validate the final table before returning it. For benchmark samples, run the scorer only after producing the submission.

## Output Columns

For SkillOpt-style samples, fill:

```text
peak_id, experiment_key, assigned_anchor_residue, assigned_source_residue,
assigned_source_atoms, assigned_relation, confidence, notes
```

Use residue labels such as `K3`; use atom sets like `N,CA,H` or `N,CB,H`; use relations such as `intra`, `sequential_i_minus_1`, `intra_spin_system`.

When returning CSV text, quote any field that contains commas. Atom-set fields must be valid CSV cells, for example `"N,H"`, `"N,CA,H"`, `"N,CB,H"`, or `"N,CO,H"`. Do not output unquoted `N,CA,H` inside a CSV row, because it will be parsed as multiple columns and scored as wrong.

For ordinary user Excel sheets, follow the workbook's existing column names. If no output schema exists, create a sheet or CSV with the same core columns plus measured ppm columns.

## Assignment Strategy

- Backbone first: assign amide anchors and sequential carbon links before attempting side-chain-heavy experiments.
- `1H-15N HSQC`: identify amide anchors by matching `N` and `HN`. Proline has no backbone amide proton and normally has no standard backbone HSQC peak. The first residue of a protein is often not observed in HSQC. Some residues may have no corresponding peak; do not force assignments to cover every residue.
- `1H-15N HSQC` also contains side-chain amide peaks from Asn and Gln. Do not confuse ASN/GLN side-chain amides with backbone anchors unless the task explicitly includes side-chain amide assignment.
- `HNCA`: CA correlations may be both intra-residue `i` and sequential `i-1`.
- `HN(CO)CA`: CA correlation should come from `i-1`.
- `HNCACB`: CA/CB correlations may be both intra and `i-1`; use CB sign/intensity if available, but do not assume sign exists in pseudo lists.
- `CBCA(CO)NH`: CA/CB correlations should come from `i-1`.
- `HNCO`: CO correlation should usually come from `i-1`.
- `HBHA(CO)NH`: HA/HB correlations should usually come from `i-1`.
- `HN(CA)CO`: CO may include intra and `i-1`.
- `1H-13C HSQC`, `HCCH-TOCSY`, `TOCSY-HSQC`, `COSY-HSQC`: use side-chain/spin-system consistency to resolve residue type and proton/carbon assignments.
- `NOESY-HSQC`: use as supporting evidence for sequential or spatial proximity; do not let NOE evidence override inconsistent backbone evidence without noting the conflict.

For detailed experiment-specific rules and conflict handling, read `references/assignment_rules.md`.

## Matching Tolerances

Use user-provided tolerances when available. Otherwise, use two-stage tolerances:

Candidate search / loose correlation windows:

- `1H` dimension: about 0.2 ppm.
- `13C` dimension: about 0.5 ppm.
- `15N` dimension: about 0.8 ppm.

Confirmation / tight matching windows:

- `1H` dimension: about 0.04 ppm.
- `13C` dimension: about 0.25 ppm.
- `15N` dimension: about 0.3 ppm.

Use the loose windows to collect possible correlation peaks. Use the tight windows to raise confidence or confirm a proposed match. Peaks inside the loose windows are candidates, not necessarily unique matches. Narrow the candidate set using sequential consistency and residue-type carbon patterns.

## Conservative Assignment Rules

- Sequential correlation peaks and side-chain carbon patterns are the primary evidence for backbone assignment.
- CA/CB chemical shifts should be checked against residue type; glycine has no CB, and glycine backbone `15N` is often around 90-110 ppm.
- Leave fields blank or mark low/ambiguous when evidence is thin, contradictory, or has multiple plausible candidates. Prefer missing assignments over false certainty.
- It is acceptable for some residues to have no assigned peak.

## Confidence

Use:

- `high`: unique match across relevant experiments and no major conflict.
- `medium`: chemically plausible with minor ambiguity or missing confirmation.
- `low`: weak evidence, overlap, missing companion peaks, or multiple plausible alternatives.
- `ambiguous`: keep alternatives in `notes`; do not force a single source residue/atom if the task allows ambiguity.

## Validation

Before finishing:

1. Confirm required columns exist and `peak_id` values are unchanged.
2. Check that residue labels exist in the sequence.
3. Check atom names are chemically plausible for the residue.
4. Check sequential assignments do not point outside the sequence/window.
5. Check duplicate peaks with identical ppm are either intentionally degenerate or noted.
6. Run `scripts/validate_assignment_csv.py` when a CSV submission is available.

For SkillOpt benchmark data, use:

```bash
python3 scripts/score_assignment.py --sample-dir <sample_dir> --submission <submission.csv>
```

Only run the scorer after the assignment is complete, and never expose `gold/` files during the rollout.
