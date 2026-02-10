// Semantic analyzer for RBL. Two-pass: collect declarations, then type-check bodies.

import type {
	Block,
	ConstDecl,
	EventDecl,
	Expr,
	FuncDecl,
	IfStmt,
	Program,
	Span,
	Stmt,
	TypeDecl,
	TypeNode,
	VarDecl,
} from "./ast"
import { CompileErrorList } from "./errors"
import {
	ANGLE,
	BOOL,
	FLOAT,
	INT,
	type RBLType,
	type StructField,
	VOID,
	isNumeric,
	typeEq,
	typeSize,
	typeToString,
} from "./types"

// --- Public interfaces ---

export interface ExprInfo {
	readonly type: RBLType
	readonly isLValue: boolean
	readonly isConst: boolean
	readonly constValue?: number
}

export interface SymbolInfo {
	readonly name: string
	readonly type: RBLType
	readonly scope: "global" | "local" | "param"
	readonly location: number
}

export interface FuncInfo {
	readonly name: string
	readonly params: readonly RBLType[]
	readonly paramNames: readonly string[]
	readonly returnTypes: readonly RBLType[]
	readonly isImport: boolean
	readonly isEvent: boolean
	readonly wasmName: string
}

export interface ConstInfo {
	readonly value: number
	readonly type: RBLType
}

export interface AnalysisResult {
	readonly exprTypes: Map<Expr, ExprInfo>
	readonly symbols: Map<string, SymbolInfo>
	readonly funcs: Map<string, FuncInfo>
	readonly structs: Map<string, RBLType>
	readonly consts: Map<string, ConstInfo>
	readonly globalMemorySize: number
	readonly errors: CompileErrorList
}

// --- API function registry ---

const API_REGISTRY: readonly [string, readonly RBLType[], readonly RBLType[]][] = [
	// Movement
	["setSpeed", [FLOAT], []],
	["setTurnRate", [FLOAT], []],
	["setHeading", [ANGLE], []],
	["getX", [], [FLOAT]],
	["getY", [], [FLOAT]],
	["getHeading", [], [ANGLE]],
	["getSpeed", [], [FLOAT]],
	// Gun
	["setGunTurnRate", [FLOAT], []],
	["setGunHeading", [ANGLE], []],
	["getGunHeading", [], [ANGLE]],
	["getGunHeat", [], [FLOAT]],
	["fire", [FLOAT], []],
	["getEnergy", [], [FLOAT]],
	// Radar
	["setRadarTurnRate", [FLOAT], []],
	["setRadarHeading", [ANGLE], []],
	["getRadarHeading", [], [ANGLE]],
	["setScanWidth", [FLOAT], []],
	// Status
	["getHealth", [], [FLOAT]],
	["getTick", [], [INT]],
	// Arena
	["arenaWidth", [], [FLOAT]],
	["arenaHeight", [], [FLOAT]],
	["robotCount", [], [INT]],
	// Utility
	["distanceTo", [FLOAT, FLOAT], [FLOAT]],
	["bearingTo", [FLOAT, FLOAT], [ANGLE]],
	["random", [INT], [INT]],
	["randomFloat", [], [FLOAT]],
	["debugInt", [INT], []],
	["debugFloat", [FLOAT], []],
	["debugAngle", [ANGLE], []],
	["setColor", [INT, INT, INT], []],
	["setGunColor", [INT, INT, INT], []],
	["setRadarColor", [INT, INT, INT], []],
	// Math
	["sin", [ANGLE], [FLOAT]],
	["cos", [ANGLE], [FLOAT]],
	["tan", [ANGLE], [FLOAT]],
	["atan2", [FLOAT, FLOAT], [ANGLE]],
	["sqrt", [FLOAT], [FLOAT]],
	["abs", [FLOAT], [FLOAT]],
	["min", [FLOAT, FLOAT], [FLOAT]],
	["max", [FLOAT, FLOAT], [FLOAT]],
	["clamp", [FLOAT, FLOAT, FLOAT], [FLOAT]],
	["floor", [FLOAT], [INT]],
	["ceil", [FLOAT], [INT]],
	["round", [FLOAT], [INT]],
]

