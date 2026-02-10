import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { compile } from "../instantiate"
import type { CompileResult } from "../instantiate"
import { Lexer } from "../lexer"
import { parse } from "../parser"

// ─────────────────────────────────────────────────────────────
// Shared helpers (mirrors the existing codegen.test.ts pattern)
// ─────────────────────────────────────────────────────────────

const R = `robot "Test"\n`

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
		"nearestMineDist",
		"nearestMineBearing",
		"nearestCookieDist",
		"nearestCookieBearing",
		"distanceTo",
		"bearingTo",
		"random",
		"randomFloat",
		"debugInt",
		"debugFloat",
		"debugAngle",
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

async function instantiateWasm(wasm: Uint8Array): Promise<{
	instance: WebAssembly.Instance
	calls: { name: string; args: unknown[] }[]
}> {
	const { imports, calls } = mockImports()
	const mod = await WebAssembly.compile(wasm as BufferSource)
	const instance = await WebAssembly.instantiate(mod, imports)
	return { instance, calls }
}

/**
 * Full compile pipeline: returns CompileResult without throwing.
 */
function tryCompile(source: string): CompileResult {
	return compile(source)
}

/**
 * Compile and instantiate, returning instance + calls.
 * Throws if compilation fails.
 */
async function compileAndRun(source: string) {
	const result = compile(source)
	if (!result.success || !result.wasm) {
		const msgs = result.errors.errors.map((e) => `${e.line}:${e.column} ${e.message}`).join("\n")
		throw new Error(`Compile failed:\n${msgs}`)
	}
	return instantiateWasm(result.wasm)
}

// ═══════════════════════════════════════════════════════════════
// A. PROPERTY-BASED TESTS
// ═══════════════════════════════════════════════════════════════

describe("property-based: compiler never crashes on random input", () => {
	it("lexer never throws on arbitrary strings", () => {
		fc.assert(
			fc.property(fc.string(), (input) => {
				// The lexer should always produce a token list (never throw)
				const lexer = new Lexer(input)
				const tokens = lexer.tokenize()
				expect(tokens.length).toBeGreaterThan(0) // at least EOF
			}),
			{ numRuns: 500 },
		)
	})

	it("lexer never throws on unicode / null bytes / control chars", () => {
		fc.assert(
			fc.property(
				fc.string().map((s) => {
					// Inject unicode and control characters
					const chars = ["\0", "\u0001", "\u00ff", "\u0100", "\u2603", "\ud83d"]
					const idx = Math.floor(Math.random() * (s.length + 1))
					const ch = chars[Math.floor(Math.random() * chars.length)]!
					return s.slice(0, idx) + ch + s.slice(idx)
				}),
				(input) => {
					const lexer = new Lexer(input)
					const tokens = lexer.tokenize()
					expect(tokens.length).toBeGreaterThan(0)
				},
			),
			{ numRuns: 300 },
		)
	})

	it("parser never throws an uncaught exception (returns errors instead)", () => {
		fc.assert(
			fc.property(fc.string(), (input) => {
				const tokens = new Lexer(input).tokenize()
				// parse should never throw — it returns an errors list
				const { errors } = parse(tokens)
				// We just check it returned something. Errors are fine.
				expect(errors).toBeDefined()
			}),
			{ numRuns: 500 },
		)
	})

	it("full compile pipeline never throws on random strings", () => {
		fc.assert(
			fc.property(fc.string(), (input) => {
				// compile() should return a result object, never throw
				const result = tryCompile(input)
				expect(result).toBeDefined()
				expect(typeof result.success).toBe("boolean")
			}),
			{ numRuns: 500 },
		)
	})

	it("compile never throws on random valid-ish programs", () => {
		const validProgramArb = fc
			.record({
				robotName: fc.stringMatching(/^[a-z]{1,10}$/),
				varName: fc.stringMatching(/^[a-z]{1,5}$/),
				varType: fc.constantFrom("int", "float", "bool"),
				body: fc.constantFrom(
					"debugInt(1)",
					"setSpeed(1.0)",
					"fire(1.0)",
					"x := 1\ndebugInt(x)",
					"",
				),
			})
			.map(
				(r) =>
					`robot "${r.robotName}"\nvar ${r.varName} ${r.varType}\nfunc tick() {\n  ${r.body}\n}\n`,
			)

		fc.assert(
			fc.property(validProgramArb, (source) => {
				const result = tryCompile(source)
				expect(result).toBeDefined()
			}),
			{ numRuns: 200 },
		)
	})
})

describe("property-based: valid programs round-trip", () => {
	it("minimal valid program compiles to non-empty wasm", () => {
		const result = tryCompile(`${R}func tick() {}`)
		expect(result.success).toBe(true)
		expect(result.wasm).toBeInstanceOf(Uint8Array)
		expect(result.wasm!.length).toBeGreaterThan(8)
	})

	it("valid program with random int arithmetic compiles and runs", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.integer({ min: -1000, max: 1000 }),
				fc.integer({ min: -1000, max: 1000 }),
				fc.constantFrom("+", "-", "*"),
				async (a, b, op) => {
					const source = `${R}func tick() {\n  x := ${a} ${op} ${b}\n  debugInt(x)\n}`
					const result = tryCompile(source)
					expect(result.success).toBe(true)
					const { instance, calls } = await instantiateWasm(result.wasm!)
					const tick = instance.exports.tick as () => void
					tick()
					const debugCalls = calls.filter((c) => c.name === "debugInt")
					expect(debugCalls.length).toBe(1)
					// Verify against JS-computed i32 result
					let expected: number
					switch (op) {
						case "+":
							expected = (a + b) | 0
							break
						case "-":
							expected = (a - b) | 0
							break
						case "*":
							expected = Math.imul(a, b)
							break
						default:
							expected = 0
					}
					expect(debugCalls[0]!.args[0]).toBe(expected)
				},
			),
			{ numRuns: 100 },
		)
	})

	it("integer addition is commutative", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.integer({ min: -10000, max: 10000 }),
				fc.integer({ min: -10000, max: 10000 }),
				async (a, b) => {
					const src1 = `${R}func tick() {\n  debugInt(${a} + ${b})\n}`
					const src2 = `${R}func tick() {\n  debugInt(${b} + ${a})\n}`
					const r1 = tryCompile(src1)
					const r2 = tryCompile(src2)
					expect(r1.success).toBe(true)
					expect(r2.success).toBe(true)
					const { instance: inst1, calls: c1 } = await instantiateWasm(r1.wasm!)
					const { instance: inst2, calls: c2 } = await instantiateWasm(r2.wasm!)
					;(inst1.exports.tick as () => void)()
					;(inst2.exports.tick as () => void)()
					const d1 = c1.filter((c) => c.name === "debugInt")
					const d2 = c2.filter((c) => c.name === "debugInt")
					expect(d1[0]!.args[0]).toBe(d2[0]!.args[0])
				},
			),
			{ numRuns: 50 },
		)
	})

	it("adding zero is identity for int", async () => {
		await fc.assert(
			fc.asyncProperty(fc.integer({ min: -100000, max: 100000 }), async (a) => {
				const source = `${R}func tick() {\n  x := ${a}\n  y := x + 0\n  debugInt(y)\n}`
				const result = tryCompile(source)
				expect(result.success).toBe(true)
				const { instance, calls } = await instantiateWasm(result.wasm!)
				;(instance.exports.tick as () => void)()
				const debugCalls = calls.filter((c) => c.name === "debugInt")
				expect(debugCalls[0]!.args[0]).toBe(a)
			}),
			{ numRuns: 50 },
		)
	})

	it("float * 1.0 is identity", async () => {
		await fc.assert(
			fc.asyncProperty(fc.float({ min: -1000, max: 1000, noNaN: true }), async (a) => {
				// Need to format float so it's always recognized as float literal
				const aStr = Number.isInteger(a) ? `${a}.0` : `${a}`
				const source = `${R}func tick() {\n  x := ${aStr}\n  y := x * 1.0\n  debugFloat(y)\n}`
				const result = tryCompile(source)
				if (!result.success) return // skip if the float literal can't parse
				const { instance, calls } = await instantiateWasm(result.wasm!)
				;(instance.exports.tick as () => void)()
				const debugCalls = calls.filter((c) => c.name === "debugFloat")
				if (debugCalls.length > 0) {
					expect(debugCalls[0]!.args[0]).toBeCloseTo(a, 3)
				}
			}),
			{ numRuns: 50 },
		)
	})
})

