import type { BlobRequest } from "@dto/BlobRequest";
import type { FileDiffDto } from "@dto/ChangesetDto";
import type {
	CodeViewDiffItem,
	FileDiffLoadedFiles,
	FileDiffMetadata,
} from "@pierre/diffs";
import { parsePatchFiles } from "@pierre/diffs";
import type { CodeViewHandle } from "@pierre/diffs/react";
import { CodeView } from "@pierre/diffs/react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type {
	AnnotationCard,
	PlacedAnnotation,
} from "../../domain/annotation/placeAnnotations";
import { placeAnnotations } from "../../domain/annotation/placeAnnotations";
import { blobSidesFor } from "../../domain/changeset/blobSidesFor";
import { buildPatchText } from "../../domain/changeset/buildPatchText";
import { getBlob } from "../../infrastructure/endpoints/getBlob";
import { useAnnotations } from "../annotations/useAnnotations";
import { useClientContainer } from "../app/ClientContainerProvider";
import { HIGHLIGHTER, PIERRE_THEME_NAME } from "../app/WorkerPoolHost";
import { useCoverageActions } from "../coverage/CoverageProvider";
import {
	FindingBalloon,
	FindingBalloonGroup,
} from "../findings/FindingBalloon";
import { useGuaranteedSession } from "../session/useGuaranteedSession";
import { PIERRE_DIFF_CHROME_CSS } from "../styling/pierreChromeCss";
import type { DiffCursor } from "./DiffNavigationProvider";
import { useDiffNavigation } from "./DiffNavigationProvider";
import styles from "./DiffWorkspace.module.css";
import { FileFoldChevron } from "./FileFoldChevron";
import { FileViewedToggle } from "./FileViewedToggle";
import { useAnimatedCollapse } from "./useAnimatedCollapse";
import type { DiffStyle } from "./useDiffStyle";
import { useDiffViewport } from "./useDiffViewport";
import { useGuaranteedChangeset } from "./useGuaranteedChangeset";
import { useHeaderFoldClicks } from "./useHeaderFoldClicks";

/**
 * The Diff tab's renderer.
 *
 * Pierre-specific concerns are split in two: the worker pool and theme
 * registration are hoisted into `WorkerPoolHost` so they outlive a tab switch,
 * and everything about *this* view — patch parsing, the loadDiffFiles blob
 * bridge, scrolling, balloons — stays here.
 */

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

/** the server's per-file percentage at which every hunk is accounted for */
const FULLY_READ_PERCENT = 100;

