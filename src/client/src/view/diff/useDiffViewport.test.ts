// @vitest-environment jsdom
import type { FileDiffDto } from "@dto/ChangesetDto";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiffViewer } from "./useDiffViewport";
import { useDiffViewport } from "./useDiffViewport";

/**
 * What survives of this hook after coverage stopped being inferred.
 *
 * It used to also drive an IntersectionObserver that marked hunks *viewed* as
 * their rows crossed the viewport, and most of this file tested that: whether a
 * row wider than the pane still counted, where the half-height threshold sat.
 * All of it measured the wrong thing — scrolling past code is not reading it —
 * and the mechanism is gone. Reading state is now a box a person ticks
 * (FileViewedToggle), and this hook only answers "where is the reader looking".
 */

const ROW_HEIGHT = 20;
const ROOT_WIDTH = 1120;
const ROW_WIDTH = 4517;

const file: FileDiffDto = {
	id: "f_wide",
	path: "docs/table.md",
	status: "modified",
	additions: 1,
	deletions: 1,
	isBinary: false,
	isGenerated: false,
	oldBlob: null,
	newBlob: null,
	hunks: [
		{
			id: "hunk-one",
			header: "@@ -182,2 +182,2 @@",
			oldStart: 182,
			oldLines: 2,
			newStart: 182,
			newLines: 2,
			lines: [
				{ type: "context", content: "| a | b |", oldLine: 182, newLine: 182 },
				{ type: "del", content: "| old |", oldLine: 183 },
				{ type: "add", content: "| new |", newLine: 183 },
			],
		},
		{
			id: "hunk-two",
			header: "@@ -300,1 +300,1 @@",
			oldStart: 300,
			oldLines: 1,
			newStart: 300,
			newLines: 1,
			lines: [{ type: "add", content: "| later |", newLine: 300 }],
		},
	],
};

/** rows laid out top to bottom, the first one scrolled just off the pane */
function createViewer(topsByLine: Record<number, number>): DiffViewer {
	const container = document.createElement("div");
	container.getBoundingClientRect = () => new DOMRect(0, 0, ROOT_WIDTH, 900);
	const item = document.createElement("div");
	const shadow = item.attachShadow({ mode: "open" });
	for (const [line, top] of Object.entries(topsByLine)) {
		const row = document.createElement("div");
		row.setAttribute("data-line", line);
		row.getBoundingClientRect = () =>
			new DOMRect(0, top, ROW_WIDTH, ROW_HEIGHT);
		shadow.append(row);
	}
	container.append(item);
	document.body.append(container);
	return {
		getRenderedItems: () => [{ id: file.id, element: item }],
		getContainerElement: () => container,
	};
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	document.body.replaceChildren();
});

function mountViewport(
	topsByLine: Record<number, number>,
	onCursorFromScroll: (cursor: {
		fileIndex: number;
		hunkIndex: number;
	}) => void,
) {
	const rendered = renderHook(() =>
		useDiffViewport({ files: [file], onCursorFromScroll }),
	);
	act(() => {
		rendered.result.current.attachViewer(createViewer(topsByLine));
		vi.runAllTimers();
	});
	return rendered;
}

describe("useDiffViewport", () => {
	it("reports the topmost visible hunk as the cursor", () => {
		const onCursorFromScroll = vi.fn();
		mountViewport({ 182: 10, 300: 400 }, onCursorFromScroll);

		expect(onCursorFromScroll).toHaveBeenCalledWith({
			fileIndex: 0,
			hunkIndex: 0,
		});
	});

	/** the reader scrolled past the first hunk: the cursor follows, not the DOM order */
	it("skips a hunk scrolled above the pane", () => {
		const onCursorFromScroll = vi.fn();
		mountViewport({ 182: -100, 300: 40 }, onCursorFromScroll);

		expect(onCursorFromScroll).toHaveBeenCalledWith({
			fileIndex: 0,
			hunkIndex: 1,
		});
	});

	it("reports nothing when the viewer has no rows", () => {
		const onCursorFromScroll = vi.fn();
		mountViewport({}, onCursorFromScroll);

		expect(onCursorFromScroll).not.toHaveBeenCalled();
	});
});
