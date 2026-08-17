import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AnnotationDraft } from "../src/application/materializeAnnotations";
import { materializeAnnotations } from "../src/application/materializeAnnotations";
import type { AppEvent } from "../src/application/ports/EventPublisher";
import type { Run } from "../src/application/ports/RunManager";
import { buildContainer, type Container } from "../src/container";
import type { Toolchain } from "../src/domain/session/Toolchain";
import {
	createFixtureRepo,
	type FixtureRepo,
} from "./helpers/createFixtureRepo";
import { FakeEngine } from "./helpers/FakeEngine";
import { InMemorySessionStore } from "./helpers/InMemorySessionStore";

/**
 * Re-anchoring driven end to end over a real repository (REQ-006): an
 * explanation is produced against the working tree, the tree then moves, and
 * the refresh has to find the same code again — or retire the note when the code
 * is genuinely gone. The worktree side of round 1 only survives because the
 * store snapshotted it (ARCHITECTURE §11), so this also proves that path.
 */

const TARGET_LINE = "  return value * 2;";

const ROUND_1 = [
	"const header = 1;",
	"",
	"export function compute(value: number) {",
	TARGET_LINE,
	"}",
	"",
].join("\n");

const ROUND_2_SHIFTED = [
	"const header = 1;",
	"const extra = 0;",
	"const alsoExtra = 0;",
	"",
	"export function compute(value: number) {",
	TARGET_LINE,
	"}",
	"",
].join("\n");

const ROUND_2_TARGET_GONE = [
	"const header = 1;",
	"",
	"export function compute(value: number) {",
	"}",
	"",
].join("\n");

const TOOLCHAIN: Toolchain = {
	agent: { kind: "claude", version: "2.1.233" },
	github: { kind: "none" },
};

let repo: FixtureRepo | undefined;

afterEach(async () => {
	await repo?.dispose();
	repo = undefined;
});

/** one finding anchored on a known line — what re-anchoring has to carry */
function draftAnchoredAt(startLine: number, path: string): AnnotationDraft[] {
	return [
		{
			anchor: { path, side: "new", startLine, endLine: startLine },
			body: "doubling is the whole point of this function",
			species: "finding",
			category: "correctness",
		},
	];
}

interface Harness {
	container: Container;
	store: InMemorySessionStore;
	events: AppEvent[];
	engine: FakeEngine;
}

function harnessFor(fixture: FixtureRepo): Harness {
	const store = new InMemorySessionStore();
	const events: AppEvent[] = [];
	const engine = new FakeEngine();
	const container = buildContainer(
		{
			repoRoot: fixture.root,
			dataDir: join(fixture.root, ".prreview"),
			cacheDir: join(fixture.root, "..", "prreview-cache"),
		},
		TOOLCHAIN,
		{
			store,
			githubService: null,
			engine,
			publish: (event) => events.push(event),
		},
	);
	return { container, store, events, engine };
}

