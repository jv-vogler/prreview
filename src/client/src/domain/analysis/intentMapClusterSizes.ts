import type { FileDiffDto } from "@dto/ChangesetDto";
import type { IntentMapDto } from "@dto/IntentMapDto";

/**
 * How much of the change each cluster covers, as a fraction of everything the
 * clusters together account for — F4's "relative sizing", which is the whole
 * point of the intent map ("the real behaviour change is these 40 lines; these
 * 900 are rename fallout"). One number per cluster, in cluster order, so the
 * caller can pair them with the list it is already rendering.
 *
 * A member naming hunk ids counts those hunks' changed lines; a member naming
 * only a path counts the whole file, which is what the agent meant when it
 * skipped hunk precision; a path this round does not contain counts nothing.
 * All zeros when the clusters cover nothing measurable, so a caller never
 * divides by zero.
 *
 * Deliberately a client-side twin of the server's `intentMapClusterSizes`: the
 * browser may import the wire contract (`@dto`) and nothing else of the server
 * (ARCHITECTURE §2), and both sides need the same arithmetic.
 */
export function intentMapClusterSizes(
	intentMap: IntentMapDto,
	files: readonly FileDiffDto[],
): number[] {
	const filesByPath = new Map(files.map((file) => [file.path, file]));
	const changedLinesPerCluster = intentMap.clusters.map((cluster) =>
		cluster.members.reduce(
			(total, member) => total + memberChangedLines(member, filesByPath),
			0,
		),
	);
	const changedLinesTotal = changedLinesPerCluster.reduce(
		(sum, count) => sum + count,
		0,
	);
	if (changedLinesTotal === 0) {
		return changedLinesPerCluster.map(() => 0);
	}
	return changedLinesPerCluster.map((count) => count / changedLinesTotal);
}

type ClusterMember = IntentMapDto["clusters"][number]["members"][number];

function memberChangedLines(
	member: ClusterMember,
	filesByPath: Map<string, FileDiffDto>,
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
