import { registerCustomCSSVariableTheme } from "@pierre/diffs";
import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import DiffsWorker from "@pierre/diffs/worker/worker.js?worker";
import type { ReactNode } from "react";

/**
 * The highlight worker pool, hoisted above the one screen (REQ-001) so a
 * future re-render of the diff view is a cache hit against a live pool
 * rather than a teardown-and-respawn.
 */

export const PIERRE_THEME_NAME = "prreview-primer";

/** the legacy spike's proven pool size; highlight throughput was never the bottleneck */
const WORKER_POOL_SIZE = 4;

export const HIGHLIGHTER = {
	theme: PIERRE_THEME_NAME,
	// 'shiki-wasm' would need 'wasm-unsafe-eval' in script-src, which the CSP
	// does not grant
	preferredHighlighter: "shiki-js",
	/*
	 * Line-level blocks only, the way GitHub renders a hunk it could not pair
	 * line-for-line. Pierre's default word-alt pass also highlights the words
	 * it matched *inside* each changed line, which on a rewritten block finds
	 * incidental shared words ("the", "is") and speckles the diff with
	 * emphasis that means nothing.
	 *
	 * This has to live here rather than in CodeView's `options`: the word pass
	 * runs in the highlight worker, and the worker's copy of the setting comes
	 * from these pool options, not from the per-view render options.
	 */
	lineDiffType: "none",
} as const;

/**
 * Registered once at startup (module scope runs exactly once): every color
 * slot resolves through `var(--diffs-*)` references defined in
 * pierre-theme.css, so no defaults are needed here and a theme flip is pure
 * CSS cascade — no re-render, no re-highlight.
 */
registerCustomCSSVariableTheme(PIERRE_THEME_NAME, {});

export function WorkerPoolHost({ children }: { children: ReactNode }) {
	return (
		<WorkerPoolContextProvider
			poolOptions={{
				workerFactory: () => new DiffsWorker(),
				poolSize: WORKER_POOL_SIZE,
			}}
			highlighterOptions={HIGHLIGHTER}
		>
			{children}
		</WorkerPoolContextProvider>
	);
}
