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
const EDITED_BODY = "The reader rewrote this one by hand.";

test.describe("re-review", () => {
	test.setTimeout(TEST_TIMEOUT_MS);
	let repo: FixtureRepo;
	let shim: PathShim;
	const servers: RunningServer[] = [];

	test.beforeEach(async () => {
		repo = await createFixtureRepo();
		shim = await createPathShim();

		await repo.write("src/alpha.ts", COMMITTED_ALPHA);
		await repo.write("src/beta.ts", COMMITTED_BETA);
		await repo.commitAll("add alpha and beta");
		await repo.write("src/alpha.ts", DIRTY_ALPHA);
		await repo.write("src/beta.ts", DIRTY_BETA);
	});

	test.afterEach(async () => {
		await Promise.all(servers.splice(0).map((server) => stopServer(server)));
		await Promise.all([shim.dispose(), repo.dispose()]);
	});

	test("re-reads only the file that moved and carries the rest", async ({
		page,
	}) => {
		const server = await launchPrreview({
			cwd: repo.root,
			pathValue: shim.withMockAgent,
		});
		servers.push(server);
		await page.goto(server.url);
		await page.getByRole("button", { name: "Review", exact: true }).click();
		await expect(
			page.getByText("Reviewed 2 file(s) with the mock agent"),
		).toBeVisible({ timeout: RUN_SETTLE_TIMEOUT_MS });

		const row = page.locator("[data-finding-row]", {
			hasText: "Mock finding on src/alpha.ts",
		});
		await row.click();
		const balloon = page.locator("[data-finding-id='finding-0']").first();
		await expect(balloon).toBeVisible();
		await balloon.getByRole("button", { name: "Edit comment" }).click();
		const editor = balloon.locator("textarea");
		await editor.fill(EDITED_BODY);
		await editor.blur();
		await expect(balloon).toContainText(EDITED_BODY);
		await repo.write("src/beta.ts", MOVED_BETA);
		await page.getByRole("button", { name: "Review", exact: true }).click();
		const dialog = page.getByRole("dialog", { name: "Review again?" });
		await expect(dialog).toBeVisible();
		await dialog.getByRole("button", { name: "Review what changed" }).click();

		await expect(
			page.getByText("Re-reviewed 1 moved file(s) with the mock agent"),
		).toBeVisible({ timeout: RUN_SETTLE_TIMEOUT_MS });

		const carriedRow = page.locator("[data-finding-row='finding-0']");
		await expect(carriedRow).toBeVisible();
		await carriedRow.click();
		const carried = page.locator("[data-finding-id='finding-0']").first();
		await expect(carried).toContainText(EDITED_BODY);
		await expect(carried).toContainText("This run did not look at it again.");

		await expect(
			page.locator("[data-finding-row]", {
				hasText: "Mock delta finding on src/beta.ts",
			}),
		).toBeVisible();

		await expect(page.getByText("1 Blocker", { exact: true })).toBeVisible();
		await expect(page.getByText("1 Should fix", { exact: true })).toBeVisible();
	});
});

const COMMITTED_ALPHA = ["export const alpha = 1;", ""].join("\n");
const COMMITTED_BETA = ["export const beta = 1;", ""].join("\n");

const DIRTY_ALPHA = [
	"export const alpha = 2;",
	"export const alphaAgain = 3;",
	"",
].join("\n");

const DIRTY_BETA = ["export const beta = 2;", ""].join("\n");

const MOVED_BETA = [
	"export const beta = 3;",
	"export const betaAgain = 4;",
	"",
].join("\n");