export function DiffWorkspace({ diffStyle }: DiffWorkspaceProps) {
	const { api } = useClientContainer();
	const changeset = useGuaranteedChangeset();
	const session = useGuaranteedSession();
	const navigation = useDiffNavigation();
	const { isFolded, isFileViewed, toggleFold } = useCoverageActions();
	const annotations = useAnnotations();
	const handleRef = useRef<CodeViewHandle<AnnotationMetadata>>(null);
	const containerRef = useRef<HTMLDivElement>(null);

	/*
	 * Read state comes from the server's coverage summary, never from a local
	 * guess: it is the same number the ring in the header shows, so the box and
	 * the percentage can never disagree, and it survives a reload because the
	 * session owns it.
	 */
	const viewedByFileId = useMemo(() => {
		const viewed = new Set<string>();
		for (const [fileId, percent] of Object.entries(session.coverage.byFile)) {
			if (percent >= FULLY_READ_PERCENT) {
				viewed.add(fileId);
			}
		}
		return viewed;
	}, [session.coverage.byFile]);

	// files without hunks (binary, mode-only, pure renames) have no rows to
	// render; they stay in the tree but not in the code view
	const renderedFiles = useMemo(
		() => navigation.files.filter((file) => file.hunks.length > 0),
		[navigation.files],
	);

	/**
	 * Where every balloon hangs, decided by the domain; this module only hands
	 * the result to the renderer (ARCHITECTURE §6, consumer 1).
	 *
	 * Findings are always shown. There used to be a checkbox for it, which meant
	 * a review someone paid for rendered only if they also found and flipped a
	 * switch — hidden by default, in other words. Explanations are filtered out
	 * unconditionally: narration belongs beside its code on the Understanding
	 * tab, and scattering it through the margin is the thing this re-model
	 * exists to undo.
	 */
	const placedByFileId = useMemo(
		() =>
			placeAnnotations(
				annotations.filter(
					(annotation) => annotation.species !== "explanation",
				),
			),
		[annotations],
	);

	/**
	 * The fold state the session asks for, which is not always the one drawn.
	 *
	 * `useAnimatedCollapse` lags this by one animation so a fold can be eased
	 * rather than cut to. Everything a person looks at — the chevron's rotation,
	 * the aria state — follows the request, because the request is what they
	 * just asked for; only the renderer is told the lagging one.
	 */
	const requestedCollapsed = useMemo(() => {
		const folded = new Set<string>();
		for (const file of renderedFiles) {
			const viewed = isFileViewed(file.id, viewedByFileId.has(file.id));
			if (isFolded(file.id, viewed)) {
				folded.add(file.id);
			}
		}
		return folded;
	}, [renderedFiles, isFolded, isFileViewed, viewedByFileId]);

	const drawnCollapsed = useAnimatedCollapse(requestedCollapsed, containerRef);

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
			const collapsed = drawnCollapsed.has(file.id);
			return [
				{
					id: file.id,
					type: "diff" as const,
					fileDiff,
					// the fold state is in the version because the renderer reuses a
					// file's rendered record until this number moves, so a fold that
					// is not in the hash is a fold that does not happen
					version: itemVersion(placed, collapsed),
					collapsed,
					annotations: placed.map((entry) => ({
						side: entry.side,
						lineNumber: entry.lineNumber,
						metadata: { card: entry.card },
					})),
				},
			];
		});
	}, [renderedFiles, changeset.roundId, placedByFileId, drawnCollapsed]);

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
		onCursorFromScroll: navigation.setCursorFromScroll,
	});

	const filesById = useMemo(
		() => new Map(renderedFiles.map((file) => [file.id, file])),
		[renderedFiles],
	);

	/**
	 * The whole header folds its file, and the fold it applies is the *effective*
	 * one — a file folded because it was ticked as viewed is folded, whatever the
	 * explicit override says, so a click on it has to open it rather than fold
	 * something that is already away.
	 */
	const toggleFileFold = useCallback(
		(fileId: string) => {
			const viewed = isFileViewed(fileId, viewedByFileId.has(fileId));
			toggleFold(fileId, isFolded(fileId, viewed));
		},
		[toggleFold, isFolded, isFileViewed, viewedByFileId],
	);
	useHeaderFoldClicks(containerRef, toggleFileFold);

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
			containerRef={containerRef}
			items={items}
			className={styles.codeView}
			onScroll={viewport.scheduleSync}
			renderAnnotation={(annotation) => renderCard(annotation.metadata.card)}
			// the far-left slot, immediately before the change-type icon
			renderHeaderPrefix={(item) => {
				const file = filesById.get(item.id);
				if (file === undefined) {
					return null;
				}
				const viewed = isFileViewed(file.id, viewedByFileId.has(file.id));
				return (
					<FileFoldChevron file={file} folded={isFolded(file.id, viewed)} />
				);
			}}
			renderHeaderMetadata={(item) => {
				const file = filesById.get(item.id);
				if (file === undefined) {
					return null;
				}
				return (
					<FileViewedToggle
						file={file}
						viewed={isFileViewed(file.id, viewedByFileId.has(file.id))}
					/>
				);
			}}
			options={{
				theme: PIERRE_THEME_NAME,
				diffStyle,
				loadDiffFiles,
				hunkSeparators: "line-info",
				stickyHeaders: true,
				unsafeCSS: PIERRE_DIFF_CHROME_CSS,
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
/** a file with nothing in its margin, folded: still a different render */
const COLLAPSED_EMPTY_VERSION = 2;

/**
 * The renderer reuses a file's rendered record until that item's `version`
 * changes, so notes arriving mid-run appear only if the version moves with
 * them — and a file folds only if the fold is in here too. Derived from what is
 * actually rendered rather than from a counter, so the number a reload computes
 * is the number the previous render had, and an unchanged file is never
 * re-laid-out.
 */
function itemVersion(
	placed: readonly PlacedAnnotation[],
	collapsed: boolean,
): number {
	if (placed.length === 0) {
		return collapsed ? COLLAPSED_EMPTY_VERSION : NO_ANNOTATIONS_VERSION;
	}
	let hash = collapsed ? FNV_OFFSET_BASIS ^ 1 : FNV_OFFSET_BASIS;
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
	// the low values are the empty cases above; a signature landing on one
	// borrows the first number nothing else claims
	const signature = hash >>> 0;
	return signature > COLLAPSED_EMPTY_VERSION ? signature : FIRST_FREE_VERSION;
}

const FIRST_FREE_VERSION = 3;

/**
 * The renderer calls this through a React portal for every annotation it lays
 * out, so the cards are ordinary components with variable heights (proven by
 * the Pierre spike).
 */
function renderCard(card: AnnotationCard) {
	if (card.kind === "unanchored") {
		return <FindingBalloonGroup notes={card.notes} />;
	}
	return <FindingBalloon note={card.note} />;
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
