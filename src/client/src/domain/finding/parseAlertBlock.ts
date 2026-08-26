const ALERT_TYPES = ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"] as const;

export type AlertType = (typeof ALERT_TYPES)[number];

export interface ParsedAlertBlock {
	type: AlertType;
	/** the alert's own markdown content, with the `>` blockquote markers stripped */
	text: string;
	/** everything after the alert block, trimmed; "" when the alert is the whole body */
	rest: string;
}

const ALERT_HEADER_PATTERN =
	/^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/;

/**
 * A finding's `body` always opens with a GitHub alert block
 * (reviewPrompt.ts's `## Comment discipline`): a `>`-quoted `[!TIER]` line
 * followed by more `>`-quoted lines. Pulling it apart here, as a pure
 * string operation, is what lets the alert render as a styled box instead
 * of a plain blockquote — without depending on a markdown library's
 * internals to recognize the syntax.
 *
 * Returns null when `body` does not open this way (a model deviation, or a
 * hand-edited comment); the caller falls back to rendering the whole body
 * as plain markdown.
 */
export function parseAlertBlock(body: string): ParsedAlertBlock | null {
	const lines = body.split("\n");
	const header = ALERT_HEADER_PATTERN.exec((lines[0] ?? "").trim());
	if (header === null) {
		return null;
	}
	const type = header[1] as AlertType;

	let index = 1;
	const quoteLines: string[] = [];
	while (index < lines.length && /^>/.test(lines[index] ?? "")) {
		quoteLines.push((lines[index] ?? "").replace(/^>\s?/, ""));
		index++;
	}

	return {
		type,
		text: quoteLines.join("\n").trim(),
		rest: lines.slice(index).join("\n").trim(),
	};
}
