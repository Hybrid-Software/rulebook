/** Reads a product's `.hybrid/` folder: the recipe (app.yaml), the map (map.yaml) and the rule files. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

/** Every problem found in a `.hybrid/` file. `file` and `field` say where; the message names both. */
export class HybridFormatError extends Error {
  constructor(file, field, problem) {
    super(`${file}: "${field}" ${problem}`);
    this.name = 'HybridFormatError';
    this.file = file;
    this.field = field;
  }
}

export const OUTCOME_FORMATS = ['money', 'percent', 'number', 'yes_no', 'text'];
export const ENTRY_KINDS = ['rule', 'definition', 'decision', 'entity', 'source', 'constitution'];
export const ID_PREFIX = { rule: 'rule:', definition: 'definition:', decision: 'dec-', entity: 'entity:', source: 'source:', constitution: 'constitution:' };
const STATUSES = ['draft', 'approved', 'superseded'];
export const WHENS = ['always', 'outcome_changed', 'invariant', 'manual'];
const WHOLE = '(whole file)';

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const present = v => v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');
const show = v => (v === undefined ? 'nothing' : JSON.stringify(v));
const humanise = name => {
  const words = String(name).replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};
function fail(file, field, problem) {
  throw new HybridFormatError(file, field, problem);
}
function yamlObject(text, file, field = WHOLE) {
  let value;
  try {
    value = parseYaml(text);
  } catch (error) {
    fail(file, field, `could not be read as YAML: ${String(error.message).split('\n')[0]}`);
  }
  if (!isObject(value)) fail(file, field, 'must be a set of named settings, and it is empty or something else');
  return value;
}
function str(file, field, value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (!present(value) || !['string', 'number'].includes(typeof value)) fail(file, field, `is required and must be text; found ${show(value)}`);
  return String(value).trim();
}
const optStr = (file, field, value) => (present(value) ? str(file, field, value) : null);
function list(file, field, value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail(file, field, `must be a list; found ${show(value)}`);
  return value;
}
const textList = (file, field, value) => list(file, field, value).map((v, i) => str(file, `${field}[${i}]`, v));
function flag(file, field, value) {
  if (value === undefined || value === null) return false;
  if (typeof value !== 'boolean') fail(file, field, `must be true or false; found ${show(value)}`);
  return value;
}
function section(file, field, value) {
  if (value === undefined || value === null) return null;
  if (!isObject(value)) fail(file, field, `must be a set of named settings; found ${show(value)}`);
  return value;
}
function item(file, field, value) {
  if (!isObject(value)) fail(file, field, `must be a set of named settings; found ${show(value)}`);
  return value;
}

