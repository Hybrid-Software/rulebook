// The format additions (FORMAT.md §4c): allow, uncovered areas, manual questions, declares, size limits, scope.paths, new kinds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEntry, parseHybridFiles, evaluate, HybridFormatError } from '../index.mjs';

const header = (fields) => `---\n${Object.entries(fields).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join('\n')}\n---\nBody.\n`;
const approvedRule = (id, extra) => header({ id: `rule:${id}`, kind: 'rule', revision: 'v1', status: 'approved', title: id, owner: 'person:maya', ratifiedBy: 'person:maya', ratifiedAt: '2026-10-20', asOf: '2026-10-20', ...extra });
const map = `
areas:
  - { id: area:copy, paths: ["web/copy/**"] }
  - { id: area:billing, paths: ["api/billing/**"] }
  - { id: area:ui, paths: ["web/src/**"] }
limits: { areas: 2, files: 5 }
`;
const version = { id: 'version:1', baseTree: 'tree:base', headTree: 'tree:head' };
const folder = (rules, extraMap = '') => parseHybridFiles({ 'map.yaml': map + extraMap, ...rules });
const verdict = (files, rules, extra = {}) => { const { map: m, rules: r } = folder(rules, extra.map ?? ''); return evaluate({ version, changedFiles: files, map: m, rules: r, mode: extra.mode ?? 'gate', declares: extra.declares, approvals: extra.approvals ?? [] }); };

test('an area no rule covers goes to an engineer by default', () => {
  const v = verdict(['web/src/Home.tsx'], {});
  assert.equal(v.result, 'hold');
  assert.deepEqual(v.outstandingRoles, ['role:engineer']);
  assert.ok(v.reasons.some(r => r.code === 'area_uncovered'));
});

test('an approved allow rule lets its area ship alone', () => {
  const v = verdict(['web/src/Home.tsx'], { 'rules/ui-ships.md': approvedRule('ui-ships', { applies_to: ['area:ui'], check: { when: 'always' }, effect: { allow: true } }) });
  assert.equal(v.result, 'allow');
  assert.deepEqual(v.ruleResults.map(r => [r.ruleId, r.effect]), [['rule:ui-ships', 'allow']]);
});

test('defaults.uncovered: allow restores the old behaviour', () => {
  const v = verdict(['web/src/Home.tsx'], {}, { map: 'defaults: { uncovered: allow }\n' });
  assert.equal(v.result, 'allow');
});

test('a require rule beats an allow rule on the same change', () => {
  const v = verdict(['web/src/Home.tsx', 'api/billing/stripe.ts'], {
    'rules/ui-ships.md': approvedRule('ui-ships', { applies_to: ['area:ui'], check: { when: 'always' }, effect: { allow: true } }),
    'rules/billing.md': approvedRule('billing-needs-maya', { applies_to: ['area:billing'], check: { when: 'always' }, effect: { require: ['person:maya'] } }),
  });
  assert.equal(v.result, 'hold');
  assert.deepEqual(v.outstandingRoles, ['person:maya']);
});

test('a manual rule asks its question until the owner answers', () => {
  const rules = { 'rules/dry-run.md': approvedRule('data-repair-dry-run', { applies_to: ['area:billing'], check: { when: 'manual', question: 'Was a dry-run attached?' }, effect: { require: ['person:maya'] } }) };
  const asked = verdict(['api/billing/backfill.ts'], rules);
  assert.equal(asked.result, 'hold');
  assert.deepEqual(asked.reasons.find(r => r.code === 'approval_needed').questions, ['Was a dry-run attached?']);
  const answered = verdict(['api/billing/backfill.ts'], rules, { declares: { answers: { 'rule:data-repair-dry-run': 'yes, output attached' } } });
  assert.equal(answered.ruleResults[0].fired, false);
});

test('too many areas or files holds for a split until the parts are declared', () => {
  const rules = {
    'rules/ui-ships.md': approvedRule('ui-ships', { applies_to: ['area:ui'], check: { when: 'always' }, effect: { allow: true } }),
    'rules/copy-ships.md': approvedRule('copy-ships', { applies_to: ['area:copy'], check: { when: 'always' }, effect: { allow: true } }),
    'rules/billing-ships.md': approvedRule('billing-ships', { applies_to: ['area:billing'], check: { when: 'always' }, effect: { allow: true } }),
  };
  const files = ['web/src/a.tsx', 'web/copy/b.md', 'api/billing/c.ts'];
  assert.equal(verdict(files, rules).result, 'split');
  assert.equal(verdict(files, rules, { declares: { changes: ['new home layout', 'copy fix', 'webhook retry'] } }).result, 'allow');
});

