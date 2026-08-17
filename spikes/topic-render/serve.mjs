/**
 * Static server for the built spike with the production CSP from
 * ARCHITECTURE §15, so worker operation is verified under the real policy.
 */
import { createReadStream, existsSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const DIST_DIR = fileURLToPath(new URL("./dist", import.meta.url));
const PORT = Number(process.env.SPIKE_PORT ?? 4991);

const CSP =
	"default-src 'self'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; frame-ancestors 'none'";

const MIME_TYPES = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json",
	".svg": "image/svg+xml",
	".wasm": "application/wasm",
};

const server = createServer((request, response) => {
	const url = new URL(request.url, `http://127.0.0.1:${PORT}`);
	const relativePath = normalize(url.pathname).replace(/^\/+/, "");
	let filePath = join(
		DIST_DIR,
		relativePath === "" ? "index.html" : relativePath,
	);
	if (!filePath.startsWith(DIST_DIR) || !existsSync(filePath)) {
		filePath = join(DIST_DIR, "index.html");
	}
	response.writeHead(200, {
		"Content-Type": MIME_TYPES[extname(filePath)] ?? "application/octet-stream",
		"Content-Security-Policy": CSP,
	});
	createReadStream(filePath).pipe(response);
});

server.listen(PORT, "127.0.0.1", () => {
	console.log(`spike server on http://127.0.0.1:${PORT}`);
});