const EVENT_SIGNATURES = new Map<string, readonly RBLType[]>([
	["scan", [FLOAT, ANGLE]],
	["scanned", [ANGLE]],
	["hit", [FLOAT, ANGLE]],
	["bulletHit", [INT]],
	["wallHit", [ANGLE]],
	["robotHit", [ANGLE]],
	["bulletMiss", []],
	["robotDeath", [INT]],
])

const TYPE_CONVERSIONS = new Set(["int", "float", "angle"])

// --- Entry point ---

export function analyze(program: Program): AnalysisResult {
	const a = new Analyzer()
	return a.analyze(program)
}

// --- Analyzer ---

class Analyzer {
	private errors = new CompileErrorList()
	private exprTypes = new Map<Expr, ExprInfo>()
	private globalSymbols = new Map<string, SymbolInfo>()
	private funcs = new Map<string, FuncInfo>()
	private structs = new Map<string, RBLType>()
	private consts = new Map<string, ConstInfo>()
	private localScopes: Map<string, SymbolInfo>[] = []
	private currentFunc: FuncInfo | null = null
	private loopDepth = 0
	private globalOffset = 64 // first 64 bytes reserved for return slot
	private nextLocalIndex = 0

	analyze(program: Program): AnalysisResult {
		this.registerAPIFunctions()
		this.pass1(program)
		this.pass2(program)
		this.validateRequired()
		return {
			exprTypes: this.exprTypes,
			symbols: this.globalSymbols,
			funcs: this.funcs,
			structs: this.structs,
			consts: this.consts,
			globalMemorySize: this.globalOffset,
			errors: this.errors,
		}
	}

	// --- API registration ---

	private registerAPIFunctions(): void {
		for (const [name, params, returnTypes] of API_REGISTRY) {
			this.funcs.set(name, {
				name,
				params,
				paramNames: params.map((_, i) => `p${i}`),
				returnTypes,
				isImport: true,
				isEvent: false,
				wasmName: name,
			})
		}
	}

	// --- Pass 1: collect declarations ---

	private pass1(program: Program): void {
		// Collect structs first (needed for type resolution)
		for (const typeDecl of program.types) {
			this.collectStruct(typeDecl)
		}
		// Constants
		for (const constDecl of program.consts) {
			this.collectConst(constDecl)
		}
		// Global variables
		for (const varDecl of program.globals) {
			this.collectGlobal(varDecl)
		}
		// Function signatures
		for (const funcDecl of program.funcs) {
			this.collectFunc(funcDecl)
		}
		// Event handlers
		for (const eventDecl of program.events) {
			this.collectEvent(eventDecl)
		}
	}

	private collectStruct(decl: TypeDecl): void {
		if (this.structs.has(decl.name)) {
			this.error(`type '${decl.name}' already declared`, decl.span)
			return
		}
		const fields: StructField[] = []
		let offset = 0
		for (const f of decl.fields) {
			const type = this.resolveTypeNode(f.typeNode)
			if (!type) continue
			const size = typeSize(type)
			fields.push({ name: f.name, type, offset, size })
			offset += size
		}
		const structType: RBLType = { kind: "struct", name: decl.name, fields }
		this.structs.set(decl.name, structType)
	}

	private collectConst(decl: ConstDecl): void {
		if (this.consts.has(decl.name) || this.globalSymbols.has(decl.name)) {
			this.error(`'${decl.name}' already declared`, decl.span)
			return
		}
		const result = this.evalConstExpr(decl.value)
		if (!result) {
			this.error("constant value must be a compile-time constant", decl.span)
			return
		}
		this.consts.set(decl.name, result)
	}

	private collectGlobal(decl: VarDecl): void {
		if (this.globalSymbols.has(decl.name) || this.consts.has(decl.name)) {
			this.error(`'${decl.name}' already declared`, decl.span)
			return
		}
		const type = this.resolveTypeNode(decl.typeNode)
		if (!type) return
		const size = typeSize(type)
		this.globalSymbols.set(decl.name, {
			name: decl.name,
			type,
			scope: "global",
			location: this.globalOffset,
		})
		this.globalOffset += size
	}

