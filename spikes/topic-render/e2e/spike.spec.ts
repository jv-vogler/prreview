import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

/**
 * The Understanding tab's render cost, measured rather than assumed.
 *
 * The design commits to "many small in-flow `FileDiff` views" over one filtered
 * `CodeView`, with a documented fallback (static excerpts from the IR) if ~48
 * instances disappoint. This spec produces the numbers that decide it, and
 * pins the two behaviors the tab depends on: hunk-subset narrowing, and
 * omitted hunks staying unexpandable so a topic block is a curated excerpt.
 *
 * Run: npm run spike   (in spikes/topic-render/)
 */

const CAPTURE_PATH = fileURLToPath(new URL("../capture.json", import.meta.url));

const EXPECTED_TOPICS = 8;
const EXPECTED_BLOCKS = 48;

interface Capture {
	topics: number;
	blocks: number;
	overlappingHunks: number;
	collapsedFirstPaintMs: number;
	collapsedDomNodes: number;
	collapsedInstances: number;
	expandAllMs: number;
	instancesInDom: number;
	instancesMaterializedAtRest: number;
	domNodesExpanded: number;
	heapCollapsedMb: number | null;
	heapExpandedMb: number | null;
	scrollSweepMs: number;
	longTasksDuringSweep: number;
	longestTaskMs: number;
	distinctBlocksMaterialized: number;
	scrollHeightPx: number;
	cspViolations: string[];
	pageErrors: string[];
	omittedHunksExpandable: boolean;
}

