export enum TokenKind {
	// Literals
	Int = "Int",
	Float = "Float",
	String = "String",
	True = "True",
	False = "False",

	// Identifiers
	Ident = "Ident",

	// Keywords
	Robot = "Robot",
	Var = "Var",
	Const = "Const",
	Func = "Func",
	On = "On",
	If = "If",
	Else = "Else",
	For = "For",
	Switch = "Switch",
	Case = "Case",
	Default = "Default",
	Return = "Return",
	Break = "Break",
	Continue = "Continue",
	Type = "Type",
	Struct = "Struct",

	// Type keywords
	IntType = "IntType",
	FloatType = "FloatType",
	BoolType = "BoolType",
	AngleType = "AngleType",

	// Operators
	Plus = "Plus",
	Minus = "Minus",
	Star = "Star",
	Slash = "Slash",
	Percent = "Percent",
	Assign = "Assign",
	Walrus = "Walrus", // :=
	PlusAssign = "PlusAssign",
	MinusAssign = "MinusAssign",
	StarAssign = "StarAssign",
	SlashAssign = "SlashAssign",
	Eq = "Eq",
	NotEq = "NotEq",
	Lt = "Lt",
	Gt = "Gt",
	LtEq = "LtEq",
	GtEq = "GtEq",
	And = "And",
	Or = "Or",
	Not = "Not",
	Amp = "Amp",
	Pipe = "Pipe",
	Caret = "Caret",
	Shl = "Shl",
	Shr = "Shr",

	// Delimiters
	LParen = "LParen",
	RParen = "RParen",
	LBrace = "LBrace",
	RBrace = "RBrace",
	LBracket = "LBracket",
	RBracket = "RBracket",
	Comma = "Comma",
	Dot = "Dot",
	Colon = "Colon",
	Semicolon = "Semicolon",

	// Special
	Newline = "Newline",
	EOF = "EOF",
}

export interface Token {
	readonly kind: TokenKind
	readonly value: string
	readonly line: number
	readonly column: number
}

const KEYWORDS: Record<string, TokenKind> = {
	robot: TokenKind.Robot,
	var: TokenKind.Var,
	const: TokenKind.Const,
	func: TokenKind.Func,
	on: TokenKind.On,
	if: TokenKind.If,
	else: TokenKind.Else,
	for: TokenKind.For,
	switch: TokenKind.Switch,
	case: TokenKind.Case,
	default: TokenKind.Default,
	return: TokenKind.Return,
	break: TokenKind.Break,
	continue: TokenKind.Continue,
	type: TokenKind.Type,
	struct: TokenKind.Struct,
	true: TokenKind.True,
	false: TokenKind.False,
	int: TokenKind.IntType,
	float: TokenKind.FloatType,
	bool: TokenKind.BoolType,
	angle: TokenKind.AngleType,
}

export function keywordKind(word: string): TokenKind | undefined {
	return KEYWORDS[word]
}