	private collectFunc(decl: FuncDecl): void {
		if (this.funcs.has(decl.name)) {
			this.error(`function '${decl.name}' already declared`, decl.span)
			return
		}
		const params: RBLType[] = []
		const paramNames: string[] = []
		for (const p of decl.params) {
			const type = this.resolveTypeNode(p.typeNode)
			if (type) {
				params.push(type)
				paramNames.push(p.name)
			}
		}
		const returnTypes: RBLType[] = []
		for (const rt of decl.returnType) {
			const type = this.resolveTypeNode(rt)
			if (type) returnTypes.push(type)
		}
		this.funcs.set(decl.name, {
			name: decl.name,
			params,
			paramNames,
			returnTypes,
			isImport: false,
			isEvent: false,
			wasmName: decl.name,
		})
	}

	private collectEvent(decl: EventDecl): void {
		const wasmName = `on_${decl.name}`
		if (this.funcs.has(wasmName)) {
			this.error(`event handler '${decl.name}' already declared`, decl.span)
			return
		}
		const expectedSig = EVENT_SIGNATURES.get(decl.name)
		if (!expectedSig) {
			this.error(
				`unknown event '${decl.name}', expected one of: ${[...EVENT_SIGNATURES.keys()].join(", ")}`,
				decl.span,
			)
			return
		}
		const params: RBLType[] = []
		const paramNames: string[] = []
		for (const p of decl.params) {
			const type = this.resolveTypeNode(p.typeNode)
			if (type) {
				params.push(type)
				paramNames.push(p.name)
			}
		}
		// Validate parameter count and types
		if (params.length !== expectedSig.length) {
			this.error(
				`event '${decl.name}' expects ${expectedSig.length} parameter(s), got ${params.length}`,
				decl.span,
			)
		} else {
			for (let i = 0; i < params.length; i++) {
				if (!typeEq(params[i]!, expectedSig[i]!)) {
					this.error(
						`event '${decl.name}' parameter ${i + 1} should be ${typeToString(expectedSig[i]!)}, got ${typeToString(params[i]!)}`,
						decl.params[i]!.span,
					)
				}
			}
		}
		this.funcs.set(wasmName, {
			name: decl.name,
			params,
			paramNames,
			returnTypes: [],
			isImport: false,
			isEvent: true,
			wasmName,
		})
	}

	// --- Pass 2: type-check bodies ---

	private pass2(program: Program): void {
		for (const funcDecl of program.funcs) {
			const funcInfo = this.funcs.get(funcDecl.name)
			if (!funcInfo) continue
			this.checkFuncBody(funcDecl, funcInfo)
		}
		for (const eventDecl of program.events) {
			const funcInfo = this.funcs.get(`on_${eventDecl.name}`)
			if (!funcInfo) continue
			this.checkEventBody(eventDecl, funcInfo)
		}
		// Type-check global var initializers
		for (const varDecl of program.globals) {
			if (varDecl.init) {
				const sym = this.globalSymbols.get(varDecl.name)
				if (sym) {
					const initType = this.checkExpr(varDecl.init)
					if (!typeEq(initType, sym.type)) {
						this.error(
							`cannot assign ${typeToString(initType)} to ${typeToString(sym.type)}`,
							varDecl.span,
						)
					}
				}
			}
		}
	}

	private checkFuncBody(decl: FuncDecl, info: FuncInfo): void {
		this.currentFunc = info
		this.nextLocalIndex = 0
		this.enterScope()
		// Register parameters
		for (let i = 0; i < decl.params.length; i++) {
			const p = decl.params[i]!
			const type = info.params[i]!
			this.defineLocal(p.name, type, "param", p.span)
		}
		this.checkBlock(decl.body)
		this.exitScope()
		this.currentFunc = null
	}

	private checkEventBody(decl: EventDecl, info: FuncInfo): void {
		this.currentFunc = info
		this.nextLocalIndex = 0
		this.enterScope()
		for (let i = 0; i < decl.params.length; i++) {
			const p = decl.params[i]!
			const type = info.params[i]!
			this.defineLocal(p.name, type, "param", p.span)
		}
		this.checkBlock(decl.body)
		this.exitScope()
		this.currentFunc = null
	}

