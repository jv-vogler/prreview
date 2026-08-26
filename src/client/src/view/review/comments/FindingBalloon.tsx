import type { ReviewFindingDto } from "@dto/ReviewDto";
import {
	CheckCircleIcon,
	PencilIcon,
	TrashIcon,
	UndoIcon,
	UnverifiedIcon,
	XIcon,
} from "@primer/octicons-react";
import { useState } from "react";
import { findingTierLabel } from "../shared/reviewTier";
import type { FindingActions } from "./FindingActions";
import styles from "./FindingBalloon.module.css";
import { FindingMarkdown } from "./FindingMarkdown";
import { ReworkControl } from "./ReworkControl";

export interface FindingBalloonProps {
	finding: ReviewFindingDto;
	onCollapse(): void;
	actions: FindingActions;
}

export function FindingBalloon({
	finding,
	onCollapse,
	actions,
}: FindingBalloonProps) {
	const [editing, setEditing] = useState(false);
	const dismissed = finding.deleted;

	return (
		<div
			className={styles.balloon}
			data-finding-id={finding.id}
			data-tier={finding.tier}
			data-kind={finding.kind}
			data-dismissed={dismissed}
			role="note"
		>
			<div className={styles.header}>
				<span className={styles.tier}>{findingTierLabel(finding)}</span>
				{finding.lane === "pre-existing" && (
					<span className={styles.lane}>Pre-existing</span>
				)}
				{finding.published && <span className={styles.lane}>Published</span>}
				{finding.edited && <span className={styles.lane}>Edited</span>}
				{dismissed && <span className={styles.lane}>Dismissed</span>}
				<span className={styles.title}>{finding.title}</span>
				{dismissed ? (
					<button
						type="button"
						className={styles.iconButton}
						aria-label="Restore comment"
						onClick={() => actions.onRestore(finding.id)}
					>
						<UndoIcon size={14} />
					</button>
				) : (
					<>
						<button
							type="button"
							className={styles.iconButton}
							aria-label="Edit comment"
							aria-pressed={editing}
							onClick={() => setEditing((current) => !current)}
						>
							<PencilIcon size={14} />
						</button>
						<button
							type="button"
							className={styles.iconButton}
							aria-label="Delete comment"
							onClick={() => actions.onDelete(finding.id)}
						>
							<TrashIcon size={14} />
						</button>
					</>
				)}
				<button
					type="button"
					className={styles.collapse}
					aria-label="Collapse comment"
					onClick={onCollapse}
				>
					<XIcon size={14} />
				</button>
			</div>
			{editing && !dismissed ? (
				<EditBody
					initialBody={finding.body}
					onDone={(body) => {
						setEditing(false);
						if (body !== finding.body) {
							actions.onEdit(finding.id, body);
						}
					}}
				/>
			) : (
				<FindingMarkdown body={finding.body} />
			)}
			{finding.evidence !== undefined && (
				<FindingMarkdown body={finding.evidence} />
			)}
			<p className={styles.proof}>
				{finding.verified ? (
					<CheckCircleIcon size={12} />
				) : (
					<UnverifiedIcon size={12} />
				)}
				{finding.proof}
			</p>
			{finding.carried && (
				<p className={styles.carried}>
					Carried from the earlier pass. This run did not look at it again.
				</p>
			)}
			{!dismissed && actions.onRework !== undefined && (
				<ReworkControl finding={finding} actions={actions} />
			)}
		</div>
	);
}

function EditBody({
	initialBody,
	onDone,
}: {
	initialBody: string;
	onDone(body: string): void;
}) {
	const [body, setBody] = useState(initialBody);
	return (
		<textarea
			className={styles.editor}
			value={body}
			onChange={(event) => setBody(event.target.value)}
			onBlur={() => onDone(body)}
		/>
	);
}
