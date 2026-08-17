import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Locator, test } from "@playwright/test";
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
 * The explanations milestone against the BUILT artifact (TASK-065): analyze,
 * read the intent map, walk the change, ask a question, then prove all four
 * survive a kill. The agent is the fake `claude` replaying real captured
 * streams on a stripped PATH, so the test spends nothing and cannot reach the
 * network (REQ-009) — everything between the child process and `.prreview/` is
 * production code.
 */

const COMPREHENSION_CAPTURE = fileURLToPath(
	new URL("../test/fixtures/claude/comprehension.jsonl", import.meta.url),
);
const CHAT_CAPTURE = fileURLToPath(
	new URL("../test/fixtures/claude/chat-stream.jsonl", import.meta.url),
);

/** two server launches, one analysis, a walkthrough and a chat turn */
const UNDERSTAND_TEST_TIMEOUT_MS = 180_000;
const RUN_SETTLE_TIMEOUT_MS = 60_000;
/** covers the store's ~500ms write debounce with a wide margin */
const DISK_PERSIST_TIMEOUT_MS = 15_000;
/**
 * Replay pacing. The captured streams are ~60 and ~37 lines, so this stretches
 * a run to roughly a second and a half — long enough for the tray's running
 * state and the chat's streaming reply to be observable rather than a flash.
 */
const REPLAY_DELAY_MS = "25";

/** the question the fake answers from `chat-stream.jsonl` (matched by substring) */
const CHAT_QUESTION = "What does the excited flag change for callers?";

const EXPLANATION_NOTE = '[data-annotation-species="explanation"]';

