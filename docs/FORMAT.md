# The entry format

Every file in a Rulebook is Markdown with a YAML header. The body is the statement people read. One format, four roles (entity, rule, decision, source) plus the constitution.

## Every entry

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Stable identity with a kind prefix: `rule:`, `entity:`, `dec-YYYY-MM-DD-…`, `source:`, `constitution:` |
| `kind` | yes | `rule`, `entity`, `decision`, `source`, `constitution` (`definition` is accepted as an alias of `entity`) |
| `revision` | yes | `v1`, `v2`, … A new revision of the same id supersedes the old; the old file stays |
| `status` | yes | `draft`, `approved`, `superseded`. "Current" is computed, never written |
| `asOf` | yes | The date the statement was true |
| `owner` | yes | `person:…`, `role:…`, `agent:…` |
| `ratifiedBy`, `ratifiedAt` | unless draft | Who approved it and when. A list of people when more than one must sign |
| `title` | yes (or a `# heading` in the body) | |
| `applies_to` | | Entities this is about (rules: where the rule attaches) |
| `related`, `depends_on`, `sourceRefs` | | References by id |
| `replaces` | | Another entry this supersedes (cross-id). `supersedes` is the prior revision of the same id |
| `corrects` | | A prior position this falsifies: `what` (verbatim), `held_by`, `falsified_by` |
| `standing` | | `explicit` (said by someone with authority), `derived`, `working` (inferred, unconfirmed) |

## Entities

The things in the business that can change. Add `scope: { paths: [...], not: [...] }` for a part of a codebase (then a change touching those paths touches this entity). Add `same_as: [stripe:acct_1, repo:org/name]` for where the live thing lives. `weightless: true` excludes it from the size limit (docs). `type` and `state` are free text (`customer`, `trial`). An entity never holds a value that would be different tomorrow without anyone deciding.

`map.yaml` is the short form for entities found by paths, plus journeys, cases, outcomes, `limits: { areas, files }` and `defaults: { uncovered: require | allow }`.

## Rules

```yaml
applies_to: [entity:billing]          # or scope: { paths: [...] } to define the entity inline
check:
  when: always | manual | invariant | outcome_changed
  question: "…"                        # manual: asked to the owner, shown on the card
  uses: ["npm test", "semgrep …"]      # always: run these; exit 0 holds, otherwise the rule fires
  outcomes: [name]                     # outcome_changed
  unchanged: [name]  is_true: [name]   # invariant
  equals: { name: value }  at_least: { name: n }
  unless_declared: true                # invariant: skip an outcome the change declares it moves
effect:
  allow: true            # ships with nobody looking
  require: [person:maya] # goes to them, with the evidence
  block: true            # with an optional reason:
  reason: "…"
```

## The change

A change is a collection of things that changed. For a PR, files. For the record, the entries that changed (each touches the entities its `applies_to` names). It may declare: `declares.outcomes` (figures it moves on purpose), `declares.changes` (the parts of a large change), `declares.answers` (answers to `manual` questions).

## The verdict

`allow` · `require` (who, why, with questions) · `block` (which rule, which figure) · `split` (too many entities or files for one change). Built-in holds: an unmapped file, an entity no `allow` rule covers, a journey with no evidence, a tool check not run, a change too large. The verdict pins the revision of every rule it used.

## Sources

Plain files with an `id:` header line: `id: source:2026-09-28-pricing-memo`. Pointers and what was learned; never a copy of a system's data. Never loaded by default.
