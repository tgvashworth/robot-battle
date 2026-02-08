import { describe, expect, it } from "vitest"
import { clamp, lerp, lerpAngle, normalizeAngle } from "../math"

describe("lerp", () => {
	it("returns a when t=0", () => {
		expect(lerp(10, 20, 0)).toBe(10)
	})

	it("returns b when t=1", () => {
		expect(lerp(10, 20, 1)).toBe(20)
	})

	it("returns midpoint when t=0.5", () => {
		expect(lerp(0, 100, 0.5)).toBe(50)
	})

	it("handles negative ranges", () => {
		expect(lerp(-10, 10, 0.5)).toBe(0)
	})

	it("extrapolates beyond 0-1", () => {
		expect(lerp(0, 10, 2)).toBe(20)
		expect(lerp(0, 10, -1)).toBe(-10)
	})
})

describe("normalizeAngle", () => {
	it("leaves angles in [0, 360) unchanged", () => {
		expect(normalizeAngle(0)).toBe(0)
		expect(normalizeAngle(90)).toBe(90)
		expect(normalizeAngle(359)).toBe(359)
	})

	it("normalizes 360 to 0", () => {
		expect(normalizeAngle(360)).toBe(0)
	})

	it("normalizes positive angles >= 360", () => {
		expect(normalizeAngle(450)).toBe(90)
		expect(normalizeAngle(720)).toBe(0)
	})

	it("normalizes negative angles", () => {
		expect(normalizeAngle(-90)).toBe(270)
		expect(normalizeAngle(-360)).toBe(0)
		expect(normalizeAngle(-450)).toBe(270)
	})
})

describe("lerpAngle", () => {
	it("interpolates normally when no wraparound needed", () => {
		expect(lerpAngle(0, 90, 0.5)).toBe(45)
	})

	it("returns start angle at t=0", () => {
		expect(lerpAngle(30, 60, 0)).toBe(30)
	})

	it("returns end angle at t=1", () => {
		expect(lerpAngle(30, 60, 1)).toBe(60)
	})

	it("takes shortest path clockwise through 0/360 boundary", () => {
		// From 350 to 10: shortest path is +20 degrees through 0
		const result = lerpAngle(350, 10, 0.5)
		expect(result).toBe(0)
	})

	it("takes shortest path counter-clockwise through 0/360 boundary", () => {
		// From 10 to 350: shortest path is -20 degrees through 0
		const result = lerpAngle(10, 350, 0.5)
		expect(result).toBe(0)
	})

	it("handles full interpolation across wraparound", () => {
		expect(lerpAngle(350, 10, 0)).toBe(350)
		expect(lerpAngle(350, 10, 1)).toBe(10)
	})

	it("handles 180-degree difference", () => {
		// 180 degrees apart: could go either way, should still produce valid result
		const result = lerpAngle(0, 180, 0.5)
		expect(result).toBe(90)
	})

	it("handles already normalized input", () => {
		expect(lerpAngle(0, 0, 0.5)).toBe(0)
	})

	it("handles unnormalized input angles", () => {
		const result = lerpAngle(710, -10, 0.5)
		// 710 normalizes to 350, -10 normalizes to 350 => same angle
		expect(result).toBe(350)
	})
})

describe("clamp", () => {
	it("returns x when within range", () => {
		expect(clamp(5, 0, 10)).toBe(5)
	})

	it("clamps to lo when below", () => {
		expect(clamp(-5, 0, 10)).toBe(0)
	})

	it("clamps to hi when above", () => {
		expect(clamp(15, 0, 10)).toBe(10)
	})

	it("returns lo when x equals lo", () => {
		expect(clamp(0, 0, 10)).toBe(0)
	})

	it("returns hi when x equals hi", () => {
		expect(clamp(10, 0, 10)).toBe(10)
	})
})