	// --- Validation ---

	private validateRequired(): void {
		if (!this.funcs.has("tick")) {
			this.errors.add(
				"analyze",
				1,
				1,
				"every robot must define a tick() function",
				"add: func tick() { }",
			)
		} else {
			const tick = this.funcs.get("tick")!
			if (tick.params.length > 0) {
				this.errors.add("analyze", 1, 1, "tick() must take no parameters")
			}
			if (tick.returnTypes.length > 0) {
				this.errors.add("analyze", 1, 1, "tick() must not return a value")
			}
		}
	}

	// --- Type resolution ---

	private resolveTypeNode(node: TypeNode): RBLType | null {
		switch (node.kind) {
			case "PrimitiveType":
				switch (node.name) {
					case "int":
						return INT
					case "float":
						return FLOAT
					case "bool":
						return BOOL
					case "angle":
						return ANGLE
				}
				break
			case "ArrayType": {
				const elem = this.resolveTypeNode(node.elementType)
				if (!elem) return null
				return { kind: "array", size: node.size, elementType: elem }
			}
			case "NamedType": {
				const structType = this.structs.get(node.name)
				if (!structType) {
					this.error(`unknown type '${node.name}'`, node.span)
					return null
				}
				return structType
			}
		}
		return null
	}

	// --- Scope management ---

	private enterScope(): void {
		this.localScopes.push(new Map())
	}

	private exitScope(): void {
		this.localScopes.pop()
	}

	private defineLocal(name: string, type: RBLType, scope: "local" | "param", span: Span): void {
		const currentScope = this.localScopes[this.localScopes.length - 1]
		if (!currentScope) return
		if (currentScope.has(name)) {
			this.error(`'${name}' already declared in this scope`, span)
			return
		}
		const info: SymbolInfo = {
			name,
			type,
			scope,
			location: this.nextLocalIndex++,
		}
		currentScope.set(name, info)
	}

	private lookupSymbol(name: string): SymbolInfo | null {
		// Search local scopes top-down
		for (let i = this.localScopes.length - 1; i >= 0; i--) {
			const sym = this.localScopes[i]!.get(name)
			if (sym) return sym
		}
		// Global symbols
		const global = this.globalSymbols.get(name)
		if (global) return global
		return null
	}

	// --- Statement checking ---

	private checkBlock(block: Block): void {
		this.enterScope()
		for (const stmt of block.stmts) {
			this.checkStmt(stmt)
		}
		this.exitScope()
	}

