# Example: a product's Rulebook

A made-up subscription checkout. `.hybrid/map.yaml` names the checkout entity and two journeys; `.hybrid/rules/` has four entries: a routing rule (any checkout change needs the PM), an invariant (checkout completes, existing subscribers' price does not move), a definition, and an outcome rule (a changed total needs an engineer). `app.yaml` is the sandbox recipe the hosted product uses; the CLI ignores it.

```
cd examples/subscriptions
npx rulebook validate
npx rulebook check --files web/src/checkout/PayButton.tsx   # needs the PM; 3 behavioural checks not run here
npx rulebook explain rule:checkout-stays-safe
```
