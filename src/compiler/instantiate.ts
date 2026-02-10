/**
 * Bridge between the compiler and the simulation engine.
 *
 * Compiles RBL source to WASM, instantiates it with a RobotAPI,
 * and returns a RobotModule the simulation can drive.
 */
import type { RobotAPI, RobotModule } from "../../spec/simulation"
import { analyze } from "./analyzer"
import { codegen } from "./codegen"
import type { RobotDebugLog } from "./debug-log"
import { CompileErrorList } from "./errors"
import { Lexer } from "./lexer"
import { parse } from "./parser"

export interface CompileResult {
	readonly success: boolean
	readonly errors: CompileErrorList
	readonly wasm?: Uint8Array
}

/** Compile RBL source through lex → parse → analyze → codegen. */
export function compile(source: string): CompileResult {
	const allErrors = new CompileErrorList()

	// Lex
	const tokens = new Lexer(source).tokenize()

	// Parse
	const { program, errors: parseErrors } = parse(tokens)
	for (const e of parseErrors.errors) {
		allErrors.add(e.phase, e.line, e.column, e.message, e.hint)
	}
	if (parseErrors.hasErrors()) {
		return { success: false, errors: allErrors }
	}

	// Analyze
	const analysis = analyze(program)
	for (const e of analysis.errors.errors) {
		allErrors.add(e.phase, e.line, e.column, e.message, e.hint)
	}
	if (analysis.errors.hasErrors()) {
		return { success: false, errors: allErrors }
	}

	// Codegen
	const wasm = codegen(program, analysis)
	return { success: true, errors: allErrors, wasm }
}

/**
 * Create a RobotModule from a compiled WASM binary.
 * The module wraps WASM exports in the RobotModule interface.
 *
 * @param wasm - compiled WASM binary
 * @param debugLog - optional debug log collector for diagnostics
 */
