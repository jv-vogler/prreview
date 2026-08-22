import type { ChangesetDto } from "@dto/ChangesetDto";
import type { ReviewCommentDto } from "@dto/ReviewDto";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getChangeset } from "../infrastructure/endpoints/getChangeset";
import { getSession } from "../infrastructure/endpoints/getSession";
import { createApiClient } from "../infrastructure/httpClients/apiClient";
import {
	DiffWorkspace,
	type DiffWorkspaceHandle,
} from "../view/diff/DiffWorkspace";
import { FileTreePanel } from "../view/diff/FileTreePanel";
import { SidebarResizer } from "../view/diff/SidebarResizer";
import { useSidebarWidth } from "../view/diff/useSidebarWidth";
import { CommentWorklist } from "../view/review/CommentWorklist";
import { OverviewPanel } from "../view/review/OverviewPanel";
import { RunStatusBar } from "../view/review/RunStatusBar";
import { useReviewRun } from "../view/review/useReviewRun";
import styles from "./ReviewPage.module.css";

const api = createApiClient();

/**
 * The one screen (REQ-001): a GitHub-style diff of whatever changeset the
 * server resolved at boot. No tabs, no routes beyond this one.
 */
export function ReviewPage() {
	const [changeset, setChangeset] = useState<ChangesetDto | null>(null);
	// null = not yet known; the AI surface stays absent, not disabled, until
	// the session answers (REQ-009) — never assume availability while waiting
	const [aiAvailable, setAiAvailable] = useState(false);
	const [error, setError] = useState<Error | null>(null);

	useEffect(() => {
		let cancelled = false;
		getChangeset(api).then(
			(loaded) => {
				if (!cancelled) {
					setChangeset(loaded);
				}
			},
			(cause: unknown) => {
				if (!cancelled) {
					setError(cause instanceof Error ? cause : new Error(String(cause)));
				}
			},
		);
		getSession(api).then(
			(session) => {
				if (!cancelled) {
					setAiAvailable(session.featureFlags.aiAvailable);
				}
			},
			() => {
				// the diff still works with no agent surface; nothing to recover
			},
		);
		return () => {
			cancelled = true;
		};
	}, []);

	if (error !== null) {
		throw error;
	}
	if (changeset === null) {
		return <div className={styles.centered}>Loading review…</div>;
	}
	return <ResolvedReview changeset={changeset} aiAvailable={aiAvailable} />;
}

function ResolvedReview({
	changeset,
	aiAvailable,
}: {
	changeset: ChangesetDto;
	aiAvailable: boolean;
}) {
	const { width, setWidth } = useSidebarWidth();
	const [cursorFileIndex, setCursorFileIndex] = useState(0);
	const [foldedFileIds, setFoldedFileIds] = useState<ReadonlySet<string>>(
		() => new Set(),
	);
	const handleRef = useRef<DiffWorkspaceHandle>(null);
	const review = useReviewRun(api);
	const [expandedCommentIds, setExpandedCommentIds] = useState<
		ReadonlySet<string>
	>(() => new Set());
	const comments = useMemo<readonly ReviewCommentDto[]>(
		() => review.pass?.comments ?? [],
		[review.pass],
	);

	const onToggleComment = useCallback((commentId: string) => {
		setExpandedCommentIds((current) => {
			const next = new Set(current);
			if (next.has(commentId)) {
				next.delete(commentId);
			} else {
				next.add(commentId);
			}
			return next;
		});
	}, []);

	const onJumpToComment = useCallback((comment: ReviewCommentDto) => {
		setExpandedCommentIds((current) => new Set(current).add(comment.id));
		handleRef.current?.scrollToComment(comment);
	}, []);

	// files without hunks (binary, mode-only, pure renames) have no rows to
	// render; they stay in the tree but not in the code view
	const renderedFiles = useMemo(
		() => changeset.files.filter((file) => file.hunks.length > 0),
		[changeset.files],
	);

	const onJumpToFile = useCallback(
		(index: number) => {
			setCursorFileIndex(index);
			const file = changeset.files[index];
			if (file !== undefined && file.hunks.length > 0) {
				handleRef.current?.scrollToFile(file.id);
			}
		},
		[changeset.files],
	);

	const onToggleFold = useCallback((fileId: string) => {
		setFoldedFileIds((current) => {
			const next = new Set(current);
			if (next.has(fileId)) {
				next.delete(fileId);
			} else {
				next.add(fileId);
			}
			return next;
		});
	}, []);

	return (
		<div className={styles.layout}>
			<div style={{ width }}>
				<FileTreePanel
					files={changeset.files}
					currentFileIndex={cursorFileIndex}
					onJumpToFile={onJumpToFile}
				/>
			</div>
			<SidebarResizer width={width} onWidth={setWidth} />
			<div className={styles.main}>
				{aiAvailable && <RunStatusBar review={review} />}
				<div className={styles.overview}>
					<p className={styles.resolved}>
						{capitalize(changeset.announce.resolved)}
					</p>
					<p className={styles.overrideHint}>
						{changeset.announce.overrideHint}
					</p>
					{aiAvailable && (
						<button
							type="button"
							className={styles.reviewButton}
							disabled={
								review.starting ||
								review.run?.status === "queued" ||
								review.run?.status === "running"
							}
							onClick={review.start}
						>
							Review
						</button>
					)}
					{review.startError !== null && (
						<p className={styles.startError}>{review.startError}</p>
					)}
					{review.pass !== null && <OverviewPanel pass={review.pass} />}
				</div>
				{renderedFiles.length === 0 ? (
					<div className={styles.centered}>Nothing to review.</div>
				) : (
					<div className={styles.diff}>
						<DiffWorkspace
							api={api}
							changeset={changeset}
							renderedFiles={renderedFiles}
							foldedFileIds={foldedFileIds}
							onToggleFold={onToggleFold}
							handleRef={handleRef}
							comments={comments}
							expandedCommentIds={expandedCommentIds}
							onToggleComment={onToggleComment}
						/>
					</div>
				)}
			</div>
			{review.pass !== null && comments.length > 0 && (
				<CommentWorklist
					comments={comments}
					expandedCommentIds={expandedCommentIds}
					onJumpTo={onJumpToComment}
					onCollapse={onToggleComment}
				/>
			)}
		</div>
	);
}

function capitalize(text: string): string {
	return text.length === 0 ? text : text[0].toUpperCase() + text.slice(1);
}
