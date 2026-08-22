/**
 * How the prompt reaches `claude -p` (docs/engine-notes.md).
 *
 * In plain terms: prreview pipes the whole prompt into the CLI's standard
 * input. That was measured against the real CLI — a 31-byte prompt and a
 * 200,082-byte prompt both went through cleanly — and it is the only path
 * that scales, since a single argv member tops out near 128KB.
 */
export const PROMPT_DELIVERY: PromptDelivery = "stdin";

export type PromptDelivery = "stdin" | "file-drop";
