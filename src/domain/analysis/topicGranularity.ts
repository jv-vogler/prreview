import type { FileDiff } from "../changeset/FileDiff";

/**
 * How many topics this changeset should be told in.
 *
 * Granularity is the difference between a useful Understanding tab and a
 * useless one in both directions: two topics for a fifty-file change says
 * nothing, and thirty topics for a five-file change is just the diff again with
 * extra headings.
 *
 * Both numbers are derived once, from the changeset, and threaded into **both**
 * the prompt and the output schema's `.max()`. That pairing is the point: a
 * prompt that asks for "about 6" while the schema allows 60 is a suggestion the
 * model may ignore, and a schema that caps at 6 while the prompt asks for 20
 * fails the run. Deriving them together means they cannot disagree.
 *
 * `maxTopics` is deliberately looser than `targetTopicCount` — the target is
 * guidance, the max is a wall. A change that genuinely holds more distinct
 * ideas than the target should be allowed to say so.
 */
export interface TopicGranularity {
	/** what the prompt asks for */
	targetTopicCount: number;
	/** what the schema enforces */
	maxTopics: number;
}

/** below this, a change is one or two ideas and more headings only add noise */
const TINY_FILE_COUNT = 2;
const TINY_CHANGED_LINES = 20;

const TINY_GRANULARITY: TopicGranularity = {
	targetTopicCount: 2,
	maxTopics: 4,
};

const MIN_TARGET = 3;
const MAX_TARGET = 8;
/** headroom over the target, so a genuinely varied change is not truncated */
const MAX_TOPICS_HEADROOM = 4;

export function topicGranularity(files: readonly FileDiff[]): TopicGranularity {
	const fileCount = files.length;
	const changedLines = files.reduce(
		(sum, file) => sum + file.additions + file.deletions,
		0,
	);

	if (fileCount === 0) {
		return TINY_GRANULARITY;
	}
	if (fileCount <= TINY_FILE_COUNT || changedLines <= TINY_CHANGED_LINES) {
		return TINY_GRANULARITY;
	}

	// Square root rather than a ratio: topic count should grow with the change
	// but far more slowly than file count does, because a big PR is usually a
	// few ideas touching many files, not many ideas. 9 files -> 3 topics,
	// 25 -> 5, 50 -> 7, 100 -> 8 (the ceiling).
	const target = Math.min(
		MAX_TARGET,
		Math.max(MIN_TARGET, Math.round(Math.sqrt(fileCount))),
	);
	return {
		targetTopicCount: target,
		maxTopics: target + MAX_TOPICS_HEADROOM,
	};
}
