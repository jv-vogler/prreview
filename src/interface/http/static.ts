import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Hono } from "hono";

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

export async function resolveClientDir(): Promise<string | null> {
	for (const candidate of CLIENT_DIR_CANDIDATES) {
		const dir = fileURLToPath(new URL(candidate, import.meta.url));
		if (await isFile(join(dir, SPA_FALLBACK_FILE))) {
			return dir;
		}
	}
	return null;
}

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
