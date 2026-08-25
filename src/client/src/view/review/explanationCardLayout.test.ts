import { afterEach, describe, expect, it } from "vitest";
import { createExplanationCardLayout } from "./explanationCardLayout";

function anchorAt(top: number, blockBottom?: number): HTMLElement {
	const anchor = document.createElement("div");
	anchor.getBoundingClientRect = () =>
		({
			top,
			bottom: top,
			left: 0,
			right: 800,
			width: 800,
			height: 0,
		}) as DOMRect;
	if (blockBottom === undefined) {
		document.body.appendChild(anchor);
		return anchor;
	}
	const block = document.createElement("diffs-container");
	block.getBoundingClientRect = () =>
		({ top: top - 100, bottom: blockBottom, width: 800 }) as DOMRect;
	block.appendChild(anchor);
	document.body.appendChild(block);
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

	it("hides a stack whose anchor left the viewport with no block behind it", () => {
		const layout = createExplanationCardLayout();
		const stack = stackOfHeight(80);
		releases.push(layout.register("explanation-0", anchorAt(-50), stack));
		expect(stack.style.visibility).toBe("hidden");
	});

	it("sticks at the viewport top while the anchored file block is on screen", () => {
		const layout = createExplanationCardLayout();
		const stack = stackOfHeight(80);
		releases.push(layout.register("explanation-0", anchorAt(-50, 500), stack));
		expect(stack.style.visibility).toBe("visible");
		expect(stack.style.top).toBe("4px");
	});

	it("slides out under the block's own end instead of covering the next file", () => {
		const layout = createExplanationCardLayout();
		const stack = stackOfHeight(80);
		releases.push(layout.register("explanation-0", anchorAt(-50, 60), stack));
		// 60 - 80 puts the card's top above the roof: on its way out
		expect(stack.style.visibility).toBe("visible");
		expect(stack.style.top).toBe("-20px");
	});

	it("stays stuck once the renderer drops a row last seen above", () => {
		const layout = createExplanationCardLayout();
		const stack = stackOfHeight(80);
		const rect = {
			top: -50,
			bottom: -50,
			left: 0,
			right: 800,
			width: 800,
			height: 0,
		};
		const anchor = document.createElement("div");
		anchor.getBoundingClientRect = () => rect as DOMRect;
		const block = document.createElement("diffs-container");
		block.getBoundingClientRect = () =>
			({ top: -150, bottom: 500, width: 800 }) as DOMRect;
		block.appendChild(anchor);
		document.body.appendChild(block);
		releases.push(layout.register("explanation-0", anchor, stack));
		expect(stack.style.top).toBe("4px");
		// the row's layout goes away; the card was last seen above and stays
		rect.width = 0;
		rect.top = 0;
		releases.push(
			layout.register("explanation-1", anchorAt(400), stackOfHeight(40)),
		);
		expect(stack.style.top).toBe("4px");
		expect(stack.style.visibility).toBe("visible");
	});

	it("hides a dropped row that was last seen below", () => {
		const layout = createExplanationCardLayout();
		const stack = stackOfHeight(80);
		const rect = {
			top: 2000,
			bottom: 2000,
			left: 0,
			right: 800,
			width: 800,
			height: 0,
		};
		const anchor = document.createElement("div");
		anchor.getBoundingClientRect = () => rect as DOMRect;
		const block = document.createElement("diffs-container");
		block.getBoundingClientRect = () =>
			({ top: 100, bottom: 3000, width: 800 }) as DOMRect;
		block.appendChild(anchor);
		document.body.appendChild(block);
		releases.push(layout.register("explanation-0", anchor, stack));
		expect(stack.style.visibility).toBe("hidden");
		rect.width = 0;
		rect.top = 0;
		releases.push(
			layout.register("explanation-1", anchorAt(400), stackOfHeight(40)),
		);
		expect(stack.style.visibility).toBe("hidden");
	});

	it("hides an anchor the renderer has not laid out yet", () => {
		const layout = createExplanationCardLayout();
		const stack = stackOfHeight(80);
		const anchor = document.createElement("div");
		anchor.getBoundingClientRect = () =>
			({
				top: 0,
				bottom: 0,
				left: 0,
				right: 0,
				width: 0,
				height: 0,
			}) as DOMRect;
		document.body.appendChild(anchor);
		releases.push(layout.register("explanation-0", anchor, stack));
		expect(stack.style.visibility).toBe("hidden");
	});

	it("hides once the block is gone too", () => {
		const layout = createExplanationCardLayout();
		const stack = stackOfHeight(80);
		releases.push(layout.register("explanation-0", anchorAt(-200, -10), stack));
		expect(stack.style.visibility).toBe("hidden");
	});
});
