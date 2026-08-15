import { writeFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";

/**
 * Drives the built spike (served with the production CSP) and verifies every
 * Spike 1 exit criterion programmatically. Findings that feed VERDICT.md are
 * written to capture.json.
 */

const MINIMUM_DIFF_LINES = 5000;
const MINIMUM_FILE_COUNT = 30;
const EXPECTED_ANNOTATION_COUNT = 30;
const EXPECTED_SPECIES_COUNT = 3;
const SCROLL_TOP_TOLERANCE_PX = 220;

interface Capture {
	fixtureStats?: unknown;
	loadDiffFilesFirstCall?: unknown;
	loadDiffFilesCallCount?: number;
	themeFlip?: unknown;
	workerStats?: unknown;
	cspViolations?: string[];
	annotationHeights?: number[];
}

const capture: Capture = {};

test.afterAll(() => {
	writeFileSync(
		new URL("../capture.json", import.meta.url),
		JSON.stringify(capture, null, 2),
	);
});

async function openSpike(page: Page): Promise<string[]> {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(String(error)));
	await page.goto("/");
	await expect(page.locator("diffs-container").first()).toBeVisible({
		timeout: 30_000,
	});
	return pageErrors;
}

async function itemIds(page: Page): Promise<string[]> {
	return page.evaluate(() => window.__spike.itemIds);
}

/** Top of the item's container relative to the viewport, searched by item id.
 * Item ids are the fixture file names, which render as the header's
 * `[data-title]` text inside the open shadow root. */
async function itemViewportTop(
	page: Page,
	itemId: string,
): Promise<number | null> {
	return page.evaluate((id) => {
		const containers = Array.from(document.querySelectorAll("diffs-container"));
		const target = containers.find(
			(container) =>
				container.shadowRoot
					?.querySelector("[data-title]")
					?.textContent?.trim() === id,
		);
		if (target == null) return null;
		return target.getBoundingClientRect().top;
	}, itemId);
}

