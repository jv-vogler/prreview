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
