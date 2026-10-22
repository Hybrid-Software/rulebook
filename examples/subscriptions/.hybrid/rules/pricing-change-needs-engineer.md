---
id: rule:pricing-change-needs-engineer
kind: rule
revision: v1
status: approved
title: A changed checkout total needs an engineer
owner: role:engineering-lead
ratifiedBy: person:example-engineer
ratifiedAt: 2026-10-05
asOf: 2026-10-05
applies_to: [area:checkout]
depends_on: []
sourceRefs: [source:demo-policy]
check:
  when: outcome_changed
  outcomes: [new_subscriber_total, existing_subscriber_total]
effect:
  require: [role:pm, role:engineer]
---
If a change alters what anyone is charged at checkout, the PM and the named engineer must both approve it.