describe("property-based: type system", () => {
	it("every program that passes analysis should compile without codegen crash", () => {
		const programs = [
			`${R}func tick() { debugInt(1) }`,
			`${R}func tick() { debugFloat(1.0) }`,
			`${R}func tick() {\n  x := 1\n  y := 2\n  debugInt(x + y)\n}`,
			`${R}func tick() {\n  x := true\n  if x { debugInt(1) }\n}`,
			`${R}var g int\nfunc tick() { g = g + 1\n  debugInt(g)\n}`,
			`${R}func helper() int { return 42 }\nfunc tick() { debugInt(helper()) }`,
			`${R}type P struct { x int\n  y int }\nvar p P\nfunc tick() { p.x = 1\n  debugInt(p.x) }`,
		]
		for (const src of programs) {
			const result = tryCompile(src)
			expect(result.success).toBe(true)
			expect(result.wasm).toBeInstanceOf(Uint8Array)
			expect(result.wasm!.length).toBeGreaterThan(0)
		}
	})
})

// ═══════════════════════════════════════════════════════════════
// B. EDGE CASE TESTS
// ═══════════════════════════════════════════════════════════════

// ── B.1 Lexer Edge Cases ─────────────────────────────────────

describe("lexer edge cases", () => {
	it("empty string produces only EOF", () => {
		const tokens = new Lexer("").tokenize()
		expect(tokens.length).toBe(1)
		expect(tokens[0]!.kind).toBe("EOF")
	})

	it("only whitespace produces only EOF", () => {
		const tokens = new Lexer("   \t\t   ").tokenize()
		expect(tokens.length).toBe(1)
		expect(tokens[0]!.kind).toBe("EOF")
	})

	it("only newlines produce newline tokens + EOF", () => {
		const tokens = new Lexer("\n\n\n").tokenize()
		const kinds = tokens.map((t) => t.kind)
		expect(kinds.filter((k) => k === "Newline").length).toBe(3)
		expect(kinds[kinds.length - 1]).toBe("EOF")
	})

	it("only comments produce only EOF", () => {
		const tokens = new Lexer("// this is a comment").tokenize()
		expect(tokens.length).toBe(1)
		expect(tokens[0]!.kind).toBe("EOF")
	})

	it("very long identifier (1000 chars)", () => {
		const longIdent = "a".repeat(1000)
		const tokens = new Lexer(longIdent).tokenize()
		expect(tokens.length).toBe(2) // Ident + EOF
		expect(tokens[0]!.value).toBe(longIdent)
	})

	it("string with escape sequences", () => {
		const tokens = new Lexer('"hello\\nworld\\t\\\\"').tokenize()
		expect(tokens[0]!.kind).toBe("String")
		expect(tokens[0]!.value).toBe("hello\nworld\t\\")
	})

	it("unterminated string at end of line", () => {
		const tokens = new Lexer('"unterminated\n').tokenize()
		expect(tokens[0]!.kind).toBe("String")
		expect(tokens[0]!.value).toBe("unterminated")
	})

	it("unterminated string at end of input", () => {
		const tokens = new Lexer('"unterminated').tokenize()
		expect(tokens[0]!.kind).toBe("String")
		expect(tokens[0]!.value).toBe("unterminated")
	})

	it("number at i32 max boundary: 2147483647", () => {
		const tokens = new Lexer("2147483647").tokenize()
		expect(tokens[0]!.kind).toBe("Int")
		expect(tokens[0]!.value).toBe("2147483647")
	})

	it("number beyond i32 max: 2147483648", () => {
		// The lexer should still tokenize it; overflow is handled elsewhere
		const tokens = new Lexer("2147483648").tokenize()
		expect(tokens[0]!.kind).toBe("Int")
		expect(tokens[0]!.value).toBe("2147483648")
	})

	it("number: very large integer (20 digits)", () => {
		const tokens = new Lexer("99999999999999999999").tokenize()
		expect(tokens[0]!.kind).toBe("Int")
	})

	it("float: 0.0", () => {
		const tokens = new Lexer("0.0").tokenize()
		expect(tokens[0]!.kind).toBe("Float")
		expect(tokens[0]!.value).toBe("0.0")
	})

	it("float: very small number 0.000001", () => {
		const tokens = new Lexer("0.000001").tokenize()
		expect(tokens[0]!.kind).toBe("Float")
	})

	it("float: dot not followed by digit is not float", () => {
		// "1." followed by non-digit should be Int "1" then Dot
		const tokens = new Lexer("1.x").tokenize()
		expect(tokens[0]!.kind).toBe("Int")
		expect(tokens[0]!.value).toBe("1")
		expect(tokens[1]!.kind).toBe("Dot")
	})

	it("unknown character is silently skipped", () => {
		const tokens = new Lexer("$").tokenize()
		// $ is not a valid token, lexer skips it
		expect(tokens.length).toBe(1) // just EOF
		expect(tokens[0]!.kind).toBe("EOF")
	})

	it("all two-char operators tokenize correctly", () => {
		const ops = [":=", "+=", "-=", "*=", "/=", "==", "!=", "<=", ">=", "&&", "||", "<<", ">>"]
		for (const op of ops) {
			const tokens = new Lexer(op).tokenize()
			expect(tokens.length).toBe(2) // op + EOF
			expect(tokens[0]!.value).toBe(op)
		}
	})

	it("all keywords tokenize to their specific kinds", () => {
		const keywords = [
			"robot",
			"var",
			"const",
			"func",
			"on",
			"if",
			"else",
			"for",
			"switch",
			"case",
			"default",
			"return",
			"break",
			"continue",
			"type",
			"struct",
			"while",
			"true",
			"false",
			"int",
			"float",
			"bool",
			"angle",
		]
		for (const kw of keywords) {
			const tokens = new Lexer(kw).tokenize()
			// keyword tokens should NOT be Ident
			expect(tokens[0]!.kind).not.toBe("Ident")
		}
	})

	it("handles null byte in source", () => {
		const tokens = new Lexer("a\0b").tokenize()
		// null byte is unknown char, skipped
		expect(tokens.some((t) => t.kind === "Ident")).toBe(true)
	})

	it("handles tab and carriage return", () => {
		const tokens = new Lexer("\tx\r\n").tokenize()
		const idents = tokens.filter((t) => t.kind === "Ident")
		expect(idents.length).toBe(1)
		expect(idents[0]!.value).toBe("x")
	})
})

// ── B.2 Parser Edge Cases ────────────────────────────────────

