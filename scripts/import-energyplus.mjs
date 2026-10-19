// Rebuild the catalog and auditable CSVs from the unmodified, pinned upstream files.
// CSV authoring uses the bundled artifact runtime, supplied with BEAST_ARTIFACT_NODE_MODULES.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const VERSION = '26.2.0';
export const COMMIT = '4bd7a1f26fb749a83257855aba6760e26c8a3c8f';
const root = resolve(import.meta.dirname, '..');
const upstream = resolve(root, 'docs/energyplus/upstream');
const output = resolve(root, 'public/data');
const sourceUrl = file => `https://github.com/NatLabRockies/EnergyPlus/blob/${COMMIT}/${file === 'Energy+.idd.in' ? 'idd/' : 'datasets/'}${file}`;
const numeric = v => v !== '' && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : null;
const key = v => v.toLowerCase();
const hash = data => createHash('sha256').update(data).digest('hex');

export function parseDictionary(text) {
  const objects = []; let group = '', object, field;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/!.*$/, '');
    const g = line.match(/^\\group\s+(.+)/);
    if (g) { group = g[1].trim(); continue; }
    const o = line.match(/^([A-Za-z][\w:.+\-]*),\s*$/);
    if (o) { object = { type: o[1], group, fields: [] }; objects.push(object); field = undefined; continue; }
    const f = line.match(/^\s*[AN]\d+\s*[,;]\s*\\field\s+(.+)/);
    if (f && object) { field = { name: f[1].trim(), units: '', default: '' }; object.fields.push(field); }
    const units = line.match(/^\s*\\units\s+(.+)/), def = line.match(/^\s*\\default\s+(.+)/);
    if (field && units) field.units = units[1].trim();
    if (field && def) field.default = def[1].trim();
  }
  return objects;
}

export function parseIdf(text, file, dictionary) {
  return text.replace(/!.*$/gm, '').split(';').map(block => block.trim()).filter(Boolean).map((block, objectIndex) => {
    const [type, ...values] = block.split(',').map(v => v.trim());
    const schema = dictionary.get(key(type));
    if (!schema) throw new Error(`Unknown object type in ${file}: ${type}`);
    return { type: schema.type, name: values[0], values, file, schema, objectIndex: objectIndex + 1 };
  });
}

