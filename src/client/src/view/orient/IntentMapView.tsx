import type { FileDiffDto } from "@dto/ChangesetDto";
import type { IntentMapDto } from "@dto/IntentMapDto";
import {
	ArrowSwitchIcon,
	BeakerIcon,
	GearIcon,
	NoteIcon,
	PackageIcon,
	ToolsIcon,
	ZapIcon,
} from "@primer/octicons-react";
import type { ComponentType } from "react";
import { useMemo } from "react";
import { Link } from "react-router";
import { intentMapClusterSizes } from "../../domain/analysis/intentMapClusterSizes";
import { diffPathFor } from "../../pages/diffUrl";
import { EntryPointSuggestion } from "./EntryPointSuggestion";
import styles from "./IntentMapView.module.css";

type ClusterKind = IntentMapDto["clusters"][number]["kind"];

interface KindPresentation {
	label: string;
	Icon: ComponentType<{ size?: number }>;
}

/**
 * What each kind of cluster is, in plain terms. The icon carries the scan and
 * the word carries the certainty; neither is decoration.
 */
const KIND: Record<ClusterKind, KindPresentation> = {
	core: { label: "behaviour change", Icon: ZapIcon },
	refactor: { label: "refactor", Icon: ArrowSwitchIcon },
	tests: { label: "tests", Icon: BeakerIcon },
	config: { label: "config", Icon: GearIcon },
	docs: { label: "docs", Icon: NoteIcon },
	generated: { label: "generated", Icon: PackageIcon },
	chore: { label: "chore", Icon: ToolsIcon },
};

const PERCENT = 100;

export interface IntentMapViewProps {
	intentMap: IntentMapDto;
	files: readonly FileDiffDto[];
}

/**
 * The orientation page's body (F4): what this change is for, then how it breaks
 * down by purpose with each part sized against the whole.
 *
 * The clusters are a list rather than a grid of equal cards, because their
 * whole point is that they are *not* equal — the bar is the reason to read this
 * page before the diff. Cluster order is the agent's; re-sorting by size would
 * be the client overruling the reading logic the server persisted.
 */
export function IntentMapView({ intentMap, files }: IntentMapViewProps) {
	const shares = useMemo(
		() => intentMapClusterSizes(intentMap, files),
		[intentMap, files],
	);
	const fileIdsByPath = useMemo(
		() => new Map(files.map((file) => [file.path, file.id])),
		[files],
	);
	const sizesAreKnown = shares.some((share) => share > 0);

	return (
		<div className={styles.map}>
			<p className={styles.summary}>{intentMap.summary}</p>
			<EntryPointSuggestion
				suggestion={intentMap.suggestedEntryPoint}
				files={files}
			/>
			{intentMap.clusters.length > 0 && (
				<section className={styles.clusters}>
					<h2 className={styles.clustersHeading}>How it breaks down</h2>
					<ol className={styles.clusterList}>
						{intentMap.clusters.map((cluster, index) => {
							const { label, Icon } = KIND[cluster.kind];
							const share = shares[index] ?? 0;
							return (
								<li
									key={`${cluster.kind}:${cluster.name}`}
									className={styles.cluster}
									data-kind={cluster.kind}
								>
									<div className={styles.clusterHead}>
										<span className={styles.clusterIcon} aria-hidden="true">
											<Icon size={16} />
										</span>
										<h3 className={styles.clusterName}>{cluster.name}</h3>
										<span className={styles.clusterKind}>{label}</span>
										{sizesAreKnown && (
											<span className={styles.share}>{formatShare(share)}</span>
										)}
									</div>
									{sizesAreKnown && (
										<div className={styles.bar}>
											<span
												className={styles.barFill}
												style={{ inlineSize: `${share * PERCENT}%` }}
											/>
										</div>
									)}
									<p className={styles.description}>{cluster.description}</p>
									<ul className={styles.members}>
										{cluster.members.map((member) => (
											<li key={member.path}>
												<ClusterMemberLink
													path={member.path}
													hunkId={member.hunkIds[0] ?? null}
													fileId={fileIdsByPath.get(member.path)}
												/>
											</li>
										))}
									</ul>
								</li>
							);
						})}
					</ol>
				</section>
			)}
		</div>
	);
}

interface ClusterMemberLinkProps {
	path: string;
	hunkId: string | null;
	/** absent when the agent named a path this round does not contain */
	fileId: string | undefined;
}

function ClusterMemberLink({ path, hunkId, fileId }: ClusterMemberLinkProps) {
	if (fileId === undefined) {
		return (
			<span className={styles.memberMissing} title="Not part of this changeset">
				{path}
			</span>
		);
	}
	return (
		<Link className={styles.member} to={diffPathFor(fileId, hunkId)}>
			{path}
		</Link>
	);
}

/**
 * A share the reader can trust: anything that rounds to nothing is shown as
 * "<1%" rather than as 0%, because a cluster that is on the page did cover
 * something.
 */
function formatShare(share: number): string {
	const percent = share * PERCENT;
	if (percent > 0 && percent < 1) {
		return "<1%";
	}
	return `${Math.round(percent)}%`;
}