	private checkStmt(stmt: Stmt): void {
		switch (stmt.kind) {
			case "VarStmt": {
				const type = this.resolveTypeNode(stmt.typeNode)
				if (!type) break
				if (stmt.init) {
					const initType = this.checkExpr(stmt.init)
					if (!typeEq(initType, type)) {
						this.error(
							`cannot assign ${typeToString(initType)} to ${typeToString(type)}`,
							stmt.span,
						)
					}
				}
				this.defineLocal(stmt.name, type, "local", stmt.span)
				break
			}

			case "ShortDeclStmt": {
				if (stmt.names.length === stmt.values.length) {
					// Simple case: each name gets the type of corresponding value
					for (let i = 0; i < stmt.names.length; i++) {
						const type = this.checkExpr(stmt.values[i]!)
						this.defineLocal(stmt.names[i]!, type, "local", stmt.span)
					}
				} else if (stmt.values.length === 1 && stmt.names.length > 1) {
					// Multi-return destructuring: a, b := f()
					const expr = stmt.values[0]!
					const type = this.checkExpr(expr)
					if (expr.kind === "CallExpr") {
						const funcInfo = this.funcs.get(expr.callee)
						if (funcInfo && funcInfo.returnTypes.length === stmt.names.length) {
							for (let i = 0; i < stmt.names.length; i++) {
								this.defineLocal(stmt.names[i]!, funcInfo.returnTypes[i]!, "local", stmt.span)
							}
						} else {
							this.error(
								`expected ${stmt.names.length} return values, got ${funcInfo?.returnTypes.length ?? 1}`,
								stmt.span,
							)
							for (const name of stmt.names) {
								this.defineLocal(name, INT, "local", stmt.span)
							}
						}
					} else {
						this.error(
							`cannot destructure non-function-call into ${stmt.names.length} variables`,
							stmt.span,
						)
						for (const name of stmt.names) {
							this.defineLocal(name, type, "local", stmt.span)
						}
					}
				} else {
					this.error(
						`short declaration has ${stmt.names.length} name(s) but ${stmt.values.length} value(s)`,
						stmt.span,
					)
					for (const v of stmt.values) this.checkExpr(v)
					for (const name of stmt.names) {
						this.defineLocal(name, INT, "local", stmt.span)
					}
				}
				break
			}

			case "AssignStmt": {
				const targetType = this.checkExpr(stmt.target)
				const valueType = this.checkExpr(stmt.value)
				const targetInfo = this.exprTypes.get(stmt.target)
				if (targetInfo && !targetInfo.isLValue) {
					this.error("cannot assign to this expression", stmt.span)
				}
				if (stmt.op === "=") {
					if (!typeEq(targetType, valueType)) {
						this.error(
							`cannot assign ${typeToString(valueType)} to ${typeToString(targetType)}`,
							stmt.span,
						)
					}
				} else {
					// Compound assignment: +=, -=, *=, /=
					const resultType = this.checkArithmeticOp(stmt.op[0]!, targetType, valueType, stmt.span)
					if (resultType && !typeEq(resultType, targetType)) {
						this.error(
							`compound assignment produces ${typeToString(resultType)} but target is ${typeToString(targetType)}`,
							stmt.span,
						)
					}
				}
				break
			}

			case "IfStmt":
				this.checkIfStmt(stmt.condition, stmt.then, stmt.else_)
				break

			case "ForStmt":
				this.checkForStmt(stmt)
				break

			case "SwitchStmt":
				this.checkSwitchStmt(stmt)
				break

			case "ReturnStmt":
				this.checkReturnStmt(stmt)
				break

			case "BreakStmt":
				if (this.loopDepth === 0) {
					this.error("break outside of loop", stmt.span)
				}
				break

			case "ContinueStmt":
				if (this.loopDepth === 0) {
					this.error("continue outside of loop", stmt.span)
				}
				break

			case "ExprStmt":
				this.checkExpr(stmt.expr)
				break

			case "Block":
				this.checkBlock(stmt)
				break
		}
	}

	private checkIfStmt(condition: Expr, then: Block, else_: Block | IfStmt | null): void {
		const condType = this.checkExpr(condition)
		if (!typeEq(condType, BOOL)) {
			this.error(`condition must be bool, got ${typeToString(condType)}`, condition.span)
		}
		this.checkBlock(then)
		if (else_) {
			if (else_.kind === "Block") {
				this.checkBlock(else_)
			} else {
				this.checkIfStmt(else_.condition, else_.then, else_.else_)
			}
		}
	}

	private checkForStmt(stmt: {
		readonly init: Stmt | null
		readonly condition: Expr | null
		readonly post: Stmt | null
		readonly body: Block
		readonly span: Span
	}): void {
		// The for loop creates an implicit scope for the init variable
		this.enterScope()
		if (stmt.init) this.checkStmt(stmt.init)
		if (stmt.condition) {
			const condType = this.checkExpr(stmt.condition)
			if (!typeEq(condType, BOOL)) {
				this.error(`for condition must be bool, got ${typeToString(condType)}`, stmt.condition.span)
			}
		}
		if (stmt.post) this.checkStmt(stmt.post)
		this.loopDepth++
		this.checkBlock(stmt.body)
		this.loopDepth--
		this.exitScope()
	}

	private checkSwitchStmt(stmt: {
		readonly tag: Expr
		readonly cases: readonly {
			readonly values: readonly Expr[]
			readonly isDefault: boolean
			readonly body: readonly Stmt[]
			readonly span: Span
		}[]
		readonly span: Span
	}): void {
		const tagType = this.checkExpr(stmt.tag)
		for (const c of stmt.cases) {
			for (const v of c.values) {
				const valType = this.checkExpr(v)
				if (!typeEq(valType, tagType)) {
					this.error(
						`case value type ${typeToString(valType)} does not match switch tag type ${typeToString(tagType)}`,
						v.span,
					)
				}
			}
			for (const s of c.body) {
				this.checkStmt(s)
			}
		}
	}

