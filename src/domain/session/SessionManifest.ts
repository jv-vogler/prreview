import type { TicketHint } from "../analysis/discoverTicket";
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
	/** discovered opportunistically at open time; absent is normal, not a gap */
	ticket?: TicketHint;
}
