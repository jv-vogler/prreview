/**
 * Metadata of one engine run (ARCHITECTURE §11). `stage` and `status` stay open
 * strings: they are written by the engine layer and read for display, and
 * closing them would make an older session file unreadable the moment a stage
 * is added.
 */
export interface RunMeta {
	stage: string;
	engineSessionId: string;
	model: string;
	startedAt: string;
	endedAt: string;
	costUsd?: number;
	numTurns?: number;
	status: string;
	/** why a failed run failed — an EngineErrorReason, or `internal` */
	reason?: string;
}