export async function instantiate(
	wasm: Uint8Array,
	debugLog?: RobotDebugLog,
): Promise<RobotModule> {
	const compiled = await WebAssembly.compile(wasm as BufferSource)

	// The API reference is set during init() — we need a mutable binding
	// so the WASM imports can call into the API provided later.
	let api: RobotAPI | null = null

	function requireApi(): RobotAPI {
		if (!api) throw new Error("RobotModule.init() has not been called")
		return api
	}

	// Build the import object — every API function forwards to the api ref
	const imports: WebAssembly.Imports = {
		env: {
			// Movement
			setSpeed: (v: number) => requireApi().setSpeed(v),
			setTurnRate: (v: number) => requireApi().setTurnRate(v),
			setHeading: (v: number) => requireApi().setHeading(v),
			getX: () => requireApi().getX(),
			getY: () => requireApi().getY(),
			getHeading: () => requireApi().getHeading(),
			getSpeed: () => requireApi().getSpeed(),
			// Gun
			setGunTurnRate: (v: number) => requireApi().setGunTurnRate(v),
			setGunHeading: (v: number) => requireApi().setGunHeading(v),
			getGunHeading: () => requireApi().getGunHeading(),
			getGunHeat: () => requireApi().getGunHeat(),
			fire: (v: number) => requireApi().fire(v),
			getEnergy: () => requireApi().getEnergy(),
			// Radar
			setRadarTurnRate: (v: number) => requireApi().setRadarTurnRate(v),
			setRadarHeading: (v: number) => requireApi().setRadarHeading(v),
			getRadarHeading: () => requireApi().getRadarHeading(),
			setScanWidth: (v: number) => requireApi().setScanWidth(v),
			// Status
			getHealth: () => requireApi().getHealth(),
			getTick: () => requireApi().getTick(),
			// Arena
			arenaWidth: () => requireApi().arenaWidth(),
			arenaHeight: () => requireApi().arenaHeight(),
			robotCount: () => requireApi().robotCount(),
			// Utility
			distanceTo: (x: number, y: number) => requireApi().distanceTo(x, y),
			bearingTo: (x: number, y: number) => requireApi().bearingTo(x, y),
			random: (max: number) => requireApi().random(max),
			randomFloat: () => requireApi().randomFloat(),
			debugInt: (v: number) => {
				debugLog?.debug("int", v)
				requireApi().debugInt(v)
			},
			debugFloat: (v: number) => {
				debugLog?.debug("float", v)
				requireApi().debugFloat(v)
			},
			debugAngle: (v: number) => {
				debugLog?.debug("angle", v)
				requireApi().debugAngle(v)
			},
			setColor: (r: number, g: number, b: number) => requireApi().setColor(r, g, b),
			setGunColor: (r: number, g: number, b: number) => requireApi().setGunColor(r, g, b),
			setRadarColor: (r: number, g: number, b: number) => requireApi().setRadarColor(r, g, b),
			// Math
			sin: (a: number) => requireApi().sin(a),
			cos: (a: number) => requireApi().cos(a),
			tan: (a: number) => requireApi().tan(a),
			atan2: (y: number, x: number) => requireApi().atan2(y, x),
			sqrt: (x: number) => requireApi().sqrt(x),
			abs: (x: number) => requireApi().abs(x),
			min: (a: number, b: number) => requireApi().min(a, b),
			max: (a: number, b: number) => requireApi().max(a, b),
			clamp: (x: number, lo: number, hi: number) => requireApi().clamp(x, lo, hi),
			floor: (x: number) => requireApi().floor(x),
			ceil: (x: number) => requireApi().ceil(x),
			round: (x: number) => requireApi().round(x),
		},
	}

	const instance = await WebAssembly.instantiate(compiled, imports)
	const exports = instance.exports as Record<string, WebAssembly.ExportValue>

	// Helper to safely call an optional export
	function callExport(name: string, ...args: number[]): void {
		const fn = exports[name]
		if (typeof fn === "function") {
			try {
				fn(...args)
			} catch (e) {
				// WASM trap (unreachable, stack overflow, etc.) — robot skips this call
				console.warn(`Robot WASM trap in ${name}:`, e)
				debugLog?.trap(name, e)
			}
		}
	}

	return {
		init(robotApi: RobotAPI) {
			api = robotApi
			callExport("init")
		},
		tick() {
			callExport("tick")
		},
		onScan(distance: number, bearing: number) {
			callExport("on_scan", distance, bearing)
		},
		onScanned(bearing: number) {
			callExport("on_scanned", bearing)
		},
		onHit(damage: number, bearing: number) {
			callExport("on_hit", damage, bearing)
		},
		onBulletHit(targetId: number) {
			callExport("on_bulletHit", targetId)
		},
		onWallHit(bearing: number) {
			callExport("on_wallHit", bearing)
		},
		onRobotHit(bearing: number) {
			callExport("on_robotHit", bearing)
		},
		onBulletMiss() {
			callExport("on_bulletMiss")
		},
		onRobotDeath(robotId: number) {
			callExport("on_robotDeath", robotId)
		},
		destroy() {
			api = null
		},
	}
}

/** Compile RBL source and instantiate as a RobotModule in one step. */
export async function compileAndInstantiate(
	source: string,
	debugLog?: RobotDebugLog,
): Promise<{
	module: RobotModule
	errors: CompileErrorList
}> {
	const result = compile(source)
	if (!result.success || !result.wasm) {
		throw new CompileError(result.errors)
	}
	const module = await instantiate(result.wasm, debugLog)
	return { module, errors: result.errors }
}

export class CompileError extends Error {
	readonly compileErrors: CompileErrorList
	constructor(errors: CompileErrorList) {
		const messages = errors.errors.map((e) => `Line ${e.line}:${e.column}: ${e.message}`)
		super(`Compilation failed:\n${messages.join("\n")}`)
		this.name = "CompileError"
		this.compileErrors = errors
	}
}
