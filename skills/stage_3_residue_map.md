# Stage 3: Connected Pseudo-Residue Fragments

Goal: build compact `observed_residue_terms` and `connected_fragments`, not one output row per peak. This stage is intended to run programmatically in `server.js`; the LLM should only review compact connected fragments later.

Use:

- HSQC anchors: `HN`, `N`.
- HNCACB: intra-residue and possible `i-1` CA/CB correlations.
- HN(CO)CACB / CBCA(CO)NH: `i-1` CA/CB correlations.
- Sequence residue-type patterns only after fragments are sent to the LLM for validation.

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
  "connected_fragments": [
    {
      "fragment_id": "F001",
      "residues": [
        {
          "temp_id": "R001",
          "HN": 8.786,
          "N": 121.04,
          "intra_carbons": [56.04, 30.2],
          "previous_carbons": []
        },
        {
          "temp_id": "R002",
          "HN": 7.950,
          "N": 118.40,
          "intra_carbons": [54.8, 42.1],
          "previous_carbons": [56.04, 30.2]
        }
      ],
      "links": [
        { "from_temp_id": "R001", "to_temp_id": "R002", "score": 2 }
      ]
    }
  ]
}
```

Fragments may be short. Multiple disconnected fragments are acceptable when spectra are incomplete.
