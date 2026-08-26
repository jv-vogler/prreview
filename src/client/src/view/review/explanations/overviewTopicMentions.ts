export const TOPIC_HREF_PREFIX = "#topic:";

const MARKDOWN_UNSAFE = /[[\]()]/;

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
