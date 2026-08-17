import { parsePatchFiles } from "@pierre/diffs";
import {
	FileDiff,
	Virtualizer,
	WorkerPoolContextProvider,
} from "@pierre/diffs/react";
import DiffsWorker from "@pierre/diffs/worker/worker.js?worker";
import { useEffect, useMemo, useState } from "react";
import { fixturePatch, fixtureStats } from "./fixture";
import { blockKey, buildTopics, narrowToHunks } from "./topics";

/**
 * The Understanding tab's render shape under measurement: many small in-flow
 * `FileDiff` views, one per (topic, file) block, all inside one scrolling
 * page — as opposed to the diff tab's single virtualized `CodeView`.
 *
 * The open question this answers: does ~48 `FileDiff` instances stay usable,
 * or does the tab need the static-excerpt fallback?
 */

interface SpikeApi {
	fixtureStats: typeof fixtureStats;
	topicCount: number;
	blockCount: number;
	/** blocks whose hunk subset is shared with another block (many-to-many) */
	overlappingHunkCount: number;
	collapsedDefault: boolean;
	expandAll(): void;
	collapseAll(): void;
	cspViolations: string[];
	pageErrors: string[];
	mountedAt: number | null;
}

declare global {
	interface Window {
		__spike: SpikeApi;
	}
}

const spikeApi: SpikeApi = {
	fixtureStats,
	topicCount: 0,
	blockCount: 0,
	overlappingHunkCount: 0,
	collapsedDefault: true,
	expandAll: () => undefined,
	collapseAll: () => undefined,
	cspViolations: [],
	pageErrors: [],
	mountedAt: null,
};
window.__spike = spikeApi;

window.addEventListener("securitypolicyviolation", (event) => {
	spikeApi.cspViolations.push(
		`${event.violatedDirective}: ${event.blockedURI}`,
	);
});

function TopicBlockView({
	topicId,
	fileName,
	fileDiff,
}: {
	topicId: string;
	fileName: string;
	// biome-ignore lint/suspicious/noExplicitAny: spike-local narrowing
	fileDiff: any;
}) {
	return (
		<div className="block" data-block-key={blockKey(topicId, fileName)}>
			<FileDiff
				fileDiff={fileDiff}
				options={{
					theme: "spike-vars",
					diffStyle: "unified",
					hunkSeparators: "line-info",
					stickyHeader: false,
					// deliberately NO loadDiffFiles: omitted hunks must stay
					// collapsed and unexpandable, so a topic block is a curated
					// excerpt rather than a doorway back into the whole file
				}}
			/>
		</div>
	);
}

export function App() {
	const [expanded, setExpanded] = useState<Set<string>>(new Set());

	const topics = useMemo(() => {
		const parsed = parsePatchFiles(fixturePatch, "spike");
		const files = parsed[0].files;
		const byName = new Map(files.map((file) => [file.name, file]));
		const built = buildTopics(files);

		// count hunks reachable from more than one topic — the many-to-many case
		const seen = new Map<string, number>();
		for (const topic of built) {
			for (const block of topic.blocks) {
				for (const hunkIndex of block.hunkIndices) {
					const key = `${block.fileName}#${hunkIndex}`;
					seen.set(key, (seen.get(key) ?? 0) + 1);
				}
			}
		}
		spikeApi.overlappingHunkCount = [...seen.values()].filter(
			(count) => count > 1,
		).length;

		return built.map((topic) => ({
			...topic,
			resolved: topic.blocks.flatMap((block) => {
				const file = byName.get(block.fileName);
				return file === undefined
					? []
					: [
							{
								fileName: block.fileName,
								fileDiff: narrowToHunks(file, block.hunkIndices),
							},
						];
			}),
		}));
	}, []);

	useEffect(() => {
		spikeApi.topicCount = topics.length;
		spikeApi.blockCount = topics.reduce(
			(total, topic) => total + topic.resolved.length,
			0,
		);
		spikeApi.expandAll = () =>
			setExpanded(new Set(topics.map((topic) => topic.id)));
		spikeApi.collapseAll = () => setExpanded(new Set());
		spikeApi.mountedAt = performance.now();
	}, [topics]);

	return (
		<Virtualizer
			className="understanding-scroller"
			style={{ height: "100vh", overflow: "auto" }}
			contentClassName="understanding"
		>
			{topics.map((topic) => {
				const isOpen = expanded.has(topic.id);
				return (
					<section
						key={topic.id}
						className="topic"
						data-topic-id={topic.id}
						data-open={isOpen ? "true" : "false"}
					>
						<header>
							<button
								type="button"
								data-topic-toggle={topic.id}
								onClick={() =>
									setExpanded((current) => {
										const next = new Set(current);
										if (next.has(topic.id)) {
											next.delete(topic.id);
										} else {
											next.add(topic.id);
										}
										return next;
									})
								}
							>
								{isOpen ? "▾" : "▸"} {topic.title}
							</button>
							<p>{topic.summary}</p>
							<span data-topic-blockcount={topic.resolved.length}>
								{topic.resolved.length} places in the code
							</span>
						</header>
						{isOpen
							? topic.resolved.map((block) => (
									<TopicBlockView
										key={blockKey(topic.id, block.fileName)}
										topicId={topic.id}
										fileName={block.fileName}
										fileDiff={block.fileDiff}
									/>
								))
							: null}
					</section>
				);
			})}
		</Virtualizer>
	);
}

export function Root() {
	return (
		<WorkerPoolContextProvider
			poolOptions={{ workerFactory: () => new DiffsWorker(), poolSize: 4 }}
			highlighterOptions={{
				theme: "spike-vars",
				preferredHighlighter: "shiki-js",
			}}
		>
			<App />
		</WorkerPoolContextProvider>
	);
}