test.describe("understand: analysis, orientation, walkthrough, and chat", () => {
	test.setTimeout(UNDERSTAND_TEST_TIMEOUT_MS);

	let repo: FixtureRepo;
	let shim: PathShim;
	let agentScratch: string;
	let comprehensionFixture: string;
	let invocationLog: string;
	const servers: RunningServer[] = [];

	test.beforeEach(async () => {
		repo = await createFixtureRepo();
		shim = await createPathShim();
		agentScratch = await mkdtemp(join(tmpdir(), "prreview-agent-"));
		comprehensionFixture = join(agentScratch, "comprehension.jsonl");
		invocationLog = join(agentScratch, "invocations.jsonl");

		await repo.write("src/plumbing.ts", committedPlumbing());
		await repo.write("src/greeting.ts", COMMITTED_GREETING);
		await repo.write("src/main.ts", COMMITTED_MAIN);
		await repo.commitAll("add the greeting and its plumbing");
		// the change under review: the two files the capture's anchors name, plus
		// a wide file of small edits that outranks them in attention order and so
		// keeps them below the fold until something scrolls there
		await repo.write("src/plumbing.ts", dirtyPlumbing());
		await repo.write("src/greeting.ts", DIRTY_GREETING);
		await repo.write("src/main.ts", DIRTY_MAIN);
	});

	test.afterEach(async () => {
		await Promise.all(servers.splice(0).map((server) => stopServer(server)));
		await Promise.all([
			shim.dispose(),
			repo.dispose(),
			rm(agentScratch, { recursive: true, force: true }),
		]);
	});

	test("explains the change, guides a reading of it, answers a question, and resumes all three", async ({
		page,
	}) => {
		const firstRun = await launchServer();

		// ground truth before any browser exists: an agent is available and
		// nothing has been analyzed, because analysis is user-triggered (REQ-003)
		const freshSession = await fetchSession(firstRun.url);
		expect(freshSession.toolchain.agent.kind).toBe("claude");
		expect(freshSession.analysis.intentMapAvailable).toBe(false);
		expect(freshSession.analysis.walkthroughAvailable).toBe(false);
		expect(freshSession.analysis.annotationCount).toBe(0);

		await writeTailoredComprehensionFixture(firstRun.url);

		await page.goto(firstRun.url);
		await expect(
			page.getByRole("navigation", { name: "Changed files" }),
		).toContainText("plumbing.ts");
		// no agent output anywhere until the reader asks for it
		await expect(page.locator(EXPLANATION_NOTE)).toHaveCount(0);
		await expect(page.getByRole("link", { name: "Orientation" })).toHaveCount(
			0,
		);

		// ── one analysis ───────────────────────────────────────────────────────
		await page.getByRole("button", { name: "Explain this change" }).click();
		// the tray carries the run while it lasts, and says what is happening
		await expect(
			page.getByText(/Reading the change|Waiting for the agent/).first(),
		).toBeVisible();
		// the run landed: the header offers the orientation the server now has
		const orientationLink = page.getByRole("link", { name: "Orientation" });
		await expect(orientationLink).toBeVisible({
			timeout: RUN_SETTLE_TIMEOUT_MS,
		});
		// ...and the tray is gone, because a finished run leaves no banner behind
		await expect(page.getByText(/Reading the change/)).toHaveCount(0);

		// ── the intent map at /orient ──────────────────────────────────────────
		await orientationLink.click();
		await expect(
			page.getByRole("heading", { name: "What this change is for" }),
		).toBeVisible();
		await expect(page.getByText("excited parameter").first()).toBeVisible();
		// F4's entry point, resolved out of the agent's prose into a real target
		await expect(page.getByRole("link", { name: /Start with/ })).toContainText(
			"src/greeting.ts",
		);
		// relative sizing: the one cluster is sized, so it named hunk ids this
		// round actually has — the whole point of the map's bars (F4)
		const cluster = page
			.getByRole("listitem")
			.filter({ hasText: "Add excited greeting mode" });
		await expect(cluster).toContainText("behaviour change");
		await expect(cluster).toContainText("100%");

		await page.getByRole("link", { name: "Diff" }).click();
		await expect(
			page.getByRole("button", { name: "Explain this change" }),
		).toBeVisible();

		// ── the guided walkthrough ─────────────────────────────────────────────
		const coverageRing = page.getByRole("meter", { name: "Review coverage" });
		await expect
			.poll(() => ringPercent(coverageRing), {
				timeout: RUN_SETTLE_TIMEOUT_MS,
			})
			.toBeGreaterThan(0);
		const coverageBeforeWalkthrough = await ringPercent(coverageRing);

		await page.getByRole("button", { name: "Walkthrough" }).click();
		const rail = page.getByRole("region", { name: "Guided walkthrough" });
		await expect(rail).toContainText("Step 1 of 3");
		await expect(rail).toContainText("Function signature enhancement");
		await expect(rail).toContainText("backward compatible");

		// the step scrolled the diff to its file, so the notes anchored there are
		// now on screen — muted margin notes, not review comments
		const notes = page.locator(EXPLANATION_NOTE);
		await expect(notes.first()).toBeVisible();
		await expect(
			page.getByLabel("Explanation: Intent", { exact: true }).first(),
		).toContainText("optional parameter");

		await rail.getByRole("button", { name: "Next" }).click();
		await expect(rail).toContainText("Step 2 of 3");
		await expect(rail).toContainText("conditional logic");

		// reading a step is reviewing it: the server-fed ring moved
		await expect
			.poll(() => ringPercent(coverageRing), {
				timeout: RUN_SETTLE_TIMEOUT_MS,
			})
			.toBeGreaterThan(coverageBeforeWalkthrough);

		// ── one chat turn ──────────────────────────────────────────────────────
		await page.keyboard.press("c");
		const dock = page.getByRole("region", { name: "Ask about this change" });
		await expect(dock).toBeVisible();
		// the question is framed by where the reader is, and says so on screen
		await expect(dock).toContainText("greeting.ts");

		await page.getByLabel("Your question").fill(CHAT_QUESTION);
		await page.getByLabel("Your question").press("Enter");
		await expect(dock).toContainText(CHAT_QUESTION);
		await expect(dock).toContainText("creates a new commit that combines", {
			timeout: RUN_SETTLE_TIMEOUT_MS,
		});

		// the built artifact invokes the real CLI contract: --verbose on every
		// call (CON-001), the user's own model (no --model), and a forked resume
		// for the chat turn that inherits the analysis session (CON-004)
		const invocations = await readInvocations();
		const streamingCalls = invocations.filter((call) =>
			call.argv.includes("-p"),
		);
		expect(streamingCalls.length).toBeGreaterThanOrEqual(2);
		for (const call of streamingCalls) {
			expect(call.argv).toContain("--verbose");
			expect(call.argv).not.toContain("--model");
			expect(call.stdinBytes).toBeGreaterThan(0);
		}
		const chatCall = streamingCalls.at(-1);
		expect(chatCall?.argv).toContain("--include-partial-messages");
		expect(chatCall?.argv).toContain("--fork-session");

		// ── kill, relaunch, and find all of it again ───────────────────────────
		// the store's writes are debounced, so wait for both records to land
		// before killing: resume must survive a crash, not a clean exit
		await expect
			.poll(() => sessionFileOnDisk("session.json"), {
				timeout: DISK_PERSIST_TIMEOUT_MS,
			})
			.toContain("analysisSessionId");
		await expect
			.poll(() => sessionFileOnDisk("chat", "t1.json"), {
				timeout: DISK_PERSIST_TIMEOUT_MS,
			})
			.toContain("creates a new commit that combines");
		await stopServer(firstRun);
		await page.goto("about:blank");

		const secondRun = await launchServer();
		expect(secondRun.stdout()).toContain("session: resumed");

		// restored from .prreview/ BEFORE any page connects: this can only come
		// from disk, because nothing has re-run the agent
		const resumedSession = await fetchSession(secondRun.url);
		expect(resumedSession.resumed).toBe(true);
		expect(resumedSession.analysis.intentMapAvailable).toBe(true);
		expect(resumedSession.analysis.walkthroughAvailable).toBe(true);
		expect(resumedSession.analysis.annotationCount).toBe(3);
		expect(resumedSession.analysis.walkthroughProgress).toEqual({
			position: 1,
			completed: false,
		});

		await page.goto(`${secondRun.url}orient`);
		await expect(page.getByText("excited parameter").first()).toBeVisible();

		await page.getByRole("link", { name: "Diff" }).click();
		// F13: the walkthrough comes back where it was left, not at the start
		await page.getByRole("button", { name: "Walkthrough" }).click();
		await expect(
			page.getByRole("region", { name: "Guided walkthrough" }),
		).toContainText("Step 2 of 3");

		await page.keyboard.press("c");
		const resumedDock = page.getByRole("region", {
			name: "Ask about this change",
		});
		await expect(resumedDock).toContainText(CHAT_QUESTION);
		await expect(resumedDock).toContainText(
			"creates a new commit that combines",
		);
	});

	async function launchServer(): Promise<RunningServer> {
		const server = await launchPrreview({
			cwd: repo.root,
			pathValue: shim.withFakes,
			env: {
				FAKE_CLAUDE_FIXTURE: comprehensionFixture,
				// one PATH serves both lanes: the chat prompt carries the question
				// verbatim, so matching it routes the chat turn to its own capture
				FAKE_CLAUDE_FIXTURE_BY_TASK: JSON.stringify({
					[CHAT_QUESTION]: CHAT_CAPTURE,
				}),
				FAKE_CLAUDE_DELAY_MS: REPLAY_DELAY_MS,
				FAKE_CLAUDE_LOG: invocationLog,
			},
		});
		servers.push(server);
		return server;
	}

	/**
	 * The capture was recorded against a hand-written numbered diff whose hunk
	 * ids were placeholders (`F1h1`), so the model echoed those. Real hunk ids
	 * are content hashes the serializer prints and the agent copies back, and
	 * everything downstream — the intent map's sizing, the walkthrough's
	 * coverage, the entry point — is keyed on them. Substituting this round's
	 * actual ids is what makes the replay equivalent to a real run.
	 */
	async function writeTailoredComprehensionFixture(
		baseUrl: string,
	): Promise<void> {
		const changeset = await fetchApi<ChangesetSnapshot>(
			baseUrl,
			"api/changeset",
		);
		const capture = await readFile(COMPREHENSION_CAPTURE, "utf8");
		const tailored = capture
			.replaceAll("F1h1", firstHunkId(changeset, "src/greeting.ts"))
			.replaceAll("F2h1", firstHunkId(changeset, "src/main.ts"));
		await writeFile(comprehensionFixture, tailored);
	}

	/** one `.prreview/` record across every session on disk, as one string */
	async function sessionFileOnDisk(
		...relativeSegments: readonly string[]
	): Promise<string> {
		const sessionsDir = join(repo.root, ".prreview", "sessions");
		const contents: string[] = [];
		for (const sessionKey of await readdir(sessionsDir)) {
			try {
				contents.push(
					await readFile(
						join(sessionsDir, sessionKey, ...relativeSegments),
						"utf8",
					),
				);
			} catch {
				// not written yet — the poll retries
			}
		}
		return contents.join("\n");
	}

	async function readInvocations(): Promise<InvocationRecord[]> {
		const log = await readFile(invocationLog, "utf8");
		return log
			.split("\n")
			.filter((line) => line !== "")
			.map((line) => JSON.parse(line) as InvocationRecord)
			.filter((record) => Array.isArray(record.argv));
	}
});

