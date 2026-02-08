import { describe, expect, it } from "vitest"
import { analyze } from "../analyzer"
import type { AnalysisResult } from "../analyzer"
import type { Program } from "../ast"
import { codegen } from "../codegen"
import { Lexer } from "../lexer"
import { parse } from "../parser"

const R = `robot "Test"\n`

function compile(source: string): { program: Program; analysis: AnalysisResult; wasm: Uint8Array } {
	const tokens = new Lexer(source).tokenize()
	const { program, errors: parseErrors } = parse(tokens)
	if (parseErrors.hasErrors()) {
		const msgs = parseErrors.errors.map((e) => `${e.line}:${e.column} ${e.message}`).join("\n")
		throw new Error(`Parse errors:\n${msgs}`)
	}
	const analysis = analyze(program)
	if (analysis.errors.hasErrors()) {
		const msgs = analysis.errors.errors.map((e) => `${e.line}:${e.column} ${e.message}`).join("\n")
		throw new Error(`Analysis errors:\n${msgs}`)
	}
	const wasm = codegen(program, analysis)
	return { program, analysis, wasm }
}

function mockImports(): {
	imports: WebAssembly.Imports
	calls: { name: string; args: unknown[] }[]
} {
	const calls: { name: string; args: unknown[] }[] = []
	const env: Record<string, (...args: number[]) => number> = {}

	const apiNames = [
		"setSpeed",
		"setTurnRate",
		"setHeading",
		"getX",
		"getY",
		"getHeading",
		"getSpeed",
		"setGunTurnRate",
		"setGunHeading",
		"getGunHeading",
		"getGunHeat",
		"fire",
		"getEnergy",
		"setRadarTurnRate",
		"setRadarHeading",
		"getRadarHeading",
		"setScanWidth",
		"getHealth",
		"getTick",
		"arenaWidth",
		"arenaHeight",
		"robotCount",
		"distanceTo",
		"bearingTo",
		"random",
		"randomFloat",
		"debugInt",
		"debugFloat",
		"setColor",
		"setGunColor",
		"setRadarColor",
		"sin",
		"cos",
		"tan",
		"atan2",
		"sqrt",
		"abs",
		"min",
		"max",
		"clamp",
		"floor",
		"ceil",
		"round",
	]

	for (const name of apiNames) {
		env[name] = (...args: number[]) => {
			calls.push({ name, args: [...args] })
			return 0
		}
	}

	return { imports: { env }, calls }
}

async function instantiate(wasm: Uint8Array): Promise<{
	instance: WebAssembly.Instance
	calls: { name: string; args: unknown[] }[]
}> {
	const { imports, calls } = mockImports()
	const module = await WebAssembly.compile(wasm as BufferSource)
	const instance = await WebAssembly.instantiate(module, imports)
	return { instance, calls }
}

