# Rulebook

**Rules you write once, with an owner on each, that decide which changes ship with nobody looking and who looks at the rest.**

Your agents have instructions. Nothing enforces them. You wrote a CLAUDE.md; you don't know if it was read, and nothing happens when it's ignored. A Rulebook is the part of those instructions that has to be true: each rule has an owner, is checked when the thing it governs is touched, and is enforced before anything ships.

```
$ rulebook check --base main                   # an agent's PR: a timezone fix in the budget feature
change   3 files · entities: budget
rule     figures-match-the-dashboard    invariant   blocked
         "spend this month" 1,284 on the Ask screen · 1,412 on the dashboard
verdict  blocked — nobody has to read the code to know it's wrong

$ rulebook check --base main                   # an agent adds an @everyone mention
change   2 files · entities: notifications
rule     reach-is-lees-call             outcome     reach 12 → 2,340 members
verdict  needs Lee

$ rulebook check --action deploy --from feat/x  # an agent tries to deploy a branch (the action gate: format today, proxy in the hosted product)
rule     deploy-only-from-main          always      blocked
verdict  blocked — the token was never in the agent's hands
```

Same rule shape, same owner, same verdict: a change, a notification's reach, an action. Nothing above is specific to code. **Instructions are a suggestion. Rules are governance.**

## How many of your last 30 merges didn't need you?

```
npx @hybrid-software/rulebook init      # drafts entities and rules from your repo, CODEOWNERS, lint config and CLAUDE.md
npx @hybrid-software/rulebook replay 30 # runs them over your last 30 merges

  0 would have shipped with nobody looking
 22 would have gone to a named person (22 engineer) · 22 because no rule covers the area yet
  8 would have been held: too much in one change
```

Zero on day one is correct. Nothing ships alone until an owner switches a rule to `allow`. Approve one ("docs and copy ship") and run it again; the number moves, and every row says why. On a production fintech app we run, the first afternoon went 0 → 8 → 14 → 17 of 50 as rules were switched on, with the other 33 going to a named person with the rule that sent them there.

Nothing leaves your machine. No account.

## What a rule is

One Markdown file with a YAML header. The body is the sentence people read.

```yaml
---
id: rule:figures-match-the-dashboard
kind: rule
revision: v1
status: approved
title: Every figure the assistant states equals the dashboard's for the same user
owner: person:maya
ratifiedBy: person:maya
ratifiedAt: 2026-10-20
asOf: 2026-10-20
applies_to: [entity:budget, entity:assistant]
check:
  when: invariant
  equals: { assistant_spend_this_month: dashboard_spend_this_month }
effect:
  block: true
---
Right arithmetic over the wrong inputs looked fine in every code review for six weeks. The number is the check.
```

Three effects: `allow` (ships with nobody looking), `require: [who]` (goes to that person, with the evidence), `block`. Four kinds of check: `always` (fires whenever the entity is touched), `manual` (asks the owner a question, on the card), `invariant` / `outcome_changed` (a measured figure, before and after), and `uses:` (runs the checks you already have: your tests, your lint, Semgrep). A rule can carry `scope.paths` so it exists before the map does.

## Where rules come from

Nobody writes them from a blank page. `init` reads your repo's layout, CODEOWNERS, lint config and the sentences in CLAUDE.md that already read like rules ("anything touching billing needs Maya's nod" becomes a rule with `owner: person:maya`). You confirm or delete. The rest come out of the record over time: a change that reached a person because no rule covered it is a rule request with the evidence attached.

The record has four layers, all plain files:

- **Entities** — the things in your business that can change: a part of the codebase (found by paths), a product, a customer, a figure like MRR. An entity holds what the thing *means* and where its live value lives (`same_as: stripe:acct_1`); never the value.
- **Rules** — what binds, attached to entities, with an owner and an effect.
- **History** — decisions, dated and never edited; a decision that changes an earlier one `replaces` it; one that falsifies a belief carries `corrects:` with the wrong reading kept verbatim.
- **Sources** — what was said: memos, transcripts, PR bodies, the code itself. The record keeps pointers and what was learned, never copies.

A change touches entities; the rules on those entities fire; the verdict pins the revision of every rule it used, so a March audit can replay an October decision. Same ids for what an agent is told before changing something (`rulebook context entity:billing`) and what it is judged by after. **The Rulebook never stores source data; it records how to get it.**

## It is not a memory store

| | CLAUDE.md | memory store | **Rulebook** |
|---|---|---|---|
| read when | the agent decides | the agent queries | **the thing it governs is touched** |
| when ignored | nothing | nothing | **the change doesn't ship** |
| owner | — | — | **a named person, per rule** |
| holds | prose | your data | **rules, and where data lives** |

You still want a memory store, and the Rulebook points at it. This is the layer that decides; that is the layer that remembers.

## Three things it governs

1. **Changes to software, from anyone's agent.** A PR is a collection of things that changed; the rules decide. The required check on the PR is the gate. `examples/subscriptions`.
2. **A team's agents, all reading one record.** Every agent starts from the same constitution, the same rules, the same decisions and corrections. A decision one founder made is a rule the other founder's agent hits. `examples/company`: a fictional company's Rulebook, where a draft pricing decision routes to both founders and a copy change runs the roaster-confirmation check.
3. **Agents changing their own work.** An agent that proposes a change to its own prompts or harness is a third author at the same gate. Agent-initiated changes route until the rule earns `allow`; no change to a harness may lower a held-out eval.

The same evaluator extends to actions (deploy, send, publish): a proposed action instead of a diff, the same rules, a proxy that holds the token so the agent only ever asks. The format carries it today; the proxy ships with the hosted product.

## Commands

```
rulebook init        draft a .hybrid/ from your repo (--write to create it)
rulebook validate    every entry, every reference, the indexes
rulebook check       the verdict for the current change (--base main, or --files a,b)
rulebook replay N    the last N merges through the rules: how many didn't need anyone
rulebook context X   what attaches to an entity or entry: what an agent reads first
rulebook explain R   one rule: what it says, who owns it, why it exists
```

The GitHub Action in `action/` runs `check` on every PR and posts the verdict as a status.

## What runs where

Open source, here: the format, the validator, `init`, `check`, `replay`, `context`, `explain`, the Action. Everything that needs no environment we provide: footprint, routing, mechanical blocks, your own tests and lint, `manual` questions, journeys against an environment you already have (a preview URL, localhost).

Not here: running behavioural checks in an environment we provide, the ledger of every verdict, per-rule trust that earns `allow`, routing to real people, the editor, the action proxy. That is [Hybrid](https://hybridapp.io), the hosted product this format comes from. The line is exactly: where a change has to *run* to be judged, or where memory across runs is needed.

## Status

v0.1. The format and the four footprint-level verdicts (allow, require, block, split) run on real repos today. Invariants and outcome checks evaluate when you give them evidence; the CLI reports them as *not run here* otherwise, and never pretends. `init` gets the map mostly right on a Node or PHP repo and wrong in the strict direction elsewhere; the map is where the number lives, so tell us what it got wrong.

Docs: [FORMAT.md](docs/FORMAT.md) (every field) · [ARCHITECTURE.md](docs/ARCHITECTURE.md) (one page: the four layers, the two traversals, the verdict).

Apache-2.0.
