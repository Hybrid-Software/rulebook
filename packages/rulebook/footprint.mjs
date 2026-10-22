/** The map lookup: changed files → areas → journeys and cases. Pure; ordering is stable. */

/** `**` crosses folders, `*` stays inside one name, `?` is one character; anything else is literal. */
export function globToRegExp(glob) {
  const pattern = glob.replace(/^\.\//, '') + (glob.endsWith('/') ? '**' : '');
  let source = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      i++;
      if (pattern[i + 1] === '/') { i++; source += '(?:.*/)?'; } else source += '.*';
    } else if (c === '*') source += '[^/]*';
    else if (c === '?') source += '[^/]';
    else source += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

const clean = file => String(file).replace(/^\.\//, '');
const matcher = globs => {
  const patterns = (globs ?? []).map(globToRegExp);
  return file => patterns.some(p => p.test(file));
};
export const matchesAny = (globs, file) => matcher(globs)(clean(file));

/**
 * Which areas a set of changed files touches, and which journeys and cases run through those areas.
 * A file under `.hybrid/` is listed in `hybridFiles` and never counts as unmapped.
 */
export function footprint(map, changedFiles, touched_ = []) {
  const files = [...new Set((changedFiles ?? []).map(clean))].sort();
  const areaMatchers = map.areas.map(area => {
    const yes = matcher(area.paths), no = matcher(area.not ?? []);
    return { id: area.id, matches: file => yes(file) && !no(file) };
  });
  const touched = new Set(touched_);
  const unmapped = [], hybridFiles = [], weightlessFiles = [];
  const weightless = new Set(map.areas.filter(a => a.weightless).map(a => a.id));
  for (const file of files) {
    const hits = areaMatchers.filter(area => area.matches(file));
    hits.forEach(area => touched.add(area.id));
    if (hits.length && hits.every(area => weightless.has(area.id))) weightlessFiles.push(file);
    if (file === '.hybrid' || file.startsWith('.hybrid/')) hybridFiles.push(file);
    else if (!hits.length && !touched_.length) unmapped.push(file);
    else if (!hits.length && !/\/(rules|entities|decisions|definitions|sources)\/|constitution\.md$/.test(file)) unmapped.push(file);
  }
  return {
    areas: [...map.areas.map(area => area.id).filter(id => touched.has(id)), ...[...touched].filter(id => !map.areas.some(a => a.id === id)).sort()],
    journeys: [...map.journeys, ...map.cases].filter(journey => journey.exercises.some(id => touched.has(id))),
    unmapped,
    hybridFiles,
    weightlessFiles,
  };
}

/** Whether a file only affects screens. A file listed as backend, or not listed at all, is backend. */
export function pathClass(recipe, file) {
  const path = clean(file);
  if (matcher(recipe?.paths?.backend)(path)) return 'backend';
  return matcher(recipe?.paths?.screens_only)(path) ? 'screens_only' : 'backend';
}

/** The results a rule's check reads. An "always" rule reads none. */
export function namedResults(rule) {
  const check = rule?.check ?? {};
  return [...new Set([
    ...(check.outcomes ?? []), ...(check.is_true ?? []), ...(check.unchanged ?? []),
    ...Object.keys(check.equals ?? {}), ...Object.keys(check.at_least ?? {}),
  ])];
}

/**
 * Everything that has to be run and looked up for a change. Filming and evaluation both use this, so
 * they always agree on the set.
 *
 * - `applicable`: the approved rules that are organisation-wide or apply to a touched area (or to a
 *   journey through one). Only the touched areas decide this.
 * - `journeys`: the journeys and cases through the touched areas first, then `added`: every other
 *   journey or case that declares a result an applicable rule names. A rule that applies is always
 *   measured, whether or not the journey that reports its result lists a touched area.
 * - `unmeasured`: results an applicable rule names that no journey or case in the map declares at all.
 */
export function checksFor({ map, rules = [], changedFiles = [], touched: extraTouched = [] }) {
  const fp = footprint(map, changedFiles, extraTouched);
  const inFootprint = new Set([...fp.areas, ...fp.journeys.map(journey => journey.id)]);
  const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : String(a.revision) < String(b.revision) ? -1 : String(a.revision) > String(b.revision) ? 1 : 0);
  const applicable = rules
    .filter(rule => rule.kind === 'rule' && rule.status === 'approved' && (rule.appliesTo.length === 0 || rule.appliesTo.some(id => inFootprint.has(id))))
    .sort(byId);
  const all = [...map.journeys, ...map.cases];
  const wanted = new Set();
  const unmeasured = [];
  for (const rule of applicable) {
    for (const name of namedResults(rule)) {
      const reporters = all.filter(journey => journey.outcomes.includes(name));
      if (!reporters.length) unmeasured.push({ ruleId: rule.id, title: rule.title, name });
      for (const journey of reporters) wanted.add(journey.id);
    }
  }
  const touched = new Set(fp.journeys.map(journey => journey.id));
  const added = all.filter(journey => wanted.has(journey.id) && !touched.has(journey.id));
  return { footprint: fp, applicable, journeys: [...fp.journeys, ...added], added, unmeasured };
}
