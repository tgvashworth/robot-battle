import type {
	AssignStmt,
	BinaryOp,
	Block,
	CaseClause,
	ConstDecl,
	EventDecl,
	Expr,
	FieldDef,
	ForStmt,
	FuncDecl,
	IfStmt,
	ParamDef,
	Program,
	ReturnStmt,
	ShortDeclStmt,
	Span,
	Stmt,
	StructFieldInit,
	SwitchStmt,
	TypeDecl,
	TypeNode,
	VarDecl,
} from "./ast"
import { CompileErrorList } from "./errors"
import type { Token } from "./token"
import { TokenKind } from "./token"

// Operator precedence levels (lowest to highest)
const PREC_OR = 1
const PREC_AND = 2
const PREC_BIT_OR = 3
const PREC_BIT_XOR = 4
const PREC_BIT_AND = 5
const PREC_EQUALITY = 6
const PREC_COMPARISON = 7
const PREC_SHIFT = 8
const PREC_ADD = 9
const PREC_MUL = 10

function binaryPrecedence(kind: TokenKind): number {
	switch (kind) {
		case TokenKind.Or:
			return PREC_OR
		case TokenKind.And:
			return PREC_AND
		case TokenKind.Pipe:
			return PREC_BIT_OR
		case TokenKind.Caret:
			return PREC_BIT_XOR
		case TokenKind.Amp:
			return PREC_BIT_AND
		case TokenKind.Eq:
		case TokenKind.NotEq:
			return PREC_EQUALITY
		case TokenKind.Lt:
		case TokenKind.Gt:
		case TokenKind.LtEq:
		case TokenKind.GtEq:
			return PREC_COMPARISON
		case TokenKind.Shl:
		case TokenKind.Shr:
			return PREC_SHIFT
		case TokenKind.Plus:
		case TokenKind.Minus:
			return PREC_ADD
		case TokenKind.Star:
		case TokenKind.Slash:
		case TokenKind.Percent:
			return PREC_MUL
		default:
			return 0
	}
}

function tokenToBinaryOp(kind: TokenKind): BinaryOp | null {
	switch (kind) {
		case TokenKind.Plus:
			return "+"
		case TokenKind.Minus:
			return "-"
		case TokenKind.Star:
			return "*"
		case TokenKind.Slash:
			return "/"
		case TokenKind.Percent:
			return "%"
		case TokenKind.Eq:
			return "=="
		case TokenKind.NotEq:
			return "!="
		case TokenKind.Lt:
			return "<"
		case TokenKind.Gt:
			return ">"
		case TokenKind.LtEq:
			return "<="
		case TokenKind.GtEq:
			return ">="
		case TokenKind.And:
			return "&&"
		case TokenKind.Or:
			return "||"
		case TokenKind.Amp:
			return "&"
		case TokenKind.Pipe:
			return "|"
		case TokenKind.Caret:
			return "^"
		case TokenKind.Shl:
			return "<<"
		case TokenKind.Shr:
			return ">>"
		default:
			return null
	}
}

type AssignOp = "=" | "+=" | "-=" | "*=" | "/="

function tokenToAssignOp(kind: TokenKind): AssignOp | null {
	switch (kind) {
		case TokenKind.Assign:
			return "="
		case TokenKind.PlusAssign:
			return "+="
		case TokenKind.MinusAssign:
			return "-="
		case TokenKind.StarAssign:
			return "*="
		case TokenKind.SlashAssign:
			return "/="
		default:
			return null
	}
}

const TYPE_KEYWORDS = new Set<TokenKind>([
	TokenKind.IntType,
	TokenKind.FloatType,
	TokenKind.BoolType,
	TokenKind.AngleType,
])

export class Parser {
	private tokens: Token[]
	private pos = 0
	private errors = new CompileErrorList()
	private typeNames = new Set<string>()

	constructor(tokens: Token[]) {
		this.tokens = tokens
	}