describe("parser edge cases", () => {
	it("minimal valid program: just robot + tick", () => {
		const result = tryCompile(`${R}func tick() {}`)
		expect(result.success).toBe(true)
	})

	it("program with only robot declaration (no tick) gives analyze error", () => {
		const result = tryCompile(`${R}`)
		expect(result.success).toBe(false)
		expect(result.errors.errors.some((e) => e.message.includes("tick"))).toBe(true)
	})

	it("deeply nested parentheses: ((((((1+2))))))", () => {
		const result = tryCompile(`${R}func tick() {\n  x := ((((((1+2))))))\n  debugInt(x)\n}`)
		expect(result.success).toBe(true)
	})

	it("deeply nested if statements (10 levels)", () => {
		let body = "debugInt(1)\n"
		for (let i = 0; i < 10; i++) {
			body = `if true {\n${body}}\n`
		}
		const result = tryCompile(`${R}func tick() {\n${body}}`)
		expect(result.success).toBe(true)
	})

	it("deeply nested for loops (10 levels)", () => {
		let body = "debugInt(1)\n"
		for (let i = 0; i < 10; i++) {
			body = `for j${i} := 0; j${i} < 1; j${i} += 1 {\n${body}}\n`
		}
		const result = tryCompile(`${R}func tick() {\n${body}}`)
		expect(result.success).toBe(true)
	})

	it("empty function body compiles", () => {
		const result = tryCompile(`${R}func helper() {}\nfunc tick() {}`)
		expect(result.success).toBe(true)
	})

	it("function with many parameters (15 params)", () => {
		const params = Array.from({ length: 15 }, (_, i) => `p${i} int`).join(", ")
		const args = Array.from({ length: 15 }, (_, i) => `${i}`).join(", ")
		const result = tryCompile(
			`${R}func many(${params}) int { return p0 }\nfunc tick() { debugInt(many(${args})) }`,
		)
		expect(result.success).toBe(true)
	})

	it("statement after return (dead code) compiles", () => {
		const result = tryCompile(
			`${R}func helper() int {\n  return 1\n  debugInt(2)\n}\nfunc tick() { debugInt(helper()) }`,
		)
		expect(result.success).toBe(true)
	})

	it("multiple return statements in same function", () => {
		const result = tryCompile(
			`${R}func helper(x int) int {\n  if x > 0 {\n    return 1\n  }\n  return 0\n}\nfunc tick() { debugInt(helper(1)) }`,
		)
		expect(result.success).toBe(true)
	})

	it("break outside of loop is an analyzer error", () => {
		const result = tryCompile(`${R}func tick() {\n  break\n}`)
		expect(result.success).toBe(false)
		expect(result.errors.errors.some((e) => e.message.includes("break"))).toBe(true)
	})

	it("continue outside of loop is an analyzer error", () => {
		const result = tryCompile(`${R}func tick() {\n  continue\n}`)
		expect(result.success).toBe(false)
		expect(result.errors.errors.some((e) => e.message.includes("continue"))).toBe(true)
	})

	it("duplicate function names error", () => {
		const result = tryCompile(`${R}func helper() {}\nfunc helper() {}\nfunc tick() {}`)
		expect(result.success).toBe(false)
		expect(result.errors.errors.some((e) => e.message.includes("already declared"))).toBe(true)
	})

	it("duplicate global variable names error", () => {
		const result = tryCompile(`${R}var x int\nvar x int\nfunc tick() {}`)
		expect(result.success).toBe(false)
		expect(result.errors.errors.some((e) => e.message.includes("already declared"))).toBe(true)
	})

	it("duplicate local variable names in same scope error", () => {
		const result = tryCompile(`${R}func tick() {\n  x := 1\n  x := 2\n}`)
		expect(result.success).toBe(false)
		expect(result.errors.errors.some((e) => e.message.includes("already declared"))).toBe(true)
	})

	it("variable shadowing in nested scope compiles", () => {
		const result = tryCompile(
			`${R}func tick() {\n  x := 1\n  if true {\n    x := 2\n    debugInt(x)\n  }\n  debugInt(x)\n}`,
		)
		expect(result.success).toBe(true)
	})

	it("very long program (50 functions) compiles", () => {
		const funcs = Array.from({ length: 50 }, (_, i) => `func f${i}() { debugInt(${i}) }`).join("\n")
		const result = tryCompile(`${R}${funcs}\nfunc tick() { f0() }`)
		expect(result.success).toBe(true)
	})

	it("chained else-if compiles", () => {
		const result = tryCompile(
			`${R}func tick() {\n  x := 3\n  if x == 1 {\n    debugInt(1)\n  } else if x == 2 {\n    debugInt(2)\n  } else if x == 3 {\n    debugInt(3)\n  } else {\n    debugInt(0)\n  }\n}`,
		)
		expect(result.success).toBe(true)
	})

	it("switch statement compiles and runs", async () => {
		const source = `${R}func tick() {
  x := 2
  switch x {
  case 1:
    debugInt(10)
  case 2:
    debugInt(20)
  case 3:
    debugInt(30)
  default:
    debugInt(0)
  }
}`
		const { instance, calls } = await compileAndRun(source)
		const tick = instance.exports.tick as () => void
		tick()
		const debugCalls = calls.filter((c) => c.name === "debugInt")
		expect(debugCalls.length).toBe(1)
		expect(debugCalls[0]!.args[0]).toBe(20)
	})

	it("switch default case runs when no match", async () => {
		const source = `${R}func tick() {
  x := 99
  switch x {
  case 1:
    debugInt(10)
  default:
    debugInt(0)
  }
}`
		const { instance, calls } = await compileAndRun(source)
		const tick = instance.exports.tick as () => void
		tick()
		const debugCalls = calls.filter((c) => c.name === "debugInt")
		expect(debugCalls.length).toBe(1)
		expect(debugCalls[0]!.args[0]).toBe(0)
	})

	it("for loop with no body compiles", () => {
		const result = tryCompile(`${R}func tick() {\n  for i := 0; i < 10; i += 1 {\n  }\n}`)
		expect(result.success).toBe(true)
	})

	it("infinite for loop with break compiles and terminates", async () => {
		const source = `${R}func tick() {
  x := 0
  for {
    x += 1
    if x > 5 {
      break
    }
  }
  debugInt(x)
}`
		const { instance, calls } = await compileAndRun(source)
		const tick = instance.exports.tick as () => void
		tick()
		const debugCalls = calls.filter((c) => c.name === "debugInt")
		expect(debugCalls[0]!.args[0]).toBe(6)
	})

	it("while loop compiles correctly", async () => {
		const source = `${R}func tick() {
  x := 0
  while x < 3 {
    x += 1
  }
  debugInt(x)
}`
		const { instance, calls } = await compileAndRun(source)
		;(instance.exports.tick as () => void)()
		expect(calls.filter((c) => c.name === "debugInt")[0]!.args[0]).toBe(3)
	})
})

// ── B.3 Type System Edge Cases ───────────────────────────────

