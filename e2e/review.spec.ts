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
 * Phase 5's whole surface, against the BUILT artifact (TASK-045): a review
 * pass driven by the mock agent renders its overview, places its comments,
 * collapses them by default, expands one on click, and lists an unplaceable
 * one in the sidebar (REQ-003, REQ-004, REQ-005, REQ-010).
 *
 * The mock agent is a generator, not a replay: it reads the real numbered
 * diff off the prompt and answers with findings anchored to real line
 * numbers, so nothing here depends on a captured fixture matching this
 * repo's line numbers.
 */

const TEST_TIMEOUT_MS = 120_000;
const RUN_SETTLE_TIMEOUT_MS = 30_000;

test.describe("review pass", () => {
	test.setTimeout(TEST_TIMEOUT_MS);

	let repo: FixtureRepo;
	let shim: PathShim;
	const servers: RunningServer[] = [];

	test.beforeEach(async () => {
		repo = await createFixtureRepo();
		shim = await createPathShim();

		await repo.write("src/greeting.ts", COMMITTED_GREETING);
		await repo.commitAll("add the greeting");
		await repo.write("src/greeting.ts", DIRTY_GREETING);
	});

	test.afterEach(async () => {
		await Promise.all(servers.splice(0).map((server) => stopServer(server)));
		await Promise.all([shim.dispose(), repo.dispose()]);
	});

	test("reviews the change and renders the overview, placed comments, and the sidebar", async ({
		page,
	}) => {
		const server = await launchPrreview({
			cwd: repo.root,
			pathValue: shim.withMockAgent,
		});
		servers.push(server);

		await page.goto(server.url);
		await page.getByRole("button", { name: "Review" }).click();

		// REQ-003: the overview panel renders above the diff once the pass lands
		await expect(
			page.getByText("Reviewed 1 file(s) with the mock agent"),
		).toBeVisible({ timeout: RUN_SETTLE_TIMEOUT_MS });

		// REQ-004: comments are collapsed by default — a marker, not a balloon
		const markers = page.locator("[data-comment-marker]");
		await expect(markers.first()).toBeVisible();
		await expect(page.locator("[data-comment-id]")).toHaveCount(0);

		// clicking the marker expands its balloon
		await markers.first().click();
		await expect(page.locator("[data-comment-id]").first()).toBeVisible();

		// REQ-010: a finding whose path is not in the diff is never dropped —
		// it is listed in its own sidebar section instead
		await expect(
			page.getByRole("heading", { name: "Not shown in the diff", exact: true }),
		).toBeVisible();
		await expect(page.getByText("Mock unplaceable finding")).toBeVisible();

		// REQ-005: per-tier counts in the sidebar
		// exact: the run status detail line ("… 2 findings, 1 blocker") would
		// otherwise also match and trip strict mode
		await expect(page.getByText("1 Blocker", { exact: true })).toBeVisible();

		// change explanations start unfolded at the right edge, costing no
		// diff rows; the chip folds each line's cards away and back
		const chip = page.locator("[data-explanation-chip]").first();
		await expect(chip).toBeVisible();
		const balloon = page.locator("[data-explanation-id]").first();
		await expect(balloon).toBeVisible();
		await expect(balloon.getByRole("button")).toHaveCount(0);

		await chip.click();
		await expect(page.locator("[data-explanation-id]")).toHaveCount(0);
		await chip.click();
		await expect(balloon).toBeVisible();

		// the one header toggle drops the chips entirely, and brings them back
		await page.getByRole("button", { name: "Hide explanations" }).click();
		await expect(page.locator("[data-explanation-chip]")).toHaveCount(0);
		await page.getByRole("button", { name: "Show explanations" }).click();
		await expect(chip).toBeVisible();

		// hiding explanations never touched the comments
		await expect(page.locator("[data-comment-id]").first()).toBeVisible();

		// the sidebar's second tab retells the pass as explanations: topics
		// first with one jump per anchored change, and an explanation the
		// diff cannot anchor listed and marked instead of vanishing
		await page.getByRole("tab", { name: /Explanations/ }).click();
		await expect(
			page.getByRole("button", { name: "Mock shared intent" }),
		).toBeVisible();
		await expect(
			page.getByText("Mock explanation the diff cannot anchor."),
		).toBeVisible();
		await expect(page.getByText(/· not in the diff/)).toBeVisible();

		// jumping from an entry lights that balloon on the diff
		await page.locator("[data-explanation-entry] button").first().click();
		await expect(
			page.locator("[data-explanation-id][data-highlighted]").first(),
		).toBeVisible();

		// back to the worklist for everything below
		await page.getByRole("tab", { name: /Comments/ }).click();

		// the overview unfolded itself when the run finished; folding it gives
		// the height back to the diff and keeps the verdict on the fold line
		await page.getByRole("button", { name: /Overview/ }).click();
		await expect(
			page.getByText("Reviewed 1 file(s) with the mock agent"),
		).toBeHidden();
		await expect(page.locator("[data-scope='matches']")).toBeVisible();

		// ?explanations=margin: the comparison mode keeps every card open,
		// pinned right, with no chips (the pass is stored, so no second run)
		await page.goto(`${server.url}?explanations=margin`);
		await expect(page.locator("[data-explanation-id]").first()).toBeVisible({
			timeout: RUN_SETTLE_TIMEOUT_MS,
		});
		await expect(page.locator("[data-explanation-chip]")).toHaveCount(0);
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
