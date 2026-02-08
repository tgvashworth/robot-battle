/**
 * Debug log collector for robot diagnostics.
 *
 * Collects WASM traps, debugInt/debugFloat calls, and API call traces
 * during battle simulation. Designed to be attached per-robot and
 * is entirely opt-in.
 */

export type DebugMessageType = "trap" | "debug_int" | "debug_float" | "api_call"

export interface TrapMessage {
	readonly type: "trap"
	readonly tick: number
	readonly functionName: string
	readonly error: string
}

export interface DebugIntMessage {
	readonly type: "debug_int"
	readonly tick: number
	readonly value: number
}

export interface DebugFloatMessage {
	readonly type: "debug_float"
	readonly tick: number
	readonly value: number
}

export interface ApiCallMessage {
	readonly type: "api_call"
	readonly tick: number
	readonly name: string
	readonly args: readonly number[]
	readonly result?: number
}

export type DebugMessage = TrapMessage | DebugIntMessage | DebugFloatMessage | ApiCallMessage

export interface RobotDebugLog {
	trap(functionName: string, error: unknown): void
	debug(type: "int" | "float", value: number): void
	apiCall(name: string, args: number[], result?: number): void
	getMessages(): readonly DebugMessage[]
}

/**
 * Create a new debug log collector.
 *
 * @param getTick - function that returns the current tick number
 */
export function createDebugLog(getTick: () => number): RobotDebugLog {
	const messages: DebugMessage[] = []

	return {
		trap(functionName: string, error: unknown) {
			const errorString = error instanceof Error ? error.message : String(error)
			messages.push({
				type: "trap",
				tick: getTick(),
				functionName,
				error: errorString,
			})
		},

		debug(debugType: "int" | "float", value: number) {
			messages.push({
				type: debugType === "int" ? "debug_int" : "debug_float",
				tick: getTick(),
				value,
			})
		},

		apiCall(name: string, args: number[], result?: number) {
			messages.push({
				type: "api_call",
				tick: getTick(),
				name,
				args: [...args],
				result,
			})
		},

		getMessages(): readonly DebugMessage[] {
			return messages
		},
	}
}
