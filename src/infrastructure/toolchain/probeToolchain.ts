import type { Git } from "../../application/ports/Git";
import type { Toolchain } from "../../domain/session/Toolchain";
import { ClaudeEngine } from "../engine/ClaudeEngine";
import { GhCliGithubService } from "../github/GhCliGithubService";

/**
 * What is actually on this machine, checked once at boot (TASK-039). Both
 * checks are quick, local, and answer "not found" rather than throwing — a
 * probe failing is the whole point of a probe (REQ-009).
 */
export async function probeToolchain(
	git: Git,
	repoRoot: string,
): Promise<Toolchain> {
	const [agent, github] = await Promise.all([
		probeAgent(),
		new GhCliGithubService(git, repoRoot).probe(),
	]);
	return { agent, github };
}

async function probeAgent(): Promise<Toolchain["agent"]> {
	try {
		const info = await new ClaudeEngine().probe();
		return { kind: "claude", version: info.version };
	} catch {
		return { kind: "none" };
	}
}