interface InvocationRecord {
	argv: string[];
	stdinBytes: number;
}

interface ChangesetSnapshot {
	readonly files: ReadonlyArray<{
		readonly path: string;
		readonly hunks: ReadonlyArray<{ readonly id: string }>;
	}>;
}

interface SessionSnapshot {
	readonly resumed: boolean;
	readonly toolchain: { readonly agent: { readonly kind: string } };
	readonly analysis: {
		readonly intentMapAvailable: boolean;
		readonly walkthroughAvailable: boolean;
		readonly annotationCount: number;
		readonly walkthroughProgress?: { position: number; completed: boolean };
	};
}

function fetchSession(baseUrl: string): Promise<SessionSnapshot> {
	return fetchApi<SessionSnapshot>(baseUrl, "api/session");
}

function firstHunkId(changeset: ChangesetSnapshot, path: string): string {
	const hunkId = changeset.files.find((file) => file.path === path)?.hunks[0]
		?.id;
	if (hunkId === undefined) {
		throw new Error(`the round has no hunk for ${path}`);
	}
	return hunkId;
}

async function ringPercent(ring: Locator): Promise<number> {
	return Number(await ring.getAttribute("aria-valuenow"));
}

const COMMITTED_GREETING = [
	"export function greet(name: string) {",
	'  return "hello, " + name;',
	"}",
	"",
].join("\n");

