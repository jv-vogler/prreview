import type { FileDiff } from "../changeset/FileDiff";

export type IntentMapClusterKind =
	| "core"
	| "refactor"
	| "tests"
	| "config"
	| "docs"
	| "generated"
	| "chore";

export interface IntentMapClusterMember {
	path: string;
	/** empty means the whole file — the agent referenced it without hunk precision */
	hunkIds: string[];
}

export interface IntentMapCluster {
	name: string;
	kind: IntentMapClusterKind;
	description: string;
	members: IntentMapClusterMember[];
}

/**
 * The persisted, UI-facing map of what a changeset is trying to do
 * (ARCHITECTURE §7 stage A): a one-paragraph summary, the change grouped
 * into named clusters, and the file the reading should start from.
 */
export interface IntentMap {
	summary: string;
	clusters: IntentMapCluster[];
	suggestedEntryPoint: string;
}

/**
 * Relative cluster sizes from changed lines, for the UI's bars: one fraction
 * per cluster, in cluster order, each in [0, 1] as its share of all changed
 * lines the clusters cover (all zeros when they cover none). A member naming
 * hunkIds counts those hunks' added+deleted lines; a member without counts
 * its whole file; a path the round does not contain counts nothing.
 */
export function intentMapClusterSizes(
	map: IntentMap,
	files: FileDiff[],
): number[] {
	const filesByPath = new Map(files.map((file) => [file.path, file]));
	const clusterLineCounts = map.clusters.map((cluster) =>
		cluster.members.reduce(
			(count, member) => count + memberChangedLines(member, filesByPath),
			0,
		),
	);
	const totalLineCount = clusterLineCounts.reduce(
		(sum, count) => sum + count,
		0,
	);
	if (totalLineCount === 0) {
		return clusterLineCounts.map(() => 0);
	}
	return clusterLineCounts.map((count) => count / totalLineCount);
}

function memberChangedLines(
	member: IntentMapClusterMember,
	filesByPath: Map<string, FileDiff>,
): number {
	const file = filesByPath.get(member.path);
	if (file === undefined) {
		return 0;
	}
	if (member.hunkIds.length === 0) {
		return file.additions + file.deletions;
	}
	const wantedHunkIds = new Set(member.hunkIds);
	return file.hunks
		.filter((hunk) => wantedHunkIds.has(hunk.id))
		.reduce(
			(count, hunk) =>
				count + hunk.lines.filter((line) => line.type !== "context").length,
			0,
		);
}
