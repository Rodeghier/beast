// Run: node scripts/export-cop-curve.mjs
// Executes the repository's TypeScript performance functions without copying equations.
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url), cache = new Map();
function load(path) {
  let file = resolve(root, path);
  if (!existsSync(file)) file += ".ts";
  if (file.endsWith(".json")) return JSON.parse(readFileSync(file, "utf8"));
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } });
  const localRequire = name => name.startsWith(".") ? load(resolve(dirname(file), name)) : require(name);
  new Function("require", "module", "exports", outputText)(localRequire, module, module.exports);
  return module.exports;
}
const { heatingOperatingPoint, wetBulbC, BTU_PER_KWH } = load("lib/rtu-curves.ts");
const { humidityRatio, celsius } = load("lib/school.ts");
const { FAMILIES, DEFAULT_SYSTEM } = load("lib/equipment-catalog.ts");
const { DEFAULT_RTU } = load("lib/rtu.ts");
const assumptions = { tonsEach: 25, count: 1, enteringDbF: 70, enteringRh: 50, outdoorRh: 50, cfmPerTon: DEFAULT_RTU.cfmPerTon, lockoutF: DEFAULT_SYSTEM.lockoutF };
const enteringDbC = celsius(assumptions.enteringDbF);
const enteringWbC = wetBulbC(enteringDbC, humidityRatio(enteringDbC, assumptions.enteringRh));
const rows = [];
for (const [family, info] of Object.entries(FAMILIES)) {
  for (let outdoorF = -15; outdoorF <= 65; outdoorF += .25) {
    const outdoorC = celsius(outdoorF);
    const point = heatingOperatingPoint(assumptions.count, assumptions.tonsEach, enteringDbC, enteringWbC, outdoorC, humidityRatio(outdoorC, assumptions.outdoorRh), assumptions.cfmPerTon, family, assumptions.lockoutF);
    if (point.lockout) assert.equal(point.cop, null);
    else {
      assert.ok(Number.isFinite(point.cop) && point.cop > 0);
      assert.ok(Math.abs(point.cop - point.capacityBtu / (BTU_PER_KWH * point.inputKw)) < 1e-10);
    }
    rows.push({ family, name: info.name, outdoorF, cop: point.cop, capacityBtuPerHour: point.capacityBtu, electricalKw: point.inputKw, bounded: point.bounded, lockout: point.lockout });
  }
}
const output = resolve(root, "docs/cop-curve"); mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, "heating-cop.json"), JSON.stringify({ assumptions, model: "heatingOperatingPoint in lib/rtu-curves.ts", rows }, null, 2));
const keys = Object.keys(rows[0]);
writeFileSync(resolve(output, "heating-cop.csv"), [keys.join(","), ...rows.map(row => keys.map(key => row[key] ?? "").join(","))].join("\n"));
console.log(`Exported ${rows.length} points to docs/cop-curve; verified COP against capacity and input power.`);