/** the capture's anchors name new-side lines 1 and 3 of this file */
const DIRTY_GREETING = [
	"export function greet(name: string, excited = false) {",
	'  const base = "hello, " + name;',
	'  return excited ? base + "!" : base;',
	"}",
	"",
].join("\n");

const COMMITTED_MAIN = [
	'import { greet } from "./greeting";',
	"",
	"export function run() {",
	'  console.log(greet("world"));',
	"}",
	"",
].join("\n");

/** the capture's third anchor names new-side line 4 of this file */
const DIRTY_MAIN = [
	'import { greet } from "./greeting";',
	"",
	"export function run() {",
	'  console.log(greet("world", true));',
	"}",
	"",
].join("\n");

const PLUMBING_LINES = 200;
const PLUMBING_EDIT_EVERY = 20;
const PLUMBING_EDIT_OFFSET = 1000;

function committedPlumbing(): string {
	return plumbing(() => false);
}

/**
 * Ten one-line edits spread through a long file: enough changed lines to sort
 * ahead of the two files under explanation (attention order is changed lines
 * first), and enough rendered rows to hold them below the fold until the
 * walkthrough scrolls there.
 */
function dirtyPlumbing(): string {
	return plumbing((line) => line % PLUMBING_EDIT_EVERY === 0);
}

function plumbing(isEdited: (line: number) => boolean): string {
	const lines = Array.from({ length: PLUMBING_LINES }, (_, index) => {
		const line = index + 1;
		const value = isEdited(line) ? line + PLUMBING_EDIT_OFFSET : line;
		return `export const value${line} = ${value};`;
	});
	return `${lines.join("\n")}\n`;
}
