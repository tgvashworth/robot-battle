import { describe, expect, it } from "vitest"
import type { AnalysisResult } from "../analyzer"
import { analyze } from "../analyzer"
import { Lexer } from "../lexer"
import { parse } from "../parser"
import { INT, typeEq } from "../types"

function analyzeSource(source: string): AnalysisResult {
	const tokens = new Lexer(source).tokenize()
	const { program } = parse(tokens)
	return analyze(program)
}

function analyzeValid(source: string): AnalysisResult {
	const result = analyzeSource(source)
	if (result.errors.hasErrors()) {
		const msgs = result.errors.errors.map((e) => e.message).join("\n")
		throw new Error(`Expected no errors but got:\n${msgs}`)
	}
	return result
}

function expectError(source: string, ...patterns: string[]): void {
	const result = analyzeSource(source)
	expect(result.errors.hasErrors()).toBe(true)
	for (const pattern of patterns) {
		const found = result.errors.errors.some((e) =>
			e.message.toLowerCase().includes(pattern.toLowerCase()),
		)
		expect(
			found,
			`Expected error containing "${pattern}". Got: ${result.errors.errors.map((e) => e.message).join("; ")}`,
		).toBe(true)
	}
}

// Minimal valid robot prefix for all test programs
const R = `robot "Test"\n`

