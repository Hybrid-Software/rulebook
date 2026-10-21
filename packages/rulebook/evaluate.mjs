/**
 * Rule evaluation (RULEBOOK_ARCHITECTURE section 5) as one pure function.
 * No clock, no randomness, no I/O: the same inputs always give the same result, whatever order they arrive in.
 */
import { checksFor } from './footprint.mjs';
import { formatOutcome, outcomeLabel } from './hybrid-files.mjs';

const order = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const reported = (outcomes, name) => outcomes != null && Object.hasOwn(outcomes, name) && outcomes[name] !== null && outcomes[name] !== undefined;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const when = value => {
  const time = typeof value === 'number' ? value : Date.parse(value ?? '');
  return Number.isFinite(time) ? time : -Infinity;
};
const SIDES = { before: 'as it was before this change', after: 'with this change' };

function areaTitle(map, id) { return map.areas.find(a => a.id === id)?.title ?? id; }
function roleName(role) {
  const words = String(role).replace(/^role:/, '').replace(/[-_]+/g, ' ');
  return `the ${words.length <= 3 ? words.toUpperCase() : words}`;
}
function joinWords(parts) {
  return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

/** Prefer full verification, then the latest recording, then the highest id. */
function best(candidates) {
  return [...candidates].sort((a, b) =>
    order(b.tier === 'full' ? 1 : 0, a.tier === 'full' ? 1 : 0) || order(when(b.recordedAt), when(a.recordedAt)) || order(String(b.id), String(a.id)))[0] ?? null;
}

export function evaluate({
  version, changedFiles = [], map, rules = [], evidence = [], approvals = [],
  journeyVersions, seedVersion, mode = 'gate', engineerRole = 'role:engineer',
  declares = {}, tools = {},
}) {
  // `tools` maps a rule id to the result of its check.uses command: 'pass' | 'fail' | 'not_run'.
  if (!['gate', 'preview', 'replay'].includes(mode)) throw new TypeError('mode must be "gate", "preview" or "replay"');
  // `declares` is what the change says about itself: { outcomes: [names it moves on purpose], changes: [parts of a bundle], answers: { ruleId: text } }.
  const declaredOutcomes = new Set(declares.outcomes ?? []);
  const declaredParts = Array.isArray(declares.changes) ? declares.changes : [];
  const answers = declares.answers ?? {};
  const show = (name, value) => formatOutcome(value, map.outcomeLabels?.[name]?.format) ?? 'nothing';

  // 1 · Footprint, and 2 · applicable rules: approved rules that are organisation-wide or apply to something
  // in the footprint. A rule that applies is always measured, so the journeys to look at are those through
  // the touched areas plus any other that reports a result an applicable rule names.
  const checks = checksFor({ map, rules, changedFiles });
  const { footprint: fp, applicable } = checks;

  // 3 · Evidence for each footprint journey, Before and After, and the built-in holds.
  // A hold that asks for an engineer is cleared by an engineer's approval of this exact version.
  // "Only a quick check so far" asks for nobody and is cleared only by the full check finishing.
  const holds = [];
  let engineerNeeded = false;
  let splitNeeded = false;
  const hold = (reason, needsEngineer, kind) => { holds.push({ ...reason, needsEngineer }); if (needsEngineer) engineerNeeded = true; if (kind === 'split') splitNeeded = true; };
  for (const file of fp.unmapped)
    hold({ code: 'unmapped_file', file, text: `The file ${file} is not part of any area on the map, so an engineer needs to look at this change.` }, true);
  for (const file of fp.hybridFiles)
    hold({ code: 'hybrid_file_changed', file, text: `This change edits ${file}, which is part of the product's Hybrid setup, so an engineer needs to look at it.` }, true);

  // An area ships alone only when an approved rule with "allow" covers it. Uncovered areas go to an engineer,
  // unless the map says defaults.uncovered: allow.
  const allowed = new Set(applicable.filter(rule => rule.effect?.allow).flatMap(rule => rule.appliesTo));
  const anyAllowAll = applicable.some(rule => rule.effect?.allow && rule.appliesTo.length === 0);
  const uncovered = (map.defaults?.uncovered ?? 'require') === 'require' && !anyAllowAll
    ? fp.areas.filter(id => !allowed.has(id) && !applicable.some(rule => !rule.effect?.allow && rule.appliesTo.includes(id)))
    : [];
  for (const id of uncovered)
    hold({ code: 'area_uncovered', areaId: id, text: `No rule says changes to ${areaTitle(map, id)} can ship on their own, so an engineer needs to look at this change.` }, true);

  // Too much in one change: hold until the parts are declared.
  const limits = map.limits ?? {};
  const weighty = fp.areas.filter(id => { const a = map.areas.find(x => x.id === id); return a && !a.weightless && !a.virtual; });
  const weightyFiles = changedFiles.filter(f => !fp.weightlessFiles?.includes(f));
  const tooMany = (limits.areas && weighty.length > limits.areas) || (limits.files && weightyFiles.length > limits.files);
  if (tooMany && !declaredParts.length)
    hold({ code: 'too_large', text: `This change touches ${weighty.length} areas and ${weightyFiles.length} files, more than the Rulebook judges as one change. Split it, or declare its parts.` }, true, 'split');

  for (const { ruleId, title, name } of checks.unmeasured)
    hold({ code: 'rule_unmeasured', ruleId, text: `The rule "${title}" depends on "${outcomeLabel(map, name)}", which no journey or case reports, so it cannot be measured and an engineer needs to look at this change.` }, true);

  const counts = (item, journey, tree) => item.journeyId === journey.id && item.tree === tree
    && (journeyVersions?.[journey.id] == null || item.journeyVersion === journeyVersions[journey.id])
    && (seedVersion == null || String(item.seedVersion) === String(seedVersion));
  const notRun = new Set();
  const notRunTools = [];
  const runs = checks.journeys.map(journey => {
    const run = { journey, before: null, after: null };
    for (const [side, tree] of [['before', version.baseTree], ['after', version.headTree]]) {
      const matching = evidence.filter(item => counts(item, journey, tree));
      const chosen = best(mode === 'gate' ? matching.filter(item => item.tier === 'full') : matching);
      run[side] = chosen;
      const where = `"${journey.title}" on the app ${SIDES[side]}`;
      if (!chosen && matching.length)
        hold({ code: 'evidence_not_full', journeyId: journey.id, text: `There is only a quick check of ${where}; the full check has to run before this change can go ahead.` }, false);
      else if (!chosen && mode === 'replay')
        notRun.add(journey.id);
      else if (!chosen)
        hold({ code: 'evidence_missing', journeyId: journey.id, text: `There is no result for ${where}, so an engineer needs to look at it.` }, true);
      else if (!chosen.complete)
        hold({ code: 'evidence_incomplete', journeyId: journey.id, text: `The run of ${where} did not report everything it should, so an engineer needs to look at it.` }, true);
      else if (chosen.flaky)
        hold({ code: 'evidence_flaky', journeyId: journey.id, text: `The run of ${where} gave different results when repeated, so an engineer needs to look at it.` }, true);
    }
    return run;
  });

  // 4 · Outcomes side by side, then each rule's check.
  const outcomes = [];
  for (const { journey, before, after } of runs) {
    if (!before && !after) continue;
    const extra = [...new Set([...Object.keys(before?.outcomes ?? {}), ...Object.keys(after?.outcomes ?? {})])].filter(name => !journey.outcomes.includes(name)).sort();
    for (const name of [...journey.outcomes, ...extra]) {
      const hasBefore = reported(before?.outcomes, name), hasAfter = reported(after?.outcomes, name);
      const was = hasBefore ? before.outcomes[name] : null, is = hasAfter ? after.outcomes[name] : null;
      outcomes.push({ journeyId: journey.id, name, before: was, after: is, changed: hasBefore && hasAfter && !same(was, is) });
    }
  }

  const blocks = [];
  const requiredBy = new Map(); // role → titles of the fired rules that require it
  const ruleResults = applicable.map(rule => {
    const { check, effect } = rule;
    const failures = [];
    let fired = false;
    let toolState = null;
    if (check.when === 'always' && check.uses) {
      toolState = tools[rule.id] ?? 'not_run';
      if (toolState === 'not_run') { notRunTools.push(rule.id); fired = false; }
      else fired = toolState === 'fail';
    } else if (check.when === 'always') fired = true;
    if (check.when === 'manual') fired = !(rule.id in answers);
    if (check.when === 'outcome_changed') fired = outcomes.some(outcome => outcome.changed && check.outcomes.includes(outcome.name) && !declaredOutcomes.has(outcome.name));
    if (check.when === 'invariant') {
      for (const { journey, before, after } of runs) {
        if (!after) continue;
        const value = name => after.outcomes[name];
        const say = (name, problem) => failures.push({ journeyId: journey.id, text: `In "${journey.title}", ${outcomeLabel(map, name).toLowerCase()} ${problem}.` });
        for (const name of check.is_true ?? [])
          if (reported(after.outcomes, name) && value(name) !== true) say(name, `is ${show(name, value(name))} and must be Yes`);
        for (const [name, expected] of Object.entries(check.equals ?? {}))
          if (reported(after.outcomes, name) && !same(value(name), expected)) say(name, `is ${show(name, value(name))} and must be ${show(name, expected)}`);
        for (const [name, least] of Object.entries(check.at_least ?? {}))
          if (reported(after.outcomes, name) && !(typeof value(name) === 'number' && value(name) >= least)) say(name, `is ${show(name, value(name))} and must be at least ${show(name, least)}`);
        for (const name of check.unchanged ?? [])
          if (!(check.unless_declared && declaredOutcomes.has(name)) && reported(after.outcomes, name) && reported(before?.outcomes, name) && !same(value(name), before.outcomes[name]))
            say(name, `went from ${show(name, before.outcomes[name])} to ${show(name, value(name))} and must not change`);
      }
      fired = failures.length > 0;
    }
    const requires = fired && !effect.allow ? [...(effect.require ?? [])] : [];
    if (fired && effect.block) {
      const because = failures.length ? failures : [{ text: rule.statement }];
      for (const failure of because)
        blocks.push({ code: 'rule_blocks', ruleId: rule.id, ...(failure.journeyId ? { journeyId: failure.journeyId } : {}), text: `Blocked by the rule "${rule.title}". ${failure.text}` });
    }
    for (const role of requires) requiredBy.set(role, [...(requiredBy.get(role) ?? []), rule]);
    return {
      ruleId: rule.id, revision: rule.revision, title: rule.title, statement: rule.statement,
      fired, effect: !fired ? 'none' : effect.allow ? 'allow' : effect.block ? 'block' : 'require', requires,
      ...(check.uses ? { uses: check.uses, tool: toolState } : {}),
      ...(check.when === 'manual' ? { question: check.question, answered: rule.id in answers } : {}),
    };
  });

  if (mode === 'gate')
    for (const ruleId of notRunTools)
      hold({ code: 'tool_not_run', ruleId, text: `The check for "${applicable.find(r => r.id === ruleId)?.title}" was not run, so an engineer needs to look at this change.` }, true);

  // 5 · Verdict: the strictest result wins.
  const requiredRoles = [...new Set([...requiredBy.keys(), ...(engineerNeeded ? [engineerRole] : [])])].sort();
  const approved = new Set(approvals
    .filter(approval => approval.versionId === version.id && approval.decision === 'approve' && approval.actorKind === 'person')
    .map(approval => approval.role));
  const outstandingRoles = requiredRoles.filter(role => !approved.has(role));
  const waiting = outstandingRoles.map(role => {
    const byRules = requiredBy.get(role) ?? [];
    const why = [];
    if (byRules.length) why.push(`the ${byRules.length === 1 ? 'rule' : 'rules'} ${joinWords(byRules.map(rule => `"${rule.title}"`))} ${byRules.length === 1 ? 'requires' : 'require'} it`);
    const questions = byRules.filter(rule => rule.check?.when === 'manual').map(rule => rule.check.question);
    if (engineerNeeded && role === engineerRole) why.push('an engineer has to look at this change');
    return { code: 'approval_needed', role, ...(byRules.length ? { ruleId: byRules[0].id } : {}), ...(questions.length ? { questions } : {}), text: `Waiting for approval from ${roleName(role)}: ${why.join(', and ')}.${questions.length ? ` Question${questions.length > 1 ? 's' : ''}: ${questions.join(' ')}` : ''}` };
  });
  const engineerApproved = approved.has(engineerRole);
  const builtIn = holds.map(({ needsEngineer, ...reason }) => ({ ...reason, cleared: needsEngineer && engineerApproved }));
  const open = builtIn.filter(reason => !reason.cleared).map(({ cleared, ...reason }) => reason);
  const result = blocks.length ? 'block' : splitNeeded && !engineerApproved ? 'split' : outstandingRoles.length || open.length ? 'hold' : 'allow';
  const reasons = [...blocks, ...open, ...waiting];
  if (result === 'allow') reasons.push({ code: 'allowed', text: 'Every rule that applies to this change is met, and everyone who needs to approve it has.' });

  // 6 · Result. Rule revisions include the approved entries the applicable rules depend on.
  const entries = new Map(rules.filter(rule => rule.status === 'approved').map(rule => [rule.id, rule]));
  const used = new Map(applicable.map(rule => [rule.id, rule]));
  const queue = [...applicable];
  while (queue.length)
    for (const id of queue.shift().dependsOn ?? []) {
      const entry = entries.get(id);
      if (entry && !used.has(id)) { used.set(id, entry); queue.push(entry); }
    }
  return {
    versionId: version.id,
    result,
    preliminary: mode === 'preview',
    reasons,
    // Every built-in hold found, including those an engineer's approval has cleared.
    holds: builtIn,
    requiredRoles,
    outstandingRoles,
    ruleResults,
    ruleRevisions: [...used.values()].map(rule => ({ id: rule.id, revision: rule.revision })).sort((a, b) => order(a.id, b.id)),
    evidenceIds: [...new Set(runs.flatMap(run => [run.before, run.after]).filter(Boolean).map(item => item.id))].sort(),
    footprint: { areas: fp.areas, journeyIds: fp.journeys.map(journey => journey.id), unmapped: fp.unmapped, hybridFiles: fp.hybridFiles },
    // Journeys and cases run only because an applicable rule names a result they report.
    addedJourneyIds: checks.added.map(journey => journey.id),
    outcomes,
    // Replay only: journeys an applicable rule needed that had no evidence. The verdict is "as far as the rules that could run".
    notRun: [...notRun].sort(),
    notRunTools,
    declared: { outcomes: [...declaredOutcomes], changes: declaredParts, answered: Object.keys(answers) },
  };
}
