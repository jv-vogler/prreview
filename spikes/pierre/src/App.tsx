import type {
	CodeViewDiffItem,
	FileDiffLoadedFiles,
	FileDiffMetadata,
} from "@pierre/diffs";
import { parsePatchFiles } from "@pierre/diffs";
import type { CodeViewHandle } from "@pierre/diffs/react";
import {
	CodeView,
	useWorkerPool,
	WorkerPoolContextProvider,
} from "@pierre/diffs/react";
import type { WorkerStats } from "@pierre/diffs/worker";
import DiffsWorker from "@pierre/diffs/worker/worker.js?worker";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnnotationCard } from "./AnnotationCard";
import type { AnnotationMetadata } from "./annotations";
import { buildAnnotationsByFile } from "./annotations";
import { fixturePatch, fixtureStats, lookupFixtureFile } from "./fixture";

type DiffStyle = "unified" | "split";

interface LoadDiffFilesCallRecord {
	requestKeys: string[];
	request: {
		name: string;
		prevName?: string;
		newObjectId?: string;
		prevObjectId?: string;
		type: string;
		isPartial: boolean;
		cacheKey?: string;
		hunkCount: number;
	};
	responseShape: {
		oldFile: "FileContents" | "null";
		newFile: "FileContents";
		fileContentsKeys: string[];
	};
}

interface SpikeApi {
	fixtureStats: typeof fixtureStats;
	itemIds: string[];
	scrollToFile(itemId: string): void;
	scrollToHunk(itemId: string, hunkIndex: number): void;
	getHunkStartLine(itemId: string, hunkIndex: number): number;
	toggleDiffStyle(): void;
	getDiffStyle(): DiffStyle;
	setExpandUnchanged(expand: boolean): void;
	flipTheme(): string;
	getTheme(): string;
	loadDiffFilesCalls: LoadDiffFilesCallRecord[];
	cspViolations: string[];
	workerStats: WorkerStats | null;
	annotationTotal: number;
}

declare global {
	interface Window {
		__spike: SpikeApi;
	}
}

const spikeApi: SpikeApi = {
	fixtureStats,
	itemIds: [],
	scrollToFile: () => undefined,
	scrollToHunk: () => undefined,
	getHunkStartLine: () => 0,
	toggleDiffStyle: () => undefined,
	getDiffStyle: () => "unified",
	setExpandUnchanged: () => undefined,
	flipTheme: () => "",
	getTheme: () => "",
	loadDiffFilesCalls: [],
	cspViolations: [],
	workerStats: null,
	annotationTotal: 0,
};
window.__spike = spikeApi;

window.addEventListener("securitypolicyviolation", (event) => {
	spikeApi.cspViolations.push(
		`${event.violatedDirective}: ${event.blockedURI}`,
	);
});

async function captureLoadDiffFiles(
	fileDiff: FileDiffMetadata,
): Promise<FileDiffLoadedFiles> {
	const fixtureFile = lookupFixtureFile(fileDiff.name);
	if (fixtureFile === undefined) {
		throw new Error(`loadDiffFiles asked for unknown file: ${fileDiff.name}`);
	}
	const response: FileDiffLoadedFiles = {
		oldFile: { name: fileDiff.name, contents: fixtureFile.oldLines.join("\n") },
		newFile: { name: fileDiff.name, contents: fixtureFile.newLines.join("\n") },
	};
	spikeApi.loadDiffFilesCalls.push({
		requestKeys: Object.keys(fileDiff).sort(),
		request: {
			name: fileDiff.name,
			prevName: fileDiff.prevName,
			newObjectId: fileDiff.newObjectId,
			prevObjectId: fileDiff.prevObjectId,
			type: fileDiff.type,
			isPartial: fileDiff.isPartial,
			cacheKey: fileDiff.cacheKey,
			hunkCount: fileDiff.hunks.length,
		},
		responseShape: {
			oldFile: response.oldFile === null ? "null" : "FileContents",
			newFile: "FileContents",
			fileContentsKeys: Object.keys(response.newFile).sort(),
		},
	});
	return response;
}

function flipTheme(): string {
	const root = document.documentElement;
	const next = root.dataset.spikeTheme === "light" ? "dark" : "light";
	root.dataset.spikeTheme = next;
	return next;
}

function WorkerStatsProbe() {
	const pool = useWorkerPool();
	useEffect(() => {
		if (pool === undefined) return;
		return pool.subscribeToStatChanges((stats) => {
			spikeApi.workerStats = stats;
		});
	}, [pool]);
	return null;
}

function DiffWorkspace() {
	const handleRef = useRef<CodeViewHandle<AnnotationMetadata>>(null);
	const [diffStyle, setDiffStyle] = useState<DiffStyle>("unified");
	const [expandUnchanged, setExpandUnchanged] = useState(false);

	const items = useMemo<CodeViewDiffItem<AnnotationMetadata>[]>(() => {
		const parsed = parsePatchFiles(fixturePatch, "spike");
		const annotationsByFile = buildAnnotationsByFile();
		return parsed[0].files.map((fileDiff) => ({
			id: fileDiff.name,
			type: "diff",
			fileDiff,
			annotations: annotationsByFile.get(fileDiff.name),
		}));
	}, []);

	useEffect(() => {
		spikeApi.itemIds = items.map((item) => item.id);
		spikeApi.annotationTotal = items.reduce(
			(total, item) => total + (item.annotations?.length ?? 0),
			0,
		);
		spikeApi.scrollToFile = (itemId) => {
			handleRef.current?.scrollTo({
				type: "item",
				id: itemId,
				align: "start",
				behavior: "instant",
			});
		};
		spikeApi.getHunkStartLine = (itemId, hunkIndex) => {
			const item = items.find((candidate) => candidate.id === itemId);
			return item?.fileDiff.hunks[hunkIndex]?.additionStart ?? 0;
		};
		spikeApi.scrollToHunk = (itemId, hunkIndex) => {
			const lineNumber = spikeApi.getHunkStartLine(itemId, hunkIndex);
			handleRef.current?.scrollTo({
				type: "line",
				id: itemId,
				lineNumber,
				side: "additions",
				align: "start",
				behavior: "instant",
			});
		};
		spikeApi.flipTheme = flipTheme;
		spikeApi.getTheme = () =>
			document.documentElement.dataset.spikeTheme ?? "light";
	}, [items]);

	useEffect(() => {
		spikeApi.toggleDiffStyle = () => {
			setDiffStyle((current) => (current === "unified" ? "split" : "unified"));
		};
		spikeApi.setExpandUnchanged = setExpandUnchanged;
	}, []);

	useEffect(() => {
		spikeApi.getDiffStyle = () => diffStyle;
	}, [diffStyle]);

	return (
		<CodeView<AnnotationMetadata>
			ref={handleRef}
			items={items}
			style={{ height: "100vh", overflow: "auto" }}
			options={{
				theme: "spike-vars",
				diffStyle,
				expandUnchanged,
				loadDiffFiles: captureLoadDiffFiles,
				hunkSeparators: "line-info",
				stickyHeaders: true,
			}}
			renderAnnotation={(annotation) =>
				annotation.metadata === undefined ? null : (
					<AnnotationCard metadata={annotation.metadata} />
				)
			}
		/>
	);
}

export function App() {
	return (
		<WorkerPoolContextProvider
			poolOptions={{ workerFactory: () => new DiffsWorker(), poolSize: 4 }}
			highlighterOptions={{
				theme: "spike-vars",
				preferredHighlighter: "shiki-js",
			}}
		>
			<WorkerStatsProbe />
			<DiffWorkspace />
		</WorkerPoolContextProvider>
	);
}
