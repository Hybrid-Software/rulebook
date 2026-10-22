---
id: rule:no-single-origin-claims
kind: rule
revision: v1
status: approved
title: Copy never says "single origin" without the roaster's written confirmation
owner: person:lee
ratifiedBy: person:lee
ratifiedAt: 2026-10-01
asOf: 2026-10-01
applies_to: [entity:outbound-copy]
check:
  when: always
  uses: ["! grep -rli 'single origin' site/ emails/ || test -f roasters/confirmations/$(date +%Y-%m).txt"]
effect:
  block: true
  reason: We claimed single origin once without confirmation and refunded 40 orders. Attach the roaster's note first.
---
A customer-facing page or email that says "single origin" is blocked unless this month's roaster confirmation is on file.