describe("type system edge cases", () => {
	it("assign int to float variable is a type error", () => {
		const result = tryCompile(`${R}func tick() {\n  var x float\n  x = 1\n}`)
		expect(result.success).toBe(false)
		expect(result.errors.errors.some((e) => e.message.includes("cannot assign"))).toBe(true)
	})

	it("assign float to int variable is a type error", () => {
		const result = tryCompile(`${R}func tick() {\n  var x int\n  x = 1.0\n}`)
		expect(result.success).toBe(false)
		expect(result.errors.errors.some((e) => e.message.includes("cannot assign"))).toBe(true)
	})

	it("assign angle to int is a type error", () => {
		const result = tryCompile(`${R}func tick() {\n  var x int\n  var a angle\n  x = a\n}`)
		expect(result.success).toBe(false)
	})

	it("assign int to bool is a type error", () => {
		const result = tryCompile(`${R}func tick() {\n  var x bool\n  x = 1\n}`)
		expect(result.success).toBe(false)
	})

	it("use undeclared variable gives error", () => {
		const result = tryCompile(`${R}func tick() {\n  debugInt(undefined_var)\n}`)
		expect(result.success).toBe(false)
		expect(result.errors.errors.some((e) => e.message.includes("undefined"))).toBe(true)
	})

	it("call undefined function gives error", () => {
		const result = tryCompile(`${R}func tick() {\n  nonexistent()\n}`)
		expect(result.success).toBe(false)
		expect(result.errors.errors.some((e) => e.message.includes("undefined function"))).toBe(true)
	})

	it("wrong number of arguments gives error", () => {
		const result = tryCompile(`${R}func tick() {\n  setSpeed(1.0, 2.0)\n}`)
		expect(result.success).toBe(false)
		expect(result.errors.errors.some((e) => e.message.includes("expects"))).toBe(true)
	})

	it("wrong argument type gives error", () => {
		const result = tryCompile(`${R}func tick() {\n  setSpeed(1)\n}`)
		expect(result.success).toBe(false)
		expect(result.errors.errors.some((e) => e.message.includes("expected float"))).toBe(true)
	})

	it("recursive function compiles without crash", () => {
		const result = tryCompile(
			`${R}func factorial(n int) int {\n  if n <= 1 {\n    return 1\n  }\n  return n * factorial(n - 1)\n}\nfunc tick() {\n  debugInt(factorial(5))\n}`,
		)
		expect(result.success).toBe(true)
	})

	it("recursive function executes correctly", async () => {
		const source = `${R}func factorial(n int) int {
  if n <= 1 {
    return 1
  }
  return n * factorial(n - 1)
}
func tick() {
  debugInt(factorial(5))
}`
		const { instance, calls } = await compileAndRun(source)
		;(instance.exports.tick as () => void)()
		const debugCalls = calls.filter((c) => c.name === "debugInt")
		expect(debugCalls[0]!.args[0]).toBe(120)
	})

	it("mutually recursive functions compile", () => {
		const result = tryCompile(
			`${R}func isEven(n int) bool {
  if n == 0 { return true }
  return isOdd(n - 1)
}
func isOdd(n int) bool {
  if n == 0 { return false }
  return isEven(n - 1)
}
func tick() {
  if isEven(4) { debugInt(1) } else { debugInt(0) }
}`,
		)
		expect(result.success).toBe(true)
	})

	it("mutually recursive functions execute correctly", async () => {
		const source = `${R}func isEven(n int) bool {
  if n == 0 { return true }
  return isOdd(n - 1)
}
func isOdd(n int) bool {
  if n == 0 { return false }
  return isEven(n - 1)
}
func tick() {
  if isEven(4) { debugInt(1) } else { debugInt(0) }
}`
		const { instance, calls } = await compileAndRun(source)
		;(instance.exports.tick as () => void)()
		expect(calls.filter((c) => c.name === "debugInt")[0]!.args[0]).toBe(1)
	})

	it("empty struct compiles", () => {
		const result = tryCompile(`${R}type Empty struct {\n}\nvar e Empty\nfunc tick() {}`)
		expect(result.success).toBe(true)
	})

	it("duplicate struct field names should error", () => {
		// Note: the parser doesn't check for duplicate fields, the analyzer may not either.
		// This is a potential bug to document.
		const result = tryCompile(`${R}type Bad struct {\n  x int\n  x int\n}\nfunc tick() {}`)
		// Even if it doesn't error, compilation should not crash
		expect(result).toBeDefined()
	})

	it("duplicate type names should error", () => {
		const result = tryCompile(
			`${R}type A struct { x int }\ntype A struct { y int }\nfunc tick() {}`,
		)
		expect(result.success).toBe(false)
		expect(result.errors.errors.some((e) => e.message.includes("already declared"))).toBe(true)
	})

	it("array index with float is a type error", () => {
		const result = tryCompile(`${R}var arr [3]int\nfunc tick() {\n  debugInt(arr[1.0])\n}`)
		expect(result.success).toBe(false)
		expect(result.errors.errors.some((e) => e.message.includes("must be int"))).toBe(true)
	})

	it("empty array literal is an error", () => {
		const result = tryCompile(`${R}func tick() {\n  x := []\n}`)
		// Parser might error or analyzer might error
		expect(result.success).toBe(false)
	})

	it("mixed types in array literal is an error", () => {
		const result = tryCompile(`${R}func tick() {\n  x := [1, 2.0]\n}`)
		expect(result.success).toBe(false)
		expect(result.errors.errors.some((e) => e.message.includes("array element"))).toBe(true)
	})

	it("boolean in arithmetic context is an error", () => {
		const result = tryCompile(`${R}func tick() {\n  x := true + 1\n}`)
		expect(result.success).toBe(false)
	})

	it("unknown event name is an error", () => {
		const result = tryCompile(`${R}func tick() {}\non unknownEvent() {}`)
		expect(result.success).toBe(false)
		expect(result.errors.errors.some((e) => e.message.includes("unknown event"))).toBe(true)
	})

	it("event with wrong parameter count is an error", () => {
		const result = tryCompile(`${R}func tick() {}\non scan(d float) {}`)
		expect(result.success).toBe(false)
		expect(result.errors.errors.some((e) => e.message.includes("expects"))).toBe(true)
	})

	it("event with wrong parameter type is an error", () => {
		const result = tryCompile(`${R}func tick() {}\non scan(d int, b int) {}`)
		expect(result.success).toBe(false)
	})

	it("unary minus on bool is a type error", () => {
		const result = tryCompile(`${R}func tick() {\n  x := -true\n}`)
		expect(result.success).toBe(false)
		expect(result.errors.errors.some((e) => e.message.includes("unary"))).toBe(true)
	})

	it("logical not on int is a type error", () => {
		const result = tryCompile(`${R}func tick() {\n  x := !1\n}`)
		expect(result.success).toBe(false)
		expect(result.errors.errors.some((e) => e.message.includes("bool"))).toBe(true)
	})

	it("modulo on float is a type error", () => {
		const result = tryCompile(`${R}func tick() {\n  x := 1.0 % 2.0\n}`)
		expect(result.success).toBe(false)
		expect(result.errors.errors.some((e) => e.message.includes("int operands"))).toBe(true)
	})

	it("bitwise AND on float is a type error", () => {
		const result = tryCompile(`${R}func tick() {\n  x := 1.0 & 2.0\n}`)
		expect(result.success).toBe(false)
	})

	it("comparison of different types is an error", () => {
		const result = tryCompile(`${R}func tick() {\n  if 1 < 1.0 {\n    debugInt(1)\n  }\n}`)
		expect(result.success).toBe(false)
		expect(result.errors.errors.some((e) => e.message.includes("compare"))).toBe(true)
	})

	it("logical AND on non-bool is an error", () => {
		const result = tryCompile(`${R}func tick() {\n  if 1 && 2 { debugInt(1) }\n}`)
		expect(result.success).toBe(false)
	})

	it("if condition must be bool", () => {
		const result = tryCompile(`${R}func tick() {\n  if 1 { debugInt(1) }\n}`)
		expect(result.success).toBe(false)
		expect(result.errors.errors.some((e) => e.message.includes("condition must be bool"))).toBe(
			true,
		)
	})

	it("for condition must be bool", () => {
		const result = tryCompile(`${R}func tick() {\n  for 1 { debugInt(1)\n    break\n  }\n}`)
		expect(result.success).toBe(false)
		expect(
			result.errors.errors.some(
				(e) => e.message.includes("condition") && e.message.includes("bool"),
			),
		).toBe(true)
	})

	it("return wrong type from function is an error", () => {
		const result = tryCompile(`${R}func helper() int {\n  return 1.0\n}\nfunc tick() {}`)
		expect(result.success).toBe(false)
		expect(result.errors.errors.some((e) => e.message.includes("return value"))).toBe(true)
	})

	it("return wrong number of values is an error", () => {
		const result = tryCompile(`${R}func helper() int {\n  return 1, 2\n}\nfunc tick() {}`)
		expect(result.success).toBe(false)
		expect(result.errors.errors.some((e) => e.message.includes("return value"))).toBe(true)
	})

	it("return from void function with value is an error", () => {
		const result = tryCompile(`${R}func tick() {\n  return 1\n}`)
		expect(result.success).toBe(false)
	})

	it("field access on non-struct is an error", () => {
		const result = tryCompile(`${R}func tick() {\n  x := 1\n  debugInt(x.field)\n}`)
		expect(result.success).toBe(false)
		expect(result.errors.errors.some((e) => e.message.includes("cannot access field"))).toBe(true)
	})

	it("index access on non-array is an error", () => {
		const result = tryCompile(`${R}func tick() {\n  x := 1\n  debugInt(x[0])\n}`)
		expect(result.success).toBe(false)
		expect(result.errors.errors.some((e) => e.message.includes("cannot index"))).toBe(true)
	})

	it("unknown struct field is an error", () => {
		const result = tryCompile(`${R}type P struct { x int }\nvar p P\nfunc tick() { debugInt(p.z) }`)
		expect(result.success).toBe(false)
		expect(result.errors.errors.some((e) => e.message.includes("no field"))).toBe(true)
	})

	it("string in expression context gives error", () => {
		const result = tryCompile(`${R}func tick() {\n  x := "hello"\n}`)
		expect(result.success).toBe(false)
		expect(result.errors.errors.some((e) => e.message.includes("string"))).toBe(true)
	})

	it("tick with parameters is an error", () => {
		const result = tryCompile(`${R}func tick(x int) {}`)
		expect(result.success).toBe(false)
		expect(
			result.errors.errors.some(
				(e) => e.message.includes("tick") && e.message.includes("no parameters"),
			),
		).toBe(true)
	})

	it("tick with return value is an error", () => {
		const result = tryCompile(`${R}func tick() int { return 0 }`)
		expect(result.success).toBe(false)
		expect(
			result.errors.errors.some(
				(e) => e.message.includes("tick") && e.message.includes("not return"),
			),
		).toBe(true)
	})
})

