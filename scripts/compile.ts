#!/usr/bin/env bun
/**
 * Compile an RBL robot source file through the full pipeline: lex → parse → analyze.
 *
 * Usage:
 *   bun scripts/compile.ts [path/to/robot.rbl]
 *
 * If no path is given, compiles a built-in SpinBot example.
 */
import { readFileSync } from "node:fs"
import { Lexer, analyze, parse, typeToString } from "../src/compiler"

const exampleSource = `robot "SpinBot"

var direction int = 1

func tick() {
	setSpeed(50.0)
	setTurnRate(5.0)
	fire(1.0)
}

on scan(distance float, bearing angle) {
	setGunHeading(bearing)
}
`

const filePath = process.argv[2]
let source: string
if (filePath) {
	source = readFileSync(filePath, "utf-8")
	console.log(`Compiling: ${filePath}\n`)
} else {
	source = exampleSource
	console.log("Compiling: built-in SpinBot example\n")
}

// Stage 1: Lex
console.log("=== Lexing ===")
const tokens = new Lexer(source).tokenize()
console.log(`${tokens.length} tokens produced`)

// Stage 2: Parse
console.log("\n=== Parsing ===")
const { program, errors: parseErrors } = parse(tokens)
if (parseErrors.hasErrors()) {
	console.log("Parse errors:")
	for (const e of parseErrors.errors) {
		console.log(`  Line ${e.line}:${e.column}: ${e.message}${e.hint ? ` (hint: ${e.hint})` : ""}`)
	}
	process.exit(1)
}
console.log("Parse OK")
console.log(`  Robot name: ${program.robotName}`)
console.log(`  Functions: ${program.funcs.map((f) => f.name).join(", ") || "(none)"}`)
console.log(`  Events: ${program.events.map((e) => e.name).join(", ") || "(none)"}`)
console.log(`  Globals: ${program.globals.map((v) => v.name).join(", ") || "(none)"}`)
console.log(`  Types: ${program.types.map((t) => t.name).join(", ") || "(none)"}`)
console.log(`  Constants: ${program.consts.map((c) => c.name).join(", ") || "(none)"}`)

// Stage 3: Analyze
console.log("\n=== Analyzing ===")
const result = analyze(program)
if (result.errors.hasErrors()) {
	console.log("Analysis errors:")
	for (const e of result.errors.errors) {
		console.log(`  Line ${e.line}:${e.column}: ${e.message}${e.hint ? ` (hint: ${e.hint})` : ""}`)
	}
	process.exit(1)
}
console.log("Analysis OK")

if (result.structs.size > 0) {
	console.log("\n  Structs:")
	for (const [name, type] of result.structs) {
		if (type.kind === "struct") {
			const fields = type.fields.map((f) => `${f.name}: ${typeToString(f.type)}`).join(", ")
			console.log(`    ${name} { ${fields} }`)
		}
	}
}

if (result.consts.size > 0) {
	console.log("\n  Constants:")
	for (const [name, info] of result.consts) {
		console.log(`    ${name}: ${typeToString(info.type)} = ${info.value}`)
	}
}

console.log("\n  Symbols:")
for (const [name, info] of result.symbols) {
	console.log(`    ${name}: ${typeToString(info.type)} (${info.scope}, offset=${info.location})`)
}

console.log("\n  Functions:")
for (const [name, info] of result.funcs) {
	if (info.isImport) continue
	const params = info.params
		.map((p, i) => `${info.paramNames[i] ?? `_${i}`} ${typeToString(p)}`)
		.join(", ")
	const ret =
		info.returnTypes.length > 0 ? info.returnTypes.filter(Boolean).map(typeToString).join(", ") : ""
	const displayName = info.isEvent ? `on ${info.name}` : name
	console.log(`    ${displayName}(${params})${ret ? ` -> ${ret}` : ""}`)
}

console.log(`\n  Global memory: ${result.globalMemorySize} bytes`)
console.log("\nDone.")
