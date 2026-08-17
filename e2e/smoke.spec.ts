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

/** two server launches, a browser render, and disk polling live in one test */
const SMOKE_TEST_TIMEOUT_MS = 120_000;
const RING_UPDATE_TIMEOUT_MS = 30_000;
/** covers the store's ~500ms write debounce with a wide margin */
const DISK_PERSIST_TIMEOUT_MS = 15_000;
const FULLY_COVERED = 100;

test.describe("smoke: built artifact end to end", () => {
	test.setTimeout(SMOKE_TEST_TIMEOUT_MS);

	let repo: FixtureRepo;
	let shim: PathShim;
	const servers: RunningServer[] = [];

	test.beforeEach(async () => {
		repo = await createFixtureRepo();
		shim = await createPathShim();
		await repo.write("src/greeting.ts", COMMITTED_GREETING);
		await repo.write("docs/table.md", COMMITTED_TABLE);
		await repo.commitAll("add greeting");
		// the dirty state under review: two modified tracked files, one hunk each
		await repo.write("src/greeting.ts", DIRTY_GREETING);
		await repo.write("docs/table.md", DIRTY_TABLE);
	});

	test.afterEach(async () => {
		await Promise.all(servers.splice(0).map((server) => stopServer(server)));
		await shim.dispose();
		await repo.dispose();
	});

	test("renders the diff, tracks coverage, and resumes after a kill (REQ-004)", async ({
		page,
	}) => {
		const firstRun = await launchServer();

		// ground truth before any browser exists: a fresh session, nothing covered
		const freshSession = await fetchSession(firstRun.url);
		expect(freshSession.resumed).toBe(false);
		expect(freshSession.coverage.total).toBe(0);

		await page.goto(firstRun.url);

		// the diff actually rendered: the file in the tree, the changed code in the view
		await expect(
			page.getByRole("navigation", { name: "Changed files" }),
		).toContainText("greeting.ts");
		await expect(page.getByText(SMOKE_MARKER).first()).toBeVisible();

		// having the (fully visible) hunk on screen marks it viewed; the
		// server-fed ring moves from the 0 asserted above to fully covered
		const coverageRing = page.getByRole("meter", { name: "Review coverage" });
		await expect(coverageRing).toHaveAttribute(
			"aria-valuenow",
			String(FULLY_COVERED),
			{ timeout: RING_UPDATE_TIMEOUT_MS },
		);

		// the store's write is debounced — wait for it to land on disk, then
		// kill abruptly (SIGKILL): resume must survive a crash, not a clean exit
		await expect
			.poll(() => coverageStatesOnDisk(), { timeout: DISK_PERSIST_TIMEOUT_MS })
			.toContain("viewed");
		await stopServer(firstRun);
		await page.goto("about:blank");

		const secondRun = await launchServer();
		expect(secondRun.stdout()).toContain("session: resumed");

		// coverage restored from .prreview/ BEFORE any page connects — this can
		// only come from disk, not from the browser re-marking hunks viewed
		const resumedSession = await fetchSession(secondRun.url);
		expect(resumedSession.resumed).toBe(true);
		expect(resumedSession.coverage.total).toBe(FULLY_COVERED);

		await page.goto(secondRun.url);
		await expect(page.getByText("resumed", { exact: true })).toBeVisible();
		await expect(coverageRing).toHaveAttribute(
			"aria-valuenow",
			String(FULLY_COVERED),
		);
	});

	/** `dist/cli.js working --no-open` in the fixture repo, fakes-only PATH */
	async function launchServer(): Promise<RunningServer> {
		const server = await launchPrreview({
			cwd: repo.root,
			pathValue: shim.withFakes,
		});
		servers.push(server);
		return server;
	}

	/** every coverage state currently persisted under .prreview/, as one string */
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

const COMMITTED_GREETING = [
	"export function greet(name: string): string {",
	`\treturn \`hello, \${name}\`;`,
	"}",
	"",
].join("\n");

/** a single-token identifier survives syntax highlighting as one text node */
const SMOKE_MARKER = "prreviewSmokeMarker";

const DIRTY_GREETING = [
	"export function greet(name: string): string {",
	`\tconst ${SMOKE_MARKER} = "changed for the smoke test";`,
	`\treturn \`hello, \${name} (\${${SMOKE_MARKER}})\`;`,
	"}",
	"",
].join("\n");

/**
 * A line far wider than the code pane. Pierre lays every row in a file out at
 * the file's widest line, so this makes each row several times the pane width
 * — the geometry that once left the whole file uncoverable, because the
 * observer's area ratio could never reach the viewed threshold.
 */
const WIDE_TABLE_ROW = `| ${Array.from({ length: 40 }, (_, cell) => `wide cell number ${cell}`).join(" | ")} |`;

const COMMITTED_TABLE = ["# Table", "", WIDE_TABLE_ROW, ""].join("\n");

const DIRTY_TABLE = [
	"# Table",
	"",
	WIDE_TABLE_ROW,
	`${WIDE_TABLE_ROW} trailing edit`,
	"",
].join("\n");

interface SessionSnapshot {
	readonly resumed: boolean;
	readonly coverage: { readonly total: number };
}

function fetchSession(baseUrl: string): Promise<SessionSnapshot> {
	return fetchApi<SessionSnapshot>(baseUrl, "api/session");
}
