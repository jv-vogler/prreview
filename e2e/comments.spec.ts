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
 * The suggested-comments surface against the BUILT artifact: run a review, read
 * the list, see the same findings as balloons in the diff behind the toggle,
 * dismiss one, and watch it move to the dismissed lane.
 *
 * The agent is the fake `claude` replaying a scripted review on a stripped
 * PATH, so nothing is spent and nothing reaches the network. Everything from
 * the child process through adjudication, the gates, the store, and the SSE
 * channel is production code.
 */

const REVIEW_CAPTURE = fileURLToPath(
	new URL("../test/fixtures/claude/review.jsonl", import.meta.url),
);

const TEST_TIMEOUT_MS = 180_000;
const RUN_SETTLE_TIMEOUT_MS = 60_000;

test.describe("suggested comments", () => {
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

	test("reviews the change, lists the comments, and dismisses one", async ({
		page,
	}) => {
		const server = await launchPrreview({
			cwd: repo.root,
			pathValue: shim.withFakes,
			env: { FAKE_CLAUDE_FIXTURE: REVIEW_CAPTURE },
		});
		servers.push(server);

		/*
		 * Reached by clicking the tab, which is the assertion. The surface was
		 * postponed for a release and reachable by URL only, and a URL nobody
		 * types is not a surface — so navigating here the way a person does is
		 * what proves it is back.
		 */
		await page.goto(server.url);
		await page.locator('[data-tab="comments"]').click();

		// nothing has been reviewed, so the tab invites — and states its own cost
		await expect(
			page.getByRole("heading", { name: "Review this change for problems" }),
		).toBeVisible();
		await expect(page.locator("[data-finding-id]")).toHaveCount(0);

		/*
		 * At a depth, chosen. Every run used to be silently `standard` because
		 * `startReview(depth?)` existed and nothing ever passed one.
		 */
		await expect(page.getByText("Light")).toBeVisible();
		await page.locator('[data-depth="thorough"] input').check();

		await page.locator("[data-analysis-start]").click();

		const cards = page.locator("[data-finding-id]");
		await expect(cards.first()).toBeVisible({
			timeout: RUN_SETTLE_TIMEOUT_MS,
		});

		// the finding, as a comment a person could paste
		await expect(
			page.getByText("Excited greetings double an existing exclamation"),
		).toBeVisible();

		/*
		 * Species discipline, visible on screen: the pre-existing problem is in
		 * its own section, under a heading that says what it is. A reviewer
		 * pasting comments onto someone's PR must never hand them a complaint
		 * about code the change did not touch.
		 */
		await expect(
			page.getByRole("heading", { name: /Noticed nearby/ }),
		).toBeVisible();

		/*
		 * The grounding check ran against the real read log. The recorded stream
		 * read files in the capture's own scratch repo, not this one, so the
		 * citation does not resolve — and the card says which path it could not
		 * verify rather than presenting the claim as verified. The specific
		 * sentence is the point: adjudication works out exactly which citation
		 * failed, and that answer used to be dropped on the way to the store.
		 */
		await expect(page.getByText(/treat as a lead/).first()).toBeVisible();
		await expect(
			page.getByText(/which the agent did not read this round/).first(),
		).toBeVisible();

		/*
		 * ── the same findings, in the diff ────────────────────────────────────
		 *
		 * One query, two surfaces, and no switch between them. There used to be a
		 * "show suggested comments in the diff" checkbox, which meant a review
		 * someone had paid for rendered only if they also found and flipped it.
		 */
		await page.locator('[data-tab="diff"]').click();
		const balloons = page.locator("[data-annotation-id]");
		await expect(balloons.first()).toBeVisible({
			timeout: RUN_SETTLE_TIMEOUT_MS,
		});
		await expect(page.getByLabel(/Show suggested comments/)).toHaveCount(0);

		/*
		 * The file tree counts the balloons it actually renders. It counted
		 * explanations, which the margin never shows, so the badge read 0 beside
		 * a file carrying findings.
		 */
		await expect(
			page.locator('[title$="note"], [title$="notes"]').first(),
		).toBeVisible();

		// ── dismissing is never deletion ───────────────────────────────────────
		await page.locator('[data-tab="comments"]').click();
		await page.getByRole("button", { name: "Dismiss" }).first().click();

		await expect(page.getByRole("heading", { name: /^Dismissed/ })).toBeVisible(
			{ timeout: RUN_SETTLE_TIMEOUT_MS },
		);
		// still there, recoverable, and now suppressed for the next pass
		await expect(page.getByRole("button", { name: "Restore" })).toBeVisible();
	});
});

const COMMITTED_GREETING = [
	"export function greet(name: string) {",
	'  return "hello, " + name;',
	"}",
	"",
].join("\n");

/** the review capture anchors on new-side line 3 of this file */
const DIRTY_GREETING = [
	"export function greet(name: string, excited = false) {",
	'  const base = "hello, " + name;',
	'  return excited ? base + "!" : base;',
	"}",
	"",
].join("\n");
