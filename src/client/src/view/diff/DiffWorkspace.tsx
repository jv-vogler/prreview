import type { BlobRequest } from "@dto/BlobRequest";
import type { ChangesetDto, FileDiffDto } from "@dto/ChangesetDto";
import type {
	AnchorSideDto,
	ExplanationDto,
	ReviewFindingDto,
} from "@dto/ReviewDto";
import type {
	CodeViewDiffItem,
	DiffLineAnnotation,
	FileDiffLoadedFiles,
	FileDiffMetadata,
} from "@pierre/diffs";
import { parsePatchFiles } from "@pierre/diffs";
import type { CodeViewHandle } from "@pierre/diffs/react";
import { CodeView } from "@pierre/diffs/react";
import { useCallback, useMemo, useRef } from "react";
import { blobSidesFor } from "../../domain/changeset/blobSidesFor";
import { buildPatchText } from "../../domain/changeset/buildPatchText";
import {
	groupPlacedExplanations,
	placedExplanations,
} from "../../domain/explanation/placedExplanations";
import { topicColorsFor } from "../../domain/explanation/topicColors";
import {
	groupPlacedFindings,
	placedFindings,
} from "../../domain/finding/placedFindings";
import { getBlob } from "../../infrastructure/endpoints/getBlob";
import type { ApiClient } from "../../infrastructure/httpClients/apiClient";
import { HIGHLIGHTER, PIERRE_THEME_NAME } from "../app/WorkerPoolHost";
import { DiffFindingAnnotation } from "../review/comments/DiffFindingAnnotation";
import type { FindingActions } from "../review/comments/FindingActions";
import {
	DiffExplanationAnnotation,
	type ExplanationsMode,
} from "../review/explanations/DiffExplanationAnnotation";
import {
	createExplanationCardLayout,
	ExplanationCardLayoutContext,
} from "../review/explanations/explanationCardLayout";
import { PIERRE_DIFF_CHROME_CSS } from "../styling/pierreChromeCss";
import styles from "./DiffWorkspace.module.css";
import { FileFoldChevron } from "./FileFoldChevron";
import { useHeaderFoldClicks } from "./useHeaderFoldClicks";

/** the annotation metadata carried per rendered diff line (TASK-043) */
interface DiffAnnotationMeta {
	findingIds: string[];
	explanationIds: string[];
}

export interface DiffWorkspaceHandle {
	scrollToFile(fileId: string): void;
	scrollToFinding(finding: ReviewFindingDto): void;
	scrollToExplanation(explanation: ExplanationDto): void;
}

export interface DiffWorkspaceProps {
	api: ApiClient;
	changeset: ChangesetDto;
	/** files without hunks (binary, mode-only, pure renames) have no rows to render */
	renderedFiles: readonly FileDiffDto[];
	foldedFileIds: ReadonlySet<string>;
	onToggleFold(fileId: string): void;
	handleRef: React.RefObject<DiffWorkspaceHandle | null>;
	/** every comment for the pass on screen, placed or not (unplaced ones carry no annotation) */
	findings: readonly ReviewFindingDto[];
	expandedFindingIds: ReadonlySet<string>;
	onToggleFinding(findingId: string): void;
	actions: FindingActions;
	/** the pass's change explanations; unplaceable ones carry no annotation */
	explanations: readonly ExplanationDto[];
	/** the one header toggle: off drops the explanations entirely */
	showExplanations: boolean;
	/** chips fold behind a right-edge marker; margin keeps the cards open */
	explanationsMode: ExplanationsMode;
}

const ANNOTATION_SIDE: Record<AnchorSideDto, "deletions" | "additions"> = {
	old: "deletions",
	new: "additions",
};

