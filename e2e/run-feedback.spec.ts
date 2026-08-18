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
		// the deadline is named, so a long run is visibly bounded rather than
		// open-ended: "10:00" is a promise the reader can hold the tool to
		await expect(page.locator("[data-run-elapsed]")).toContainText(
			/\d+:\d\d of/,
		);
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
