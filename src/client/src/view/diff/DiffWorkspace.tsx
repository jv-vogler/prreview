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
import type {
	AnnotationCard,
	PlacedAnnotation,
} from "../../domain/annotation/placeAnnotations";
import { placeAnnotations } from "../../domain/annotation/placeAnnotations";
import { blobSidesFor } from "../../domain/changeset/blobSidesFor";
import { buildPatchText } from "../../domain/changeset/buildPatchText";
import { getBlob } from "../../infrastructure/endpoints/getBlob";
import { ExplanationNote } from "../annotations/ExplanationNote";
import { UnanchoredTray } from "../annotations/UnanchoredTray";
import { useAnnotations } from "../annotations/useAnnotations";
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

/**
 * What the renderer carries per annotation. A wrapper object rather than the
 * card union itself: Pierre's `OptionalMetadata<T>` is a conditional type, so a
 * union metadata would distribute and demand one specific card kind.
 */
interface AnnotationMetadata {
	card: AnnotationCard;
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
	const annotations = useAnnotations();
	const handleRef = useRef<CodeViewHandle<AnnotationMetadata>>(null);

	// files without hunks (binary, mode-only, pure renames) have no rows to
	// render; they stay in the tree but not in the code view
	const renderedFiles = useMemo(
		() => navigation.files.filter((file) => file.hunks.length > 0),
		[navigation.files],
	);

	// where every note hangs, decided by the domain; this module only hands the
	// result to the renderer (ARCHITECTURE §6, consumer 1)
	const placedByFileId = useMemo(
		() => placeAnnotations(annotations),
		[annotations],
	);

	const items = useMemo<CodeViewDiffItem<AnnotationMetadata>[]>(() => {
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
			const placed = placedByFileId.get(file.id) ?? [];
			return [
				{
					id: file.id,
					type: "diff" as const,
					fileDiff,
					version: annotationsVersion(placed),
					annotations: placed.map((entry) => ({
						side: entry.side,
						lineNumber: entry.lineNumber,
						metadata: { card: entry.card },
					})),
				},
			];
		});
	}, [renderedFiles, changeset.roundId, placedByFileId]);

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
		<CodeView<AnnotationMetadata>
			ref={handleRef}
			items={items}
			className={styles.codeView}
			onScroll={viewport.scheduleSync}
			renderAnnotation={(annotation) => renderCard(annotation.metadata.card)}
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

/** 32-bit FNV-1a constants: a content signature, not a cryptographic hash */
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const NO_ANNOTATIONS_VERSION = 0;

/**
 * The renderer reuses a file's rendered record until that item's `version`
 * changes, so notes arriving mid-run appear only if the version moves with
 * them. Derived from what is actually placed rather than from a counter, so the
 * number a reload computes is the number the previous render had, and an
 * unchanged file is never re-laid-out.
 */
function annotationsVersion(placed: readonly PlacedAnnotation[]): number {
	if (placed.length === 0) {
		return NO_ANNOTATIONS_VERSION;
	}
	let hash = FNV_OFFSET_BASIS;
	for (const entry of placed) {
		const ids =
			entry.card.kind === "note"
				? entry.card.note.id + entry.card.note.anchorStatus
				: entry.card.notes.map((note) => note.id).join(",");
		const signature = `${entry.side}:${entry.lineNumber}:${entry.card.kind}:${ids};`;
		for (let at = 0; at < signature.length; at++) {
			hash ^= signature.charCodeAt(at);
			hash = Math.imul(hash, FNV_PRIME);
		}
	}
	// zero means "no notes", so a signature that lands there borrows the next one
	return hash >>> 0 || 1;
}

/**
 * The renderer calls this through a React portal for every annotation it lays
 * out, so the cards are ordinary components with variable heights (proven by
 * the Pierre spike).
 */
function renderCard(card: AnnotationCard) {
	if (card.kind === "unanchored") {
		return <UnanchoredTray notes={card.notes} />;
	}
	return <ExplanationNote note={card.note} />;
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
