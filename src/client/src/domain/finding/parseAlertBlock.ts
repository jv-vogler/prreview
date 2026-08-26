const ALERT_TYPES = ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"] as const;

export type AlertType = (typeof ALERT_TYPES)[number];

export interface ParsedAlertBlock {
	type: AlertType;
	text: string;
	rest: string;
}

const ALERT_HEADER_PATTERN =
	/^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/;

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