/** The one screen's renderer: Pierre's virtualized CodeView over the resolved changeset. */
export function DiffWorkspace({
	api,
	changeset,
	renderedFiles,
	foldedFileIds,
	onToggleFold,
	handleRef,
	findings,
	expandedFindingIds,
	onToggleFinding,
	actions,
	explanations,
	showExplanations,
	explanationsMode,
}: DiffWorkspaceProps) {
	const codeViewRef = useRef<CodeViewHandle<DiffAnnotationMeta>>(null);
	const containerRef = useRef<HTMLDivElement>(null);

	const cacheKeyPrefix = `${changeset.ref.baseSha}-${changeset.ref.headSha ?? "worktree"}`;

	const findingsById = useMemo(
		() => new Map(findings.map((finding) => [finding.id, finding])),
		[findings],
	);

	const explanationsById = useMemo(
		() =>
			new Map(explanations.map((explanation) => [explanation.id, explanation])),
		[explanations],
	);

	// one annotation per line carries both kinds: the hidden state drops the
	// explanation groups entirely, so a line with only explanations loses its
	// annotation rather than rendering an empty slot
	const annotationsByFileId = useMemo(() => {
		const merged = new Map<
			string,
			{
				fileId: string;
				side: AnchorSideDto;
				line: number;
				meta: DiffAnnotationMeta;
			}
		>();
		const at = (fileId: string, side: AnchorSideDto, line: number) => {
			const key = `${fileId}:${side}:${line}`;
			let entry = merged.get(key);
			if (entry === undefined) {
				entry = {
					fileId,
					side,
					line,
					meta: { findingIds: [], explanationIds: [] },
				};
				merged.set(key, entry);
			}
			return entry;
		};
		if (showExplanations) {
			for (const group of groupPlacedExplanations(
				placedExplanations(explanations),
			)) {
				at(group.fileId, group.side, group.line).meta.explanationIds.push(
					...group.explanationIds,
				);
			}
		}
		for (const group of groupPlacedFindings(placedFindings(findings))) {
			at(group.fileId, group.side, group.line).meta.findingIds.push(
				...group.findingIds,
			);
		}
		const byFile = new Map<string, DiffLineAnnotation<DiffAnnotationMeta>[]>();
		for (const entry of merged.values()) {
			const forFile = byFile.get(entry.fileId) ?? [];
			forFile.push({
				side: ANNOTATION_SIDE[entry.side],
				lineNumber: entry.line,
				metadata: entry.meta,
			});
			byFile.set(entry.fileId, forFile);
		}
		return byFile;
	}, [findings, explanations, showExplanations]);

	// Pierre reuses a file's whole rendered record — annotations included —
	// until `version` moves (see the comment at its use below), so a new
	// pass's comments, its explanations, the show/hide toggle and the
	// explanations mode all need their own bump distinct from the fold bit.
	const findingsRevisionRef = useRef(0);
	const previousAnnotationsRef = useRef(annotationsByFileId);
	const previousModeRef = useRef(explanationsMode);
	if (
		previousAnnotationsRef.current !== annotationsByFileId ||
		previousModeRef.current !== explanationsMode
	) {
		previousAnnotationsRef.current = annotationsByFileId;
		previousModeRef.current = explanationsMode;
		findingsRevisionRef.current += 1;
	}
	const findingsRevision = findingsRevisionRef.current;

	const items = useMemo<CodeViewDiffItem<DiffAnnotationMeta>[]>(() => {
		const parsed = parsePatchFiles(
			buildPatchText(renderedFiles),
			cacheKeyPrefix,
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
			const collapsed = foldedFileIds.has(file.id);
			return [
				{
					id: file.id,
					type: "diff" as const,
					fileDiff,
					// the renderer reuses a file's rendered record — including its
					// annotations — until this number moves, so both a fold and a
					// new pass's comments have to be encoded into it
					version: (collapsed ? 1 : 0) + findingsRevision * 2,
					collapsed,
					annotations: annotationsByFileId.get(file.id),
				},
			];
		});
	}, [
		renderedFiles,
		cacheKeyPrefix,
		foldedFileIds,
		annotationsByFileId,
		findingsRevision,
	]);

	const filesByPath = useMemo(
		() => new Map(renderedFiles.map((file) => [file.path, file])),
		[renderedFiles],
	);
	const filesById = useMemo(
		() => new Map(renderedFiles.map((file) => [file.id, file])),
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

	useHeaderFoldClicks(containerRef, onToggleFold);

	// every open card stack positions through one shared layout, so stacks
	// on nearby lines can see each other (explanationCardLayout.ts)
	const cardLayout = useMemo(() => createExplanationCardLayout(), []);
	const topicColors = useMemo(
		() => topicColorsFor(explanations),
		[explanations],
	);

	handleRef.current = {
		scrollToFile: (fileId) => {
			codeViewRef.current?.scrollTo({
				type: "item",
				id: fileId,
				align: "start",
				behavior: "instant",
			});
		},
		scrollToFinding: (finding) => {
			if (finding.placement.kind === "unplaceable") {
				return;
			}
			codeViewRef.current?.scrollTo({
				type: "line",
				id: finding.placement.fileId,
				lineNumber: finding.placement.line,
				side: ANNOTATION_SIDE[finding.placement.side],
				align: "center",
				behavior: "smooth",
			});
		},
		scrollToExplanation: (explanation) => {
			if (explanation.placement.kind === "unplaceable") {
				return;
			}
			codeViewRef.current?.scrollTo({
				type: "line",
				id: explanation.placement.fileId,
				lineNumber: explanation.placement.line,
				side: ANNOTATION_SIDE[explanation.placement.side],
				align: "center",
				behavior: "smooth",
			});
		},
	};

	return (
		<ExplanationCardLayoutContext.Provider value={cardLayout}>
			<CodeView<DiffAnnotationMeta>
				ref={codeViewRef}
				containerRef={containerRef}
				items={items}
				className={styles.codeView}
				// the far-left slot, immediately before the change-type icon
				renderHeaderPrefix={(item) => {
					const file = filesById.get(item.id);
					if (file === undefined) {
						return null;
					}
					return (
						<FileFoldChevron
							fileId={file.id}
							path={file.path}
							folded={foldedFileIds.has(file.id)}
							onToggle={onToggleFold}
						/>
					);
				}}
				renderAnnotation={(annotation) => (
					<>
						<DiffExplanationAnnotation
							mode={explanationsMode}
							topicColors={topicColors}
							explanations={annotation.metadata.explanationIds
								.map((id) => explanationsById.get(id))
								.filter(
									(explanation): explanation is ExplanationDto =>
										explanation !== undefined,
								)}
						/>
						<DiffFindingAnnotation
							findingIds={annotation.metadata.findingIds}
							findingsById={findingsById}
							expandedFindingIds={expandedFindingIds}
							onToggle={onToggleFinding}
							actions={actions}
						/>
					</>
				)}
				options={{
					theme: PIERRE_THEME_NAME,
					diffStyle: "unified",
					diffIndicators: "classic",
					loadDiffFiles,
					hunkSeparators: "line-info",
					stickyHeaders: true,
					unsafeCSS: PIERRE_DIFF_CHROME_CSS,
					preferredHighlighter: HIGHLIGHTER.preferredHighlighter,
				}}
			/>
		</ExplanationCardLayoutContext.Provider>
	);
}