test.describe("pierre spike", () => {
	test("renders the full fixture and answers every exit criterion", async ({
		page,
	}) => {
		const pageErrors = await openSpike(page);

		// --- fixture size ---
		const stats = await page.evaluate(() => window.__spike.fixtureStats);
		capture.fixtureStats = stats;
		expect(stats.totalPatchLines).toBeGreaterThanOrEqual(MINIMUM_DIFF_LINES);
		expect(stats.fileCount).toBeGreaterThanOrEqual(MINIMUM_FILE_COUNT);

		const ids = await itemIds(page);
		expect(ids.length).toBeGreaterThanOrEqual(MINIMUM_FILE_COUNT);

		// --- worker pool under CSP ---
		await page.waitForFunction(() => {
			const stats = window.__spike.workerStats;
			return (
				stats !== null &&
				stats.managerState === "initialized" &&
				!stats.workersFailed
			);
		});
		// Let highlight tasks flow through the pool before sampling stats.
		await page.waitForFunction(() => {
			const stats = window.__spike.workerStats;
			return (
				stats !== null && (stats.fileCacheSize > 0 || stats.diffCacheSize > 0)
			);
		});
		capture.workerStats = await page.evaluate(() => window.__spike.workerStats);
		capture.cspViolations = await page.evaluate(
			() => window.__spike.cspViolations,
		);
		expect(capture.cspViolations).toEqual([]);

		// --- scroll-to-file (go/no-go) ---
		const farFileId = ids[25];
		await page.evaluate((id) => window.__spike.scrollToFile(id), farFileId);
		await page.waitForTimeout(300);
		const fileTop = await itemViewportTop(page, farFileId);
		expect(fileTop).not.toBeNull();
		expect(Math.abs(fileTop ?? Number.MAX_SAFE_INTEGER)).toBeLessThan(
			SCROLL_TOP_TOLERANCE_PX,
		);

		// --- scroll-to-hunk (go/no-go) ---
		const hunkFileId = ids[10];
		const hunkIndex = 5;
		const hunkStartLine = await page.evaluate(
			({ id, index }) => window.__spike.getHunkStartLine(id, index),
			{ id: hunkFileId, index: hunkIndex },
		);
		expect(hunkStartLine).toBeGreaterThan(0);
		await page.evaluate(
			({ id, index }) => window.__spike.scrollToHunk(id, index),
			{ id: hunkFileId, index: hunkIndex },
		);
		await page.waitForTimeout(300);
		const lineTop = await page.evaluate(
			({ id, line }) => {
				const containers = Array.from(
					document.querySelectorAll("diffs-container"),
				);
				for (const container of containers) {
					const root = container.shadowRoot;
					if (root?.querySelector("[data-title]")?.textContent?.trim() !== id)
						continue;
					const row = root.querySelector(
						`[data-additions] [data-line="${line}"], [data-line="${line}"]`,
					);
					if (row == null) return null;
					return row.getBoundingClientRect().top;
				}
				return null;
			},
			{ id: hunkFileId, line: hunkStartLine },
		);
		expect(lineTop).not.toBeNull();
		expect(lineTop ?? Number.MAX_SAFE_INTEGER).toBeGreaterThanOrEqual(
			-SCROLL_TOP_TOLERANCE_PX,
		);
		expect(lineTop ?? Number.MAX_SAFE_INTEGER).toBeLessThan(
			SCROLL_TOP_TOLERANCE_PX,
		);

		// --- split/unified toggle ---
		const unifiedMarkers = await page
			.locator("diffs-container [data-unified]")
			.count();
		expect(unifiedMarkers).toBeGreaterThan(0);
		await page.evaluate(() => window.__spike.toggleDiffStyle());
		await expect(
			page.locator("diffs-container [data-deletions]").first(),
		).toBeAttached();
		const splitDeletionColumns = await page
			.locator("diffs-container [data-deletions]")
			.count();
		const splitAdditionColumns = await page
			.locator("diffs-container [data-additions]")
			.count();
		expect(splitDeletionColumns).toBeGreaterThan(0);
		expect(splitAdditionColumns).toBeGreaterThan(0);
		await page.evaluate(() => window.__spike.toggleDiffStyle());
		await expect(
			page.locator("diffs-container [data-unified]").first(),
		).toBeAttached();

		// --- annotations: 30 cards, 3 species, variable heights, via portals ---
		// Annotation for file index N sits on hunk N % 8 (see annotations.ts), so
		// the sweep scrolls to each annotation's own hunk to bring it into the
		// virtualization window.
		const seenAnnotations = new Map<
			string,
			{ species: string; height: number }
		>();
		const HUNKS_PER_FILE = 8;
		for (const [index, id] of ids
			.slice(0, EXPECTED_ANNOTATION_COUNT)
			.entries()) {
			await page.evaluate(
				({ itemId, hunk }) => window.__spike.scrollToHunk(itemId, hunk),
				{ itemId: id, hunk: index % HUNKS_PER_FILE },
			);
			await page.waitForTimeout(150);
			const visible = await page
				.locator("[data-annotation-id]")
				.evaluateAll((nodes) =>
					nodes.map((node) => ({
						id: node.getAttribute("data-annotation-id") ?? "",
						species: node.getAttribute("data-annotation-species") ?? "",
						height: node.getBoundingClientRect().height,
					})),
				);
			for (const annotation of visible) {
				if (annotation.height > 0)
					seenAnnotations.set(annotation.id, annotation);
			}
		}
		expect(seenAnnotations.size).toBe(EXPECTED_ANNOTATION_COUNT);
		const speciesSeen = new Set(
			Array.from(seenAnnotations.values(), (a) => a.species),
		);
		expect(speciesSeen.size).toBe(EXPECTED_SPECIES_COUNT);
		const heights = Array.from(seenAnnotations.values(), (a) =>
			Math.round(a.height),
		);
		capture.annotationHeights = heights;
		expect(new Set(heights).size).toBeGreaterThan(1);

		// --- loadDiffFiles request/response shape ---
		await page.evaluate(() => window.__spike.setExpandUnchanged(true));
		await page.waitForFunction(
			() => window.__spike.loadDiffFilesCalls.length > 0,
		);
		const calls = await page.evaluate(() => window.__spike.loadDiffFilesCalls);
		capture.loadDiffFilesCallCount = calls.length;
		capture.loadDiffFilesFirstCall = calls[0];
		expect(calls[0].request.isPartial).toBe(true);
		expect(calls[0].request.name).toContain("src/module-");
		expect(calls[0].responseShape.newFile).toBe("FileContents");

		// --- registerCustomCSSVariableTheme live flip: cascade vs snapshot ---
		const sampleThemeProbe = () =>
			page.evaluate(() => {
				const container = Array.from(
					document.querySelectorAll("diffs-container"),
				).find(
					(candidate) =>
						candidate.shadowRoot?.querySelector('span[style*="--diffs"]') !=
						null,
				);
				const tokenSpan = container?.shadowRoot?.querySelector(
					'span[style*="--diffs"]',
				);
				if (container == null || tokenSpan == null) return null;
				const pre = container.shadowRoot?.querySelector("pre");
				return {
					tokenColor: getComputedStyle(tokenSpan).color,
					tokenStyleAttr: tokenSpan.getAttribute("style"),
					containerBackground:
						pre == null ? null : getComputedStyle(pre).backgroundColor,
				};
			});
		const lightProbe = await sampleThemeProbe();
		expect(lightProbe).not.toBeNull();
		await page.evaluate(() => window.__spike.flipTheme());
		await page.waitForTimeout(200);
		const darkProbe = await sampleThemeProbe();
		expect(darkProbe).not.toBeNull();
		const cascades = lightProbe?.tokenColor !== darkProbe?.tokenColor;
		capture.themeFlip = { lightProbe, darkProbe, cascades };
		expect(cascades).toBe(true);

		// --- CSP violations and page errors stay empty through the whole run ---
		const finalViolations = await page.evaluate(
			() => window.__spike.cspViolations,
		);
		expect(finalViolations).toEqual([]);
		expect(pageErrors).toEqual([]);
	});
});
