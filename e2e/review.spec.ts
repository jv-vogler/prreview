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

		await expect(
			page.getByText("Reviewed 1 file(s) with the mock agent"),
		).toBeVisible({ timeout: RUN_SETTLE_TIMEOUT_MS });

		const markers = page.locator("[data-finding-marker]");
		await expect(markers.first()).toBeVisible();
		await expect(page.locator("[data-finding-id]")).toHaveCount(0);

		const chip = page.locator("[data-explanation-chip]").first();
		await expect(chip).toBeVisible();
		const balloon = page.locator("[data-explanation-id]").first();
		await expect(balloon).toBeVisible();
		await expect(balloon.getByRole("button")).toHaveCount(0);
		await chip.click();
		await expect(page.locator("[data-explanation-id]")).toHaveCount(0);
		await chip.click();
		await expect(balloon).toBeVisible();
		await page.getByRole("button", { name: "Hide explanations" }).click();
		await expect(page.locator("[data-explanation-chip]")).toHaveCount(0);
		await page.getByRole("button", { name: "Show explanations" }).click();
		await expect(chip).toBeVisible();

		await markers.first().click();
		await expect(page.locator("[data-finding-id]").first()).toBeVisible();

		await expect(
			page.getByRole("heading", { name: "Not shown in the diff", exact: true }),
		).toBeVisible();
		await expect(page.getByText("Mock unplaceable finding")).toBeVisible();
		await expect(page.getByText("1 Blocker", { exact: true })).toBeVisible();
		await expect(page.getByText("1 Question", { exact: true })).toBeVisible();
		const questionRow = page.locator(
			"[data-finding-row][data-kind='question']",
		);
		await expect(questionRow).toHaveCount(1);
		await expect(questionRow).toContainText("Question");
		await expect(questionRow).toContainText("Mock question about a choice");

		await expect(
			page.locator("[class*='overview']").getByRole("button", {
				name: "Mock intent: two files change for one reason",
			}),
		).toBeVisible();

		await page.getByRole("tab", { name: /Explanations/ }).click();

		await expect(
			page.getByRole("button", { name: /^Fold Mock intent/ }),
		).toBeVisible();
		await expect(
			page.getByRole("tabpanel").getByRole("button", {
				name: "Mock intent: two files change for one reason",
				exact: true,
			}),
		).toBeVisible();
		await expect(
			page.getByText("Mock explanation the diff cannot anchor."),
		).toBeVisible();
		await expect(page.getByText(/· not in the diff/)).toBeVisible();
		await page.locator("[data-explanation-entry] button").first().click();
		await expect(
			page.locator("[data-explanation-id][data-highlighted]").first(),
		).toBeVisible();

		await page.getByRole("tab", { name: /Comments/ }).click();
		await page.getByRole("button", { name: /Overview/ }).click();
		await expect(
			page.getByText("Reviewed 1 file(s) with the mock agent"),
		).toBeHidden();
		await expect(page.locator("[data-scope='matches']")).toBeVisible();

		await page.getByRole("button", { name: "Review", exact: true }).click();
		const dialog = page.getByRole("dialog", { name: "Review again?" });
		await expect(dialog).toBeVisible();
		await expect(
			dialog.getByText("This working tree was already reviewed", {
				exact: false,
			}),
		).toBeVisible();
		await dialog
			.getByRole("button", { name: "Keep the current review" })
			.click();
		await expect(dialog).toBeHidden();
		await expect(page.locator("[data-finding-id]").first()).toBeVisible();

		await page.goto(`${server.url}?explanations=margin`);
		await expect(page.locator("[data-explanation-id]").first()).toBeVisible({
			timeout: RUN_SETTLE_TIMEOUT_MS,
		});
		await expect(page.locator("[data-explanation-chip]")).toHaveCount(0);
	});

	test("tracks which files the reader has been through, and reopens one to show a comment", async ({
		page,
	}) => {
		const server = await launchPrreview({
			cwd: repo.root,
			pathValue: shim.withMockAgent,
		});
		servers.push(server);
		await page.goto(server.url);

		await expect(page.getByText("0 of 1 files viewed")).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Copy src/greeting.ts" }),
		).toBeVisible();

		await page.getByRole("button", { name: "Review" }).click();
		await expect(
			page.getByText("Reviewed 1 file(s) with the mock agent"),
		).toBeVisible({ timeout: RUN_SETTLE_TIMEOUT_MS });

		const fold = page.locator("[data-file-fold]").first();
		const viewed = page.getByRole("checkbox", {
			name: "Mark src/greeting.ts viewed",
		});
		await viewed.check();
		await expect(page.getByText("1 of 1 files viewed")).toBeVisible();
		await expect(fold).toHaveAttribute("data-folded", "true");

		await page
			.locator("[data-finding-row]")
			.filter({ hasText: "Mock finding on src/greeting.ts" })
			.click();

		await expect(fold).toHaveAttribute("data-folded", "false");
		await expect(page.locator("[data-finding-id]").first()).toBeVisible();
		await expect(viewed).toBeChecked();
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
