# Example: a company's Rulebook

The business half of the format: the same entries a product uses, applied to a company instead of a codebase. Everything here is fictional (Northwind, a small coffee-subscription company; Maya and Lee, its founders).

- `rulebook/constitution.md` — the always-read: what the company is, what it never does, who decides what.
- `rulebook/entities/` — the things in the business that rules attach to: pricing, outbound copy, customers. An entity holds what the thing *means* and where its live value lives (`same_as`); never the value.
- `rulebook/rules/` — what binds. Each has an owner, a check, and an effect.
- `rulebook/decisions/` — history: why things are the way they are, dated, never edited. One carries `corrects:`.
- `sources/` — what was said: the memo a decision came from.

A "change" here is a commit to the record, an outbound email, a page about to publish. Try it:

```
cd examples/company
npx rulebook validate --dir rulebook
npx rulebook context entity:pricing --dir rulebook
npx rulebook check --dir rulebook --files rulebook/decisions/dec-2026-11-02-annual-plan.md
```
