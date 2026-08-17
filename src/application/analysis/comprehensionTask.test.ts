import { describe, expect, it } from "vitest";
import { loadDiffFixture } from "../../../test/helpers/loadDiffFixture";
import type { ChangesetRef } from "../../domain/changeset/ChangesetRef";
import { parseDiff } from "../../domain/changeset/parseDiff";
import { buildComprehensionTask } from "./comprehensionTask";
import { ANALYSIS_TIMEOUT_MS, COMPREHENSION_MAX_TURNS } from "./limits";
import { comprehensionOutSchema } from "./schemas";
import { comprehensionContract } from "./systemContract";
import { assertSchemaFitsArgv, toJsonSchema } from "./toJsonSchema";

const REF: ChangesetRef = {
	source: { kind: "branch", branch: "feature-x", base: "main" },
	baseSha: "a".repeat(40),
	headSha: "b".repeat(40),
	resolvedAt: "2026-08-17T00:00:00.000Z",
};

const WORKSPACE_DIR = "/home/user/.cache/prreview/worktrees/abc/bbb";

function build() {
	return buildComprehensionTask({
		ref: REF,
		files: parseDiff(loadDiffFixture("modify.patch")),
		roundId: "r1",
		workspaceDir: WORKSPACE_DIR,
	});
}

describe("buildComprehensionTask", () => {
	it("assembles the TaskSpec from the contract modules", () => {
		const { task } = build();
		expect(task.stage).toBe("comprehension");
		expect(task.maxTurns).toBe(COMPREHENSION_MAX_TURNS);
		expect(task.timeoutMs).toBe(ANALYSIS_TIMEOUT_MS);
		expect(task.systemContract).toBe(comprehensionContract());
		expect(task.jsonSchema).toBe(toJsonSchema(comprehensionOutSchema));
		expect(() => assertSchemaFitsArgv(task.jsonSchema)).not.toThrow();
	});

	it("frames the changeset and embeds the truncated NUD in the prompt", () => {
		const { input } = build();
		expect(input.prompt).toContain("Changeset branch:feature-x..main");
		expect(input.prompt).toContain(`base ${"a".repeat(40)}`);
		expect(input.prompt).toContain(WORKSPACE_DIR);
		expect(input.prompt).toContain("reviewed revision");
		expect(input.prompt).toContain("=== CHANGESET branch:feature-x..main");
		expect(input.prompt).toContain("=== FILE ");
		expect(input.prompt).toContain("@@ HUNK ");
		expect(input.prompt).toContain("Produce the comprehension object");
	});

	it("targets the workspace and starts a fresh session — no resume", () => {
		const { input } = build();
		expect(input.workspaceDir).toBe(WORKSPACE_DIR);
		expect(input.resume).toBeUndefined();
	});
});