const dictionary = parseDictionary(readFileSync(resolve(upstream, 'Energy+.idd.in'), 'utf8'));
const byType = new Map(dictionary.map(o => [key(o.type), o]));
const files = readdirSync(upstream).filter(f => f.endsWith('.idf')).sort();
const hashes = new Map(files.map(file => [file, hash(readFileSync(resolve(upstream, file)))]));
const objects = files.flatMap(file => parseIdf(readFileSync(resolve(upstream, file), 'utf8'), file, byType));
const references = new Map();
for (const o of objects.filter(o => !/^(Curve:|Table:)/i.test(o.type))) {
  for (const name of new Set(o.values.slice(1).filter(Boolean).map(key))) {
    const id = `${o.file}:${name}`;
    if (!references.has(id)) references.set(id, []);
    references.get(id).push(o);
  }
}
const fields = o => Object.fromEntries(o.values.map((v, i) => [o.schema.fields[i]?.name ?? `Extensible field ${i + 1}`, v]));
const get = (o, name) => { const i = o.schema.fields.findIndex(f => key(f.name) === key(name)); return i < 0 ? '' : o.values[i] ?? ''; };
const curveObjects = objects.filter(o => /^(Curve:|Table:)/i.test(o.type));
const curvesByFile = new Map();
for (const file of files) curvesByFile.set(file, new Map(curveObjects.filter(c => c.file === file).map(c => [key(c.name), c])));
const supportedForms = new Set(['Curve:Linear', 'Curve:Quadratic', 'Curve:Cubic', 'Curve:Biquadratic']);
function curveFor(o, role) {
  const name = get(o, role), curve = curvesByFile.get(o.file).get(key(name));
  if (!curve || !supportedForms.has(curve.type)) throw new Error(`Unusable ${role} for ${o.name}: ${name}`);
  const data = fields(curve);
  return { name: curve.name, type: curve.type, coefficients: Object.entries(data).filter(([k]) => /^Coefficient\d/i.test(k)).map(([, v]) => Number(v)),
    minX: numeric(data['Minimum Value of x']), maxX: numeric(data['Maximum Value of x']),
    minY: numeric(data['Minimum Value of y']), maxY: numeric(data['Maximum Value of y']),
    minOutput: numeric(data['Minimum Curve Output']), maxOutput: numeric(data['Maximum Curve Output']) };
}
const profiles = [], profileIssues = new Map();
for (const o of objects.filter(o => ['Coil:Cooling:DX:SingleSpeed', 'Coil:Heating:DX:SingleSpeed'].includes(o.type))) {
  try {
    const mode = o.type.includes(':Cooling:') ? 'cooling' : 'heating';
    if (mode === 'cooling' && !['', 'AirCooled'].includes(get(o, 'Condenser Type'))) throw new Error('Condenser requires evaporative or water-side heat rejection and water use.');
    const capacityW = numeric(get(o, mode === 'cooling' ? 'Gross Rated Total Cooling Capacity' : 'Gross Rated Heating Capacity'));
    const cop = numeric(get(o, mode === 'cooling' ? 'Gross Rated Cooling COP' : 'Gross Rated Heating COP'));
    if (o.file === 'RooftopPackagedHeatPump.idf' && o.name === 'Lennox KHA060S4 Cooling' && cop === 385) throw new Error('Conflicting source rated COP: equipment object states 385 W/W while the same dataset summary states 3.85 W/W. Excluded pending authoritative correction; original data preserved without guessing a replacement.');
    const airflowM3s = numeric(get(o, 'Rated Air Flow Rate'));
    const shr = mode === 'cooling' ? numeric(get(o, 'Gross Rated Sensible Heat Ratio')) : null;
    if (!(capacityW > 0 && cop > 0 && airflowM3s > 0) || (mode === 'cooling' && !(shr > 0 && shr < 1))) throw new Error('No numeric rated capacity, COP, airflow and/or rated SHR; autosizing or additional design inputs required.');
    // One upstream heating object is named "... Cooling"; object type owns the
    // mode. Normalize either suffix on both names, keeping original names intact.
    const modelName = name => key(name.replace(/ (cooling|heating)$/i, ''));
    const coolingPeer = mode === 'heating' ? objects.find(p => p.file === o.file && ['Coil:Cooling:DX:SingleSpeed', 'Coil:Cooling:DX:TwoStageWithHumidityControlMode'].includes(p.type) && modelName(p.name) === modelName(o.name)) : o;
    if (!coolingPeer) throw new Error('No matched source cooling rating to establish the nominal-ton basis for this heating profile.');
    // A single-speed heating coil can belong to a unit with two-stage cooling.
    // Read that unit's full-output rating only; do not simulate its stage controls.
    const basisRating = coolingPeer.type === 'Coil:Cooling:DX:TwoStageWithHumidityControlMode'
      ? objects.find(p => p.file === o.file && p.type === 'CoilPerformance:DX:Cooling' && key(p.name) === key(get(coolingPeer, 'Normal Mode Stage 1+2 Coil Performance Name'))) : coolingPeer;
    const basisCapacityW = basisRating ? Number(get(basisRating, 'Gross Rated Total Cooling Capacity')) : NaN;
    if (!(basisCapacityW > 0)) throw new Error('Matched cooling coil has no numeric full-output cooling rating for the heating nominal-ton basis.');
    const prefix = mode === 'cooling' ? 'Total Cooling' : 'Heating';
    const curveSet = {
      capacityTemperature: curveFor(o, `${prefix} Capacity Function of Temperature Curve Name`),
      capacityFlow: curveFor(o, `${prefix} Capacity Function of Flow Fraction Curve Name`),
      eirTemperature: curveFor(o, 'Energy Input Ratio Function of Temperature Curve Name'),
      eirFlow: curveFor(o, 'Energy Input Ratio Function of Flow Fraction Curve Name'),
      partLoad: curveFor(o, 'Part Load Fraction Correlation Curve Name'),
    };
    const id = `energyplus-${mode}-${o.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '')}`;
    if (profiles.some(p => p.id === id)) throw new Error(`Duplicate profile ID: ${id}`);
    profiles.push({ id, name: o.name, mode, objectType: o.type, file: o.file, source: sourceUrl(o.file), capacityW, basisCapacityW, basisRatingName: basisRating.name, basisRatingType: basisRating.type,
      capacityRatio: capacityW / basisCapacityW, cop, airflowM3s, cfmPerTon: airflowM3s / 0.00047194745 / (basisCapacityW / (12000 / 3412.141633 * 1000)),
      shr, minimumOutdoorC: numeric(get(o, 'Minimum Outdoor Dry-Bulb Temperature for Compressor Operation')), curves: curveSet });
  } catch (error) { profileIssues.set(o, error.message); }
}

