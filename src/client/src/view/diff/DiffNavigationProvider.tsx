import type { FileDiffDto } from "@dto/ChangesetDto";
import type { ReactNode } from "react";
import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useRef,
	useState,
} from "react";

export interface DiffCursor {
	fileIndex: number;
	hunkIndex: number;
}

export type ScrollExecutor = (cursor: DiffCursor) => void;

export interface DiffNavigation {
	/** files in rendered (attention) order — the cursor indexes into this */
	files: readonly FileDiffDto[];
	cursor: DiffCursor;
	nextFile(): void;
	prevFile(): void;
	nextHunk(): void;
	prevHunk(): void;
	/** tree click: select a file and scroll to it */
	jumpToFile(fileIndex: number): void;
	/** URL restore: select and scroll to an exact position */
	jumpTo(cursor: DiffCursor): void;
	/** scroll feedback: update the cursor without scrolling back */
	setCursorFromScroll(cursor: DiffCursor): void;
	/** the workspace registers how "scroll to cursor" is actually performed */
	registerScrollExecutor(executor: ScrollExecutor): () => void;
}

const DiffNavigationContext = createContext<DiffNavigation | null>(null);

/**
 * After a keyboard jump, ignore scroll-derived cursor updates briefly so the
 * smooth landing does not fight the cursor it was aimed at.
 */
const SCROLL_FEEDBACK_SUPPRESS_MS = 500;

const ORIGIN_CURSOR: DiffCursor = { fileIndex: 0, hunkIndex: 0 };

export interface DiffNavigationProviderProps {
	files: readonly FileDiffDto[];
	initialCursor?: DiffCursor;
	children: ReactNode;
}

/**
 * Owns the `{fileIndex, hunkIndex}` cursor (TASK-050), kept in sync with
 * scrolling in both directions: navigation actions scroll the workspace
 * through a registered executor, and the workspace feeds scroll positions
 * back through `setCursorFromScroll`.
 *
 * `j`/`k` step through files that have hunks; `n`/`p` walk hunks in reading
 * order across file boundaries. Files without hunks (binary, mode-only) are
 * listed in the tree but hold nothing to read, so the keyboard skips them.
 */
export function DiffNavigationProvider({
	files,
	initialCursor,
	children,
}: DiffNavigationProviderProps) {
	const [cursor, setCursor] = useState<DiffCursor>(
		() => clampCursor(files, initialCursor) ?? ORIGIN_CURSOR,
	);
	const executorRef = useRef<ScrollExecutor | null>(null);
	const suppressFeedbackUntilRef = useRef(0);

	const moveTo = useCallback((target: DiffCursor) => {
		setCursor(target);
		suppressFeedbackUntilRef.current = Date.now() + SCROLL_FEEDBACK_SUPPRESS_MS;
		executorRef.current?.(target);
	}, []);

	const value = useMemo<DiffNavigation>(() => {
		const fileHasHunks = (fileIndex: number) =>
			(files[fileIndex]?.hunks.length ?? 0) > 0;

		const nearestHunkedFile = (from: number, step: 1 | -1) => {
			for (
				let candidate = from;
				candidate >= 0 && candidate < files.length;
				candidate += step
			) {
				if (fileHasHunks(candidate)) {
					return candidate;
				}
			}
			return null;
		};

		return {
			files,
			cursor,
			nextFile() {
				const target = nearestHunkedFile(cursor.fileIndex + 1, 1);
				if (target !== null) {
					moveTo({ fileIndex: target, hunkIndex: 0 });
				}
			},
			prevFile() {
				const target = nearestHunkedFile(cursor.fileIndex - 1, -1);
				if (target !== null) {
					moveTo({ fileIndex: target, hunkIndex: 0 });
				}
			},
			nextHunk() {
				const currentFile = files[cursor.fileIndex];
				if (
					currentFile !== undefined &&
					cursor.hunkIndex + 1 < currentFile.hunks.length
				) {
					moveTo({
						fileIndex: cursor.fileIndex,
						hunkIndex: cursor.hunkIndex + 1,
					});
					return;
				}
				const target = nearestHunkedFile(cursor.fileIndex + 1, 1);
				if (target !== null) {
					moveTo({ fileIndex: target, hunkIndex: 0 });
				}
			},
			prevHunk() {
				if (cursor.hunkIndex > 0) {
					moveTo({
						fileIndex: cursor.fileIndex,
						hunkIndex: cursor.hunkIndex - 1,
					});
					return;
				}
				const target = nearestHunkedFile(cursor.fileIndex - 1, -1);
				if (target !== null) {
					moveTo({
						fileIndex: target,
						hunkIndex: (files[target]?.hunks.length ?? 1) - 1,
					});
				}
			},
			jumpToFile(fileIndex) {
				if (fileIndex >= 0 && fileIndex < files.length) {
					moveTo({ fileIndex, hunkIndex: 0 });
				}
			},
			jumpTo(target) {
				const clamped = clampCursor(files, target);
				if (clamped !== null) {
					moveTo(clamped);
				}
			},
			setCursorFromScroll(observed) {
				if (Date.now() < suppressFeedbackUntilRef.current) {
					return;
				}
				setCursor((current) =>
					current.fileIndex === observed.fileIndex &&
					current.hunkIndex === observed.hunkIndex
						? current
						: observed,
				);
			},
			registerScrollExecutor(executor) {
				executorRef.current = executor;
				return () => {
					if (executorRef.current === executor) {
						executorRef.current = null;
					}
				};
			},
		};
	}, [files, cursor, moveTo]);

	return (
		<DiffNavigationContext.Provider value={value}>
			{children}
		</DiffNavigationContext.Provider>
	);
}

export function useDiffNavigation(): DiffNavigation {
	const navigation = useContext(DiffNavigationContext);
	if (navigation === null) {
		throw new Error(
			"useDiffNavigation must be used inside a DiffNavigationProvider",
		);
	}
	return navigation;
}

function clampCursor(
	files: readonly FileDiffDto[],
	cursor: DiffCursor | undefined,
): DiffCursor | null {
	if (cursor === undefined || files.length === 0) {
		return null;
	}
	const fileIndex = Math.min(Math.max(cursor.fileIndex, 0), files.length - 1);
	const hunkCount = files[fileIndex]?.hunks.length ?? 0;
	const hunkIndex = Math.min(
		Math.max(cursor.hunkIndex, 0),
		Math.max(hunkCount - 1, 0),
	);
	return { fileIndex, hunkIndex };
}
