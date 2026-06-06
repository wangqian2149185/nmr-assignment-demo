# Stage 2: Anchor Selection

Goal: choose `1H-15N HSQC` amide anchor peaks and map them to possible sequence residues.

Anchor modes:

- `auto`: infer anchors from HSQC shifts plus triple-resonance CA/CB evidence.
- `custom`: honor user-provided seed anchors first, then walk sequentially from those seeds.

Custom seed examples:

```text
HSQC_12,E31
8.786,121.04,E31
E31N-HN
```

Rules:

- Proline has no normal backbone amide proton and should not be assigned a standard HSQC backbone anchor.
- The first residue is often absent from HSQC.
- Some residues may have no corresponding peak.
- `1H-15N HSQC` can include Asn/Gln side-chain amides; do not confuse them with backbone anchors unless side-chain assignment is explicitly requested.
- Glycine backbone `15N` is often around 90-110 ppm.
- Use loose tolerances to collect candidate correlations and tight tolerances to raise confidence.

Two-stage tolerances:

- Candidate search: `H = 0.20 ppm`, `C = 0.50 ppm`, `N = 0.80 ppm`.
- Confirmation: `H = 0.04 ppm`, `C = 0.25 ppm`, `N = 0.30 ppm`.
