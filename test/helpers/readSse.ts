export interface SseFrame {
	id: number | null;
	data: string;
}

const FRAME_SEPARATOR = "\n\n";
const READ_TIMEOUT_MS = 2_000;

/**
 * Reads `count` SSE frames off a streaming response body, then releases the
 * reader WITHOUT cancelling — cancelling would count as a disconnect, and the
 * tests that need one own an AbortController instead.
 */
export async function readSseFrames(
	body: ReadableStream<Uint8Array>,
	count: number,
): Promise<SseFrame[]> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffered = "";
	const frames: SseFrame[] = [];

	try {
		while (frames.length < count) {
			const chunk = await readWithTimeout(reader);
			if (chunk.done) {
				break;
			}
			buffered += decoder.decode(chunk.value, { stream: true });
			const blocks = buffered.split(FRAME_SEPARATOR);
			buffered = blocks.pop() ?? "";
			for (const block of blocks) {
				frames.push(parseFrame(block));
			}
		}
	} finally {
		reader.releaseLock();
	}
	return frames.slice(0, count);
}

type SseReader = ReadableStreamDefaultReader<Uint8Array>;

async function readWithTimeout(
	reader: SseReader,
): Promise<Awaited<ReturnType<SseReader["read"]>>> {
	let timer: NodeJS.Timeout | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() => reject(new Error("timed out waiting for an SSE frame")),
			READ_TIMEOUT_MS,
		);
	});
	try {
		return await Promise.race([reader.read(), timeout]);
	} finally {
		clearTimeout(timer);
	}
}

function parseFrame(block: string): SseFrame {
	let id: number | null = null;
	const dataLines: string[] = [];
	for (const line of block.split("\n")) {
		if (line.startsWith("id:")) {
			id = Number(line.slice("id:".length).trim());
		} else if (line.startsWith("data:")) {
			dataLines.push(line.slice("data:".length).trimStart());
		}
	}
	return { id, data: dataLines.join("\n") };
}