	private checkReturnStmt(stmt: {
		readonly values: readonly Expr[]
		readonly span: Span
	}): void {
		if (!this.currentFunc) return
		const expected = this.currentFunc.returnTypes
		if (stmt.values.length !== expected.length) {
			this.error(
				`expected ${expected.length} return value(s), got ${stmt.values.length}`,
				stmt.span,
			)
		}
		for (let i = 0; i < stmt.values.length; i++) {
			const type = this.checkExpr(stmt.values[i]!)
			const exp = expected[i]
			if (exp && !typeEq(type, exp)) {
				this.error(
					`return value ${i + 1}: expected ${typeToString(exp)}, got ${typeToString(type)}`,
					stmt.span,
				)
			}
		}
	}

	// --- Expression checking ---

	private checkExpr(expr: Expr): RBLType {
		let type: RBLType = VOID
		let isLValue = false
		let isConst = false
		let constValue: number | undefined

		switch (expr.kind) {
			case "IntLiteral":
				type = INT
				isConst = true
				constValue = expr.value
				break

			case "FloatLiteral":
				type = FLOAT
				isConst = true
				constValue = expr.value
				break

			case "BoolLiteral":
				type = BOOL
				isConst = true
				constValue = expr.value ? 1 : 0
				break

			case "StringLiteral":
				this.error("string type not supported in expressions", expr.span)
				break

			case "Ident": {
				const sym = this.lookupSymbol(expr.name)
				if (sym) {
					type = sym.type
					isLValue = true
				} else {
					const constInfo = this.consts.get(expr.name)
					if (constInfo) {
						type = constInfo.type
						isConst = true
						constValue = constInfo.value
					} else {
						this.error(
							`undefined variable '${expr.name}'`,
							expr.span,
							`use ':=' to declare a new variable`,
						)
					}
				}
				break
			}

			case "UnaryExpr": {
				const operandType = this.checkExpr(expr.operand)
				if (expr.op === "-") {
					if (!isNumeric(operandType)) {
						this.error(
							`unary '-' requires numeric type, got ${typeToString(operandType)}`,
							expr.span,
						)
					} else {
						type = operandType
					}
				} else {
					// !
					if (!typeEq(operandType, BOOL)) {
						this.error(`unary '!' requires bool, got ${typeToString(operandType)}`, expr.span)
					}
					type = BOOL
				}
				break
			}

			case "BinaryExpr": {
				const leftType = this.checkExpr(expr.left)
				const rightType = this.checkExpr(expr.right)
				type = this.checkBinaryExpr(expr.op, leftType, rightType, expr.span)
				break
			}

			case "CallExpr": {
				type = this.checkCallExpr(expr)
				break
			}

			case "FieldAccess": {
				const objectType = this.checkExpr(expr.object)
				const objectInfo = this.exprTypes.get(expr.object)
				if (objectType.kind !== "struct") {
					this.error(`cannot access field on ${typeToString(objectType)}`, expr.span)
				} else {
					const field = objectType.fields.find((f) => f.name === expr.field)
					if (!field) {
						this.error(`type '${objectType.name}' has no field '${expr.field}'`, expr.span)
					} else {
						type = field.type
						isLValue = objectInfo?.isLValue ?? false
					}
				}
				break
			}

			case "IndexAccess": {
				const objectType = this.checkExpr(expr.object)
				const indexType = this.checkExpr(expr.index)
				const objectInfo = this.exprTypes.get(expr.object)
				if (objectType.kind !== "array") {
					this.error(`cannot index ${typeToString(objectType)}`, expr.span)
				} else {
					type = objectType.elementType
					isLValue = objectInfo?.isLValue ?? false
				}
				if (!typeEq(indexType, INT)) {
					this.error(`array index must be int, got ${typeToString(indexType)}`, expr.span)
				}
				break
			}

			case "StructLiteral": {
				const structType = this.structs.get(expr.typeName)
				if (!structType) {
					this.error(`unknown struct type '${expr.typeName}'`, expr.span)
				} else if (structType.kind === "struct") {
					type = structType
					for (const fieldInit of expr.fields) {
						const field = structType.fields.find((f) => f.name === fieldInit.name)
						if (!field) {
							this.error(`type '${expr.typeName}' has no field '${fieldInit.name}'`, fieldInit.span)
						} else {
							const valType = this.checkExpr(fieldInit.value)
							if (!typeEq(valType, field.type)) {
								this.error(
									`field '${fieldInit.name}': expected ${typeToString(field.type)}, got ${typeToString(valType)}`,
									fieldInit.span,
								)
							}
						}
					}
				}
				break
			}

			case "GroupExpr": {
				type = this.checkExpr(expr.expr)
				const innerInfo = this.exprTypes.get(expr.expr)
				if (innerInfo) {
					isLValue = innerInfo.isLValue
					isConst = innerInfo.isConst
					constValue = innerInfo.constValue
				}
				break
			}
		}

		this.exprTypes.set(expr, { type, isLValue, isConst, constValue })
		return type
	}

