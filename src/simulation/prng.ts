/**
 * Deterministic PRNG (xoshiro128**).
 * Same seed always produces the same sequence — critical for replay reproducibility.
 */
export class PRNG {
	private s: Uint32Array

	constructor(seed: number) {
		// Initialize state from seed using splitmix32
		this.s = new Uint32Array(4)
		let s = seed >>> 0
		for (let i = 0; i < 4; i++) {
			s += 0x9e3779b9
			s = s >>> 0
			let t = s ^ (s >>> 16)
			t = Math.imul(t, 0x21f0aaad)
			t = t >>> 0
			t = t ^ (t >>> 15)
			t = Math.imul(t, 0x735a2d97)
			t = t >>> 0
			t = t ^ (t >>> 13)
			this.s[i] = t >>> 0
		}
	}

	/** Returns a 32-bit unsigned integer. */
	next(): number {
		const s0 = this.s[0]!
		const s1 = this.s[1]!
		const s2 = this.s[2]!
		const s3 = this.s[3]!

		const result = Math.imul(rotl(Math.imul(s1, 5), 7), 9) >>> 0
		const t = (s1 << 9) >>> 0

		this.s[2] = s2 ^ s0
		this.s[3] = s3 ^ s1
		this.s[1] = s1 ^ this.s[2]!
		this.s[0] = s0 ^ this.s[3]!
		this.s[2] = this.s[2]! ^ t
		this.s[3] = rotl(this.s[3]!, 11)

		return result
	}

	/** Returns a float in [0, 1). */
	nextFloat(): number {
		return this.next() / 0x100000000
	}

	/** Returns an integer in [0, max). */
	nextInt(max: number): number {
		return (this.nextFloat() * max) | 0
	}
}

function rotl(x: number, k: number): number {
	return ((x << k) | (x >>> (32 - k))) >>> 0
}
