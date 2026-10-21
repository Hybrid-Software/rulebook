import { createReader } from './retrieval.mjs';
import { digest, refKey, text, strings, dated, requireValue as check } from './identity.mjs';

export const POLICY_KINDS = ['rule', 'definition', 'decision'];
export const APPLICABILITY = ['applies_to', 'rules_for'];
export const IMPACT = [...APPLICABILITY, 'depends_on', 'governs', 'code_for', 'exercises', 'in_area'];
export const LINK_KINDS = [...IMPACT, 'mentions', 'supersedes', 'owned_by', 'approved_by', 'same_as'];
export const headOf = (registry, id) => registry.nodes.find(n => n.id === id && n.current && n.status === 'approved');

/** Additional publication checks around the unchanged Record reader. */
export function validateRegistry(registry) {
  createReader(registry, {});
  const nodes = new Map(registry.nodes.map(n => [refKey(n.id, n.revision), n]));
  const byId = new Map();
  for (const n of registry.nodes) {
    check(['rule', 'definition', 'decision', 'entity', 'action', 'source'].includes(n.kind), 'Unsupported local record kind');
    check(text(n.owner) && dated(n.asOf) && n.sourceRefs.length > 0, 'Record needs owner, date and provenance');
    const versions = byId.get(n.id) ?? []; versions.push(n); byId.set(n.id, versions);
    if (n.supersedes != null) {
      const old = nodes.get(refKey(n.id, n.supersedes));
      check(old && Date.parse(n.asOf) >= Date.parse(old.asOf), 'Supersession must preserve chronological history');
      if (n.status !== 'draft') check(old.status === 'superseded' && !old.current, 'Approved replacement must supersede its predecessor');
    }
  }
  for (const versions of byId.values()) {
    const published = versions.filter(n => n.status !== 'draft');
    if (!published.length) continue;
    const heads = published.filter(n => n.current);
    check(heads.length === 1 && heads[0].status === 'approved', 'Published identity needs one current approved head');
    const chain = new Set(); let cursor = heads[0];
    while (cursor) { chain.add(cursor.revision); cursor = cursor.supersedes == null ? null : nodes.get(refKey(cursor.id, cursor.supersedes)); }
    check(published.every(n => chain.has(n.revision)), 'Disconnected or forked approved history');
  }
  for (const e of registry.links) {
    check(LINK_KINDS.includes(e.kind), 'Unsupported typed link');
    check(['confirmed', 'inferred', 'suspect'].includes(e.trust) && dated(e.asOf)
      && strings(e.sourceRefs) && e.sourceRefs.length > 0, 'Link needs trust, date and provenance');
  }
  return registry;
}

/** Content-derived identity also detects same-revision edits; publication hosts must forbid them. */
export function registryRevision(nodes, links) {
  return digest({ nodes: [...nodes].sort((a, b) => refKey(a.id, a.revision).localeCompare(refKey(b.id, b.revision))),
    links: [...links].sort((a, b) => a.id.localeCompare(b.id)) });
}
