import { describe, expect, it } from "vitest"
import type { RobotAPI } from "../../../spec/simulation"
import { createDebugLog } from "../debug-log"
import { compile, instantiate } from "../instantiate"

const R = `robot "Test"\n`

function compileWasm(source: string): Uint8Array {
	const result = compile(source)
	if (!result.success || !result.wasm) {
		const msgs = result.errors.errors.map((e) => `${e.line}:${e.column} ${e.message}`).join("\n")
		throw new Error(`Compile errors:\n${msgs}`)
	}
	return result.wasm
}

function createMockApi(getTick: () => number): RobotAPI {
	return {
		setSpeed: () => {},
		setTurnRate: () => {},
		setHeading: () => {},
		getX: () => 100,
		getY: () => 100,
		getHeading: () => 0,
		getSpeed: () => 0,
		setGunTurnRate: () => {},
		setGunHeading: () => {},
		getGunHeading: () => 0,
		getGunHeat: () => 0,
		fire: () => {},
		getEnergy: () => 100,
		setRadarTurnRate: () => {},
		setRadarHeading: () => {},
		getRadarHeading: () => 0,
		setScanWidth: () => {},
		getHealth: () => 100,
		getTick,
		arenaWidth: () => 800,
		arenaHeight: () => 600,
		robotCount: () => 2,
		nearestMineDist: () => -1,
		nearestMineBearing: () => 0,
		nearestCookieDist: () => -1,
		nearestCookieBearing: () => 0,
		distanceTo: () => 0,
		bearingTo: () => 0,
		random: () => 0,
		randomFloat: () => 0,
		debugInt: () => {},
		debugFloat: () => {},
		debugAngle: () => {},
		setColor: () => {},
		setGunColor: () => {},
		setRadarColor: () => {},
		sin: Math.sin,
		cos: Math.cos,
		tan: Math.tan,
		atan2: Math.atan2,
		sqrt: Math.sqrt,
		abs: Math.abs,
		min: Math.min,
		max: Math.max,
		clamp: (x, lo, hi) => Math.min(Math.max(x, lo), hi),
		floor: Math.floor,
		ceil: Math.ceil,
		round: Math.round,
	}
}

describe("createDebugLog", () => {
	it("starts with no messages", () => {
		const log = createDebugLog(() => 0)
		expect(log.getMessages()).toHaveLength(0)
	})

	it("records trap messages with tick", () => {
		let tick = 5
		const log = createDebugLog(() => tick)

		log.trap("tick", new Error("unreachable"))
		tick = 10
		log.trap("on_scan", "stack overflow")

		const messages = log.getMessages()
		expect(messages).toHaveLength(2)

		const first = messages[0]!
		expect(first.type).toBe("trap")
		if (first.type === "trap") {
			expect(first.tick).toBe(5)
			expect(first.functionName).toBe("tick")
			expect(first.error).toBe("unreachable")
		}

		const second = messages[1]!
		expect(second.type).toBe("trap")
		if (second.type === "trap") {
			expect(second.tick).toBe(10)
			expect(second.functionName).toBe("on_scan")
			expect(second.error).toBe("stack overflow")
		}
	})

	it("records debug int messages", () => {
		const log = createDebugLog(() => 3)
		log.debug("int", 42)

		const messages = log.getMessages()
		expect(messages).toHaveLength(1)

		const msg = messages[0]!
		expect(msg.type).toBe("debug_int")
		if (msg.type === "debug_int") {
			expect(msg.tick).toBe(3)
			expect(msg.value).toBe(42)
		}
	})

	it("records debug float messages", () => {
		const log = createDebugLog(() => 7)
		log.debug("float", 3.14)

		const messages = log.getMessages()
		expect(messages).toHaveLength(1)

		const msg = messages[0]!
		expect(msg.type).toBe("debug_float")
		if (msg.type === "debug_float") {
			expect(msg.tick).toBe(7)
			expect(msg.value).toBeCloseTo(3.14)
		}
	})

	it("records api call messages", () => {
		const log = createDebugLog(() => 1)
		log.apiCall("setSpeed", [5.0])
		log.apiCall("getX", [], 100)

		const messages = log.getMessages()
		expect(messages).toHaveLength(2)

		const first = messages[0]!
		expect(first.type).toBe("api_call")
		if (first.type === "api_call") {
			expect(first.tick).toBe(1)
			expect(first.name).toBe("setSpeed")
			expect(first.args).toEqual([5.0])
			expect(first.result).toBeUndefined()
		}

		const second = messages[1]!
		expect(second.type).toBe("api_call")
		if (second.type === "api_call") {
			expect(second.name).toBe("getX")
			expect(second.args).toEqual([])
			expect(second.result).toBe(100)
		}
	})

	it("preserves message order across types", () => {
		let tick = 0
		const log = createDebugLog(() => tick)

		log.debug("int", 1)
		tick = 1
		log.apiCall("fire", [3.0])
		tick = 2
		log.trap("tick", new Error("oops"))

		const messages = log.getMessages()
		expect(messages).toHaveLength(3)
		expect(messages[0]!.type).toBe("debug_int")
		expect(messages[1]!.type).toBe("api_call")
		expect(messages[2]!.type).toBe("trap")
		expect(messages[0]!.tick).toBe(0)
		expect(messages[1]!.tick).toBe(1)
		expect(messages[2]!.tick).toBe(2)
	})

	it("does not mutate args array after recording", () => {
		const log = createDebugLog(() => 0)
		const args = [1, 2, 3]
		log.apiCall("distanceTo", args)
		args.push(4)

		const messages = log.getMessages()
		const msg = messages[0]!
		if (msg.type === "api_call") {
			expect(msg.args).toEqual([1, 2, 3])
		}
	})
})

