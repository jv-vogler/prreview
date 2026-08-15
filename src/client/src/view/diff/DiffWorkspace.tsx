import type { BlobRequest } from "@dto/BlobRequest";
import type { FileDiffDto } from "@dto/ChangesetDto";
import type {
	CodeViewDiffItem,
	FileDiffLoadedFiles,
	FileDiffMetadata,
} from "@pierre/diffs";
import { parsePatchFiles, registerCustomCSSVariableTheme } from "@pierre/diffs";
import type { CodeViewHandle } from "@pierre/diffs/react";
import { CodeView, WorkerPoolContextProvider } from "@pierre/diffs/react";
import DiffsWorker from "@pierre/diffs/worker/worker.js?worker";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { blobSidesFor } from "../../domain/changeset/blobSidesFor";
import { buildPatchText } from "../../domain/changeset/buildPatchText";
import { getBlob } from "../../infrastructure/endpoints/getBlob";
import { useClientContainer } from "../app/ClientContainerProvider";
import { useCoverageActions } from "../coverage/CoverageProvider";
import type { DiffCursor } from "./DiffNavigationProvider";
import { useDiffNavigation } from "./DiffNavigationProvider";
import styles from "./DiffWorkspace.module.css";
import type { DiffStyle } from "./useDiffStyle";
import { useDiffViewport } from "./useDiffViewport";
import { useGuaranteedChangeset } from "./useGuaranteedChangeset";

/**
 * The one module that imports @pierre/diffs (TASK-046 / RISK-002): everything
 * Pierre-specific — theme registration, worker pool, patch parsing, the
 * loadDiffFiles blob bridge, scrolling — lives behind this wrapper.
 */

const PIERRE_THEME_NAME = "prreview-primer";
/** the spike's proven pool size; highlight throughput was never the bottleneck */
const WORKER_POOL_SIZE = 4;
const HIGHLIGHTER = {
	theme: PIERRE_THEME_NAME,
	// 'shiki-wasm' would need 'wasm-unsafe-eval' in script-src, which the CSP
	// does not grant (Spike 1)
	preferredHighlighter: "shiki-js",
} as const;

/**
 * Registered once at startup (module scope runs exactly once): every color
 * slot resolves through `var(--diffs-*)` references defined in
 * pierre-theme.css, so no defaults are needed here and a theme flip is pure
 * CSS cascade — no re-render, no re-highlight (Spike 1).
 */
registerCustomCSSVariableTheme(PIERRE_THEME_NAME, {});

export interface DiffWorkspaceProps {
	diffStyle: DiffStyle;
}

export function DiffWorkspace({ diffStyle }: DiffWorkspaceProps) {
	return (
		<WorkerPoolContextProvider
			poolOptions={{
				workerFactory: () => new DiffsWorker(),
				poolSize: WORKER_POOL_SIZE,
			}}
			highlighterOptions={HIGHLIGHTER}
		>
			<DiffCodeView diffStyle={diffStyle} />
		</WorkerPoolContextProvider>
	);
}

