# Architecture, one page

**One graph, two traversals.** The record is a folder of entries (entities, rules, decisions, sources, a constitution) linked by id. `evaluate()` walks it one way: change → entities touched → rules attached → checks → effects → verdict. Retrieval walks it the other way: constitution → what attaches to the entities you are about to touch → hops → search. Same ids, so what an agent is told before a change is what it is judged by after.

**A change is a collection of things that changed.** Files for a PR; entries for the record; a proposed action for the action gate. The package never assumes a diff; the host adapter (GitHub, git, a proxy) produces the collection.

**Nothing ships alone until a rule says so.** An entity is covered when an approved rule with `effect: allow` attaches to it; uncovered entities go to an engineer with the reason. `require` beats `allow`; `block` beats both. Too much in one change holds for a split.

**Evidence is independent of the author.** Journeys, invariants and tool checks are run by the gate, not reported by the agent. Where the gate cannot run them (no environment), it says *not run here*, never *passed*.

**The record holds meaning, never state.** Entities say what a thing means and where its live value lives; verdicts and decisions pin values as of a date; the live number stays in its system. Credentials never enter the record.

**Supersede, never edit.** New revisions and new decisions; old files stay. A correction keeps the wrong reading verbatim, because it is the one that will recur.

**Open and hosted.** Open: the format, validate, init, check, replay, context, explain, the Action; everything that needs no environment we provide. Hosted: running checks in an environment we provide, the ledger, per-rule trust, routing to real people, the editor, the action proxy.
