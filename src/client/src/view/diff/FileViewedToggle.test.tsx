import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FileViewedToggle } from "./FileViewedToggle";

describe("the viewed box on a file header", () => {
	it("reports the file it belongs to when checked", () => {
		const onToggle = vi.fn();
		render(
			<FileViewedToggle
				fileId="file-1"
				path="src/app.ts"
				viewed={false}
				onToggle={onToggle}
			/>,
		);

		const box = screen.getByRole("checkbox", {
			name: "Mark src/app.ts viewed",
		});
		expect((box as HTMLInputElement).checked).toBe(false);
		fireEvent.click(box);

		expect(onToggle).toHaveBeenCalledWith("file-1");
	});
});
