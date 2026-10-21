// Made-up fixtures only. The twelve acceptance cases of RULEBOOK_ARCHITECTURE section 10, one test each.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readHybridFolder, evaluate, checkApproval, checksFor } from '../index.mjs';

const { map, rules, journeyVersions, recipe } = readHybridFolder(fileURLToPath(new URL('./fixtures/demo-checkout/.hybrid', import.meta.url)));
const seedVersion = recipe.test_data.seed_version;
const NEW = 'journey:new-subscriber-checkout', EXISTING = 'journey:existing-subscriber-checkout', QUOTE = 'case:new-subscriber-quote';
const PM = 'role:pm', ENGINEER = 'role:engineer';

const run = (tree, journeyId, outcomes) => ({
  id: `evidence:${tree}:${journeyId}`, tree, journeyId, journeyVersion: journeyVersions[journeyId], seedVersion, outcomes,
  complete: true, flaky: false, tier: 'full', ranIn: 'sandbox:fixture', recordedAt: '2026-10-05T10:00:00Z',
});
/** Full evidence for all three journeys on one code state. */
const filmed = (tree, { newTotal = 90, existingTotal = 120 } = {}) => [
  run(tree, NEW, { new_subscriber_total: newTotal, checkout_completed: true }),
  run(tree, EXISTING, { existing_subscriber_total: existingTotal, checkout_completed: true }),
  run(tree, QUOTE, { new_subscriber_total: newTotal }),
];
const approval = (role, versionId = 'version:1', extra = {}) =>
  ({ id: `approval:${versionId}:${role}`, versionId, personId: `person:fixture-${role}`, actorKind: 'person', role, decision: 'approve', ...extra });
const adjust = (evidence, journeyId, tree, change) => evidence.map(item => (item.journeyId === journeyId && item.tree === tree ? { ...item, ...change } : item));
const codes = verdict => verdict.reasons.map(reason => reason.code);

const version = { id: 'version:1', baseTree: 'tree:base', headTree: 'tree:head' };
const shared = { version, map, rules, journeyVersions, seedVersion, mode: 'gate' };
const buttonChange = { ...shared, changedFiles: ['web/src/checkout/PayButton.tsx'], evidence: [...filmed('tree:base'), ...filmed('tree:head')] };
const discountChange = { ...shared, changedFiles: ['api/checkout/discount.js'], evidence: [...filmed('tree:base'), ...filmed('tree:head', { newTotal: 85 })] };

test('Button text changes; both totals unchanged; PM has approved → allow', () => {
  const verdict = evaluate({ ...buttonChange, approvals: [approval(PM)] });
  assert.equal(verdict.result, 'allow');
  assert.equal(verdict.preliminary, false);
  assert.deepEqual(verdict.requiredRoles, [PM]);
  assert.deepEqual(verdict.outstandingRoles, []);
  assert.deepEqual(verdict.ruleResults.map(r => [r.ruleId, r.fired, r.effect]), [
    ['rule:checkout-change-needs-pm', true, 'require'], ['rule:checkout-stays-safe', false, 'none'], ['rule:pricing-change-needs-engineer', false, 'none']]);
  assert.equal(verdict.outcomes.length, 5);
  assert.ok(verdict.outcomes.every(outcome => outcome.changed === false));
  assert.equal(verdict.evidenceIds.length, 6);
  assert.deepEqual(verdict.footprint, { areas: ['area:checkout'], journeyIds: [NEW, EXISTING, QUOTE], unmapped: [], hybridFiles: [] });
});

test('Same, PM has not approved → hold, waiting on PM', () => {
  const verdict = evaluate({ ...buttonChange, approvals: [] });
  assert.equal(verdict.result, 'hold');
  assert.deepEqual(verdict.outstandingRoles, [PM]);
  assert.deepEqual(codes(verdict), ['approval_needed']);
  assert.equal(verdict.reasons[0].text, 'Waiting for approval from the PM: the rule "Any change to checkout needs the PM" requires it.');
});

test('Discount changes; new-subscriber total 90 → 85; only PM approved → hold, waiting on engineer', () => {
  const verdict = evaluate({ ...discountChange, approvals: [approval(PM)] });
  assert.equal(verdict.result, 'hold');
  assert.deepEqual(verdict.requiredRoles, [ENGINEER, PM]);
  assert.deepEqual(verdict.outstandingRoles, [ENGINEER]);
  assert.deepEqual(verdict.outcomes.find(o => o.journeyId === NEW && o.name === 'new_subscriber_total'),
    { journeyId: NEW, name: 'new_subscriber_total', before: 90, after: 85, changed: true });
});

