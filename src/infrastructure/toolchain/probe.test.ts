import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
	createFixtureRepo,
	type FixtureRepo,
} from "../../../test/helpers/createFixtureRepo";
import { createPathShim, type PathShim } from "../../../test/helpers/shimPath";
import { probeToolchain } from "./probe";

let shim: PathShim;
let originalPath: string | undefined;
let localRepo: FixtureRepo;
let clonedRepo: FixtureRepo;

beforeAll(async () => {
	originalPath = process.env.PATH;
	shim = await createPathShim();
	const origin = await createFixtureRepo();
	clonedRepo = await origin.clone();
	await origin.dispose();
	localRepo = await createFixtureRepo();
});

afterAll(async () => {
	process.env.PATH = originalPath;
	await Promise.all([
		shim.dispose(),
		localRepo.dispose(),
		clonedRepo.dispose(),
	]);
});

afterEach(() => {
	process.env.PATH = originalPath;
	delete process.env.FAKE_CLAUDE_EXIT;
	delete process.env.FAKE_CLAUDE_VERSION;
	delete process.env.FAKE_GH_AUTH_EXIT;
});

describe("probeToolchain", () => {
	it("records claude's version and picks the gh backend when both answer", async () => {
		process.env.PATH = shim.withFakes;
		expect(await probeToolchain(clonedRepo.root)).toEqual({
			agent: { kind: "claude", version: "2.1.233" },
			github: { kind: "gh" },
		});
	});

	it("falls back to git-remote when gh is unauthenticated (ARCHITECTURE §4 chain)", async () => {
		process.env.PATH = shim.withFakes;
		process.env.FAKE_GH_AUTH_EXIT = "1";
		const toolchain = await probeToolchain(clonedRepo.root);
		expect(toolchain.github).toEqual({ kind: "git-remote" });
	});

	it("ends the chain at none: gh unauthenticated and no remote", async () => {
		process.env.PATH = shim.withFakes;
		process.env.FAKE_GH_AUTH_EXIT = "1";
		const toolchain = await probeToolchain(localRepo.root);
		expect(toolchain.github).toEqual({ kind: "none" });
	});

	it("degrades to a git-only machine: no claude, no gh, remote present", async () => {
		process.env.PATH = shim.gitOnly;
		expect(await probeToolchain(clonedRepo.root)).toEqual({
			agent: { kind: "none" },
			github: { kind: "git-remote" },
		});
	});

	it("treats a failing claude binary as absent", async () => {
		process.env.PATH = shim.withFakes;
		process.env.FAKE_CLAUDE_EXIT = "1";
		const toolchain = await probeToolchain(clonedRepo.root);
		expect(toolchain.agent).toEqual({ kind: "none" });
	});
});
