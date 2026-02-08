/**
 * Compiler Module Interfaces
 *
 * Boundary: Source code (.rbl string) → CompileResult (WASM binary + metadata)
 *
 * The compiler is a pure function: string in, CompileResult out. It has no
 * dependencies on the simulation, renderer, or UI. It can run in the main
 * thread or a Web Worker.
 */

// ─── Compiler Public API ──────────────────────────────────────────────────────

/**
 * The single entry point. Takes RBL source code, returns everything needed
 * to instantiate and debug the robot.
 */
export interface Compiler {
	compile(source: string): CompileResult
}

/**
 * The complete output of compilation. This is the boundary object that
 * crosses from the compiler module to the simulation module.
 */
export interface CompileResult {
	/** Whether compilation succeeded. If false, `wasm` and `sourceMap` are absent. */
	readonly success: boolean

	/** The compiled WASM binary. Present only when success is true. */
	readonly wasm?: Uint8Array

	/** Source map for mapping WASM offsets back to RBL source lines. */
	readonly sourceMap?: SourceMap

	/** Metadata about the compiled robot (name, globals layout). */
	readonly metadata?: RobotMetadata

	/** Errors encountered during compilation. May be non-empty even on success (warnings). */
	readonly errors: CompileError[]
}

// ─── Source Map ───────────────────────────────────────────────────────────────

/**
 * Maps WASM byte offsets to source locations. Used for error reporting
 * and future debugging.
 */
export interface SourceMap {
	/** The original source code (for display in error messages and debug panel). */
	readonly source: string

	/** Mapping entries, sorted by wasmOffset ascending. */
	readonly entries: readonly SourceMapEntry[]
}

export interface SourceMapEntry {
	/** Byte offset in the WASM binary. */
	readonly wasmOffset: number

	/** Line number in the source (1-based). */
	readonly line: number

	/** Column number in the source (1-based). */
	readonly column: number

	/** Function name containing this offset, if any. */
	readonly functionName?: string
}

// ─── Robot Metadata ───────────────────────────────────────────────────────────

/**
 * Information about the compiled robot, extracted during compilation.
 * Used by the simulation engine and debug panel.
 */
export interface RobotMetadata {
	/** Robot name from the `robot "Name"` declaration. */
	readonly name: string

	/** Layout of global variables in linear memory (for debug inspection). */
	readonly globals: readonly GlobalInfo[]

	/** List of event handlers the robot defines (for optional calling). */
	readonly eventHandlers: readonly string[]

	/** List of user-defined functions (for debug/profiling). */
	readonly functions: readonly string[]
}

export interface GlobalInfo {
	/** Variable name as written in source. */
	readonly name: string

	/** Type description (e.g., "int", "float", "[8]Target"). */
	readonly type: string

	/** Byte offset in linear memory where this global starts. */
	readonly offset: number

	/** Size in bytes. */
	readonly size: number
}

// ─── Compile Errors ───────────────────────────────────────────────────────────

export interface CompileError {
	/** Error severity. Warnings don't prevent compilation. */
	readonly severity: "error" | "warning"

	/** Human-readable error message. */
	readonly message: string

	/** Source location, if available. */
	readonly location?: SourceLocation

	/** Optional suggestion for fixing the error. */
	readonly hint?: string
}

export interface SourceLocation {
	readonly line: number // 1-based
	readonly column: number // 1-based
	readonly length?: number // length of the erroneous span
}
