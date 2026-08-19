import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import {
	createFixtureRepo,
	type FixtureRepo,
} from "../test/helpers/createFixtureRepo";
import { createPathShim, type PathShim } from "../test/helpers/shimPath";
import {
	launchPrreview,
	type RunningServer,
	stopServer,
} from "./helpers/prreviewServer";

/**
 * What a run looks like while it happens, and when it does not happen.
 *
 * This spec exists because of a specific failure: a comprehension pass showed
 * "Running…" and nothing else, indefinitely, and the only way to find out
 * whether it was working was to curl the API from a terminal. Twice the tool
 * computed something useful — an agent reading files, a failure with a reason —
 * and told nobody. The rule this pins down is that anything prreview knows
 * about a run has to reach the screen without being asked.
 */

const UNDERSTANDING_CAPTURE = fileURLToPath(
	new URL("../test/fixtures/claude/understanding.jsonl", import.meta.url),
);
/**
 * A real recorded API failure: `terminal_reason: "api_error"`, exit 1. The same
 * shape the reader hit with an expired OAuth session — which is the point, and
 * why this is not simulated with a forced non-zero exit. A fake that exits 1 for
 * everything also fails the boot probe, so the agent looks absent and the AI
 * tabs are correctly never rendered; the failure worth testing is the one that
 * happens after a healthy agent has been found.
 */
const API_ERROR_CAPTURE = fileURLToPath(
	new URL("../test/fixtures/claude/badmodel.jsonl", import.meta.url),
);

const TEST_TIMEOUT_MS = 180_000;
const APPEARS_TIMEOUT_MS = 60_000;
/** slow enough that the status bar is observable mid-run, fast enough to finish */
const LINE_DELAY_MS = "12";

