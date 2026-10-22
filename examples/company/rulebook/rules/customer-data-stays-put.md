---
id: rule:customer-data-stays-put
kind: rule
revision: v1
status: approved
title: Customer data is never exported into the record or a document
owner: person:lee
ratifiedBy: person:lee
ratifiedAt: 2026-10-01
asOf: 2026-10-01
applies_to: [entity:customers]
check:
  when: manual
  question: Does this change copy any subscriber's name, email, or card detail out of Stripe or the database?
effect:
  require: [person:lee]
---
Reports point at the data; they do not contain it.