const equipmentGroups = new Set(['Exterior Equipment', 'HVAC Templates', 'Zone HVAC Forced Air Units', 'Zone HVAC Radiative/Convective Units', 'Zone HVAC Air Loop Terminal Units', 'Fans', 'Coils', 'Evaporative Coolers', 'Humidifiers and Dehumidifiers', 'Heat Recovery', 'Unitary Equipment', 'Variable Refrigerant Flow Equipment', 'Pumps', 'Non-Zone Equipment', 'Solar Collectors', 'Plant Heating and Cooling Equipment', 'Condenser Equipment and Heat Exchangers', 'Water Heaters and Thermal Storage', 'Refrigeration', 'Electric Load Center-Generator Specifications', 'Water Systems', 'User Defined HVAC and Plant Component Models']);
function scope(o) {
  const t = o.type;
  if (t === 'Coil:Cooling:DX:SingleSpeed' || t === 'Coil:Heating:DX:SingleSpeed') return ['adapted', 'Selectable numeric single-speed dataset profiles use source curves, rated COP, airflow and SHR in BEAST CAV screening. Capacity scales to nominal tons; defrost, crankcase and transient latent degradation are excluded. Incomplete profiles are reported individually.'];
  if (t === 'Coil:Heating:Electric') return ['existing-simplification', 'Primary electric heat and reheat at COP 1 already modeled; no EnergyPlus object import or availability-node controls.'];
  if (t === 'Coil:Heating:Fuel') return ['existing-simplification', 'Natural-gas primary furnace at fixed 0.80 efficiency already modeled; other fuels, PLF, pilot and parasitic terms are not implemented.'];
  if (t === 'Fan:ConstantVolume') return ['existing-simplification', 'CAV fan electricity and heat already modeled with editable W/CFM; no pressure-rise/motor-efficiency object import.'];
  if (!equipmentGroups.has(o.group)) return ['not-equipment', 'Supporting simulation, envelope, controls, connections, schedules, curve/table or reporting object; not an independent equipment option.'];
  if (/Chiller|Boiler|HeatPump:Plant|District|PlantComponent|FluidCooler|CoolingTower|HeatExchanger:Fluid|Coil:(Cooling|Heating):Water|Coil:Heating:Steam|TemperingValve|Pump:/i.test(t)) return ['not-integrated', 'Requires a solved water/steam/condenser plant: fluid temperatures and flow, dispatch, pumps, distribution and heat rejection; BEAST has no plant-loop solver.'];
  if (/WaterToAir|WaterToWater|Ground|Pond|Surface|HeatPump:Water/i.test(t)) return ['not-integrated', 'Requires source-water temperatures/flow and a water or ground heat-balance model; outdoor dry bulb cannot substitute for loop temperature.'];
  if (/Refrigeration/i.test(t)) return ['not-integrated', 'Requires evaporating/condensing temperatures, refrigerated case/process loads, refrigerant circuits and defrost schedules; building HVAC loads are insufficient.'];
  if (/VariableRefrigerant|VRF/i.test(t)) return ['not-integrated', 'Requires coupled outdoor/indoor unit sizing, refrigerant piping, zonal dispatch and heat-recovery controls.'];
  if (/MultiSpeed|TwoSpeed|TwoStage|VariableSpeed|CurveFit|ThermalStorage|Mode/i.test(t)) return ['not-integrated', 'Requires stage/speed or mode dispatch and its associated ratings and controls; using a single-speed curve would not reproduce this equipment.'];
  if (/Evaporative|Humidifier|Dehumidifier|Desiccant|HeatExchanger:Air/i.test(t)) return ['not-integrated', 'Requires coupled outlet-air temperature/humidity, effectiveness or regeneration controls and water use beyond the current DX/reheat air path.'];
  if (/Solar|Generator:|ElectricLoad|Photovoltaic|Storage:|WaterHeater|WaterUse/i.test(t)) return ['not-integrated', 'Requires generation, storage, domestic/process water loads and dispatch/thermal state inputs not present in the HVAC comparison.'];
  if (/Fan:/i.test(t)) return ['not-integrated', 'Requires pressure/efficiency or variable-flow fan controls; the current supply fan is constant-volume W/CFM.'];
  if (/UserDefined/i.test(t)) return ['not-integrated', 'Requires user-supplied component physics and EMS/plugin programs; no universal performance curve exists.'];
  if (/HVACTemplate|AirLoopHVAC|ZoneHVAC|AirTerminal|CoilSystem|Unitary/i.test(t)) return ['not-integrated', 'Requires system topology, zone/terminal air paths, equipment sequencing and controls beyond the single-zone CAV screening system.'];
  return ['not-integrated', `Requires the ${o.group.toLowerCase()} component physics, operating inputs and controls absent from the current single-zone DX/furnace/resistance air path.`];
}

