import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
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
	fetchApi,
	launchPrreview,
	type RunningServer,
	stopServer,
} from "./helpers/prreviewServer";

/**
 * The understanding surfaces against the BUILT artifact: run one comprehension
 * pass, read the Overview, read the change as topics with their code, ask a
 * question, then prove it all survives a kill.
 *
 * The agent is the fake `claude` replaying a real captured stream on a stripped
 * PATH, so the test spends nothing and cannot reach the network (REQ-009) —
 * everything between the child process and `.prreview/` is production code.
 */

const COMPREHENSION_CAPTURE = fileURLToPath(
	new URL("../test/fixtures/claude/understanding.jsonl", import.meta.url),
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
const TOPIC_BLOCK = "[data-topic-id]";

test.describe("understand: one pass, two tabs, and a question", () => {
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

	test("explains the change, shows topics with their code, answers a question, and resumes", async ({
		page,
	}) => {
		const firstRun = await launchServer();

		// ground truth before any browser exists: an agent is available and
		// nothing has been analyzed, because analysis is user-triggered (REQ-003)
		const freshSession = await fetchSession(firstRun.url);
		expect(freshSession.toolchain.agent.kind).toBe("claude");
		expect(freshSession.analysis.understandingAvailable).toBe(false);
		expect(freshSession.analysis.annotationCount).toBe(0);

		await writeTailoredComprehensionFixture(firstRun.url);

		await page.goto(firstRun.url);
		await expect(page.locator('[data-tab="diff"]')).toBeVisible();
		// the AI tab exists because an agent does, but holds nothing yet
		await expect(page.locator('[data-tab="understand"]')).toBeVisible();
		/*
		 * Two tabs, not four. Overview was folded into Understanding — same pass,
		 * one account — and Suggested comments is postponed, its trigger moved to
		 * the diff and plainly marked as not ready. Both old routes still resolve
		 * for anyone who bookmarked them.
		 */
		await expect(page.locator('[data-tab="overview"]')).toHaveCount(0);
		await expect(page.locator('[data-tab="comments"]')).toHaveCount(0);
		// and nothing agent-produced is in the margin before the reader asks
		await expect(page.locator(EXPLANATION_NOTE)).toHaveCount(0);

		// ── the invitation states its cost and spends nothing on its own ───────
		await page.locator('[data-tab="understand"]').click();
		await expect(
			page.getByRole("heading", { name: "Understand this change" }),
		).toBeVisible();
		await expect(page.locator(TOPIC_BLOCK)).toHaveCount(0);

		// ── one comprehension pass ─────────────────────────────────────────────
		// the tab's own invitation, not the header menu: this is the surface that
		// states the cost of the pass it is about to spend
		await page.locator("[data-analysis-start]").click();

		const topics = page.locator(TOPIC_BLOCK);
		await expect(topics.first()).toBeVisible({
			timeout: RUN_SETTLE_TIMEOUT_MS,
		});
		expect(await topics.count()).toBeGreaterThan(0);

		// a topic names intent and sizes itself against the whole change
		const firstTopic = topics.first();
		await expect(firstTopic).toContainText(/covers ~\d+% of the change/);
		/*
		 * Collapsed by default: the page opens as a readable table of contents.
		 *
		 * Not shown is asserted as *not visible*, not as absent from the DOM. The
		 * code is mounted whether the topic is open or not, because a height
		 * cannot be eased from nothing — there is nothing to grow from until the
		 * content exists — and Spike 7 measured that mounting it is close to free.
		 * A collapsed block is a zero-height clip over code that is really there.
		 */
		await expect(firstTopic).toHaveAttribute("data-open", "false");
		const code = firstTopic.locator("[data-topic-code]");
		expect((await code.boundingBox())?.height).toBe(0);
		await expect(code).toHaveAttribute("inert", "");

		// ── the code is one click away, and it is the topic's own hunks ────────
		await firstTopic.getByRole("button").first().click();
		await expect(firstTopic).toHaveAttribute("data-open", "true");
		await expect(firstTopic.locator("diffs-container").first()).toBeVisible({
			timeout: RUN_SETTLE_TIMEOUT_MS,
		});
		// every block is keyed composite, never by hunk alone
		await expect(
			firstTopic.locator("[data-block-key]").first(),
		).toHaveAttribute("data-block-key", /^t\d+:/);

		/*
		 * ── the fold is eased, not cut to ──────────────────────────────────────
		 *
		 * Sampled the way the diff's file fold is: an instant open or close cannot
		 * produce a height strictly between nothing and the height it settles at.
		 *
		 * This is asserted because the failure it catches is invisible everywhere
		 * else. The panel grows by transitioning its grid row from `0fr` to `1fr`,
		 * and that transition's duration is a Primer motion token — so when the
		 * base token layer those resolve to was missing from `tokens.css`, the
		 * shorthand was invalid at computed-value time, `transition` computed to
		 * its initial `all 0s`, and every eased thing in the app died at once.
		 * Nothing reported it: the stylesheet parsed, stylelint passed, the
		 * screenshots were identical, and the fold still ended in the right state.
		 * A test that watches the height mid-flight is the only witness.
		 */
		const clipHeight = () =>
			firstTopic
				.locator("[data-topic-code]")
				.evaluate((node) => node.getBoundingClientRect().height);

		/**
		 * The open height, once it has stopped moving.
		 *
		 * Highlighting is asynchronous, so the panel keeps growing for a while
		 * after the code is technically visible. Reading the height too early
		 * would set the bar this test measures against below where the fold
		 * actually plays, and the assertion would be about nothing.
		 */
		const settledHeight = async () => {
			let previous = -1;
			for (let attempt = 0; attempt < 40; attempt++) {
				const height = await clipHeight();
				if (height === previous && height > 0) {
					return height;
				}
				previous = height;
				await page.waitForTimeout(50);
			}
			throw new Error("the topic panel never settled to a stable height");
		};

		/** every height the panel passed through while a fold played */
		const foldSamples = async (act: Promise<void>) => {
			const seen: number[] = [];
			await act;
			for (let sample = 0; sample < 20; sample++) {
				seen.push(await clipHeight());
				await page.waitForTimeout(12);
			}
			return seen;
		};

		const openHeight = await settledHeight();
		const partway = (seen: number[]) =>
			seen.some((height) => height > 0 && height < openHeight);

		const toggle = firstTopic.getByRole("button").first();
		const closing = await foldSamples(toggle.click());
		expect(
			partway(closing),
			`closing heights (open ${openHeight}): ${closing}`,
		).toBe(true);
		await expect(firstTopic).toHaveAttribute("data-open", "false");

		// and open again, which has to grow from nothing rather than appear
		const opening = await foldSamples(toggle.click());
		expect(
			partway(opening),
			`opening heights (open ${openHeight}): ${opening}`,
		).toBe(true);
		await expect(firstTopic).toHaveAttribute("data-open", "true");

		// ── the purpose, on the same screen and from the same pass ────────────
		await expect(
			page.getByRole("heading", { name: "What this change is for" }),
		).toBeVisible();
		await expect(page.getByText("excited").first()).toBeVisible();

		/*
		 * The overview is a headline and a list, never one paragraph.
		 *
		 * It used to be a single `summary: string().max(600)`, and what came back
		 * was what a 600-character text box asks for: a dense block of three long
		 * sentences, correct in content and unreadable in form. The fix was the
		 * field's shape, not its budget — a shorter wall is still a wall — so the
		 * thing worth pinning here is that separate points render as separate
		 * lines.
		 */
		await expect(page.locator("[data-overview-point]").first()).toBeVisible();
		// no ticket was discoverable for a worktree review, so the verdict says
		// plainly that it is judging internal coherence — never ticket language
		await expect(page.locator("[data-goal-basis]")).toHaveAttribute(
			"data-goal-basis",
			"inferred",
		);
		await expect(
			page.getByText(/No ticket was found for this change/),
		).toBeVisible();

		// ── the diff is still free, and still free of narration ────────────────
		await page.locator('[data-tab="diff"]').click();
		await expect(page.locator(EXPLANATION_NOTE)).toHaveCount(0);

		// ── one chat turn ──────────────────────────────────────────────────────
		await page.keyboard.press("c");
		const dock = page.getByRole("region", { name: "Ask about this change" });
		await expect(dock).toBeVisible();

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
		expect(resumedSession.analysis.understandingAvailable).toBe(true);
		// the comprehension pass writes nothing to the margin
		expect(resumedSession.analysis.annotationCount).toBe(0);

		// the saved /orient link still lands somewhere true rather than 404ing
		await page.goto(`${secondRun.url}orient`);
		await expect(
			page.getByRole("heading", { name: "What this change is for" }),
		).toBeVisible();

		await page.locator('[data-tab="understand"]').click();
		await expect(page.locator(TOPIC_BLOCK).first()).toBeVisible();

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
		readonly understandingAvailable: boolean;
		readonly findingsAvailable: boolean;
		readonly annotationCount: number;
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
