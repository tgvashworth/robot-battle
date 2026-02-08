/**
 * Custom CodeMirror 6 language mode for RBL (Robot Battle Language).
 * Uses StreamLanguage for simple token-based highlighting.
 */
import { StreamLanguage, type StreamParser, type StringStream } from "@codemirror/language"

interface RBLState {
	inBlockComment: boolean
}

const KEYWORDS = new Set([
	"func",
	"var",
	"if",
	"else",
	"for",
	"return",
	"type",
	"struct",
	"const",
	"on",
	"robot",
])

const TYPES = new Set(["int", "float", "bool", "angle", "void"])

const BUILTINS = new Set([
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
	"distanceTo",
	"bearingTo",
	"random",
	"randomFloat",
	"debug",
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
])

const EVENT_NAMES = new Set([
	"scan",
	"scanned",
	"hit",
	"bulletHit",
	"bulletMiss",
	"wallHit",
	"robotHit",
	"robotDeath",
])

const rblParser: StreamParser<RBLState> = {
	name: "rbl",

	startState(): RBLState {
		return { inBlockComment: false }
	},

	token(stream: StringStream, state: RBLState): string | null {
		// Block comment continuation
		if (state.inBlockComment) {
			if (stream.match("*/")) {
				state.inBlockComment = false
			} else {
				stream.next()
			}
			return "comment"
		}

		// Skip whitespace
		if (stream.eatSpace()) return null

		// Line comment
		if (stream.match("//")) {
			stream.skipToEnd()
			return "comment"
		}

		// Block comment start
		if (stream.match("/*")) {
			state.inBlockComment = true
			return "comment"
		}

		// Strings
		if (stream.match('"')) {
			while (!stream.eol()) {
				const ch = stream.next()
				if (ch === "\\") {
					stream.next()
				} else if (ch === '"') {
					break
				}
			}
			return "string"
		}

		// Numbers (float must be checked before int)
		if (stream.match(/^[0-9]+\.[0-9]*/)) {
			return "number"
		}
		if (stream.match(/^[0-9]+/)) {
			return "number"
		}

		// Operators
		if (
			stream.match("!=") ||
			stream.match("==") ||
			stream.match("<=") ||
			stream.match(">=") ||
			stream.match("&&") ||
			stream.match("||") ||
			stream.match("+=") ||
			stream.match("-=") ||
			stream.match("*=") ||
			stream.match("/=") ||
			stream.match(":=")
		) {
			return "operator"
		}
		if (stream.match(/^[+\-*/%<>=!&|^]/)) {
			return "operator"
		}

		// Identifiers and keywords
		if (stream.match(/^[a-zA-Z_][a-zA-Z0-9_]*/)) {
			const word = stream.current()
			if (KEYWORDS.has(word)) {
				// Special case: "on" followed by an event name
				if (word === "on") return "keyword"
				if (word === "robot") return "keyword"
				return "keyword"
			}
			if (TYPES.has(word)) return "typeName"
			if (word === "true" || word === "false") return "bool"
			if (BUILTINS.has(word)) return "variableName.special"
			if (EVENT_NAMES.has(word)) return "labelName"
			return "variableName"
		}

		// Brackets and punctuation
		if (stream.match(/^[(){}[\]]/)) {
			return "bracket"
		}

		// Skip anything else
		stream.next()
		return null
	},
}

export function rbl() {
	return StreamLanguage.define(rblParser).extension
}
