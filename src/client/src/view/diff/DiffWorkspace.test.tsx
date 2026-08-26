import type { ChangesetDto, FileDiffDto } from "@dto/ChangesetDto";
import type { ExplanationDto, ReviewFindingDto } from "@dto/ReviewDto";
import type { CodeViewDiffItem } from "@pierre/diffs";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FindingActions } from "../review/comments/FindingActions";
import { DiffWorkspace } from "./DiffWorkspace";

// the real CodeView needs a highlight worker pool; the seam under test is
// what DiffWorkspace hands it, so a recorder is the whole mock
const renderedItems: CodeViewDiffItem<unknown>[][] = [];
vi.mock("@pierre/diffs/react", () => ({
	CodeView: (props: { items: CodeViewDiffItem<unknown>[] }) => {
		renderedItems.push(props.items);
		return null;
	},
}));
vi.mock("../app/WorkerPoolHost", () => ({
	HIGHLIGHTER: { preferredHighlighter: "shiki-js" },
	PIERRE_THEME_NAME: "prreview-primer",
}));

const FILE: FileDiffDto = {
	id: "file-1",
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
			header: "@@ -1,2 +1,2 @@",
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
};

const CHANGESET: ChangesetDto = {
	ref: {
		source: { kind: "worktree" },
		baseSha: "base",
		headSha: null,
		resolvedAt: "2026-08-22T00:00:00.000Z",
	},
	announce: { resolved: "worktree" },
	files: [FILE],
};

const EXPLANATION: ExplanationDto = {
	id: "explanation-0",
	path: "src/app.ts",
	startLine: 2,
	endLine: 2,
	says: ["The change now does this."],
	placement: { kind: "exact", fileId: "file-1", side: "new", line: 2 },
};

const ACTIONS: FindingActions = {
	onEdit: () => {},
	onDelete: () => {},
	onRestore: () => {},
	reworkProposal: null,
	onAcceptRework: () => {},
	onDismissRework: () => {},
};

function workspace(overrides: {
	explanations: readonly ExplanationDto[];
	showExplanations: boolean;
	explanationsMode?: "chips" | "margin";
}) {
	return (
		<DiffWorkspace
			api={{ baseUrl: "" } as never}
			changeset={CHANGESET}
			renderedFiles={[FILE]}
			foldedFileIds={new Set()}
			onToggleFold={() => {}}
			handleRef={{ current: null }}
			findings={[] as readonly ReviewFindingDto[]}
			expandedFindingIds={new Set()}
			onToggleFinding={() => {}}
			actions={ACTIONS}
			explanationsMode="chips"
			{...overrides}
		/>
	);
}

function lastVersion(): number {
	const items = renderedItems.at(-1) ?? [];
	expect(items).toHaveLength(1);
	return (items[0] as { version: number }).version;
}

/**
 * Pierre reuses a file's whole rendered record — annotations included —
 * until `version` moves; if new explanations or the toggle do not bump it,
 * new prose silently never renders.
 */
describe("DiffWorkspace version counter", () => {
	it("moves when the explanations change and when the toggle flips", () => {
		const { rerender } = render(
			workspace({ explanations: [], showExplanations: true }),
		);
		const initial = lastVersion();

		rerender(
			workspace({ explanations: [EXPLANATION], showExplanations: true }),
		);
		const withExplanations = lastVersion();
		expect(withExplanations).not.toBe(initial);

		rerender(
			workspace({ explanations: [EXPLANATION], showExplanations: false }),
		);
		expect(lastVersion()).not.toBe(withExplanations);
	});

	it("moves when the explanations mode flips, so the presentation actually changes", () => {
		const { rerender } = render(
			workspace({
				explanations: [EXPLANATION],
				showExplanations: true,
				explanationsMode: "chips",
			}),
		);
		const chips = lastVersion();

		rerender(
			workspace({
				explanations: [EXPLANATION],
				showExplanations: true,
				explanationsMode: "margin",
			}),
		);
		expect(lastVersion()).not.toBe(chips);
	});
});
