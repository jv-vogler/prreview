/**
 * Single integer driving the migration chain on session open (ARCHITECTURE
 * §11). Additive optional fields never bump it; only breaking shape changes
 * do, each accompanied by a migration step in migrate.ts.
 */
export const SCHEMA_VERSION = 1;