/** The recipe (`app.yaml`), with the file's own key names and every default filled in. */
export function parseRecipe(text, file = 'app.yaml') {
  const y = yamlObject(text, file);
  const product = str(file, 'product', y.product);
  const start = list(file, 'start', y.start).map((raw, i) => {
    const at = `start[${i}]`;
    const s = item(file, at, raw);
    return {
      name: str(file, `${at}.name`, s.name),
      run: str(file, `${at}.run`, s.run),
      port_env: str(file, `${at}.port_env`, s.port_env),
      ready: optStr(file, `${at}.ready`, s.ready) ?? '/',
      called_from_browser: flag(file, `${at}.called_from_browser`, s.called_from_browser),
      address_env: optStr(file, `${at}.address_env`, s.address_env),
      preview: flag(file, `${at}.preview`, s.preview),
    };
  });
  if (!start.length) fail(file, 'start', 'needs at least one process to run');
  start.forEach((s, i) => {
    if (start.findIndex(other => other.name === s.name) !== i) fail(file, `start[${i}].name`, `repeats the name ${show(s.name)}; each process needs its own name`);
  });
  const previews = start.filter(s => s.preview).length;
  if (previews !== 1) fail(file, 'start', `needs exactly one process marked "preview: true" (the one a person looks at); found ${previews}`);

  const testData = section(file, 'test_data', y.test_data);
  const signIn = section(file, 'sign_in', y.sign_in);
  const paths = section(file, 'paths', y.paths) ?? {};
  const copies = section(file, 'copies', y.copies) ?? {};
  return {
    product,
    prepare: textList(file, 'prepare', y.prepare),
    start,
    env: section(file, 'env', y.env) ?? {},
    test_data: testData && {
      seed_version: testData.seed_version ?? null,
      load: optStr(file, 'test_data.load', testData.load),
      reset: optStr(file, 'test_data.reset', testData.reset),
    },
    accounts: list(file, 'accounts', y.accounts).map((raw, i) => {
      const at = `accounts[${i}]`;
      const a = item(file, at, raw);
      const login = section(file, `${at}.login`, a.login) ?? {};
      return {
        id: str(file, `${at}.id`, a.id),
        shows: optStr(file, `${at}.shows`, a.shows) ?? '',
        login: { email: optStr(file, `${at}.login.email`, login.email), password: optStr(file, `${at}.login.password`, login.password) },
      };
    }),
    sign_in: signIn && {
      path: optStr(file, 'sign_in.path', signIn.path),
      email_field: optStr(file, 'sign_in.email_field', signIn.email_field),
      password_field: optStr(file, 'sign_in.password_field', signIn.password_field),
      submit: optStr(file, 'sign_in.submit', signIn.submit),
    },
    paths: {
      screens_only: textList(file, 'paths.screens_only', paths.screens_only),
      backend: textList(file, 'paths.backend', paths.backend),
    },
    local_addresses: list(file, 'local_addresses', y.local_addresses),
    copies: {
      per_sandbox: optStr(file, 'copies.per_sandbox', copies.per_sandbox) ?? 'many',
      draft_view_backend: optStr(file, 'copies.draft_view_backend', copies.draft_view_backend) ?? 'local',
    },
    environments: section(file, 'environments', y.environments) ?? {},
  };
}

/** The map (`map.yaml`): areas and their files, journeys, cases, and optional labels for outcomes. */
export function parseMap(text, file = 'map.yaml') {
  const y = yamlObject(text, file);
  const seen = new Set();
  const identity = (field, value, prefix) => {
    const id = str(file, field, value);
    if (!id.startsWith(prefix) || id.length === prefix.length) fail(file, field, `must start with "${prefix}"; found ${show(id)}`);
    if (seen.has(id)) fail(file, field, `repeats the id ${show(id)}; each id may be used once`);
    seen.add(id);
    return id;
  };
  const areas = list(file, 'areas', y.areas).map((raw, i) => {
    const at = `areas[${i}]`;
    const a = item(file, at, raw);
    const id = identity(`${at}.id`, a.id, 'area:');
    return { id, title: optStr(file, `${at}.title`, a.title) ?? humanise(id.slice(5)), paths: textList(file, `${at}.paths`, a.paths), not: textList(file, `${at}.not`, a.not), weightless: flag(file, `${at}.weightless`, a.weightless) };
  });
  const areaIds = new Set(areas.map(a => a.id));
  const exercises = (field, value) => {
    const ids = textList(file, field, value);
    for (const id of ids) if (!areaIds.has(id)) fail(file, field, `names ${show(id)}, which is not an area in this map`);
    return ids;
  };
  const journeys = list(file, 'journeys', y.journeys).map((raw, i) => {
    const at = `journeys[${i}]`;
    const j = item(file, at, raw);
    const id = identity(`${at}.id`, j.id, 'journey:');
    return {
      id, kind: 'journey',
      title: optStr(file, `${at}.title`, j.title) ?? humanise(id.slice(8)),
      flow: str(file, `${at}.flow`, j.flow),
      account: optStr(file, `${at}.account`, j.account),
      exercises: exercises(`${at}.exercises`, j.exercises),
      outcomes: textList(file, `${at}.outcomes`, j.outcomes),
    };
  });
  const cases = list(file, 'cases', y.cases).map((raw, i) => {
    const at = `cases[${i}]`;
    const c = item(file, at, raw);
    const id = identity(`${at}.id`, c.id, 'case:');
    return {
      id, kind: 'case',
      title: optStr(file, `${at}.title`, c.title) ?? humanise(id.slice(5)),
      script: str(file, `${at}.script`, c.script),
      exercises: exercises(`${at}.exercises`, c.exercises),
      outcomes: textList(file, `${at}.outcomes`, c.outcomes),
    };
  });
  const outcomeLabels = {};
  for (const [name, raw] of Object.entries(section(file, 'outcomes', y.outcomes) ?? {})) {
    const at = `outcomes.${name}`;
    const o = item(file, at, raw);
    const format = optStr(file, `${at}.format`, o.format) ?? 'text';
    if (!OUTCOME_FORMATS.includes(format)) fail(file, `${at}.format`, `must be one of ${OUTCOME_FORMATS.join(', ')}; found ${show(format)}`);
    outcomeLabels[name] = { label: optStr(file, `${at}.label`, o.label) ?? humanise(name), format };
  }
  const limits = section(file, 'limits', y.limits) ?? {};
  for (const [k, v] of Object.entries(limits)) if (!['areas', 'files'].includes(k) || typeof v !== 'number') fail(file, `limits.${k}`, 'must be "areas" or "files" with a number');
  const defaults = section(file, 'defaults', y.defaults) ?? {};
  const uncovered = optStr(file, 'defaults.uncovered', defaults.uncovered) ?? 'require';
  if (!['require', 'allow'].includes(uncovered)) fail(file, 'defaults.uncovered', `must be "require" (an engineer looks at anything no rule covers) or "allow"; found ${show(uncovered)}`);
  return { areas, journeys, cases, outcomeLabels, limits, defaults: { uncovered } };
}

