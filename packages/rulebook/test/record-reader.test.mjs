// Synthetic fixtures only. No vendor imports or network requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createReader } from '../retrieval.mjs';

const principal = { id: 'fixture-reader', scopes: ['fixture'], capabilities: ['record:read'] };
const node = (id, extra = {}) => ({
  id, revision: 'v1', scope: 'fixture', kind: 'definition', title: id,
  summary: 'Synthetic business context.', status: 'approved', current: true,
  audiences: ['business', 'implementation', 'verification'], requires: [],
  sourceRefs: ['fixture:spec'], asOf: '2026-09-28T00:00:00Z', missingContext: [],
  owner: 'fixture-owner', ratifiedBy: 'fixture-approver', ratifiedAt: '2026-09-28T00:00:00Z', ...extra,
});
const edge = (id, to, extra = {}) => ({
  id, scope: 'fixture', from: 'mrr', fromRevision: 'v1', kind: 'depends_on',
  to, toRevision: null, audiences: ['business', 'implementation', 'verification'], requires: [], ...extra,
});
const registry = (nodes, links = []) => ({ revision: 'fixture-r1', nodes, links });

test('approved head is default; drafts and historical roots require explicit grants and versions', () => {
  const r = registry([node('mrr'), node('mrr', { revision: 'v0', current: false, status: 'superseded' }),
    node('mrr', { revision: 'v2', current: false, status: 'draft', ratifiedAt: null, ratifiedBy: null })]);
  const reader = createReader(r, principal);
  assert.equal(reader.anchor('mrr').node.revision, 'v1');
  assert.equal(reader.anchor('mrr', { view: 'draft', revision: 'v2' }).ok, false);
  const reviewer = createReader(r, { ...principal, capabilities: [...principal.capabilities, 'record:history', 'record:drafts'] });
  assert.equal(reviewer.anchor('mrr', { view: 'draft', revision: 'v2' }).node.status, 'draft');
  assert.equal(reviewer.anchor('mrr', { view: 'history', revision: 'v0' }).node.current, false);
  assert.equal(reviewer.anchor('mrr', { view: 'history' }).ok, false);
});

test('anchor includes neighboring summaries and hop narrows the relation', () => {
  const reader = createReader(registry([node('mrr'), node('internal')], [edge('a', 'internal')]), principal);
  assert.equal(reader.anchor('mrr').links[0].node.summary, 'Synthetic business context.');
  assert.equal(reader.hop('mrr', 'verified_by').links.length, 0);
});

test('permissions cover roots, links and targets without private identifiers or fallback', () => {
  const r = registry([node('mrr'), node('secret', { requires: ['private'] }), node('old', { requires: ['private'] }),
    node('old', { revision: 'v0', current: false })], [edge('a', 'secret'), edge('b', 'secret', { requires: ['private'] })]);
  const reader = createReader(r, principal);
  assert.deepEqual(reader.anchor('secret'), reader.anchor('nonexistent'));
  assert.equal(reader.anchor('old').ok, false);
  assert.equal(createReader(r, { ...principal, scopes: [] }).anchor('mrr').ok, false);
  const answer = reader.anchor('mrr');
  assert.equal(answer.links.length, 1); // Only the authorized relationship is visible.
  assert.equal(answer.links[0].availability, 'unavailable');
  assert.equal(JSON.stringify(answer).includes('secret'), false);
  principal.scopes.push('other'); // No effect on an existing reader's grant snapshot.
  principal.scopes.pop();
});

test('private and absent targets give identical safe answers', () => {
  const privateRegistry = registry([node('mrr'), node('hidden', { requires: ['private'] })], [edge('a', 'hidden')]);
  const absentRegistry = registry([node('mrr')], [edge('a', 'hidden')]);
  assert.deepEqual(createReader(privateRegistry, principal).anchor('mrr'), createReader(absentRegistry, principal).anchor('mrr'));
});

test('engineering context requires explicit purpose and permission', () => {
  const r = registry([node('mrr'), node('checks', { audiences: ['verification'] })],
    [edge('a', 'checks', { kind: 'verified_by', audiences: ['verification'] })]);
  const reader = createReader(r, { ...principal, capabilities: ['record:read', 'record:engineering'] });
  assert.equal(reader.anchor('mrr').links.length, 0);
  assert.equal(reader.anchor('mrr', { purpose: 'verification' }).links[0].node.id, 'checks');
  assert.equal(createReader(r, principal).anchor('mrr', { purpose: 'verification' }).ok, false);
});

test('truncation, unknown dates and missing context are explicit; paging pins the registry', () => {
  const r = registry([node('mrr', { summary: 'x'.repeat(700), asOf: null, missingContext: ['iOS semantics unverified'] }), node('a'), node('b')],
    [edge('a', 'a'), edge('b', 'b'), edge('c', 'missing')]);
  const reader = createReader(r, principal), first = reader.anchor('mrr', { limit: 1 });
  assert.equal(first.node.summary.length, 600);
  assert.equal(first.context.completeness, 'partial');
  for (const code of ['summary_truncated', 'source_date_unknown', 'declared_missing_context', 'links_truncated'])
    assert.ok(first.context.issues.some(i => i.code === code));
  assert.equal(reader.anchor('mrr', { offset: 1 }).ok, false);
  const next = reader.anchor('mrr', { offset: 1, registryRevision: 'fixture-r1' });
  assert.equal(next.links[0].node.id, 'b');
  assert.equal(next.links[1].availability, 'unavailable');
});

test('a pinned historical dependency cannot silently substitute the current version', () => {
  const reader = createReader(registry([node('mrr'), node('rule'), node('rule', { revision: 'v0', current: false })],
    [edge('a', 'rule', { toRevision: 'v0' })]), principal);
  assert.equal(reader.anchor('mrr').links[0].availability, 'unavailable');
  assert.ok(reader.anchor('mrr').context.issues.some(i => i.code === 'dependency_not_current'));
});

test('conflicting heads and unapproved current records are rejected', () => {
  assert.throws(() => createReader(registry([node('mrr'), node('mrr', { revision: 'v2' })]), principal));
  assert.throws(() => createReader(registry([node('mrr', { status: 'draft' })]), principal));
});
