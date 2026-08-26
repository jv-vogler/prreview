import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CopyPathButton } from "./CopyPathButton";

describe("copying a file path from its header", () => {
	it("writes the whole path to the clipboard and says so", async () => {
		const writeText = vi.fn(() => Promise.resolve());
		Object.defineProperty(navigator, "clipboard", {
			value: { writeText },
			configurable: true,
		});

		render(<CopyPathButton path="src/app.ts" />);
		fireEvent.click(screen.getByRole("button", { name: "Copy src/app.ts" }));

		expect(writeText).toHaveBeenCalledWith("src/app.ts");
		expect(
			await screen.findByRole("button", { name: "Copied src/app.ts" }),
		).toBeTruthy();
	});
});