describe("debug log integration with instantiate", () => {
	it("captures debugInt calls from WASM", async () => {
		const source = `${R}func tick() {\n  debug(42)\n}`
		const wasm = compileWasm(source)

		let tick = 0
		const debugLog = createDebugLog(() => tick)
		const module = await instantiate(wasm, debugLog)

		const api = createMockApi(() => tick)
		module.init(api)

		tick = 1
		module.tick()

		const messages = debugLog.getMessages()
		const debugMessages = messages.filter((m) => m.type === "debug_int")
		expect(debugMessages).toHaveLength(1)
		expect(debugMessages[0]!.tick).toBe(1)
		if (debugMessages[0]!.type === "debug_int") {
			expect(debugMessages[0]!.value).toBe(42)
		}

		module.destroy()
	})

	it("captures debugFloat calls from WASM", async () => {
		const source = `${R}func tick() {\n  debug(3.14)\n}`
		const wasm = compileWasm(source)

		let tick = 0
		const debugLog = createDebugLog(() => tick)
		const module = await instantiate(wasm, debugLog)

		const api = createMockApi(() => tick)
		module.init(api)

		tick = 5
		module.tick()

		const messages = debugLog.getMessages()
		const debugMessages = messages.filter((m) => m.type === "debug_float")
		expect(debugMessages).toHaveLength(1)
		expect(debugMessages[0]!.tick).toBe(5)
		if (debugMessages[0]!.type === "debug_float") {
			expect(debugMessages[0]!.value).toBeCloseTo(3.14)
		}

		module.destroy()
	})

	it("captures multiple debug calls across ticks", async () => {
		const source = `${R}
var counter int
func tick() {
  counter = counter + 1
  debug(counter)
}`
		const wasm = compileWasm(source)

		let tick = 0
		const debugLog = createDebugLog(() => tick)
		const module = await instantiate(wasm, debugLog)

		const api = createMockApi(() => tick)
		module.init(api)

		tick = 1
		module.tick()
		tick = 2
		module.tick()
		tick = 3
		module.tick()

		const messages = debugLog.getMessages()
		const debugMessages = messages.filter((m) => m.type === "debug_int")
		expect(debugMessages).toHaveLength(3)
		expect(debugMessages[0]!.tick).toBe(1)
		expect(debugMessages[1]!.tick).toBe(2)
		expect(debugMessages[2]!.tick).toBe(3)

		if (debugMessages[0]!.type === "debug_int") {
			expect(debugMessages[0]!.value).toBe(1)
		}
		if (debugMessages[1]!.type === "debug_int") {
			expect(debugMessages[1]!.value).toBe(2)
		}
		if (debugMessages[2]!.type === "debug_int") {
			expect(debugMessages[2]!.value).toBe(3)
		}

		module.destroy()
	})

	it("works without debug log (opt-in behavior)", async () => {
		const source = `${R}func tick() {\n  debug(42)\n}`
		const wasm = compileWasm(source)

		// No debug log passed — should work exactly as before
		const module = await instantiate(wasm)

		let tick = 0
		const api = createMockApi(() => tick)
		module.init(api)

		tick = 1
		expect(() => module.tick()).not.toThrow()

		module.destroy()
	})

	it("captures WASM traps in the debug log", async () => {
		// Create a robot that will trigger a WASM trap via integer division by zero
		// We use unreachable-inducing code: divide by zero causes a trap in WASM
		const source = `${R}
func tick() {
  x := 1
  y := 0
  debug(x / y)
}`
		const wasm = compileWasm(source)

		let tick = 0
		const debugLog = createDebugLog(() => tick)
		const module = await instantiate(wasm, debugLog)

		const api = createMockApi(() => tick)
		module.init(api)

		tick = 3
		// This should not throw — callExport catches the trap
		module.tick()

		const messages = debugLog.getMessages()
		const trapMessages = messages.filter((m) => m.type === "trap")
		expect(trapMessages).toHaveLength(1)
		expect(trapMessages[0]!.tick).toBe(3)
		if (trapMessages[0]!.type === "trap") {
			expect(trapMessages[0]!.functionName).toBe("tick")
		}

		module.destroy()
	})
})
