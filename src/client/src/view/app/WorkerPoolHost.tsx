import { registerCustomCSSVariableTheme } from "@pierre/diffs";
import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import DiffsWorker from "@pierre/diffs/worker/worker.js?worker";
import type { ReactNode } from "react";

/**
 * The highlight worker pool, hoisted above the tabs.
 *
 * It has to live here rather than inside the diff, because the pool is a
 * singleton that terminates when its last provider unmounts. Left inside the
 * Diff tab, every switch to Understanding would tear down four workers and
 * every switch back would spin up four more and re-highlight everything.
 * Hoisted — with content-derived cache keys — remounting the diff is a cache
 * hit instead.
 *
 * Both diff-rendering surfaces sit under this one provider: the Diff tab's
 * single virtualized `CodeView`, and the Understanding tab's many small
 * `FileDiff` excerpts. They share the pool and, when two topics show the same
 * hunk subset, the cached highlights too.
 */

export const PIERRE_THEME_NAME = "prreview-primer";

/** the spike's proven pool size; highlight throughput was never the bottleneck */
const WORKER_POOL_SIZE = 4;

export const HIGHLIGHTER = {
	theme: PIERRE_THEME_NAME,
	// 'shiki-wasm' would need 'wasm-unsafe-eval' in script-src, which the CSP
	// does not grant (Spike 1)
	preferredHighlighter: "shiki-js",
} as const;

/**
 * Registered once at startup (module scope runs exactly once): every color slot
 * resolves through `var(--diffs-*)` references defined in pierre-theme.css, so
 * no defaults are needed here and a theme flip is pure CSS cascade — no
 * re-render, no re-highlight (Spike 1).
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
