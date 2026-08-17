import type { FileDiffDto } from "@dto/ChangesetDto";
import { describe, expect, it } from "vitest";
import {
	resolveStepTarget,
	type WalkthroughStepDto,
} from "./resolveStepTarget";

function file(path: string, hunkIds: readonly string[]): FileDiffDto {
	return {
		id: `id-${path}`,
		path,
		status: "modified",
		additions: 1,
		deletions: 0,
		isBinary: false,
		isGenerated: false,
		oldBlob: null,
		newBlob: null,
		hunks: hunkIds.map((id) => ({
			id,
			header: "@@",
			oldStart: 1,
			oldLines: 1,
			newStart: 1,
			newLines: 1,
			lines: [],
		})),
	};
}

function step(
	focus: WalkthroughStepDto["focus"],
	overrides: Partial<WalkthroughStepDto> = {},
): WalkthroughStepDto {
	return {
		index: 0,
		title: "Start here",
		narration: "one string changes",
		focus,
		...overrides,
	};
}

const files = [
	file("src/greeting.ts", ["h1", "h2"]),
	file("docs/notes.md", ["h3"]),
];

describe("resolveStepTarget", () => {
	it("lands on the named hunk of the named file", () => {
		const target = resolveStepTarget(
			step([{ path: "docs/notes.md", hunkIds: ["h3"] }]),
			files,
		);
		expect(target).toEqual({ fileIndex: 1, hunkIndex: 0 });
	});

	it("lands on the first named hunk when a step names several", () => {
		const target = resolveStepTarget(
			step([{ path: "src/greeting.ts", hunkIds: ["h2"] }]),
			files,
		);
		expect(target).toEqual({ fileIndex: 0, hunkIndex: 1 });
	});

	it("falls back to the file when its hunk ids are stale", () => {
		const target = resolveStepTarget(
			step([{ path: "src/greeting.ts", hunkIds: ["gone"] }]),
			files,
		);
		expect(target).toEqual({ fileIndex: 0, hunkIndex: 0 });
	});

	it("skips a focus entry whose path this round does not contain", () => {
		const target = resolveStepTarget(
			step([
				{ path: "src/deleted.ts", hunkIds: ["h9"] },
				{ path: "docs/notes.md", hunkIds: ["h3"] },
			]),
			files,
		);
		expect(target).toEqual({ fileIndex: 1, hunkIndex: 0 });
	});

	it("answers null when nothing the step names is here", () => {
		expect(
			resolveStepTarget(step([{ path: "src/gone.ts", hunkIds: [] }]), files),
		).toBeNull();
		expect(resolveStepTarget(step([]), files)).toBeNull();
	});
});
