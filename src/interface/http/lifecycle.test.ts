import { describe, expect, it } from "vitest";
import { createLifecycle, type LifecycleOptions } from "./lifecycle";

const GRACE_MS = 20;
const PAST_GRACE_MS = GRACE_MS * 3;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

interface Harness {
	lifecycle: ReturnType<typeof createLifecycle>;
	exitCodes: number[];
	flushCount: () => number;
	loggedErrors: unknown[];
}

function harness(overrides: Partial<LifecycleOptions> = {}): Harness {
	const exitCodes: number[] = [];
	const loggedErrors: unknown[] = [];
	let flushes = 0;
	const lifecycle = createLifecycle({
		flush: async () => {
			flushes++;
		},
		graceMs: GRACE_MS,
		exit: (code) => {
			exitCodes.push(code);
		},
		logError: (error) => {
			loggedErrors.push(error);
		},
		...overrides,
	});
	return { lifecycle, exitCodes, flushCount: () => flushes, loggedErrors };
}

describe("createLifecycle", () => {
	it("flushes the store and exits 0 after the grace period at zero liveness", async () => {
		const { lifecycle, exitCodes, flushCount } = harness();
		lifecycle.connectionOpened();
		lifecycle.connectionClosed();

		await sleep(PAST_GRACE_MS);
		expect(flushCount()).toBe(1);
		expect(exitCodes).toEqual([0]);
	});

	it("cancels the grace timer on reconnect", async () => {
		const { lifecycle, exitCodes } = harness();
		lifecycle.connectionOpened();
		lifecycle.connectionClosed();
		lifecycle.connectionOpened();

		await sleep(PAST_GRACE_MS);
		expect(exitCodes).toEqual([]);
	});

	it("never arms before the first client has connected", async () => {
		const { lifecycle, exitCodes } = harness();
		// a stray beacon before any browser attached (a curl at boot)
		lifecycle.goodbyeReceived();

		await sleep(PAST_GRACE_MS);
		expect(exitCodes).toEqual([]);
		expect(lifecycle.liveness()).toBe(0);
	});

	it("starts shutdown on the goodbye beacon before the socket closes", async () => {
		const { lifecycle, exitCodes } = harness();
		lifecycle.connectionOpened();
		lifecycle.goodbyeReceived();
		expect(lifecycle.liveness()).toBe(0);

		await sleep(PAST_GRACE_MS);
		expect(exitCodes).toEqual([0]);
	});

	it("redeems the goodbye credit when its connection closes, sparing other tabs", async () => {
		const { lifecycle, exitCodes } = harness();
		lifecycle.connectionOpened();
		lifecycle.connectionOpened();
		lifecycle.goodbyeReceived();
		expect(lifecycle.liveness()).toBe(1);

		// the goodbye'd tab's socket now actually closes: still one tab alive
		lifecycle.connectionClosed();
		expect(lifecycle.liveness()).toBe(1);

		await sleep(PAST_GRACE_MS);
		expect(exitCodes).toEqual([]);
	});

	it("exits even when the flush fails, logging the failure", async () => {
		const { lifecycle, exitCodes, loggedErrors } = harness({
			flush: async () => {
				throw new Error("disk gone");
			},
		});
		lifecycle.connectionOpened();
		lifecycle.connectionClosed();

		await sleep(PAST_GRACE_MS);
		expect(exitCodes).toEqual([0]);
		expect(loggedErrors).toHaveLength(1);
	});
});