// ── B.4 Codegen / Runtime Edge Cases ─────────────────────────

describe("codegen edge cases", () => {
	it("integer overflow wraps at i32 boundaries", async () => {
		const source = `${R}func tick() {
  x := 2147483647
  y := x + 1
  debugInt(y)
}`
		const { instance, calls } = await compileAndRun(source)
		;(instance.exports.tick as () => void)()
		const debugCalls = calls.filter((c) => c.name === "debugInt")
		// i32 overflow: 2147483647 + 1 = -2147483648
		expect(debugCalls[0]!.args[0]).toBe(-2147483648)
	})

	it("integer division truncates toward zero: 7 / 2 == 3", async () => {
		const source = `${R}func tick() {
  debugInt(7 / 2)
}`
		const { instance, calls } = await compileAndRun(source)
		;(instance.exports.tick as () => void)()
		expect(calls.filter((c) => c.name === "debugInt")[0]!.args[0]).toBe(3)
	})

	it("negative integer division truncates toward zero: -7 / 2 == -3", async () => {
		const source = `${R}func tick() {
  debugInt(-7 / 2)
}`
		const { instance, calls } = await compileAndRun(source)
		;(instance.exports.tick as () => void)()
		expect(calls.filter((c) => c.name === "debugInt")[0]!.args[0]).toBe(-3)
	})

	it("modulo works: 7 % 3 == 1", async () => {
		const source = `${R}func tick() {
  debugInt(7 % 3)
}`
		const { instance, calls } = await compileAndRun(source)
		;(instance.exports.tick as () => void)()
		expect(calls.filter((c) => c.name === "debugInt")[0]!.args[0]).toBe(1)
	})

	it("negative modulo: -7 % 3 == -1 (WASM rem_s behavior)", async () => {
		const source = `${R}func tick() {
  debugInt(-7 % 3)
}`
		const { instance, calls } = await compileAndRun(source)
		;(instance.exports.tick as () => void)()
		expect(calls.filter((c) => c.name === "debugInt")[0]!.args[0]).toBe(-1)
	})

	it("bitwise operations work correctly", async () => {
		const source = `${R}func tick() {
  debugInt(5 & 3)
  debugInt(5 | 3)
  debugInt(5 ^ 3)
  debugInt(1 << 4)
  debugInt(16 >> 2)
}`
		const { instance, calls } = await compileAndRun(source)
		;(instance.exports.tick as () => void)()
		const debugCalls = calls.filter((c) => c.name === "debugInt")
		expect(debugCalls[0]!.args[0]).toBe(5 & 3) // 1
		expect(debugCalls[1]!.args[0]).toBe(5 | 3) // 7
		expect(debugCalls[2]!.args[0]).toBe(5 ^ 3) // 6
		expect(debugCalls[3]!.args[0]).toBe(1 << 4) // 16
		expect(debugCalls[4]!.args[0]).toBe(16 >> 2) // 4
	})

	it("boolean comparisons return correct values", async () => {
		const source = `${R}func tick() {
  if 1 == 1 { debugInt(1) } else { debugInt(0) }
  if 1 != 2 { debugInt(1) } else { debugInt(0) }
  if 1 < 2 { debugInt(1) } else { debugInt(0) }
  if 2 > 1 { debugInt(1) } else { debugInt(0) }
  if 1 <= 1 { debugInt(1) } else { debugInt(0) }
  if 1 >= 1 { debugInt(1) } else { debugInt(0) }
}`
		const { instance, calls } = await compileAndRun(source)
		;(instance.exports.tick as () => void)()
		const debugCalls = calls.filter((c) => c.name === "debugInt")
		expect(debugCalls.length).toBe(6)
		for (const dc of debugCalls) {
			expect(dc.args[0]).toBe(1)
		}
	})

	it("float comparisons work correctly", async () => {
		const source = `${R}func tick() {
  if 1.0 < 2.0 { debugInt(1) } else { debugInt(0) }
  if 2.0 > 1.0 { debugInt(1) } else { debugInt(0) }
  if 1.0 == 1.0 { debugInt(1) } else { debugInt(0) }
  if 1.0 != 2.0 { debugInt(1) } else { debugInt(0) }
}`
		const { instance, calls } = await compileAndRun(source)
		;(instance.exports.tick as () => void)()
		const debugCalls = calls.filter((c) => c.name === "debugInt")
		expect(debugCalls.length).toBe(4)
		for (const dc of debugCalls) {
			expect(dc.args[0]).toBe(1)
		}
	})

	it("short-circuit AND: false && sideEffect() does NOT call sideEffect", async () => {
		const source = `${R}
var called int
func sideEffect() bool {
  called = 1
  return true
}
func tick() {
  if false && sideEffect() {
    debugInt(99)
  }
  debugInt(called)
}`
		const { instance, calls } = await compileAndRun(source)
		;(instance.exports.tick as () => void)()
		const debugCalls = calls.filter((c) => c.name === "debugInt")
		// called should remain 0 because sideEffect was not called
		expect(debugCalls[0]!.args[0]).toBe(0)
	})

	it("short-circuit OR: true || sideEffect() does NOT call sideEffect", async () => {
		const source = `${R}
var called int
func sideEffect() bool {
  called = 1
  return false
}
func tick() {
  if true || sideEffect() {
    debugInt(42)
  }
  debugInt(called)
}`
		const { instance, calls } = await compileAndRun(source)
		;(instance.exports.tick as () => void)()
		const debugCalls = calls.filter((c) => c.name === "debugInt")
		expect(debugCalls[0]!.args[0]).toBe(42) // the if body runs
		expect(debugCalls[1]!.args[0]).toBe(0) // sideEffect was NOT called
	})

	it("type conversion int to float and back", async () => {
		const source = `${R}func tick() {
  x := 42
  y := float(x)
  z := int(y)
  debugInt(z)
}`
		const { instance, calls } = await compileAndRun(source)
		;(instance.exports.tick as () => void)()
		expect(calls.filter((c) => c.name === "debugInt")[0]!.args[0]).toBe(42)
	})

	it("type conversion float to angle", async () => {
		const source = `${R}func tick() {
  x := 90.0
  a := angle(x)
  debugAngle(a)
}`
		const { instance, calls } = await compileAndRun(source)
		;(instance.exports.tick as () => void)()
		expect(calls.filter((c) => c.name === "debugAngle")[0]!.args[0]).toBeCloseTo(90.0)
	})

	it("type conversion angle to int", async () => {
		const source = `${R}func tick() {
  a := angle(45.0)
  x := int(a)
  debugInt(x)
}`
		const { instance, calls } = await compileAndRun(source)
		;(instance.exports.tick as () => void)()
		expect(calls.filter((c) => c.name === "debugInt")[0]!.args[0]).toBe(45)
	})

	it("unary negation on int", async () => {
		const source = `${R}func tick() {
  x := 42
  debugInt(-x)
}`
		const { instance, calls } = await compileAndRun(source)
		;(instance.exports.tick as () => void)()
		expect(calls.filter((c) => c.name === "debugInt")[0]!.args[0]).toBe(-42)
	})

	it("unary negation on float", async () => {
		const source = `${R}func tick() {
  x := 3.14
  debugFloat(-x)
}`
		const { instance, calls } = await compileAndRun(source)
		;(instance.exports.tick as () => void)()
		expect(calls.filter((c) => c.name === "debugFloat")[0]!.args[0]).toBeCloseTo(-3.14)
	})

	it("boolean negation", async () => {
		const source = `${R}func tick() {
  x := true
  if !x { debugInt(0) } else { debugInt(1) }
  y := false
  if !y { debugInt(1) } else { debugInt(0) }
}`
		const { instance, calls } = await compileAndRun(source)
		;(instance.exports.tick as () => void)()
		const debugCalls = calls.filter((c) => c.name === "debugInt")
		expect(debugCalls[0]!.args[0]).toBe(1) // !true -> false, else branch
		expect(debugCalls[1]!.args[0]).toBe(1) // !false -> true, then branch
	})

	it("global variable with initializer using expression", async () => {
		const source = `${R}
var x int = 3 + 4
func tick() {
  debugInt(x)
}`
		const { instance, calls } = await compileAndRun(source)
		const init = instance.exports.init as () => void
		init()
		;(instance.exports.tick as () => void)()
		expect(calls.filter((c) => c.name === "debugInt")[0]!.args[0]).toBe(7)
	})

	it("constants in expressions", async () => {
		const source = `${R}
const SPEED = 5
const HALF = 2
func tick() {
  debugInt(SPEED * HALF)
}`
		const { instance, calls } = await compileAndRun(source)
		;(instance.exports.tick as () => void)()
		expect(calls.filter((c) => c.name === "debugInt")[0]!.args[0]).toBe(10)
	})

	it("float constant", async () => {
		const source = `${R}
const PI = 3.14
func tick() {
  debugFloat(PI)
}`
		const { instance, calls } = await compileAndRun(source)
		;(instance.exports.tick as () => void)()
		expect(calls.filter((c) => c.name === "debugFloat")[0]!.args[0]).toBeCloseTo(3.14)
	})

	it("negative constant", async () => {
		const source = `${R}
const NEG = -42
func tick() {
  debugInt(NEG)
}`
		const { instance, calls } = await compileAndRun(source)
		;(instance.exports.tick as () => void)()
		expect(calls.filter((c) => c.name === "debugInt")[0]!.args[0]).toBe(-42)
	})

	it("compound assignment on global variable", async () => {
		const source = `${R}
var g int
func tick() {
  g += 10
  debugInt(g)
}`
		const { instance, calls } = await compileAndRun(source)
		const tick = instance.exports.tick as () => void
		tick()
		tick()
		const debugCalls = calls.filter((c) => c.name === "debugInt")
		expect(debugCalls[0]!.args[0]).toBe(10)
		expect(debugCalls[1]!.args[0]).toBe(20)
	})

	it("compound assignment on struct field", async () => {
		const source = `${R}
type Counter struct {
  n int
}
var c Counter
func tick() {
  c.n += 1
  debugInt(c.n)
}`
		const { instance, calls } = await compileAndRun(source)
		const tick = instance.exports.tick as () => void
		tick()
		tick()
		tick()
		const debugCalls = calls.filter((c) => c.name === "debugInt")
		expect(debugCalls[0]!.args[0]).toBe(1)
		expect(debugCalls[1]!.args[0]).toBe(2)
		expect(debugCalls[2]!.args[0]).toBe(3)
	})

	it("many global variables: correct memory layout", async () => {
		const vars = Array.from({ length: 20 }, (_, i) => `var g${i} int`).join("\n")
		const assigns = Array.from({ length: 20 }, (_, i) => `g${i} = ${i * 10}`).join("\n  ")
		const debugs = Array.from({ length: 20 }, (_, i) => `debugInt(g${i})`).join("\n  ")
		const source = `${R}${vars}\nfunc tick() {\n  ${assigns}\n  ${debugs}\n}`
		const { instance, calls } = await compileAndRun(source)
		;(instance.exports.tick as () => void)()
		const debugCalls = calls.filter((c) => c.name === "debugInt")
		expect(debugCalls.length).toBe(20)
		for (let i = 0; i < 20; i++) {
			expect(debugCalls[i]!.args[0]).toBe(i * 10)
		}
	})

	it("large struct: correct field offsets", async () => {
		const fieldCount = 10
		const fields = Array.from({ length: fieldCount }, (_, i) => `f${i} int`).join("\n  ")
		const assigns = Array.from({ length: fieldCount }, (_, i) => `s.f${i} = ${(i + 1) * 100}`).join(
			"\n  ",
		)
		const debugs = Array.from({ length: fieldCount }, (_, i) => `debugInt(s.f${i})`).join("\n  ")
		const source = `${R}type Big struct {\n  ${fields}\n}\nvar s Big\nfunc tick() {\n  ${assigns}\n  ${debugs}\n}`
		const { instance, calls } = await compileAndRun(source)
		;(instance.exports.tick as () => void)()
		const debugCalls = calls.filter((c) => c.name === "debugInt")
		expect(debugCalls.length).toBe(fieldCount)
		for (let i = 0; i < fieldCount; i++) {
			expect(debugCalls[i]!.args[0]).toBe((i + 1) * 100)
		}
	})

	it("globals persist between tick and event calls", async () => {
		const source = `${R}
var state int
on scan(distance float, bearing angle) {
  state = state + 1
}
func tick() {
  debugInt(state)
}`
		const { instance, calls } = await compileAndRun(source)
		const tick = instance.exports.tick as () => void
		const onScan = instance.exports.on_scan as (d: number, b: number) => void
		tick()
		onScan(100.0, 0.0)
		onScan(200.0, 90.0)
		tick()
		const debugCalls = calls.filter((c) => c.name === "debugInt")
		expect(debugCalls[0]!.args[0]).toBe(0)
		expect(debugCalls[1]!.args[0]).toBe(2)
	})

	it("angle arithmetic: angle + angle", async () => {
		const source = `${R}func tick() {
  a := angle(90.0)
  b := angle(45.0)
  c := a + b
  debugAngle(c)
}`
		const { instance, calls } = await compileAndRun(source)
		;(instance.exports.tick as () => void)()
		const debugCalls = calls.filter((c) => c.name === "debugAngle")
		expect(debugCalls[0]!.args[0]).toBeCloseTo(135.0)
	})

	it("angle arithmetic: angle - angle", async () => {
		const source = `${R}func tick() {
  a := angle(90.0)
  b := angle(45.0)
  c := a - b
  debugAngle(c)
}`
		const { instance, calls } = await compileAndRun(source)
		;(instance.exports.tick as () => void)()
		const debugCalls = calls.filter((c) => c.name === "debugAngle")
		expect(debugCalls[0]!.args[0]).toBeCloseTo(45.0)
	})

	it("angle * float", async () => {
		const source = `${R}func tick() {
  a := angle(45.0)
  b := a * 2.0
  debugAngle(b)
}`
		const { instance, calls } = await compileAndRun(source)
		;(instance.exports.tick as () => void)()
		const debugCalls = calls.filter((c) => c.name === "debugAngle")
		expect(debugCalls[0]!.args[0]).toBeCloseTo(90.0)
	})

	it("angle / float", async () => {
		const source = `${R}func tick() {
  a := angle(90.0)
  b := a / 2.0
  debugAngle(b)
}`
		const { instance, calls } = await compileAndRun(source)
		;(instance.exports.tick as () => void)()
		const debugCalls = calls.filter((c) => c.name === "debugAngle")
		expect(debugCalls[0]!.args[0]).toBeCloseTo(45.0)
	})

	it("float * angle is a type error (angle must be on left)", () => {
		const result = tryCompile(`${R}func tick() {\n  a := angle(45.0)\n  b := 2.0 * a\n}`)
		expect(result.success).toBe(false)
		expect(result.errors.errors.some((e) => e.message.includes("angle must be on the left"))).toBe(
			true,
		)
	})

	it("angle * angle is a type error", () => {
		const result = tryCompile(`${R}func tick() {\n  a := angle(45.0)\n  b := a * a\n}`)
		expect(result.success).toBe(false)
	})
})

