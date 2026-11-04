"""Fit one anchored, size-independent normalized cooling-capacity curve.

Uses the accepted maximum-airflow source CSV already in the repository.
Each source model has equal total weight, so differing table lengths do not
favor one size. Reference capacities, SHR and other source data are unchanged.
Run with the bundled Python runtime (numpy required); --check verifies output.
"""
from pathlib import Path
import argparse
import csv
import hashlib
import json
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public/references/packaged-cooling-source-data.csv"
OUT = ROOT / "lib/data/shared-cooling-capacity.json"


def fit():
    with SOURCE.open(encoding="utf-8-sig", newline="") as stream:
        rows = [r for r in csv.DictReader(stream) if r["capacity_normalized"]]
    values = np.array([[float(r[k]) for k in
                        ["outdoor_dry_bulb_F", "entering_wet_bulb_F", "entering_dry_bulb_F"]] for r in rows])
    x, y, z = ((values - [95, 67, 80]) / [20, 6, 10]).T
    a = np.column_stack([x, y, z, x*x, x*y, x*z, y*y, y*z, z*z])
    q = np.array([float(r["capacity_normalized"]) for r in rows])
    tables = np.array([int(r["table"]) for r in rows])
    tons = np.array([float(r["nominal_tons"]) for r in rows])
    weights = np.array([1 / np.count_nonzero(tables == t) for t in tables])

    def solve(mask):
        w = np.sqrt(weights[mask])
        return np.r_[1., np.linalg.lstsq(a[mask] * w[:, None], (q[mask]-1)*w, rcond=None)[0]]

    def metrics(actual, predicted):
        relative = (predicted-actual)/actual
        return {"points": len(actual), "relative_rmse_percent": float(100*np.sqrt(np.mean(relative**2))),
                "max_relative_error_percent": float(100*np.max(np.abs(relative)))}

    c = solve(np.ones(len(rows), dtype=bool))
    predicted = c[0] + a @ c[1:]
    assert np.all(predicted > 0)
    held = np.empty(len(rows))
    for size in np.unique(tons):
        mask = tons == size
        cc = solve(~mask)
        held[mask] = cc[0] + a[mask] @ cc[1:]
    return {"id": "shared-normalized-cooling-capacity-v1", "source_sha256": hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
            "basis": "Pooled accepted maximum-airflow data, normalized by each source model's 95/67/80 F reference; equal total weight per source model. Applied to all sizes by modeling assumption, including added large sizes; not an independently validated large-unit fit.",
            "reference_temperatures_F": [95, 67, 80], "temperature_scales_F": [20, 6, 10],
            "terms": ["1", "x", "y", "z", "x^2", "x*y", "x*z", "y^2", "y*z", "z^2"],
            "capacity_coefficients": c.tolist(), "source_models": len(np.unique(tables)),
            "source_fit": metrics(q, predicted), "leave_one_size_out": metrics(q, held)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    result = fit()
    if args.check:
        existing = json.loads(OUT.read_text(encoding="utf-8"))
        np.testing.assert_allclose(existing["capacity_coefficients"], result["capacity_coefficients"], rtol=1e-12, atol=1e-12)
        assert existing["source_sha256"] == result["source_sha256"]
        print("PASS: shared normalized capacity fit reproduces accepted source data.")
    else:
        OUT.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"source_fit": result["source_fit"], "leave_one_size_out": result["leave_one_size_out"]}))