describe("codegen", () => {
	describe("minimal robot", () => {
		it("produces valid WASM binary header", () => {
			const { wasm } = compile(`${R}func tick() {}`)
			expect(wasm).toBeInstanceOf(Uint8Array)
			expect(wasm[0]).toBe(0x00)
			expect(wasm[1]).toBe(0x61)
			expect(wasm[2]).toBe(0x73)
			expect(wasm[3]).toBe(0x6d)
		})

		it("can be compiled by WebAssembly.compile", async () => {
			const { wasm } = compile(`${R}func tick() {}`)
			const module = await WebAssembly.compile(wasm as BufferSource)
			expect(module).toBeInstanceOf(WebAssembly.Module)
		})

		it("can be instantiated with mock imports", async () => {
			const { wasm } = compile(`${R}func tick() {}`)
			const { instance } = await instantiate(wasm)
			expect(instance).toBeInstanceOf(WebAssembly.Instance)
		})

		it("exports tick function and memory", async () => {
			const { wasm } = compile(`${R}func tick() {}`)
			const { instance } = await instantiate(wasm)
			expect(typeof instance.exports.tick).toBe("function")
			expect(instance.exports.memory).toBeInstanceOf(WebAssembly.Memory)
		})

		it("calling tick runs without error", async () => {
			const { wasm } = compile(`${R}func tick() {}`)
			const { instance } = await instantiate(wasm)
			const tick = instance.exports.tick as () => void
			expect(() => tick()).not.toThrow()
		})
	})

	describe("API calls", () => {
		it("calls setSpeed with a float argument", async () => {
			const { wasm } = compile(`${R}func tick() {\n  setSpeed(5.0)\n}`)
			const { instance, calls } = await instantiate(wasm)
			const tick = instance.exports.tick as () => void
			tick()
			const setSpeedCalls = calls.filter((c) => c.name === "setSpeed")
			expect(setSpeedCalls.length).toBe(1)
			expect(setSpeedCalls[0]!.args[0]).toBeCloseTo(5.0)
		})

		it("calls fire with a float argument", async () => {
			const { wasm } = compile(`${R}func tick() {\n  fire(3.0)\n}`)
			const { instance, calls } = await instantiate(wasm)
			const tick = instance.exports.tick as () => void
			tick()
			const fireCalls = calls.filter((c) => c.name === "fire")
			expect(fireCalls.length).toBe(1)
			expect(fireCalls[0]!.args[0]).toBeCloseTo(3.0)
		})

		it("calls multiple API functions in order", async () => {
			const source = `${R}func tick() {\n  setSpeed(8.0)\n  fire(1.0)\n  setTurnRate(2.0)\n}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const tick = instance.exports.tick as () => void
			tick()
			expect(calls.length).toBe(3)
			expect(calls[0]!.name).toBe("setSpeed")
			expect(calls[1]!.name).toBe("fire")
			expect(calls[2]!.name).toBe("setTurnRate")
		})
	})

	describe("global variables", () => {
		it("stores and loads global int", async () => {
			const source = `${R}
var counter int
func tick() {
  counter = 42
  debugInt(counter)
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const tick = instance.exports.tick as () => void
			tick()
			const debugCalls = calls.filter((c) => c.name === "debugInt")
			expect(debugCalls.length).toBe(1)
			expect(debugCalls[0]!.args[0]).toBe(42)
		})

		it("stores and loads global float", async () => {
			const source = `${R}
var speed float
func tick() {
  speed = 3.14
  debugFloat(speed)
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const tick = instance.exports.tick as () => void
			tick()
			const debugCalls = calls.filter((c) => c.name === "debugFloat")
			expect(debugCalls.length).toBe(1)
			expect(debugCalls[0]!.args[0]).toBeCloseTo(3.14)
		})

		it("persists global values across tick calls", async () => {
			const source = `${R}
var counter int
func tick() {
  counter = counter + 1
  debugInt(counter)
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const tick = instance.exports.tick as () => void
			tick()
			tick()
			tick()
			const debugCalls = calls.filter((c) => c.name === "debugInt")
			expect(debugCalls.length).toBe(3)
			expect(debugCalls[0]!.args[0]).toBe(1)
			expect(debugCalls[1]!.args[0]).toBe(2)
			expect(debugCalls[2]!.args[0]).toBe(3)
		})
	})

	describe("local variables", () => {
		it("declares and uses local int via short decl", async () => {
			const source = `${R}func tick() {\n  x := 10\n  debugInt(x)\n}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const tick = instance.exports.tick as () => void
			tick()
			const debugCalls = calls.filter((c) => c.name === "debugInt")
			expect(debugCalls.length).toBe(1)
			expect(debugCalls[0]!.args[0]).toBe(10)
		})

		it("declares and uses local float via var stmt", async () => {
			const source = `${R}func tick() {\n  var x float = 2.5\n  debugFloat(x)\n}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const tick = instance.exports.tick as () => void
			tick()
			const debugCalls = calls.filter((c) => c.name === "debugFloat")
			expect(debugCalls.length).toBe(1)
			expect(debugCalls[0]!.args[0]).toBeCloseTo(2.5)
		})
	})

	describe("arithmetic", () => {
		it("computes integer addition", async () => {
			const source = `${R}func tick() {\n  x := 10 + 5\n  debugInt(x)\n}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const tick = instance.exports.tick as () => void
			tick()
			const debugCalls = calls.filter((c) => c.name === "debugInt")
			expect(debugCalls[0]!.args[0]).toBe(15)
		})

		it("computes float arithmetic", async () => {
			const source = `${R}func tick() {\n  x := 1.5 + 2.5\n  debugFloat(x)\n}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const tick = instance.exports.tick as () => void
			tick()
			const debugCalls = calls.filter((c) => c.name === "debugFloat")
			expect(debugCalls[0]!.args[0]).toBeCloseTo(4.0)
		})

		it("handles compound assignment +=", async () => {
			const source = `${R}func tick() {\n  x := 10\n  x += 5\n  debugInt(x)\n}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const tick = instance.exports.tick as () => void
			tick()
			const debugCalls = calls.filter((c) => c.name === "debugInt")
			expect(debugCalls[0]!.args[0]).toBe(15)
		})
	})

	describe("control flow", () => {
		it("if-true branch executes", async () => {
			const source = `${R}func tick() {\n  if true {\n    debugInt(1)\n  }\n}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const tick = instance.exports.tick as () => void
			tick()
			expect(calls.filter((c) => c.name === "debugInt").length).toBe(1)
		})

		it("if-false branch does not execute", async () => {
			const source = `${R}func tick() {\n  if false {\n    debugInt(1)\n  }\n}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const tick = instance.exports.tick as () => void
			tick()
			expect(calls.filter((c) => c.name === "debugInt").length).toBe(0)
		})

		it("if-else works correctly", async () => {
			const source = `${R}func tick() {
  x := 5
  if x > 3 {
    debugInt(1)
  } else {
    debugInt(0)
  }
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const tick = instance.exports.tick as () => void
			tick()
			const debugCalls = calls.filter((c) => c.name === "debugInt")
			expect(debugCalls.length).toBe(1)
			expect(debugCalls[0]!.args[0]).toBe(1)
		})

		it("for loop executes correct number of times", async () => {
			const source = `${R}func tick() {
  for i := 0; i < 5; i += 1 {
    debugInt(i)
  }
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const tick = instance.exports.tick as () => void
			tick()
			const debugCalls = calls.filter((c) => c.name === "debugInt")
			expect(debugCalls.length).toBe(5)
			expect(debugCalls[0]!.args[0]).toBe(0)
			expect(debugCalls[4]!.args[0]).toBe(4)
		})

		it("break exits the loop", async () => {
			const source = `${R}func tick() {
  for i := 0; i < 10; i += 1 {
    if i == 3 {
      break
    }
    debugInt(i)
  }
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const tick = instance.exports.tick as () => void
			tick()
			const debugCalls = calls.filter((c) => c.name === "debugInt")
			expect(debugCalls.length).toBe(3)
		})

		it("continue skips to next iteration", async () => {
			const source = `${R}func tick() {
  for i := 0; i < 5; i += 1 {
    if i == 2 {
      continue
    }
    debugInt(i)
  }
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const tick = instance.exports.tick as () => void
			tick()
			const debugCalls = calls.filter((c) => c.name === "debugInt")
			expect(debugCalls.length).toBe(4)
			expect(debugCalls[0]!.args[0]).toBe(0)
			expect(debugCalls[1]!.args[0]).toBe(1)
			expect(debugCalls[2]!.args[0]).toBe(3)
			expect(debugCalls[3]!.args[0]).toBe(4)
		})
	})

	describe("type conversions", () => {
		it("int to float conversion", async () => {
			const source = `${R}func tick() {\n  x := 42\n  y := float(x)\n  debugFloat(y)\n}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const tick = instance.exports.tick as () => void
			tick()
			const debugCalls = calls.filter((c) => c.name === "debugFloat")
			expect(debugCalls[0]!.args[0]).toBeCloseTo(42.0)
		})

		it("float to int conversion (truncation)", async () => {
			const source = `${R}func tick() {\n  x := 3.7\n  y := int(x)\n  debugInt(y)\n}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const tick = instance.exports.tick as () => void
			tick()
			const debugCalls = calls.filter((c) => c.name === "debugInt")
			expect(debugCalls[0]!.args[0]).toBe(3)
		})
	})

	describe("user functions", () => {
		it("calls a user-defined function", async () => {
			const source = `${R}
func helper() {
  debugInt(99)
}
func tick() {
  helper()
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const tick = instance.exports.tick as () => void
			tick()
			const debugCalls = calls.filter((c) => c.name === "debugInt")
			expect(debugCalls.length).toBe(1)
			expect(debugCalls[0]!.args[0]).toBe(99)
		})

		it("passes parameters and returns a value", async () => {
			const source = `${R}
func add(a int, b int) int {
  return a + b
}
func tick() {
  result := add(3, 4)
  debugInt(result)
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const tick = instance.exports.tick as () => void
			tick()
			const debugCalls = calls.filter((c) => c.name === "debugInt")
			expect(debugCalls[0]!.args[0]).toBe(7)
		})
	})

	describe("events", () => {
		it("exports event handler on_scan", async () => {
			const source = `${R}
func tick() {}
on scan(distance float, bearing angle) {
  fire(1.0)
}`
			const { wasm } = compile(source)
			const { instance } = await instantiate(wasm)
			expect(typeof instance.exports.on_scan).toBe("function")
		})

		it("event handler receives parameters", async () => {
			const source = `${R}
func tick() {}
on scan(distance float, bearing angle) {
  debugFloat(distance)
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const onScan = instance.exports.on_scan as (distance: number, bearing: number) => void
			onScan(100.5, 45.0)
			const debugCalls = calls.filter((c) => c.name === "debugFloat")
			expect(debugCalls.length).toBe(1)
			expect(debugCalls[0]!.args[0]).toBeCloseTo(100.5)
		})
	})

	describe("constants", () => {
		it("uses compile-time constants", async () => {
			const source = `${R}
const MAX_SPEED = 8
func tick() {
  debugInt(MAX_SPEED)
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const tick = instance.exports.tick as () => void
			tick()
			const debugCalls = calls.filter((c) => c.name === "debugInt")
			expect(debugCalls[0]!.args[0]).toBe(8)
		})
	})

	describe("boolean operations", () => {
		it("short-circuit AND (false && true = false)", async () => {
			const source = `${R}func tick() {
  if false && true {
    debugInt(1)
  } else {
    debugInt(0)
  }
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const tick = instance.exports.tick as () => void
			tick()
			const debugCalls = calls.filter((c) => c.name === "debugInt")
			expect(debugCalls[0]!.args[0]).toBe(0)
		})

		it("short-circuit OR (true || false = true)", async () => {
			const source = `${R}func tick() {
  if true || false {
    debugInt(1)
  } else {
    debugInt(0)
  }
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const tick = instance.exports.tick as () => void
			tick()
			const debugCalls = calls.filter((c) => c.name === "debugInt")
			expect(debugCalls[0]!.args[0]).toBe(1)
		})

		it("boolean not", async () => {
			const source = `${R}func tick() {
  x := !true
  if x {
    debugInt(1)
  } else {
    debugInt(0)
  }
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const tick = instance.exports.tick as () => void
			tick()
			const debugCalls = calls.filter((c) => c.name === "debugInt")
			expect(debugCalls[0]!.args[0]).toBe(0)
		})
	})

	describe("struct field access", () => {
		it("reads and writes struct fields in global memory", async () => {
			const source = `${R}
type Point struct {
  x float
  y float
}
var pos Point
func tick() {
  pos.x = 10.0
  pos.y = 20.0
  debugFloat(pos.x)
  debugFloat(pos.y)
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const tick = instance.exports.tick as () => void
			tick()
			const debugCalls = calls.filter((c) => c.name === "debugFloat")
			expect(debugCalls.length).toBe(2)
			expect(debugCalls[0]!.args[0]).toBeCloseTo(10.0)
			expect(debugCalls[1]!.args[0]).toBeCloseTo(20.0)
		})
	})

	describe("unary negation", () => {
		it("negates a float", async () => {
			const source = `${R}func tick() {\n  x := -5.0\n  debugFloat(x)\n}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const tick = instance.exports.tick as () => void
			tick()
			const debugCalls = calls.filter((c) => c.name === "debugFloat")
			expect(debugCalls[0]!.args[0]).toBeCloseTo(-5.0)
		})
	})

	describe("init function", () => {
		it("exports init when defined", async () => {
			const source = `${R}
func init() {
  setSpeed(5.0)
}
func tick() {}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			expect(typeof instance.exports.init).toBe("function")
			const init = instance.exports.init as () => void
			init()
			expect(calls.filter((c) => c.name === "setSpeed").length).toBe(1)
		})
	})

	describe("global variable initializers", () => {
		it("initializes global int to non-zero value", async () => {
			const source = `${R}
var counter int = 42
func tick() {
  debugInt(counter)
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			// init() should be synthetically created to set counter = 42
			const init = instance.exports.init as () => void
			expect(typeof init).toBe("function")
			init()
			const tick = instance.exports.tick as () => void
			tick()
			const debugCalls = calls.filter((c) => c.name === "debugInt")
			expect(debugCalls.length).toBe(1)
			expect(debugCalls[0]!.args[0]).toBe(42)
		})

		it("initializes global float to non-zero value", async () => {
			const source = `${R}
var speed float = 3.14
func tick() {
  debugFloat(speed)
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const init = instance.exports.init as () => void
			init()
			const tick = instance.exports.tick as () => void
			tick()
			const debugCalls = calls.filter((c) => c.name === "debugFloat")
			expect(debugCalls.length).toBe(1)
			expect(debugCalls[0]!.args[0]).toBeCloseTo(3.14)
		})

		it("initializes multiple globals with different types", async () => {
			const source = `${R}
var count int = 10
var rate float = 2.5
var flag bool = true
func tick() {
  debugInt(count)
  debugFloat(rate)
  if flag {
    debugInt(1)
  } else {
    debugInt(0)
  }
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const init = instance.exports.init as () => void
			init()
			const tick = instance.exports.tick as () => void
			tick()
			const debugIntCalls = calls.filter((c) => c.name === "debugInt")
			const debugFloatCalls = calls.filter((c) => c.name === "debugFloat")
			expect(debugIntCalls.length).toBe(2)
			expect(debugIntCalls[0]!.args[0]).toBe(10)
			expect(debugIntCalls[1]!.args[0]).toBe(1) // flag is true
			expect(debugFloatCalls.length).toBe(1)
			expect(debugFloatCalls[0]!.args[0]).toBeCloseTo(2.5)
		})

		it("initializes global with expression initializer", async () => {
			const source = `${R}
var result float = 2.0 * 3.0
func tick() {
  debugFloat(result)
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const init = instance.exports.init as () => void
			init()
			const tick = instance.exports.tick as () => void
			tick()
			const debugCalls = calls.filter((c) => c.name === "debugFloat")
			expect(debugCalls.length).toBe(1)
			expect(debugCalls[0]!.args[0]).toBeCloseTo(6.0)
		})

		it("global defaulting to zero still works", async () => {
			const source = `${R}
var counter int
func tick() {
  debugInt(counter)
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const tick = instance.exports.tick as () => void
			tick()
			const debugCalls = calls.filter((c) => c.name === "debugInt")
			expect(debugCalls.length).toBe(1)
			expect(debugCalls[0]!.args[0]).toBe(0)
		})

		it("prepends global init to user-defined init function", async () => {
			const source = `${R}
var speed float = 5.0
func init() {
  setSpeed(speed)
}
func tick() {
  debugFloat(speed)
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const init = instance.exports.init as () => void
			init()
			// speed should be 5.0 when setSpeed is called from init
			const setSpeedCalls = calls.filter((c) => c.name === "setSpeed")
			expect(setSpeedCalls.length).toBe(1)
			expect(setSpeedCalls[0]!.args[0]).toBeCloseTo(5.0)
			// Also verify via tick
			const tick = instance.exports.tick as () => void
			tick()
			const debugCalls = calls.filter((c) => c.name === "debugFloat")
			expect(debugCalls.length).toBe(1)
			expect(debugCalls[0]!.args[0]).toBeCloseTo(5.0)
		})
	})

	describe("debug overload", () => {
		it("routes debug(int) to debugInt", async () => {
			const source = `${R}func tick() {\n  debug(42)\n}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const tick = instance.exports.tick as () => void
			tick()
			expect(calls.filter((c) => c.name === "debugInt").length).toBe(1)
		})

		it("routes debug(float) to debugFloat", async () => {
			const source = `${R}func tick() {\n  debug(3.14)\n}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const tick = instance.exports.tick as () => void
			tick()
			expect(calls.filter((c) => c.name === "debugFloat").length).toBe(1)
		})
	})
})