	parse(): { program: Program; errors: CompileErrorList } {
		// Pre-scan for type names (user decision: pre-scan for struct literal disambiguation)
		this.preScanTypeNames()

		const span = this.span()
		const robotName = this.parseRobotDecl()

		const consts: ConstDecl[] = []
		const types: TypeDecl[] = []
		const globals: VarDecl[] = []
		const funcs: FuncDecl[] = []
		const events: EventDecl[] = []

		while (!this.isAtEnd()) {
			this.skipNewlines()
			if (this.isAtEnd()) break

			try {
				const kind = this.peek().kind
				switch (kind) {
					case TokenKind.Const:
						consts.push(this.parseConstDecl())
						break
					case TokenKind.Type:
						types.push(this.parseTypeDecl())
						break
					case TokenKind.Var:
						globals.push(this.parseVarDecl())
						break
					case TokenKind.Func:
						funcs.push(this.parseFuncDecl())
						break
					case TokenKind.On:
						events.push(this.parseEventDecl())
						break
					default:
						this.error(`unexpected token '${this.peek().value}', expected top-level declaration`)
						this.recover()
				}
			} catch {
				this.recover()
			}
		}

		const program: Program = {
			kind: "Program",
			robotName,
			consts,
			types,
			globals,
			funcs,
			events,
			span,
		}

		return { program, errors: this.errors }
	}

	// --- Pre-scan ---

	private preScanTypeNames(): void {
		for (let i = 0; i < this.tokens.length; i++) {
			const tok = this.tokens[i]!
			if (tok.kind === TokenKind.Type) {
				const next = this.tokens[i + 1]
				if (next && next.kind === TokenKind.Ident) {
					this.typeNames.add(next.value)
				}
			}
		}
	}

	// --- Token helpers ---

	private peek(): Token {
		return this.tokens[this.pos] ?? { kind: TokenKind.EOF, value: "", line: 0, column: 0 }
	}

	private peekKind(): TokenKind {
		return this.peek().kind
	}

	private advance(): Token {
		const tok = this.peek()
		if (this.pos < this.tokens.length) {
			this.pos++
		}
		return tok
	}

	private expect(kind: TokenKind): Token {
		const tok = this.peek()
		if (tok.kind !== kind) {
			throw this.error(`expected '${kind}', got '${tok.kind}' ('${tok.value}')`)
		}
		return this.advance()
	}

	private check(kind: TokenKind): boolean {
		return this.peekKind() === kind
	}

	private match(kind: TokenKind): Token | null {
		if (this.check(kind)) {
			return this.advance()
		}
		return null
	}

	private isAtEnd(): boolean {
		return this.peekKind() === TokenKind.EOF
	}

	private span(): Span {
		const tok = this.peek()
		return { line: tok.line, column: tok.column }
	}

	private skipNewlines(): void {
		while (this.check(TokenKind.Newline)) {
			this.advance()
		}
	}

	private expectNewlineOrEnd(): void {
		if (!this.isAtEnd() && !this.check(TokenKind.RBrace)) {
			if (!this.match(TokenKind.Newline)) {
				// Be lenient — don't error if we're at a closing brace or EOF
			}
			this.skipNewlines()
		}
	}

	private error(message: string): Error {
		const tok = this.peek()
		this.errors.add("parse", tok.line, tok.column, message)
		return new Error(message)
	}

	private recover(): void {
		// Skip to next newline, closing brace, or top-level keyword.
		// Always advance at least one token to guarantee progress.
		let advanced = false
		while (!this.isAtEnd()) {
			const kind = this.peekKind()
			if (kind === TokenKind.Newline) {
				this.advance()
				this.skipNewlines()
				return
			}
			if (kind === TokenKind.RBrace) {
				// Consume the brace if we haven't advanced yet, to prevent
				// the caller from looping on the same token forever.
				if (!advanced) {
					this.advance()
				}
				return
			}
			if (
				kind === TokenKind.Func ||
				kind === TokenKind.On ||
				kind === TokenKind.Var ||
				kind === TokenKind.Const ||
				kind === TokenKind.Type
			) {
				if (!advanced) {
					this.advance()
					advanced = true
					continue
				}
				return
			}
			this.advance()
			advanced = true
		}
	}

	// --- Top-level parsing ---

