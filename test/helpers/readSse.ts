const FRAME_SEPARATOR = "\n\n";
const READ_TIMEOUT_MS = 2_000;

export async function readSseFrames(
	body: ReadableStream<Uint8Array>,
	count: number,
): Promise<string[]> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffered = "";
	const frames: string[] = [];

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
				frames.push(parseData(block));
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

function parseData(block: string): string {
	return block
		.split("\n")
		.filter((line) => line.startsWith("data:"))
		.map((line) => line.slice("data:".length).trimStart())
		.join("\n");
}
