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
			<Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
		</div>
	);
}
