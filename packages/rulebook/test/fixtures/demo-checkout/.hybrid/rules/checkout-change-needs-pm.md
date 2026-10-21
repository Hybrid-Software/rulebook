---
id: rule:checkout-change-needs-pm
kind: rule
revision: v1
status: approved
title: Any change to checkout needs the PM
owner: role:pm
ratifiedBy: person:example-pm
ratifiedAt: 2026-10-05
asOf: 2026-10-05
applies_to: [area:checkout]
depends_on: []
sourceRefs: [source:demo-policy]
check:
  when: always
effect:
  require: [role:pm]
---
Every change that touches checkout must be approved by the PM.
