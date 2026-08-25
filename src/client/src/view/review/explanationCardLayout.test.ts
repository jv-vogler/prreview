import { afterEach, describe, expect, it } from "vitest";
import { createExplanationCardLayout } from "./explanationCardLayout";

function anchorAt(top: number): HTMLElement {
	const anchor = document.createElement("div");
	anchor.getBoundingClientRect = () =>
		({ top, bottom: top, left: 0, right: 0, width: 0, height: 0 }) as DOMRect;
	document.body.appendChild(anchor);
	return anchor;
}

function stackOfHeight(height: number): HTMLElement {
	const stack = document.createElement("div");
	Object.defineProperty(stack, "offsetHeight", { value: height });
	document.body.appendChild(stack);
	return stack;
}

describe("createExplanationCardLayout", () => {
	const releases: (() => void)[] = [];

	afterEach(() => {
		for (const release of releases.splice(0)) {
			release();
		}
		document.body.innerHTML = "";
	});

	it("pins a lone stack beside its anchor", () => {
		const layout = createExplanationCardLayout();
		const stack = stackOfHeight(80);
		releases.push(layout.register("explanation-0", anchorAt(100), stack));
		expect(stack.style.top).toBe("104px");
		expect(stack.style.visibility).toBe("visible");
	});

	it("pushes a stack below the one above instead of overlapping it", () => {
		const layout = createExplanationCardLayout();
		const upper = stackOfHeight(80);
		const lower = stackOfHeight(80);
		releases.push(layout.register("explanation-0", anchorAt(100), upper));
		releases.push(layout.register("explanation-1", anchorAt(110), lower));
		// upper spans 104..184; the lower anchor wants 114 but yields to 192
		expect(upper.style.top).toBe("104px");
		expect(lower.style.top).toBe("192px");
	});

	it("lays out by anchor position, not registration order", () => {
		const layout = createExplanationCardLayout();
		const lower = stackOfHeight(40);
		const upper = stackOfHeight(40);
		releases.push(layout.register("explanation-1", anchorAt(300), lower));
		releases.push(layout.register("explanation-0", anchorAt(100), upper));
		expect(upper.style.top).toBe("104px");
		expect(lower.style.top).toBe("304px");
	});

	it("hides a stack whose anchor left the viewport", () => {
		const layout = createExplanationCardLayout();
		const stack = stackOfHeight(80);
		releases.push(layout.register("explanation-0", anchorAt(-50), stack));
		expect(stack.style.visibility).toBe("hidden");
	});
});
