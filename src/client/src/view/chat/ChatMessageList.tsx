import { AlertIcon } from "@primer/octicons-react";
import { useEffect, useRef } from "react";
import type {
	AnswerState,
	TranscriptEntry,
} from "../../domain/chat/composeTranscript";
import styles from "./ChatMessageList.module.css";
import { CHAT_FAILURE_COPY } from "./chatFailureCopy";

export interface ChatMessageListProps {
	transcript: readonly TranscriptEntry[];
}

/** what the dock says while the agent has not said anything yet */
const WAITING_LABEL: Record<"queued" | "waiting", string> = {
	queued: "Waiting for the question before this one",
	waiting: "Reading the code",
};

/**
 * The thread. Text only, rendered as text (SEC-004): a reply is inserted into
 * the DOM as a string, never as HTML or markdown, because it is the one place
 * in prreview where a model's output reaches the page.
 *
 * Speakers are told apart by surface rather than by bubbles and avatars, so the
 * dock reads like the rest of prreview — the explanation notes in the margin
 * make the same choice, and a chat that looked like a different product would
 * pull attention off the diff.
 */
export function ChatMessageList({ transcript }: ChatMessageListProps) {
	const endRef = useRef<HTMLDivElement>(null);
	const lastEntry = transcript.at(-1);
	const tail =
		lastEntry?.kind === "answer" && "text" in lastEntry.state
			? lastEntry.state.text
			: "";

	// follow the reply as it streams; the newest words are the ones being read
	useEffect(() => {
		if (transcript.length === 0 && tail === "") {
			return;
		}
		// optional call, not just an optional ref: jsdom has no layout and no
		// scrollIntoView, and a test asserting on the text should not care
		endRef.current?.scrollIntoView?.({ block: "end" });
	}, [transcript.length, tail]);

	return (
		// role="log" is what a thread is: a screen reader hears each settled turn
		// without the reader having to go looking for it
		<div className={styles.list} role="log">
			{transcript.map((entry) =>
				entry.kind === "question" ? (
					<Question key={entry.key} text={entry.text} />
				) : (
					<Answer key={entry.key} state={entry.state} />
				),
			)}
			<div ref={endRef} />
		</div>
	);
}

function Question({ text }: { text: string }) {
	return (
		<article className={styles.question}>
			<p className={styles.speaker}>You</p>
			<p className={styles.text}>{text}</p>
		</article>
	);
}

function Answer({ state }: { state: AnswerState }) {
	if (state.status === "failed") {
		return (
			<article className={styles.answer} role="alert">
				<p className={styles.failure}>
					<span className={styles.failureIcon} aria-hidden="true">
						<AlertIcon size={16} />
					</span>
					{CHAT_FAILURE_COPY[state.reason]}
				</p>
			</article>
		);
	}

	if (state.status === "queued" || state.status === "waiting") {
		return (
			<article className={styles.answer}>
				<p className={styles.pending}>{WAITING_LABEL[state.status]}</p>
			</article>
		);
	}

	return (
		<article className={styles.answer}>
			<p className={styles.text}>
				{state.text}
				{state.status === "streaming" && (
					<span className={styles.caret} aria-hidden="true" />
				)}
			</p>
		</article>
	);
}
