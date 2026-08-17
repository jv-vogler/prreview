import { PaperAirplaneIcon, XIcon } from "@primer/octicons-react";
import type { ChangeEvent, KeyboardEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { chatContextFromCursor } from "../../domain/chat/chatContextFromCursor";
import { useDiffNavigation } from "../diff/DiffNavigationProvider";
import styles from "./ChatDock.module.css";
import { ChatMessageList } from "./ChatMessageList";
import { useChat } from "./ChatProvider";
import { ContextChip } from "./ContextChip";

export interface ChatDockProps {
	onClose(): void;
}

/** how tall the composer may grow before it scrolls instead */
const COMPOSER_MAX_HEIGHT_PX = 160;

/**
 * The chat lane's surface (F8): a rail beside the diff, not over it.
 *
 * In flow, so the diff narrows instead of being covered — a reader asking "why
 * is this safe?" is asking about code that has to stay on screen while the
 * answer arrives. Everything about the dock is sized to lose that argument
 * with the diff: one column, no shadow, the panel neutral the file tree uses,
 * and a hairline to separate it.
 */
export function ChatDock({ onClose }: ChatDockProps) {
	const chat = useChat();
	const navigation = useDiffNavigation();
	const [draft, setDraft] = useState("");
	const composerRef = useRef<HTMLTextAreaElement>(null);

	const context = useMemo(
		() => chatContextFromCursor(navigation.files, navigation.cursor),
		[navigation.files, navigation.cursor],
	);

	const hunkCount =
		navigation.files[navigation.cursor.fileIndex]?.hunks.length ?? 0;

	// the dock is opened by a keystroke, so the keyboard stays where it was
	useEffect(() => {
		composerRef.current?.focus();
	}, []);

	const growComposer = useCallback(
		(event: ChangeEvent<HTMLTextAreaElement>) => {
			setDraft(event.target.value);
			const composer = event.target;
			composer.style.height = "auto";
			composer.style.height = `${Math.min(composer.scrollHeight, COMPOSER_MAX_HEIGHT_PX)}px`;
		},
		[],
	);

	const submit = useCallback(() => {
		const text = draft.trim();
		if (text === "") {
			return;
		}
		chat.ask({ text, context });
		setDraft("");
		const composer = composerRef.current;
		if (composer !== null) {
			composer.style.height = "auto";
		}
	}, [chat, context, draft]);

	const onComposerKeyDown = useCallback(
		(event: KeyboardEvent<HTMLTextAreaElement>) => {
			if (event.key === "Escape") {
				event.preventDefault();
				onClose();
				return;
			}
			// Enter asks, shift+Enter writes a second line — a question is usually
			// one line, and reaching for a button to send it is a tax
			if (event.key === "Enter" && !event.shiftKey) {
				event.preventDefault();
				submit();
			}
		},
		[onClose, submit],
	);

	return (
		<section className={styles.dock} aria-label="Ask about this change">
			<header className={styles.header}>
				<h2 className={styles.heading}>Ask about this change</h2>
				<button
					type="button"
					className={styles.close}
					onClick={onClose}
					aria-label="Close the chat"
					title="Close the chat (c)"
				>
					<XIcon size={16} />
				</button>
			</header>
			<div className={styles.framing}>
				<ContextChip
					context={context}
					hunkPosition={
						hunkCount === 0
							? undefined
							: {
									index: navigation.cursor.hunkIndex + 1,
									total: hunkCount,
								}
					}
				/>
			</div>
			{chat.transcript.length === 0 ? (
				<EmptyThread />
			) : (
				<ChatMessageList transcript={chat.transcript} />
			)}
			<form
				className={styles.composer}
				onSubmit={(event) => {
					event.preventDefault();
					submit();
				}}
			>
				<label className={styles.label} htmlFor="chat-composer">
					Your question
				</label>
				<textarea
					id="chat-composer"
					ref={composerRef}
					className={styles.input}
					value={draft}
					onChange={growComposer}
					onKeyDown={onComposerKeyDown}
					rows={2}
					placeholder="Who calls this?"
				/>
				<button
					type="submit"
					className={styles.send}
					disabled={draft.trim() === ""}
				>
					<PaperAirplaneIcon size={16} />
					Ask
				</button>
			</form>
		</section>
	);
}

/**
 * What the dock says before anything has been asked. It names where the answers
 * come from, because that is the whole difference between this and a chat window
 * on a website: the agent reads the repository at the revision under review, so
 * it can answer things the diff alone cannot.
 */
function EmptyThread() {
	return (
		<div className={styles.empty}>
			<p className={styles.emptyLead}>
				Answers come from the repository at this revision, not from the diff
				alone — so it can say who calls a function the diff never shows.
			</p>
			<p className={styles.emptyExamples}>
				Try: who calls this? · why is this safe? · what did this replace?
			</p>
		</div>
	);
}
