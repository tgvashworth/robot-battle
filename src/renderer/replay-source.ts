import type { TickSource } from "../../spec/renderer"
import type { GameState } from "../../spec/simulation"

/**
 * A TickSource extended with seek capability for replay playback.
 */
export interface ReplayTickSource extends TickSource {
	/** Seek to a specific tick position. The next tick() call will return that frame. */
	seekTo(tick: number): void
	/** Get the frame at a specific tick without advancing position. */
	frameAt(tick: number): GameState | undefined
}

/**
 * Create a TickSource that plays back a recorded sequence of GameState frames.
 */
export function createReplaySource(frames: GameState[]): ReplayTickSource {
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

		seekTo(tick: number): void {
			position = Math.max(0, Math.min(tick, frames.length))
		},

		frameAt(tick: number): GameState | undefined {
			return frames[tick]
		},
	}
}
