import { describe, expect, it } from "vitest"
import { PRNG } from "../prng"

describe("PRNG", () => {
	it("is deterministic with the same seed", () => {
		const a = new PRNG(42)
		const b = new PRNG(42)

		for (let i = 0; i < 100; i++) {
			expect(a.next()).toBe(b.next())
		}
	})

	it("produces different sequences for different seeds", () => {
		const a = new PRNG(1)
		const b = new PRNG(2)

		const seqA = Array.from({ length: 10 }, () => a.next())
		const seqB = Array.from({ length: 10 }, () => b.next())

		expect(seqA).not.toEqual(seqB)
	})

	it("nextFloat returns values in [0, 1)", () => {
		const rng = new PRNG(123)
		for (let i = 0; i < 1000; i++) {
			const v = rng.nextFloat()
			expect(v).toBeGreaterThanOrEqual(0)
			expect(v).toBeLessThan(1)
		}
	})

	it("nextInt returns values in [0, max)", () => {
		const rng = new PRNG(456)
		for (let i = 0; i < 1000; i++) {
			const v = rng.nextInt(10)
			expect(v).toBeGreaterThanOrEqual(0)
			expect(v).toBeLessThan(10)
		}
	})
})
