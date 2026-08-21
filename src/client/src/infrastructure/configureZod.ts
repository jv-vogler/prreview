import { z } from "zod";

/**
 * zod's eval-availability probe (`Function("")`) fires a
 * securitypolicyviolation report under the server's CSP — script-src grants
 * no 'unsafe-eval' — even though zod swallows the throw. `jitless` skips the
 * probe (and the schema JIT, irrelevant at this payload size).
 *
 * The probe runs while schemas are CONSTRUCTED, i.e. when the first dto
 * module evaluates, so this must be a side-effect import placed before every
 * other import in main.tsx — module evaluation order guarantees it then runs
 * first.
 */
z.config({ jitless: true });
