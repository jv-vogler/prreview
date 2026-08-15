import type { Hono } from "hono";
import type { OpenedReview } from "../../src/application/openReview";
import { createApp } from "../../src/interface/http/app";
import {
	createSseHub,
	type SseHub,
} from "../../src/interface/http/events/sseHub";
import {
	createLifecycle,
	type Lifecycle,
} from "../../src/interface/http/lifecycle";
import {
	createReviewState,
	type ReviewState,
} from "../../src/interface/http/reviewState";
import { buildTestContainer, type TestContainer } from "./buildTestContainer";
import type { FakeGitState } from "./FakeGit";

export const TEST_HEAD_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

/**
 * A two-file worktree diff (one modify, one add) — enough hunks to exercise
 * coverage, blobs, and refresh without ceremony. Tests read ids off the
 * parsed review rather than hardcoding them.
 */
export const TEST_WORKTREE_DIFF = [
	"diff --git a/src/greeting.ts b/src/greeting.ts",
	"index 1111111111111111111111111111111111111111..2222222222222222222222222222222222222222 100644",
	"--- a/src/greeting.ts",
	"+++ b/src/greeting.ts",
	"@@ -1,3 +1,3 @@",
	" export function greeting(): string {",
	'-\treturn "hello";',
	'+\treturn "hello, reviewer";',
	" }",
	"diff --git a/notes/todo.md b/notes/todo.md",
	"new file mode 100644",
	"index 0000000000000000000000000000000000000000..3333333333333333333333333333333333333333",
	"--- /dev/null",
	"+++ b/notes/todo.md",
	"@@ -0,0 +1,2 @@",
	"+- review the diff",
	"+- ship it",
	"",
].join("\n");

export interface TestAppSetup {
	git?: FakeGitState;
	/** what to review; defaults to `working` */
	target?: string;
	/** the WORKING blob containment root; defaults to a path that exists nowhere */
	repoRoot?: string;
	graceMs?: number;
	heartbeatIntervalMs?: number;
	dev?: boolean;
}

export interface TestApp extends TestContainer {
	app: Hono;
	state: ReviewState;
	hub: SseHub;
	lifecycle: Lifecycle;
	review: OpenedReview;
	/** codes the lifecycle tried to exit with (the process never really exits) */
	exitCodes: number[];
	/** errors the app's onError logged server-side */
	loggedErrors: unknown[];
}

/**
 * The TASK-042 harness: a real Hono app over a real container whose adapters
 * are the in-memory fakes — `app.request()` exercises the exact middleware
 * stack, routes, and onError that production serves.
 */
export async function createTestApp(
	setup: TestAppSetup = {},
): Promise<TestApp> {
	const testContainer = buildTestContainer({
		git: {
			dirty: true,
			refs: { HEAD: TEST_HEAD_SHA },
			worktreeDiff: TEST_WORKTREE_DIFF,
			...setup.git,
		},
	});

	const review = await testContainer.container.openReview({
		target: setup.target ?? "working",
	});
	const state = createReviewState(review);

	const exitCodes: number[] = [];
	const loggedErrors: unknown[] = [];
	const lifecycle = createLifecycle({
		flush: () => testContainer.store.flush(),
		...(setup.graceMs === undefined ? {} : { graceMs: setup.graceMs }),
		exit: (code) => {
			exitCodes.push(code);
		},
	});
	const hub = createSseHub({
		onConnect: () => lifecycle.connectionOpened(),
		onDisconnect: () => lifecycle.connectionClosed(),
		heartbeatIntervalMs: setup.heartbeatIntervalMs ?? 60_000,
	});

	const app = createApp({
		container: testContainer.container,
		state,
		hub,
		lifecycle,
		repoRoot: setup.repoRoot ?? "/nonexistent-prreview-test-root",
		boundPort: 4973,
		dev: setup.dev ?? false,
		clientDir: null,
		logError: (error) => {
			loggedErrors.push(error);
		},
	});

	return {
		...testContainer,
		app,
		state,
		hub,
		lifecycle,
		review,
		exitCodes,
		loggedErrors,
	};
}