test('Same, PM and engineer approved this version → allow', () => {
  const verdict = evaluate({ ...discountChange, approvals: [approval(PM), approval(ENGINEER)] });
  assert.equal(verdict.result, 'allow');
  assert.deepEqual(verdict.outstandingRoles, []);
});

test('Same, then a new commit → the new version holds; earlier approvals do not count', () => {
  const next = { id: 'version:2', baseTree: 'tree:base', headTree: 'tree:head-2' };
  const verdict = evaluate({ ...discountChange, version: next, evidence: [...discountChange.evidence, ...filmed('tree:head-2', { newTotal: 85 })],
    approvals: [approval(PM), approval(ENGINEER)] });
  assert.equal(verdict.versionId, 'version:2');
  assert.equal(verdict.result, 'hold');
  assert.deepEqual(verdict.outstandingRoles, [ENGINEER, PM]);
});

test('Existing-subscriber total changes → block, whoever has approved', () => {
  const verdict = evaluate({ ...discountChange, evidence: [...filmed('tree:base'), ...filmed('tree:head', { existingTotal: 110 })],
    approvals: [approval(PM), approval(ENGINEER)] });
  assert.equal(verdict.result, 'block');
  assert.deepEqual(verdict.reasons, [{ code: 'rule_blocks', ruleId: 'rule:checkout-stays-safe', journeyId: EXISTING,
    text: 'Blocked by the rule "Checkout must keep working and existing prices must not move". In "An existing subscriber checks out", existing subscriber\'s total went from $120.00 to $110.00 and must not change.' }]);
});

test('A changed file is in no area → hold, engineer required', () => {
  const verdict = evaluate({ ...buttonChange, changedFiles: [...buttonChange.changedFiles, 'scripts/tool.js'], approvals: [approval(PM)] });
  assert.equal(verdict.result, 'hold');
  assert.deepEqual(verdict.footprint.unmapped, ['scripts/tool.js']);
  assert.deepEqual(verdict.outstandingRoles, [ENGINEER]);
  assert.equal(verdict.reasons[0].code, 'unmapped_file');
  assert.equal(verdict.reasons[0].file, 'scripts/tool.js');
});

test('Evidence missing, incomplete or flaky for a mapped journey → hold, engineer required', () => {
  const variants = {
    evidence_missing: buttonChange.evidence.filter(item => !(item.journeyId === EXISTING && item.tree === 'tree:head')),
    evidence_incomplete: adjust(buttonChange.evidence, EXISTING, 'tree:head', { complete: false, outcomes: { checkout_completed: true } }),
    evidence_flaky: adjust(buttonChange.evidence, EXISTING, 'tree:base', { flaky: true }),
  };
  for (const [code, evidence] of Object.entries(variants)) {
    const verdict = evaluate({ ...buttonChange, evidence, approvals: [approval(PM)] });
    assert.equal(verdict.result, 'hold', code);
    assert.deepEqual(verdict.outstandingRoles, [ENGINEER], code);
    assert.deepEqual(verdict.reasons.filter(reason => reason.code !== 'approval_needed').map(reason => [reason.code, reason.journeyId]), [[code, EXISTING]]);
  }
});

test('Evidence is from a quick check only → hold', () => {
  const evidence = adjust(buttonChange.evidence, NEW, 'tree:head', { tier: 'quick' });
  const gate = evaluate({ ...buttonChange, evidence, approvals: [approval(PM)] });
  assert.equal(gate.result, 'hold');
  assert.deepEqual(codes(gate), ['evidence_not_full']);
  assert.deepEqual(gate.outstandingRoles, []);
  const preview = evaluate({ ...buttonChange, evidence, approvals: [approval(PM)], mode: 'preview' });
  assert.equal(preview.result, 'allow');
  assert.equal(preview.preliminary, true);
});

test('An agent records an approval → rejected', () => {
  assert.deepEqual(checkApproval({ actor: { kind: 'agent', roles: [PM] }, role: PM }).code, 'not_a_person');
  assert.equal(checkApproval({ actor: { kind: 'service', roles: [PM] }, role: PM }).ok, false);
  const verdict = evaluate({ ...buttonChange, approvals: [approval(PM, 'version:1', { actorKind: 'agent' })] });
  assert.equal(verdict.result, 'hold');
  assert.deepEqual(verdict.outstandingRoles, [PM]);
});

