import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadDiffFixture } from "../../../test/helpers/loadDiffFixture";
import type { ChangesetRef } from "../../domain/changeset/ChangesetRef";
import type { DiffLine } from "../../domain/changeset/DiffLine";
import type { FileDiff } from "../../domain/changeset/FileDiff";
import { parseDiff } from "../../domain/changeset/parseDiff";
import { serializeNud } from "./nud";

/**
 * Golden NUD snapshots over all eight M1 .patch fixtures (TEST-003).
 * Regenerate with: UPDATE_GOLDEN=1 npx vitest run src/application/analysis/nud.test.ts
 */

const GOLDEN_DIRECTORY = new URL(
	"../../../test/fixtures/nud/",
	import.meta.url,
);

const FIXTURE_NAMES = [
	"add",
	"binary",
	"delete",
	"duplicate-hunks",
	"mode-change",
	"modify",
	"no-eol",
	"rename-with-edits",
] as const;

const REF: ChangesetRef = {
	source: { kind: "branch", branch: "feature-x", base: "main" },
	baseSha: "a".repeat(40),
	headSha: "b".repeat(40),
	resolvedAt: "2026-08-17T00:00:00.000Z",
};

function fixtureFiles(name: string): FileDiff[] {
	return parseDiff(loadDiffFixture(`${name}.patch`));
}

function serializeFixture(name: string): string {
	return serializeNud({ ref: REF, roundId: "r1", files: fixtureFiles(name) });
}

describe("serializeNud goldens", () => {
	it.each(FIXTURE_NAMES)(
		"matches the checked-in golden for %s",
		async (name) => {
			const nud = serializeFixture(name);
			const goldenPath = fileURLToPath(
				new URL(`${name}.txt`, GOLDEN_DIRECTORY),
			);
			if (process.env.UPDATE_GOLDEN === "1") {
				await writeFile(goldenPath, nud);
				return;
			}
			expect(nud).toBe(await readFile(goldenPath, "utf8"));
		},
	);

	it("is stable across two runs over the same input", () => {
		for (const name of FIXTURE_NAMES) {
			expect(serializeFixture(name)).toBe(serializeFixture(name));
		}
	});
});

/** the row shape of TASK-015: 6-char numbers or ".", " | " separators, sigil */
const DIFF_ROW_PATTERN = /^([ 0-9.]{6}) \| ([ 0-9.]{6}) \| ([ +-])(.*)$/;

interface ParsedRow {
	oldLine: number | undefined;
	newLine: number | undefined;
	sigil: string;
	content: string;
}

function extractRows(nud: string): ParsedRow[] {
	const rows: ParsedRow[] = [];
	for (const line of nud.split("\n")) {
		const match = DIFF_ROW_PATTERN.exec(line);
		if (match === null) {
			continue;
		}
		rows.push({
			oldLine: parseCell(match[1]),
			newLine: parseCell(match[2]),
			sigil: match[3],
			content: match[4],
		});
	}
	return rows;
}

function parseCell(cell: string): number | undefined {
	const text = cell.trim();
	return text === "." ? undefined : Number(text);
}

const SIGIL_BY_TYPE: Record<DiffLine["type"], string> = {
	context: " ",
	add: "+",
	del: "-",
};

describe("serializeNud line-number fidelity", () => {
	it.each(FIXTURE_NAMES)(
		"every emitted line number in %s matches the IR",
		(name) => {
			const files = fixtureFiles(name);
			const rows = extractRows(serializeFixture(name));
			const expected = files.flatMap((file) =>
				file.hunks.flatMap((hunk) => hunk.lines),
			);
			expect(rows.length).toBe(expected.length);
			rows.forEach((row, index) => {
				const line = expected[index];
				expect(row.oldLine).toBe(line.oldLine);
				expect(row.newLine).toBe(line.newLine);
				expect(row.sigil).toBe(SIGIL_BY_TYPE[line.type]);
				expect(row.content).toBe(line.content);
			});
		},
	);
});

describe("serializeNud special cases", () => {
	it("appends the rename origin to the file header and the file list", () => {
		const nud = serializeFixture("rename-with-edits");
		const renameMentions = nud
			.split("\n")
			.filter((line) => line.includes("renamed from lib.js"));
		expect(renameMentions).toHaveLength(2);
		expect(nud).toContain("=== FILE ");
		expect(nud).toContain("util.js");
	});

	it("lists a binary file with a marker and emits no body section for it", () => {
		const nud = serializeFixture("binary");
		expect(nud).toContain("icon.bin");
		expect(nud).toContain("[binary]");
		expect(nud).not.toContain("=== FILE ");
	});

	it("emits the no-newline marker verbatim after the affected lines", () => {
		const nud = serializeFixture("no-eol");
		const lines = nud.split("\n");
		const markerIndexes = lines
			.map((line, index) =>
				line === "\\ No newline at end of file" ? index : -1,
			)
			.filter((index) => index !== -1);
		expect(markerIndexes).toHaveLength(2);
		expect(lines[markerIndexes[0] - 1]).toContain(
			"+three went missing its newline",
		);
		expect(lines[markerIndexes[1] - 1]).toContain(
			"-gamma ends without newline",
		);
	});

	it("lists a mode-only change in the file list without a body section", () => {
		const nud = serializeFixture("mode-change");
		expect(nud).toContain("run.sh");
		expect(nud).not.toContain("=== FILE ");
	});

	it("always opens with the changeset header and the full file list", () => {
		const nud = serializeFixture("modify");
		const lines = nud.split("\n");
		expect(lines[0]).toBe("=== CHANGESET branch:feature-x..main");
		expect(lines[1]).toBe("source: branch feature-x..main");
		expect(lines[2]).toBe(`base: ${"a".repeat(40)}`);
		expect(lines[3]).toBe(`head: ${"b".repeat(40)}`);
		expect(lines[4]).toBe("round: r1");
		expect(nud).toContain("=== FILES (1 changed, +3 −2)");
		expect(nud).toContain("app.js  (modified, +3 −2)");
	});

	it("prints worktree for a headless ref", () => {
		const worktreeRef: ChangesetRef = {
			source: { kind: "worktree" },
			baseSha: "c".repeat(40),
			headSha: null,
			resolvedAt: "2026-08-17T00:00:00.000Z",
		};
		const nud = serializeNud({
			ref: worktreeRef,
			roundId: "r2",
			files: fixtureFiles("modify"),
		});
		expect(nud).toContain("head: worktree");
		expect(nud).toContain("=== CHANGESET worktree");
	});
});
