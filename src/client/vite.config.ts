import { ServerResponse } from "node:http";
import { connect } from "node:net";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type HttpProxy, type Plugin } from "vite";

const API_SERVER_HOST = "127.0.0.1";
const API_SERVER_DEFAULT_PORT = 4973;
const API_TARGET = `http://${API_SERVER_HOST}:${API_SERVER_DEFAULT_PORT}`;
const DEV_SERVER_PORT = 5173;

const PROBE_TIMEOUT_MS = 500;

const PROXY_TIMEOUT_MS = 15_000;
const SERVICE_UNAVAILABLE = 503;

function apiUnreachableGate(): Plugin {
	return {
		name: "prreview:api-unreachable-gate",

		apply: "serve",
		configureServer(server) {
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

function unreachableOnError(proxy: HttpProxy.ProxyServer): void {
	proxy.on("error", (_error, _req, res) => {
		if (!(res instanceof ServerResponse)) {
			res.destroy();
			return;
		}
		answerUnreachable(res);
	});
}

export default defineConfig({
	plugins: [apiUnreachableGate(), react()],

	worker: { format: "es" },
	resolve: {
		alias: {
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
			"/api/events": {
				target: API_TARGET,
				changeOrigin: true,
				configure: unreachableOnError,
			},
			"/api": {
				target: API_TARGET,
				changeOrigin: true,

				proxyTimeout: PROXY_TIMEOUT_MS,
				configure: unreachableOnError,
			},
		},
	},
});