test('A PM approves where the engineer role is required → recorded, and does not satisfy the engineer requirement', () => {
  const pm = { kind: 'person', roles: [PM] };
  assert.deepEqual(checkApproval({ actor: pm, role: PM }), { ok: true });
  assert.equal(checkApproval({ actor: pm, role: ENGINEER }).code, 'role_not_held');
  const second = approval(PM, 'version:1', { id: 'approval:second-pm', personId: 'person:fixture-second-pm' });
  const verdict = evaluate({ ...discountChange, approvals: [approval(PM), second] });
  assert.equal(verdict.result, 'hold');
  assert.deepEqual(verdict.outstandingRoles, [ENGINEER]);
});

test('The same inputs evaluated twice → identical results', () => {
  const input = { ...discountChange, changedFiles: [...discountChange.changedFiles, 'scripts/tool.js', '.hybrid/map.yaml'], approvals: [approval(PM), approval(ENGINEER)] };
  const first = evaluate(input);
  assert.equal(JSON.stringify(evaluate(input)), JSON.stringify(first));
  const reordered = { ...input, changedFiles: [...input.changedFiles].reverse(), rules: [...rules].reverse(),
    evidence: [...input.evidence].reverse(), approvals: [...input.approvals].reverse() };
  assert.equal(JSON.stringify(evaluate(reordered)), JSON.stringify(first));
});

// An engineer's approval clears the holds that ask for an engineer (decision D47).
const unmappedChange = { ...buttonChange, changedFiles: ['web/src/checkout/PayButton.tsx', 'docs/notes.md'] };

test('A changed file is in no area; the PM and an engineer approve this version → allow', () => {
  const verdict = evaluate({ ...unmappedChange, approvals: [approval(PM), approval(ENGINEER)] });
  assert.equal(verdict.result, 'allow');
  assert.deepEqual(verdict.outstandingRoles, []);
  assert.deepEqual(verdict.holds.map(hold => [hold.code, hold.cleared]), [['unmapped_file', true]]);
});

test('Same, with only the PM\'s approval → hold, still waiting on the engineer', () => {
  const verdict = evaluate({ ...unmappedChange, approvals: [approval(PM)] });
  assert.equal(verdict.result, 'hold');
  assert.deepEqual(verdict.outstandingRoles, [ENGINEER]);
  assert.ok(codes(verdict).includes('unmapped_file'));
});

test('Same, then a new version → hold again; the earlier approvals do not count', () => {
  const next = { id: 'version:2', baseTree: 'tree:base', headTree: 'tree:head-2' };
  const verdict = evaluate({ ...unmappedChange, version: next, evidence: [...unmappedChange.evidence, ...filmed('tree:head-2')],
    approvals: [approval(PM), approval(ENGINEER)] });
  assert.equal(verdict.result, 'hold');
  assert.deepEqual(verdict.outstandingRoles, [ENGINEER, PM]);
  assert.deepEqual(verdict.holds.map(hold => hold.cleared), [false]);
});

test('Missing or flaky evidence is cleared by an engineer\'s approval, and not by the PM\'s alone', () => {
  const flaky = { ...buttonChange, evidence: adjust(buttonChange.evidence, NEW, 'tree:head', { flaky: true }) };
  assert.equal(evaluate({ ...flaky, approvals: [approval(PM)] }).result, 'hold');
  assert.equal(evaluate({ ...flaky, approvals: [approval(PM), approval(ENGINEER)] }).result, 'allow');
  const missing = { ...buttonChange, evidence: buttonChange.evidence.filter(item => !(item.journeyId === NEW && item.tree === 'tree:head')) };
  assert.equal(evaluate({ ...missing, approvals: [approval(PM), approval(ENGINEER)] }).result, 'allow');
});

test('Only a quick check so far; an engineer approves → still hold, until the full check finishes', () => {
  const quick = { ...buttonChange, evidence: buttonChange.evidence.map(item => ({ ...item, tier: 'quick' })) };
  const verdict = evaluate({ ...quick, approvals: [approval(PM), approval(ENGINEER)] });
  assert.equal(verdict.result, 'hold');
  assert.deepEqual(verdict.outstandingRoles, []);
  assert.ok(codes(verdict).every(code => code === 'evidence_not_full'));
});

test('A fired block still blocks, whatever an engineer approves', () => {
  const verdict = evaluate({ ...shared, changedFiles: ['api/checkout/discount.js', 'docs/notes.md'],
    evidence: [...filmed('tree:base'), ...filmed('tree:head', { existingTotal: 100 })], approvals: [approval(PM), approval(ENGINEER)] });
  assert.equal(verdict.result, 'block');
});