	private parseRobotDecl(): string {
		this.skipNewlines()
		if (this.peekKind() !== TokenKind.Robot) {
			this.error("program must begin with 'robot \"Name\"'")
			// Try to continue — return empty name
			return ""
		}
		this.advance() // consume 'robot'
		const nameTok = this.expect(TokenKind.String)
		this.expectNewlineOrEnd()
		return nameTok.value
	}

	private parseConstDecl(): ConstDecl {
		const span = this.span()
		this.expect(TokenKind.Const)
		const name = this.expect(TokenKind.Ident).value
		this.expect(TokenKind.Assign)
		const value = this.parseExpr()
		this.expectNewlineOrEnd()
		return { kind: "ConstDecl", name, value, span }
	}

	private parseTypeDecl(): TypeDecl {
		const span = this.span()
		this.expect(TokenKind.Type)
		const name = this.expect(TokenKind.Ident).value
		this.expect(TokenKind.Struct)
		this.expect(TokenKind.LBrace)
		this.skipNewlines()

		const fields: FieldDef[] = []
		while (!this.check(TokenKind.RBrace) && !this.isAtEnd()) {
			const fieldSpan = this.span()
			const fieldName = this.expect(TokenKind.Ident).value
			const typeNode = this.parseTypeNode()
			fields.push({ name: fieldName, typeNode, span: fieldSpan })
			this.expectNewlineOrEnd()
		}

		this.expect(TokenKind.RBrace)
		this.expectNewlineOrEnd()
		return { kind: "TypeDecl", name, fields, span }
	}

	private parseVarDecl(): VarDecl {
		const span = this.span()
		this.expect(TokenKind.Var)
		const name = this.expect(TokenKind.Ident).value
		const typeNode = this.parseTypeNode()
		let init: Expr | null = null
		if (this.match(TokenKind.Assign)) {
			init = this.parseExpr()
		}
		this.expectNewlineOrEnd()
		return { kind: "VarDecl", name, typeNode, init, span }
	}

	private parseFuncDecl(): FuncDecl {
		const span = this.span()
		this.expect(TokenKind.Func)
		const name = this.expect(TokenKind.Ident).value
		this.expect(TokenKind.LParen)
		const params = this.parseParams()
		this.expect(TokenKind.RParen)
		const returnType = this.parseReturnType()
		this.skipNewlines()
		const body = this.parseBlock()
		this.expectNewlineOrEnd()
		return { kind: "FuncDecl", name, params, returnType, body, span }
	}

	private parseEventDecl(): EventDecl {
		const span = this.span()
		this.expect(TokenKind.On)
		const name = this.expect(TokenKind.Ident).value
		this.expect(TokenKind.LParen)
		const params = this.parseParams()
		this.expect(TokenKind.RParen)
		this.skipNewlines()
		const body = this.parseBlock()
		this.expectNewlineOrEnd()
		return { kind: "EventDecl", name, params, body, span }
	}

	// --- Parameters and types ---

	private parseParams(): ParamDef[] {
		const params: ParamDef[] = []
		if (this.check(TokenKind.RParen)) return params

		params.push(this.parseParam())
		while (this.match(TokenKind.Comma)) {
			params.push(this.parseParam())
		}
		return params
	}

	private parseParam(): ParamDef {
		const span = this.span()
		const name = this.expect(TokenKind.Ident).value
		const typeNode = this.parseTypeNode()
		return { name, typeNode, span }
	}

	private parseReturnType(): TypeNode[] {
		// No return type — void
		if (this.check(TokenKind.LBrace) || this.check(TokenKind.Newline) || this.isAtEnd()) {
			return []
		}

		// Multi-return: (Type, Type)
		if (this.check(TokenKind.LParen)) {
			this.advance()
			const types: TypeNode[] = []
			types.push(this.parseTypeNode())
			while (this.match(TokenKind.Comma)) {
				types.push(this.parseTypeNode())
			}
			this.expect(TokenKind.RParen)
			return types
		}

		// Single return type
		return [this.parseTypeNode()]
	}

