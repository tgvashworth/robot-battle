import { describe, expect, it } from "vitest"
import { Lexer } from "../lexer"
import { TokenKind } from "../token"

function tokenKinds(source: string): TokenKind[] {
	return new Lexer(source)
		.tokenize()
		.filter((t) => t.kind !== TokenKind.Newline && t.kind !== TokenKind.EOF)
		.map((t) => t.kind)
}

function tokenValues(source: string): string[] {
	return new Lexer(source)
		.tokenize()
		.filter((t) => t.kind !== TokenKind.Newline && t.kind !== TokenKind.EOF)
		.map((t) => t.value)
}

describe("Lexer", () => {
	it("tokenizes robot declaration", () => {
		const tokens = new Lexer('robot "SpinBot"').tokenize()
		expect(tokens[0]!.kind).toBe(TokenKind.Robot)
		expect(tokens[1]!.kind).toBe(TokenKind.String)
		expect(tokens[1]!.value).toBe("SpinBot")
	})

	it("tokenizes variable declaration", () => {
		expect(tokenKinds("var speed float = 50.0")).toEqual([
			TokenKind.Var,
			TokenKind.Ident,
			TokenKind.FloatType,
			TokenKind.Assign,
			TokenKind.Float,
		])
	})

	it("tokenizes walrus operator", () => {
		expect(tokenKinds("x := 42")).toEqual([TokenKind.Ident, TokenKind.Walrus, TokenKind.Int])
	})

	it("tokenizes function declaration", () => {
		const kinds = tokenKinds("func tick() {")
		expect(kinds).toEqual([
			TokenKind.Func,
			TokenKind.Ident,
			TokenKind.LParen,
			TokenKind.RParen,
			TokenKind.LBrace,
		])
	})

	it("tokenizes event handler", () => {
		const kinds = tokenKinds("on scan(distance float, bearing angle) {")
		expect(kinds).toEqual([
			TokenKind.On,
			TokenKind.Ident,
			TokenKind.LParen,
			TokenKind.Ident,
			TokenKind.FloatType,
			TokenKind.Comma,
			TokenKind.Ident,
			TokenKind.AngleType,
			TokenKind.RParen,
			TokenKind.LBrace,
		])
	})

	it("tokenizes all keywords", () => {
		const keywords = [
			"robot",
			"var",
			"const",
			"func",
			"on",
			"if",
			"else",
			"for",
			"while",
			"switch",
			"case",
			"default",
			"return",
			"break",
			"continue",
			"type",
			"struct",
			"true",
			"false",
			"int",
			"float",
			"bool",
			"angle",
		]
		for (const kw of keywords) {
			const tokens = new Lexer(kw).tokenize()
			expect(tokens[0]!.kind).not.toBe(TokenKind.Ident)
		}
	})

	it("tokenizes comparison operators", () => {
		expect(tokenKinds("a == b != c <= d >= e < f > g")).toEqual([
			TokenKind.Ident,
			TokenKind.Eq,
			TokenKind.Ident,
			TokenKind.NotEq,
			TokenKind.Ident,
			TokenKind.LtEq,
			TokenKind.Ident,
			TokenKind.GtEq,
			TokenKind.Ident,
			TokenKind.Lt,
			TokenKind.Ident,
			TokenKind.Gt,
			TokenKind.Ident,
		])
	})

	it("tokenizes compound assignment", () => {
		expect(tokenKinds("x += 1")).toEqual([TokenKind.Ident, TokenKind.PlusAssign, TokenKind.Int])
	})

	it("tokenizes integer and float literals", () => {
		expect(tokenValues("42 3.14 0 100.0")).toEqual(["42", "3.14", "0", "100.0"])

		const kinds = tokenKinds("42 3.14")
		expect(kinds).toEqual([TokenKind.Int, TokenKind.Float])
	})

	it("skips line comments", () => {
		const kinds = tokenKinds("x // this is a comment\ny")
		expect(kinds).toEqual([TokenKind.Ident, TokenKind.Ident])
	})

	it("tracks line and column numbers", () => {
		const tokens = new Lexer("x := 1\ny := 2").tokenize()
		const x = tokens[0]!
		expect(x.line).toBe(1)
		expect(x.column).toBe(1)

		const y = tokens.find((t) => t.value === "y")!
		expect(y.line).toBe(2)
		expect(y.column).toBe(1)
	})

	it("tokenizes struct definition", () => {
		const kinds = tokenKinds("type Target struct {")
		expect(kinds).toEqual([TokenKind.Type, TokenKind.Ident, TokenKind.Struct, TokenKind.LBrace])
	})

	it("tokenizes array syntax", () => {
		const kinds = tokenKinds("[8]Target")
		expect(kinds).toEqual([TokenKind.LBracket, TokenKind.Int, TokenKind.RBracket, TokenKind.Ident])
	})

	it("tokenizes a minimal robot program", () => {
		const source = `robot "TestBot"

var direction int = 1

func tick() {
	setSpeed(50)
	setTurnRate(5)
	fire(1)
}

on scan(distance float, bearing angle) {
	setGunHeading(bearing)
}
`
		const tokens = new Lexer(source).tokenize()
		const nonTrivial = tokens.filter(
			(t) => t.kind !== TokenKind.Newline && t.kind !== TokenKind.EOF,
		)
		expect(nonTrivial.length).toBeGreaterThan(20)

		// Check the program starts correctly
		expect(nonTrivial[0]!.kind).toBe(TokenKind.Robot)
		expect(nonTrivial[1]!.kind).toBe(TokenKind.String)
		expect(nonTrivial[1]!.value).toBe("TestBot")
	})

	it("handles string escape sequences", () => {
		const tokens = new Lexer('"hello\\nworld"').tokenize()
		expect(tokens[0]!.value).toBe("hello\nworld")
	})

	it("handles logical operators", () => {
		expect(tokenKinds("a && b || !c")).toEqual([
			TokenKind.Ident,
			TokenKind.And,
			TokenKind.Ident,
			TokenKind.Or,
			TokenKind.Not,
			TokenKind.Ident,
		])
	})

	it("tokenizes while keyword", () => {
		const kinds = tokenKinds("while x > 0 {")
		expect(kinds).toEqual([
			TokenKind.While,
			TokenKind.Ident,
			TokenKind.Gt,
			TokenKind.Int,
			TokenKind.LBrace,
		])
	})

	it("tokenizes while as keyword not identifier", () => {
		const tokens = new Lexer("while").tokenize()
		expect(tokens[0]!.kind).toBe(TokenKind.While)
		expect(tokens[0]!.kind).not.toBe(TokenKind.Ident)
	})

	it("tokenizes array literal syntax", () => {
		expect(tokenKinds("[1, 2, 3]")).toEqual([
			TokenKind.LBracket,
			TokenKind.Int,
			TokenKind.Comma,
			TokenKind.Int,
			TokenKind.Comma,
			TokenKind.Int,
			TokenKind.RBracket,
		])
	})

	it("tokenizes float array literal", () => {
		expect(tokenKinds("[1.0, 2.0]")).toEqual([
			TokenKind.LBracket,
			TokenKind.Float,
			TokenKind.Comma,
			TokenKind.Float,
			TokenKind.RBracket,
		])
	})
})
