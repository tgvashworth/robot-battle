import type { TickSource } from "../../spec/renderer"
import type { GameState } from "../../spec/simulation"

/**
 * Create a TickSource that plays back a recorded sequence of GameState frames.
 */
export function createReplaySource(frames: GameState[]): TickSource {
	let position = 0

	return {
		tick(): GameState {
			const frame = frames[position]!
			position++
			return frame
		},

		hasNext(): boolean {
			return position < frames.length
		},

		currentTick(): number {
			return position
		},

		totalTicks(): number {
			return frames.length
		},
	}
}
