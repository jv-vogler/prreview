export const TOPIC_HREF_PREFIX = "#topic:";

/** a label carrying markdown link syntax cannot be linked without breaking it */
const MARKDOWN_UNSAFE = /[[\]()]/;

/**
 * The overview mentions its topic labels verbatim (the prompt asks for it);
 * turning each mention into a link the renderer swaps for that topic's
 * colored chip is what ties the summary to the balloons on the diff. Done
 * as one alternation pass per prose segment so an inserted link is never
 * re-matched, and never inside backticks — a mention in code is code.
 */
export function linkTopicMentions(
	overview: string,
	labels: readonly string[],
): string {
	const linkable = labels.filter(
		(label) => label.length > 0 && !MARKDOWN_UNSAFE.test(label),
	);
	if (linkable.length === 0) {
		return overview;
	}
	const pattern = new RegExp(
		linkable
			.slice()
			.sort((a, b) => b.length - a.length)
			.map(escapeRegExp)
			.join("|"),
		"g",
	);
	return overview
		.split("`")
		.map((segment, index) =>
			index % 2 === 1
				? segment
				: segment.replace(
						pattern,
						(label) =>
							`[${label}](${TOPIC_HREF_PREFIX}${encodeURIComponent(label)})`,
					),
		)
		.join("`");
}

export function topicFromHref(href: string): string | null {
	return href.startsWith(TOPIC_HREF_PREFIX)
		? decodeURIComponent(href.slice(TOPIC_HREF_PREFIX.length))
		: null;
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
