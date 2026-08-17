/**
 * How the prompt reaches `claude -p` (docs/engine-notes.md, TASK-005).
 *
 * In plain terms: prreview pipes the whole prompt into the CLI's standard
 * input. That was measured against `claude` 2.1.233 — a 31-byte prompt and a
 * 200,082-byte prompt both went through cleanly — and it is the only path
 * that scales, since a single argv member tops out near 128KB.
 *
 * The one alternative, kept because §7's ALT-009 documents it and because a
 * future CLI could stop reading stdin: write the prompt to
 * `<runTempDir>/prompt.md` outside the repo and pass a short positional
 * prompt telling the agent to `Read` that absolute path. Flipping this
 * constant is the whole switch; nothing else in the adapter branches on it.
 */
export const PROMPT_DELIVERY: PromptDelivery = "stdin";

export type PromptDelivery = "stdin" | "file-drop";