	private parseTypeNode(): TypeNode {
		const span = this.span()

		// Array type: [N]Type
		if (this.check(TokenKind.LBracket)) {
			this.advance()
			const sizeTok = this.expect(TokenKind.Int)
			const size = Number.parseInt(sizeTok.value, 10)
			this.expect(TokenKind.RBracket)
			const elementType = this.parseTypeNode()
			return { kind: "ArrayType", size, elementType, span }
		}

		// Primitive types
		if (TYPE_KEYWORDS.has(this.peekKind())) {
			const tok = this.advance()
			const nameMap: Record<string, "int" | "float" | "bool" | "angle"> = {
				[TokenKind.IntType]: "int",
				[TokenKind.FloatType]: "float",
				[TokenKind.BoolType]: "bool",
				[TokenKind.AngleType]: "angle",
			}
			const name = nameMap[tok.kind]!
			return { kind: "PrimitiveType", name, span }
		}

		// Named type (struct)
		if (this.check(TokenKind.Ident)) {
			const name = this.advance().value
			return { kind: "NamedType", name, span }
		}

		throw this.error(`expected type, got '${this.peek().value}'`)
	}

	// --- Block and statements ---

	private parseBlock(): Block {
		const span = this.span()
		this.expect(TokenKind.LBrace)
		this.skipNewlines()

		const stmts: Stmt[] = []
		while (!this.check(TokenKind.RBrace) && !this.isAtEnd()) {
			try {
				stmts.push(this.parseStmt())
			} catch {
				this.recover()
			}
			this.skipNewlines()
		}

		this.expect(TokenKind.RBrace)
		return { kind: "Block", stmts, span }
	}

	private parseStmt(): Stmt {
		this.skipNewlines()
		const kind = this.peekKind()

		switch (kind) {
			case TokenKind.Var:
				return this.parseVarStmt()
			case TokenKind.If:
				return this.parseIfStmt()
			case TokenKind.For:
				return this.parseForStmt()
			case TokenKind.While:
				return this.parseWhileStmt()
			case TokenKind.Switch:
				return this.parseSwitchStmt()
			case TokenKind.Return:
				return this.parseReturnStmt()
			case TokenKind.Break: {
				const span = this.span()
				this.advance()
				this.expectNewlineOrEnd()
				return { kind: "BreakStmt", span }
			}
			case TokenKind.Continue: {
				const span = this.span()
				this.advance()
				this.expectNewlineOrEnd()
				return { kind: "ContinueStmt", span }
			}
			case TokenKind.LBrace:
				return this.parseBlock()
			default:
				return this.parseExprOrAssignStmt()
		}
	}

	private parseVarStmt(): Stmt {
		const span = this.span()
		this.expect(TokenKind.Var)
		const name = this.expect(TokenKind.Ident).value
		const typeNode = this.parseTypeNode()
		let init: Expr | null = null
		if (this.match(TokenKind.Assign)) {
			init = this.parseExpr()
		}
		this.expectNewlineOrEnd()
		return { kind: "VarStmt", name, typeNode, init, span }
	}

	private parseIfStmt(): IfStmt {
		const span = this.span()
		this.expect(TokenKind.If)
		const condition = this.parseExpr()
		this.skipNewlines()
		const then = this.parseBlock()

		let else_: Block | IfStmt | null = null
		this.skipNewlines()
		if (this.match(TokenKind.Else)) {
			this.skipNewlines()
			if (this.check(TokenKind.If)) {
				else_ = this.parseIfStmt()
			} else {
				else_ = this.parseBlock()
			}
		}
		this.expectNewlineOrEnd()
		return { kind: "IfStmt", condition, then, else_, span }
	}

	private parseForStmt(): ForStmt {
		const span = this.span()
		this.expect(TokenKind.For)

		// Infinite loop: for { ... }
		if (this.check(TokenKind.LBrace)) {
			const body = this.parseBlock()
			this.expectNewlineOrEnd()
			return { kind: "ForStmt", init: null, condition: null, post: null, body, span }
		}

		// Detect three-part for: `for init; cond; post { }`
		// Look ahead for a semicolon before the opening brace to distinguish
		// three-part from condition-only
		if (this.hasForSemicolon()) {
			const init = this.parseForInit()
			this.expect(TokenKind.Semicolon)
			const condition = this.parseExpr()
			this.expect(TokenKind.Semicolon)
			const post = this.parseForPost()
			this.skipNewlines()
			const body = this.parseBlock()
			this.expectNewlineOrEnd()
			return { kind: "ForStmt", init, condition, post, body, span }
		}

		// Condition-only for loop: for cond { ... }
		const condition = this.parseExpr()
		this.skipNewlines()
		const body = this.parseBlock()
		this.expectNewlineOrEnd()
		return { kind: "ForStmt", init: null, condition, post: null, body, span }
	}

