import { describe, expect, it } from "vitest";
import { StoreError } from "../errors/StoreError";
import { migrate } from "./migrate";
import { SCHEMA_VERSION } from "./SCHEMA_VERSION";

describe("migrate", () => {
	it("passes a current-version record through untouched", () => {
		const record = { schemaVersion: SCHEMA_VERSION, changesetId: "worktree" };
		expect(migrate(record)).toBe(record);
	});

	it("refuses a record written by a newer prreview", () => {
		const newer = { schemaVersion: SCHEMA_VERSION + 1 };
		let caught: unknown;
		try {
			migrate(newer);
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(StoreError);
		expect((caught as StoreError).reason).toBe("schema-newer-than-binary");
		expect((caught as StoreError).message).toContain("newer");
	});

	it("treats an unknown ancient version as corrupt", () => {
		let caught: unknown;
		try {
			migrate({ schemaVersion: 0 });
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(StoreError);
		expect((caught as StoreError).reason).toBe("corrupt");
	});
});
