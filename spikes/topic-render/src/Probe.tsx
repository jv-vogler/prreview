import { parsePatchFiles } from "@pierre/diffs";
import { FileDiff, WorkerPoolContextProvider } from "@pierre/diffs/react";
import DiffsWorker from "@pierre/diffs/worker/worker.js?worker";
import { useMemo } from "react";
import { fixturePatch } from "./fixture";
import { narrowToHunks } from "./topics";

/**
 * A/B probe isolating the one question the render error raises: does
 * `@pierre/diffs` break because the `hunks` array was **narrowed to a subset**,
 * or because of something about the fixture files themselves?
 *
 * Same files, rendered twice: `?probe=full` passes every hunk untouched,
 * `?probe=narrow` passes a subset. If only `narrow` errors, the design's
 * "render arbitrary re-grouped hunk subsets" claim is false and the
 * Understanding tab needs its documented fallback.
 */
export function Probe() {
	const mode = new URLSearchParams(window.location.search).get("probe");
	const narrow = mode === "narrow";

	const items = useMemo(() => {
		const files = parsePatchFiles(fixturePatch, "spike")[0].files.slice(0, 8);
		return files.map((file) => ({
			name: file.name,
			fileDiff: narrow ? narrowToHunks(file, [2, 3]) : file,
		}));
	}, [narrow]);

	return (
		<WorkerPoolContextProvider
			poolOptions={{ workerFactory: () => new DiffsWorker(), poolSize: 4 }}
			highlighterOptions={{
				theme: "spike-vars",
				preferredHighlighter: "shiki-js",
			}}
		>
			<div data-probe-mode={narrow ? "narrow" : "full"}>
				{items.map((item) => (
					<div key={item.name} data-probe-file={item.name}>
						<FileDiff
							fileDiff={item.fileDiff}
							options={{
								theme: "spike-vars",
								diffStyle: "unified",
								hunkSeparators: "line-info",
							}}
						/>
					</div>
				))}
			</div>
		</WorkerPoolContextProvider>
	);
}
