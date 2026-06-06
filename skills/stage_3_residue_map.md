# Stage 3: Compact Residue Assignment Map

Goal: build a compact `residue_assignment_map`, not one output row per peak.

Use:

- HSQC anchors: `HN`, `N`.
- HNCACB: intra-residue and possible `i-1` CA/CB correlations.
- HN(CO)CACB / CBCA(CO)NH: `i-1` CA/CB correlations.
- Sequence residue-type patterns.

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

Output only compact JSON:

```json
{
  "residue_assignment_map": [
    {
      "anchor_residue": "E31",
      "hsqc_peak_id": "peak id or empty",
      "HN": 8.786,
      "N": 121.04,
      "CA_i": 56.04,
      "CB_i": 30.2,
      "previous_residue": "D30",
      "CA_i_minus_1": 54.8,
      "CB_i_minus_1": 42.1,
      "confidence": "high",
      "notes": ""
    }
  ]
}
```

Keep low-confidence anchors out of the map or mark them `low`/`ambiguous`.
