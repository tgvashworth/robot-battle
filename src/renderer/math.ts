/**
 * Math utilities for the renderer.
 * All angle functions work in degrees (0-360, clockwise).
 */

/** Linear interpolation from a to b by factor t. */
export function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t
}

/** Normalize an angle to the range [0, 360). */
export function normalizeAngle(deg: number): number {
	const result = ((deg % 360) + 360) % 360
	// Avoid returning -0
	return result === 0 ? 0 : result
}

/**
 * Interpolate between two angles in degrees, taking the shortest path
 * through the wraparound at 0/360.
 */
export function lerpAngle(a: number, b: number, t: number): number {
	const na = normalizeAngle(a)
	const nb = normalizeAngle(b)
	let diff = nb - na
	if (diff > 180) {
		diff -= 360
	} else if (diff < -180) {
		diff += 360
	}
	return normalizeAngle(na + diff * t)
}

/** Clamp x to the range [lo, hi]. */
export function clamp(x: number, lo: number, hi: number): number {
	if (x < lo) return lo
	if (x > hi) return hi
	return x
}
