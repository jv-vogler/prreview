import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
	createFixtureRepo,
	type FixtureRepo,
} from "../test/helpers/createFixtureRepo";
import { createPathShim, type PathShim } from "../test/helpers/shimPath";
import {
	fetchApi,
	launchPrreview,
	type RunningServer,
	stopServer,
} from "./helpers/prreviewServer";

/**
 * F12's degradation guarantee, executable (TASK-066): with nothing but `git` on
 * PATH — no `claude`, no `gh` — prreview is exactly the viewer. Every AI surface
 * is absent rather than disabled, one dismissible notice explains why, and
 * coverage still persists.
 */

const VIEWER_ONLY_TEST_TIMEOUT_MS = 120_000;
const RING_UPDATE_TIMEOUT_MS = 30_000;
/** covers the store's ~500ms write debounce with a wide margin */
const DISK_PERSIST_TIMEOUT_MS = 15_000;

test.describe("viewer only: no agent, no AI surfaces", () => {
	test.setTimeout(VIEWER_ONLY_TEST_TIMEOUT_MS);

	let repo: FixtureRepo;
	let shim: PathShim;
	const servers: RunningServer[] = [];

	test.beforeEach(async () => {
		repo = await createFixtureRepo();
		shim = await createPathShim();
		await repo.write("src/greeting.ts", COMMITTED_GREETING);
		await repo.commitAll("add greeting");
		await repo.write("src/greeting.ts", DIRTY_GREETING);
	});

	test.afterEach(async () => {
		await Promise.all(servers.splice(0).map((server) => stopServer(server)));
		await Promise.all([shim.dispose(), repo.dispose()]);
	});

	test("renders the M1 viewer with one notice and no AI affordances (REQ-004)", async ({
		page,
	}) => {
		const server = await launchServer();

		// the server's own account of the toolchain, before any browser exists
		const session = await fetchSession(server.url);
		expect(session.toolchain.agent.kind).toBe("none");
		expect(session.analysis.understandingAvailable).toBe(false);
		expect(session.analysis.findingsAvailable).toBe(false);

		await page.goto(server.url);

		// the viewer is whole: the file tree, the diff, and the coverage ring
		await expect(
			page.getByRole("navigation", { name: "Changed files" }),
		).toContainText("greeting.ts");
		await expect(page.getByText(VIEWER_MARKER).first()).toBeVisible();

		// exactly one notice, and it explains what is missing and what still works
		const dismissNotice = page.getByRole("button", {
			name: "Dismiss the viewer-only notice",
		});
		await expect(dismissNotice).toHaveCount(1);
		await expect(
			page.getByText(/No agent CLI was found/).first(),
		).toBeVisible();

		// Every AI surface is absent, not greyed out — including the tabs
		// themselves. A disabled tab says "you could have this"; absence says
		// "this build does not do that", which is the truth with no agent.
		await expect(page.locator('[data-tab="diff"]')).toBeVisible();
		await expect(page.locator('[data-tab="overview"]')).toHaveCount(0);
		await expect(page.locator('[data-tab="understand"]')).toHaveCount(0);
		await expect(page.locator('[data-tab="comments"]')).toHaveCount(0);
		await expect(page.locator("[data-analysis-start]")).toHaveCount(0);
		await expect(
			page.getByRole("button", { name: "Explain this change" }),
		).toHaveCount(0);
		await expect(page.locator("[data-annotation-id]")).toHaveCount(0);

		// the chat key belongs to a surface that does not exist here
		await page.keyboard.press("c");
		await expect(
			page.getByRole("region", { name: "Ask about this change" }),
		).toHaveCount(0);

		// /orient has no subject, so it sends the reader back to the diff
		await page.goto(`${server.url}orient`);
		await expect(page).toHaveURL(/\/diff/);

		// dismissing the notice sticks across a reload
		await dismissNotice.click();
		await expect(dismissNotice).toHaveCount(0);
		await page.reload();
		await expect(
			page.getByRole("navigation", { name: "Changed files" }),
		).toContainText("greeting.ts");
		await expect(dismissNotice).toHaveCount(0);

		// and coverage still works, ring and disk alike
		const coverageRing = page.getByRole("meter", { name: "Review coverage" });
		await expect(coverageRing).toHaveAttribute("aria-valuenow", "100", {
			timeout: RING_UPDATE_TIMEOUT_MS,
		});
		await expect
			.poll(() => coverageStatesOnDisk(), { timeout: DISK_PERSIST_TIMEOUT_MS })
			.toContain("viewed");
	});

	/** the `gitOnly` shim: no claude, no gh, whatever the machine has installed */
	async function launchServer(): Promise<RunningServer> {
		const server = await launchPrreview({
			cwd: repo.root,
			pathValue: shim.gitOnly,
		});
		servers.push(server);
		return server;
	}

	async function coverageStatesOnDisk(): Promise<string> {
		const sessionsDir = join(repo.root, ".prreview", "sessions");
		const states: string[] = [];
		for (const sessionKey of await readdir(sessionsDir)) {
			try {
				states.push(
					await readFile(
						join(sessionsDir, sessionKey, "coverage.json"),
						"utf8",
					),
				);
			} catch {
				// not written yet — the poll retries
			}
		}
		return states.join("\n");
	}
});

interface SessionSnapshot {
	readonly toolchain: { readonly agent: { readonly kind: string } };
	readonly analysis: {
		readonly understandingAvailable: boolean;
		readonly findingsAvailable: boolean;
	};
}

function fetchSession(baseUrl: string): Promise<SessionSnapshot> {
	return fetchApi<SessionSnapshot>(baseUrl, "api/session");
}

const COMMITTED_GREETING = [
	"export function greet(name: string) {",
	'  return "hello, " + name;',
	"}",
	"",
].join("\n");

/** a single-token identifier survives syntax highlighting as one text node */
const VIEWER_MARKER = "prreviewViewerOnlyMarker";

const DIRTY_GREETING = [
	"export function greet(name: string) {",
	`  const ${VIEWER_MARKER} = "no agent here";`,
	`  return "hello, " + name + ${VIEWER_MARKER};`,
	"}",
	"",
].join("\n");
