/** Pure graph reads. Registry and principal must come from trusted server code. */
export const LIMITS = Object.freeze({ links: 20, summaryCharacters: 600, totalCharacters: 6000 });
const PURPOSES = ['business', 'implementation', 'verification'];
const STATES = ['draft', 'approved', 'superseded'];
const key = (id, revision) => JSON.stringify([id, revision]);
const invalid = () => { throw new TypeError('Invalid record registry'); };
const isText = v => typeof v === 'string' && v.length > 0;
const strings = v => Array.isArray(v) && v.every(isText);
const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

export function createReader(input, authenticatedPrincipal) {
  // Snapshot inputs so later caller mutation cannot change grants or registry heads.
  const registry = structuredClone(input);
  const principal = structuredClone(authenticatedPrincipal ?? {});
  if (!isText(registry?.revision) || !Array.isArray(registry.nodes) || !Array.isArray(registry.links)) invalid();
  const nodes = new Map(), heads = new Map(), nodeScopes = new Map();
  for (const n of registry.nodes) {
    if (![n.id, n.revision, n.scope, n.kind, n.title, n.summary].every(isText)
      || !STATES.includes(n.status) || typeof n.current !== 'boolean'
      || !strings(n.audiences) || !n.audiences.length || n.audiences.some(p => !PURPOSES.includes(p))
      || !strings(n.requires) || !strings(n.sourceRefs)
      || !Array.isArray(n.missingContext) || !n.missingContext.every(isText)
      || !(n.asOf === null || (isText(n.asOf) && Number.isFinite(Date.parse(n.asOf))))) invalid();
    if (n.status !== 'draft' && (![n.ratifiedBy, n.ratifiedAt].every(isText)
      || !Number.isFinite(Date.parse(n.ratifiedAt)))) invalid();
    if ([n.owner, n.ratifiedBy, n.ratifiedAt].some(v => v != null && !isText(v))) invalid();
    if (n.current && n.status !== 'approved') invalid();
    if (nodeScopes.has(n.id) && nodeScopes.get(n.id) !== n.scope) invalid();
    nodeScopes.set(n.id, n.scope);
    if (nodes.has(key(n.id, n.revision))) invalid();
    nodes.set(key(n.id, n.revision), n);
    if (n.current) {
      if (heads.has(n.id)) invalid();
      heads.set(n.id, n);
    }
  }
  for (const n of registry.nodes) {
    const seen = new Set([n.revision]);
    let cursor = n;
    while (cursor.supersedes != null) {
      if (!isText(cursor.supersedes) || seen.has(cursor.supersedes)) invalid();
      seen.add(cursor.supersedes);
      cursor = nodes.get(key(n.id, cursor.supersedes));
      if (!cursor) invalid();
    }
  }
  const linkIds = new Set();
  for (const e of registry.links) {
    if (![e.id, e.scope, e.from, e.fromRevision, e.kind, e.to].every(isText)
      || !(e.toRevision === null || isText(e.toRevision))
      || !strings(e.requires) || !strings(e.audiences) || !e.audiences.length
      || e.audiences.some(p => !PURPOSES.includes(p)) || linkIds.has(e.id)) invalid();
    linkIds.add(e.id);
    const origin = nodes.get(key(e.from, e.fromRevision));
    if (!origin || origin.scope !== e.scope) invalid();
    // Unresolved destinations are allowed but must surface as missing context.
  }
  const capabilities = new Set(Array.isArray(principal.capabilities) ? principal.capabilities : []);
  const scopes = new Set(Array.isArray(principal.scopes) ? principal.scopes : []);
  const allowed = record => isText(principal.id) && capabilities.has('record:read')
    && scopes.has(record.scope) && record.requires.every(c => capabilities.has(c));
  const unavailable = () => ({ ok: false, error: 'context_unavailable' });
  const purposeAllowed = purpose => purpose === 'business' || capabilities.has('record:engineering');

  function read(id, options = {}, relation = null) {
    if (!isObject(options)) return { ok: false, error: 'invalid_options' };
    const purpose = options.purpose ?? 'business';
    const view = options.view ?? 'current';
    if (!PURPOSES.includes(purpose) || !['current', 'draft', 'history'].includes(view)
      || !purposeAllowed(purpose) || !isText(id)
      || (view !== 'current' && !isText(options.revision))
      || (view === 'current' && options.revision !== undefined)) return unavailable();
    if (view === 'draft' && !capabilities.has('record:drafts')) return unavailable();
    if (view === 'history' && !capabilities.has('record:history')) return unavailable();
    const root = view === 'current' ? heads.get(id) : nodes.get(key(id, options.revision));
    // Never fall back to an older readable revision if the current head is private.
    if (!root || !allowed(root) || !root.audiences.includes(purpose)
      || (view === 'draft' && root.status !== 'draft')
      || (view === 'history' && (root.current || root.status === 'draft'))) return unavailable();
    const limit = options.limit ?? LIMITS.links;
    const offset = options.offset ?? 0;
    if (!Number.isInteger(limit) || limit < 1 || limit > LIMITS.links
      || !Number.isSafeInteger(offset) || offset < 0) return { ok: false, error: 'invalid_page' };
    if (offset > 0 && options.registryRevision !== registry.revision)
      return { ok: false, error: 'registry_revision_required_or_changed' };
    let remaining = LIMITS.totalCharacters;
    const issues = [];
    function project(n, allocation = LIMITS.summaryCharacters) {
      const budget = Math.min(LIMITS.summaryCharacters, remaining, allocation);
      // Do not split a surrogate pair at the truncation boundary.
      const summary = n.summary.slice(0, budget).replace(/[\uD800-\uDBFF]$/, '');
      remaining -= summary.length;
      const summaryTruncated = summary.length < n.summary.length;
      if (summaryTruncated) issues.push({ code: 'summary_truncated', id: n.id, revision: n.revision });
      if (n.asOf === null) issues.push({ code: 'source_date_unknown', id: n.id, revision: n.revision });
      if (!n.sourceRefs.length) issues.push({ code: 'source_reference_missing', id: n.id, revision: n.revision });
      if (n.missingContext.length) issues.push({ code: 'declared_missing_context', id: n.id, details: [...n.missingContext] });
      return {
        id: n.id, revision: n.revision, kind: n.kind, title: n.title, summary,
        status: n.status, current: n.current, asOf: n.asOf,
        owner: n.owner ?? null, ratifiedBy: n.ratifiedBy ?? null, ratifiedAt: n.ratifiedAt ?? null,
        sourceRefs: [...n.sourceRefs], summaryTruncated,
      };
    }
    const item = project(root);
    // Permission and purpose filtering precede paging, counts and summary building.
    const eligible = [];
    for (const e of registry.links) {
      if (e.from !== root.id || e.fromRevision !== root.revision || !allowed(e)
        || !e.audiences.includes(purpose) || (relation && e.kind !== relation)) continue;
      if (view === 'history' && e.toRevision === null) {
        eligible.push({ kind: e.kind, missing: 'historical_dependency_unpinned' }); continue;
      }
      const target = e.toRevision === null ? heads.get(e.to) : nodes.get(key(e.to, e.toRevision));
      // Private/missing nodes are indistinguishable, including their identifiers.
      if (!target || !allowed(target)) { eligible.push({ kind: e.kind, missing: 'related_context_unavailable' }); continue; }
      if (!target.audiences.includes(purpose)) continue;
      if (target.status === 'draft') { eligible.push({ kind: e.kind, missing: 'related_context_unavailable' }); continue; }
      if (!target.current && (view !== 'history' || !capabilities.has('record:history'))) {
        eligible.push({ kind: e.kind, missing: 'dependency_not_current' }); continue;
      }
      eligible.push({ kind: e.kind, target });
    }
    if (offset > 0 && offset >= eligible.length) return { ok: false, error: 'invalid_page' };
    const page = eligible.slice(offset, offset + limit);
    let summariesLeft = page.filter(e => e.target).length;
    const links = page.map(e => {
      if (e.missing) { issues.push({ code: e.missing, relation: e.kind }); return { kind: e.kind, availability: 'unavailable' }; }
      const node = project(e.target, Math.floor(remaining / summariesLeft));
      summariesLeft--;
      return { kind: e.kind, availability: 'available', node };
    });
    const nextOffset = offset + page.length < eligible.length ? offset + page.length : null;
    if (nextOffset !== null) issues.push({ code: 'links_truncated' });
    return {
      ok: true, registryRevision: registry.revision, purpose, view, node: item, links,
      context: {
        completeness: issues.length ? 'partial' : 'complete',
        scope: 'authorized purpose-filtered outgoing links only; not the entire graph',
        permissionFiltered: true, depth: 1, issues,
      },
      pagination: { offset, limit, nextOffset, registryRevision: registry.revision },
      limits: LIMITS,
    };
  }
  return Object.freeze({
    anchor: (id, options) => read(id, options),
    hop: (id, relation, options) => isText(relation) ? read(id, options, relation) : unavailable(),
  });
}