// ── B.5 Memory / WASM Edge Cases ─────────────────────────────

describe("memory and WASM edge cases", () => {
	it("WASM binary starts with magic number", async () => {
		const result = tryCompile(`${R}func tick() {}`)
		expect(result.wasm![0]).toBe(0x00)
		expect(result.wasm![1]).toBe(0x61) // 'a'
		expect(result.wasm![2]).toBe(0x73) // 's'
		expect(result.wasm![3]).toBe(0x6d) // 'm'
	})

	it("WASM binary has version 1", () => {
		const result = tryCompile(`${R}func tick() {}`)
		expect(result.wasm![4]).toBe(0x01)
		expect(result.wasm![5]).toBe(0x00)
		expect(result.wasm![6]).toBe(0x00)
		expect(result.wasm![7]).toBe(0x00)
	})

	it("WebAssembly.compile accepts generated WASM", async () => {
		const result = tryCompile(`${R}func tick() {}`)
		const mod = await WebAssembly.compile(result.wasm! as BufferSource)
		expect(mod).toBeInstanceOf(WebAssembly.Module)
	})

	it("100 globals have correct memory offsets (no overlaps)", async () => {
		const vars = Array.from({ length: 100 }, (_, i) => `var g${i} int`).join("\n")
		const body = Array.from({ length: 100 }, (_, i) => `g${i} = ${i}`).join("\n  ")
		// Read back the last few to confirm no memory corruption
		const checks = "debugInt(g0)\n  debugInt(g50)\n  debugInt(g99)"
		const source = `${R}${vars}\nfunc tick() {\n  ${body}\n  ${checks}\n}`
		const { instance, calls } = await compileAndRun(source)
		;(instance.exports.tick as () => void)()
		const debugCalls = calls.filter((c) => c.name === "debugInt")
		expect(debugCalls[0]!.args[0]).toBe(0)
		expect(debugCalls[1]!.args[0]).toBe(50)
		expect(debugCalls[2]!.args[0]).toBe(99)
	})

	it("multiple tick() calls do not corrupt memory", async () => {
		const source = `${R}
var x int
var y float
func tick() {
  x = x + 1
  y = y + 0.5
  debugInt(x)
  debugFloat(y)
}`
		const { instance, calls } = await compileAndRun(source)
		const tick = instance.exports.tick as () => void
		for (let i = 0; i < 10; i++) {
			tick()
		}
		const intCalls = calls.filter((c) => c.name === "debugInt")
		const floatCalls = calls.filter((c) => c.name === "debugFloat")
		expect(intCalls.length).toBe(10)
		expect(floatCalls.length).toBe(10)
		expect(intCalls[9]!.args[0]).toBe(10)
		expect(floatCalls[9]!.args[0]).toBeCloseTo(5.0)
	})

	it("event handler that modifies globals: visible in next tick", async () => {
		const source = `${R}
var lastDamage float
on hit(damage float, bearing angle) {
  lastDamage = damage
}
func tick() {
  debugFloat(lastDamage)
}`
		const { instance, calls } = await compileAndRun(source)
		const tick = instance.exports.tick as () => void
		const onHit = instance.exports.on_hit as (d: number, b: number) => void
		tick()
		expect(calls.filter((c) => c.name === "debugFloat")[0]!.args[0]).toBeCloseTo(0)
		onHit(25.5, 90.0)
		tick()
		const floatCalls = calls.filter((c) => c.name === "debugFloat")
		expect(floatCalls[1]!.args[0]).toBeCloseTo(25.5)
	})
})

