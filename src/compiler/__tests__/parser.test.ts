import { describe, expect, it } from "vitest"
import type {
	AssignStmt,
	BinaryExpr,
	Block,
	BoolLiteral,
	CallExpr,
	ExprStmt,
	FieldAccess,
	FloatLiteral,
	ForStmt,
	GroupExpr,
	IfStmt,
	IndexAccess,
	IntLiteral,
	ReturnStmt,
	ShortDeclStmt,
	StructLiteral,
	SwitchStmt,
	UnaryExpr,
	VarStmt,
} from "../ast"
import { Lexer } from "../lexer"
import { parse } from "../parser"

function parseSource(source: string) {
	const tokens = new Lexer(source).tokenize()
	return parse(tokens)
}

function parseValid(source: string) {
	const { program, errors } = parseSource(source)
	if (errors.hasErrors()) {
		throw new Error(
			`Unexpected parse errors:\n${errors.errors.map((e) => `  ${e.line}:${e.column} ${e.message}`).join("\n")}`,
		)
	}
	return program
}

describe("Parser", () => {
	describe("robot declaration", () => {
		it("parses a robot declaration", () => {
			const program = parseValid('robot "SpinBot"')
			expect(program.robotName).toBe("SpinBot")
		})

		it("reports error for missing robot declaration", () => {
			const { errors } = parseSource("var x int")
			expect(errors.hasErrors()).toBe(true)
			expect(errors.errors[0]!.message).toContain("robot")
		})
	})

	describe("const declarations", () => {
		it("parses a const declaration", () => {
			const program = parseValid('robot "T"\nconst MAX = 8')
			expect(program.consts).toHaveLength(1)
			expect(program.consts[0]!.name).toBe("MAX")
			const value = program.consts[0]!.value as IntLiteral
			expect(value.kind).toBe("IntLiteral")
			expect(value.value).toBe(8)
		})
	})

	describe("type declarations", () => {
		it("parses a struct type", () => {
			const program = parseValid(`robot "T"
type Target struct {
	bearing angle
	distance float
}`)
			expect(program.types).toHaveLength(1)
			const td = program.types[0]!
			expect(td.name).toBe("Target")
			expect(td.fields).toHaveLength(2)
			expect(td.fields[0]!.name).toBe("bearing")
			expect(td.fields[0]!.typeNode.kind).toBe("PrimitiveType")
			expect(td.fields[1]!.name).toBe("distance")
		})
	})

	describe("var declarations", () => {
		it("parses global var with init", () => {
			const program = parseValid('robot "T"\nvar speed float = 50.0')
			expect(program.globals).toHaveLength(1)
			const v = program.globals[0]!
			expect(v.name).toBe("speed")
			expect(v.typeNode).toEqual(expect.objectContaining({ kind: "PrimitiveType", name: "float" }))
			const init = v.init as FloatLiteral
			expect(init.kind).toBe("FloatLiteral")
			expect(init.value).toBeCloseTo(50.0)
		})

		it("parses global var without init", () => {
			const program = parseValid('robot "T"\nvar count int')
			expect(program.globals[0]!.init).toBeNull()
		})
	})

	describe("function declarations", () => {
		it("parses empty function", () => {
			const program = parseValid('robot "T"\nfunc tick() { }')
			expect(program.funcs).toHaveLength(1)
			expect(program.funcs[0]!.name).toBe("tick")
			expect(program.funcs[0]!.params).toHaveLength(0)
			expect(program.funcs[0]!.returnType).toHaveLength(0)
		})

		it("parses function with params and return type", () => {
			const program = parseValid(`robot "T"
func add(a int, b int) int {
	return a + b
}`)
			const fn = program.funcs[0]!
			expect(fn.params).toHaveLength(2)
			expect(fn.params[0]!.name).toBe("a")
			expect(fn.params[1]!.name).toBe("b")
			expect(fn.returnType).toHaveLength(1)
			expect(fn.returnType[0]!).toEqual(
				expect.objectContaining({ kind: "PrimitiveType", name: "int" }),
			)
		})

		it("parses multi-return function", () => {
			const program = parseValid(`robot "T"
type Target struct {
	bearing angle
}
func best() (Target, bool) { }`)
			const fn = program.funcs[0]!
			expect(fn.returnType).toHaveLength(2)
		})
	})

	describe("event handlers", () => {
		it("parses event handler", () => {
			const program = parseValid(`robot "T"
on scan(distance float, bearing angle) { }`)
			expect(program.events).toHaveLength(1)
			const ev = program.events[0]!
			expect(ev.name).toBe("scan")
			expect(ev.params).toHaveLength(2)
			expect(ev.params[0]!.name).toBe("distance")
			expect(ev.params[1]!.name).toBe("bearing")
		})
	})

	describe("statements", () => {
		it("parses short declaration", () => {
			const program = parseValid(`robot "T"
func tick() {
	x := 42
}`)
			const stmt = program.funcs[0]!.body.stmts[0] as ShortDeclStmt
			expect(stmt.kind).toBe("ShortDeclStmt")
			expect(stmt.names).toEqual(["x"])
			const val = stmt.values[0] as IntLiteral
			expect(val.value).toBe(42)
		})

		it("parses multi-name short declaration", () => {
			const program = parseValid(`robot "T"
func tick() {
	x, y := 1, 2
}`)
			const stmt = program.funcs[0]!.body.stmts[0] as ShortDeclStmt
			expect(stmt.names).toEqual(["x", "y"])
			expect(stmt.values).toHaveLength(2)
		})

		it("parses assignment", () => {
			const program = parseValid(`robot "T"
func tick() {
	x := 0
	x = 10
}`)
			const stmt = program.funcs[0]!.body.stmts[1] as AssignStmt
			expect(stmt.kind).toBe("AssignStmt")
			expect(stmt.op).toBe("=")
		})

		it("parses compound assignment", () => {
			const program = parseValid(`robot "T"
func tick() {
	x := 0
	x += 5
}`)
			const stmt = program.funcs[0]!.body.stmts[1] as AssignStmt
			expect(stmt.op).toBe("+=")
		})

		it("parses if/else", () => {
			const program = parseValid(`robot "T"
func tick() {
	if x > 0 {
	} else {
	}
}`)
			const stmt = program.funcs[0]!.body.stmts[0] as IfStmt
			expect(stmt.kind).toBe("IfStmt")
			expect(stmt.else_).not.toBeNull()
			expect((stmt.else_ as Block).kind).toBe("Block")
		})

		it("parses if/else-if chain", () => {
			const program = parseValid(`robot "T"
func tick() {
	if x > 10 {
	} else if x > 5 {
	} else {
	}
}`)
			const stmt = program.funcs[0]!.body.stmts[0] as IfStmt
			const elseIf = stmt.else_ as IfStmt
			expect(elseIf.kind).toBe("IfStmt")
			expect(elseIf.else_).not.toBeNull()
		})

		it("parses for (condition only)", () => {
			const program = parseValid(`robot "T"
func tick() {
	for x > 0 {
		break
	}
}`)
			const stmt = program.funcs[0]!.body.stmts[0] as ForStmt
			expect(stmt.kind).toBe("ForStmt")
			expect(stmt.init).toBeNull()
			expect(stmt.condition).not.toBeNull()
			expect(stmt.post).toBeNull()
		})

		it("parses for (three-part)", () => {
			const program = parseValid(`robot "T"
func tick() {
	for i := 0; i < 10; i += 1 {
	}
}`)
			const stmt = program.funcs[0]!.body.stmts[0] as ForStmt
			expect(stmt.init).not.toBeNull()
			expect(stmt.init!.kind).toBe("ShortDeclStmt")
			expect(stmt.condition).not.toBeNull()
			expect(stmt.post).not.toBeNull()
			expect(stmt.post!.op).toBe("+=")
		})

		it("parses for (infinite)", () => {
			const program = parseValid(`robot "T"
func tick() {
	for {
		break
	}
}`)
			const stmt = program.funcs[0]!.body.stmts[0] as ForStmt
			expect(stmt.init).toBeNull()
			expect(stmt.condition).toBeNull()
			expect(stmt.post).toBeNull()
		})

		it("parses switch statement", () => {
			const program = parseValid(`robot "T"
func tick() {
	switch state {
	case 0:
		x := 1
	case 1:
		x := 2
	default:
		x := 3
	}
}`)
			const stmt = program.funcs[0]!.body.stmts[0] as SwitchStmt
			expect(stmt.kind).toBe("SwitchStmt")
			expect(stmt.cases).toHaveLength(3)
			expect(stmt.cases[0]!.isDefault).toBe(false)
			expect(stmt.cases[2]!.isDefault).toBe(true)
		})

		it("parses return with values", () => {
			const program = parseValid(`robot "T"
func add(a int, b int) int {
	return a + b
}`)
			const stmt = program.funcs[0]!.body.stmts[0] as ReturnStmt
			expect(stmt.kind).toBe("ReturnStmt")
			expect(stmt.values).toHaveLength(1)
		})

		it("parses multi-return", () => {
			const program = parseValid(`robot "T"
func f() (int, bool) {
	return 42, true
}`)
			const stmt = program.funcs[0]!.body.stmts[0] as ReturnStmt
			expect(stmt.values).toHaveLength(2)
		})

		it("parses var statement inside function", () => {
			const program = parseValid(`robot "T"
func tick() {
	var threshold float = 40.0
}`)
			const stmt = program.funcs[0]!.body.stmts[0] as VarStmt
			expect(stmt.kind).toBe("VarStmt")
			expect(stmt.name).toBe("threshold")
		})
	})

	describe("expressions", () => {
		it("parses operator precedence: 2 + 3 * 4", () => {
			const program = parseValid(`robot "T"
func tick() {
	x := 2 + 3 * 4
}`)
			const decl = program.funcs[0]!.body.stmts[0] as ShortDeclStmt
			const expr = decl.values[0] as BinaryExpr
			expect(expr.op).toBe("+")
			expect((expr.left as IntLiteral).value).toBe(2)
			const right = expr.right as BinaryExpr
			expect(right.op).toBe("*")
			expect((right.left as IntLiteral).value).toBe(3)
			expect((right.right as IntLiteral).value).toBe(4)
		})

		it("parses full precedence chain: a || b && c == d + e * f", () => {
			const program = parseValid(`robot "T"
func tick() {
	x := a || b && c == d + e * f
}`)
			const decl = program.funcs[0]!.body.stmts[0] as ShortDeclStmt
			const expr = decl.values[0] as BinaryExpr
			// Top should be ||
			expect(expr.op).toBe("||")
			// Right of || should be &&
			const andExpr = expr.right as BinaryExpr
			expect(andExpr.op).toBe("&&")
			// Right of && should be ==
			const eqExpr = andExpr.right as BinaryExpr
			expect(eqExpr.op).toBe("==")
		})

		it("parses unary operators", () => {
			const program = parseValid(`robot "T"
func tick() {
	x := -y
	z := !flag
}`)
			const s1 = program.funcs[0]!.body.stmts[0] as ShortDeclStmt
			const u1 = s1.values[0] as UnaryExpr
			expect(u1.op).toBe("-")

			const s2 = program.funcs[0]!.body.stmts[1] as ShortDeclStmt
			const u2 = s2.values[0] as UnaryExpr
			expect(u2.op).toBe("!")
		})

		it("parses function call", () => {
			const program = parseValid(`robot "T"
func tick() {
	fire(3)
}`)
			const stmt = program.funcs[0]!.body.stmts[0] as ExprStmt
			const call = stmt.expr as CallExpr
			expect(call.kind).toBe("CallExpr")
			expect(call.callee).toBe("fire")
			expect(call.args).toHaveLength(1)
		})

		it("parses field access", () => {
			const program = parseValid(`robot "T"
func tick() {
	x := target.bearing
}`)
			const decl = program.funcs[0]!.body.stmts[0] as ShortDeclStmt
			const fa = decl.values[0] as FieldAccess
			expect(fa.kind).toBe("FieldAccess")
			expect(fa.field).toBe("bearing")
		})

		it("parses index access", () => {
			const program = parseValid(`robot "T"
func tick() {
	x := scores[i]
}`)
			const decl = program.funcs[0]!.body.stmts[0] as ShortDeclStmt
			const ia = decl.values[0] as IndexAccess
			expect(ia.kind).toBe("IndexAccess")
		})

		it("parses struct literal", () => {
			const program = parseValid(`robot "T"
type Target struct {
	bearing angle
	distance float
}
func tick() {
	t := Target{bearing: 45, distance: 200}
}`)
			const decl = program.funcs[0]!.body.stmts[0] as ShortDeclStmt
			const sl = decl.values[0] as StructLiteral
			expect(sl.kind).toBe("StructLiteral")
			expect(sl.typeName).toBe("Target")
			expect(sl.fields).toHaveLength(2)
			expect(sl.fields[0]!.name).toBe("bearing")
		})

		it("parses type conversion: float(x)", () => {
			const program = parseValid(`robot "T"
func tick() {
	y := float(x)
}`)
			const decl = program.funcs[0]!.body.stmts[0] as ShortDeclStmt
			const call = decl.values[0] as CallExpr
			expect(call.kind).toBe("CallExpr")
			expect(call.callee).toBe("float")
		})

		it("parses nested expressions", () => {
			const program = parseValid(`robot "T"
func tick() {
	x := (a + b) * (c - d)
}`)
			const decl = program.funcs[0]!.body.stmts[0] as ShortDeclStmt
			const expr = decl.values[0] as BinaryExpr
			expect(expr.op).toBe("*")
			expect((expr.left as GroupExpr).kind).toBe("GroupExpr")
			expect((expr.right as GroupExpr).kind).toBe("GroupExpr")
		})

		it("parses array type in var decl", () => {
			const program = parseValid(`robot "T"
type Target struct {
	bearing angle
}
var targets [8]Target`)
			const v = program.globals[0]!
			expect(v.typeNode.kind).toBe("ArrayType")
			if (v.typeNode.kind === "ArrayType") {
				expect(v.typeNode.size).toBe(8)
				expect(v.typeNode.elementType.kind).toBe("NamedType")
			}
		})

		it("parses boolean literals", () => {
			const program = parseValid(`robot "T"
func tick() {
	x := true
	y := false
}`)
			const s1 = program.funcs[0]!.body.stmts[0] as ShortDeclStmt
			const b1 = s1.values[0] as BoolLiteral
			expect(b1.value).toBe(true)

			const s2 = program.funcs[0]!.body.stmts[1] as ShortDeclStmt
			const b2 = s2.values[0] as BoolLiteral
			expect(b2.value).toBe(false)
		})

		it("parses chained field access and method calls", () => {
			const program = parseValid(`robot "T"
func tick() {
	x := getX()
	setSpeed(50.0)
}`)
			const s1 = program.funcs[0]!.body.stmts[0] as ShortDeclStmt
			const c1 = s1.values[0] as CallExpr
			expect(c1.callee).toBe("getX")
			expect(c1.args).toHaveLength(0)
		})
	})

	describe("error recovery", () => {
		it("recovers from syntax errors and continues parsing", () => {
			const { program, errors } = parseSource(`robot "T"
const = 1
func tick() { }`)
			expect(errors.hasErrors()).toBe(true)
			// Should still parse the func declaration after recovering
			expect(program.funcs).toHaveLength(1)
			expect(program.funcs[0]!.name).toBe("tick")
		})
	})

	describe("full program", () => {
		it("parses the Guardian example robot structure", () => {
			const program = parseValid(`robot "Guardian"

const MAX_TARGETS = 8

type Target struct {
	bearing angle
	distance float
	tick int
	active bool
}

var state int
var targets [8]Target

func tick() {
	setSpeed(50.0)
	setTurnRate(5.0)
	fire(1.0)
}

func findBest() (int, bool) {
	best := -1
	found := false
	for i := 0; i < 8; i += 1 {
		if targets[i].active {
			best = i
			found = true
		}
	}
	return best, found
}

func attack(idx int) {
	setGunHeading(targets[idx].bearing)
	if getGunHeat() == 0.0 {
		fire(3.0)
	}
}

func evade() {
	setSpeed(100.0)
	setTurnRate(10.0)
}

on scan(distance float, bearing angle) {
	state = 1
}

on hit(damage float, bearing angle) {
	state = 2
}

on wallHit(bearing angle) {
	setSpeed(50.0)
}`)
			expect(program.robotName).toBe("Guardian")
			expect(program.consts).toHaveLength(1)
			expect(program.types).toHaveLength(1)
			expect(program.globals).toHaveLength(2)
			expect(program.funcs).toHaveLength(4)
			expect(program.events).toHaveLength(3)
		})
	})

	describe("span tracking", () => {
		it("tracks line and column for nodes", () => {
			const program = parseValid(`robot "T"
var x int
func tick() { }`)
			expect(program.globals[0]!.span.line).toBe(2)
			expect(program.funcs[0]!.span.line).toBe(3)
		})
	})

	describe("error recovery", () => {
		it("does not hang on 'struct' used instead of 'type ... struct'", () => {
			const { errors } = parseSource(`robot "Bad"
struct Result {
	value int
}
func tick() { }`)
			expect(errors.hasErrors()).toBe(true)
			// Parser should recover and still find tick
		})

		it("does not hang on stray closing brace at top level", () => {
			const { program, errors } = parseSource(`robot "Bad"
}
func tick() { }`)
			expect(errors.hasErrors()).toBe(true)
			expect(program.funcs).toHaveLength(1)
		})

		it("does not hang on multiple stray braces", () => {
			const { errors } = parseSource(`robot "Bad"
}}}
func tick() { }`)
			expect(errors.hasErrors()).toBe(true)
		})

		it("does not hang on empty braces at top level", () => {
			const { errors } = parseSource(`robot "Bad"
{ }
func tick() { }`)
			expect(errors.hasErrors()).toBe(true)
		})

		it("recovers after bad declaration and parses subsequent ones", () => {
			const { program, errors } = parseSource(`robot "Recover"
blah blah blah
var x int
func tick() {
	setSpeed(1.0)
}`)
			expect(errors.hasErrors()).toBe(true)
			expect(program.globals).toHaveLength(1)
			expect(program.funcs).toHaveLength(1)
		})

		it("does not hang on unterminated block", () => {
			const { errors } = parseSource(`robot "Bad"
func tick() {
	setSpeed(1.0)`)
			expect(errors.hasErrors()).toBe(true)
		})

		it("does not hang on robot declaration only", () => {
			const { program } = parseSource(`robot "Empty"`)
			expect(program.robotName).toBe("Empty")
			// No tick() is a semantic error, not a parse error
			expect(program.funcs).toHaveLength(0)
		})

		it("does not hang on completely empty input", () => {
			const { errors } = parseSource("")
			expect(errors.hasErrors()).toBe(true)
		})
	})
})
