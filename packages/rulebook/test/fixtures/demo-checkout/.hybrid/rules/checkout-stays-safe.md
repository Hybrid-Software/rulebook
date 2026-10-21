---
id: rule:checkout-stays-safe
kind: rule
revision: v1
status: approved
title: Checkout must keep working and existing prices must not move
owner: role:engineering-lead
ratifiedBy: person:example-engineer
ratifiedAt: 2026-10-05
asOf: 2026-10-05
applies_to: [area:checkout]
depends_on: [definition:existing-subscriber]
sourceRefs: [source:demo-policy]
check:
  when: invariant
  is_true: [checkout_completed]
  at_least: { new_subscriber_total: 0 }
  unchanged: [existing_subscriber_total]
effect:
  block: true
---
Checkout must complete, the total charged must be zero or more, and the price an existing subscriber pays must not change.
