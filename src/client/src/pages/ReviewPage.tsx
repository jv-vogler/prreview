import type { ChangesetDto } from "@dto/ChangesetDto";
import type {
	ExplanationDto,
	ReviewFindingDto,
	ReworkInstructionDto,
} from "@dto/ReviewDto";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sortExplanationsByDiff } from "../domain/explanation/explanationOrder";
import { topicColorsFor } from "../domain/explanation/topicColors";
import { type Topic, topicsFor } from "../domain/explanation/topics";
import {
	getChangeset,
	refreshChangeset,
} from "../infrastructure/endpoints/getChangeset";
import { getSession } from "../infrastructure/endpoints/getSession";
import { publishReview } from "../infrastructure/endpoints/publishReview";
import {
	deleteFinding,
	editFinding,
	restoreFinding,
	reworkFinding,
} from "../infrastructure/endpoints/reviewFindings";
import { createApiClient } from "../infrastructure/httpClients/apiClient";
import { ChangesetHeading } from "../view/diff/ChangesetHeading";
import {
	DiffWorkspace,
	type DiffWorkspaceHandle,
} from "../view/diff/DiffWorkspace";
import { FileTreePanel } from "../view/diff/FileTreePanel";
import { PanelResizer } from "../view/layout/PanelResizer";
import {
	FILE_PANEL,
	REVIEW_PANEL,
	usePanelWidth,
} from "../view/layout/usePanelWidth";
import type {
	FindingActions,
	ReworkProposal,
} from "../view/review/comments/FindingActions";
import type { ExplanationsMode } from "../view/review/explanations/DiffExplanationAnnotation";
import { HighlightedExplanationsContext } from "../view/review/explanations/highlightedExplanations";
import { OverviewPanel } from "../view/review/OverviewPanel";
import { PublishControl } from "../view/review/PublishControl";
import { ReReviewDialog } from "../view/review/ReReviewDialog";
import { ReviewSidebar } from "../view/review/ReviewSidebar";
import { RunStatusBar } from "../view/review/run/RunStatusBar";
import { REVIEW_FAILURE_COPY } from "../view/review/run/reviewFailureCopy";
import { useReviewRun } from "../view/review/run/useReviewRun";
import styles from "./ReviewPage.module.css";

const api = createApiClient();

const NO_HIGHLIGHT: ReadonlySet<string> = new Set();

/**
 * Two candidate presentations for change explanations, side by side while
 * the design settles: folded chips by default, `?explanations=margin` for
 * always-open cards pinned to the right edge. Read once at module scope —
 * the page has no router, so the URL never changes underneath it.
 */
const EXPLANATIONS_MODE: ExplanationsMode =
	new URLSearchParams(window.location.search).get("explanations") === "margin"
		? "margin"
		: "chips";

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
			onChangeset={setChangeset}
			aiAvailable={aiAvailable}
			githubAvailable={githubAvailable}
		/>
	);
}

