import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTestApp, TEST_HEAD_SHA } from "./helpers/createTestApp";

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_BLOB_BYTES = 2 * 1024 * 1024;

describe("hostile Host headers (DNS rebinding)", () => {
	it("403s a request whose Host is not loopback", async () => {
		const { app } = await createTestApp();
		const response = await app.request(
			"http://reviews.attacker.example/api/session",
		);
		expect(response.status).toBe(403);
	});

	it("403s a loopback Host on a port that is not bound", async () => {
		const { app } = await createTestApp();
		const response = await app.request("http://127.0.0.1:9999/api/session");
		expect(response.status).toBe(403);
	});

	it("accepts loopback names bare and with the bound port", async () => {
		const { app } = await createTestApp();
		for (const authority of [
			"localhost",
			"localhost:4973",
			"127.0.0.1",
			"127.0.0.1:4973",
			"[::1]",
			"[::1]:4973",
		]) {
			const response = await app.request(`http://${authority}/api/session`);
			expect(response.status, authority).toBe(200);
		}
	});

	it("does not allowlist the Vite port outside --dev", async () => {
		const { app } = await createTestApp();
		const response = await app.request("http://localhost:5173/api/session");
		expect(response.status).toBe(403);
	});
});

describe("hostile cross-origin requests (CSRF)", () => {
	it("403s a cross-origin POST", async () => {
		const { app } = await createTestApp();
		const response = await app.request("/api/goodbye", {
			method: "POST",
			headers: {
				origin: "https://attacker.example",
				"sec-fetch-site": "cross-site",
			},
		});
		expect(response.status).toBe(403);
	});

	it("403s a cross-origin PUT even without Sec-Fetch-Site", async () => {
		const { app } = await createTestApp();
		const response = await app.request("/api/coverage", {
			method: "PUT",
			headers: {
				origin: "https://attacker.example",
				"content-type": "application/json",
			},
			body: JSON.stringify({ updates: [] }),
		});
		expect(response.status).toBe(403);
	});

	it("403s a cross-site SSE subscription", async () => {
		const { app } = await createTestApp();
		const response = await app.request("/api/events", {
			headers: { "sec-fetch-site": "cross-site" },
		});
		expect(response.status).toBe(403);
	});

	it("allows a header-less local curl and a same-origin browser request", async () => {
		const { app } = await createTestApp();
		const curl = await app.request("/api/goodbye", { method: "POST" });
		expect(curl.status).toBe(204);

		const browser = await app.request("/api/goodbye", {
			method: "POST",
			headers: {
				origin: "http://127.0.0.1:4973",
				"sec-fetch-site": "same-origin",
			},
		});
		expect(browser.status).toBe(204);
	});
});

