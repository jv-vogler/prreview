import type { FileDiffDto } from "@dto/ChangesetDto";
import { describe, expect, it } from "vitest";
import { buildPatchText } from "./buildPatchText";

function fileWith(overrides: Partial<FileDiffDto>): FileDiffDto {
	return {
		id: "f_abc",
		path: "src/app.ts",
		status: "modified",
		additions: 1,
		deletions: 1,
		isBinary: false,
		isGenerated: false,
		oldBlob: null,
		newBlob: null,
		hunks: [
			{
				id: "h1",
				header: "@@ -1,2 +1,2 @@ function main()",
				oldStart: 1,
				oldLines: 2,
				newStart: 1,
				newLines: 2,
				lines: [
					{ type: "context", content: "const a = 1;", oldLine: 1, newLine: 1 },
					{ type: "del", content: "const b = 2;", oldLine: 2 },
					{ type: "add", content: "const b = 3;", newLine: 2 },
				],
			},
		],
		...overrides,
	};
}

describe("buildPatchText", () => {
	it("serializes a modified file with prefixes and the verbatim hunk header", () => {
		const patch = buildPatchText([fileWith({})]);
		expect(patch).toBe(
			[
				"diff --git a/src/app.ts b/src/app.ts",
				"--- a/src/app.ts",
				"+++ b/src/app.ts",
				"@@ -1,2 +1,2 @@ function main()",
				" const a = 1;",
				"-const b = 2;",
				"+const b = 3;",
				"",
			].join("\n"),
		);
	});

	it("marks added files with /dev/null on the old side", () => {
		const patch = buildPatchText([fileWith({ status: "added" })]);
		expect(patch).toContain("new file mode 100644");
		expect(patch).toContain("--- /dev/null");
		expect(patch).toContain("+++ b/src/app.ts");
	});

	it("marks deleted files with /dev/null on the new side", () => {
		const patch = buildPatchText([fileWith({ status: "deleted" })]);
		expect(patch).toContain("deleted file mode 100644");
		expect(patch).toContain("+++ /dev/null");
	});

	it("emits rename headers with the old path on the a/ side", () => {
		const patch = buildPatchText([
			fileWith({ status: "renamed", oldPath: "src/old.ts" }),
		]);
		expect(patch).toContain("diff --git a/src/old.ts b/src/app.ts");
		expect(patch).toContain("rename from src/old.ts");
		expect(patch).toContain("rename to src/app.ts");
		expect(patch).toContain("similarity index 75%");
	});

	it("emits 100% similarity and no hunk body for pure renames", () => {
		const patch = buildPatchText([
			fileWith({ status: "renamed", oldPath: "src/old.ts", hunks: [] }),
		]);
		expect(patch).toContain("similarity index 100%");
		expect(patch).not.toContain("---");
	});

	it("emits the index line only when both oids are known", () => {
		const withOids = buildPatchText([
			fileWith({
				oldBlob: { kind: "odb", oid: "a".repeat(40) },
				newBlob: { kind: "odb", oid: "b".repeat(40) },
			}),
		]);
		expect(withOids).toContain(`index ${"a".repeat(40)}..${"b".repeat(40)}`);
		expect(buildPatchText([fileWith({})])).not.toContain("index ");
	});

	it("places the no-EOL marker right after the flagged line", () => {
		const patch = buildPatchText([
			fileWith({
				hunks: [
					{
						id: "h1",
						header: "@@ -1,1 +1,1 @@",
						oldStart: 1,
						oldLines: 1,
						newStart: 1,
						newLines: 1,
						lines: [
							{ type: "del", content: "old", oldLine: 1, noEol: true },
							{ type: "add", content: "new", newLine: 1 },
						],
					},
				],
			}),
		]);
		expect(patch).toContain("-old\n\\ No newline at end of file\n+new");
	});
});
