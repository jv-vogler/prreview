// @vitest-environment jsdom

import type { FileDiffDto } from "@dto/ChangesetDto";
import type { ChatMessageDto } from "@dto/ChatMessageDto";
import type { ServerEvent } from "@dto/ServerEvent";
import type { SessionDto } from "@dto/SessionDto";
import {
	act,
	cleanup,
	fireEvent,
	screen,
	waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { DiffNavigationProvider } from "../diff/DiffNavigationProvider";
import type { KeyAction } from "../diff/resolveKeyAction";
import { useKeymap } from "../diff/useKeymap";
import {
	type AgentKind,
	renderWithProviders,
	sessionDto,
} from "../testing/renderWithProviders";
import { ChatDock } from "./ChatDock";
import { ChatProvider } from "./ChatProvider";

afterEach(cleanup);

function file(path: string, hunkIds: readonly string[]): FileDiffDto {
	return {
		id: `id-${path}`,
		path,
		status: "modified",
		additions: 1,
		deletions: 0,
		isBinary: false,
		isGenerated: false,
		oldBlob: null,
		newBlob: null,
		hunks: hunkIds.map((id) => ({
			id,
			header: "@@",
			oldStart: 1,
			oldLines: 1,
			newStart: 1,
			newLines: 1,
			lines: [],
		})),
	};
}

const FILES = [file("src/client/src/view/chat/ChatDock.tsx", ["h1", "h2"])];

const TURN_ID = "turn-1";

/**
 * The `c` key and the dock's open state, wired exactly as `DiffPage` wires
 * them: the key is ignored when the session has no agent, and it is the keymap
 * that decides a keystroke inside the composer belongs to the composer.
 */
function DockHost({ chatEnabled }: { chatEnabled: boolean }) {
	const [open, setOpen] = useState(false);
	const onAction = (action: KeyAction) => {
		if (action === "toggle-chat" && chatEnabled) {
			setOpen((current) => !current);
		}
	};
	useKeymap({ dialogOpen: false, onAction });

	return (
		<div>
			<p data-testid="mounted">ready</p>
			{open && <ChatDock onClose={() => setOpen(false)} />}
		</div>
	);
}

interface HarnessOptions {
	agent?: AgentKind;
	stored?: readonly ChatMessageDto[];
}

function renderDock(options: HarnessOptions = {}) {
	const agent = options.agent ?? "claude";
	return renderWithProviders(
		<DiffNavigationProvider
			files={FILES}
			initialCursor={{ fileIndex: 0, hunkIndex: 1 }}
		>
			<ChatProvider>
				<DockHost chatEnabled={agent === "claude"} />
			</ChatProvider>
		</DiffNavigationProvider>,
		{
			responses: {
				"/api/session": sessionDto(agent) satisfies SessionDto,
				"/api/chat/messages": options.stored ?? [],
			},
			postResponse: { turnId: TURN_ID },
		},
	);
}

function pressKey(key: string, target: Element = document.body) {
	fireEvent.keyDown(target, { key });
}

async function openDock(options: HarnessOptions = {}) {
	const rendered = renderDock(options);
	await screen.findByTestId("mounted");
	pressKey("c");
	const composer = await screen.findByLabelText("Your question");
	return { ...rendered, composer };
}

function ask(composer: HTMLElement, text: string) {
	fireEvent.change(composer, { target: { value: text } });
	fireEvent.keyDown(composer, { key: "Enter" });
}

function emit(events: { emit(event: ServerEvent): void }, event: ServerEvent) {
	act(() => {
		events.emit(event);
	});
}

describe("the chat dock", () => {
	it("opens on c and closes on c again", async () => {
		await openDock();

		pressKey("c");

		await waitFor(() => {
			expect(screen.queryByLabelText("Your question")).toBeNull();
		});
	});

	it("leaves the c key to the composer while the reader is typing in it", async () => {
		const { composer } = await openDock();

		pressKey("c", composer);

		// still open: the keystroke was a letter in a question, not a command
		expect(screen.getByLabelText("Your question")).toBeTruthy();
	});

	it("never opens at all without an agent", async () => {
		renderDock({ agent: "none" });
		await screen.findByTestId("mounted");

		pressKey("c");

		expect(screen.queryByLabelText("Your question")).toBeNull();
	});

	it("shows what the question will be framed with", async () => {
		await openDock();

		expect(screen.getByText("ChatDock.tsx")).toBeTruthy();
		expect(screen.getByText("hunk 2 of 2")).toBeTruthy();
	});

	it("sends the question with the file and hunk on screen", async () => {
		const { composer, post } = await openDock();

		ask(composer, "who calls this?");

		await waitFor(() => {
			expect(post).toHaveBeenCalledWith("/api/chat/messages", {
				text: "who calls this?",
				context: {
					file: "src/client/src/view/chat/ChatDock.tsx",
					hunkId: "h2",
				},
			});
		});
	});

	it("streams the reply as it arrives, then settles on the stored message", async () => {
		const { composer, events, post } = await openDock();

		ask(composer, "who calls this?");
		await waitFor(() => expect(post).toHaveBeenCalled());
		// the question is on screen before any answer exists
		expect(screen.getByText("who calls this?")).toBeTruthy();
		expect(screen.getByText("Reading the code")).toBeTruthy();

		emit(events, { type: "chat.turn.started", turnId: TURN_ID });
		emit(events, {
			type: "chat.turn.delta",
			turnId: TURN_ID,
			text: "The caller ",
		});
		expect(screen.getByText("The caller")).toBeTruthy();

		emit(events, {
			type: "chat.turn.delta",
			turnId: TURN_ID,
			text: "is run().",
		});
		expect(screen.getByText("The caller is run().")).toBeTruthy();

		emit(events, {
			type: "chat.turn.completed",
			turnId: TURN_ID,
			message: {
				role: "assistant",
				text: "The caller is run() in main.ts.",
				at: "2026-08-17T10:00:00.000Z",
			},
		});

		// the authoritative message replaces the accumulated text, exactly once
		expect(screen.getByText("The caller is run() in main.ts.")).toBeTruthy();
		expect(screen.queryByText("The caller is run().")).toBeNull();
	});

	it("says why a question went unanswered, in its own words", async () => {
		const { composer, events, post } = await openDock();

		ask(composer, "why is this safe?");
		await waitFor(() => expect(post).toHaveBeenCalled());

		emit(events, {
			type: "chat.turn.failed",
			turnId: TURN_ID,
			reason: "timed-out",
			message: "the agent said something we do not repeat",
		});

		expect(
			screen.getByText(/The agent ran out of time before answering/),
		).toBeTruthy();
		expect(screen.queryByText(/something we do not repeat/)).toBeNull();
	});

	it("holds a second question until the first is answered", async () => {
		const { composer, events, post } = await openDock();

		ask(composer, "who calls this?");
		await waitFor(() => expect(post).toHaveBeenCalledTimes(1));

		ask(composer, "and what did it replace?");

		expect(screen.getByText("and what did it replace?")).toBeTruthy();
		expect(
			screen.getByText("Waiting for the question before this one"),
		).toBeTruthy();
		expect(post).toHaveBeenCalledTimes(1);

		emit(events, {
			type: "chat.turn.completed",
			turnId: TURN_ID,
			message: {
				role: "assistant",
				text: "run() in main.ts.",
				at: "2026-08-17T10:00:00.000Z",
			},
		});

		await waitFor(() => {
			expect(post).toHaveBeenCalledTimes(2);
		});
		expect(post).toHaveBeenLastCalledWith("/api/chat/messages", {
			text: "and what did it replace?",
			context: {
				file: "src/client/src/view/chat/ChatDock.tsx",
				hunkId: "h2",
			},
		});
	});

	it("reads the stored thread back as history, without repeating this visit's turns", async () => {
		const { composer, events, post } = await openDock({
			stored: [
				{
					role: "user",
					text: "asked last time",
					at: "2026-08-17T09:00:00.000Z",
				},
				{
					role: "assistant",
					text: "answered last time",
					at: "2026-08-17T09:00:02.000Z",
				},
			],
		});

		expect(screen.getByText("asked last time")).toBeTruthy();
		expect(screen.getByText("answered last time")).toBeTruthy();

		ask(composer, "and now?");
		await waitFor(() => expect(post).toHaveBeenCalled());
		emit(events, {
			type: "chat.turn.completed",
			turnId: TURN_ID,
			message: {
				role: "assistant",
				text: "now this",
				at: "2026-08-17T10:00:00.000Z",
			},
		});

		expect(screen.getAllByText("now this")).toHaveLength(1);
		expect(screen.getAllByText("and now?")).toHaveLength(1);
	});

	it("teaches what the dock is for before anything is asked", async () => {
		await openDock();

		expect(
			screen.getByText(/Answers come from the repository at this revision/),
		).toBeTruthy();
	});
});
