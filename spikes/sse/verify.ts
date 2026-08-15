/**
 * Spike 2 verification: starts the Hono SSE server and a Vite dev server with
 * the /api proxy, then proves through the PROXY that
 *   1. events stream unbuffered (live events arrive spaced at the emit
 *      cadence, not batched), and
 *   2. reconnecting with Last-Event-ID replays the missed events immediately.
 * Exits 0 on success, 1 with a reason on failure.
 */
import { serve } from "@hono/node-server";
import { createServer as createViteServer } from "vite";
import { createSseApp, EMIT_INTERVAL_MS, SSE_SERVER_PORT } from "./server";

const VITE_DEV_PORT = 4994;
const SPIKE_DIR = new URL(".", import.meta.url).pathname;

const LIVE_EVENTS_TO_SAMPLE = 4;
/** Gaps under this would mean the proxy batched events instead of streaming. */
const MINIMUM_LIVE_GAP_MS = EMIT_INTERVAL_MS * 0.5;
/** Replayed events must arrive essentially instantly after connecting. */
const MAXIMUM_REPLAY_LATENCY_MS = 200;
const DISCONNECT_WINDOW_MS = EMIT_INTERVAL_MS * 3.5;

interface ReceivedEvent {
	id: number;
	receivedAt: number;
}

async function readEvents(
	url: string,
	count: number,
	lastEventId?: number,
): Promise<{ connectedAt: number; events: ReceivedEvent[] }> {
	const controller = new AbortController();
	const headers: Record<string, string> = { Accept: "text/event-stream" };
	if (lastEventId !== undefined) headers["Last-Event-ID"] = String(lastEventId);

	const connectedAt = Date.now();
	const response = await fetch(url, { headers, signal: controller.signal });
	if (!response.ok || response.body === null) {
		throw new Error(`SSE connect failed: ${response.status}`);
	}

	const events: ReceivedEvent[] = [];
	const decoder = new TextDecoder();
	let pending = "";
	try {
		for await (const chunk of response.body) {
			pending += decoder.decode(chunk, { stream: true });
			let separatorIndex = pending.indexOf("\n\n");
			while (separatorIndex !== -1) {
				const rawEvent = pending.slice(0, separatorIndex);
				pending = pending.slice(separatorIndex + 2);
				const idLine = rawEvent
					.split("\n")
					.find((line) => line.startsWith("id:"));
				if (idLine !== undefined) {
					events.push({
						id: Number(idLine.slice(3).trim()),
						receivedAt: Date.now(),
					});
				}
				separatorIndex = pending.indexOf("\n\n");
			}
			if (events.length >= count) break;
		}
	} finally {
		controller.abort();
	}
	return { connectedAt, events };
}

function fail(reason: string): never {
	console.error(`FAIL: ${reason}`);
	process.exit(1);
}

const honoServer = serve({
	fetch: createSseApp().fetch,
	port: SSE_SERVER_PORT,
	hostname: "127.0.0.1",
});
const viteServer = await createViteServer({
	configFile: `${SPIKE_DIR}vite.config.ts`,
	root: SPIKE_DIR,
});
await viteServer.listen();

const eventsUrl = `http://127.0.0.1:${VITE_DEV_PORT}/api/events`;

// --- 1. unbuffered live streaming through the proxy ---
const liveRun = await readEvents(eventsUrl, LIVE_EVENTS_TO_SAMPLE);
const liveGaps = liveRun.events
	.slice(1)
	.map((event, index) => event.receivedAt - liveRun.events[index].receivedAt);
// The first gap can be short if a buffered-in-flight event lands right after
// connect; require the cadence on the later gaps.
const cadenceGaps = liveGaps.slice(1);
if (cadenceGaps.length < 2)
	fail(`sampled too few live events: ${liveRun.events.length}`);
if (!cadenceGaps.every((gap) => gap >= MINIMUM_LIVE_GAP_MS)) {
	fail(`live events arrived batched, gaps=${JSON.stringify(liveGaps)}`);
}

// --- 2. Last-Event-ID replay after a disconnect ---
const lastSeenId = liveRun.events[liveRun.events.length - 1].id;
await new Promise((resolve) => setTimeout(resolve, DISCONNECT_WINDOW_MS));
const replayRun = await readEvents(eventsUrl, 2, lastSeenId);
const replayIds = replayRun.events.map((event) => event.id);
if (replayIds[0] !== lastSeenId + 1 || replayIds[1] !== lastSeenId + 2) {
	fail(
		`replay ids wrong: expected [${lastSeenId + 1}, ${lastSeenId + 2}], got ${JSON.stringify(replayIds)}`,
	);
}
const replayLatencies = replayRun.events.map(
	(event) => event.receivedAt - replayRun.connectedAt,
);
if (!replayLatencies.every((latency) => latency <= MAXIMUM_REPLAY_LATENCY_MS)) {
	fail(
		`replay was not immediate, latencies=${JSON.stringify(replayLatencies)}`,
	);
}

console.log(
	JSON.stringify(
		{
			liveGapsMs: liveGaps,
			lastSeenId,
			replayIds,
			replayLatenciesMs: replayLatencies,
			verdict:
				"unbuffered streaming and Last-Event-ID replay both work through the Vite dev proxy",
		},
		null,
		2,
	),
);

await viteServer.close();
honoServer.close();
process.exit(0);