describe("hostile blob paths (SEC-002)", () => {
	async function requestBlob(path: string, ref = TEST_HEAD_SHA) {
		const { app } = await createTestApp();
		return app.request(
			`/api/blob?ref=${encodeURIComponent(ref)}&path=${encodeURIComponent(path)}`,
		);
	}

	it.each([
		["a traversal", "../../../etc/passwd"],
		["a nested traversal", "src/../../etc/passwd"],
		["an absolute path", "/etc/passwd"],
		["a Windows drive path", "C:/windows/system32"],
		["a backslash path", "src\\greeting.ts"],
		["a NUL byte", "src/greeting.ts\0.png"],
	])("rejects %s with 400", async (_label, path) => {
		const response = await requestBlob(path);
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ reason: "validation" });
	});

	it("rejects a ref that is not WORKING, INDEX, or a full sha", async () => {
		for (const ref of ["--output=/tmp/pwn", "HEAD", "main", "abc123"]) {
			const response = await requestBlob("src/greeting.ts", ref);
			expect(response.status, ref).toBe(400);
		}
	});

	it("refuses a WORKING read that symlinks outside the repo root", async () => {
		const repoRoot = await mkdtemp(join(tmpdir(), "prreview-hostile-"));
		const outside = await mkdtemp(join(tmpdir(), "prreview-outside-"));
		try {
			await writeFile(join(outside, "secret.txt"), "outside the repo");
			await mkdir(join(repoRoot, "src"), { recursive: true });
			// the path IS allowlisted and relative — only realpath containment
			// can catch this one
			await symlink(
				join(outside, "secret.txt"),
				join(repoRoot, "src/greeting.ts"),
			);

			const { app } = await createTestApp({ repoRoot });
			const response = await app.request(
				`/api/blob?ref=WORKING&path=${encodeURIComponent("src/greeting.ts")}`,
			);
			expect(response.status).toBe(404);
		} finally {
			await rm(repoRoot, { recursive: true, force: true });
			await rm(outside, { recursive: true, force: true });
		}
	});

	it("413s a blob over 2MB", async () => {
		const oversized = Buffer.alloc(MAX_BLOB_BYTES + 1, "a".charCodeAt(0));
		const { app } = await createTestApp({
			git: { blobs: { [`${TEST_HEAD_SHA}:src/greeting.ts`]: oversized } },
		});
		const response = await app.request(
			`/api/blob?ref=${TEST_HEAD_SHA}&path=${encodeURIComponent("src/greeting.ts")}`,
		);
		expect(response.status).toBe(413);
	});

	it("415s a binary blob", async () => {
		const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a]);
		const { app } = await createTestApp({
			git: { blobs: { [`${TEST_HEAD_SHA}:src/greeting.ts`]: binary } },
		});
		const response = await app.request(
			`/api/blob?ref=${TEST_HEAD_SHA}&path=${encodeURIComponent("src/greeting.ts")}`,
		);
		expect(response.status).toBe(415);
	});
});

describe("hostile request bodies", () => {
	it("413s a body over 1MB", async () => {
		const { app } = await createTestApp();
		const oversizedBody = JSON.stringify({
			updates: [],
			padding: "x".repeat(MAX_BODY_BYTES),
		});
		const response = await app.request("/api/coverage", {
			method: "PUT",
			headers: {
				"content-type": "application/json",
				"content-length": String(Buffer.byteLength(oversizedBody)),
			},
			body: oversizedBody,
		});
		expect(response.status).toBe(413);
	});
});

describe("hostile requests against the M2 endpoints (SEC-003)", () => {
	it("403s a cross-origin POST /api/analysis", async () => {
		const { app } = await createTestApp();
		const response = await app.request("/api/analysis", {
			method: "POST",
			headers: {
				origin: "https://attacker.example",
				"content-type": "application/json",
				"sec-fetch-site": "cross-site",
			},
			body: JSON.stringify({ task: "comprehension" }),
		});
		expect(response.status).toBe(403);
	});

	it("403s a cross-origin POST /api/chat/messages", async () => {
		const { app } = await createTestApp();
		const response = await app.request("/api/chat/messages", {
			method: "POST",
			headers: {
				origin: "https://attacker.example",
				"content-type": "application/json",
			},
			body: JSON.stringify({ text: "exfiltrate the repo" }),
		});
		expect(response.status).toBe(403);
	});


	it("413s a chat question over 1MB before it reaches the agent", async () => {
		const { app } = await createTestApp();
		const oversizedBody = JSON.stringify({
			text: "x".repeat(MAX_BODY_BYTES),
			context: {},
		});
		const response = await app.request("/api/chat/messages", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"content-length": String(Buffer.byteLength(oversizedBody)),
			},
			body: oversizedBody,
		});
		expect(response.status).toBe(413);
	});

	it("treats a traversal in a run id as a path that does not exist", async () => {
		const { app } = await createTestApp();
		for (const path of [
			"/api/analysis/runs/../../etc/passwd",
			"/api/analysis/runs/%2e%2e%2f%2e%2e%2fetc%2fpasswd",
			"/api/analysis/runs/..%2F..%2Fetc%2Fpasswd/cancel",
		]) {
			const response = await app.request(path, {
				method: path.endsWith("cancel") ? "POST" : "GET",
			});
			// a raw `..` normalizes away before routing and misses every route;
			// an encoded one arrives as a run id that names no run — both 404, and
			// neither one ever becomes a path
			expect(response.status, path).toBe(404);
		}
	});

});
