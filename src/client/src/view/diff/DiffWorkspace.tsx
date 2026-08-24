import type { BlobRequest } from "@dto/BlobRequest";
import type { ChangesetDto, FileDiffDto } from "@dto/ChangesetDto";
import type { CommentAnchorSideDto, ReviewCommentDto } from "@dto/ReviewDto";
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
	groupPlacedComments,
	placedComments,
} from "../../domain/review/placedComments";
import { getBlob } from "../../infrastructure/endpoints/getBlob";
import type { ApiClient } from "../../infrastructure/httpClients/apiClient";
import { HIGHLIGHTER, PIERRE_THEME_NAME } from "../app/WorkerPoolHost";
import type { CommentActions } from "../review/CommentActions";
import { DiffCommentAnnotation } from "../review/DiffCommentAnnotation";
import { PIERRE_DIFF_CHROME_CSS } from "../styling/pierreChromeCss";
import styles from "./DiffWorkspace.module.css";
import { FileFoldChevron } from "./FileFoldChevron";
import { useHeaderFoldClicks } from "./useHeaderFoldClicks";

/** the annotation metadata carried per rendered diff line (TASK-043) */
interface DiffAnnotationMeta {
	commentIds: string[];
}

export interface DiffWorkspaceHandle {
	scrollToFile(fileId: string): void;
	scrollToComment(comment: ReviewCommentDto): void;
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
	comments: readonly ReviewCommentDto[];
	expandedCommentIds: ReadonlySet<string>;
	onToggleComment(commentId: string): void;
	actions: CommentActions;
}

const ANNOTATION_SIDE: Record<CommentAnchorSideDto, "deletions" | "additions"> =
	{
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
	comments,
	expandedCommentIds,
	onToggleComment,
	actions,
}: DiffWorkspaceProps) {
	const codeViewRef = useRef<CodeViewHandle<DiffAnnotationMeta>>(null);
	const containerRef = useRef<HTMLDivElement>(null);

	const cacheKeyPrefix = `${changeset.ref.baseSha}-${changeset.ref.headSha ?? "worktree"}`;

	const commentsById = useMemo(
		() => new Map(comments.map((comment) => [comment.id, comment])),
		[comments],
	);

	const annotationsByFileId = useMemo(() => {
		const groups = groupPlacedComments(placedComments(comments));
		const byFile = new Map<string, DiffLineAnnotation<DiffAnnotationMeta>[]>();
		for (const group of groups) {
			const forFile = byFile.get(group.fileId) ?? [];
			forFile.push({
				side: ANNOTATION_SIDE[group.side],
				lineNumber: group.line,
				metadata: { commentIds: group.commentIds },
			});
			byFile.set(group.fileId, forFile);
		}
		return byFile;
	}, [comments]);

	// Pierre reuses a file's whole rendered record — annotations included —
	// until `version` moves (see the comment at its use below), so a new
	// pass's comments need their own bump distinct from the fold bit.
	const commentsRevisionRef = useRef(0);
	const previousCommentsRef = useRef(comments);
	if (previousCommentsRef.current !== comments) {
		previousCommentsRef.current = comments;
		commentsRevisionRef.current += 1;
	}
	const commentsRevision = commentsRevisionRef.current;

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
					version: (collapsed ? 1 : 0) + commentsRevision * 2,
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
		commentsRevision,
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

	handleRef.current = {
		scrollToFile: (fileId) => {
			codeViewRef.current?.scrollTo({
				type: "item",
				id: fileId,
				align: "start",
				behavior: "instant",
			});
		},
		scrollToComment: (comment) => {
			if (comment.placement.kind === "unplaceable") {
				return;
			}
			codeViewRef.current?.scrollTo({
				type: "line",
				id: comment.placement.fileId,
				lineNumber: comment.placement.line,
				side: ANNOTATION_SIDE[comment.placement.side],
				align: "center",
				behavior: "smooth",
			});
		},
	};

	return (
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
				<DiffCommentAnnotation
					commentIds={annotation.metadata.commentIds}
					commentsById={commentsById}
					expandedCommentIds={expandedCommentIds}
					onToggle={onToggleComment}
					actions={actions}
				/>
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
	);
}
