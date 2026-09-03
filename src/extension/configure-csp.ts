import { config } from "zod/v4";

// Browser extension CSP forbids dynamic code generation. Zod otherwise probes
// for it at runtime, which Firefox reports as a CSP violation even though Zod
// catches the resulting exception and falls back to its interpreter.
config({ jitless: true });
