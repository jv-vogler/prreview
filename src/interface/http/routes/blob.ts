import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, sep } from "node:path";
import { Hono } from "hono";
import type { Git } from "../../../application/ports/Git";
import { ValidationError } from "../../../domain/errors/ValidationError";
import type { BlobRequest } from "../dto/BlobRequest";
import { blobRequestSchema } from "../dto/BlobRequest";
import type { BlobResponse } from "../dto/BlobResponse";
import type { ReviewState } from "../reviewState";
import { validatedQuery } from "../validate";

const MAX_BLOB_BYTES = 2 * 1024 * 1024;

const BINARY_SNIFF_BYTES = 8000;

const WORKING_REF = "WORKING";
const INDEX_REF = "INDEX";

const COMMIT_SHA_PATTERN = /^([0-9a-f]{40}|[0-9a-f]{64})$/;

export interface BlobRouteDeps {
	state: ReviewState;
	git: Git;
	repoRoot: string;
}

export function blobRoute(deps: BlobRouteDeps): Hono {
	const route = new Hono();

	route.get("/", async (context) => {
		const request = validatedQuery(context, blobRequestSchema);
		rejectHostilePath(request.path);
		rejectUnknownRef(request.ref);

		if (!changesetAllowsPath(deps.state, request.path)) {
			return context.json(
				{
					reason: "blob-not-found",
					message: `${request.path} is not part of this changeset.`,
				},
				404,
			);
		}

		const content = await readBlobContent(deps, request);
		if (content === null) {
			return context.json(
				{
					reason: "blob-not-found",
					message: `${request.path} could not be read at ${request.ref}.`,
				},
				404,
			);
		}
		if (content === "too-large") {
			return context.json(
				{ reason: "blob-too-large", message: "Blobs over 2MB are not served." },
				413,
			);
		}
		if (looksBinary(content)) {
			return context.json(
				{ reason: "blob-binary", message: "Binary content is not served." },
				415,
			);
		}

		const response: BlobResponse = {
			name: request.path,
			contents: content.toString("utf8"),
		};
		return context.json(response);
	});

	return route;
}

function rejectHostilePath(path: string): void {
	const hasWindowsDrive = /^[A-Za-z]:/.test(path);
	const hasDotDotSegment = path.split("/").includes("..");
	if (
		path.includes("\0") ||
		path.includes("\\") ||
		isAbsolute(path) ||
		hasWindowsDrive ||
		hasDotDotSegment
	) {
		throw new ValidationError(
			"Blob paths must be relative repo paths without '..', backslashes, or NUL.",
		);
	}
}

function rejectUnknownRef(ref: string): void {
	const isKnownForm =
		ref === WORKING_REF || ref === INDEX_REF || COMMIT_SHA_PATTERN.test(ref);
	if (!isKnownForm) {
		throw new ValidationError(
			"Blob refs must be WORKING, INDEX, or a full commit sha.",
		);
	}
}

function changesetAllowsPath(state: ReviewState, path: string): boolean {
	return state
		.current()
		.files.some((file) => file.path === path || file.oldPath === path);
}

async function readBlobContent(
	deps: BlobRouteDeps,
	request: BlobRequest,
): Promise<Buffer | "too-large" | null> {
	if (request.ref === WORKING_REF) {
		return readWorkingFile(deps.repoRoot, request.path);
	}

	try {
		const content =
			request.ref === INDEX_REF
				? await deps.git.readIndexBlob(request.path)
				: await deps.git.readBlob(request.ref, request.path);
		return content.byteLength > MAX_BLOB_BYTES ? "too-large" : content;
	} catch {
		return null;
	}
}

async function readWorkingFile(
	repoRoot: string,
	path: string,
): Promise<Buffer | "too-large" | null> {
	try {
		const realRoot = await realpath(repoRoot);
		const realFile = await realpath(join(repoRoot, path));
		const isContained =
			realFile === realRoot || realFile.startsWith(realRoot + sep);
		if (!isContained) {
			return null;
		}
		const fileStat = await stat(realFile);
		if (!fileStat.isFile()) {
			return null;
		}
		if (fileStat.size > MAX_BLOB_BYTES) {
			return "too-large";
		}
		return await readFile(realFile);
	} catch {
		return null;
	}
}

function looksBinary(content: Buffer): boolean {
	return content.subarray(0, BINARY_SNIFF_BYTES).includes(0);
}