describe("analyzer", () => {
	describe("type inference on :=", () => {
		it("infers int from integer literal", () => {
			const result = analyzeValid(`${R}func tick() {\n  x := 42\n  debugInt(x)\n}`)
			// x should be used as int — no errors means it inferred correctly
			expect(result.errors.hasErrors()).toBe(false)
		})

		it("infers float from float literal", () => {
			const result = analyzeValid(`${R}func tick() {\n  x := 3.14\n  debugFloat(x)\n}`)
			expect(result.errors.hasErrors()).toBe(false)
		})

		it("infers bool from boolean literal", () => {
			const result = analyzeValid(`${R}func tick() {\n  x := true\n  if x { debugInt(1) }\n}`)
			expect(result.errors.hasErrors()).toBe(false)
		})

		it("infers type from function call return", () => {
			const result = analyzeValid(`${R}func tick() {\n  x := getX()\n  debugFloat(x)\n}`)
			expect(result.errors.hasErrors()).toBe(false)
		})
	})

	describe("type mismatch", () => {
		it("rejects assigning float to int variable", () => {
			expectError(`${R}func tick() {\nvar x int = 3.14\n}`, "cannot assign float to int")
		})

		it("rejects assigning int to float variable", () => {
			expectError(`${R}func tick() {\nvar x float = 42\n}`, "cannot assign int to float")
		})
	})

	describe("variable resolution", () => {
		it("errors on undeclared variable", () => {
			expectError(`${R}func tick() {\ny = 1\n}`, "undefined variable")
		})

		it("errors on redeclaration in same scope", () => {
			expectError(`${R}func tick() {\nx := 1\nx := 2\n}`, "already declared")
		})

		it("allows same name in different scopes", () => {
			analyzeValid(
				`${R}func tick() {\nif true {\nx := 1\ndebugInt(x)\n}\nif true {\nx := 2\ndebugInt(x)\n}\n}`,
			)
		})

		it("allows shadowing in nested scope", () => {
			analyzeValid(`${R}func tick() {\nx := 1\nif true {\nx := 2\ndebugInt(x)\n}\ndebugInt(x)\n}`)
		})
	})

	describe("break and continue", () => {
		it("errors on break outside loop", () => {
			expectError(`${R}func tick() {\nbreak\n}`, "break outside")
		})

		it("errors on continue outside loop", () => {
			expectError(`${R}func tick() {\ncontinue\n}`, "continue outside")
		})

		it("allows break inside for loop", () => {
			analyzeValid(`${R}func tick() {\nfor true {\nbreak\n}\n}`)
		})

		it("allows continue inside for loop", () => {
			analyzeValid(`${R}func tick() {\nfor true {\ncontinue\n}\n}`)
		})
	})

	describe("return type checking", () => {
		it("rejects wrong return type", () => {
			expectError(`${R}func f() int {\nreturn true\n}\nfunc tick() {}`, "expected int, got bool")
		})

		it("rejects missing return value", () => {
			expectError(`${R}func f() int {\nreturn\n}\nfunc tick() {}`, "expected 1 return value")
		})

		it("accepts correct return type", () => {
			analyzeValid(`${R}func f() int {\nreturn 42\n}\nfunc tick() {}`)
		})

		it("validates multi-return count", () => {
			expectError(
				`${R}func f() (int, bool) {\nreturn 1\n}\nfunc tick() {}`,
				"expected 2 return value",
			)
		})
	})

	describe("function calls", () => {
		it("errors on wrong argument count", () => {
			expectError(`${R}func tick() {\nfire()\n}`, "expects 1 argument")
		})

		it("errors on extra arguments", () => {
			expectError(`${R}func tick() {\nfire(1.0, 2.0)\n}`, "expects 1 argument")
		})

		it("errors on wrong argument type", () => {
			expectError(`${R}func tick() {\nsetSpeed(true)\n}`, "expected float, got bool")
		})

		it("accepts correct API call", () => {
			analyzeValid(`${R}func tick() {\nsetSpeed(50.0)\nfire(3.0)\n}`)
		})

		it("errors on undefined function", () => {
			expectError(`${R}func tick() {\nunknownFunc()\n}`, "undefined function")
		})
	})

	describe("struct types", () => {
		it("resolves struct field access", () => {
			analyzeValid(
				`${R}type Target struct {\nbearing angle\ndistance float\n}\nvar t Target\nfunc tick() {\ndebugFloat(t.distance)\n}`,
			)
		})

		it("errors on unknown field", () => {
			expectError(
				`${R}type Target struct {\nbearing angle\n}\nvar t Target\nfunc tick() {\ndebugFloat(t.nonexistent)\n}`,
				"no field 'nonexistent'",
			)
		})

		it("errors on field access on non-struct", () => {
			expectError(`${R}var x int\nfunc tick() {\ndebugInt(x.field)\n}`, "cannot access field")
		})

		it("validates struct literal field types", () => {
			expectError(
				`${R}type Target struct {\nbearing angle\n}\nfunc tick() {\nt := Target{ bearing: 42 }\n}`,
				"expected angle, got int",
			)
		})

		it("computes correct field offsets", () => {
			const result = analyzeValid(
				`${R}type Foo struct {\na int\nb float\nc bool\nd angle\n}\nfunc tick() {}`,
			)
			const structType = result.structs.get("Foo")
			expect(structType).toBeDefined()
			if (structType?.kind === "struct") {
				expect(structType.fields).toHaveLength(4)
				expect(structType.fields[0]!.offset).toBe(0)
				expect(structType.fields[1]!.offset).toBe(4)
				expect(structType.fields[2]!.offset).toBe(8)
				expect(structType.fields[3]!.offset).toBe(12)
			}
		})
	})

	describe("array types", () => {
		it("errors on index of non-array", () => {
			expectError(`${R}var x int\nfunc tick() {\ndebugInt(x[0])\n}`, "cannot index")
		})

		it("errors on non-int index", () => {
			expectError(
				`${R}var arr [4]int\nfunc tick() {\ndebugInt(arr[1.5])\n}`,
				"array index must be int",
			)
		})

		it("accepts valid array access", () => {
			analyzeValid(`${R}var arr [4]int\nfunc tick() {\narr[0] = 42\ndebugInt(arr[0])\n}`)
		})
	})

	describe("arithmetic type rules", () => {
		it("no implicit int-to-float", () => {
			expectError(`${R}func tick() {\nx := 1.0\nx = x + 42\n}`, "cannot use '+' on float and int")
		})

		it("angle + angle = angle", () => {
			analyzeValid(
				`${R}func tick() {\na := angle(90)\nb := angle(45)\nc := a + b\nsetHeading(c)\n}`,
			)
		})

		it("angle * float = angle", () => {
			analyzeValid(`${R}func tick() {\na := angle(90)\nb := a * 2.0\nsetHeading(b)\n}`)
		})

		it("float * angle = ERROR (angle must be on left)", () => {
			expectError(`${R}func tick() {\na := angle(90)\nb := 2.0 * a\n}`, "angle must be on the left")
		})

		it("bool in arithmetic = ERROR", () => {
			expectError(`${R}func tick() {\nx := true + 1\n}`, "cannot use '+'")
		})

		it("modulo requires int", () => {
			expectError(`${R}func tick() {\nx := 1.0 % 2.0\n}`, "'%' requires int")
		})
	})

	describe("comparison and logical operators", () => {
		it("comparison produces bool", () => {
			analyzeValid(`${R}func tick() {\nif 1 > 0 {\ndebugInt(1)\n}\n}`)
		})

		it("logical operators require bool", () => {
			expectError(`${R}func tick() {\nif 1 && 2 {\n}\n}`, "'&&' requires bool")
		})

		it("cannot compare different types", () => {
			expectError(`${R}func tick() {\nif 1 == 1.0 {\n}\n}`, "cannot compare int and float")
		})
	})

	describe("constants", () => {
		it("resolves constant values", () => {
			const result = analyzeValid(`${R}const N = 42\nfunc tick() {\ndebugInt(N)\n}`)
			const constInfo = result.consts.get("N")
			expect(constInfo).toBeDefined()
			expect(constInfo!.value).toBe(42)
			expect(typeEq(constInfo!.type, INT)).toBe(true)
		})

		it("rejects non-constant expression", () => {
			expectError(`${R}const N = getX()\nfunc tick() {}`, "compile-time constant")
		})

		it("resolves negative constant", () => {
			const result = analyzeValid(`${R}const N = -10\nfunc tick() {\ndebugInt(N)\n}`)
			expect(result.consts.get("N")!.value).toBe(-10)
		})
	})

	describe("event handlers", () => {
		it("validates scan signature", () => {
			analyzeValid(`${R}func tick() {}\non scan(d float, b angle) {\nsetGunHeading(b)\n}`)
		})

		it("rejects wrong scan parameter types", () => {
			expectError(`${R}func tick() {}\non scan(d int, b angle) {}`, "should be float, got int")
		})

		it("rejects unknown event", () => {
			expectError(`${R}func tick() {}\non explode() {}`, "unknown event")
		})

		it("rejects wrong parameter count", () => {
			expectError(`${R}func tick() {}\non scan(d float) {}`, "expects 2 parameter")
		})
	})

	describe("API function recognition", () => {
		it("accepts setSpeed with float", () => {
			analyzeValid(`${R}func tick() {\nsetSpeed(50.0)\n}`)
		})

		it("rejects setSpeed with wrong type", () => {
			expectError(`${R}func tick() {\nsetSpeed(true)\n}`, "expected float, got bool")
		})

		it("recognizes getter return types", () => {
			analyzeValid(`${R}func tick() {\nx := getX()\ndebugFloat(x)\n}`)
		})

		it("recognizes math builtins", () => {
			analyzeValid(`${R}func tick() {\nx := sqrt(4.0)\ndebugFloat(x)\n}`)
		})
	})

	describe("debug() overload resolution", () => {
		it("debug(int) resolves to debugInt", () => {
			analyzeValid(`${R}func tick() {\ndebug(42)\n}`)
		})

		it("debug(float) resolves to debugFloat", () => {
			analyzeValid(`${R}func tick() {\ndebug(3.14)\n}`)
		})

		it("debug(bool) is an error", () => {
			expectError(`${R}func tick() {\ndebug(true)\n}`, "debug()")
		})
	})

	describe("type conversions", () => {
		it("float(int) produces float", () => {
			analyzeValid(`${R}func tick() {\nx := float(42)\ndebugFloat(x)\n}`)
		})

		it("int(float) produces int", () => {
			analyzeValid(`${R}func tick() {\nx := int(3.14)\ndebugInt(x)\n}`)
		})

		it("angle(int) produces angle", () => {
			analyzeValid(`${R}func tick() {\na := angle(90)\nsetHeading(a)\n}`)
		})

		it("rejects converting bool", () => {
			expectError(`${R}func tick() {\nx := int(true)\n}`, "cannot convert bool")
		})
	})

	describe("scoped symbol tables", () => {
		it("if block variable not visible outside", () => {
			expectError(`${R}func tick() {\nif true {\nx := 1\n}\ndebugInt(x)\n}`, "undefined variable")
		})

		it("for init variable scoped to loop", () => {
			expectError(
				`${R}func tick() {\nfor i := 0; i < 10; i += 1 {\n}\ndebugInt(i)\n}`,
				"undefined variable",
			)
		})
	})

	describe("required tick function", () => {
		it("errors when tick is missing", () => {
			expectError(`${R}func init() {}`, "must define a tick()")
		})

		it("accepts program with tick", () => {
			analyzeValid(`${R}func tick() {}`)
		})
	})

	describe("global memory layout", () => {
		it("assigns sequential offsets to globals", () => {
			const result = analyzeValid(`${R}var a int\nvar b float\nvar c bool\nfunc tick() {}`)
			const a = result.symbols.get("a")
			const b = result.symbols.get("b")
			const c = result.symbols.get("c")
			expect(a).toBeDefined()
			expect(b).toBeDefined()
			expect(c).toBeDefined()
			// Globals start at offset 64 (after return slot)
			expect(a!.location).toBe(64)
			expect(b!.location).toBe(68)
			expect(c!.location).toBe(72)
			expect(result.globalMemorySize).toBe(76)
		})
	})

	describe("compound assignment", () => {
		it("validates compound assignment types", () => {
			analyzeValid(`${R}var x int\nfunc tick() {\nx += 5\n}`)
		})

		it("rejects compound assignment with wrong types", () => {
			expectError(`${R}var x int\nfunc tick() {\nx += 5.0\n}`, "cannot use '+'")
		})
	})

	describe("full program", () => {
		it("analyzes the Guardian robot without errors", () => {
			const source = `robot "Guardian"

type Target struct {
	bearing angle
	distance float
	lastSeen int
	active bool
}

var bestTarget Target
var scanDir angle

func tick() {
	setTurnRate(0.0)
	setGunTurnRate(0.0)
	setRadarTurnRate(5.0)
	setSpeed(0.0)

	if bestTarget.active {
		setGunHeading(bestTarget.bearing)
		if getGunHeat() == 0.0 {
			pwr := 3.0
			if bestTarget.distance > 300.0 {
				pwr = 1.0
			}
			fire(pwr)
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
		lastSeen: getTick(),
		active: true
	}
}

on hit(damage float, bearing angle) {
	setSpeed(100.0)
	setTurnRate(5.0)
}

on wallHit(bearing angle) {
	setHeading(bearing)
	setSpeed(50.0)
}
`
			analyzeValid(source)
		})
	})

	describe("while statement", () => {
		it("accepts while loop with bool condition", () => {
			analyzeValid(`${R}func tick() {\nwhile true {\nbreak\n}\n}`)
		})

		it("accepts while loop with comparison", () => {
			analyzeValid(`${R}var x int\nfunc tick() {\nwhile x < 10 {\nx += 1\n}\n}`)
		})

		it("rejects non-bool condition in while", () => {
			expectError(`${R}func tick() {\nwhile 42 {\nbreak\n}\n}`, "must be bool")
		})

		it("allows break inside while loop", () => {
			analyzeValid(`${R}func tick() {\nwhile true {\nbreak\n}\n}`)
		})

		it("allows continue inside while loop", () => {
			analyzeValid(`${R}func tick() {\nwhile true {\ncontinue\n}\n}`)
		})
	})

	describe("array literals", () => {
		it("infers array type from literal elements", () => {
			analyzeValid(`${R}func tick() {\nxs := [1, 2, 3]\ndebugInt(xs[0])\n}`)
		})

		it("accepts array literal assigned to typed var", () => {
			analyzeValid(`${R}func tick() {\nvar xs [3]int = [10, 20, 30]\ndebugInt(xs[0])\n}`)
		})

		it("accepts float array literal", () => {
			analyzeValid(`${R}func tick() {\nxs := [1.0, 2.0, 3.0]\ndebugFloat(xs[0])\n}`)
		})

		it("rejects mixed-type array literal", () => {
			expectError(`${R}func tick() {\nxs := [1, 2.0, 3]\n}`, "expected int, got float")
		})

		it("rejects array literal size mismatch with declared type", () => {
			expectError(`${R}func tick() {\nvar xs [3]int = [1, 2]\n}`, "cannot assign")
		})

		it("rejects assigning int array to float array var", () => {
			expectError(`${R}func tick() {\nvar xs [3]float = [1, 2, 3]\n}`, "cannot assign")
		})
	})
})