const inventory = dictionary.map(o => {
  const [status, reason] = scope(o);
  return { object_type: o.type, group: o.group, status, reason, selectable_profiles: profiles.filter(p => p.objectType === o.type).length, source_url: sourceUrl('Energy+.idd.in'), energyplus_version: VERSION, commit: COMMIT };
});
const equipment = objects.filter(o => equipmentGroups.has(o.schema.group)).map(o => {
  const profile = profiles.find(p => p.file === o.file && p.name === o.name && p.objectType === o.type);
  const [objectStatus, objectReason] = scope(o.schema);
  const status = profile ? 'adapted' : objectStatus === 'adapted' ? 'not-integrated' : objectStatus;
  return { dataset: o.file, equipment_type: o.type, equipment_name: o.name, status, reason: profile ? objectReason : profileIssues.get(o) ?? objectReason,
    profile_id: profile?.id ?? '', rated_capacity_W: profile?.capacityW ?? numeric(get(o, 'Gross Rated Total Cooling Capacity')) ?? numeric(get(o, 'Gross Rated Heating Capacity')) ?? '',
    rated_COP_W_W: profile?.cop ?? numeric(get(o, 'Gross Rated Cooling COP')) ?? numeric(get(o, 'Gross Rated Heating COP')) ?? '', rated_airflow_m3_s: profile?.airflowM3s ?? numeric(get(o, 'Rated Air Flow Rate')) ?? '', rated_SHR: profile?.shr ?? numeric(get(o, 'Gross Rated Sensible Heat Ratio')) ?? '',
    source_fields_json: JSON.stringify(fields(o)), source_url: sourceUrl(o.file), energyplus_version: VERSION, commit: COMMIT };
});
const association = {
  'Boilers.idf': 'Boiler:HotWater', 'Chillers.idf': 'Chiller', 'AirCooledChiller.idf': 'Chiller', 'ExhaustFiredChiller.idf': 'Chiller:Absorption',
  'CodeCompliantEquipment.idf': 'Chiller:Electric:EIR', 'RefrigerationCompressorCurves.idf': 'Refrigeration:Compressor', 'RefrigerationCasesDataSet.idf': 'Refrigeration',
  'WaterToAirHeatPumps.idf': 'Water-to-air heat pump', 'ElectricGenerators.idf': 'Generator', 'SolarCollectors.idf': 'SolarCollector',
  'ResidentialACsAndHPsPerfCurves.idf': 'Residential DX air conditioner / heat pump (curve-only library)',
  'ElectronicEnthalpyEconomizerCurves.idf': 'Controller:OutdoorAir', 'PerfCurves.idf': 'Generic performance curve library',
};
const rows = [];
for (const curve of curveObjects) {
  const data = fields(curve);
  const parents = references.get(`${curve.file}:${key(curve.name)}`) ?? [];
  for (const parent of parents.length ? parents : [null]) {
    const profile = parent && profiles.find(p => p.file === parent.file && p.name === parent.name && p.objectType === parent.type);
    const roles = parent ? parent.values.flatMap((v, i) => key(v) === key(curve.name) ? [parent.schema.fields[i]?.name ?? `field ${i + 1}`] : []).join('; ') : 'Unattached library curve; rating data/association must be supplied before simulation';
    const row = { dataset: curve.file, source_object_index: curve.objectIndex, equipment_type: parent?.type ?? association[curve.file] ?? 'Unattached curve', equipment_name: parent?.name ?? '',
      curve_type: curve.type, curve_name: curve.name, role: roles, integration_status: profile ? 'adapted' : 'export-only',
      reason: profile ? scope(parent.schema)[1] : parent ? profileIssues.get(parent) ?? scope(parent.schema)[1] : 'Curve library exported intact; no fully specified supported air-side equipment/rating association.',
      ...Object.fromEntries(Array.from({ length: 27 }, (_, i) => [`coefficient_${i + 1}`, ''])) };
    for (const [name, v] of Object.entries(data)) { const c = name.match(/^Coefficient(\d+)/i); if (c) row[`coefficient_${c[1]}`] = numeric(v) ?? v; }
    for (const axis of ['x', 'y', 'z', 'w', 'v', 'u']) {
      row[`${axis}_minimum`] = numeric(data[`Minimum Value of ${axis}`]) ?? '';
      row[`${axis}_maximum`] = numeric(data[`Maximum Value of ${axis}`]) ?? '';
      row[`${axis}_input_units`] = data[`Input Unit Type for ${axis.toUpperCase()}`] ?? '';
    }
    Object.assign(row, { output_minimum: numeric(data['Minimum Curve Output']) ?? '', output_maximum: numeric(data['Maximum Curve Output']) ?? '', output_units: data['Output Unit Type'] ?? '',
      curve_fields_json: JSON.stringify(data), source_url: sourceUrl(curve.file), energyplus_version: VERSION, commit: COMMIT, source_sha256: hashes.get(curve.file) });
    rows.push(row);
  }
}
// Equation-fit components store coefficients inside the equipment, not in Curve:*.
for (const o of objects.filter(o => !/^(Curve:|Table:)/i.test(o.type) && (o.schema.fields.some(f => /coefficient/i.test(f.name)) || /Performance:/i.test(o.type)))) {
  rows.push({ ...Object.fromEntries(Object.keys(rows[0]).map(k => [k, ''])), dataset: o.file, source_object_index: o.objectIndex, equipment_type: o.type, equipment_name: o.name,
    curve_type: 'Embedded equipment coefficients', curve_name: o.name, role: 'Complete equipment performance fields, including internal fit coefficients', integration_status: 'export-only',
    reason: scope(o.schema)[1], curve_fields_json: JSON.stringify(fields(o)), source_url: sourceUrl(o.file), energyplus_version: VERSION, commit: COMMIT, source_sha256: hashes.get(o.file) });
}

