import { describe, expect, it } from "vitest"
import { ANGLE, FLOAT, Lexer, TokenKind, analyze, parse, typeEq } from "../compiler"
import { createRenderer } from "../renderer"
import { createBattle, createDefaultConfig, createSpinBot, createTrackerBot } from "../simulation"

/**
 * Integration test: demonstrates the full data flow.
 *
 * In the real system:
 *   source → Compiler → CompileResult (WASM) → RobotModule → Simulation → GameState → Renderer
 *
 * Here we use test stub RobotModules instead of compiled WASM, but the
 * simulation → renderer pipeline is real.
 */
describe("Data Flow Integration", () => {
	it("source → tokens (compiler stage 1)", () => {
		const source = `robot "IntegrationBot"

func tick() {
	setSpeed(50)
	setTurnRate(5)
}
`
		const tokens = new Lexer(source).tokenize()
		const meaningful = tokens.filter(
			(t) => t.kind !== TokenKind.Newline && t.kind !== TokenKind.EOF,
		)
		expect(meaningful[0]!.kind).toBe(TokenKind.Robot)
		expect(meaningful[1]!.value).toBe("IntegrationBot")
	})

	it("robots → simulation → GameState (simulation stage)", () => {
		const config = createDefaultConfig(
			[
				{ name: "SpinBot", color: 0xff0000 },
				{ name: "TrackerBot", color: 0x0000ff },
			],
			{ ticksPerRound: 50 },
		)
		const battle = createBattle(config, [createSpinBot(), createTrackerBot()])

		// Run the full round
		const roundResult = battle.runRound()
		const finalState = battle.getState()

		// Verify GameState shape
		expect(finalState.tick).toBe(50)
		expect(finalState.round).toBe(1)
		expect(finalState.arena.width).toBe(800)
		expect(finalState.robots).toHaveLength(2)
		expect(Array.isArray(finalState.bullets)).toBe(true)
		expect(finalState.mines).toEqual([])
		expect(finalState.cookies).toEqual([])

		// Verify round result
		expect(roundResult.reason).toBe("time_limit")
		expect(roundResult.placements).toHaveLength(2)

		battle.destroy()
	})

	it("GameState → renderer (rendering stage)", () => {
		const config = createDefaultConfig([
			{ name: "Bot1", color: 0xff0000 },
			{ name: "Bot2", color: 0x0000ff },
		])
		const battle = createBattle(config, [createSpinBot(), createSpinBot()])

		// Run a few ticks
		for (let i = 0; i < 5; i++) {
			battle.tick()
		}

		const state = battle.getState()

		// Create renderer and feed it the state
		const renderer = createRenderer()
		// Note: without a real canvas, render() is a no-op, but pushFrame works
		renderer.pushFrame(state)

		// The renderer accepts GameState without crashing.
		// In a browser environment it would draw to a canvas.
		renderer.destroy()
		battle.destroy()
	})

	it("source → tokens → AST → analysis (compiler pipeline)", () => {
		const source = `robot "Guardian"

type Target struct {
	bearing angle
	distance float
	active bool
}

var bestTarget Target
var scanDir angle

func tick() {
	setSpeed(0.0)
	if bestTarget.active {
		setGunHeading(bestTarget.bearing)
		if getGunHeat() == 0.0 {
			fire(3.0)
		}
	}
}

func init() {
	scanDir = angle(1)
	setSpeed(50.0)
}

on scan(distance float, bearing angle) {
	bestTarget = Target{
		bearing: bearing,
		distance: distance,
		active: true
	}
}
`
		// Stage 1: Lex
		const tokens = new Lexer(source).tokenize()
		expect(tokens.length).toBeGreaterThan(20)

		// Stage 2: Parse
		const { program, errors: parseErrors } = parse(tokens)
		expect(parseErrors.hasErrors()).toBe(false)
		expect(program.robotName).toBe("Guardian")
		expect(program.funcs).toHaveLength(2) // tick, init
		expect(program.events).toHaveLength(1) // on scan
		expect(program.types).toHaveLength(1) // Target struct

		// Stage 3: Analyze
		const result = analyze(program)
		expect(result.errors.hasErrors()).toBe(false)

		// Verify struct was resolved
		const targetType = result.structs.get("Target")
		expect(targetType).toBeDefined()
		if (targetType?.kind === "struct") {
			expect(targetType.fields).toHaveLength(3)
			expect(typeEq(targetType.fields[0]!.type, ANGLE)).toBe(true)
			expect(typeEq(targetType.fields[1]!.type, FLOAT)).toBe(true)
		}

		// Verify globals
		const bestTargetSym = result.symbols.get("bestTarget")
		expect(bestTargetSym).toBeDefined()
		expect(bestTargetSym!.scope).toBe("global")

		// Verify memory layout
		expect(result.globalMemorySize).toBeGreaterThan(64)
	})

	it("minimal robot with no tick produces analysis error", () => {
		const source = `robot "NothingBot"\n`
		const tokens = new Lexer(source).tokenize()
		const { program, errors: parseErrors } = parse(tokens)
		expect(parseErrors.hasErrors()).toBe(false)
		expect(program.robotName).toBe("NothingBot")
		expect(program.funcs).toHaveLength(0)

		const result = analyze(program)
		expect(result.errors.hasErrors()).toBe(true)
		const err = result.errors.errors[0]!
		expect(err.message).toContain("tick()")
		expect(err.line).toBe(1)
		expect(err.column).toBe(1)
		expect(err.hint).toBeDefined()
	})

	it("SpinBot.rbl compiles through full pipeline", () => {
		const source = `robot "SpinBot"

var direction int = 1

func tick() {
	setSpeed(50.0)
	setTurnRate(5.0 * float(direction))
	setGunTurnRate(10.0)

	if getGunHeat() == 0.0 {
		fire(1.0)
	}
}

on scan(distance float, bearing angle) {
	setGunHeading(bearing)
	fire(2.0)
}

on hit(damage float, bearing angle) {
	direction = direction * -1
	setSpeed(80.0)
}

on wallHit(bearing angle) {
	direction = direction * -1
}
`
		const tokens = new Lexer(source).tokenize()
		const { program, errors: parseErrors } = parse(tokens)
		expect(parseErrors.hasErrors()).toBe(false)
		expect(program.robotName).toBe("SpinBot")
		expect(program.funcs).toHaveLength(1)
		expect(program.events).toHaveLength(3)
		expect(program.globals).toHaveLength(1)

		const result = analyze(program)
		expect(result.errors.hasErrors()).toBe(false)

		// Verify global variable
		const dirSym = result.symbols.get("direction")
		expect(dirSym).toBeDefined()
		expect(dirSym!.scope).toBe("global")

		// Verify all functions registered
		expect(result.funcs.has("tick")).toBe(true)
		expect(result.funcs.has("on_scan")).toBe(true)
		expect(result.funcs.has("on_hit")).toBe(true)
		expect(result.funcs.has("on_wallHit")).toBe(true)
	})

	it("int literal where float expected produces clear error", () => {
		const source = `robot "BadBot"
func tick() {
	setSpeed(50)
}
`
		const tokens = new Lexer(source).tokenize()
		const { program } = parse(tokens)
		const result = analyze(program)
		expect(result.errors.hasErrors()).toBe(true)
		const err = result.errors.errors[0]!
		expect(err.message).toContain("expected float")
		expect(err.message).toContain("got int")
	})

	it("full pipeline: compile check → battle → render-ready state", () => {
		// Step 1: Verify source tokenizes
		const source = `robot "PipelineBot"
var speed float = 50.0
func tick() {
	setSpeed(speed)
}
`
		const tokens = new Lexer(source).tokenize()
		expect(tokens.length).toBeGreaterThan(5)

		// Step 2: Create and run a battle (using test stubs for now)
		const config = createDefaultConfig(
			[
				{ name: "PipelineBot", color: 0x00ff00 },
				{ name: "Opponent", color: 0xff0000 },
			],
			{ ticksPerRound: 20 },
		)
		const battle = createBattle(config, [createSpinBot(), createSpinBot()])
		const result = battle.runRound()

		// Step 3: Get final state and verify it's render-ready
		const state = battle.getState()
		expect(state.robots.every((r) => typeof r.x === "number")).toBe(true)
		expect(state.robots.every((r) => typeof r.y === "number")).toBe(true)
		expect(state.robots.every((r) => typeof r.heading === "number")).toBe(true)

		// Step 4: Verify state survives serialization (critical for workers)
		const serialized = JSON.parse(JSON.stringify(state))
		expect(serialized.tick).toBe(state.tick)
		expect(serialized.robots[0].x).toBe(state.robots[0]!.x)

		expect(result.placements.length).toBe(2)

		battle.destroy()
	})
})