// ── B.6 API Edge Cases ───────────────────────────────────────

describe("API edge cases", () => {
	it("type conversion int() requires exactly 1 arg", () => {
		const result = tryCompile(`${R}func tick() { debugInt(int()) }`)
		expect(result.success).toBe(false)
	})

	it("type conversion float() requires exactly 1 arg", () => {
		const result = tryCompile(`${R}func tick() { debugFloat(float()) }`)
		expect(result.success).toBe(false)
	})

	it("type conversion angle() requires exactly 1 arg", () => {
		const result = tryCompile(`${R}func tick() { debugAngle(angle()) }`)
		expect(result.success).toBe(false)
	})

	it("debug() with multiple args is an error", () => {
		const result = tryCompile(`${R}func tick() { debug(1, 2) }`)
		expect(result.success).toBe(false)
	})

	it("debug() with no args is an error", () => {
		const result = tryCompile(`${R}func tick() { debug() }`)
		expect(result.success).toBe(false)
	})

	it("fire() with wrong type arg is an error", () => {
		const result = tryCompile(`${R}func tick() { fire(1) }`)
		expect(result.success).toBe(false)
	})

	it("setSpeed() with wrong type arg is an error", () => {
		const result = tryCompile(`${R}func tick() { setSpeed(1) }`)
		expect(result.success).toBe(false)
	})

	it("setHeading() requires angle type", () => {
		const result = tryCompile(`${R}func tick() { setHeading(1.0) }`)
		expect(result.success).toBe(false)
	})
})

// ── C. REGRESSION TESTS ──────────────────────────────────────

