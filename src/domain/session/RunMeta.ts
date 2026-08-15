/**
 * Metadata of one engine run (ARCHITECTURE §11). Shape only in M1: nothing
 * writes runs until the engine arrives in M2, which will also tighten `stage`
 * and `status` into closed unions.
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
}
