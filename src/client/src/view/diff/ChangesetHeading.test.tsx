import type { ChangesetSourceDto } from "@dto/ChangesetDto";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChangesetHeading } from "./ChangesetHeading";

const PR_SOURCE: ChangesetSourceDto = {
	kind: "pr",
	repo: "jv-vogler/calisthenics-app",
	number: 22,
};

const OVERRIDE_HINT = "override with an explicit target";

describe("ChangesetHeading", () => {
	it("leads with the repository and links the PR number", () => {
		render(
			<ChangesetHeading
				source={PR_SOURCE}
				resolved="pull request #22 of jv-vogler/calisthenics-app"
				overrideHint={OVERRIDE_HINT}
				prUrl="https://github.com/jv-vogler/calisthenics-app/pull/22"
			/>,
		);
		const heading = screen.getByRole("heading", { level: 1 });
		expect(heading.textContent).toContain("jv-vogler/calisthenics-app");
		const numberLink = screen.getByRole("link", { name: "#22" });
		expect(numberLink.getAttribute("href")).toBe(
			"https://github.com/jv-vogler/calisthenics-app/pull/22",
		);
	});

	it("names the repository before the PR number", () => {
		render(
			<ChangesetHeading
				source={PR_SOURCE}
				resolved="pull request #22 of jv-vogler/calisthenics-app"
				overrideHint={OVERRIDE_HINT}
			/>,
		);
		const heading = screen.getByRole("heading", { level: 1 });
		const text = heading.textContent ?? "";
		expect(text.indexOf("jv-vogler/calisthenics-app")).toBeLessThan(
			text.indexOf("#22"),
		);
	});

	it("shows a View on GitHub link for a PR resolved with GitHub metadata", () => {
		render(
			<ChangesetHeading
				source={PR_SOURCE}
				resolved="pull request #22 of jv-vogler/calisthenics-app"
				overrideHint={OVERRIDE_HINT}
				prUrl="https://github.com/jv-vogler/calisthenics-app/pull/22"
			/>,
		);
		const link = screen.getByRole("link", { name: /view on github/i });
		expect(link.getAttribute("target")).toBe("_blank");
		expect(link.getAttribute("rel")).toBe("noreferrer");
	});

	it("renders the PR number as plain text when there is no GitHub metadata", () => {
		render(
			<ChangesetHeading
				source={PR_SOURCE}
				resolved="pull request #22 of jv-vogler/calisthenics-app"
				overrideHint={OVERRIDE_HINT}
			/>,
		);
		expect(screen.queryByRole("link")).toBeNull();
		expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(
			"#22",
		);
	});

	it("keeps the server's own sentence for a branch target", () => {
		render(
			<ChangesetHeading
				source={{ kind: "branch", branch: "feature-x", base: "main" }}
				resolved="branch feature-x against main"
				overrideHint={OVERRIDE_HINT}
			/>,
		);
		expect(screen.getByText("Branch feature-x against main")).toBeTruthy();
		expect(screen.queryByRole("link")).toBeNull();
	});

	it("keeps the server's own sentence for the working tree", () => {
		render(
			<ChangesetHeading
				source={{ kind: "worktree" }}
				resolved="the working tree"
				overrideHint={OVERRIDE_HINT}
			/>,
		);
		expect(screen.getByText("The working tree")).toBeTruthy();
	});
});