// A rule that applies to a change is always measured (decision D48).
const twoAreas = {
  areas: [{ id: 'area:a', title: 'Area A', paths: ['a/**'] }, { id: 'area:b', title: 'Area B', paths: ['b/**'] }],
  journeys: [{ id: 'journey:through-b', kind: 'journey', title: 'Someone uses B', flow: 'journeys/b.flow.ts', exercises: ['area:b'], outcomes: ['b_works'] }],
  cases: [{ id: 'case:thing', kind: 'case', title: 'The thing is checked', script: 'cases/thing.mjs', exercises: ['area:a'], outcomes: ['thing_holds'] }],
  outcomeLabels: {},
};
const rule = (id, appliesTo, check) => ({
  id, kind: 'rule', revision: 'v1', status: 'approved', title: `Rule ${id}`, statement: 'A made-up rule.', appliesTo, dependsOn: [], check, effect: { require: [ENGINEER] },
});
const thingRule = rule('rule:thing-must-hold', ['area:a', 'area:b'], { when: 'outcome_changed', outcomes: ['thing_holds'] });
const ran = (tree, journeyId, outcomes) => ({ id: `evidence:${tree}:${journeyId}`, tree, journeyId, journeyVersion: 'v', seedVersion: 1, outcomes,
  complete: true, flaky: false, tier: 'full', ranIn: 'sandbox:fixture', recordedAt: '2026-10-05T10:00:00Z' });
const onlyB = { version, map: twoAreas, rules: [thingRule], changedFiles: ['b/screen.js'], mode: 'gate' };

test('A case runs for area A only and a rule applies to A and B; a change touching only B still runs the case, after the journeys through B', () => {
  const checks = checksFor(onlyB);
  assert.deepEqual(checks.footprint.journeys.map(journey => journey.id), ['journey:through-b']);
  assert.deepEqual(checks.journeys.map(journey => journey.id), ['journey:through-b', 'case:thing']);
  assert.deepEqual(checks.added.map(journey => journey.id), ['case:thing']);
  assert.deepEqual(checks.unmeasured, []);
});

test('Same, and the rule fires when the case\'s result changes', () => {
  const evidence = [ran('tree:base', 'journey:through-b', { b_works: true }), ran('tree:head', 'journey:through-b', { b_works: true }),
    ran('tree:base', 'case:thing', { thing_holds: true }), ran('tree:head', 'case:thing', { thing_holds: false })];
  const verdict = evaluate({ ...onlyB, evidence, approvals: [] });
  assert.equal(verdict.result, 'hold');
  assert.deepEqual(verdict.ruleResults.map(r => [r.ruleId, r.fired]), [['rule:thing-must-hold', true]]);
  assert.deepEqual(verdict.outstandingRoles, [ENGINEER]);
  assert.deepEqual(verdict.addedJourneyIds, ['case:thing']);
  assert.equal(evaluate({ ...onlyB, evidence, approvals: [approval(ENGINEER)] }).result, 'allow');
  // Without the case's evidence the change holds on missing evidence: evaluation expects exactly what filming is asked to run.
  const unfilmed = evaluate({ ...onlyB, evidence: evidence.filter(item => item.journeyId !== 'case:thing'), approvals: [] });
  assert.ok(codes(unfilmed).includes('evidence_missing'));
});

test('The added journeys supply measurements; they do not make more rules applicable', () => {
  const onlyForA = rule('rule:only-for-a', ['area:a'], { when: 'always' });
  const checks = checksFor({ ...onlyB, rules: [thingRule, onlyForA] });
  assert.deepEqual(checks.applicable.map(r => r.id), ['rule:thing-must-hold']);
});

test('An applicable rule names a result that nothing in the map reports → hold for the engineer, naming the rule and the result', () => {
  const blind = rule('rule:needs-a-missing-result', ['area:b'], { when: 'outcome_changed', outcomes: ['nothing_reports_this'] });
  const evidence = [ran('tree:base', 'journey:through-b', { b_works: true }), ran('tree:head', 'journey:through-b', { b_works: true })];
  const verdict = evaluate({ ...onlyB, rules: [blind], evidence, approvals: [] });
  assert.equal(verdict.result, 'hold');
  assert.deepEqual(verdict.outstandingRoles, [ENGINEER]);
  const reason = verdict.reasons.find(r => r.code === 'rule_unmeasured');
  assert.equal(reason.ruleId, 'rule:needs-a-missing-result');
  assert.match(reason.text, /Rule rule:needs-a-missing-result.*Nothing reports this/);
  // An engineer's approval of this version clears it, like the other holds that ask for an engineer.
  assert.equal(evaluate({ ...onlyB, rules: [blind], evidence, approvals: [approval(ENGINEER)] }).result, 'allow');
});
