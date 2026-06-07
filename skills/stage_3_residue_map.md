# Stage 3: Observed Terms and Candidate Links

Goal: build compact `observed_residue_terms` and candidate `i-1` Cx links, not one output row per peak. This stage is intended to run programmatically in `server.js`; the LLM should establish final links and sequence placement later.

Use:

- HSQC anchors: `HN`, `N`.
- HNCACB: intra-residue and possible `i-1` CA/CB correlations.
- HN(CO)CACB / CBCA(CO)NH: `i-1` CA/CB correlations.
- Sequence residue-type patterns only after observed terms and candidate links are sent to the LLM for reasoning.

Experiment rules:

- `HNCACB`: CA/CB correlations may be both intra-residue `i` and sequential `i-1`.
- `CBCA(CO)NH` or `HN(CO)CACB`: CA/CB correlations should come from `i-1`.
- `HNCA`: CA correlations may be intra and `i-1`.
- `HN(CO)CA`: CA correlation should come from `i-1`.
- `HNCO`: CO correlation should usually come from `i-1`.

Residue-type clues:

- Gly has no CB.
- Ser/Thr usually have high CB.
- Ala has low CB.
- Proline lacks a standard backbone amide and creates useful sequence gaps.

Programmatic intermediate JSON:

```json
{
  "observed_terms": [
    {
      "id": "R001",
      "HN": 8.786,
      "N": 121.04,
      "cx": [56.04, 30.2],
      "prev_cx": [],
      "peaks": 3
    },
    {
      "id": "R002",
      "HN": 7.950,
      "N": 118.40,
      "cx": [54.8, 42.1],
      "prev_cx": [56.04, 30.2],
      "peaks": 4
    }
  ],
  "candidate_links": [
    { "a": "R001", "b": "R002", "s": 2 }
  ]
}
```

Candidate links are evidence hints, not final assignments. Multiple disconnected segments are acceptable when spectra are incomplete.
