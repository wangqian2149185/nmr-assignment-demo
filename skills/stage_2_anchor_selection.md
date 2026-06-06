# Stage 2: Anchor Selection

Goal: choose `1H-15N HSQC` amide anchor peaks and group all peaks with matching `HN` and `N` into temporary pseudo-residue terms such as `R001`. This stage is intended to run programmatically in `server.js`, not as a large LLM table-matching prompt.

Anchor modes:

- `auto`: create pseudo-residue terms from HSQC shifts plus matching triple-resonance evidence.
- `custom`: honor user-provided seed anchors as initial sequence placements for matching pseudo-residue terms.

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