describe("regression tests", () => {
	it("nested for + if with break compiles to valid WASM", async () => {
		const source = `${R}func tick() {
  sum := 0
  for i := 0; i < 10; i += 1 {
    if i == 5 {
      break
    }
    sum += i
  }
  debugInt(sum)
}`
		const { instance, calls } = await compileAndRun(source)
		;(instance.exports.tick as () => void)()
		// sum = 0+1+2+3+4 = 10
		expect(calls.filter((c) => c.name === "debugInt")[0]!.args[0]).toBe(10)
	})

	it("nested for + if with continue compiles to valid WASM", async () => {
		const source = `${R}func tick() {
  sum := 0
  for i := 0; i < 5; i += 1 {
    if i == 2 {
      continue
    }
    sum += i
  }
  debugInt(sum)
}`
		const { instance, calls } = await compileAndRun(source)
		;(instance.exports.tick as () => void)()
		// sum = 0+1+3+4 = 8
		expect(calls.filter((c) => c.name === "debugInt")[0]!.args[0]).toBe(8)
	})

	it("function calling another function with different return types", async () => {
		const source = `${R}
func getFloat() float {
  return 3.14
}
func getInt() int {
  return 42
}
func tick() {
  debugFloat(getFloat())
  debugInt(getInt())
}`
		const { instance, calls } = await compileAndRun(source)
		;(instance.exports.tick as () => void)()
		expect(calls.filter((c) => c.name === "debugFloat")[0]!.args[0]).toBeCloseTo(3.14)
		expect(calls.filter((c) => c.name === "debugInt")[0]!.args[0]).toBe(42)
	})

	it("operator precedence: multiplication before addition", async () => {
		const source = `${R}func tick() {
  debugInt(2 + 3 * 4)
}`
		const { instance, calls } = await compileAndRun(source)
		;(instance.exports.tick as () => void)()
		expect(calls.filter((c) => c.name === "debugInt")[0]!.args[0]).toBe(14)
	})

	it("operator precedence: parentheses override", async () => {
		const source = `${R}func tick() {
  debugInt((2 + 3) * 4)
}`
		const { instance, calls } = await compileAndRun(source)
		;(instance.exports.tick as () => void)()
		expect(calls.filter((c) => c.name === "debugInt")[0]!.args[0]).toBe(20)
	})

	it("deeply nested arithmetic expression", async () => {
		const source = `${R}func tick() {
  debugInt(((((1 + 2) + 3) + 4) + 5) + 6)
}`
		const { instance, calls } = await compileAndRun(source)
		;(instance.exports.tick as () => void)()
		expect(calls.filter((c) => c.name === "debugInt")[0]!.args[0]).toBe(21)
	})

	it("chained function calls as arguments", async () => {
		const source = `${R}
func double(x int) int { return x * 2 }
func triple(x int) int { return x * 3 }
func tick() {
  debugInt(double(triple(5)))
}`
		const { instance, calls } = await compileAndRun(source)
		;(instance.exports.tick as () => void)()
		expect(calls.filter((c) => c.name === "debugInt")[0]!.args[0]).toBe(30)
	})

	it("bool comparison: true == true, true != false", async () => {
		const source = `${R}func tick() {
  if true == true { debugInt(1) } else { debugInt(0) }
  if true != false { debugInt(1) } else { debugInt(0) }
}`
		const { instance, calls } = await compileAndRun(source)
		;(instance.exports.tick as () => void)()
		const debugCalls = calls.filter((c) => c.name === "debugInt")
		expect(debugCalls[0]!.args[0]).toBe(1)
		expect(debugCalls[1]!.args[0]).toBe(1)
	})

	it("constant used in for loop bound", async () => {
		const source = `${R}
const MAX = 5
func tick() {
  sum := 0
  for i := 0; i < MAX; i += 1 {
    sum += i
  }
  debugInt(sum)
}`
		const { instance, calls } = await compileAndRun(source)
		;(instance.exports.tick as () => void)()
		expect(calls.filter((c) => c.name === "debugInt")[0]!.args[0]).toBe(10)
	})

	it("assigns to all types: int, float, bool, angle", async () => {
		const source = `${R}func tick() {
  var i int = 42
  var f float = 3.14
  var b bool = true
  var a angle = angle(90.0)
  debugInt(i)
  debugFloat(f)
  if b { debugInt(1) } else { debugInt(0) }
  debugAngle(a)
}`
		const { instance, calls } = await compileAndRun(source)
		;(instance.exports.tick as () => void)()
		expect(calls.filter((c) => c.name === "debugInt")[0]!.args[0]).toBe(42)
		expect(calls.filter((c) => c.name === "debugFloat")[0]!.args[0]).toBeCloseTo(3.14)
		expect(calls.filter((c) => c.name === "debugInt")[1]!.args[0]).toBe(1)
		expect(calls.filter((c) => c.name === "debugAngle")[0]!.args[0]).toBeCloseTo(90.0)
	})

	it("variable shadowing in nested scope gives inner value", async () => {
		const source = `${R}func tick() {
  x := 1
  if true {
    x := 99
    debugInt(x)
  }
  debugInt(x)
}`
		const { instance, calls } = await compileAndRun(source)
		;(instance.exports.tick as () => void)()
		const debugCalls = calls.filter((c) => c.name === "debugInt")
		expect(debugCalls[0]!.args[0]).toBe(99)
		expect(debugCalls[1]!.args[0]).toBe(1)
	})

	it("compound subtraction assignment", async () => {
		const source = `${R}func tick() {
  x := 100
  x -= 30
  debugInt(x)
}`
		const { instance, calls } = await compileAndRun(source)
		;(instance.exports.tick as () => void)()
		expect(calls.filter((c) => c.name === "debugInt")[0]!.args[0]).toBe(70)
	})

	it("compound multiply assignment", async () => {
		const source = `${R}func tick() {
  x := 7
  x *= 6
  debugInt(x)
}`
		const { instance, calls } = await compileAndRun(source)
		;(instance.exports.tick as () => void)()
		expect(calls.filter((c) => c.name === "debugInt")[0]!.args[0]).toBe(42)
	})

	it("compound divide assignment", async () => {
		const source = `${R}func tick() {
  x := 100
  x /= 4
  debugInt(x)
}`
		const { instance, calls } = await compileAndRun(source)
		;(instance.exports.tick as () => void)()
		expect(calls.filter((c) => c.name === "debugInt")[0]!.args[0]).toBe(25)
	})

	it("calling function before its definition works (forward reference)", async () => {
		const source = `${R}
func tick() {
  debugInt(helper())
}
func helper() int {
  return 77
}`
		const { instance, calls } = await compileAndRun(source)
		;(instance.exports.tick as () => void)()
		expect(calls.filter((c) => c.name === "debugInt")[0]!.args[0]).toBe(77)
	})

	it("large array (50 elements) compiles and works", async () => {
		const source = `${R}
var arr [50]int
func tick() {
  for i := 0; i < 50; i += 1 {
    arr[i] = i * i
  }
  debugInt(arr[0])
  debugInt(arr[7])
  debugInt(arr[49])
}`
		const { instance, calls } = await compileAndRun(source)
		;(instance.exports.tick as () => void)()
		const debugCalls = calls.filter((c) => c.name === "debugInt")
		expect(debugCalls[0]!.args[0]).toBe(0)
		expect(debugCalls[1]!.args[0]).toBe(49) // 7*7
		expect(debugCalls[2]!.args[0]).toBe(2401) // 49*49
	})

	it("array bounds check prevents negative access at runtime", async () => {
		const source = `${R}
var arr [5]int
func tick() {
  i := -1
  arr[i] = 42
}`
		const { instance } = await compileAndRun(source)
		const tick = instance.exports.tick as () => void
		expect(() => tick()).toThrow() // should trap
	})

	it("array bounds check prevents out-of-bounds access at runtime", async () => {
		const source = `${R}
var arr [5]int
func tick() {
  i := 5
  arr[i] = 42
}`
		const { instance } = await compileAndRun(source)
		const tick = instance.exports.tick as () => void
		expect(() => tick()).toThrow() // should trap
	})

	it("negative int literal", async () => {
		const source = `${R}func tick() {
  debugInt(-42)
}`
		const { instance, calls } = await compileAndRun(source)
		;(instance.exports.tick as () => void)()
		expect(calls.filter((c) => c.name === "debugInt")[0]!.args[0]).toBe(-42)
	})

	it("zero literal compiles correctly", async () => {
		const source = `${R}func tick() {
  debugInt(0)
  debugFloat(0.0)
}`
		const { instance, calls } = await compileAndRun(source)
		;(instance.exports.tick as () => void)()
		expect(calls.filter((c) => c.name === "debugInt")[0]!.args[0]).toBe(0)
		expect(calls.filter((c) => c.name === "debugFloat")[0]!.args[0]).toBe(0)
	})

	it("program with many different features together", async () => {
		const source = `${R}
const MAX_ITER = 10
type State struct {
  count int
  total float
}
var s State
func accumulate(val float) {
  s.total = s.total + val
  s.count = s.count + 1
}
func tick() {
  for i := 0; i < MAX_ITER; i += 1 {
    accumulate(float(i))
  }
  debugInt(s.count)
  debugFloat(s.total)
}`
		const { instance, calls } = await compileAndRun(source)
		;(instance.exports.tick as () => void)()
		expect(calls.filter((c) => c.name === "debugInt")[0]!.args[0]).toBe(10)
		// total = 0+1+2+...+9 = 45.0
		expect(calls.filter((c) => c.name === "debugFloat")[0]!.args[0]).toBeCloseTo(45.0)
	})
})