test.describe("run feedback", () => {
	test.setTimeout(TEST_TIMEOUT_MS);

	let repo: FixtureRepo;
	let shim: PathShim;
	let agentScratch: string;
	const servers: RunningServer[] = [];

	test.beforeEach(async () => {
		repo = await createFixtureRepo();
		shim = await createPathShim();
		agentScratch = await mkdtemp(join(tmpdir(), "prreview-agent-"));

		await repo.write("src/greeting.ts", COMMITTED_GREETING);
		await repo.commitAll("add the greeting");
		await repo.write("src/greeting.ts", DIRTY_GREETING);
	});

	test.afterEach(async () => {
		await Promise.all(servers.splice(0).map((server) => stopServer(server)));
		await Promise.all([
			shim.dispose(),
			repo.dispose(),
			rm(agentScratch, { recursive: true, force: true }),
		]);
	});

	test("says what the run is doing, in the browser and in the terminal", async ({
		page,
	}) => {
		const server = await launchPrreview({
			cwd: repo.root,
			pathValue: shim.withFakes,
			env: {
				FAKE_CLAUDE_FIXTURE: UNDERSTANDING_CAPTURE,
				FAKE_CLAUDE_DELAY_MS: LINE_DELAY_MS,
			},
		});
		servers.push(server);

		await page.goto(server.url);
		await page.locator('[data-tab="understand"]').click();
		await page.locator("[data-analysis-start]").click();

		// ── the bar exists, and it is not a spinner ────────────────────────────
		const bar = page.locator('[data-run-status="running"]');
		await expect(bar).toBeVisible({ timeout: APPEARS_TIMEOUT_MS });
		/*
		 * The clock runs, and it counts up to nothing.
		 *
		 * It used to read "0:12 of 10:00", against a wall-clock budget that killed
		 * a run at ten minutes whether or not it was working. The budget is now
		 * silence, so there is no total to count towards, and printing one would
		 * be a countdown the run is not on.
		 */
		await expect(page.locator("[data-run-elapsed]")).toContainText(/\d+:\d\d/);
		await expect(page.locator("[data-run-elapsed]")).not.toContainText(" of ");
		// and it can be stopped from wherever the reader is
		await expect(bar.getByRole("button", { name: "Stop" })).toBeVisible();

		/*
		 * The activity line: the agent's own tool calls, which the server used to
		 * receive and discard. Either it names a move or it says it is starting —
		 * what it must never do is claim nothing.
		 */
		await expect(page.locator("[data-run-activity]")).not.toBeEmpty();

		// ── the run survives a tab switch, because it belongs to the session ───
		await page.locator('[data-tab="diff"]').click();
		await expect(page.locator('[data-run-status="running"]')).toBeVisible();

		// ── and it finishes, which is the bar's other job: going away ──────────
		await expect(page.locator('[data-run-status="running"]')).toHaveCount(0, {
			timeout: APPEARS_TIMEOUT_MS,
		});

		// the terminal is the second witness — same facts, no browser required
		expect(server.stdout()).toContain("comprehension run started");
		expect(server.stdout()).toContain("comprehension run finished");
	});

	test("raises a failure wherever the reader is, with a way to retry", async ({
		page,
	}) => {
		const server = await launchPrreview({
			cwd: repo.root,
			pathValue: shim.withFakes,
			env: {
				FAKE_CLAUDE_FIXTURE: API_ERROR_CAPTURE,
			},
		});
		servers.push(server);

		await page.goto(server.url);
		await page.locator('[data-tab="understand"]').click();
		await page.locator("[data-analysis-start]").click();

		const failure = page.locator('[data-run-status="failed"]');
		await expect(failure).toBeVisible({ timeout: APPEARS_TIMEOUT_MS });
		await expect(failure).toContainText("Reading the change failed");
		await expect(
			failure.getByRole("button", { name: "Try again" }),
		).toBeVisible();

		/*
		 * The load-bearing assertion. The old build reported a failure only inside
		 * the invitation on the tab that started the pass, so a reader who moved to
		 * the diff saw a screen that had simply stopped changing — and went to a
		 * terminal to find out why.
		 */
		await page.locator('[data-tab="diff"]').click();
		await expect(page.locator('[data-run-status="failed"]')).toBeVisible();

		// the terminal said so too
		expect(server.stdout()).toContain("comprehension run FAILED");
	});

	test("folds a file when it is marked viewed, and reopens it on request", async ({
		page,
	}) => {
		const server = await launchPrreview({
			cwd: repo.root,
			pathValue: shim.withFakes,
		});
		servers.push(server);

		await page.goto(server.url);

		const box = page.locator("[data-file-viewed]").first();
		await expect(box).toBeVisible();
		await expect(box).not.toBeChecked();
		// the code is on screen before anyone ticks anything
		await expect(page.getByText("excited").first()).toBeVisible();

		await box.check();
		await expect(box).toBeChecked();
		// ticking folds it away, the way GitHub does
		await expect(page.getByText("excited")).toHaveCount(0);

		/*
		 * Reopening must not untick it. Having read something once is not a reason
		 * to be unable to look again, and being unable to look again without
		 * throwing away the record is the reason folding and viewing are two
		 * separate controls rather than one.
		 */
		await page.locator("[data-file-fold]").first().click();
		await expect(page.getByText("excited").first()).toBeVisible();
		await expect(box).toBeChecked();

		/*
		 * The whole header is the control, not just the chevron.
		 *
		 * This clicks the filename — inside the renderer's shadow root, which is
		 * why the delegated listener has to read the composed path rather than
		 * the event target. A bar carrying a name, a change count and two
		 * controls, where only one small triangle does anything, wastes the
		 * widest target on the screen.
		 */
		await page.locator("[data-diffs-header] [data-title]").first().click();
		await expect(page.getByText("excited")).toHaveCount(0);
		// and it is still a fold, not a state change: the record survives
		await expect(box).toBeChecked();

		await page.locator("[data-file-fold]").first().click();
		await expect(page.getByText("excited").first()).toBeVisible();

		/*
		 * The fold is eased, not cut to.
		 *
		 * This samples the code region's height while the fold is in flight and
		 * asserts it is partway down: strictly shorter than it started, strictly
		 * taller than nothing. An instant collapse cannot produce that reading,
		 * and neither can a broken one — the element is gone the moment the
		 * renderer is told to collapse, so a sample of a real intermediate height
		 * is proof that the clamp ran before the commit.
		 *
		 * The animation is only possible because `CodeView` resize-observes the
		 * container its items live in and re-reconciles on any drift, so easing
		 * the height drives its layout model rather than desynchronizing it. If
		 * that ever stops being true this test is where it will show.
		 */
		// the locator pierces the shadow root the code region lives in
		const codeHeight = () =>
			page
				.locator("[data-diff]")
				.first()
				// a short timeout because absence is an expected answer here: the
				// renderer drops the code once a fold commits, and waiting the
				// default half-minute for each of those samples is the difference
				// between a two-second test and a timed-out one
				.evaluate((code) => code.getBoundingClientRect().height, undefined, {
					timeout: 200,
				})
				.catch(() => 0);

		/**
		 * Samples the code region while a fold plays, and reports whether it was
		 * ever caught partway.
		 *
		 * An instant fold cannot produce a height strictly between nothing and the
		 * height it started at, in either direction — the code is either laid out
		 * or removed. So one intermediate reading is the proof, and sampling for
		 * it beats waiting a fixed interval and hoping to land inside the
		 * animation on a loaded machine.
		 */
		const foldPlaysOut = async (act: Promise<void>, from: number) => {
			const seen: number[] = [];
			await act;
			for (let sample = 0; sample < 12; sample++) {
				seen.push(await codeHeight());
				await page.waitForTimeout(20);
			}
			return seen.some((height) => height > 0 && height < from);
		};

		/** the height once nothing is mid-fold; a clamped file measures short */
		const settledHeight = async () => {
			await expect(page.locator("[data-prr-folding]")).toHaveCount(0);
			return codeHeight();
		};

		const openHeight = await settledHeight();
		expect(openHeight).toBeGreaterThan(0);

		/*
		 * Shut, eased. This is only possible because `CodeView` resize-observes
		 * the container its items live in and re-reconciles on any drift, so
		 * animating the height drives its layout model rather than
		 * desynchronizing it. If that ever stops being true, this is where it
		 * shows.
		 */
		expect(
			await foldPlaysOut(
				page.locator("[data-diffs-header] [data-title]").first().click(),
				openHeight,
			),
		).toBe(true);
		await expect(page.getByText("excited")).toHaveCount(0);

		// and open again, which has to grow from nothing rather than appear
		expect(
			await foldPlaysOut(
				page.locator("[data-file-fold]").first().click(),
				openHeight,
			),
		).toBe(true);
		// and it ends open, with nothing left clamped by an animation that never
		// finished — the failure mode that would hide a file for good
		expect(await settledHeight()).toBeGreaterThan(0);

		// unticking is the only thing that gives the coverage back
		await box.uncheck();
		await expect(
			page.getByRole("meter", { name: "Review coverage" }),
		).toHaveAttribute("aria-valuenow", "0");
	});
});

const COMMITTED_GREETING = [
	"export function greet(name: string) {",
	'  return "hello, " + name;',
	"}",
	"",
].join("\n");

const DIRTY_GREETING = [
	"export function greet(name: string, excited = false) {",
	'  const base = "hello, " + name;',
	'  return excited ? base + "!" : base;',
	"}",
	"",
].join("\n");
