import { registerCustomCSSVariableTheme } from "@pierre/diffs";
import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import DiffsWorker from "@pierre/diffs/worker/worker.js?worker";
import type { ReactNode } from "react";

export const PIERRE_THEME_NAME = "prreview-primer";

const WORKER_POOL_SIZE = 4;

export const HIGHLIGHTER = {
	theme: PIERRE_THEME_NAME,

	preferredHighlighter: "shiki-js",

	lineDiffType: "none",
} as const;

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
