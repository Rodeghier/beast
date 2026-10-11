import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Render the actual scorecard with known energy totals, without weather APIs.
const source = readFileSync(new URL("../components/annual-scorecard.tsx", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } });
const module = { exports: {} };
new Function("require", "module", "exports", outputText)(createRequire(import.meta.url), module, module.exports);
const assumptions = { electricityRate: 0.2, gasRate: 2, electricityCo2: 0.5, gasCo2: 5 };
const result = { equipment: {}, summary: { electricity: 10000, gasTherms: 100, siteMMBtu: 44.1214, completeHours: 8760, fullYear: true, unmetHeatingHours: 0, unmetCoolingHours: 0 } };
const render = (results, rates = assumptions) => renderToStaticMarkup(createElement(module.exports.AnnualScorecard, { results, assumptions: rates, location: "Test City, WI", year: 2025 }));
const html = render([result, result, result]);
assert.match(html, /Equipment scenario C/);
assert.match(html, /44\.1/);
assert.match(html, /\$2,200/); // 10,000 kWh × $0.20 + 100 therms × $2.
assert.match(html, /5\.5/); // (10,000 × 0.5 + 100 × 5) / 1,000 metric tons.
assert.doesNotMatch(render([result]), /Equipment scenario B/);
assert.match(render([result], { electricityRate: 0, gasRate: 0, electricityCo2: 0, gasCo2: 0 }), /\$0/);
const partial = render([{ ...result, summary: { ...result.summary, fullYear: false, completeHours: 24 } }]);
assert.equal((partial.match(/Unavailable/g) || []).length, 3);
assert.doesNotMatch(partial, /\$2,200/);
assert.match(partial, /24 valid hours/);
assert.match(render([{ ...result, equipment: null, error: "No eligible equipment" }]), /No eligible equipment/);
assert.match(render([{ ...result, summary: { ...result.summary, unmetHeatingHours: 12 } }]), /12 heating hours/);
console.log("BEAST scorecard: one/three scenarios, mixed-fuel cost and CO₂, zero rates, incomplete data, failed selection, and unmet loads passed.");