function DiffCodeView({ diffStyle }: DiffWorkspaceProps) {
	const { api } = useClientContainer();
	const changeset = useGuaranteedChangeset();
	const navigation = useDiffNavigation();
	const { markViewed } = useCoverageActions();
	const handleRef = useRef<CodeViewHandle<undefined>>(null);

	// files without hunks (binary, mode-only, pure renames) have no rows to
	// render; they stay in the tree but not in the code view
	const renderedFiles = useMemo(
		() => navigation.files.filter((file) => file.hunks.length > 0),
		[navigation.files],
	);

	const items = useMemo<CodeViewDiffItem<undefined>[]>(() => {
		const parsed = parsePatchFiles(
			buildPatchText(renderedFiles),
			changeset.roundId,
		);
		const parsedFiles = parsed[0]?.files ?? [];
		return renderedFiles.flatMap((file, index) => {
			const fileDiff = parsedFiles[index];
			if (fileDiff === undefined || fileDiff.name !== file.path) {
				console.error(
					`prreview: patch round-trip mismatch for ${file.path}; file skipped`,
				);
				return [];
			}
			return [{ id: file.id, type: "diff" as const, fileDiff }];
		});
	}, [renderedFiles, changeset.roundId]);

	const filesByPath = useMemo(
		() => new Map(renderedFiles.map((file) => [file.path, file])),
		[renderedFiles],
	);

	const loadDiffFiles = useCallback(
		async (metadata: FileDiffMetadata): Promise<FileDiffLoadedFiles> => {
			const file = filesByPath.get(metadata.name);
			if (file === undefined) {
				throw new Error(`unknown file requested by renderer: ${metadata.name}`);
			}
			const sides = blobSidesFor(file, changeset.ref);
			const [oldFile, newFile] = await Promise.all([
				loadSide(sides.oldSide, file.oldPath ?? file.path),
				loadSide(sides.newSide, file.path),
			]);
			return { oldFile, newFile };

			async function loadSide(side: BlobRequest | null, name: string) {
				// an absent side IS the full contents: added files have an empty
				// old side, deleted files an empty new side
				if (side === null) {
					return { name, contents: "" };
				}
				const blob = await getBlob(api, side);
				return { name: blob.name, contents: blob.contents };
			}
		},
		[api, filesByPath, changeset.ref],
	);

	const viewport = useDiffViewport({
		files: navigation.files,
		onHunksViewed: markViewed,
		onCursorFromScroll: navigation.setCursorFromScroll,
	});

	const scrollToCursor = useCallback(
		(cursor: DiffCursor) => {
			const file = navigation.files[cursor.fileIndex];
			const handle = handleRef.current;
			if (file === undefined || handle === null) {
				return;
			}
			const line = scrollLineFor(file, cursor.hunkIndex);
			if (line === null) {
				handle.scrollTo({
					type: "item",
					id: file.id,
					align: "start",
					behavior: "instant",
				});
				return;
			}
			handle.scrollTo({
				type: "line",
				id: file.id,
				lineNumber: line.lineNumber,
				side: line.side,
				align: "start",
				behavior: "instant",
			});
		},
		[navigation.files],
	);

	useEffect(
		() => navigation.registerScrollExecutor(scrollToCursor),
		[navigation.registerScrollExecutor, scrollToCursor],
	);

	// attach the core viewer once the CodeView instance exists — creation is
	// not synchronous with our mount, so poll briefly instead of assuming
	useEffect(() => {
		let cancelled = false;
		const RETRY_MS = 100;
		const tryAttach = () => {
			if (cancelled) {
				return;
			}
			const instance = handleRef.current?.getInstance();
			if (instance !== undefined) {
				viewport.attachViewer(instance);
				return;
			}
			setTimeout(tryAttach, RETRY_MS);
		};
		tryAttach();
		return () => {
			cancelled = true;
			viewport.attachViewer(null);
		};
	}, [viewport]);

	return (
		<CodeView<undefined>
			ref={handleRef}
			items={items}
			className={styles.codeView}
			onScroll={viewport.scheduleSync}
			options={{
				theme: PIERRE_THEME_NAME,
				diffStyle,
				loadDiffFiles,
				hunkSeparators: "line-info",
				stickyHeaders: true,
				preferredHighlighter: HIGHLIGHTER.preferredHighlighter,
				onPostRender: viewport.scheduleSync,
			}}
		/>
	);
}

/**
 * The scroll target for a hunk: its first changed line, on whichever side
 * has one (a pure-deletion hunk has no addition rows to land on). Hunk 0
 * returns null so file jumps land on the header instead.
 */
function scrollLineFor(
	file: FileDiffDto,
	hunkIndex: number,
): { lineNumber: number; side: "additions" | "deletions" } | null {
	if (hunkIndex === 0) {
		return null;
	}
	const hunk = file.hunks[hunkIndex];
	if (hunk === undefined) {
		return null;
	}
	for (const line of hunk.lines) {
		if (line.newLine !== undefined) {
			return { lineNumber: line.newLine, side: "additions" };
		}
		if (line.oldLine !== undefined) {
			return { lineNumber: line.oldLine, side: "deletions" };
		}
	}
	return null;
}