const excludedProfiles = [...profileIssues].map(([o, reason]) => ({ name: o.name, type: o.type, dataset: o.file, reason }));
const manifest = { version: VERSION, commit: COMMIT, retrieved: '2026-10-18', repository: 'https://github.com/NatLabRockies/EnergyPlus', excludedProfiles,
  release: `https://github.com/NatLabRockies/EnergyPlus/releases/tag/v${VERSION}`,
  scope: 'Complete object dictionary coverage; all curves, tables and embedded fit coefficients in the bundled equipment/performance datasets listed below. Does not claim to include all example-model, third-party or user-defined equipment coefficients.',
  counts: { dictionaryObjects: dictionary.length, equipmentTypes: inventory.filter(o => o.status !== 'not-equipment').length, profiles: profiles.length, heatingProfiles: profiles.filter(p => p.mode === 'heating').length, coolingProfiles: profiles.filter(p => p.mode === 'cooling').length, datasetEquipment: equipment.length, curveObjects: curveObjects.length, curveExportRows: rows.length },
  sources: ['Energy+.idd.in', ...files].map(file => ({ file, url: sourceUrl(file), sha256: hash(readFileSync(resolve(upstream, file))) })) };
mkdirSync(resolve(root, 'lib/data/energyplus'), { recursive: true }); mkdirSync(output, { recursive: true });
writeFileSync(resolve(root, 'lib/data/energyplus/catalog.json'), JSON.stringify({ version: VERSION, commit: COMMIT, profiles }, null, 2) + '\n');
writeFileSync(resolve(root, 'docs/energyplus/manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(resolve(root, 'lib/data/energyplus/coverage.json'), JSON.stringify({ counts: manifest.counts, excludedProfiles, equipmentTypes: inventory.filter(o => o.status !== 'not-equipment') }, null, 2) + '\n');

const require = createRequire(resolve(process.env.BEAST_ARTIFACT_NODE_MODULES ?? resolve(root, 'work/node_modules'), '../package.json'));
const { Workbook } = await import(pathToFileURL(require.resolve('@oai/artifact-tool')).href);
// Use small blocks to bound memory for a wide, machine-readable CSV export.
async function csvExport(name, records) {
  const header = Object.keys(records[0]), lines = [header];
  for (let start = 0; start < records.length; start += 500) {
    const block = records.slice(start, start + 500).map(row => header.map(k => row[k] ?? ''));
    const workbook = Workbook.create(), sheet = workbook.worksheets.add('Data');
    sheet.getRangeByIndexes(0, 0, block.length, header.length).values = block;
    workbook.recalculate();
    const values = sheet.getRangeByIndexes(0, 0, block.length, header.length).values;
    if (JSON.stringify(values) !== JSON.stringify(block)) throw new Error(`Artifact value roundtrip mismatch: ${name}, row ${start}`);
    lines.push(...values);
  }
  const quote = v => `"${String(v).replace(/"/g, '""')}"`;
  writeFileSync(resolve(output, name), '\ufeff' + lines.map(row => row.map(quote).join(',')).join('\r\n') + '\r\n');
}
await csvExport('energyplus-curve-fits.csv', rows);
await csvExport('energyplus-equipment.csv', equipment);
await csvExport('energyplus-coverage.csv', inventory);
console.log(JSON.stringify(manifest.counts, null, 2));
