import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Hono } from "hono";

/**
 * Where `dist/client` sits relative to THIS module: inside the published
 * bundle everything is inlined into `dist/cli.js`, so `client/` is a sibling;
 * running from source (tsx) this file lives three levels under `src/`.
 */
const CLIENT_DIR_CANDIDATES = ["client/", "../../../dist/client/"];

const SPA_FALLBACK_FILE = "index.html";
const API_PATH_PREFIX = "/api/";

const CONTENT_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".ico": "image/x-icon",
	".map": "application/json; charset=utf-8",
	".woff2": "font/woff2",
	".txt": "text/plain; charset=utf-8",
};
const DEFAULT_CONTENT_TYPE = "application/octet-stream";

/** The built client's directory, or null when it has not been built. */
export async function resolveClientDir(): Promise<string | null> {
	for (const candidate of CLIENT_DIR_CANDIDATES) {
		const dir = fileURLToPath(new URL(candidate, import.meta.url));
		if (await isFile(join(dir, SPA_FALLBACK_FILE))) {
			return dir;
		}
	}
	return null;
}

/**
 * Registered after the API routes, skipped entirely under `--dev` (Vite
 * serves the client there): static files out of `dist/client`, with the SPA
 * fallback to index.html for client-side routes like `/diff`.
 */
export function registerStatic(app: Hono, clientDir: string): void {
	const rootDir = resolve(clientDir);

	app.get("*", async (context, next) => {
		if (context.req.path.startsWith(API_PATH_PREFIX)) {
			return next();
		}

		const filePath = containedFilePath(rootDir, context.req.path);
		if (filePath !== null && (await isFile(filePath))) {
			return context.body(await readFile(filePath), 200, {
				"Content-Type": contentTypeFor(filePath),
			});
		}

		const fallback = join(rootDir, SPA_FALLBACK_FILE);
		return context.body(await readFile(fallback), 200, {
			"Content-Type": CONTENT_TYPES[".html"],
		});
	});
}

/** Resolves the URL path inside the client dir; anything that escapes is null. */
function containedFilePath(rootDir: string, urlPath: string): string | null {
	let decoded: string;
	try {
		decoded = decodeURIComponent(urlPath);
	} catch {
		return null;
	}
	if (decoded.includes("\0") || decoded.includes("\\")) {
		return null;
	}
	const relativePath = decoded.replace(/^\/+/, "");
	if (relativePath === "") {
		return join(rootDir, SPA_FALLBACK_FILE);
	}
	const resolved = resolve(rootDir, relativePath);
	if (resolved !== rootDir && !resolved.startsWith(rootDir + sep)) {
		return null;
	}
	return resolved;
}

function contentTypeFor(filePath: string): string {
	return CONTENT_TYPES[extname(filePath).toLowerCase()] ?? DEFAULT_CONTENT_TYPE;
}

async function isFile(filePath: string): Promise<boolean> {
	try {
		return (await stat(filePath)).isFile();
	} catch {
		return false;
	}
}
