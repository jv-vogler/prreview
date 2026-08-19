/**
 * What the UI is allowed to offer, derived from the server-reported toolchain
 * (ARCHITECTURE §9). One flag per AI surface named by the architecture;
 * publish joins in M4.
 *
 * There was a third, `walkthrough`, for a guided rail over the diff. The rail
 * is gone — the same idea now renders on the Understanding tab, where the
 * narration and the code it describes are on screen together — so the flag went
 * with it rather than lingering as a switch for nothing.
 */
export interface FeatureFlags {
	analysis: boolean;
	chat: boolean;
}
