import type { Toolchain } from "../../domain/session/Toolchain";
import { exec } from "../git/exec";
import { GitClient } from "../git/GitClient";
import { GhCliGithubService } from "../github/GhCliGithubService";
import { GitRemoteGithubService } from "../github/GitRemoteGithubService";

/** Probes must answer fast and never touch the network (ARCHITECTURE §3). */
const PROBE_TIMEOUT_MS = 2000;

const VERSION_TOKEN = /\d+\.\d+[^\s]*/;

/**
 * The boot-time probe (ARCHITECTURE §3): all local, all parallel, run once
 * before the container is built and frozen into the session. `claude` is
 * recorded but unused by any M1 feature; the github result drives the
 * GithubService selection. Runs before the container exists, so it builds
 * its own throwaway adapters.
 */
export async function probeToolchain(cwd: string): Promise<Toolchain> {
	const git = new GitClient(cwd);
	const ghBackend = new GhCliGithubService(git, cwd);
	const gitRemoteBackend = new GitRemoteGithubService(git);

	const [agent, ghProbe, gitRemoteProbe] = await Promise.all([
		probeAgent(),
		ghBackend.probe(),
		gitRemoteBackend.probe(),
	]);

	// Fallback chain (ARCHITECTURE §4): gh when authenticated, else plain git
	// remote, else GitHub-dependent features are off.
	const github = ghProbe.kind === "gh" ? ghProbe : gitRemoteProbe;
	return { agent, github };
}

async function probeAgent(): Promise<Toolchain["agent"]> {
	try {
		const output = await exec("claude", ["--version"], {
			timeoutMs: PROBE_TIMEOUT_MS,
		});
		const version = output.match(VERSION_TOKEN)?.[0] ?? output.trim();
		if (version === "") {
			return { kind: "none" };
		}
		return { kind: "claude", version };
	} catch {
		return { kind: "none" };
	}
}
