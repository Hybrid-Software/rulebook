// Made-up placeholder case for tests. Only its content fingerprint is used; it does nothing unless asked for outcomes.
import { writeFileSync } from 'node:fs';
if (process.env.HYBRID_OUTCOMES_FILE) writeFileSync(process.env.HYBRID_OUTCOMES_FILE, JSON.stringify({ new_subscriber_total: 90 }));