test("~48 FileDiff instances in one page: does it hold up?", async ({
	page,
}) => {
	const consoleErrors: string[] = [];
	page.on("console", (message) => {
		if (message.type() === "error") {
			consoleErrors.push(message.text());
		}
	});
	page.on("pageerror", (error) => consoleErrors.push(String(error)));

	const navigationStart = Date.now();
	await page.goto("/");
	await expect(page.locator("[data-topic-id]").first()).toBeVisible({
		timeout: 30_000,
	});
	const collapsedFirstPaintMs = Date.now() - navigationStart;

	const counts = await page.evaluate(() => ({
		topics: window.__spike.topicCount,
		blocks: window.__spike.blockCount,
		overlapping: window.__spike.overlappingHunkCount,
	}));
	expect(counts.topics).toBe(EXPECTED_TOPICS);
	expect(counts.blocks).toBe(EXPECTED_BLOCKS);
	// the many-to-many case must actually be exercised, or this measures nothing
	expect(counts.overlapping).toBeGreaterThan(0);

	// collapsed default: nothing diff-shaped exists until a topic is opened
	const collapsedInstances = await page.locator("diffs-container").count();
	const collapsedDomNodes = await page.evaluate(
		() => document.querySelectorAll("*").length,
	);
	const heapCollapsedMb = await readHeapMb(page);

	// --- worst realistic case: every topic open at once
	const expandStart = Date.now();
	await page.evaluate(() => window.__spike.expandAll());
	await expect
		.poll(async () => page.locator("diffs-container").count(), {
			timeout: 60_000,
		})
		.toBe(EXPECTED_BLOCKS);
	await page.waitForFunction(
		() =>
			Array.from(document.querySelectorAll("diffs-container")).some(
				(container) =>
					(container.shadowRoot?.querySelectorAll("[data-line]").length ?? 0) >
					0,
			),
		undefined,
		{ timeout: 60_000 },
	);
	const expandAllMs = Date.now() - expandStart;

	const instancesInDom = await page.locator("diffs-container").count();
	const instancesMaterializedAtRest = await materializedCount(page);
	const domNodesExpanded = await page.evaluate(
		() => document.querySelectorAll("*").length,
	);
	const heapExpandedMb = await readHeapMb(page);

	// --- scroll the virtualizer end to end, watching for jank
	const sweep = await page.evaluate(async () => {
		const scroller = document.querySelector(".understanding-scroller");
		if (scroller === null) {
			throw new Error("missing virtualizer scroll container");
		}
		const longTasks: number[] = [];
		let observer: PerformanceObserver | null = null;
		try {
			observer = new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) {
					longTasks.push(entry.duration);
				}
			});
			observer.observe({ entryTypes: ["longtask"] });
		} catch {
			// longtask unsupported here — reported as 0 and noted in the verdict
		}
		const materialized = new Set<string>();
		const collect = () => {
			for (const container of document.querySelectorAll("diffs-container")) {
				const lines =
					container.shadowRoot?.querySelectorAll("[data-line]").length ?? 0;
				const key = container
					.closest("[data-block-key]")
					?.getAttribute("data-block-key");
				if (lines > 0 && key != null) {
					materialized.add(key);
				}
			}
		};

		const started = performance.now();
		let guard = 0;
		while (
			scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 2 &&
			guard < 400
		) {
			scroller.scrollBy(0, scroller.clientHeight * 0.85);
			await new Promise((resolve) => requestAnimationFrame(resolve));
			await new Promise((resolve) => setTimeout(resolve, 60));
			collect();
			guard++;
		}
		const ms = performance.now() - started;
		observer?.disconnect();
		return {
			ms,
			longTasks: longTasks.length,
			longestTaskMs: Math.round(Math.max(0, ...longTasks)),
			distinct: materialized.size,
			scrollHeight: scroller.scrollHeight,
		};
	});

	// --- the curated-excerpt promise: omitted hunks must not be expandable
	const omittedHunksExpandable = await page.evaluate(() => {
		return Array.from(document.querySelectorAll("diffs-container")).some(
			(container) => {
				const root = container.shadowRoot;
				if (root === null) {
					return false;
				}
				const expanders = root.querySelectorAll(
					"button[data-expand], [data-expansion], [data-expand-direction]",
				);
				return Array.from(expanders).some(
					(node) => !(node as HTMLButtonElement).disabled,
				);
			},
		);
	});

	const runtime = await page.evaluate(() => ({
		csp: window.__spike.cspViolations,
		errors: window.__spike.pageErrors,
	}));

	const capture: Capture = {
		topics: counts.topics,
		blocks: counts.blocks,
		overlappingHunks: counts.overlapping,
		collapsedFirstPaintMs,
		collapsedDomNodes,
		collapsedInstances,
		expandAllMs,
		instancesInDom,
		instancesMaterializedAtRest,
		domNodesExpanded,
		heapCollapsedMb,
		heapExpandedMb,
		scrollSweepMs: Math.round(sweep.ms),
		longTasksDuringSweep: sweep.longTasks,
		longestTaskMs: sweep.longestTaskMs,
		distinctBlocksMaterialized: sweep.distinct,
		scrollHeightPx: Math.round(sweep.scrollHeight),
		cspViolations: runtime.csp,
		pageErrors: [...runtime.errors, ...consoleErrors],
		omittedHunksExpandable,
	};
	writeFileSync(CAPTURE_PATH, `${JSON.stringify(capture, null, "\t")}\n`);

	// Correctness, not performance — these are the go/no-go conditions:
	expect(instancesInDom).toBe(EXPECTED_BLOCKS);
	expect(collapsedInstances).toBe(0);
	expect(capture.cspViolations).toEqual([]);
	expect(capture.pageErrors).toEqual([]);
	expect(omittedHunksExpandable).toBe(false);
	// virtualization must actually be doing something, or the design is naive
	expect(instancesMaterializedAtRest).toBeLessThan(EXPECTED_BLOCKS);
	// but scrolling must reach the content, or the tab is a wall of blanks
	expect(sweep.distinct).toBeGreaterThan(EXPECTED_BLOCKS / 2);
});

async function materializedCount(page: {
	evaluate: <T>(fn: () => T) => Promise<T>;
}): Promise<number> {
	return page.evaluate(
		() =>
			Array.from(document.querySelectorAll("diffs-container")).filter(
				(container) =>
					(container.shadowRoot?.querySelectorAll("[data-line]").length ?? 0) >
					0,
			).length,
	);
}

/** Chromium-only; null elsewhere rather than a fabricated number */
async function readHeapMb(page: {
	evaluate: <T>(fn: () => T) => Promise<T>;
}): Promise<number | null> {
	const bytes = await page.evaluate(() => {
		const memory = (
			performance as unknown as { memory?: { usedJSHeapSize: number } }
		).memory;
		return memory?.usedJSHeapSize ?? null;
	});
	return bytes === null ? null : Math.round((bytes / 1024 / 1024) * 10) / 10;
}
