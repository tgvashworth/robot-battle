import { type Token, TokenKind, keywordKind } from "./token"

export class Lexer {
	private source: string
	private pos = 0
	private line = 1
	private column = 1
	private tokens: Token[] = []

	constructor(source: string) {
		this.source = source
	}

	tokenize(): Token[] {
		while (this.pos < this.source.length) {
			this.skipWhitespaceAndComments()
			if (this.pos >= this.source.length) break

			const ch = this.source[this.pos]!

			if (ch === "\n") {
				this.emit(TokenKind.Newline, "\n")
				this.advance()
				this.line++
				this.column = 1
				continue
			}

			if (isDigit(ch)) {
				this.readNumber()
				continue
			}

			if (ch === '"') {
				this.readString()
				continue
			}

			if (isIdentStart(ch)) {
				this.readIdentOrKeyword()
				continue
			}

			this.readOperatorOrDelimiter()
		}

		this.emit(TokenKind.EOF, "")
		return this.tokens
	}

	private peek(): string {
		return this.pos < this.source.length ? this.source[this.pos]! : "\0"
	}

	private peekNext(): string {
		return this.pos + 1 < this.source.length ? this.source[this.pos + 1]! : "\0"
	}

	private advance(): string {
		const ch = this.source[this.pos]!
		this.pos++
		this.column++
		return ch
	}

	private emit(kind: TokenKind, value: string) {
		this.tokens.push({
			kind,
			value,
			line: this.line,
			column: this.column - value.length,
		})
	}

	private skipWhitespaceAndComments() {
		while (this.pos < this.source.length) {
			const ch = this.peek()

			// Spaces and tabs only (newlines are tokens)
			if (ch === " " || ch === "\t" || ch === "\r") {
				this.advance()
				continue
			}

			// Line comment
			if (ch === "/" && this.peekNext() === "/") {
				while (this.pos < this.source.length && this.peek() !== "\n") {
					this.advance()
				}
				continue
			}

			break
		}
	}

	private readNumber() {
		const startCol = this.column
		let value = ""
		let isFloat = false

		while (this.pos < this.source.length && isDigit(this.peek())) {
			value += this.advance()
		}

		if (this.peek() === "." && isDigit(this.peekNext())) {
			isFloat = true
			value += this.advance() // consume '.'
			while (this.pos < this.source.length && isDigit(this.peek())) {
				value += this.advance()
			}
		}

		this.tokens.push({
			kind: isFloat ? TokenKind.Float : TokenKind.Int,
			value,
			line: this.line,
			column: startCol,
		})
	}

	private readString() {
		const startCol = this.column
		this.advance() // consume opening quote
		let value = ""

		while (this.pos < this.source.length && this.peek() !== '"') {
			if (this.peek() === "\n") break // unterminated string
			if (this.peek() === "\\") {
				this.advance()
				const esc = this.advance()
				switch (esc) {
					case "n":
						value += "\n"
						break
					case "t":
						value += "\t"
						break
					case "\\":
						value += "\\"
						break
					case '"':
						value += '"'
						break
					default:
						value += esc
				}
			} else {
				value += this.advance()
			}
		}

		if (this.peek() === '"') {
			this.advance() // consume closing quote
		}

		this.tokens.push({
			kind: TokenKind.String,
			value,
			line: this.line,
			column: startCol,
		})
	}

	private readIdentOrKeyword() {
		const startCol = this.column
		let value = ""

		while (this.pos < this.source.length && isIdentPart(this.peek())) {
			value += this.advance()
		}

		const kw = keywordKind(value)
		this.tokens.push({
			kind: kw ?? TokenKind.Ident,
			value,
			line: this.line,
			column: startCol,
		})
	}

	private readOperatorOrDelimiter() {
		const ch = this.peek()
		const next = this.peekNext()
		const startCol = this.column

		// Two-character operators
		const two = ch + next
		const twoCharOp = TWO_CHAR_OPS[two]
		if (twoCharOp !== undefined) {
			this.advance()
			this.advance()
			this.tokens.push({ kind: twoCharOp, value: two, line: this.line, column: startCol })
			return
		}

		// Single-character operators/delimiters
		const oneCharOp = ONE_CHAR_OPS[ch]
		if (oneCharOp !== undefined) {
			this.advance()
			this.tokens.push({ kind: oneCharOp, value: ch, line: this.line, column: startCol })
			return
		}

		// Unknown character — skip it
		this.advance()
	}
}

const TWO_CHAR_OPS: Record<string, TokenKind> = {
	":=": TokenKind.Walrus,
	"+=": TokenKind.PlusAssign,
	"-=": TokenKind.MinusAssign,
	"*=": TokenKind.StarAssign,
	"/=": TokenKind.SlashAssign,
	"==": TokenKind.Eq,
	"!=": TokenKind.NotEq,
	"<=": TokenKind.LtEq,
	">=": TokenKind.GtEq,
	"&&": TokenKind.And,
	"||": TokenKind.Or,
	"<<": TokenKind.Shl,
	">>": TokenKind.Shr,
}

const ONE_CHAR_OPS: Record<string, TokenKind> = {
	"+": TokenKind.Plus,
	"-": TokenKind.Minus,
	"*": TokenKind.Star,
	"/": TokenKind.Slash,
	"%": TokenKind.Percent,
	"=": TokenKind.Assign,
	"<": TokenKind.Lt,
	">": TokenKind.Gt,
	"!": TokenKind.Not,
	"&": TokenKind.Amp,
	"|": TokenKind.Pipe,
	"^": TokenKind.Caret,
	"(": TokenKind.LParen,
	")": TokenKind.RParen,
	"{": TokenKind.LBrace,
	"}": TokenKind.RBrace,
	"[": TokenKind.LBracket,
	"]": TokenKind.RBracket,
	",": TokenKind.Comma,
	".": TokenKind.Dot,
	":": TokenKind.Colon,
}

function isDigit(ch: string): boolean {
	return ch >= "0" && ch <= "9"
}

function isIdentStart(ch: string): boolean {
	return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_"
}

function isIdentPart(ch: string): boolean {
	return isIdentStart(ch) || isDigit(ch)
}
