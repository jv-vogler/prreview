import type { FileDiffDto } from "@dto/ChangesetDto";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { FileLineIndex } from "../../domain/changeset/buildLineIndex";
import { buildLineIndex } from "../../domain/changeset/buildLineIndex";
import type { DiffCursor } from "./DiffNavigationProvider";

/**
 * The slice of Pierre's core viewer this hook needs, typed structurally so
 * DiffWorkspace stays the single module importing @pierre/diffs (TASK-046).
 */
export interface DiffViewer {
	getRenderedItems(): ReadonlyArray<{ id: string; element: HTMLElement }>;
	getContainerElement(): HTMLElement | undefined;
}

export interface DiffViewportOptions {
	/** files in rendered order; item ids are the file ids */
	files: readonly FileDiffDto[];
	onHunksViewed(hunkIds: readonly string[]): void;
	onCursorFromScroll(cursor: DiffCursor): void;
}

export interface DiffViewport {
	attachViewer(viewer: DiffViewer | null): void;
	/** call on every scroll and render pass — cheap, self-throttled */
	scheduleSync(): void;
}

const SYNC_THROTTLE_MS = 150;
/** a row counts as read once at least half of its height has been on screen */
const ROW_VIEWED_THRESHOLD = 0.5;
/**
 * Notify on every crossing and as visibility grows; `isRowRead` applies the
 * real rule. A single ratio would not do: the observer measures intersected
 * *area*, which horizontal clipping alone can hold below any positive value.
 */
const ROW_INTERSECTION_STEPS = [0, 0.25, 0.5, 0.75, 1];
/** rows this close to the container top define the cursor position */
const CURSOR_PROBE_OFFSET_PX = 2;

interface RowContext {
	fileIndex: number;
	hunkIndex: number;
}

/**
 * Whether enough of a row has been on screen to count as read.
 *
 * Deliberately measured on the vertical axis alone: a row spans the widest
 * line in its file, so a single long line makes every row in that file many
 * times wider than the pane, and an area-based `threshold` would then be
 * capped below 0.5 by horizontal clipping no matter how the reader scrolls.
 * Row width is unbounded and outside our control; row height is what "seen"
 * actually means here.
 */
function isRowRead(entry: IntersectionObserverEntry): boolean {
	const rowHeight = entry.boundingClientRect.height;
	if (rowHeight === 0) {
		return false;
	}
	return entry.intersectionRect.height >= rowHeight * ROW_VIEWED_THRESHOLD;
}

/**
 * Watches Pierre's virtualized rows (TASK-048, TASK-050): an
 * IntersectionObserver marks hunks viewed as their rows become visible, and a
 * throttled scan of the same rows reports the topmost visible hunk as the
 * scroll-synced cursor. Rows mount and unmount with virtualization, so the
 * observed set is re-synced on every scroll/render pass; row → hunk
 * resolution goes through stable file line numbers (buildLineIndex), which
 * survive context expansion where rendered row indices do not.
 */
