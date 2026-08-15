import { describe, expect, it, vi } from "vitest";
import { buildTestContainer } from "../../test/helpers/buildTestContainer";
import type { ChangesetRef } from "../domain/changeset/ChangesetRef";
import type { PrInfo } from "./ports/GithubService";

function sha(letter: string): string {
	return letter.repeat(40);
}

function prInfo(overrides: Partial<PrInfo> = {}): PrInfo {
	return {
		title: "Add rate limiting",
		body: "Token bucket per client.",
		baseRefName: "main",
		headRefName: "feat/rate-limit",
		headRefOid: sha("e"),
		url: "https://github.com/acme/api/pull/482",
		state: "OPEN",
		...overrides,
	};
}

async function worktreePoller() {
	const setup = buildTestContainer({
		git: { refs: { HEAD: sha("a") }, fingerprint: "fp-1" },
		github: null,
	});
	const opened = await setup.container.openReview({ target: "working" });
	const holder = { ref: opened.ref };
	const drifts: ChangesetRef[] = [];
	const failures: unknown[] = [];
	const poller = setup.container.detectDrift({
		getCurrentRef: () => holder.ref,
		onDrift: (observed) => drifts.push(observed),
		logTickFailure: (error) => failures.push(error),
	});
	return { ...setup, holder, drifts, failures, poller };
}

describe("the drift state machine", () => {
	it("an in-sync tick reports nothing", async () => {
		const { poller, drifts } = await worktreePoller();
		await poller.tick();
		expect(drifts).toEqual([]);
	});

	it("fires once per distinct drift, not once per tick", async () => {
		const { git, poller, drifts } = await worktreePoller();

		git.state.fingerprint = "fp-2";
		await poller.tick();
		await poller.tick();
		await poller.tick();

		expect(drifts).toHaveLength(1);
		expect(drifts[0].worktreeFingerprint).toBe("fp-2");
	});

	it("a further change is a new distinct drift", async () => {
		const { git, poller, drifts } = await worktreePoller();

		git.state.fingerprint = "fp-2";
		await poller.tick();
		git.state.fingerprint = "fp-3";
		await poller.tick();

		expect(drifts).toHaveLength(2);
		expect(drifts[1].worktreeFingerprint).toBe("fp-3");
	});

	it("goes quiet after a refresh adopts the observed state", async () => {
		const { git, holder, poller, drifts } = await worktreePoller();

		git.state.fingerprint = "fp-2";
		await poller.tick();
		holder.ref = drifts[0];
		await poller.tick();

		expect(drifts).toHaveLength(1);
	});

	it("re-arms on an in-sync tick, so a revert-then-redo fires again", async () => {
		const { git, poller, drifts } = await worktreePoller();

		git.state.fingerprint = "fp-2";
		await poller.tick(); // drift #1: fp-2
		git.state.fingerprint = "fp-1";
		await poller.tick(); // back in sync — re-arms, no drift
		git.state.fingerprint = "fp-2";
		await poller.tick(); // the same edit again: a NEW drift

		expect(drifts).toHaveLength(2);
	});

	it("a commit under the worktree session drifts via the HEAD sha", async () => {
		const { git, poller, drifts } = await worktreePoller();

		git.state.refs = { HEAD: sha("b") };
		await poller.tick();

		expect(drifts).toHaveLength(1);
		expect(drifts[0].baseSha).toBe(sha("b"));
	});

	it("a throwing tick logs and continues (edge #4 of CON-003)", async () => {
		const { git, poller, drifts, failures } = await worktreePoller();

		git.state.refs = {}; // HEAD unresolvable: the tick throws
		await poller.tick();
		expect(failures).toHaveLength(1);
		expect(drifts).toEqual([]);

		git.state.refs = { HEAD: sha("a") }; // recovered: next tick works
		await poller.tick();
		expect(failures).toHaveLength(1);
		expect(drifts).toEqual([]);
	});
});

describe("PR head drift (the 60s check)", () => {
	it("observes a moved PR head through the GithubService", async () => {
		const setup = buildTestContainer({
			git: {
				refs: { "refs/remotes/origin/main": sha("c"), HEAD: sha("a") },
				objects: [sha("e")],
			},
			github: { prs: { 482: prInfo() }, prDiffs: { 482: "" } },
		});
		const opened = await setup.container.openReview({ target: "482" });
		const drifts: ChangesetRef[] = [];
		const poller = setup.container.detectDrift({
			getCurrentRef: () => opened.ref,
			onDrift: (observed) => drifts.push(observed),
			logTickFailure: () => {},
		});

		await poller.tick();
		expect(drifts).toEqual([]);

		const githubService = setup.githubService;
		if (githubService === null) {
			throw new Error("this world has a gh backend");
		}
		githubService.state.prs = { 482: prInfo({ headRefOid: sha("f") }) };
		await poller.tick();

		expect(drifts).toHaveLength(1);
		expect(drifts[0].headSha).toBe(sha("f"));
		// the new head was not local, so observing it fetched it
		expect(githubService.fetchedPrHeads).toEqual([482]);
	});
});

describe("the interval loop", () => {
	it("start() polls on the configured cadence until stop()", async () => {
		const setup = buildTestContainer({
			git: { refs: { HEAD: sha("a") }, fingerprint: "fp-1" },
			github: null,
		});
		const opened = await setup.container.openReview({ target: "working" });
		const drifts: ChangesetRef[] = [];
		const poller = setup.container.detectDrift({
			getCurrentRef: () => opened.ref,
			onDrift: (observed) => drifts.push(observed),
			logTickFailure: () => {},
			pollIntervalMs: 5,
		});

		poller.start();
		try {
			setup.git.state.fingerprint = "fp-2";
			await vi.waitFor(() => expect(drifts).toHaveLength(1), {
				timeout: 2_000,
			});
		} finally {
			poller.stop();
		}
	});
});
