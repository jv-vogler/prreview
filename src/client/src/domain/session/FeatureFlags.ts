/**
 * What the UI is allowed to offer, derived from the server-reported toolchain
 * (ARCHITECTURE §9). One flag per AI surface named by the architecture;
 * publish joins in M4.
 */
export interface FeatureFlags {
	analysis: boolean;
	chat: boolean;
	walkthrough: boolean;
}
