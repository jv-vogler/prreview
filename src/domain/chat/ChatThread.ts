/**
 * The chat/<threadId>.json record (ARCHITECTURE §11). M2 keeps exactly one
 * thread per session (`t1`): the diff is one conversation, and a second thread
 * would need a thread list in the UI that F8 does not ask for.
 */
export interface ChatThread {
	id: string;
	/**
	 * The engine session this thread resumes. Absent until the first turn
	 * comes back with one — the first turn forks the analysis session
	 * (CON-004), every later turn plain-resumes this id.
	 */
	engineSessionId?: string;
	messages: ChatMessage[];
}

export interface ChatMessage {
	role: "user" | "assistant";
	text: string;
	/** what the user was looking at when they asked (§7's context frame) */
	context?: ChatMessageContext;
	/** ISO timestamp */
	at: string;
}

export interface ChatMessageContext {
	/** repo-relative path of the file on screen */
	file?: string;
	hunkId?: string;
	annotationId?: string;
}
