import type { WalkthroughProgress } from "../analysis/Walkthrough";
import type { ChangesetId } from "../changeset/ChangesetId";
import type { ChangesetRef } from "../changeset/ChangesetRef";
import type { ChangesetSource } from "../changeset/ChangesetSource";
import type { RunMeta } from "./RunMeta";
import type { Toolchain } from "./Toolchain";

/** The session.json record (ARCHITECTURE §11). */
export interface SessionManifest {
	schemaVersion: number;
	changesetId: ChangesetId;
	source: ChangesetSource;
	toolchain: Toolchain;
	rounds: { id: string; ref: ChangesetRef; runs: RunMeta[] }[];
	currentRound: string;
	engine: {
		adapter: string;
		analysisSessionId?: string;
		chatThreads: { id: string; engineSessionId: string }[];
	};
	ticket?: { key: string; source: string };
	/**
	 * Where the guided walkthrough left off. Optional and defaulted by the
	 * store, so adding it costs no schema bump (CON-012).
	 */
	walkthroughProgress?: WalkthroughProgress;
}