	private parseWhileStmt(): ForStmt {
		const span = this.span()
		this.expect(TokenKind.While)
		const condition = this.parseExpr()
		this.skipNewlines()
		const body = this.parseBlock()
		this.expectNewlineOrEnd()
		return { kind: "ForStmt", init: null, condition, post: null, body, span }
	}

	private hasForSemicolon(): boolean {
		// Scan ahead to find a semicolon before a `{` at depth 0
		let depth = 0
		for (let i = this.pos; i < this.tokens.length; i++) {
			const tok = this.tokens[i]!
			if (tok.kind === TokenKind.LParen || tok.kind === TokenKind.LBracket) {
				depth++
			} else if (tok.kind === TokenKind.RParen || tok.kind === TokenKind.RBracket) {
				depth--
			} else if (tok.kind === TokenKind.LBrace && depth === 0) {
				return false
			} else if (tok.kind === TokenKind.Semicolon && depth === 0) {
				return true
			} else if (tok.kind === TokenKind.EOF) {
				return false
			}
		}
		return false
	}

	private parseForInit(): ShortDeclStmt | AssignStmt {
		const span = this.span()

		// Short decl: ident := expr
		if (this.check(TokenKind.Ident)) {
			const savedPos = this.pos
			const names: string[] = []
			names.push(this.advance().value)
			while (this.match(TokenKind.Comma)) {
				if (this.check(TokenKind.Ident)) {
					names.push(this.advance().value)
				} else {
					this.pos = savedPos
					break
				}
			}
			if (this.check(TokenKind.Walrus)) {
				this.advance()
				const values: Expr[] = []
				values.push(this.parseExpr())
				while (this.match(TokenKind.Comma)) {
					values.push(this.parseExpr())
				}
				return { kind: "ShortDeclStmt", names, values, span }
			}
			this.pos = savedPos
		}

		// Assignment: target op= value
		const target = this.parseExpr()
		const op = tokenToAssignOp(this.peekKind())
		if (!op) {
			throw this.error(`expected ':=' or assignment in for init, got '${this.peek().value}'`)
		}
		this.advance()
		const value = this.parseExpr()
		return { kind: "AssignStmt", target, op, value, span }
	}

	private parseForPost(): AssignStmt {
		const span = this.span()
		const target = this.parseExpr()
		const tok = this.peek()
		const op = tokenToAssignOp(tok.kind)
		if (!op) {
			throw this.error(`expected assignment operator in for post-statement, got '${tok.value}'`)
		}
		this.advance()
		const value = this.parseExpr()
		return { kind: "AssignStmt", target, op, value, span }
	}

	private parseSwitchStmt(): SwitchStmt {
		const span = this.span()
		this.expect(TokenKind.Switch)
		const tag = this.parseExpr()
		this.skipNewlines()
		this.expect(TokenKind.LBrace)
		this.skipNewlines()

		const cases: CaseClause[] = []
		while (!this.check(TokenKind.RBrace) && !this.isAtEnd()) {
			cases.push(this.parseCaseClause())
			this.skipNewlines()
		}

		this.expect(TokenKind.RBrace)
		this.expectNewlineOrEnd()
		return { kind: "SwitchStmt", tag, cases, span }
	}