test('scope.paths on a rule makes an area the map does not have', () => {
  const { map: m, rules: r } = folder({ 'rules/migrations.md': approvedRule('migrations-need-an-engineer', { scope: { paths: ['db/migrations/**'], not: ['db/migrations/README.md'] }, check: { when: 'always' }, effect: { require: ['role:engineer'] } }) });
  assert.ok(m.areas.some(a => a.id === 'area:migrations-need-an-engineer' && a.virtual));
  const v = evaluate({ version, changedFiles: ['db/migrations/0042_add_index.sql'], map: m, rules: r });
  assert.deepEqual(v.outstandingRoles, ['role:engineer']);
  const readme = evaluate({ version, changedFiles: ['db/migrations/README.md'], map: m, rules: r });
  assert.ok(readme.reasons.some(x => x.code === 'unmapped_file'));
});

test('entities, sources, decisions with corrects, and a constitution parse; rules cannot carry corrects-free nonsense', () => {
  const e = parseEntry(header({ id: 'entity:acme', kind: 'entity', revision: 'v1', status: 'approved', title: 'Acme', owner: 'person:maya', ratifiedBy: 'person:maya', ratifiedAt: '2026-10-20', asOf: '2026-10-20', type: 'customer', state: 'trial' }), 'entities/acme.md');
  assert.equal(e.type, 'customer');
  const d = parseEntry(header({ id: 'dec-2026-10-20-x', kind: 'decision', revision: 'v1', status: 'approved', title: 'X', owner: 'person:maya', ratifiedBy: ['person:maya', 'person:lee'], ratifiedAt: '2026-10-20', asOf: '2026-10-20', replaces: 'dec-2026-10-01-y', corrects: { what: 'we said y', held_by: ['person:maya'], falsified_by: 'the numbers' }, standing: 'explicit' }), 'decisions/x.md');
  assert.deepEqual(d.ratifiedBy, ['person:maya', 'person:lee']);
  assert.equal(d.corrects.falsifiedBy, 'the numbers');
  const c = parseEntry(header({ id: 'constitution:acme', kind: 'constitution', revision: 'v3', status: 'approved', title: 'Acme', owner: 'person:maya', ratifiedBy: 'person:maya', ratifiedAt: '2026-10-20', asOf: '2026-10-20' }), 'constitution.md');
  assert.equal(c.kind, 'constitution');
  assert.throws(() => parseEntry(header({ id: 'entity:acme', kind: 'entity', revision: 'v1', status: 'approved', title: 'Acme', owner: 'person:maya', ratifiedBy: 'person:maya', ratifiedAt: '2026-10-20', asOf: '2026-10-20', effect: { allow: true } }), 'entities/acme.md'), HybridFormatError);
  const draft = parseEntry(header({ id: 'rule:x', kind: 'rule', revision: 'v1', status: 'draft', title: 'x', owner: 'person:maya', asOf: '2026-10-20', check: { when: 'always' }, effect: { allow: true } }), 'rules/x.md');
  assert.deepEqual(draft.ratifiedBy, []);
});

test('replay reports journeys it could not run instead of holding on them', () => {
  const extra = `
journeys:
  - { id: journey:home, title: Home, flow: journeys/home.spec.ts, exercises: [area:ui], outcomes: [home_total] }
`;
  const { map: m, rules: r } = parseHybridFiles({ 'map.yaml': map + extra, 'journeys/home.spec.ts': '// flow',
    'rules/numbers.md': approvedRule('numbers-unchanged', { applies_to: ['area:ui'], check: { when: 'invariant', unchanged: ['home_total'] }, effect: { block: true } }),
    'rules/ui-ships.md': approvedRule('ui-ships', { applies_to: ['area:ui'], check: { when: 'always' }, effect: { allow: true } }) });
  const v = evaluate({ version, changedFiles: ['web/src/Home.tsx'], map: m, rules: r, mode: 'replay' });
  assert.equal(v.result, 'allow');
  assert.deepEqual(v.notRun, ['journey:home']);
});
