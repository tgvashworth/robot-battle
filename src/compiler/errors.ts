export interface CompileError {
	readonly message: string
	readonly line: number
	readonly column: number
	readonly phase: "tokenize" | "parse" | "analyze" | "codegen"
	readonly hint?: string
}

export class CompileErrorList {
	readonly errors: CompileError[] = []

	add(
		phase: CompileError["phase"],
		line: number,
		column: number,
		message: string,
		hint?: string,
	): void {
		this.errors.push({ message, line, column, phase, hint })
	}

	hasErrors(): boolean {
		return this.errors.length > 0
	}
}
