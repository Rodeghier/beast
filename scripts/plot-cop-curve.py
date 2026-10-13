"""Run export-cop-curve.mjs first; requires matplotlib (local runtime supported)."""
import json
import sys
from pathlib import Path
root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / ".sites-runtime/pythonplot"))
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D

out = root / "docs/cop-curve"
data = json.loads((out / "heating-cop.json").read_text())
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 11, "axes.spines.top": False, "axes.spines.right": False})
fig, ax = plt.subplots(figsize=(12, 7.5))
fig.subplots_adjust(left=.085, right=.97, top=.79, bottom=.26)
fig.text(.085, .935, "BEAST  /  EQUIPMENT PERFORMANCE", color="#526477", fontsize=11, weight="bold")
fig.text(.085, .88, "Heating COP vs. outdoor temperature", fontsize=25, weight="bold", color="#132c42")
fig.text(.085, .83, "Full-load coil COP • 25-ton unit • 70°F entering air • 404 CFM/ton • 0°F lockout", fontsize=11)
colors = ["#087e8b", "#bd5824", "#5062b6", "#9b3980"]
labels = ["Standard heat pump", "Lab-data heat pump", "High-performance HP (CAV)", "Cold-climate HP (concept)"]
families = ["standard", "lab", "variable", "cold"]
for family, color, label in zip(families, colors, labels):
    rows = [r for r in data["rows"] if r["family"] == family]
    for bounded, style in [(False, "-"), (True, "--")]:
        xs = [r["outdoorF"] for r in rows]
        ys = [r["cop"] if r["bounded"] == bounded and r["cop"] is not None else float("nan") for r in rows]
        ax.plot(xs, ys, color=color, lw=2.3, ls=style)
ax.axvspan(-15, 0, color="#e9edf1")
ax.axvline(0, color="#7b8793", lw=1, ls=":")
ax.text(-7.5, 3.1, "Heating locked out\nCOP undefined", ha="center", va="center", color="#556373", fontsize=10)
ax.axhline(1, color="#89939d", lw=1, ls=":")
ax.text(64, 1.06, "Resistance heating: COP 1", ha="right", fontsize=9, color="#65717e")
ax.set(xlim=(-15, 65), ylim=(0, max(r["cop"] or 0 for r in data["rows"]) * 1.13), xlabel="Outdoor dry-bulb temperature (°F)", ylabel="Heating COP (thermal output / electrical input)")
ax.set_xticks(list(range(-15, 66, 5)))
ax.grid(axis="y", alpha=.2)
handles = [Line2D([0], [0], color=c, lw=2.5, label=l) for c, l in zip(colors, labels)]
fig.legend(handles=handles, loc="lower left", bbox_to_anchor=(.08, .135), ncol=2, frameon=False, fontsize=10)
fig.text(.085, .105, "Solid: within curve limits. Dashed: input held at a performance-map boundary.", fontsize=9, color="#526477")
fig.text(.085, .077, "Direct output of lib/rtu-curves.ts → heatingOperatingPoint(); 0.25°F increments. Entering/outdoor RH: 50%.", fontsize=9, color="#526477")
fig.text(.085, .049, "Excludes supply fan, reheat and cycling losses. No added defrost adjustment. Cold-climate concept changes stage near 17°F.", fontsize=9, color="#526477")
for ext in ["png", "svg", "pdf"]:
    fig.savefig(out / f"heating-cop.{ext}", dpi=180, facecolor="white")
print("Saved PNG, SVG and PDF in", out)