	private checkBinaryExpr(op: string, left: RBLType, right: RBLType, span: Span): RBLType {
		// Logical operators
		if (op === "&&" || op === "||") {
			if (!typeEq(left, BOOL)) {
				this.error(`'${op}' requires bool operands, got ${typeToString(left)}`, span)
			}
			if (!typeEq(right, BOOL)) {
				this.error(`'${op}' requires bool operands, got ${typeToString(right)}`, span)
			}
			return BOOL
		}

		// Comparison operators
		if (op === "==" || op === "!=" || op === "<" || op === ">" || op === "<=" || op === ">=") {
			if (op === "==" || op === "!=") {
				// Equality: any matching types
				if (!typeEq(left, right)) {
					this.error(`cannot compare ${typeToString(left)} and ${typeToString(right)}`, span)
				}
			} else {
				// Ordering: numeric types only, must match
				if (!isNumeric(left) || !isNumeric(right)) {
					this.error(
						`'${op}' requires numeric operands, got ${typeToString(left)} and ${typeToString(right)}`,
						span,
					)
				} else if (!typeEq(left, right)) {
					this.error(`cannot compare ${typeToString(left)} and ${typeToString(right)}`, span)
				}
			}
			return BOOL
		}

		// Bitwise operators
		if (op === "&" || op === "|" || op === "^" || op === "<<" || op === ">>") {
			if (!typeEq(left, INT) || !typeEq(right, INT)) {
				this.error(
					`'${op}' requires int operands, got ${typeToString(left)} and ${typeToString(right)}`,
					span,
				)
			}
			return INT
		}

		// Modulo: int only
		if (op === "%") {
			if (!typeEq(left, INT) || !typeEq(right, INT)) {
				this.error(
					`'%' requires int operands, got ${typeToString(left)} and ${typeToString(right)}`,
					span,
				)
			}
			return INT
		}

		// Arithmetic operators: +, -, *, /
		return this.checkArithmeticOp(op, left, right, span) ?? VOID
	}

	private checkArithmeticOp(op: string, left: RBLType, right: RBLType, span: Span): RBLType | null {
		// Same scalar types
		if (typeEq(left, right)) {
			if (typeEq(left, INT) || typeEq(left, FLOAT)) return left
			if (typeEq(left, ANGLE)) {
				if (op === "+" || op === "-") return ANGLE
				this.error(`cannot use '${op}' on two angle values`, span)
				return ANGLE
			}
			this.error(`cannot use '${op}' on ${typeToString(left)}`, span)
			return null
		}

		// angle * float or angle / float (angle must be on LEFT)
		if (typeEq(left, ANGLE) && typeEq(right, FLOAT)) {
			if (op === "*" || op === "/") return ANGLE
			this.error(`cannot use '${op}' on angle and float`, span)
			return null
		}

		// float * angle or float / angle => ERROR (angle must be on left)
		if (typeEq(left, FLOAT) && typeEq(right, ANGLE)) {
			this.error(
				`angle must be on the left side of '${op}' (write 'angle ${op} float', not 'float ${op} angle')`,
				span,
			)
			return ANGLE
		}

		this.error(`cannot use '${op}' on ${typeToString(left)} and ${typeToString(right)}`, span)
		return null
	}

