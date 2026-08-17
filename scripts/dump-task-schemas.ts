#!/usr/bin/env -S npx tsx
/**
 * Prints `{ [taskName]: <inline --json-schema string> }` as JSON on stdout,
 * built through the production `toJsonSchema` path.
 *
 * It exists for one reason: `scripts/capture-claude-fixtures.mjs` used to
 * hand-embed a copy of the comprehension schema, so the fixtures were recorded
 * against a JSON Schema no production code path ever produced. That is half of
 * why the draft-2020-12 outage (CON-014) survived every test — the capture
 * proved the CLI accepted a schema prreview did not send. Routing the capture
 * through this dumper means a recording can only ever be made against the real
 * value.
 *
 * The capture script is `.mjs` and cannot import TypeScript, so it spawns this
 * under tsx and parses stdout. Run it directly to eyeball a schema:
 *
 *   npx tsx scripts/dump-task-schemas.ts | jq .
 */
import { TASK_SCHEMAS } from "../src/application/analysis/taskSchemas";
import {
	assertSchemaFitsArgv,
	toJsonSchema,
} from "../src/application/analysis/toJsonSchema";

const dumped: Record<string, string> = {};
for (const [name, schema] of Object.entries(TASK_SCHEMAS)) {
	const json = toJsonSchema(schema);
	assertSchemaFitsArgv(json);
	dumped[name] = json;
}

process.stdout.write(`${JSON.stringify(dumped)}\n`);