function parseCheck(file, raw) {
  if (!isObject(raw)) fail(file, 'check', 'is required for a rule: it says when the rule fires (always, outcome_changed or invariant)');
  if (!WHENS.includes(raw.when)) fail(file, 'check.when', `must be one of ${WHENS.join(', ')}; found ${show(raw.when)}`);
  const check = { when: raw.when };
  if (present(raw.uses)) check.uses = textList(file, 'check.uses', Array.isArray(raw.uses) ? raw.uses : [raw.uses]);
  if (raw.when === 'manual') {
    check.question = str(file, 'check.question', raw.question);
  }
  if (raw.when === 'outcome_changed') {
    check.outcomes = textList(file, 'check.outcomes', raw.outcomes);
    if (!check.outcomes.length) fail(file, 'check.outcomes', 'must list at least one outcome to watch');
  }
  if (raw.when === 'invariant') {
    if (present(raw.unchanged)) check.unchanged = textList(file, 'check.unchanged', raw.unchanged);
    if (present(raw.is_true)) check.is_true = textList(file, 'check.is_true', raw.is_true);
    if (present(raw.equals)) check.equals = { ...item(file, 'check.equals', raw.equals) };
    if (present(raw.at_least)) {
      check.at_least = { ...item(file, 'check.at_least', raw.at_least) };
      for (const [name, value] of Object.entries(check.at_least))
        if (typeof value !== 'number') fail(file, `check.at_least.${name}`, `must be a number; found ${show(value)}`);
    }
    if (present(raw.unless_declared)) check.unless_declared = flag(file, 'check.unless_declared', raw.unless_declared);
    if (!['unchanged', 'is_true', 'equals', 'at_least'].some(k => k in check)) fail(file, 'check', 'needs at least one condition for an invariant: unchanged, is_true, equals or at_least');
  }
  return check;
}

function parseEffect(file, raw) {
  if (!isObject(raw)) fail(file, 'effect', 'is required for a rule: "allow: true", "require" with a list of roles, or "block: true"');
  const effect = {};
  if (raw.allow !== undefined && raw.allow !== null) {
    if (raw.allow !== true) fail(file, 'effect.allow', `can only be true; found ${show(raw.allow)}`);
    effect.allow = true;
  }
  if (present(raw.reason)) effect.reason = str(file, 'effect.reason', raw.reason);
  if (present(raw.require)) {
    effect.require = textList(file, 'effect.require', raw.require);
    if (!effect.require.length) fail(file, 'effect.require', 'must list at least one role');
  }
  if (raw.block !== undefined && raw.block !== null) {
    if (raw.block !== true) fail(file, 'effect.block', `can only be true; found ${show(raw.block)}`);
    effect.block = true;
  }
  if (!['allow', 'require', 'block'].some(k => k in effect)) fail(file, 'effect', 'must have "allow: true", "require" with a list of roles, or "block: true"');
  if (effect.allow && (effect.block || effect.require)) fail(file, 'effect', 'cannot both allow and require or block');
  return effect;
}