	private checkCallExpr(expr: {
		readonly kind: "CallExpr"
		readonly callee: string
		readonly args: readonly Expr[]
		readonly span: Span
	}): RBLType {
		const callee = expr.callee

		// Type conversions: int(x), float(x), angle(x)
		if (TYPE_CONVERSIONS.has(callee)) {
			return this.checkTypeConversion(callee, expr.args, expr.span)
		}

		// debug() overload
		if (callee === "debug") {
			return this.checkDebugCall(expr.args, expr.span)
		}

		// Regular function call
		const funcInfo = this.funcs.get(callee)
		if (!funcInfo) {
			this.error(`undefined function '${callee}'`, expr.span)
			// Still type-check args
			for (const arg of expr.args) this.checkExpr(arg)
			return VOID
		}

		if (expr.args.length !== funcInfo.params.length) {
			this.error(
				`'${callee}' expects ${funcInfo.params.length} argument(s), got ${expr.args.length}`,
				expr.span,
			)
		}

		for (let i = 0; i < expr.args.length; i++) {
			const argType = this.checkExpr(expr.args[i]!)
			const paramType = funcInfo.params[i]
			if (paramType && !typeEq(argType, paramType)) {
				this.error(
					`argument ${i + 1} of '${callee}': expected ${typeToString(paramType)}, got ${typeToString(argType)}`,
					expr.args[i]!.span,
				)
			}
		}

		if (funcInfo.returnTypes.length === 0) return VOID
		if (funcInfo.returnTypes.length === 1) return funcInfo.returnTypes[0]!
		// Multi-return in expression context — only valid in destructuring
		return funcInfo.returnTypes[0]!
	}

	private checkTypeConversion(target: string, args: readonly Expr[], span: Span): RBLType {
		if (args.length !== 1) {
			this.error(`${target}() takes exactly 1 argument`, span)
			for (const arg of args) this.checkExpr(arg)
			return target === "int" ? INT : target === "float" ? FLOAT : ANGLE
		}
		const argType = this.checkExpr(args[0]!)
		const targetType = target === "int" ? INT : target === "float" ? FLOAT : ANGLE

		// Allowed conversions:
		// int <-> float, int <-> angle, float <-> angle
		if (!isNumeric(argType)) {
			this.error(`cannot convert ${typeToString(argType)} to ${target}`, span)
		}
		return targetType
	}

	private checkDebugCall(args: readonly Expr[], span: Span): RBLType {
		if (args.length !== 1) {
			this.error("debug() takes exactly 1 argument", span)
			for (const arg of args) this.checkExpr(arg)
			return VOID
		}
		const argType = this.checkExpr(args[0]!)
		if (typeEq(argType, INT)) {
			// resolves to debugInt
		} else if (typeEq(argType, FLOAT) || typeEq(argType, ANGLE)) {
			// resolves to debugFloat
		} else {
			this.error(
				`debug() requires int, float, or angle argument, got ${typeToString(argType)}`,
				span,
			)
		}
		return VOID
	}

	// --- Constant evaluation ---

	private evalConstExpr(expr: Expr): ConstInfo | null {
		switch (expr.kind) {
			case "IntLiteral":
				return { value: expr.value, type: INT }
			case "FloatLiteral":
				return { value: expr.value, type: FLOAT }
			case "BoolLiteral":
				return { value: expr.value ? 1 : 0, type: BOOL }
			case "UnaryExpr":
				if (expr.op === "-") {
					const inner = this.evalConstExpr(expr.operand)
					if (inner && isNumeric(inner.type)) {
						return { value: -inner.value, type: inner.type }
					}
				}
				return null
			case "Ident": {
				const c = this.consts.get(expr.name)
				if (c) return c
				return null
			}
			default:
				return null
		}
	}

	// --- Error helpers ---

	private error(message: string, span: Span, hint?: string): void {
		this.errors.add("analyze", span.line, span.column, message, hint)
	}
}
