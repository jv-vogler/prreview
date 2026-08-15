import type { MiddlewareHandler } from "hono";

/** DNS-rebinding defense (ARCHITECTURE §15): loopback names only, nothing else. */
const ALLOWED_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

export interface HostAllowlistOptions {
	/** ports accepted alongside a bare hostname: the bound port, plus Vite's under --dev */
	allowedPorts: readonly number[];
}

/**
 * First middleware in line, on every request (SEC-001): the Host header must
 * be exactly `localhost`, `127.0.0.1`, or `[::1]`, bare or with an allowed
 * port. A browser lured to `http://attacker-domain:4973` after a DNS rebind
 * reaches this server but carries the attacker's Host — and gets a 403.
 */
export function hostAllowlist(
	options: HostAllowlistOptions,
): MiddlewareHandler {
	return async (context, next) => {
		// node-server always carries the socket's Host header; the URL authority
		// covers in-process test requests built straight from a URL
		const host = context.req.header("host") ?? new URL(context.req.url).host;
		if (!isAllowedHost(host, options.allowedPorts)) {
			return context.json(
				{
					reason: "forbidden-host",
					message: "prreview only answers to localhost.",
				},
				403,
			);
		}
		return next();
	};
}

function isAllowedHost(host: string, allowedPorts: readonly number[]): boolean {
	const parsed = splitHostPort(host.toLowerCase());
	if (parsed === null || !ALLOWED_HOSTNAMES.has(parsed.hostname)) {
		return false;
	}
	if (parsed.port === null) {
		return true;
	}
	return allowedPorts.includes(parsed.port);
}

function splitHostPort(
	host: string,
): { hostname: string; port: number | null } | null {
	// bracketed IPv6 first: the colons inside the brackets are not a port
	if (host.startsWith("[")) {
		const closingBracket = host.indexOf("]");
		if (closingBracket === -1) {
			return null;
		}
		const hostname = host.slice(0, closingBracket + 1);
		const rest = host.slice(closingBracket + 1);
		if (rest === "") {
			return { hostname, port: null };
		}
		return withParsedPort(hostname, rest);
	}

	const colon = host.lastIndexOf(":");
	if (colon === -1) {
		return { hostname: host, port: null };
	}
	return withParsedPort(host.slice(0, colon), host.slice(colon));
}

function withParsedPort(
	hostname: string,
	portWithColon: string,
): { hostname: string; port: number } | null {
	if (!/^:\d+$/.test(portWithColon)) {
		return null;
	}
	return { hostname, port: Number(portWithColon.slice(1)) };
}