/** One entry of any kind: Markdown with a YAML header. The body is the statement people read. */
export function parseEntry(text, file) {
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/.exec(String(text).replace(/^\uFEFF/, '').trimStart());
  if (!match) fail(file, '(header)', 'is missing: the file must start with a header between two lines of ---');
  const y = yamlObject(match[1], file, '(header)');
  const kind = str(file, 'kind', y.kind);
  if (!ENTRY_KINDS.includes(kind)) fail(file, 'kind', `must be one of ${ENTRY_KINDS.join(', ')}; found ${show(kind)}`);
  const id = str(file, 'id', y.id);
  const prefix = ID_PREFIX[kind];
  if (!id.startsWith(prefix) || id.length === prefix.length) fail(file, 'id', `must start with "${prefix}" because the kind is ${kind}; found ${show(id)}`);
  const status = str(file, 'status', y.status);
  if (!STATUSES.includes(status)) fail(file, 'status', `must be one of ${STATUSES.join(', ')}; found ${show(status)}`);
  const statement = (match[2] ?? '').trim();
  if (!statement) fail(file, 'statement', 'is empty: write the statement people read under the header');
  const ratified = (field, value) => (status === 'draft' ? optStr(file, field, value) : str(file, field, value));
  const people = (field, value) => (Array.isArray(value) ? textList(file, field, value) : present(value) ? [str(file, field, value)] : []);
  let check = null, effect = null, scope = null;
  if (present(y.scope) && (kind === 'rule' || kind === 'entity')) {
    const sc = item(file, 'scope', y.scope);
    scope = { paths: textList(file, 'scope.paths', sc.paths), not: textList(file, 'scope.not', sc.not) };
    if (!scope.paths.length) fail(file, 'scope.paths', 'must list at least one path when scope is given');
  } else if (present(y.scope)) fail(file, 'scope', `is only for rules and entities; a ${kind} cannot have one`);
  if (kind === 'rule') {
    check = parseCheck(file, y.check);
    effect = parseEffect(file, y.effect);
  } else {
    for (const field of ['check', 'effect'])
      if (present(y[field])) fail(file, field, `is only for rules; a ${kind} cannot have one`);
  }
  let corrects = null;
  if (present(y.corrects)) {
    const c = item(file, 'corrects', y.corrects);
    corrects = { what: str(file, 'corrects.what', c.what), heldBy: people('corrects.held_by', c.held_by ?? c.heldBy), falsifiedBy: str(file, 'corrects.falsified_by', c.falsified_by ?? c.falsifiedBy) };
  }
  const standing = optStr(file, 'standing', y.standing);
  if (standing && !['explicit', 'derived', 'working'].includes(standing)) fail(file, 'standing', `must be explicit, derived or working; found ${show(standing)}`);
  const title = optStr(file, 'title', y.title) ?? (/^#\s+(.+)$/m.exec(statement)?.[1]?.trim() ?? null);
  if (!title) fail(file, 'title', 'is required: give the entry a title in the header or a # heading in the body');
  return {
    id, kind,
    revision: str(file, 'revision', y.revision),
    status, title, statement,
    owner: optStr(file, 'owner', y.owner),
    ratifiedBy: status === 'draft' ? people('ratifiedBy', y.ratifiedBy) : (people('ratifiedBy', y.ratifiedBy).length ? people('ratifiedBy', y.ratifiedBy) : fail(file, 'ratifiedBy', 'is required unless the entry is a draft')),
    ratifiedAt: ratified('ratifiedAt', y.ratifiedAt),
    asOf: optStr(file, 'asOf', y.asOf),
    appliesTo: textList(file, 'applies_to', y.applies_to ?? y.appliesTo),
    dependsOn: textList(file, 'depends_on', y.depends_on ?? y.dependsOn),
    related: textList(file, 'related', y.related),
    sourceRefs: textList(file, 'sourceRefs', y.sourceRefs),
    replaces: optStr(file, 'replaces', y.replaces),
    supersedes: optStr(file, 'supersedes', y.supersedes),
    corrects, standing,
    type: optStr(file, 'type', y.type),
    state: optStr(file, 'state', y.state),
    weightless: flag(file, 'weightless', y.weightless),
    sameAs: textList(file, 'same_as', Array.isArray(y.same_as) ? y.same_as : present(y.same_as) ? [y.same_as] : []),
    scope, check, effect, file,
  };
}
/** Kept for callers that only know rule files. */
export const parseRuleFile = parseEntry;

/**
 * The whole `.hybrid` folder from its files' text, wherever they came from (the code host, or disk).
 * `files` maps each path relative to the `.hybrid` folder (`app.yaml`, `rules/pricing.md`, …) to its text.
 * `journeyVersions` maps each journey and case id to the sha256 of its flow or script file.
 */
export function parseHybridFiles(files) {
  const texts = new Map(Object.entries(files ?? {}).map(([path, text]) => [path.replace(/^\.\//, ''), text]));
  const need = name => (typeof texts.get(name) === 'string' ? texts.get(name) : fail(name, WHOLE, 'is missing from the .hybrid folder'));
  const recipe = typeof texts.get('app.yaml') === 'string' ? parseRecipe(texts.get('app.yaml'), 'app.yaml') : null;
  const map = typeof texts.get('map.yaml') === 'string' ? parseMap(texts.get('map.yaml'), 'map.yaml') : parseMap('areas: []', 'map.yaml');
  const ENTRY_DIRS = /^(rules|definitions|decisions|entities)\/[^/]+\.md$/;
  const rules = [...texts.keys()].filter(path => ENTRY_DIRS.test(path) || path === 'constitution.md').sort()
    .map(path => parseEntry(texts.get(path), path));
  // An entity with paths is an area: the thing rules attach to and a change can touch. map.yaml areas are
  // the short form of the same thing. A rule with its own scope.paths defines one too, so rules can exist first.
  for (const e of rules) {
    if (e.kind !== 'entity' || !e.scope) continue;
    map.areas.push({ id: e.id, title: e.title, paths: e.scope.paths, not: e.scope.not, weightless: e.weightless === true, entity: true });
  }
  for (const rule of rules) {
    if (rule.kind !== 'rule' || !rule.scope) continue;
    const id = `area:${rule.id.slice(5)}`;
    map.areas.push({ id, title: rule.title, paths: rule.scope.paths, not: rule.scope.not, virtual: true });
    if (!rule.appliesTo.includes(id)) rule.appliesTo.push(id);
  }

  const approved = new Map();
  for (const rule of rules) {
    if (rule.status !== 'approved') continue;
    if (approved.has(rule.id)) fail(rule.file, 'id', `repeats ${show(rule.id)}, which ${approved.get(rule.id)} already has as an approved entry; only one approved version may exist`);
    approved.set(rule.id, rule.file);
  }
  const mapIds = new Set([...map.areas, ...map.journeys, ...map.cases].map(entry => entry.id));
  const entityIds = new Set(rules.filter(e => e.kind === 'entity').map(e => e.id));
  for (const rule of rules)
    for (const target of rule.appliesTo)
      if (rule.kind === 'rule' && /^(area|journey|case):/.test(target) && !mapIds.has(target))
        fail(rule.file, 'applies_to', `names ${show(target)}, which is not an area, journey or case in map.yaml`);
      else if (rule.kind === 'rule' && target.startsWith('entity:') && !entityIds.has(target) && !mapIds.has(target))
        fail(rule.file, 'applies_to', `names ${show(target)}, which is not an entity in this folder`);
  const accountIds = new Set((recipe?.accounts ?? []).map(a => a.id));
  map.journeys.forEach((journey, i) => {
    if (journey.account && !accountIds.has(journey.account))
      fail('map.yaml', `journeys[${i}].account`, `names ${show(journey.account)}, which is not a test account in app.yaml`);
  });

  const journeyVersions = {};
  const fingerprint = (id, field, path) => {
    const text = texts.get(path.replace(/^\.\//, ''));
    if (typeof text !== 'string') fail('map.yaml', field, `names the file ${show(path)}, which is not in the .hybrid folder`);
    journeyVersions[id] = createHash('sha256').update(text).digest('hex');
  };
  map.journeys.forEach((journey, i) => fingerprint(journey.id, `journeys[${i}].flow`, journey.flow));
  map.cases.forEach((entry, i) => fingerprint(entry.id, `cases[${i}].script`, entry.script));
  return { recipe, map, rules, journeyVersions };
}

/** Reads a `.hybrid` folder from disk and hands its files to `parseHybridFiles`. Errors name files relative to that folder. */
export function readHybridFolder(dir) {
  const files = {};
  const take = path => {
    const full = join(dir, path);
    if (existsSync(full) && statSync(full).isFile()) files[path] = readFileSync(full, 'utf8');
  };
  take('app.yaml');
  take('map.yaml');
  take('constitution.md');
  for (const sub of ['rules', 'definitions', 'decisions', 'entities'])
    if (existsSync(join(dir, sub)))
      for (const name of readdirSync(join(dir, sub))) if (name.endsWith('.md') && !name.startsWith('_')) take(`${sub}/${name}`);
  if (files['map.yaml'] !== undefined) {
    const map = parseMap(files['map.yaml'], 'map.yaml');
    for (const path of [...map.journeys.map(journey => journey.flow), ...map.cases.map(entry => entry.script)]) take(path.replace(/^\.\//, ''));
  }
  return parseHybridFiles(files);
}

/** An outcome value as a person reads it. Returns null (not a string) when there is no value. */
export function formatOutcome(value, format) {
  if (value === null || value === undefined) return null;
  if (format === 'yes_no' || typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (format === 'money' && typeof value === 'number') {
    const amount = Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${value < 0 ? '-' : ''}$${amount}`;
  }
  if (format === 'percent') return `${value}%`;
  if (format === 'number' && typeof value === 'number') return value.toLocaleString('en-US');
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** The label a person sees for an outcome: the map's label, or the name made readable. */
export function outcomeLabel(map, name) {
  return map?.outcomeLabels?.[name]?.label ?? humanise(name);
}

/** A short plain-text account of the approved rules, definitions and decisions, for a coding agent's context. */
export function rulebookSummary({ rules = [], map }) {
  const titles = new Map([...(map?.areas ?? []), ...(map?.journeys ?? []), ...(map?.cases ?? [])].map(entry => [entry.id, entry.title]));
  const current = rules.filter(rule => rule.status === 'approved').sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const lines = ['Approved rules and definitions for this product. Keep to them when changing the code.'];
  const groups = [['rule', 'Rules'], ['definition', 'Definitions'], ['decision', 'Decisions']];
  for (const [kind, heading] of groups) {
    const entries = current.filter(rule => rule.kind === kind);
    if (!entries.length) continue;
    lines.push('', `${heading}:`);
    for (const entry of entries) {
      lines.push(`- ${entry.title} (${entry.id}, ${entry.revision})`);
      lines.push(`  ${entry.statement.replace(/\s*\n\s*/g, ' ')}`);
      if (kind !== 'rule') continue;
      lines.push(`  Applies to: ${entry.appliesTo.length ? entry.appliesTo.map(id => `${titles.get(id) ?? id} (${id})`).join(', ') : 'every change'}`);
      const effects = [];
      if (entry.effect?.block) effects.push('the change is blocked');
      if (entry.effect?.require) effects.push(`approval is needed from ${entry.effect.require.join(', ')}`);
      const when = { always: 'on any change there', outcome_changed: `when ${entry.check.outcomes?.join(' or ')} changes`, invariant: 'when its conditions are not met' }[entry.check.when];
      lines.push(`  Effect: ${effects.join(' and ')}, ${when}.`);
    }
  }
  if (lines.length === 1) lines.push('', 'There are no approved rules yet.');
  return lines.join('\n');
}
