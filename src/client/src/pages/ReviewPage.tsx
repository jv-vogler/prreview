import type { ChangesetDto } from "@dto/ChangesetDto";
import type { ReviewCommentDto, ReworkInstructionDto } from "@dto/ReviewDto";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getChangeset } from "../infrastructure/endpoints/getChangeset";
import { getSession } from "../infrastructure/endpoints/getSession";
import { publishReview } from "../infrastructure/endpoints/publishReview";
import {
	deleteComment,
	editComment,
	reworkComment,
} from "../infrastructure/endpoints/reviewComments";
import { createApiClient } from "../infrastructure/httpClients/apiClient";
import {
	DiffWorkspace,
	type DiffWorkspaceHandle,
} from "../view/diff/DiffWorkspace";
import { FileTreePanel } from "../view/diff/FileTreePanel";
import { SidebarResizer } from "../view/diff/SidebarResizer";
import { useSidebarWidth } from "../view/diff/useSidebarWidth";
import type {
	CommentActions,
	ReworkProposal,
} from "../view/review/CommentActions";
import { CommentWorklist } from "../view/review/CommentWorklist";
import { OverviewPanel } from "../view/review/OverviewPanel";
import { PublishControl } from "../view/review/PublishControl";
import { RunStatusBar } from "../view/review/RunStatusBar";
import { REVIEW_FAILURE_COPY } from "../view/review/reviewFailureCopy";
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
	const [githubAvailable, setGithubAvailable] = useState(false);
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
					setGithubAvailable(session.featureFlags.githubAvailable);
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
	return (
		<ResolvedReview
			changeset={changeset}
			aiAvailable={aiAvailable}
			githubAvailable={githubAvailable}
		/>
	);
}

function ResolvedReview({
	changeset,
	aiAvailable,
	githubAvailable,
}: {
	changeset: ChangesetDto;
	aiAvailable: boolean;
	githubAvailable: boolean;
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
	const [curationError, setCurationError] = useState<string | null>(null);
	const [publishing, setPublishing] = useState(false);
	const [publishError, setPublishError] = useState<string | null>(null);
	// once accepted or discarded, a rework's proposal never reappears for its
	// run, however long that run stays the "current" one on screen
	const [dismissedRunId, setDismissedRunId] = useState<string | null>(null);
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

	const onEditComment = useCallback(
		(commentId: string, body: string) => {
			editComment(api, commentId, body).then(review.applyPass, (cause) => {
				setCurationError(describeError(cause));
			});
		},
		[review.applyPass],
	);

	const onDeleteComment = useCallback(
		(commentId: string) => {
			deleteComment(api, commentId).then(review.applyPass, (cause) => {
				setCurationError(describeError(cause));
			});
		},
		[review.applyPass],
	);

	const onPublish = useCallback(() => {
		setPublishing(true);
		setPublishError(null);
		publishReview(api).then(
			(pass) => {
				setPublishing(false);
				review.applyPass(pass);
			},
			(cause) => {
				setPublishing(false);
				setPublishError(describeError(cause));
			},
		);
	}, [review.applyPass]);

	// absent, not disabled (REQ-009's treatment, mirrored here): no publish
	// control at all without a GitHub backend or without a PR to publish to
	const canPublish = githubAvailable && changeset.ref.source.kind === "pr";

	const onRework = useCallback(
		(commentId: string, instruction: ReworkInstructionDto) => {
			setDismissedRunId(null);
			reworkComment(api, commentId, instruction).then(
				(result) => {
					if (result.kind === "conflict") {
						setCurationError(result.message);
					}
				},
				(cause) => setCurationError(describeError(cause)),
			);
		},
		[],
	);

	const dismissRework = useCallback(() => {
		if (review.run !== null) {
			setDismissedRunId(review.run.id);
		}
	}, [review.run]);

	const onAcceptRework = useCallback(
		(commentId: string, body: string) => {
			dismissRework();
			onEditComment(commentId, body);
		},
		[dismissRework, onEditComment],
	);

	// at most one rework in flight at a time (it shares the review's own
	// one-run-at-a-time lane) — derived straight off the same run state
	// RunStatusBar reads, just filtered to this one comment (TASK-049)
	const reworkProposal = useMemo<ReworkProposal | null>(() => {
		const run = review.run;
		if (
			run === null ||
			run.kind !== "rework" ||
			run.commentId === undefined ||
			run.id === dismissedRunId
		) {
			return null;
		}
		if (run.status === "queued" || run.status === "running") {
			return { commentId: run.commentId, status: "running" };
		}
		if (run.status === "succeeded" && run.result !== undefined) {
			return {
				commentId: run.commentId,
				status: "succeeded",
				proposedBody: run.result,
			};
		}
		if (run.status === "failed" || run.status === "timed-out") {
			return {
				commentId: run.commentId,
				status: "failed",
				errorMessage:
					run.error !== undefined
						? REVIEW_FAILURE_COPY[run.error.reason]
						: "The rework did not finish.",
			};
		}
		if (run.status === "cancelled") {
			return {
				commentId: run.commentId,
				status: "failed",
				errorMessage: "The rework was cancelled.",
			};
		}
		return null;
	}, [review.run, dismissedRunId]);

	const actions = useMemo<CommentActions>(
		() => ({
			onEdit: onEditComment,
			onDelete: onDeleteComment,
			onRework: aiAvailable ? onRework : undefined,
			reworkProposal,
			onAcceptRework,
			onDismissRework: dismissRework,
		}),
		[
			onEditComment,
			onDeleteComment,
			onRework,
			reworkProposal,
			onAcceptRework,
			dismissRework,
			aiAvailable,
		],
	);

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
					{curationError !== null && (
						<p className={styles.startError} role="alert">
							{curationError}
						</p>
					)}
					{review.pass !== null && <OverviewPanel pass={review.pass} />}
					{canPublish && review.pass !== null && (
						<PublishControl
							comments={comments}
							published={review.pass.published}
							publishing={publishing}
							error={publishError}
							onPublish={onPublish}
						/>
					)}
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
							actions={actions}
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
					actions={actions}
				/>
			)}
		</div>
	);
}

function capitalize(text: string): string {
	return text.length === 0 ? text : text[0].toUpperCase() + text.slice(1);
}

function describeError(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}
