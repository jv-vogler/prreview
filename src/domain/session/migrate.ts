import { StoreError } from "../errors/StoreError";
import { SCHEMA_VERSION } from "./SCHEMA_VERSION";

export interface VersionedRecord {
	schemaVersion: number;
}

type MigrationStep = (record: VersionedRecord) => VersionedRecord;

/**
 * One entry per schema bump: the step at key N lifts a record from version N
 * to N+1 (and must set the new schemaVersion itself). Empty while the schema
 * has only ever been version 1.
 */
const MIGRATION_STEPS: Readonly<Record<number, MigrationStep>> = {};

/**
 * Runs the migration chain on a freshly read session file, before zod
 * validation (CON-004). A record already at the current version passes
 * through untouched (the identity migration); a record from a newer prreview
 * is refused rather than half-loaded, and a version with no known chain is
 * corrupt.
 */
export function migrate(record: VersionedRecord): VersionedRecord {
	if (record.schemaVersion > SCHEMA_VERSION) {
		throw new StoreError(
			"schema-newer-than-binary",
			`This session was written with schema version ${record.schemaVersion}, but this prreview only knows version ${SCHEMA_VERSION} — open it with a newer prreview.`,
		);
	}

	let migrated = record;
	for (
		let version = record.schemaVersion;
		version < SCHEMA_VERSION;
		version++
	) {
		const step = MIGRATION_STEPS[version];
		if (step === undefined) {
			throw new StoreError(
				"corrupt",
				`No migration path exists from schema version ${version}.`,
			);
		}
		migrated = step(migrated);
	}
	return migrated;
}
