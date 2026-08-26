import type { Git } from "../../application/ports/Git";
import type { Toolchain } from "../../domain/session/Toolchain";
import { ClaudeEngine } from "../engine/ClaudeEngine";
import { GhCliGithubService } from "../github/GhCliGithubService";

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
