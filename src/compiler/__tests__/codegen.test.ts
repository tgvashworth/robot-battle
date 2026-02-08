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

		it("on scan handler uses distance parameter via debug()", async () => {
			const source = `${R}
func tick() {}
on scan(distance float, bearing angle) {
  debug(distance)
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const onScan = instance.exports.on_scan as (distance: number, bearing: number) => void
			onScan(150.0, 45.0)
			const debugCalls = calls.filter((c) => c.name === "debugFloat")
			expect(debugCalls.length).toBe(1)
			expect(debugCalls[0]!.args[0]).toBeCloseTo(150.0)
		})

		it("on scan handler uses bearing parameter", async () => {
			const source = `${R}
func tick() {}
on scan(distance float, bearing angle) {
  debug(bearing)
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const onScan = instance.exports.on_scan as (distance: number, bearing: number) => void
			onScan(150.0, 45.0)
			const debugCalls = calls.filter((c) => c.name === "debugFloat")
			expect(debugCalls.length).toBe(1)
			expect(debugCalls[0]!.args[0]).toBeCloseTo(45.0)
		})

		it("on hit handler uses damage parameter", async () => {
			const source = `${R}
func tick() {}
on hit(damage float, bearing angle) {
  debug(damage)
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const onHit = instance.exports.on_hit as (damage: number, bearing: number) => void
			onHit(25.0, 180.0)
			const debugCalls = calls.filter((c) => c.name === "debugFloat")
			expect(debugCalls.length).toBe(1)
			expect(debugCalls[0]!.args[0]).toBeCloseTo(25.0)
		})

		it("on hit handler uses bearing parameter", async () => {
			const source = `${R}
func tick() {}
on hit(damage float, bearing angle) {
  debug(bearing)
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const onHit = instance.exports.on_hit as (damage: number, bearing: number) => void
			onHit(25.0, 180.0)
			const debugCalls = calls.filter((c) => c.name === "debugFloat")
			expect(debugCalls.length).toBe(1)
			expect(debugCalls[0]!.args[0]).toBeCloseTo(180.0)
		})

		it("on wallHit handler uses bearing parameter", async () => {
			const source = `${R}
func tick() {}
on wallHit(bearing angle) {
  debug(bearing)
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const onWallHit = instance.exports.on_wallHit as (bearing: number) => void
			onWallHit(90.0)
			const debugCalls = calls.filter((c) => c.name === "debugFloat")
			expect(debugCalls.length).toBe(1)
			expect(debugCalls[0]!.args[0]).toBeCloseTo(90.0)
		})

		it("on bulletMiss handler with no params", async () => {
			const source = `${R}
func tick() {}
on bulletMiss() {
  debug(1)
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const onBulletMiss = instance.exports.on_bulletMiss as () => void
			onBulletMiss()
			const debugCalls = calls.filter((c) => c.name === "debugInt")
			expect(debugCalls.length).toBe(1)
			expect(debugCalls[0]!.args[0]).toBe(1)
		})

		it("on bulletHit handler uses targetId parameter", async () => {
			const source = `${R}
func tick() {}
on bulletHit(targetId int) {
  debug(targetId)
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const onBulletHit = instance.exports.on_bulletHit as (targetId: number) => void
			onBulletHit(7)
			const debugCalls = calls.filter((c) => c.name === "debugInt")
			expect(debugCalls.length).toBe(1)
			expect(debugCalls[0]!.args[0]).toBe(7)
		})

		it("on scanned handler uses bearing parameter", async () => {
			const source = `${R}
func tick() {}
on scanned(bearing angle) {
  debug(bearing)
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const onScanned = instance.exports.on_scanned as (bearing: number) => void
			onScanned(270.0)
			const debugCalls = calls.filter((c) => c.name === "debugFloat")
			expect(debugCalls.length).toBe(1)
			expect(debugCalls[0]!.args[0]).toBeCloseTo(270.0)
		})

		it("on robotDeath handler uses robotId parameter", async () => {
			const source = `${R}
func tick() {}
on robotDeath(robotId int) {
  debug(robotId)
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const onRobotDeath = instance.exports.on_robotDeath as (robotId: number) => void
			onRobotDeath(3)
			const debugCalls = calls.filter((c) => c.name === "debugInt")
			expect(debugCalls.length).toBe(1)
			expect(debugCalls[0]!.args[0]).toBe(3)
		})

		it("on robotHit handler uses bearing parameter", async () => {
			const source = `${R}
func tick() {}
on robotHit(bearing angle) {
  debug(bearing)
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const onRobotHit = instance.exports.on_robotHit as (bearing: number) => void
			onRobotHit(45.0)
			const debugCalls = calls.filter((c) => c.name === "debugFloat")
			expect(debugCalls.length).toBe(1)
			expect(debugCalls[0]!.args[0]).toBeCloseTo(45.0)
		})

		it("event handler modifies global state", async () => {
			const source = `${R}
var hitCount int
on hit(damage float, bearing angle) {
  hitCount = hitCount + 1
}
func tick() {
  debug(hitCount)
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const onHit = instance.exports.on_hit as (damage: number, bearing: number) => void
			const tick = instance.exports.tick as () => void
			onHit(10.0, 0.0)
			onHit(10.0, 0.0)
			tick()
			const debugCalls = calls.filter((c) => c.name === "debugInt")
			expect(debugCalls.length).toBe(1)
			expect(debugCalls[0]!.args[0]).toBe(2)
		})

		it("event handler calls API functions", async () => {
			const source = `${R}
func tick() {}
on scan(distance float, bearing angle) {
  fire(3.0)
  setGunHeading(bearing)
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const onScan = instance.exports.on_scan as (distance: number, bearing: number) => void
			onScan(200.0, 135.0)
			const fireCalls = calls.filter((c) => c.name === "fire")
			expect(fireCalls.length).toBe(1)
			expect(fireCalls[0]!.args[0]).toBeCloseTo(3.0)
			const gunCalls = calls.filter((c) => c.name === "setGunHeading")
			expect(gunCalls.length).toBe(1)
			expect(gunCalls[0]!.args[0]).toBeCloseTo(135.0)
		})

		it("multiple event handlers in same robot", async () => {
			const source = `${R}
var scanCount int
var hitCount int
on scan(distance float, bearing angle) {
  scanCount = scanCount + 1
}
on hit(damage float, bearing angle) {
  hitCount = hitCount + 1
}
func tick() {
  debug(scanCount)
  debug(hitCount)
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const onScan = instance.exports.on_scan as (distance: number, bearing: number) => void
			const onHit = instance.exports.on_hit as (damage: number, bearing: number) => void
			const tick = instance.exports.tick as () => void
			onScan(100.0, 0.0)
			onScan(200.0, 90.0)
			onScan(300.0, 180.0)
			onHit(10.0, 45.0)
			tick()
			const debugCalls = calls.filter((c) => c.name === "debugInt")
			expect(debugCalls.length).toBe(2)
			expect(debugCalls[0]!.args[0]).toBe(3)
			expect(debugCalls[1]!.args[0]).toBe(1)
		})

		it("event handler with local variables", async () => {
			const source = `${R}
func tick() {}
on scan(distance float, bearing angle) {
  half := distance / 2.0
  debug(half)
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const onScan = instance.exports.on_scan as (distance: number, bearing: number) => void
			onScan(200.0, 45.0)
			const debugCalls = calls.filter((c) => c.name === "debugFloat")
			expect(debugCalls.length).toBe(1)
			expect(debugCalls[0]!.args[0]).toBeCloseTo(100.0)
		})

		it("event handler with control flow", async () => {
			const source = `${R}
func tick() {}
on scan(distance float, bearing angle) {
  if distance < 100.0 {
    fire(3.0)
  } else {
    fire(1.0)
  }
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const onScan = instance.exports.on_scan as (distance: number, bearing: number) => void
			onScan(50.0, 0.0)
			const fireCalls1 = calls.filter((c) => c.name === "fire")
			expect(fireCalls1.length).toBe(1)
			expect(fireCalls1[0]!.args[0]).toBeCloseTo(3.0)
			onScan(200.0, 0.0)
			const fireCalls2 = calls.filter((c) => c.name === "fire")
			expect(fireCalls2.length).toBe(2)
			expect(fireCalls2[1]!.args[0]).toBeCloseTo(1.0)
		})

		it("event handler coexists with user functions", async () => {
			const source = `${R}
func helper(x float) float {
  return x * 2.0
}
func tick() {}
on scan(distance float, bearing angle) {
  result := helper(distance)
  debug(result)
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const onScan = instance.exports.on_scan as (distance: number, bearing: number) => void
			onScan(75.0, 0.0)
			const debugCalls = calls.filter((c) => c.name === "debugFloat")
			expect(debugCalls.length).toBe(1)
			expect(debugCalls[0]!.args[0]).toBeCloseTo(150.0)
		})

		it("global state persists across event and tick calls", async () => {
			const source = `${R}
var totalDamage float
on hit(damage float, bearing angle) {
  totalDamage = totalDamage + damage
}
func tick() {
  debug(totalDamage)
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const onHit = instance.exports.on_hit as (damage: number, bearing: number) => void
			const tick = instance.exports.tick as () => void
			onHit(10.0, 0.0)
			tick()
			onHit(15.5, 90.0)
			tick()
			onHit(5.0, 180.0)
			tick()
			const debugCalls = calls.filter((c) => c.name === "debugFloat")
			expect(debugCalls.length).toBe(3)
			expect(debugCalls[0]!.args[0]).toBeCloseTo(10.0)
			expect(debugCalls[1]!.args[0]).toBeCloseTo(25.5)
			expect(debugCalls[2]!.args[0]).toBeCloseTo(30.5)
		})

		it("all event types export correctly in single robot", async () => {
			const source = `${R}
on scan(distance float, bearing angle) { debug(1) }
on hit(damage float, bearing angle) { debug(2) }
on wallHit(bearing angle) { debug(3) }
on bulletMiss() { debug(4) }
on bulletHit(targetId int) { debug(5) }
on scanned(bearing angle) { debug(6) }
on robotDeath(robotId int) { debug(7) }
on robotHit(bearing angle) { debug(8) }
func tick() {}`
			const { wasm } = compile(source)
			const { instance } = await instantiate(wasm)
			expect(typeof instance.exports.on_scan).toBe("function")
			expect(typeof instance.exports.on_hit).toBe("function")
			expect(typeof instance.exports.on_wallHit).toBe("function")
			expect(typeof instance.exports.on_bulletMiss).toBe("function")
			expect(typeof instance.exports.on_bulletHit).toBe("function")
			expect(typeof instance.exports.on_scanned).toBe("function")
			expect(typeof instance.exports.on_robotDeath).toBe("function")
			expect(typeof instance.exports.on_robotHit).toBe("function")
		})

		it("event handler with init and global initializer", async () => {
			const source = `${R}
var scanThreshold float = 100.0
func init() {
  setSpeed(5.0)
}
func tick() {}
on scan(distance float, bearing angle) {
  if distance < scanThreshold {
    fire(3.0)
  }
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const init = instance.exports.init as () => void
			init()
			const onScan = instance.exports.on_scan as (distance: number, bearing: number) => void
			onScan(50.0, 0.0)
			const fireCalls = calls.filter((c) => c.name === "fire")
			expect(fireCalls.length).toBe(1)
			onScan(200.0, 0.0)
			const fireCalls2 = calls.filter((c) => c.name === "fire")
			expect(fireCalls2.length).toBe(1)
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

	describe("structs — comprehensive", () => {
		it("global struct: write and read a single field via debug()", async () => {
			const source = `${R}
type Point struct {
  x float
  y float
}
var p Point
func tick() {
  p.x = 5.0
  debug(p.x)
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const tick = instance.exports.tick as () => void
			tick()
			const debugCalls = calls.filter((c) => c.name === "debugFloat")
			expect(debugCalls.length).toBe(1)
			expect(debugCalls[0]!.args[0]).toBeCloseTo(5.0)
		})

		it("global struct: field initializer with struct literal", async () => {
			const source = `${R}
type Point struct {
  x float
  y float
}
var p Point = Point{ x: 3.0, y: 4.0 }
func tick() {
  debug(p.x)
  debug(p.y)
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const init = instance.exports.init as () => void
			init()
			const tick = instance.exports.tick as () => void
			tick()
			const debugCalls = calls.filter((c) => c.name === "debugFloat")
			expect(debugCalls.length).toBe(2)
			expect(debugCalls[0]!.args[0]).toBeCloseTo(3.0)
			expect(debugCalls[1]!.args[0]).toBeCloseTo(4.0)
		})

		it("local struct: short decl with struct literal", async () => {
			const source = `${R}
type Point struct {
  x float
  y float
}
func tick() {
  p := Point{ x: 10.0, y: 20.0 }
  debug(p.y)
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const tick = instance.exports.tick as () => void
			tick()
			const debugCalls = calls.filter((c) => c.name === "debugFloat")
			expect(debugCalls.length).toBe(1)
			expect(debugCalls[0]!.args[0]).toBeCloseTo(20.0)
		})

		it("local struct: read both fields", async () => {
			const source = `${R}
type Point struct {
  x float
  y float
}
func tick() {
  p := Point{ x: 7.0, y: 9.0 }
  debug(p.x)
  debug(p.y)
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const tick = instance.exports.tick as () => void
			tick()
			const debugCalls = calls.filter((c) => c.name === "debugFloat")
			expect(debugCalls.length).toBe(2)
			expect(debugCalls[0]!.args[0]).toBeCloseTo(7.0)
			expect(debugCalls[1]!.args[0]).toBeCloseTo(9.0)
		})

		it("global struct: cross-field assignment (p.y = p.x)", async () => {
			const source = `${R}
type Point struct {
  x float
  y float
}
var p Point
func tick() {
  p.x = 42.0
  p.y = p.x
  debug(p.y)
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const tick = instance.exports.tick as () => void
			tick()
			const debugCalls = calls.filter((c) => c.name === "debugFloat")
			expect(debugCalls.length).toBe(1)
			expect(debugCalls[0]!.args[0]).toBeCloseTo(42.0)
		})

		it("multiple struct types used together", async () => {
			const source = `${R}
type Point struct {
  x float
  y float
}
type Size struct {
  w float
  h float
}
var pos Point
var dim Size
func tick() {
  pos.x = 1.0
  pos.y = 2.0
  dim.w = 10.0
  dim.h = 20.0
  debug(pos.x)
  debug(pos.y)
  debug(dim.w)
  debug(dim.h)
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const tick = instance.exports.tick as () => void
			tick()
			const debugCalls = calls.filter((c) => c.name === "debugFloat")
			expect(debugCalls.length).toBe(4)
			expect(debugCalls[0]!.args[0]).toBeCloseTo(1.0)
			expect(debugCalls[1]!.args[0]).toBeCloseTo(2.0)
			expect(debugCalls[2]!.args[0]).toBeCloseTo(10.0)
			expect(debugCalls[3]!.args[0]).toBeCloseTo(20.0)
		})

		it("struct with mixed int and float fields", async () => {
			const source = `${R}
type Entity struct {
  id int
  x float
  y float
  health int
}
var e Entity
func tick() {
  e.id = 7
  e.x = 100.5
  e.y = 200.5
  e.health = 99
  debug(e.id)
  debug(e.x)
  debug(e.y)
  debug(e.health)
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const tick = instance.exports.tick as () => void
			tick()
			const debugIntCalls = calls.filter((c) => c.name === "debugInt")
			const debugFloatCalls = calls.filter((c) => c.name === "debugFloat")
			expect(debugIntCalls.length).toBe(2)
			expect(debugIntCalls[0]!.args[0]).toBe(7)
			expect(debugIntCalls[1]!.args[0]).toBe(99)
			expect(debugFloatCalls.length).toBe(2)
			expect(debugFloatCalls[0]!.args[0]).toBeCloseTo(100.5)
			expect(debugFloatCalls[1]!.args[0]).toBeCloseTo(200.5)
		})

		it("global struct: field persists across ticks", async () => {
			const source = `${R}
type Counter struct {
  count int
  total float
}
var c Counter
func tick() {
  c.count = c.count + 1
  c.total = c.total + 1.5
  debug(c.count)
  debug(c.total)
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const tick = instance.exports.tick as () => void
			tick()
			tick()
			tick()
			const debugIntCalls = calls.filter((c) => c.name === "debugInt")
			const debugFloatCalls = calls.filter((c) => c.name === "debugFloat")
			expect(debugIntCalls.length).toBe(3)
			expect(debugIntCalls[0]!.args[0]).toBe(1)
			expect(debugIntCalls[1]!.args[0]).toBe(2)
			expect(debugIntCalls[2]!.args[0]).toBe(3)
			expect(debugFloatCalls.length).toBe(3)
			expect(debugFloatCalls[0]!.args[0]).toBeCloseTo(1.5)
			expect(debugFloatCalls[1]!.args[0]).toBeCloseTo(3.0)
			expect(debugFloatCalls[2]!.args[0]).toBeCloseTo(4.5)
		})

		it("local struct: field assignment after init", async () => {
			const source = `${R}
type Point struct {
  x float
  y float
}
func tick() {
  p := Point{ x: 1.0, y: 2.0 }
  p.x = 99.0
  debug(p.x)
  debug(p.y)
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const tick = instance.exports.tick as () => void
			tick()
			const debugCalls = calls.filter((c) => c.name === "debugFloat")
			expect(debugCalls.length).toBe(2)
			expect(debugCalls[0]!.args[0]).toBeCloseTo(99.0)
			expect(debugCalls[1]!.args[0]).toBeCloseTo(2.0)
		})

		it("local struct: var decl with struct literal", async () => {
			const source = `${R}
type Point struct {
  x float
  y float
}
func tick() {
  var p Point = Point{ x: 5.5, y: 6.5 }
  debug(p.x)
  debug(p.y)
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const tick = instance.exports.tick as () => void
			tick()
			const debugCalls = calls.filter((c) => c.name === "debugFloat")
			expect(debugCalls.length).toBe(2)
			expect(debugCalls[0]!.args[0]).toBeCloseTo(5.5)
			expect(debugCalls[1]!.args[0]).toBeCloseTo(6.5)
		})

		it("local struct with mixed int and float fields", async () => {
			const source = `${R}
type Mixed struct {
  id int
  value float
}
func tick() {
  m := Mixed{ id: 42, value: 3.14 }
  debug(m.id)
  debug(m.value)
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const tick = instance.exports.tick as () => void
			tick()
			const debugIntCalls = calls.filter((c) => c.name === "debugInt")
			const debugFloatCalls = calls.filter((c) => c.name === "debugFloat")
			expect(debugIntCalls.length).toBe(1)
			expect(debugIntCalls[0]!.args[0]).toBe(42)
			expect(debugFloatCalls.length).toBe(1)
			expect(debugFloatCalls[0]!.args[0]).toBeCloseTo(3.14)
		})

		it("local struct: cross-field assignment", async () => {
			const source = `${R}
type Point struct {
  x float
  y float
}
func tick() {
  p := Point{ x: 55.0, y: 0.0 }
  p.y = p.x
  debug(p.y)
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const tick = instance.exports.tick as () => void
			tick()
			const debugCalls = calls.filter((c) => c.name === "debugFloat")
			expect(debugCalls.length).toBe(1)
			expect(debugCalls[0]!.args[0]).toBeCloseTo(55.0)
		})

		it("global struct initializer with user-defined init", async () => {
			const source = `${R}
type Point struct {
  x float
  y float
}
var origin Point = Point{ x: 0.0, y: 0.0 }
var target Point = Point{ x: 100.0, y: 200.0 }
func init() {
  debug(target.x)
}
func tick() {
  debug(target.y)
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const init = instance.exports.init as () => void
			init()
			const tick = instance.exports.tick as () => void
			tick()
			const debugCalls = calls.filter((c) => c.name === "debugFloat")
			expect(debugCalls.length).toBe(2)
			expect(debugCalls[0]!.args[0]).toBeCloseTo(100.0)
			expect(debugCalls[1]!.args[0]).toBeCloseTo(200.0)
		})
	})

	describe("arrays", () => {
		it("stores and loads global int array element", async () => {
			const source = `${R}
var nums [3]int
func tick() {
  nums[0] = 42
  debug(nums[0])
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const tick = instance.exports.tick as () => void
			tick()
			const debugCalls = calls.filter((c) => c.name === "debugInt")
			expect(debugCalls.length).toBe(1)
			expect(debugCalls[0]!.args[0]).toBe(42)
		})

		it("stores and loads global float array element", async () => {
			const source = `${R}
var fs [2]float
func tick() {
  fs[1] = 3.14
  debug(fs[1])
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const tick = instance.exports.tick as () => void
			tick()
			const debugCalls = calls.filter((c) => c.name === "debugFloat")
			expect(debugCalls.length).toBe(1)
			expect(debugCalls[0]!.args[0]).toBeCloseTo(3.14)
		})

		it("traps on out-of-bounds array access", async () => {
			const source = `${R}
var nums [3]int
func tick() {
  debug(nums[5])
}`
			const { wasm } = compile(source)
			const { instance } = await instantiate(wasm)
			const tick = instance.exports.tick as () => void
			expect(() => tick()).toThrow()
		})

		it("traps on negative array index", async () => {
			const source = `${R}
var nums [3]int
func tick() {
  debug(nums[-1])
}`
			const { wasm } = compile(source)
			const { instance } = await instantiate(wasm)
			const tick = instance.exports.tick as () => void
			expect(() => tick()).toThrow()
		})

		it("accesses array elements with variable index", async () => {
			const source = `${R}
var nums [3]int
func tick() {
  i := 0
  nums[i] = 10
  i = 1
  nums[i] = 20
  debug(nums[0])
  debug(nums[1])
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const tick = instance.exports.tick as () => void
			tick()
			const debugCalls = calls.filter((c) => c.name === "debugInt")
			expect(debugCalls.length).toBe(2)
			expect(debugCalls[0]!.args[0]).toBe(10)
			expect(debugCalls[1]!.args[0]).toBe(20)
		})

		it("uses array elements in arithmetic expression", async () => {
			const source = `${R}
var nums [3]int
func tick() {
  nums[0] = 10
  nums[1] = 20
  result := nums[0] + nums[1]
  debug(result)
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const tick = instance.exports.tick as () => void
			tick()
			const debugCalls = calls.filter((c) => c.name === "debugInt")
			expect(debugCalls.length).toBe(1)
			expect(debugCalls[0]!.args[0]).toBe(30)
		})

		it("persists global array values across tick calls", async () => {
			const source = `${R}
var nums [3]int
func tick() {
  nums[0] = nums[0] + 1
  debug(nums[0])
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

		it("stores values in all array positions", async () => {
			const source = `${R}
var nums [3]int
func tick() {
  nums[0] = 100
  nums[1] = 200
  nums[2] = 300
  debug(nums[0])
  debug(nums[1])
  debug(nums[2])
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const tick = instance.exports.tick as () => void
			tick()
			const debugCalls = calls.filter((c) => c.name === "debugInt")
			expect(debugCalls.length).toBe(3)
			expect(debugCalls[0]!.args[0]).toBe(100)
			expect(debugCalls[1]!.args[0]).toBe(200)
			expect(debugCalls[2]!.args[0]).toBe(300)
		})

		it("supports compound assignment on array elements", async () => {
			const source = `${R}
var nums [3]int
func tick() {
  nums[0] = 10
  nums[0] += 5
  debug(nums[0])
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const tick = instance.exports.tick as () => void
			tick()
			const debugCalls = calls.filter((c) => c.name === "debugInt")
			expect(debugCalls.length).toBe(1)
			expect(debugCalls[0]!.args[0]).toBe(15)
		})

		it("iterates over array with for loop", async () => {
			const source = `${R}
var nums [3]int
func tick() {
  nums[0] = 10
  nums[1] = 20
  nums[2] = 30
  for i := 0; i < 3; i += 1 {
    debug(nums[i])
  }
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const tick = instance.exports.tick as () => void
			tick()
			const debugCalls = calls.filter((c) => c.name === "debugInt")
			expect(debugCalls.length).toBe(3)
			expect(debugCalls[0]!.args[0]).toBe(10)
			expect(debugCalls[1]!.args[0]).toBe(20)
			expect(debugCalls[2]!.args[0]).toBe(30)
		})

		it("traps on out-of-bounds store", async () => {
			const source = `${R}
var nums [3]int
func tick() {
  nums[3] = 42
}`
			const { wasm } = compile(source)
			const { instance } = await instantiate(wasm)
			const tick = instance.exports.tick as () => void
			expect(() => tick()).toThrow()
		})

		it("handles local array declared with var", async () => {
			const source = `${R}
func tick() {
  var xs [3]int
  xs[0] = 1
  xs[1] = 2
  xs[2] = 3
  debug(xs[2])
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const tick = instance.exports.tick as () => void
			tick()
			const debugCalls = calls.filter((c) => c.name === "debugInt")
			expect(debugCalls.length).toBe(1)
			expect(debugCalls[0]!.args[0]).toBe(3)
		})

		it("initializes global array in init and reads in tick", async () => {
			const source = `${R}
var nums [3]int
func init() {
  nums[0] = 10
  nums[1] = 20
  nums[2] = 30
}
func tick() {
  debug(nums[0])
  debug(nums[1])
  debug(nums[2])
}`
			const { wasm } = compile(source)
			const { instance, calls } = await instantiate(wasm)
			const init = instance.exports.init as () => void
			init()
			const tick = instance.exports.tick as () => void
			tick()
			const debugCalls = calls.filter((c) => c.name === "debugInt")
			expect(debugCalls.length).toBe(3)
			expect(debugCalls[0]!.args[0]).toBe(10)
			expect(debugCalls[1]!.args[0]).toBe(20)
			expect(debugCalls[2]!.args[0]).toBe(30)
		})
	})
})