	private parseCaseClause(): CaseClause {
		const span = this.span()
		let isDefault = false
		const values: Expr[] = []

		if (this.match(TokenKind.Default)) {
			isDefault = true
		} else {
			this.expect(TokenKind.Case)
			values.push(this.parseExpr())
			while (this.match(TokenKind.Comma)) {
				values.push(this.parseExpr())
			}
		}

		this.expect(TokenKind.Colon)
		this.skipNewlines()

		const body: Stmt[] = []
		while (
			!this.check(TokenKind.Case) &&
			!this.check(TokenKind.Default) &&
			!this.check(TokenKind.RBrace) &&
			!this.isAtEnd()
		) {
			body.push(this.parseStmt())
			this.skipNewlines()
		}

		return { kind: "CaseClause", values, isDefault, body, span }
	}

	private parseReturnStmt(): ReturnStmt {
		const span = this.span()
		this.expect(TokenKind.Return)

		const values: Expr[] = []
		// Return with no values
		if (this.check(TokenKind.Newline) || this.check(TokenKind.RBrace) || this.isAtEnd()) {
			this.expectNewlineOrEnd()
			return { kind: "ReturnStmt", values, span }
		}

		values.push(this.parseExpr())
		while (this.match(TokenKind.Comma)) {
			values.push(this.parseExpr())
		}
		this.expectNewlineOrEnd()
		return { kind: "ReturnStmt", values, span }
	}

	private parseExprOrAssignStmt(): Stmt {
		const span = this.span()

		// Check for short declaration: ident := expr  or  ident, ident := expr, expr
		if (this.check(TokenKind.Ident)) {
			const savedPos = this.pos
			const names: string[] = []
			names.push(this.advance().value)

			// Multi-name short decl: a, b := ...
			while (this.match(TokenKind.Comma)) {
				if (this.check(TokenKind.Ident)) {
					names.push(this.advance().value)
				} else {
					// Not a short decl, backtrack
					this.pos = savedPos
					break
				}
			}

			if (this.check(TokenKind.Walrus)) {
				this.advance()
				const values: Expr[] = []
				values.push(this.parseExpr())
				while (this.match(TokenKind.Comma)) {
					values.push(this.parseExpr())
				}
				this.expectNewlineOrEnd()
				return { kind: "ShortDeclStmt", names, values, span }
			}

			// Not a short decl, backtrack
			this.pos = savedPos
		}

		// Parse expression
		const expr = this.parseExpr()

		// Check for assignment
		const assignOp = tokenToAssignOp(this.peekKind())
		if (assignOp) {
			this.advance()
			const value = this.parseExpr()
			this.expectNewlineOrEnd()
			return { kind: "AssignStmt", target: expr, op: assignOp, value, span }
		}

		this.expectNewlineOrEnd()
		return { kind: "ExprStmt", expr, span }
	}

	// --- Expression parsing (Pratt) ---

	private parseExpr(): Expr {
		return this.parseBinary(0)
	}

	private parseBinary(minPrec: number): Expr {
		let left = this.parseUnary()

		while (true) {
			const prec = binaryPrecedence(this.peekKind())
			if (prec <= minPrec) break

			const op = tokenToBinaryOp(this.peekKind())
			if (!op) break

			this.advance()
			const right = this.parseBinary(prec)
			left = {
				kind: "BinaryExpr",
				op,
				left,
				right,
				span: left.span,
			}
		}

		return left
	}

	private parseUnary(): Expr {
		const span = this.span()

		if (this.check(TokenKind.Minus)) {
			this.advance()
			const operand = this.parseUnary()
			return { kind: "UnaryExpr", op: "-", operand, span }
		}

		if (this.check(TokenKind.Not)) {
			this.advance()
			const operand = this.parseUnary()
			return { kind: "UnaryExpr", op: "!", operand, span }
		}

		return this.parsePostfix()
	}

	private parsePostfix(): Expr {
		let expr = this.parsePrimary()

		while (true) {
			if (this.check(TokenKind.Dot)) {
				this.advance()
				const field = this.expect(TokenKind.Ident).value
				expr = { kind: "FieldAccess", object: expr, field, span: expr.span }
			} else if (this.check(TokenKind.LBracket)) {
				this.advance()
				const index = this.parseExpr()
				this.expect(TokenKind.RBracket)
				expr = { kind: "IndexAccess", object: expr, index, span: expr.span }
			} else {
				break
			}
		}

		return expr
	}

