// @vitest-environment jsdom
import type { FileDiffDto } from "@dto/ChangesetDto";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiffViewer } from "./useDiffViewport";
import { useDiffViewport } from "./useDiffViewport";

const ROW_HEIGHT = 20;
/** the pane the rows are scrolled inside */
const ROOT_WIDTH = 1120;
/**
 * A file whose widest line dwarfs the pane: Pierre gives every row in a file
 * the file's full horizontal scroll width, so one long line makes all of them
 * this wide. Horizontal clipping alone then caps the intersected *area* ratio
 * at ROOT_WIDTH / WIDE_ROW_WIDTH — far below any useful threshold.
 */
const WIDE_ROW_WIDTH = 4517;

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
			id: "hunk-wide",
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
	],
};

interface ObserverStub {
	callback: IntersectionObserverCallback;
	observed: Element[];
}

let observers: ObserverStub[] = [];

class FakeIntersectionObserver {
	constructor(callback: IntersectionObserverCallback) {
		this.stub = { callback, observed: [] };
		observers.push(this.stub);
	}
	private readonly stub: ObserverStub;
	observe(target: Element) {
		this.stub.observed.push(target);
	}
	unobserve() {}
	disconnect() {}
}

function createViewer(): DiffViewer {
	const container = document.createElement("div");
	container.getBoundingClientRect = () => new DOMRect(0, 0, ROOT_WIDTH, 900);
	const item = document.createElement("div");
	const shadow = item.attachShadow({ mode: "open" });
	for (const line of [182, 183]) {
		const row = document.createElement("div");
		row.setAttribute("data-line", String(line));
		row.getBoundingClientRect = () =>
			new DOMRect(0, 0, WIDE_ROW_WIDTH, ROW_HEIGHT);
		shadow.append(row);
	}
	container.append(item);
	document.body.append(container);
	return {
		getRenderedItems: () => [{ id: file.id, element: item }],
		getContainerElement: () => container,
	};
}

/** an entry for a row that is `visibleHeight` px tall on screen */
function entryFor(target: Element, visibleHeight: number) {
	return {
		target,
		isIntersecting: visibleHeight > 0,
		boundingClientRect: new DOMRect(0, 0, WIDE_ROW_WIDTH, ROW_HEIGHT),
		intersectionRect: new DOMRect(0, 0, ROOT_WIDTH, visibleHeight),
	} as unknown as IntersectionObserverEntry;
}

beforeEach(() => {
	observers = [];
	vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	document.body.replaceChildren();
});

function mountViewport(onHunksViewed: (ids: readonly string[]) => void) {
	const rendered = renderHook(() =>
		useDiffViewport({
			files: [file],
			onHunksViewed,
			onCursorFromScroll: () => {},
		}),
	);
	act(() => {
		rendered.result.current.attachViewer(createViewer());
		vi.runAllTimers();
	});
	return observers[0];
}

describe("useDiffViewport", () => {
	it("marks a row read on vertical visibility even when it is far wider than the pane", () => {
		const onHunksViewed = vi.fn();
		const observer = mountViewport(onHunksViewed);
		expect(observer.observed.length).toBeGreaterThan(0);

		// fully visible top to bottom; the intersected area is only ~24% of the
		// row because the row extends well past the pane horizontally.
		act(() => {
			observer.callback(
				[entryFor(observer.observed[0], ROW_HEIGHT)],
				{} as IntersectionObserver,
			);
		});

		expect(onHunksViewed).toHaveBeenCalledWith(["hunk-wide"]);
	});

	it("ignores a row only slightly on screen", () => {
		const onHunksViewed = vi.fn();
		const observer = mountViewport(onHunksViewed);

		act(() => {
			observer.callback(
				[entryFor(observer.observed[0], ROW_HEIGHT * 0.2)],
				{} as IntersectionObserver,
			);
		});

		expect(onHunksViewed).not.toHaveBeenCalled();
	});

	it("marks a row read once half its height is on screen", () => {
		const onHunksViewed = vi.fn();
		const observer = mountViewport(onHunksViewed);

		act(() => {
			observer.callback(
				[entryFor(observer.observed[0], ROW_HEIGHT * 0.5)],
				{} as IntersectionObserver,
			);
		});

		expect(onHunksViewed).toHaveBeenCalledWith(["hunk-wide"]);
	});
});
