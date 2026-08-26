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
import {
	DiffWorkspace,
	type DiffWorkspaceHandle,
} from "../view/diff/DiffWorkspace";
import { FileTreePanel } from "../view/diff/FileTreePanel";
import { useFileFolding } from "../view/diff/useFileFolding";
import { PanelResizer } from "../view/layout/PanelResizer";
import {
	FILE_PANEL,
	REVIEW_PANEL,
	usePanelWidth,
} from "../view/layout/usePanelWidth";
import type { ExplanationsMode } from "../view/review/explanations/DiffExplanationAnnotation";
import {
	HighlightedExplanationsContext,
	NO_HIGHLIGHTED_EXPLANATIONS,
} from "../view/review/explanations/highlightedExplanations";
import type { FindingActions } from "../view/review/findings/FindingActions";
import { reworkProposalFor } from "../view/review/findings/FindingActions";
import { OverviewPanel } from "../view/review/OverviewPanel";
import { PublishControl } from "../view/review/PublishControl";
import { ReReviewDialog } from "../view/review/ReReviewDialog";
import { ReviewSidebar } from "../view/review/ReviewSidebar";
import { RunStatusBar } from "../view/review/run/RunStatusBar";
import type { ReviewRunState } from "../view/review/run/useReviewRun";
import { useReviewRun } from "../view/review/run/useReviewRun";
import { ReviewHeader } from "./ReviewHeader";
import styles from "./ReviewPage.module.css";

const api = createApiClient();

const EXPLANATIONS_MODE: ExplanationsMode =
	new URLSearchParams(window.location.search).get("explanations") === "margin"
		? "margin"
		: "chips";

export function ReviewPage() {
	const [changeset, setChangeset] = useState<ChangesetDto | null>(null);

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
			() => {},
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
	onChangeset(changeset: ChangesetDto): void;
	aiAvailable: boolean;
	githubAvailable: boolean;
}) {
	const filePanel = usePanelWidth(FILE_PANEL);
	const reviewPanel = usePanelWidth(REVIEW_PANEL);
	const [cursorFileIndex, setCursorFileIndex] = useState(0);
	const folding = useFileFolding();
	const handleRef = useRef<DiffWorkspaceHandle>(null);
	const review = useReviewRun(api);
	const [expandedFindingIds, setExpandedFindingIds] = useState<
		ReadonlySet<string>
	>(() => new Set());
	const [curationError, setCurationError] = useState<string | null>(null);
	const [publishing, setPublishing] = useState(false);
	const [publishError, setPublishError] = useState<string | null>(null);

	const [dismissedRunId, setDismissedRunId] = useState<string | null>(null);
	const findings = useMemo<readonly ReviewFindingDto[]>(
		() => review.pass?.findings ?? [],
		[review.pass],
	);

	const explanations = useMemo<readonly ExplanationDto[]>(
		() =>
			sortExplanationsByDiff(
				review.pass?.explanations ?? [],
				changeset.files.map((file) => file.path),
			),
		[review.pass, changeset.files],
	);

	const [showExplanations, setShowExplanations] = useState(true);

	const [confirmingReReview, setConfirmingReReview] = useState(false);

	const [reResolving, setReResolving] = useState(false);
	const [reResolveError, setReResolveError] = useState<string | null>(null);

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
			getChangeset(api).then(onChangeset, noop);
		}
	}, [review.run, onChangeset]);

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

	const [highlighted, setHighlighted] = useState<{
		key: string;
		ids: ReadonlySet<string>;
	} | null>(null);

	const onToggleFinding = useCallback((findingId: string) => {
		setExpandedFindingIds((current) => {
			const next = new Set(current);
			if (!next.delete(findingId)) {
				next.add(findingId);
			}
			return next;
		});
	}, []);

	const onJumpToFinding = useCallback(
		(finding: ReviewFindingDto) => {
			setExpandedFindingIds((current) => new Set(current).add(finding.id));
			folding.revealPlacement(finding.placement, () =>
				handleRef.current?.scrollToFinding(finding),
			);
		},
		[folding.revealPlacement],
	);

	const onJumpToExplanation = useCallback(
		(explanation: ExplanationDto) => {
			setHighlighted({ key: explanation.id, ids: new Set([explanation.id]) });
			folding.revealPlacement(explanation.placement, () =>
				handleRef.current?.scrollToExplanation(explanation),
			);
		},
		[folding.revealPlacement],
	);

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

	const reworkProposal = useMemo(
		() => reworkProposalFor(review.run, dismissedRunId),
		[review.run, dismissedRunId],
	);

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

	return (
		<HighlightedExplanationsContext.Provider
			value={highlighted?.ids ?? NO_HIGHLIGHTED_EXPLANATIONS}
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
						<ReviewHeader
							changeset={changeset}
							aiAvailable={aiAvailable}
							viewedCount={folding.viewedFileIds.size}
							fileCount={renderedFiles.length}
							explanationCount={explanations.length}
							showExplanations={showExplanations}
							onToggleExplanations={() =>
								setShowExplanations((current) => !current)
							}
							reviewDisabled={reviewBusy(review, reResolving)}
							onReview={onReviewPressed}
							errors={[review.startError, reResolveError, curationError]}
						/>
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
								foldedFileIds={folding.foldedFileIds}
								onToggleFold={folding.toggleFold}
								viewedFileIds={folding.viewedFileIds}
								onToggleViewed={folding.toggleViewed}
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

function reviewBusy(review: ReviewRunState, reResolving: boolean): boolean {
	return (
		review.starting ||
		reResolving ||
		review.run?.status === "queued" ||
		review.run?.status === "running"
	);
}

function describeError(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

function noop(): void {}
