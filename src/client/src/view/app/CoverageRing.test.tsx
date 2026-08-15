// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CoverageRing, ringDashOffset } from "./CoverageRing";

afterEach(cleanup);

const RING_RADIUS = (20 - 2.5) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

describe("ringDashOffset", () => {
	it("leaves the whole circumference unpainted at 0%", () => {
		expect(ringDashOffset(0)).toBeCloseTo(CIRCUMFERENCE);
	});

	it("paints everything at 100%", () => {
		expect(ringDashOffset(100)).toBeCloseTo(0);
	});

	it("paints a quarter at 25%", () => {
		expect(ringDashOffset(25)).toBeCloseTo(CIRCUMFERENCE * 0.75);
	});

	it("clamps out-of-range inputs", () => {
		expect(ringDashOffset(-10)).toBeCloseTo(CIRCUMFERENCE);
		expect(ringDashOffset(140)).toBeCloseTo(0);
	});
});

describe("CoverageRing", () => {
	it("renders the rounded percent as label and meter value", () => {
		render(<CoverageRing percent={66.666} />);
		const meter = screen.getByRole("meter", { name: "Review coverage" });
		expect(meter.getAttribute("aria-valuenow")).toBe("67");
		expect(screen.getByText("67%")).toBeTruthy();
	});

	it("applies the arc offset for the unrounded percent", () => {
		const { container } = render(<CoverageRing percent={25} />);
		const arcs = container.querySelectorAll("circle");
		const progress = arcs[arcs.length - 1];
		expect(Number(progress.getAttribute("stroke-dashoffset"))).toBeCloseTo(
			CIRCUMFERENCE * 0.75,
		);
	});

	it("marks completion at 100%", () => {
		render(<CoverageRing percent={100} />);
		const meter = screen.getByRole("meter", { name: "Review coverage" });
		expect(meter.hasAttribute("data-complete")).toBe(true);
	});
});
