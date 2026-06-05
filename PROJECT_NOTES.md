# Project Notes: SkillOpt Evaluation for NMR Assignment

This project came from an evaluation of Microsoft SkillOpt for optimizing a protein NMR assignment skill.

## Goal

Create an NMR assignment skill that helps an agent assign protein NMR peak lists from experiments such as:

- `1H-15N HSQC`
- `HNCACB`
- `HN(CO)CACB` / `CBCA(CO)NH`
- `HNCA`
- `HN(CO)CA`
- `HNCO`
- `HBHA(CO)NH`
- `HCCH-TOCSY`

The intended workflow is:

1. Upload peak lists and a protein sequence.
2. Map input columns to NMR dimensions such as `HN`, `N`, `CA`, `CB`, `Cx`, `CO`.
3. Use an optimized `skill.md` as the assignment instruction set.
4. Let an LLM perform conservative assignment.
5. Review tables and plots.
6. Download assigned peak lists.

## SkillOpt Evaluation Summary

A pseudo benchmark was built from a BMRB-derived S100A12 file. The benchmark created pseudo peak lists and gold assignments for backbone-focused NMR assignment.

Important lessons from the evaluation:

- The skill should start with backbone assignment.
- Proline normally lacks a backbone amide proton and is absent from standard `1H-15N HSQC`.
- The first residue is often absent from HSQC.
- Typical matching windows are approximately:
  - `1H`: 0.2 ppm
  - `13C`: 0.5 ppm
  - `15N`: 0.8 ppm
- Weak or conflicting evidence should remain unassigned or low confidence.
- Some residues may have no corresponding peak.
- Sequential correlation peaks and residue-type CA/CB patterns are the main evidence.
- Glycine has no CB and often has `15N` around 90-110 ppm.

After fixing chunk boundary context in the benchmark dataset, the optimized `skill.md` achieved perfect scores on the chunked S100A12 benchmark:

- Train chunks: 18/18 hard = 1.0, soft = 1.0
- Validation chunks: 6/6 hard = 1.0, soft = 1.0
- Test chunks: 5/5 hard = 1.0, soft = 1.0

SkillOpt did not generate further patches in the final full run because the initial skill was already scoring perfectly on that benchmark.

## Current App

This repository is not the full SkillOpt training workspace. It is the clean runtime demo:

- `skill.md` contains the optimized NMR assignment skill.
- `server.js` sends uploaded peak data plus `skill.md` to Anthropic.
- `index.html` provides the upload, mapping, plotting, review, and download UI.
- Users provide their own API key in a local `.env` file.

## Privacy

This repository intentionally excludes:

- API keys
- `.env`
- `.env.skillopt`
- SkillOpt training runs
- benchmark gold files
- generated test outputs
