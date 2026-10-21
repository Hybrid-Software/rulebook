// Made-up fixtures only. Reads the fixture `.hybrid/` folder and checks the map lookup.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  HybridFormatError, readHybridFolder, parseHybridFiles, parseRecipe, parseMap, parseRuleFile,
  formatOutcome, outcomeLabel, rulebookSummary, footprint, pathClass,
} from '../index.mjs';

const folder = fileURLToPath(new URL('./fixtures/demo-checkout/.hybrid', import.meta.url));

test('the fixture .hybrid folder parses', () => {
  const { recipe, map, rules, journeyVersions } = readHybridFolder(folder);
  assert.equal(recipe.product, 'demo-checkout');
  assert.deepEqual(recipe.start.map(s => [s.name, s.ready, s.called_from_browser, s.address_env, s.preview]),
    [['api', '/health', true, 'PUBLIC_API_URL', false], ['web', '/', false, null, true]]);
  assert.deepEqual(recipe.copies, { per_sandbox: 'many', draft_view_backend: 'local' });
  assert.equal(recipe.test_data.seed_version, 3);
  assert.deepEqual(map.journeys.map(j => j.kind), ['journey', 'journey']);
  assert.equal(map.cases[0].script, 'cases/new-subscriber-quote.mjs');
  assert.deepEqual(map.outcomeLabels.checkout_completed, { label: 'Checkout completed', format: 'yes_no' });
  assert.equal(rules.length, 4);
  const pricing = rules.find(r => r.id === 'rule:pricing-change-needs-engineer');
  assert.deepEqual(pricing.check, { when: 'outcome_changed', outcomes: ['new_subscriber_total', 'existing_subscriber_total'] });
  assert.deepEqual(pricing.effect, { require: ['role:pm', 'role:engineer'] });
  assert.deepEqual(pricing.appliesTo, ['area:checkout']);
  assert.equal(pricing.file, 'rules/pricing-change-needs-engineer.md');
  assert.equal(rules.find(r => r.kind === 'definition').check, null);
  assert.deepEqual(Object.keys(journeyVersions).sort(), ['case:new-subscriber-quote', 'journey:existing-subscriber-checkout', 'journey:new-subscriber-checkout']);
  assert.match(journeyVersions['case:new-subscriber-quote'], /^[0-9a-f]{64}$/);

  // The same folder given as { path: text }, the way the server receives it from the code host.
  const files = Object.fromEntries(['app.yaml', 'map.yaml', ...rules.map(r => r.file), ...map.journeys.map(j => j.flow), map.cases[0].script]
    .map(path => [path, readFileSync(`${folder}/${path}`, 'utf8')]));
  assert.deepEqual(parseHybridFiles(files), { recipe, map, rules, journeyVersions });
  const { [map.journeys[0].flow]: removed, ...withoutFlow } = files;
  assert.throws(() => parseHybridFiles(withoutFlow), error => error instanceof HybridFormatError && error.file === 'map.yaml'
    && error.field === 'journeys[0].flow' && error.message.includes(map.journeys[0].flow));

  assert.equal(formatOutcome(90, 'money'), '$90.00');
  assert.equal(formatOutcome(false), 'No');
  assert.equal(formatOutcome(15, 'percent'), '15%');
  assert.equal(formatOutcome(undefined, 'money'), null);
  assert.equal(outcomeLabel(map, 'new_subscriber_total'), "New subscriber's total");
  assert.equal(outcomeLabel({ outcomeLabels: {} }, 'new_subscriber_total'), 'New subscriber total');
  assert.equal(pathClass(recipe, 'web/src/checkout/PayButton.tsx'), 'screens_only');
  assert.equal(pathClass(recipe, 'scripts/tool.js'), 'backend');
  const summary = rulebookSummary({ rules, map });
  assert.ok(summary.includes('Any change to checkout needs the PM') && summary.includes('Checkout (area:checkout)') && summary.includes('Existing subscriber'));
});

test('one bad file of each format gives an error naming the file and the field', () => {
  const problem = (run, file, field) => assert.throws(run, error =>
    error instanceof HybridFormatError && error.file === file && error.field === field
    && error.message.includes(file) && error.message.includes(field));
  problem(() => parseRecipe('product: demo-checkout\nstart:\n  - name: web\n    run: npm run web\n    preview: true\n'), 'app.yaml', 'start[0].port_env');
  problem(() => parseMap('areas:\n  - id: area:checkout\n    paths: ["web/**"]\njourneys:\n  - id: journey:pay\n    flow: journeys/pay.spec.ts\n    exercises: [area:billing]\n'),
    'map.yaml', 'journeys[0].exercises');
  problem(() => parseRuleFile('---\nid: rule:made-up\nkind: rule\nrevision: v1\nstatus: draft\ntitle: A made-up rule\ncheck:\n  when: sometimes\neffect:\n  block: true\n---\nA made-up statement.\n', 'rules/made-up.md'),
    'rules/made-up.md', 'check.when');
});

test('footprint finds areas, journeys, unmapped files and .hybrid files', () => {
  const { map } = readHybridFolder(folder);
  const found = footprint(map, ['web/src/checkout/PayButton.tsx', 'scripts/tool.js', '.hybrid/map.yaml', 'api/checkout.js']);
  assert.deepEqual(found.areas, ['area:checkout']);
  assert.deepEqual(found.journeys.map(j => j.id), ['journey:new-subscriber-checkout', 'journey:existing-subscriber-checkout', 'case:new-subscriber-quote']);
  assert.deepEqual(found.unmapped, ['api/checkout.js', 'scripts/tool.js']);
  assert.deepEqual(found.hybridFiles, ['.hybrid/map.yaml']);
});
