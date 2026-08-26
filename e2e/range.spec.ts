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

const TEST_TIMEOUT_MS = 120_000;
const RUN_SETTLE_TIMEOUT_MS = 30_000;

test.describe("commit range", () => {
	test.setTimeout(TEST_TIMEOUT_MS);
	let repo: FixtureRepo;
	let shim: PathShim;
	const servers: RunningServer[] = [];

	test.beforeEach(async () => {
		repo = await createFixtureRepo();
		shim = await createPathShim();

		await repo.write("src/greeting.ts", COMMITTED_GREETING);
		await repo.commitAll("add the greeting");
		await repo.write("src/greeting.ts", CHANGED_GREETING);
		await repo.commitAll("let the greeting shout");
	});

	test.afterEach(async () => {
		await Promise.all(servers.splice(0).map((server) => stopServer(server)));
		await Promise.all([shim.dispose(), repo.dispose()]);
	});

	test("reviews a range: the agent runs, and only publishing is absent", async ({
		page,
	}) => {
		const server = await launchPrreview({
			cwd: repo.root,
			pathValue: shim.withMockAgent,
			args: ["HEAD~1..HEAD", "--no-open"],
		});
		servers.push(server);
		await page.goto(server.url);
		expect(server.stdout()).toContain("commit range HEAD~1..HEAD");

		const review = page.getByRole("button", { name: "Review", exact: true });
		await expect(review).toBeVisible();
		await review.click();

		await expect(
			page.getByText("Reviewed 1 file(s) with the mock agent"),
		).toBeVisible({ timeout: RUN_SETTLE_TIMEOUT_MS });
		await expect(page.locator("[data-finding-marker]").first()).toBeVisible();
		await expect(page.locator("[data-finding-row]").first()).toBeVisible();

		await expect(page.getByRole("button", { name: /Send review/ })).toHaveCount(
			0,
		);
	});
});

const COMMITTED_GREETING = [
	"export function greet(name: string) {",
	'  return "hello, " + name;',
	"}",
	"",
].join("\n");

const CHANGED_GREETING = [
	"export function greet(name: string, excited = false) {",
	'  const base = "hello, " + name;',
	'  return excited ? base + "!" : base;',
	"}",
	"",
].join("\n");