export function useDiffViewport(options: DiffViewportOptions): DiffViewport {
	const { files, onHunksViewed, onCursorFromScroll } = options;

	const viewerRef = useRef<DiffViewer | null>(null);
	const observerRef = useRef<IntersectionObserver | null>(null);
	const observedRowsRef = useRef(new WeakSet<Element>());
	const rowContextsRef = useRef(new WeakMap<Element, RowContext>());
	const lastSyncAtRef = useRef(0);
	const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const filesRef = useRef(files);
	filesRef.current = files;

	const lineIndexes = useMemo<Map<string, FileLineIndex>>(
		() => new Map(files.map((file) => [file.id, buildLineIndex(file)])),
		[files],
	);
	const fileIndexById = useMemo(
		() => new Map(files.map((file, index) => [file.id, index])),
		[files],
	);

	const resolveRow = useCallback(
		(row: Element, itemId: string): RowContext | null => {
			const lineNumber = Number(row.getAttribute("data-line"));
			if (!Number.isFinite(lineNumber)) {
				return null;
			}
			const fileIndex = fileIndexById.get(itemId);
			const lineIndex = lineIndexes.get(itemId);
			if (fileIndex === undefined || lineIndex === undefined) {
				return null;
			}
			const isOldSide =
				row.closest("[data-deletions]") !== null ||
				row.getAttribute("data-line-type") === "change-deletion";
			const hunkIndex = isOldSide
				? lineIndex.oldLines.get(lineNumber)
				: (lineIndex.newLines.get(lineNumber) ??
					lineIndex.oldLines.get(lineNumber));
			if (hunkIndex === undefined) {
				return null;
			}
			return { fileIndex, hunkIndex };
		},
		[fileIndexById, lineIndexes],
	);

	const onRowsIntersecting = useCallback(
		(entries: IntersectionObserverEntry[]) => {
			const viewedHunkIds: string[] = [];
			for (const entry of entries) {
				if (!entry.isIntersecting || !isRowRead(entry)) {
					continue;
				}
				const context = rowContextsRef.current.get(entry.target);
				if (context === undefined) {
					continue;
				}
				const hunkId =
					filesRef.current[context.fileIndex]?.hunks[context.hunkIndex]?.id;
				if (hunkId !== undefined) {
					viewedHunkIds.push(hunkId);
				}
			}
			if (viewedHunkIds.length > 0) {
				onHunksViewed(viewedHunkIds);
			}
		},
		[onHunksViewed],
	);

	const syncNow = useCallback(() => {
		const viewer = viewerRef.current;
		const container = viewer?.getContainerElement();
		if (viewer == null || container == null) {
			return;
		}
		if (observerRef.current === null) {
			observerRef.current = new IntersectionObserver(onRowsIntersecting, {
				root: container,
				threshold: ROW_INTERSECTION_STEPS,
			});
		}

		const containerTop = container.getBoundingClientRect().top;
		let cursorCandidate: { top: number; context: RowContext } | null = null;

		for (const item of viewer.getRenderedItems()) {
			const shadowRoot = item.element.shadowRoot;
			if (shadowRoot === null) {
				continue;
			}
			for (const row of shadowRoot.querySelectorAll("[data-line]")) {
				let context = rowContextsRef.current.get(row);
				if (!observedRowsRef.current.has(row)) {
					context ??= resolveRow(row, item.id) ?? undefined;
					if (context === undefined) {
						continue;
					}
					rowContextsRef.current.set(row, context);
					observedRowsRef.current.add(row);
					observerRef.current.observe(row);
				}
				if (context === undefined) {
					continue;
				}
				const rowRect = row.getBoundingClientRect();
				const isBelowProbe =
					rowRect.bottom >= containerTop + CURSOR_PROBE_OFFSET_PX;
				if (
					isBelowProbe &&
					(cursorCandidate === null || rowRect.top < cursorCandidate.top)
				) {
					cursorCandidate = { top: rowRect.top, context };
				}
			}
		}

		if (cursorCandidate !== null) {
			onCursorFromScroll({
				fileIndex: cursorCandidate.context.fileIndex,
				hunkIndex: cursorCandidate.context.hunkIndex,
			});
		}
	}, [onRowsIntersecting, resolveRow, onCursorFromScroll]);

	const scheduleSync = useCallback(() => {
		const elapsed = Date.now() - lastSyncAtRef.current;
		if (syncTimerRef.current !== null) {
			return;
		}
		syncTimerRef.current = setTimeout(
			() => {
				syncTimerRef.current = null;
				lastSyncAtRef.current = Date.now();
				syncNow();
			},
			Math.max(0, SYNC_THROTTLE_MS - elapsed),
		);
	}, [syncNow]);

	useEffect(
		() => () => {
			observerRef.current?.disconnect();
			if (syncTimerRef.current !== null) {
				clearTimeout(syncTimerRef.current);
			}
		},
		[],
	);

	return useMemo<DiffViewport>(
		() => ({
			attachViewer(viewer) {
				if (viewerRef.current === viewer) {
					return;
				}
				viewerRef.current = viewer;
				observerRef.current?.disconnect();
				observerRef.current = null;
				observedRowsRef.current = new WeakSet();
				if (viewer !== null) {
					scheduleSync();
				}
			},
			scheduleSync,
		}),
		[scheduleSync],
	);
}
