import { ServerResponse } from "node:http";
import { connect } from "node:net";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type HttpProxy, type Plugin } from "vite";

const API_SERVER_HOST = "127.0.0.1";
const API_SERVER_DEFAULT_PORT = 4973;
const API_TARGET = `http://${API_SERVER_HOST}:${API_SERVER_DEFAULT_PORT}`;
const DEV_SERVER_PORT = 5173;
/** a loopback connect that has not landed in this long is not going to */
const PROBE_TIMEOUT_MS = 500;
/**
 * Long enough that no real /api call trips it — every route but the event
 * stream answers in milliseconds, and the slowest of them (a refresh's git
 * diff) is seconds on a large repo — and short enough that a reader looking at
 * a stuck page gets told why.
 */
const PROXY_TIMEOUT_MS = 15_000;
const SERVICE_UNAVAILABLE = 503;

/**
 * Answers /api itself, in the ErrorDto shape, when no API server is there.
 *
 * The API server is a separate process in dev and is allowed to be missing:
 * `npm run dev` leaves Vite up when the server refuses to boot (nothing to
 * auto-detect is the common one), and `tsx watch` drops it for a moment on
 * every server edit. Without this the browser hangs rather than fails — on
 * WSL2 a connect to a port nothing is listening on is not refused, the
 * localhost relay hands it to Windows and it stays pending forever — so no
 * proxy error is ever emitted, the request never settles, and the app sits on
 * "Loading review…" indefinitely with the real reason printed in a terminal
 * behind the browser.
 *
 * A connect probe rather than a timeout, because it separates the two silences:
 * nothing listening is answered at once, while a server that is merely slow is
 * still waited for. The proxy's own `proxyTimeout` covers the case this cannot
 * see — a server that accepts the connection and then says nothing — since that
 * timer only arms once a socket is connected.
 */
function apiUnreachableGate(): Plugin {
	return {
		name: "prreview:api-unreachable-gate",
		// dev only: a built install is served by the API server itself, so there
		// is no second process that can be missing
		apply: "serve",
		configureServer(server) {
			// registered here (not in a returned thunk) so it runs before Vite's
			// own proxy middleware, which is what would otherwise hang
			server.middlewares.use((req, res, next) => {
				if (req.url === undefined || !req.url.startsWith("/api")) {
					next();
					return;
				}
				void apiReachable().then((reachable) => {
					if (reachable) {
						next();
						return;
					}
					answerUnreachable(res);
				});
			});
		},
	};
}

function apiReachable(): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = connect({
			host: API_SERVER_HOST,
			port: API_SERVER_DEFAULT_PORT,
		});
		const settle = (reachable: boolean) => {
			clearTimeout(timer);
			socket.destroy();
			resolve(reachable);
		};
		// a plain timer, not socket.setTimeout: the case being defended against
		// is a connect that never completes, and the socket's own inactivity
		// timer is not guaranteed to be armed before it does
		const timer = setTimeout(() => settle(false), PROBE_TIMEOUT_MS);
		socket.once("connect", () => settle(true));
		socket.once("error", () => settle(false));
	});
}

function answerUnreachable(res: ServerResponse): void {
	if (res.headersSent || res.writableEnded) {
		res.destroy();
		return;
	}
	res.writeHead(SERVICE_UNAVAILABLE, { "content-type": "application/json" });
	res.end(
		JSON.stringify({
			reason: "unreachable",
			message: `No prreview server is answering on port ${API_SERVER_DEFAULT_PORT}.`,
		}),
	);
}

/** the same answer for a connection that was accepted and then went quiet */
function unreachableOnError(proxy: HttpProxy.ProxyServer): void {
	proxy.on("error", (_error, _req, res) => {
		if (!(res instanceof ServerResponse)) {
			// a failed upgrade: a raw socket, with nothing to write a body to
			res.destroy();
			return;
		}
		answerUnreachable(res);
	});
}

export default defineConfig({
	plugins: [apiUnreachableGate(), react()],
	// @pierre/diffs ships ESM workers; the classic-worker default cannot load them
	worker: { format: "es" },
	resolve: {
		alias: {
			// The wire contract: the only server folder the client may import (see ARCHITECTURE §2)
			"@dto": fileURLToPath(new URL("../interface/http/dto", import.meta.url)),
		},
	},
	build: {
		outDir: "../../dist/client",
		emptyOutDir: true,
		target: "es2022",
	},
	server: {
		port: DEV_SERVER_PORT,
		proxy: {
			/*
			 * `changeOrigin` on both, and not by accident: the server answers only
			 * to a loopback Host (SEC-001), and Vite supplies this itself only for
			 * the string shorthand these entries are no longer written in.
			 *
			 * The event stream comes first because the first matching prefix wins,
			 * and it is the one entry that must carry no inactivity budget: SSE is
			 * an open response with long silences in it, and any timeout would cut
			 * the channel the whole app is patched through.
			 */
			"/api/events": {
				target: API_TARGET,
				changeOrigin: true,
				configure: unreachableOnError,
			},
			"/api": {
				target: API_TARGET,
				changeOrigin: true,
				/*
				 * `proxyTimeout` and not `timeout`: the first destroys the request
				 * to the API server, which surfaces as the error event handled
				 * above; the second sets an inactivity timeout on the *browser's*
				 * socket, and Node answers that by dropping the connection with no
				 * response at all — a different silence, not a fix for it.
				 */
				proxyTimeout: PROXY_TIMEOUT_MS,
				configure: unreachableOnError,
			},
		},
	},
});
