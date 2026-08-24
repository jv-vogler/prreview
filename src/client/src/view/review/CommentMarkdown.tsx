import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { parseAlertBlock } from "../../domain/review/parseAlertBlock";
import styles from "./CommentMarkdown.module.css";

/**
 * Renders a finding's `body` as markdown (TASK-043): bullets, backticks and
 * bold render through `react-markdown`; the leading GitHub alert block
 * renders as a styled box instead of a plain blockquote, using
 * `parseAlertBlock`'s pure extraction rather than a markdown plugin.
 */
export function CommentMarkdown({ body }: { body: string }) {
	const alert = parseAlertBlock(body);
	if (alert === null) {
		return <Prose text={body} />;
	}
	return (
		<>
			<div className={styles.alert} data-alert-type={alert.type}>
				<span className={styles.alertLabel}>{alert.type}</span>
				<Prose text={alert.text} />
			</div>
			{alert.rest !== "" && <Prose text={alert.rest} />}
		</>
	);
}

function Prose({ text }: { text: string }) {
	return (
		<div className={styles.prose}>
			<Markdown remarkPlugins={[remarkGfm]} components={{ code: Code }}>
				{text}
			</Markdown>
		</div>
	);
}

/**
 * A fenced ```diff block, colored the way GitHub colors one. Without this the
 * fix an evidence block is carrying renders as flat grey text, so the reader
 * has to parse the leading +/- themselves.
 */
function Code({
	className,
	children,
	...rest
}: {
	className?: string;
	children?: unknown;
}) {
	if (className !== "language-diff") {
		return (
			<code className={className} {...rest}>
				{children as never}
			</code>
		);
	}
	const lines = String(children).replace(/\n$/, "").split("\n");
	return (
		<code className={className} {...rest}>
			{lines.map((line, index) => (
				<span
					// biome-ignore lint/suspicious/noArrayIndexKey: position is a diff line's only identity — two lines can be byte-identical
					key={index}
					className={styles.diffLine}
					data-diff={diffLineKind(line)}
				>
					{line === "" ? " " : line}
				</span>
			))}
		</code>
	);
}

function diffLineKind(line: string): string {
	if (line.startsWith("@@")) {
		return "hunk";
	}
	if (line.startsWith("+")) {
		return "addition";
	}
	if (line.startsWith("-")) {
		return "deletion";
	}
	return "context";
}