	private parsePrimary(): Expr {
		const span = this.span()
		const kind = this.peekKind()

		switch (kind) {
			case TokenKind.Int: {
				const tok = this.advance()
				return { kind: "IntLiteral", value: Number.parseInt(tok.value, 10), span }
			}

			case TokenKind.Float: {
				const tok = this.advance()
				return { kind: "FloatLiteral", value: Number.parseFloat(tok.value), span }
			}

			case TokenKind.True: {
				this.advance()
				return { kind: "BoolLiteral", value: true, span }
			}

			case TokenKind.False: {
				this.advance()
				return { kind: "BoolLiteral", value: false, span }
			}

			case TokenKind.String: {
				const tok = this.advance()
				return { kind: "StringLiteral", value: tok.value, span }
			}

			case TokenKind.LParen: {
				this.advance()
				const expr = this.parseExpr()
				this.expect(TokenKind.RParen)
				return { kind: "GroupExpr", expr, span }
			}

			// Type conversion: int(x), float(x), angle(x)
			case TokenKind.IntType:
			case TokenKind.FloatType:
			case TokenKind.AngleType: {
				const typeTok = this.advance()
				if (this.check(TokenKind.LParen)) {
					this.advance()
					const args: Expr[] = []
					if (!this.check(TokenKind.RParen)) {
						args.push(this.parseExpr())
						while (this.match(TokenKind.Comma)) {
							args.push(this.parseExpr())
						}
					}
					this.expect(TokenKind.RParen)
					// Parse as a CallExpr — the analyzer will recognize type conversions
					return { kind: "CallExpr", callee: typeTok.value, args, span }
				}
				// If not followed by `(`, this is unexpected in expression context
				throw this.error(`expected '(' after type keyword '${typeTok.value}' in expression`)
			}

			case TokenKind.Ident: {
				const name = this.advance().value

				// Function call: ident(args)
				if (this.check(TokenKind.LParen)) {
					this.advance()
					const args: Expr[] = []
					if (!this.check(TokenKind.RParen)) {
						args.push(this.parseExpr())
						while (this.match(TokenKind.Comma)) {
							args.push(this.parseExpr())
						}
					}
					this.expect(TokenKind.RParen)
					return { kind: "CallExpr", callee: name, args, span }
				}

				// Struct literal: TypeName{ field: value, ... }
				if (this.typeNames.has(name) && this.check(TokenKind.LBrace)) {
					return this.parseStructLiteral(name, span)
				}

				return { kind: "Ident", name, span }
			}

			case TokenKind.LBracket: {
				return this.parseArrayLiteral(span)
			}

			default:
				throw this.error(`unexpected token '${this.peek().value}' in expression`)
		}
	}

	private parseArrayLiteral(span: Span): Expr {
		this.expect(TokenKind.LBracket)
		this.skipNewlines()
		const elements: Expr[] = []
		if (!this.check(TokenKind.RBracket)) {
			elements.push(this.parseExpr())
			while (this.match(TokenKind.Comma)) {
				this.skipNewlines()
				if (this.check(TokenKind.RBracket)) break
				elements.push(this.parseExpr())
			}
		}
		this.skipNewlines()
		this.expect(TokenKind.RBracket)
		return { kind: "ArrayLiteral", elements, span }
	}

	private parseStructLiteral(typeName: string, span: Span): Expr {
		this.expect(TokenKind.LBrace)
		this.skipNewlines()

		const fields: StructFieldInit[] = []
		while (!this.check(TokenKind.RBrace) && !this.isAtEnd()) {
			const fieldSpan = this.span()
			const name = this.expect(TokenKind.Ident).value
			this.expect(TokenKind.Colon)
			const value = this.parseExpr()
			fields.push({ name, value, span: fieldSpan })

			if (!this.match(TokenKind.Comma)) {
				this.skipNewlines()
				break
			}
			this.skipNewlines()
		}

		this.expect(TokenKind.RBrace)
		return { kind: "StructLiteral", typeName, fields, span }
	}
}

export function parse(tokens: Token[]): { program: Program; errors: CompileErrorList } {
	const parser = new Parser(tokens)
	return parser.parse()
}
