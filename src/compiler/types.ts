// Resolved type system for RBL, used by the analyzer and codegen.

export type RBLType =
	| { readonly kind: "int" }
	| { readonly kind: "float" }
	| { readonly kind: "bool" }
	| { readonly kind: "angle" }
	| { readonly kind: "void" }
	| { readonly kind: "array"; readonly size: number; readonly elementType: RBLType }
	| {
			readonly kind: "struct"
			readonly name: string
			readonly fields: readonly StructField[]
	  }

export interface StructField {
	readonly name: string
	readonly type: RBLType
	readonly offset: number
	readonly size: number
}

// Singleton primitive types
export const INT: RBLType = { kind: "int" }
export const FLOAT: RBLType = { kind: "float" }
export const BOOL: RBLType = { kind: "bool" }
export const ANGLE: RBLType = { kind: "angle" }
export const VOID: RBLType = { kind: "void" }

export function typeSize(t: RBLType): number {
	switch (t.kind) {
		case "int":
		case "float":
		case "bool":
		case "angle":
			return 4
		case "void":
			return 0
		case "array":
			return t.size * typeSize(t.elementType)
		case "struct":
			return t.fields.reduce((sum, f) => sum + f.size, 0)
	}
}

export function typeEq(a: RBLType, b: RBLType): boolean {
	if (a.kind !== b.kind) return false
	if (a.kind === "array" && b.kind === "array") {
		return a.size === b.size && typeEq(a.elementType, b.elementType)
	}
	if (a.kind === "struct" && b.kind === "struct") {
		return a.name === b.name
	}
	return true
}

export function typeToString(t: RBLType): string {
	switch (t.kind) {
		case "int":
		case "float":
		case "bool":
		case "angle":
		case "void":
			return t.kind
		case "array":
			return `[${t.size}]${typeToString(t.elementType)}`
		case "struct":
			return t.name
	}
}

export function isNumeric(t: RBLType): boolean {
	return t.kind === "int" || t.kind === "float" || t.kind === "angle"
}
