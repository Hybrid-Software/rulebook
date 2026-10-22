---
id: rule:pricing-is-a-shared-call
kind: rule
revision: v1
status: approved
title: A change to pricing needs both founders
owner: person:maya
ratifiedBy: [person:maya, person:lee]
ratifiedAt: 2026-10-01
asOf: 2026-10-01
applies_to: [entity:pricing]
sourceRefs: [source:2026-09-28-pricing-memo]
check:
  when: always
effect:
  require: [person:maya, person:lee]
---
Any change to what a plan is or costs, in Stripe or in the record, waits for both founders.