async function settled(container: Container, runId: string): Promise<Run> {
	const deadline = Date.now() + 2000;
	while (Date.now() < deadline) {
		const run = container.runManager.get(runId);
		if (
			run !== undefined &&
			run.status !== "queued" &&
			run.status !== "running"
		) {
			return run;
		}
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error(`run ${runId} never settled`);
}

/**
 * A repo whose working tree holds ROUND_1 over a committed version that differs
 * by exactly the anchored line — close enough that git's own rename detection
 * still recognizes the file when a later round moves it.
 */
async function repoWithWorktreeChange(): Promise<FixtureRepo> {
	const fixture = await createFixtureRepo();
	await fixture.write(
		"src/compute.ts",
		ROUND_1.replace(TARGET_LINE, "  return value * 3;"),
	);
	await fixture.commitAll("add compute");
	await fixture.write("src/compute.ts", ROUND_1);
	return fixture;
}

/**
 * Seeds one anchored annotation on round 1 directly, rather than through an
 * agent run. Re-anchoring is what these tests are about, and how an annotation
 * came to exist is irrelevant to whether it survives the tree moving — going
 * through a scripted engine only added a way for the test to fail for an
 * unrelated reason.
 */
async function analyzedRound1(fixture: FixtureRepo) {
	const harness = harnessFor(fixture);
	const review = await harness.container.openReview({ target: "working" });

	const { annotations: seeded } = await materializeAnnotations(
		{ git: harness.container.git, store: harness.store },
		{
			drafts: draftAnchoredAt(4, "src/compute.ts"),
			files: review.files,
			provenance: {
				roundId: review.roundId,
				stage: "findings",
				engineSessionId: "session-A",
			},
			createdAt: "2026-08-17T10:00:00.000Z",
		},
	);
	await harness.store.saveAnnotations(review.manifest.changesetId, seeded);

	const annotations = await harness.store.loadAnnotations(
		review.manifest.changesetId,
	);
	expect(annotations).toHaveLength(1);
	expect(annotations[0].anchor.snapshot.targetLines).toEqual([
		TARGET_LINE.trim(),
	]);
	return { harness, review, annotations };
}

describe("refreshChangeset re-anchors annotations", () => {
	it("carries an explanation onto its new line after the code shifted down", async () => {
		repo = await repoWithWorktreeChange();
		const { harness, review, annotations } = await analyzedRound1(repo);
		// the round-1 working blob is not in git's object database; the refresh
		// can only re-anchor because the store kept a copy
		expect(
			harness.store.blobs.has(annotations[0].anchor.snapshot.blobOid),
		).toBe(true);

		await repo.write("src/compute.ts", ROUND_2_SHIFTED);
		const refreshed = await harness.container.refreshChangeset({
			manifest: review.manifest,
			coverage: review.coverage,
		});

		expect(refreshed.roundId).toBe("r2");
		expect(refreshed.annotations.retired).toEqual([]);
		expect(refreshed.annotations.carried).toHaveLength(1);
		const carried = refreshed.annotations.carried[0];
		expect(carried.id).toBe(annotations[0].id);
		expect(carried.anchor.startLine).toBe(6);
		expect(carried.anchorStatus).toBe("moved");
		expect(carried.anchor.snapshot.targetLines).toEqual([TARGET_LINE.trim()]);
		// and the carried set is what is persisted
		expect(
			await harness.store.loadAnnotations(review.manifest.changesetId),
		).toEqual(refreshed.annotations.carried);
	});

	it("retires an explanation whose lines the new round deleted", async () => {
		repo = await repoWithWorktreeChange();
		const { harness, review, annotations } = await analyzedRound1(repo);

		await repo.write("src/compute.ts", ROUND_2_TARGET_GONE);
		const refreshed = await harness.container.refreshChangeset({
			manifest: review.manifest,
			coverage: review.coverage,
		});

		expect(refreshed.annotations.carried).toEqual([]);
		expect(refreshed.annotations.retired).toEqual([annotations[0].id]);
		expect(
			await harness.store.loadAnnotations(review.manifest.changesetId),
		).toEqual([]);
	});

	it("is a no-op pass when nothing moved, and never calls the engine", async () => {
		repo = await repoWithWorktreeChange();
		const { harness, review, annotations } = await analyzedRound1(repo);
		const callsAfterAnalysis = harness.engine.calls.length;

		const refreshed = await harness.container.refreshChangeset({
			manifest: review.manifest,
			coverage: review.coverage,
		});

		expect(refreshed.annotations.retired).toEqual([]);
		expect(refreshed.annotations.carried[0].anchor).toEqual(
			annotations[0].anchor,
		);
		expect(refreshed.annotations.carried[0].anchorStatus).toBe("anchored");
		expect(harness.engine.calls).toHaveLength(callsAfterAnalysis);
	});

	it("carries an explanation across a rename", async () => {
		repo = await repoWithWorktreeChange();
		const { harness, review, annotations } = await analyzedRound1(repo);

		await repo.remove("src/compute.ts");
		await repo.write("src/calculate.ts", ROUND_1);
		await repo.git(["add", "-A"]);
		const refreshed = await harness.container.refreshChangeset({
			manifest: review.manifest,
			coverage: review.coverage,
		});

		expect(refreshed.annotations.retired).toEqual([]);
		const carried = refreshed.annotations.carried[0];
		expect(carried.id).toBe(annotations[0].id);
		expect(carried.anchor.path).toBe("src/calculate.ts");
		expect(carried.anchor.startLine).toBe(4);
	});
});