function ResolvedReview({
	changeset,
	onChangeset,
	aiAvailable,
	githubAvailable,
}: {
	changeset: ChangesetDto;
	/** adopts a changeset the server re-resolved, so the diff matches the pass */
	onChangeset(changeset: ChangesetDto): void;
	aiAvailable: boolean;
	githubAvailable: boolean;
}) {
	const filePanel = usePanelWidth(FILE_PANEL);
	const reviewPanel = usePanelWidth(REVIEW_PANEL);
	const [cursorFileIndex, setCursorFileIndex] = useState(0);
	const [foldedFileIds, setFoldedFileIds] = useState<ReadonlySet<string>>(
		() => new Set(),
	);
	const handleRef = useRef<DiffWorkspaceHandle>(null);
	const review = useReviewRun(api);
	const [expandedFindingIds, setExpandedFindingIds] = useState<
		ReadonlySet<string>
	>(() => new Set());
	const [curationError, setCurationError] = useState<string | null>(null);
	const [publishing, setPublishing] = useState(false);
	const [publishError, setPublishError] = useState<string | null>(null);
	// once accepted or discarded, a rework's proposal never reappears for its
	// run, however long that run stays the "current" one on screen
	const [dismissedRunId, setDismissedRunId] = useState<string | null>(null);
	const findings = useMemo<readonly ReviewFindingDto[]>(
		() => review.pass?.findings ?? [],
		[review.pass],
	);
	// in the diff's own order, not the order the agent thought of them: the
	// sidebar's read-through, the topic colors and the scroll all follow one
	// sequence (explanationOrder.ts)
	const explanations = useMemo<readonly ExplanationDto[]>(
		() =>
			sortExplanationsByDiff(
				review.pass?.explanations ?? [],
				changeset.files.map((file) => file.path),
			),
		[review.pass, changeset.files],
	);
	// shown by default; one toggle drops or restores all of them
	const [showExplanations, setShowExplanations] = useState(true);
	// a Review click over a stored pass always confirms first: the run
	// replaces that pass, and destructive never rides on a bare click
	const [confirmingReReview, setConfirmingReReview] = useState(false);
	// the re-resolution a Review click starts with, and its own failure —
	// a target that has vanished says so here, not by starting a run
	const [reResolving, setReResolving] = useState(false);
	const [reResolveError, setReResolveError] = useState<string | null>(null);
	// folded by default so the diff keeps the screen; a run finishing live
	// unfolds it once, because that is the moment the account is news
	const [overviewFolded, setOverviewFolded] = useState(true);
	const previousRunStatus = useRef<string | null>(null);
	useEffect(() => {
		const status =
			review.run !== null && review.run.kind === "review"
				? review.run.status
				: null;
		const was = previousRunStatus.current;
		previousRunStatus.current = status;
		if (status === "succeeded" && (was === "running" || was === "queued")) {
			setOverviewFolded(false);
			// the pass was computed against whatever the server resolved when
			// the run started, which a refresh may have moved: re-read the
			// changeset so the diff on screen carries the placements the pass
			// was anchored to
			getChangeset(api).then(onChangeset, noop);
		}
	}, [review.run, onChangeset]);

	// Review never runs against the snapshot taken at boot: it re-resolves
	// the target first, so the dialog's commit count is true at click time
	// and the run reviews the commits that are actually there.
	const onReviewPressed = useCallback(() => {
		setReResolving(true);
		setReResolveError(null);
		refreshChangeset(api).then(
			({ changeset: resolved, review: status }) => {
				setReResolving(false);
				onChangeset(resolved);
				review.applyStatus(status);
				if (status.pass === null) {
					review.start();
				} else {
					setConfirmingReReview(true);
				}
			},
			(cause) => {
				setReResolving(false);
				setReResolveError(describeError(cause));
			},
		);
	}, [onChangeset, review.applyStatus, review.start]);
	const activeFindings = useMemo(
		() => findings.filter((finding) => !finding.deleted),
		[findings],
	);
	// what the sidebar's jumps and topic chips light up on the diff; never
	// part of the renderer's version, so highlighting folds nothing
	const [highlighted, setHighlighted] = useState<{
		key: string;
		ids: ReadonlySet<string>;
	} | null>(null);

	const onToggleFinding = useCallback((findingId: string) => {
		setExpandedFindingIds((current) => {
			const next = new Set(current);
			if (next.has(findingId)) {
				next.delete(findingId);
			} else {
				next.add(findingId);
			}
			return next;
		});
	}, []);

	const onJumpToFinding = useCallback((finding: ReviewFindingDto) => {
		setExpandedFindingIds((current) => new Set(current).add(finding.id));
		handleRef.current?.scrollToFinding(finding);
	}, []);

	const onJumpToExplanation = useCallback((explanation: ExplanationDto) => {
		setHighlighted({ key: explanation.id, ids: new Set([explanation.id]) });
		handleRef.current?.scrollToExplanation(explanation);
	}, []);

	const onToggleTopic = useCallback((topic: Topic) => {
		setHighlighted((current) =>
			current?.key === topic.label
				? null
				: {
						key: topic.label,
						ids: new Set(topic.explanations.map((entry) => entry.id)),
					},
		);
	}, []);

	const topics = useMemo(() => topicsFor(explanations), [explanations]);
	const topicColors = useMemo(
		() => topicColorsFor(explanations),
		[explanations],
	);
	const onToggleTopicLabel = useCallback(
		(label: string) => {
			const topic = topics.find((entry) => entry.label === label);
			if (topic !== undefined) {
				onToggleTopic(topic);
			}
		},
		[topics, onToggleTopic],
	);

	const onEditFinding = useCallback(
		(findingId: string, body: string) => {
			editFinding(api, findingId, body).then(review.applyPass, (cause) => {
				setCurationError(describeError(cause));
			});
		},
		[review.applyPass],
	);

	const onDeleteFinding = useCallback(
		(findingId: string) => {
			deleteFinding(api, findingId).then(review.applyPass, (cause) => {
				setCurationError(describeError(cause));
			});
		},
		[review.applyPass],
	);

	const onRestoreFinding = useCallback(
		(findingId: string) => {
			restoreFinding(api, findingId).then(review.applyPass, (cause) => {
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
		(findingId: string, instruction: ReworkInstructionDto) => {
			setDismissedRunId(null);
			reworkFinding(api, findingId, instruction).then(
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
		(findingId: string, body: string) => {
			dismissRework();
			onEditFinding(findingId, body);
		},
		[dismissRework, onEditFinding],
	);

	// at most one rework in flight at a time (it shares the review's own
	// one-run-at-a-time lane) — derived straight off the same run state
	// RunStatusBar reads, just filtered to this one comment (TASK-049)
	const reworkProposal = useMemo<ReworkProposal | null>(() => {
		const run = review.run;
		if (
			run === null ||
			run.kind !== "rework" ||
			run.findingId === undefined ||
			run.id === dismissedRunId
		) {
			return null;
		}
		if (run.status === "queued" || run.status === "running") {
			return { findingId: run.findingId, status: "running" };
		}
		if (run.status === "succeeded" && run.result !== undefined) {
			return {
				findingId: run.findingId,
				status: "succeeded",
				proposedBody: run.result,
			};
		}
		if (run.status === "failed" || run.status === "timed-out") {
			return {
				findingId: run.findingId,
				status: "failed",
				errorMessage:
					run.error !== undefined
						? REVIEW_FAILURE_COPY[run.error.reason]
						: "The rework did not finish.",
			};
		}
		if (run.status === "cancelled") {
			return {
				findingId: run.findingId,
				status: "failed",
				errorMessage: "The rework was cancelled.",
			};
		}
		return null;
	}, [review.run, dismissedRunId]);

	const actions = useMemo<FindingActions>(
		() => ({
			onEdit: onEditFinding,
			onDelete: onDeleteFinding,
			onRestore: onRestoreFinding,
			onRework: aiAvailable ? onRework : undefined,
			reworkProposal,
			onAcceptRework,
			onDismissRework: dismissRework,
		}),
		[
			onEditFinding,
			onDeleteFinding,
			onRestoreFinding,
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
		<HighlightedExplanationsContext.Provider
			value={highlighted?.ids ?? NO_HIGHLIGHT}
		>
			{confirmingReReview && (
				<ReReviewDialog
					freshness={review.freshness}
					worktree={changeset.ref.source.kind === "worktree"}
					editedCount={activeFindings.filter((c) => c.edited).length}
					dismissedCount={findings.filter((c) => c.deleted).length}
					pendingReviewUrl={review.pass?.published?.htmlUrl ?? null}
					onConfirm={(options) => {
						setConfirmingReReview(false);
						review.start({ full: options.full });
					}}
					onCancel={() => setConfirmingReReview(false)}
				/>
			)}
			<div className={styles.layout}>
				<div style={{ width: filePanel.width }}>
					<FileTreePanel
						files={changeset.files}
						currentFileIndex={cursorFileIndex}
						onJumpToFile={onJumpToFile}
					/>
				</div>
				<PanelResizer
					spec={FILE_PANEL}
					width={filePanel.width}
					onWidth={filePanel.setWidth}
				/>
				<div className={styles.main}>
					{aiAvailable && <RunStatusBar review={review} />}
					<div className={styles.overview}>
						<div className={styles.headerRow}>
							<div className={styles.headerSubject}>
								<ChangesetHeading
									source={changeset.ref.source}
									resolved={changeset.announce.resolved}
									prUrl={changeset.ref.prUrl}
								/>
							</div>
							<div className={styles.controls}>
								{explanations.length > 0 && (
									<button
										type="button"
										className={styles.explanationsToggle}
										aria-pressed={showExplanations}
										onClick={() => setShowExplanations((current) => !current)}
									>
										{showExplanations
											? "Hide explanations"
											: "Show explanations"}
									</button>
								)}
								{aiAvailable && (
									<button
										type="button"
										className={styles.reviewButton}
										disabled={
											review.starting ||
											reResolving ||
											review.run?.status === "queued" ||
											review.run?.status === "running"
										}
										onClick={onReviewPressed}
									>
										Review
									</button>
								)}
							</div>
						</div>
						{review.startError !== null && (
							<p className={styles.startError}>{review.startError}</p>
						)}
						{reResolveError !== null && (
							<p className={styles.startError} role="alert">
								{reResolveError}
							</p>
						)}
						{curationError !== null && (
							<p className={styles.startError} role="alert">
								{curationError}
							</p>
						)}
						{review.pass !== null && (
							<OverviewPanel
								pass={review.pass}
								topicColors={topicColors}
								onToggleTopic={onToggleTopicLabel}
								folded={overviewFolded}
								onToggleFold={() => setOverviewFolded((current) => !current)}
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
								findings={activeFindings}
								expandedFindingIds={expandedFindingIds}
								onToggleFinding={onToggleFinding}
								actions={actions}
								explanations={explanations}
								showExplanations={showExplanations}
								explanationsMode={EXPLANATIONS_MODE}
							/>
						</div>
					)}
				</div>
				{review.pass !== null &&
					(findings.length > 0 || explanations.length > 0) && (
						<>
							<PanelResizer
								spec={REVIEW_PANEL}
								width={reviewPanel.width}
								onWidth={reviewPanel.setWidth}
							/>
							<ReviewSidebar
								width={reviewPanel.width}
								findings={findings}
								explanations={explanations}
								expandedFindingIds={expandedFindingIds}
								onJumpToFinding={onJumpToFinding}
								onCollapseFinding={onToggleFinding}
								actions={actions}
								onJumpToExplanation={onJumpToExplanation}
								onToggleTopic={onToggleTopic}
								publishControl={
									canPublish && review.pass !== null ? (
										<PublishControl
											findings={activeFindings}
											published={review.pass.published}
											publishing={publishing}
											error={publishError}
											onPublish={onPublish}
										/>
									) : undefined
								}
							/>
						</>
					)}
			</div>
		</HighlightedExplanationsContext.Provider>
	);
}

function describeError(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

function noop(): void {}
