// WASM codegen for RBL. Produces a valid WASM binary from a type-checked AST.

import type { AnalysisResult, FuncInfo, SymbolInfo } from "./analyzer"
import type {
	AssignStmt,
	Block,
	EventDecl,
	Expr,
	ForStmt,
	FuncDecl,
	IfStmt,
	Program,
	Stmt,
	SwitchStmt,
} from "./ast"
import type { RBLType } from "./types"
import { ANGLE, BOOL, FLOAT, INT, typeEq, typeSize } from "./types"

// --- WASM binary encoding helpers ---

/** Encode an unsigned integer as LEB128 */
function unsignedLEB128(value: number): number[] {
	const result: number[] = []
	let v = value >>> 0
	do {
		let byte = v & 0x7f
		v >>>= 7
		if (v !== 0) byte |= 0x80
		result.push(byte)
	} while (v !== 0)
	return result
}

/** Encode a signed integer as LEB128 */
function signedLEB128(input: number): number[] {
	const result: number[] = []
	let v = input
	let more = true
	while (more) {
		let byte = v & 0x7f
		v >>= 7
		if ((v === 0 && (byte & 0x40) === 0) || (v === -1 && (byte & 0x40) !== 0)) {
			more = false
		} else {
			byte |= 0x80
		}
		result.push(byte)
	}
	return result
}

/** Encode an f32 as 4 little-endian bytes */
function encodeF32(value: number): number[] {
	const buf = new ArrayBuffer(4)
	new DataView(buf).setFloat32(0, value, true)
	return [...new Uint8Array(buf)]
}

/** Encode a UTF-8 string with length prefix */
function encodeString(str: string): number[] {
	const encoded = new TextEncoder().encode(str)
	return [...unsignedLEB128(encoded.length), ...encoded]
}

/** Build a WASM section: section id + byte-length-prefixed content */
function buildSection(id: number, content: number[]): number[] {
	return [id, ...unsignedLEB128(content.length), ...content]
}

/** Encode a vector (count-prefixed list of items already encoded as bytes) */
function encodeVector(items: number[][]): number[] {
	const result: number[] = [...unsignedLEB128(items.length)]
	for (const item of items) {
		result.push(...item)
	}
	return result
}

// WASM type constants
const WASM_I32 = 0x7f
const WASM_F32 = 0x7d

// WASM section IDs
const SECTION_TYPE = 1
const SECTION_IMPORT = 2
const SECTION_FUNCTION = 3
const SECTION_MEMORY = 5
const SECTION_EXPORT = 7
const SECTION_CODE = 10

// WASM export kinds
const EXPORT_FUNC = 0x00
const EXPORT_MEMORY = 0x02

// WASM opcodes
const OP_UNREACHABLE = 0x00
const OP_BLOCK = 0x02
const OP_LOOP = 0x03
const OP_IF = 0x04
const OP_ELSE = 0x05
const OP_END = 0x0b
const OP_BR = 0x0c
const OP_BR_IF = 0x0d
const OP_RETURN = 0x0f
const OP_CALL = 0x10
const OP_DROP = 0x1a
const OP_LOCAL_GET = 0x20
const OP_LOCAL_SET = 0x21
const OP_LOCAL_TEE = 0x22
const OP_I32_LOAD = 0x28
const OP_F32_LOAD = 0x2a
const OP_I32_STORE = 0x36
const OP_F32_STORE = 0x38
const OP_I32_CONST = 0x41
const OP_F32_CONST = 0x43
const OP_I32_EQZ = 0x45
const OP_I32_EQ = 0x46
const OP_I32_NE = 0x47
const OP_I32_LT_S = 0x48
const OP_I32_GT_S = 0x4a
const OP_I32_LE_S = 0x4c
const OP_I32_GE_S = 0x4e
const OP_I32_ADD = 0x6a
const OP_I32_SUB = 0x6b
const OP_I32_MUL = 0x6c
const OP_I32_DIV_S = 0x6d
const OP_I32_REM_S = 0x6f
const OP_I32_AND = 0x71
const OP_I32_OR = 0x72
const OP_I32_XOR = 0x73
const OP_I32_SHL = 0x74
const OP_I32_SHR_S = 0x75
const OP_F32_EQ = 0x5b
const OP_F32_NE = 0x5c
const OP_F32_LT = 0x5d
const OP_F32_GT = 0x5e
const OP_F32_LE = 0x5f
const OP_F32_GE = 0x60
const OP_F32_NEG = 0x8c
const OP_F32_ADD = 0x92
const OP_F32_SUB = 0x93
const OP_F32_MUL = 0x94
const OP_F32_DIV = 0x95
const OP_I32_TRUNC_F32_S = 0xa8
const OP_F32_CONVERT_I32_S = 0xb2

// WASM block types
const BLOCK_VOID = 0x40
const BLOCK_I32 = WASM_I32

// --- Codegen ---

/** Convert an RBLType to a WASM value type byte */
function wasmValType(t: RBLType): number {
	switch (t.kind) {
		case "int":
		case "bool":
			return WASM_I32
		case "float":
		case "angle":
			return WASM_F32
		default:
			return WASM_I32
	}
}

/** Is this type stored as f32 in WASM? */
function isFloat(t: RBLType): boolean {
	return t.kind === "float" || t.kind === "angle"
}

/** Is this type stored as i32 in WASM? */
function isInt(t: RBLType): boolean {
	return t.kind === "int" || t.kind === "bool"
}

/**
 * Produce a valid WASM binary from a type-checked RBL program.
 */
export function codegen(program: Program, analysis: AnalysisResult): Uint8Array {
	const gen = new WasmCodegen(program, analysis)
	return gen.generate()
}

// Local variable info for codegen
interface LocalInfo {
	index: number
	type: RBLType
}

// Function being compiled
interface CompilingFunc {
	locals: Map<string, LocalInfo>
	nextLocalIndex: number
	funcInfo: FuncInfo
	// Break/continue label depths (stack)
	breakDepths: number[]
	continueDepths: number[]
	blockDepth: number
	// Extra locals needed (beyond params) - [count, wasmType]
	localDecls: [number, number][]
	localDeclTypes: number[] // wasm type for each local index (starting after params)
}

class WasmCodegen {
	private program: Program
	private analysis: AnalysisResult

	// Type section: list of function signatures (params, returns)
	private typeSignatures: { params: number[]; returns: number[] }[] = []
	private typeSignatureIndex = new Map<string, number>()

	// Import section
	private importEntries: {
		module: string
		name: string
		typeIndex: number
	}[] = []
	private importFuncCount = 0

	// Local functions (non-import)
	private localFuncs: { name: string; typeIndex: number; body: number[] }[] = []

	// Function name -> absolute function index (imports first, then locals)
	private funcIndex = new Map<string, number>()

	// Whether we created a synthetic init function for global initializers
	private hasSyntheticInit = false

	constructor(program: Program, analysis: AnalysisResult) {
		this.program = program
		this.analysis = analysis
	}

	generate(): Uint8Array {
		this.collectImports()
		this.collectLocalFunctions()
		this.compileFunctionBodies()
		return this.emitBinary()
	}

	// --- Phase 1: Collect imports ---

	private collectImports(): void {
		for (const [name, info] of this.analysis.funcs) {
			if (!info.isImport) continue
			const typeIndex = this.getOrCreateTypeSignature(info)
			this.importEntries.push({
				module: "env",
				name: info.wasmName,
				typeIndex,
			})
			this.funcIndex.set(name, this.importFuncCount)
			this.importFuncCount++
		}
	}

	// --- Phase 2: Collect local function signatures ---

	private collectLocalFunctions(): void {
		// Process user-defined functions
		for (const funcDecl of this.program.funcs) {
			const info = this.analysis.funcs.get(funcDecl.name)
			if (!info || info.isImport) continue
			const typeIndex = this.getOrCreateTypeSignature(info)
			const absIndex = this.importFuncCount + this.localFuncs.length
			this.funcIndex.set(funcDecl.name, absIndex)
			this.localFuncs.push({ name: funcDecl.name, typeIndex, body: [] })
		}

		// If no user-defined init() exists but we have global initializers,
		// create a synthetic init function
		const hasUserInit = this.program.funcs.some((f) => f.name === "init")
		const hasGlobalInits = this.program.globals.some((g) => g.init !== null)
		if (!hasUserInit && hasGlobalInits) {
			const synthInfo: FuncInfo = {
				name: "init",
				params: [],
				paramNames: [],
				returnTypes: [],
				isImport: false,
				isEvent: false,
				wasmName: "init",
			}
			// Register in analysis.funcs so export section can find it
			this.analysis.funcs.set("init", synthInfo)
			const typeIndex = this.getOrCreateTypeSignature(synthInfo)
			const absIndex = this.importFuncCount + this.localFuncs.length
			this.funcIndex.set("init", absIndex)
			this.localFuncs.push({ name: "init", typeIndex, body: [] })
			this.hasSyntheticInit = true
		}

		// Process event handlers
		for (const eventDecl of this.program.events) {
			const wasmName = `on_${eventDecl.name}`
			const info = this.analysis.funcs.get(wasmName)
			if (!info) continue
			const typeIndex = this.getOrCreateTypeSignature(info)
			const absIndex = this.importFuncCount + this.localFuncs.length
			this.funcIndex.set(wasmName, absIndex)
			this.localFuncs.push({ name: wasmName, typeIndex, body: [] })
		}
	}

	// --- Phase 3: Compile function bodies ---

	private compileFunctionBodies(): void {
		let localIdx = 0

		// Compile user functions
		for (const funcDecl of this.program.funcs) {
			const info = this.analysis.funcs.get(funcDecl.name)
			if (!info || info.isImport) continue
			const body = this.compileFuncDecl(funcDecl, info)
			// If this is the user's init(), prepend global initialization code
			if (funcDecl.name === "init") {
				const initCode = this.compileGlobalInitCode(body)
				const entry = this.localFuncs[localIdx]
				if (entry) entry.body = initCode
			} else {
				const entry = this.localFuncs[localIdx]
				if (entry) entry.body = body
			}
			localIdx++
		}

		// If we created a synthetic init, compile it now
		if (this.hasSyntheticInit) {
			const body = this.compileSyntheticInit()
			const entry = this.localFuncs[localIdx]
			if (entry) entry.body = body
			localIdx++
		}

		// Compile event handlers
		for (const eventDecl of this.program.events) {
			const wasmName = `on_${eventDecl.name}`
			const info = this.analysis.funcs.get(wasmName)
			if (!info) continue
			const body = this.compileEventDecl(eventDecl, info)
			const entry = this.localFuncs[localIdx]
			if (entry) entry.body = body
			localIdx++
		}
	}

	/** Compile global variable initialization code */
	private compileGlobalInitializers(ctx: CompilingFunc): number[] {
		const code: number[] = []
		for (const varDecl of this.program.globals) {
			if (!varDecl.init) continue
			const sym = this.analysis.symbols.get(varDecl.name)
			if (!sym) continue

			if (sym.type.kind === "struct" || sym.type.kind === "array") {
				// Composite type - store each field/element to memory
				code.push(...this.compileCompositeStoreToMemory(varDecl.init, sym.type, sym.location, ctx))
			} else {
				// Scalar type: push address, compile init expr, store
				code.push(OP_I32_CONST, ...signedLEB128(sym.location))
				code.push(...this.compileExpr(varDecl.init, ctx))
				if (isFloat(sym.type)) {
					code.push(OP_F32_STORE, 0x02, 0x00)
				} else {
					code.push(OP_I32_STORE, 0x02, 0x00)
				}
			}
		}
		return code
	}

	/**
	 * Prepend global initialization code to an already-compiled init function body.
	 * The body is structured as: [local decls vector] [body instructions] [OP_END]
	 * We need to insert the init code after the local decls but before the body instructions.
	 */
	private compileGlobalInitCode(existingBody: number[]): number[] {
		// Recompile the init function with global init code prepended.
		// We need a fresh context to compile the global initializers.
		const initDecl = this.program.funcs.find((f) => f.name === "init")
		if (!initDecl) return existingBody

		const info = this.analysis.funcs.get("init")
		if (!info) return existingBody

		const ctx: CompilingFunc = {
			locals: new Map(),
			nextLocalIndex: 0,
			funcInfo: info,
			breakDepths: [],
			continueDepths: [],
			blockDepth: 0,
			localDecls: [],
			localDeclTypes: [],
		}

		// Register parameters as locals
		for (let i = 0; i < initDecl.params.length; i++) {
			const paramName = initDecl.params[i]!.name
			const paramType = info.params[i]!
			ctx.locals.set(paramName, { index: ctx.nextLocalIndex, type: paramType })
			ctx.nextLocalIndex++
		}

		// Compile global initializers first, then the body
		const globalInitCode = this.compileGlobalInitializers(ctx)
		const bodyCode = this.compileBlock(initDecl.body, ctx)

		const localDecls = this.buildLocalDecls(ctx)

		const code: number[] = []
		code.push(...encodeVector(localDecls))
		code.push(...globalInitCode)
		code.push(...bodyCode)
		code.push(OP_END)

		return code
	}

	/** Compile a synthetic init function that only does global initialization */
	private compileSyntheticInit(): number[] {
		const info = this.analysis.funcs.get("init")
		if (!info) return [0x00, OP_END] // empty locals vector + end

		const ctx: CompilingFunc = {
			locals: new Map(),
			nextLocalIndex: 0,
			funcInfo: info,
			breakDepths: [],
			continueDepths: [],
			blockDepth: 0,
			localDecls: [],
			localDeclTypes: [],
		}

		const globalInitCode = this.compileGlobalInitializers(ctx)
		const localDecls = this.buildLocalDecls(ctx)

		const code: number[] = []
		code.push(...encodeVector(localDecls))
		code.push(...globalInitCode)
		code.push(OP_END)

		return code
	}

	// --- Type signature management ---

	private getOrCreateTypeSignature(info: FuncInfo): number {
		const params = info.params.map(wasmValType)
		const returns = info.returnTypes.map(wasmValType)
		const key = `${params.join(",")}->${returns.join(",")}`
		const existing = this.typeSignatureIndex.get(key)
		if (existing !== undefined) return existing
		const index = this.typeSignatures.length
		this.typeSignatures.push({ params, returns })
		this.typeSignatureIndex.set(key, index)
		return index
	}

	// --- Function body compilation ---

	private compileFuncDecl(decl: FuncDecl, info: FuncInfo): number[] {
		const ctx: CompilingFunc = {
			locals: new Map(),
			nextLocalIndex: 0,
			funcInfo: info,
			breakDepths: [],
			continueDepths: [],
			blockDepth: 0,
			localDecls: [],
			localDeclTypes: [],
		}

		// Register parameters as locals
		for (let i = 0; i < decl.params.length; i++) {
			const paramName = decl.params[i]!.name
			const paramType = info.params[i]!
			ctx.locals.set(paramName, { index: ctx.nextLocalIndex, type: paramType })
			ctx.nextLocalIndex++
		}

		// First pass: compile the body to discover needed locals
		const bodyCode = this.compileBlock(decl.body, ctx)

		// Build local declarations (grouped by type for compactness)
		const localDecls = this.buildLocalDecls(ctx)

		// Assemble the code section entry: locals + body + end
		const code: number[] = []
		// Local declarations
		code.push(...encodeVector(localDecls))
		// Body instructions
		code.push(...bodyCode)
		// End of function
		code.push(OP_END)

		return code
	}

	private compileEventDecl(decl: EventDecl, info: FuncInfo): number[] {
		const ctx: CompilingFunc = {
			locals: new Map(),
			nextLocalIndex: 0,
			funcInfo: info,
			breakDepths: [],
			continueDepths: [],
			blockDepth: 0,
			localDecls: [],
			localDeclTypes: [],
		}

		// Register parameters as locals
		for (let i = 0; i < decl.params.length; i++) {
			const paramName = decl.params[i]!.name
			const paramType = info.params[i]!
			ctx.locals.set(paramName, { index: ctx.nextLocalIndex, type: paramType })
			ctx.nextLocalIndex++
		}

		const bodyCode = this.compileBlock(decl.body, ctx)
		const localDecls = this.buildLocalDecls(ctx)

		const code: number[] = []
		code.push(...encodeVector(localDecls))
		code.push(...bodyCode)
		code.push(OP_END)
		return code
	}

	private buildLocalDecls(ctx: CompilingFunc): number[][] {
		// Group consecutive locals of the same type
		const groups: number[][] = []
		let i = ctx.funcInfo.params.length
		const types = ctx.localDeclTypes
		while (i - ctx.funcInfo.params.length < types.length) {
			const typeIdx = i - ctx.funcInfo.params.length
			const wasmType = types[typeIdx]
			if (wasmType === undefined) break
			let count = 1
			while (typeIdx + count < types.length && types[typeIdx + count] === wasmType) {
				count++
			}
			groups.push([...unsignedLEB128(count), wasmType])
			i += count
		}
		return groups
	}

	/** Allocate a new local variable in the current function */
	private allocLocal(ctx: CompilingFunc, name: string, type: RBLType): number {
		const index = ctx.nextLocalIndex++
		ctx.locals.set(name, { index, type })
		ctx.localDeclTypes.push(wasmValType(type))
		return index
	}

	/** Allocate an anonymous temp local */
	private allocTempLocal(ctx: CompilingFunc, type: RBLType): number {
		const index = ctx.nextLocalIndex++
		ctx.localDeclTypes.push(wasmValType(type))
		return index
	}

	// --- Block / Statement compilation ---

	private compileBlock(block: Block, ctx: CompilingFunc): number[] {
		const code: number[] = []
		for (const stmt of block.stmts) {
			code.push(...this.compileStmt(stmt, ctx))
		}
		return code
	}

	private compileStmt(stmt: Stmt, ctx: CompilingFunc): number[] {
		switch (stmt.kind) {
			case "VarStmt":
				return this.compileVarStmt(stmt, ctx)
			case "ShortDeclStmt":
				return this.compileShortDeclStmt(stmt, ctx)
			case "AssignStmt":
				return this.compileAssignStmt(stmt, ctx)
			case "IfStmt":
				return this.compileIfStmt(stmt, ctx)
			case "ForStmt":
				return this.compileForStmt(stmt, ctx)
			case "SwitchStmt":
				return this.compileSwitchStmt(stmt, ctx)
			case "ReturnStmt":
				return this.compileReturnStmt(stmt, ctx)
			case "BreakStmt":
				return this.compileBreakStmt(ctx)
			case "ContinueStmt":
				return this.compileContinueStmt(ctx)
			case "ExprStmt":
				return this.compileExprStmt(stmt, ctx)
			case "Block":
				return this.compileBlock(stmt, ctx)
		}
	}

	private compileVarStmt(
		stmt: { name: string; typeNode: unknown; init: Expr | null },
		ctx: CompilingFunc,
	): number[] {
		// Look up the type from the expression or the type node
		// The analyzer has resolved types, so we use the symbol info
		// For local vars declared in function bodies, the analyzer assigned locations
		// but we re-assign during codegen
		const code: number[] = []

		// Determine the type from the VarStmt
		const typeNode = stmt.typeNode as import("./ast").TypeNode
		const type = this.resolveTypeNodeToRBL(typeNode)

		if (type.kind === "struct" || type.kind === "array") {
			// Composite types: allocate multiple locals for each primitive slot
			const localIndex = this.allocCompositeLocal(ctx, stmt.name, type)
			if (stmt.init) {
				code.push(...this.compileCompositeInit(stmt.init, type, localIndex, ctx))
			}
		} else {
			const localIndex = this.allocLocal(ctx, stmt.name, type)
			if (stmt.init) {
				code.push(...this.compileExpr(stmt.init, ctx))
				code.push(OP_LOCAL_SET, ...unsignedLEB128(localIndex))
			}
		}
		return code
	}

	private compileShortDeclStmt(
		stmt: { names: readonly string[]; values: readonly Expr[] },
		ctx: CompilingFunc,
	): number[] {
		const code: number[] = []

		if (stmt.names.length === stmt.values.length) {
			for (let i = 0; i < stmt.names.length; i++) {
				const name = stmt.names[i]!
				const valueExpr = stmt.values[i]!
				const exprInfo = this.analysis.exprTypes.get(valueExpr)
				const type = exprInfo?.type ?? INT

				if (type.kind === "struct" || type.kind === "array") {
					const localIndex = this.allocCompositeLocal(ctx, name, type)
					code.push(...this.compileCompositeInit(valueExpr, type, localIndex, ctx))
				} else {
					const localIndex = this.allocLocal(ctx, name, type)
					code.push(...this.compileExpr(valueExpr, ctx))
					code.push(OP_LOCAL_SET, ...unsignedLEB128(localIndex))
				}
			}
		} else if (stmt.values.length === 1 && stmt.names.length > 1) {
			// Multi-return: for now, just handle as single value
			// TODO: multi-return functions need return via memory
			const expr = stmt.values[0]!
			code.push(...this.compileExpr(expr, ctx))
			// The first return value is on the stack; assign to first name
			const exprInfo = this.analysis.exprTypes.get(expr)
			const type = exprInfo?.type ?? INT
			const localIndex = this.allocLocal(ctx, stmt.names[0]!, type)
			code.push(OP_LOCAL_SET, ...unsignedLEB128(localIndex))
			// Remaining names get default values
			for (let i = 1; i < stmt.names.length; i++) {
				this.allocLocal(ctx, stmt.names[i]!, INT)
			}
		}

		return code
	}

	private compileAssignStmt(stmt: AssignStmt, ctx: CompilingFunc): number[] {
		const code: number[] = []

		if (stmt.op === "=") {
			// Simple assignment
			code.push(...this.compileStore(stmt.target, stmt.value, ctx))
		} else {
			// Compound assignment: +=, -=, *=, /=
			const targetType = this.analysis.exprTypes.get(stmt.target)?.type ?? INT
			// Load current value
			code.push(...this.compileExpr(stmt.target, ctx))
			// Compute new value
			code.push(...this.compileExpr(stmt.value, ctx))
			// Apply op
			const op = stmt.op[0]! as "+" | "-" | "*" | "/"
			code.push(...this.emitBinaryArith(op, targetType))
			// Store back - we need to store the result into the target
			code.push(...this.compileStoreFromStack(stmt.target, ctx))
		}

		return code
	}

	private compileStore(target: Expr, value: Expr, ctx: CompilingFunc): number[] {
		const code: number[] = []
		const targetType = this.analysis.exprTypes.get(target)?.type ?? INT

		if (target.kind === "Ident") {
			// Check if it's a composite type stored as multiple locals
			const compositeBase = ctx.locals.get(`__composite_${target.name}`)
			if (compositeBase && (targetType.kind === "struct" || targetType.kind === "array")) {
				return this.compileCompositeInit(value, targetType, compositeBase.index, ctx)
			}

			const local = ctx.locals.get(target.name)
			if (local) {
				code.push(...this.compileExpr(value, ctx))
				code.push(OP_LOCAL_SET, ...unsignedLEB128(local.index))
			} else {
				// Global variable - store to memory
				const sym = this.analysis.symbols.get(target.name)
				if (sym) {
					if (targetType.kind === "struct" || targetType.kind === "array") {
						code.push(...this.compileCompositeStoreToMemory(value, targetType, sym.location, ctx))
					} else {
						code.push(OP_I32_CONST, ...signedLEB128(sym.location))
						code.push(...this.compileExpr(value, ctx))
						if (isFloat(targetType)) {
							code.push(OP_F32_STORE, 0x02, 0x00) // align=2, offset=0
						} else {
							code.push(OP_I32_STORE, 0x02, 0x00)
						}
					}
				}
			}
		} else if (target.kind === "FieldAccess") {
			code.push(...this.compileFieldStore(target, value, ctx))
		} else if (target.kind === "IndexAccess") {
			code.push(...this.compileIndexStore(target, value, ctx))
		}

		return code
	}

	/** Store the value already on the stack into the target */
	private compileStoreFromStack(target: Expr, ctx: CompilingFunc): number[] {
		const code: number[] = []
		const targetType = this.analysis.exprTypes.get(target)?.type ?? INT

		if (target.kind === "Ident") {
			const local = ctx.locals.get(target.name)
			if (local) {
				code.push(OP_LOCAL_SET, ...unsignedLEB128(local.index))
			} else {
				const sym = this.analysis.symbols.get(target.name)
				if (sym) {
					// Need to store from stack to memory. We need address first.
					// Use a temp local to hold the value
					const tempLocal = this.allocTempLocal(ctx, targetType)
					code.push(OP_LOCAL_SET, ...unsignedLEB128(tempLocal))
					code.push(OP_I32_CONST, ...signedLEB128(sym.location))
					code.push(OP_LOCAL_GET, ...unsignedLEB128(tempLocal))
					if (isFloat(targetType)) {
						code.push(OP_F32_STORE, 0x02, 0x00)
					} else {
						code.push(OP_I32_STORE, 0x02, 0x00)
					}
				}
			}
		} else if (target.kind === "FieldAccess" || target.kind === "IndexAccess") {
			// For compound assignment to field/index, we need the address and value
			// Store to temp, then do full store
			const tempLocal = this.allocTempLocal(ctx, targetType)
			code.push(OP_LOCAL_SET, ...unsignedLEB128(tempLocal))

			// Now compile the address and store
			if (target.kind === "FieldAccess") {
				code.push(...this.compileFieldStoreFromLocal(target, tempLocal, ctx))
			} else {
				code.push(...this.compileIndexStoreFromLocal(target, tempLocal, ctx))
			}
		}

		return code
	}

	private compileIfStmt(stmt: IfStmt, ctx: CompilingFunc): number[] {
		const code: number[] = []
		// Compile condition
		code.push(...this.compileExpr(stmt.condition, ctx))
		// if block
		code.push(OP_IF, BLOCK_VOID)
		ctx.blockDepth++
		code.push(...this.compileBlock(stmt.then, ctx))
		if (stmt.else_) {
			code.push(OP_ELSE)
			if (stmt.else_.kind === "Block") {
				code.push(...this.compileBlock(stmt.else_, ctx))
			} else {
				// else if
				code.push(...this.compileIfStmt(stmt.else_, ctx))
			}
		}
		code.push(OP_END)
		ctx.blockDepth--
		return code
	}

	private compileForStmt(stmt: ForStmt, ctx: CompilingFunc): number[] {
		const code: number[] = []

		// Compile init (if any)
		if (stmt.init) {
			code.push(...this.compileStmt(stmt.init, ctx))
		}

		// Structure:
		// block $break                     ;; break targets this
		//   loop $loop                     ;; unconditional br targets this (back to top)
		//     <condition> br_if(!cond) $break
		//     block $continue              ;; continue targets this (falls through to post)
		//       <body>
		//     end
		//     <post>
		//     br $loop
		//   end
		// end

		code.push(OP_BLOCK, BLOCK_VOID) // $break block
		ctx.blockDepth++
		const breakDepth = ctx.blockDepth

		code.push(OP_LOOP, BLOCK_VOID) // $loop
		ctx.blockDepth++
		const loopDepth = ctx.blockDepth

		// Condition (if any)
		if (stmt.condition) {
			code.push(...this.compileExpr(stmt.condition, ctx))
			// br_if breaks out of outer block when condition is FALSE
			code.push(OP_I32_EQZ)
			const relBreak = ctx.blockDepth - breakDepth
			code.push(OP_BR_IF, ...unsignedLEB128(relBreak))
		}

		// Inner block for continue target
		code.push(OP_BLOCK, BLOCK_VOID) // $continue block
		ctx.blockDepth++
		const continueDepth = ctx.blockDepth

		ctx.breakDepths.push(breakDepth)
		ctx.continueDepths.push(continueDepth)

		// Body
		code.push(...this.compileBlock(stmt.body, ctx))

		code.push(OP_END) // end $continue block
		ctx.blockDepth--

		ctx.breakDepths.pop()
		ctx.continueDepths.pop()

		// Post (runs after body or after continue)
		if (stmt.post) {
			code.push(...this.compileStmt(stmt.post, ctx))
		}

		// Branch back to loop start
		const relLoop = ctx.blockDepth - loopDepth
		code.push(OP_BR, ...unsignedLEB128(relLoop))

		code.push(OP_END) // end $loop
		ctx.blockDepth--

		code.push(OP_END) // end $break block
		ctx.blockDepth--

		return code
	}

	private compileSwitchStmt(stmt: SwitchStmt, ctx: CompilingFunc): number[] {
		const code: number[] = []
		const tagType = this.analysis.exprTypes.get(stmt.tag)?.type ?? INT

		// Evaluate the tag expression into a temp
		const tagTemp = this.allocTempLocal(ctx, tagType)
		code.push(...this.compileExpr(stmt.tag, ctx))
		code.push(OP_LOCAL_SET, ...unsignedLEB128(tagTemp))

		// Compile as nested if-else chain
		// block $switch
		//   if (tag == case1_val) { ... br $switch }
		//   if (tag == case2_val) { ... br $switch }
		//   default { ... }
		// end

		code.push(OP_BLOCK, BLOCK_VOID) // $switch block
		ctx.blockDepth++

		// Push break target
		ctx.breakDepths.push(ctx.blockDepth)

		let defaultCase: (typeof stmt.cases)[number] | null = null

		for (const c of stmt.cases) {
			if (c.isDefault) {
				defaultCase = c
				continue
			}

			// Build condition: tag == val1 || tag == val2 || ...
			for (let i = 0; i < c.values.length; i++) {
				code.push(OP_LOCAL_GET, ...unsignedLEB128(tagTemp))
				code.push(...this.compileExpr(c.values[i]!, ctx))
				if (isFloat(tagType)) {
					code.push(OP_F32_EQ)
				} else {
					code.push(OP_I32_EQ)
				}
				if (i > 0) {
					code.push(OP_I32_OR)
				}
			}

			code.push(OP_IF, BLOCK_VOID)
			ctx.blockDepth++
			for (const s of c.body) {
				code.push(...this.compileStmt(s, ctx))
			}
			// Break out of switch
			const relBreak = ctx.blockDepth - ctx.breakDepths[ctx.breakDepths.length - 1]!
			code.push(OP_BR, ...unsignedLEB128(relBreak))
			code.push(OP_END)
			ctx.blockDepth--
		}

		// Default case
		if (defaultCase) {
			for (const s of defaultCase.body) {
				code.push(...this.compileStmt(s, ctx))
			}
		}

		ctx.breakDepths.pop()
		code.push(OP_END) // end $switch block
		ctx.blockDepth--

		return code
	}

	private compileReturnStmt(stmt: { values: readonly Expr[] }, ctx: CompilingFunc): number[] {
		const code: number[] = []
		if (stmt.values.length > 0) {
			code.push(...this.compileExpr(stmt.values[0]!, ctx))
		}
		code.push(OP_RETURN)
		return code
	}

	private compileBreakStmt(ctx: CompilingFunc): number[] {
		const breakTarget = ctx.breakDepths[ctx.breakDepths.length - 1]
		if (breakTarget === undefined) return []
		const relDepth = ctx.blockDepth - breakTarget
		return [OP_BR, ...unsignedLEB128(relDepth)]
	}

	private compileContinueStmt(ctx: CompilingFunc): number[] {
		const continueTarget = ctx.continueDepths[ctx.continueDepths.length - 1]
		if (continueTarget === undefined) return []
		const relDepth = ctx.blockDepth - continueTarget
		return [OP_BR, ...unsignedLEB128(relDepth)]
	}

	private compileExprStmt(stmt: { expr: Expr }, ctx: CompilingFunc): number[] {
		const code: number[] = []
		code.push(...this.compileExpr(stmt.expr, ctx))
		// Drop the result if the expression produces a value
		const exprInfo = this.analysis.exprTypes.get(stmt.expr)
		if (exprInfo && exprInfo.type.kind !== "void") {
			code.push(OP_DROP)
		}
		return code
	}

	// --- Expression compilation ---

	private compileExpr(expr: Expr, ctx: CompilingFunc): number[] {
		switch (expr.kind) {
			case "IntLiteral":
				return [OP_I32_CONST, ...signedLEB128(expr.value)]

			case "FloatLiteral":
				return [OP_F32_CONST, ...encodeF32(expr.value)]

			case "BoolLiteral":
				return [OP_I32_CONST, ...signedLEB128(expr.value ? 1 : 0)]

			case "StringLiteral":
				// Strings not supported at runtime, return 0
				return [OP_I32_CONST, ...signedLEB128(0)]

			case "Ident":
				return this.compileIdent(expr, ctx)

			case "UnaryExpr":
				return this.compileUnaryExpr(expr, ctx)

			case "BinaryExpr":
				return this.compileBinaryExpr(expr, ctx)

			case "CallExpr":
				return this.compileCallExpr(expr, ctx)

			case "FieldAccess":
				return this.compileFieldAccess(expr, ctx)

			case "IndexAccess":
				return this.compileIndexAccess(expr, ctx)

			case "StructLiteral":
				return this.compileStructLiteral(expr, ctx)

			case "GroupExpr":
				return this.compileExpr(expr.expr, ctx)
		}
	}

	private compileIdent(expr: { kind: "Ident"; name: string }, ctx: CompilingFunc): number[] {
		// Check constants first
		const constInfo = this.analysis.consts.get(expr.name)
		if (constInfo) {
			if (isFloat(constInfo.type)) {
				return [OP_F32_CONST, ...encodeF32(constInfo.value)]
			}
			return [OP_I32_CONST, ...signedLEB128(constInfo.value)]
		}

		// Check locals
		const local = ctx.locals.get(expr.name)
		if (local) {
			return [OP_LOCAL_GET, ...unsignedLEB128(local.index)]
		}

		// Check globals (stored in linear memory)
		const sym = this.analysis.symbols.get(expr.name)
		if (sym) {
			return this.compileGlobalLoad(sym)
		}

		return [OP_I32_CONST, ...signedLEB128(0)]
	}

	private compileGlobalLoad(sym: SymbolInfo): number[] {
		const code: number[] = []
		code.push(OP_I32_CONST, ...signedLEB128(sym.location))
		if (isFloat(sym.type)) {
			code.push(OP_F32_LOAD, 0x02, 0x00)
		} else {
			code.push(OP_I32_LOAD, 0x02, 0x00)
		}
		return code
	}

	private compileUnaryExpr(expr: { op: "-" | "!"; operand: Expr }, ctx: CompilingFunc): number[] {
		const code: number[] = []
		const operandType = this.analysis.exprTypes.get(expr.operand)?.type ?? INT

		code.push(...this.compileExpr(expr.operand, ctx))

		if (expr.op === "-") {
			if (isFloat(operandType)) {
				code.push(OP_F32_NEG)
			} else {
				// i32: 0 - value
				const result: number[] = [OP_I32_CONST, ...signedLEB128(0), ...code, OP_I32_SUB]
				return result
			}
		} else {
			// ! (boolean not): value == 0
			code.push(OP_I32_EQZ)
		}

		return code
	}

	private compileBinaryExpr(
		expr: { op: string; left: Expr; right: Expr },
		ctx: CompilingFunc,
	): number[] {
		const leftType = this.analysis.exprTypes.get(expr.left)?.type ?? INT

		// Short-circuit for && and ||
		if (expr.op === "&&") {
			return this.compileAndExpr(expr.left, expr.right, ctx)
		}
		if (expr.op === "||") {
			return this.compileOrExpr(expr.left, expr.right, ctx)
		}

		const code: number[] = []
		code.push(...this.compileExpr(expr.left, ctx))
		code.push(...this.compileExpr(expr.right, ctx))

		// Comparison operators
		if (
			expr.op === "==" ||
			expr.op === "!=" ||
			expr.op === "<" ||
			expr.op === ">" ||
			expr.op === "<=" ||
			expr.op === ">="
		) {
			code.push(...this.emitComparison(expr.op, leftType))
			return code
		}

		// Bitwise operators (int only)
		if (
			expr.op === "&" ||
			expr.op === "|" ||
			expr.op === "^" ||
			expr.op === "<<" ||
			expr.op === ">>"
		) {
			code.push(...this.emitBitwiseOp(expr.op))
			return code
		}

		// Modulo
		if (expr.op === "%") {
			code.push(OP_I32_REM_S)
			return code
		}

		// Arithmetic: +, -, *, /
		// Determine result type: if either is float/angle, use f32 ops
		const resultType = this.analysis.exprTypes.get(expr as Expr)?.type ?? leftType
		code.push(...this.emitBinaryArith(expr.op, resultType))

		return code
	}

	private compileAndExpr(left: Expr, right: Expr, ctx: CompilingFunc): number[] {
		// Short-circuit: if left is false, result is 0, else evaluate right
		const code: number[] = []
		code.push(...this.compileExpr(left, ctx))
		code.push(OP_IF, BLOCK_I32)
		ctx.blockDepth++
		code.push(...this.compileExpr(right, ctx))
		code.push(OP_ELSE)
		code.push(OP_I32_CONST, ...signedLEB128(0))
		code.push(OP_END)
		ctx.blockDepth--
		return code
	}

	private compileOrExpr(left: Expr, right: Expr, ctx: CompilingFunc): number[] {
		// Short-circuit: if left is true, result is 1, else evaluate right
		const code: number[] = []
		code.push(...this.compileExpr(left, ctx))
		code.push(OP_IF, BLOCK_I32)
		ctx.blockDepth++
		code.push(OP_I32_CONST, ...signedLEB128(1))
		code.push(OP_ELSE)
		code.push(...this.compileExpr(right, ctx))
		code.push(OP_END)
		ctx.blockDepth--
		return code
	}

	private emitComparison(op: string, type: RBLType): number[] {
		if (isFloat(type)) {
			switch (op) {
				case "==":
					return [OP_F32_EQ]
				case "!=":
					return [OP_F32_NE]
				case "<":
					return [OP_F32_LT]
				case ">":
					return [OP_F32_GT]
				case "<=":
					return [OP_F32_LE]
				case ">=":
					return [OP_F32_GE]
			}
		}
		switch (op) {
			case "==":
				return [OP_I32_EQ]
			case "!=":
				return [OP_I32_NE]
			case "<":
				return [OP_I32_LT_S]
			case ">":
				return [OP_I32_GT_S]
			case "<=":
				return [OP_I32_LE_S]
			case ">=":
				return [OP_I32_GE_S]
		}
		return []
	}

	private emitBitwiseOp(op: string): number[] {
		switch (op) {
			case "&":
				return [OP_I32_AND]
			case "|":
				return [OP_I32_OR]
			case "^":
				return [OP_I32_XOR]
			case "<<":
				return [OP_I32_SHL]
			case ">>":
				return [OP_I32_SHR_S]
		}
		return []
	}

	private emitBinaryArith(op: string, resultType: RBLType): number[] {
		if (isFloat(resultType)) {
			switch (op) {
				case "+":
					return [OP_F32_ADD]
				case "-":
					return [OP_F32_SUB]
				case "*":
					return [OP_F32_MUL]
				case "/":
					return [OP_F32_DIV]
			}
		}
		switch (op) {
			case "+":
				return [OP_I32_ADD]
			case "-":
				return [OP_I32_SUB]
			case "*":
				return [OP_I32_MUL]
			case "/":
				return [OP_I32_DIV_S]
		}
		return []
	}

	private compileCallExpr(
		expr: { kind: "CallExpr"; callee: string; args: readonly Expr[] },
		ctx: CompilingFunc,
	): number[] {
		const code: number[] = []

		// Type conversions: int(), float(), angle()
		if (expr.callee === "int" || expr.callee === "float" || expr.callee === "angle") {
			return this.compileTypeConversion(expr.callee, expr.args, ctx)
		}

		// debug() overload
		if (expr.callee === "debug") {
			return this.compileDebugCall(expr.args, ctx)
		}

		// Regular function call
		const funcInfo = this.analysis.funcs.get(expr.callee)
		if (!funcInfo) return [OP_I32_CONST, ...signedLEB128(0)]

		// Compile arguments
		for (const arg of expr.args) {
			code.push(...this.compileExpr(arg, ctx))
		}

		// Look up function index
		const funcIdx = this.funcIndex.get(expr.callee)
		if (funcIdx === undefined) return code
		code.push(OP_CALL, ...unsignedLEB128(funcIdx))

		return code
	}

	private compileTypeConversion(
		target: string,
		args: readonly Expr[],
		ctx: CompilingFunc,
	): number[] {
		if (args.length !== 1) return [OP_I32_CONST, ...signedLEB128(0)]
		const arg = args[0]!
		const argType = this.analysis.exprTypes.get(arg)?.type ?? INT

		const code: number[] = []
		code.push(...this.compileExpr(arg, ctx))

		if (target === "int") {
			// Convert to i32
			if (isFloat(argType)) {
				code.push(OP_I32_TRUNC_F32_S)
			}
			// int -> int is a nop
		} else if (target === "float") {
			// Convert to f32
			if (isInt(argType)) {
				code.push(OP_F32_CONVERT_I32_S)
			}
			// float -> float, angle -> float are nops (same wasm type)
		} else if (target === "angle") {
			// Convert to f32 (angle is f32)
			if (isInt(argType)) {
				code.push(OP_F32_CONVERT_I32_S)
			}
			// float -> angle, angle -> angle are nops
		}

		return code
	}

	private compileDebugCall(args: readonly Expr[], ctx: CompilingFunc): number[] {
		if (args.length !== 1) return []
		const arg = args[0]!
		const argType = this.analysis.exprTypes.get(arg)?.type ?? INT

		const code: number[] = []
		code.push(...this.compileExpr(arg, ctx))

		if (typeEq(argType, INT)) {
			const funcIdx = this.funcIndex.get("debugInt")
			if (funcIdx !== undefined) {
				code.push(OP_CALL, ...unsignedLEB128(funcIdx))
			}
		} else {
			// float or angle -> debugFloat
			const funcIdx = this.funcIndex.get("debugFloat")
			if (funcIdx !== undefined) {
				code.push(OP_CALL, ...unsignedLEB128(funcIdx))
			}
		}

		return code
	}

	// --- Field access ---

	private compileFieldAccess(expr: { object: Expr; field: string }, ctx: CompilingFunc): number[] {
		const objType = this.analysis.exprTypes.get(expr.object)?.type
		if (!objType || objType.kind !== "struct") {
			return [OP_I32_CONST, ...signedLEB128(0)]
		}

		const field = objType.fields.find((f) => f.name === expr.field)
		if (!field) return [OP_I32_CONST, ...signedLEB128(0)]

		// If object is an identifier that's a local composite
		if (expr.object.kind === "Ident") {
			const compositeBase = ctx.locals.get(`__composite_${expr.object.name}`)
			if (compositeBase) {
				// Field is at compositeBase.index + fieldSlotIndex
				const slotIndex = this.getFieldSlotIndex(objType, expr.field)
				return [OP_LOCAL_GET, ...unsignedLEB128(compositeBase.index + slotIndex)]
			}
		}

		// Otherwise, object is in memory (global)
		const code: number[] = []
		const baseAddr = this.compileAddress(expr.object, ctx)
		code.push(...baseAddr)
		// Add field offset
		if (field.offset > 0) {
			code.push(OP_I32_CONST, ...signedLEB128(field.offset))
			code.push(OP_I32_ADD)
		}
		// Load value
		if (isFloat(field.type)) {
			code.push(OP_F32_LOAD, 0x02, 0x00)
		} else {
			code.push(OP_I32_LOAD, 0x02, 0x00)
		}
		return code
	}

	private compileFieldStore(
		target: { object: Expr; field: string },
		value: Expr,
		ctx: CompilingFunc,
	): number[] {
		const objType = this.analysis.exprTypes.get(target.object)?.type
		if (!objType || objType.kind !== "struct") return []

		const field = objType.fields.find((f) => f.name === target.field)
		if (!field) return []

		// Check if local composite
		if (target.object.kind === "Ident") {
			const compositeBase = ctx.locals.get(`__composite_${target.object.name}`)
			if (compositeBase) {
				const slotIndex = this.getFieldSlotIndex(objType, target.field)
				const code: number[] = []
				code.push(...this.compileExpr(value, ctx))
				code.push(OP_LOCAL_SET, ...unsignedLEB128(compositeBase.index + slotIndex))
				return code
			}
		}

		// Global memory store
		const code: number[] = []
		const baseAddr = this.compileAddress(target.object, ctx)
		code.push(...baseAddr)
		if (field.offset > 0) {
			code.push(OP_I32_CONST, ...signedLEB128(field.offset))
			code.push(OP_I32_ADD)
		}
		code.push(...this.compileExpr(value, ctx))
		if (isFloat(field.type)) {
			code.push(OP_F32_STORE, 0x02, 0x00)
		} else {
			code.push(OP_I32_STORE, 0x02, 0x00)
		}
		return code
	}

	private compileFieldStoreFromLocal(
		target: { object: Expr; field: string },
		tempLocal: number,
		ctx: CompilingFunc,
	): number[] {
		const objType = this.analysis.exprTypes.get(target.object)?.type
		if (!objType || objType.kind !== "struct") return []

		const field = objType.fields.find((f) => f.name === target.field)
		if (!field) return []

		if (target.object.kind === "Ident") {
			const compositeBase = ctx.locals.get(`__composite_${target.object.name}`)
			if (compositeBase) {
				const slotIndex = this.getFieldSlotIndex(objType, target.field)
				return [
					OP_LOCAL_GET,
					...unsignedLEB128(tempLocal),
					OP_LOCAL_SET,
					...unsignedLEB128(compositeBase.index + slotIndex),
				]
			}
		}

		const code: number[] = []
		const baseAddr = this.compileAddress(target.object, ctx)
		code.push(...baseAddr)
		if (field.offset > 0) {
			code.push(OP_I32_CONST, ...signedLEB128(field.offset))
			code.push(OP_I32_ADD)
		}
		code.push(OP_LOCAL_GET, ...unsignedLEB128(tempLocal))
		if (isFloat(field.type)) {
			code.push(OP_F32_STORE, 0x02, 0x00)
		} else {
			code.push(OP_I32_STORE, 0x02, 0x00)
		}
		return code
	}

	// --- Index access ---

	private compileIndexAccess(expr: { object: Expr; index: Expr }, ctx: CompilingFunc): number[] {
		const objType = this.analysis.exprTypes.get(expr.object)?.type
		if (!objType || objType.kind !== "array") {
			return [OP_I32_CONST, ...signedLEB128(0)]
		}

		const elemSize = typeSize(objType.elementType)
		const elemType = objType.elementType

		// Bounds check
		const code: number[] = []

		// Check if local composite
		if (expr.object.kind === "Ident") {
			const compositeBase = ctx.locals.get(`__composite_${expr.object.name}`)
			if (compositeBase) {
				// For local arrays, we need to compute which local to read
				// Simple case: element is a primitive (4 bytes)
				const indexTemp = this.allocTempLocal(ctx, INT)
				code.push(...this.compileExpr(expr.index, ctx))
				code.push(OP_LOCAL_TEE, ...unsignedLEB128(indexTemp))

				// Bounds check
				code.push(OP_I32_CONST, ...signedLEB128(objType.size))
				code.push(OP_I32_GE_S) // unsigned comparison: index >= size
				code.push(OP_IF, BLOCK_VOID)
				ctx.blockDepth++
				code.push(OP_UNREACHABLE)
				code.push(OP_END)
				ctx.blockDepth--

				// Also check < 0
				code.push(OP_LOCAL_GET, ...unsignedLEB128(indexTemp))
				code.push(OP_I32_CONST, ...signedLEB128(0))
				code.push(OP_I32_LT_S)
				code.push(OP_IF, BLOCK_VOID)
				ctx.blockDepth++
				code.push(OP_UNREACHABLE)
				code.push(OP_END)
				ctx.blockDepth--

				// For simple primitive arrays, use a series of if-else to select the right local
				// This is not ideal for large arrays, but works for small ones
				if (elemType.kind !== "struct" && elemType.kind !== "array") {
					// Each element maps to one local starting at compositeBase.index
					// Use a block/br_table pattern, or just load from memory
					// For simplicity, compute memory address
					code.push(OP_LOCAL_GET, ...unsignedLEB128(indexTemp))
					code.push(OP_I32_CONST, ...signedLEB128(elemSize))
					code.push(OP_I32_MUL)
					// We store local arrays in actual locals - but indexing locals dynamically
					// is not possible in WASM. We need to use memory for arrays.
					// Fall through to memory-based approach for arrays accessed by dynamic index
				}

				// For arrays, we need memory-based access since WASM locals aren't indexable
				// Spill the array to a memory scratch area or handle it differently
				// For now, we'll store arrays in memory and use memory-based access
			}
		}

		// Memory-based array access (for globals and local arrays)
		return this.compileIndexAccessMemory(expr, objType, ctx)
	}

	private compileIndexAccessMemory(
		expr: { object: Expr; index: Expr },
		arrayType: RBLType & { kind: "array" },
		ctx: CompilingFunc,
	): number[] {
		const code: number[] = []
		const elemSize = typeSize(arrayType.elementType)

		// Bounds check
		const indexTemp = this.allocTempLocal(ctx, INT)
		code.push(...this.compileExpr(expr.index, ctx))
		code.push(OP_LOCAL_TEE, ...unsignedLEB128(indexTemp))

		// Check >= arraySize
		code.push(OP_I32_CONST, ...signedLEB128(arrayType.size))
		code.push(OP_I32_GE_S)
		code.push(OP_IF, BLOCK_VOID)
		ctx.blockDepth++
		code.push(OP_UNREACHABLE)
		code.push(OP_END)
		ctx.blockDepth--

		// Check < 0
		code.push(OP_LOCAL_GET, ...unsignedLEB128(indexTemp))
		code.push(OP_I32_CONST, ...signedLEB128(0))
		code.push(OP_I32_LT_S)
		code.push(OP_IF, BLOCK_VOID)
		ctx.blockDepth++
		code.push(OP_UNREACHABLE)
		code.push(OP_END)
		ctx.blockDepth--

		// Compute address: baseAddr + index * elemSize
		const baseAddr = this.compileAddress(expr.object, ctx)
		code.push(...baseAddr)
		code.push(OP_LOCAL_GET, ...unsignedLEB128(indexTemp))
		code.push(OP_I32_CONST, ...signedLEB128(elemSize))
		code.push(OP_I32_MUL)
		code.push(OP_I32_ADD)

		// Load value
		if (arrayType.elementType.kind !== "struct" && arrayType.elementType.kind !== "array") {
			if (isFloat(arrayType.elementType)) {
				code.push(OP_F32_LOAD, 0x02, 0x00)
			} else {
				code.push(OP_I32_LOAD, 0x02, 0x00)
			}
		} else {
			// For composite element types, just leave the address on the stack
			// (caller would need to access sub-fields)
		}

		return code
	}

	private compileIndexStore(
		target: { object: Expr; index: Expr },
		value: Expr,
		ctx: CompilingFunc,
	): number[] {
		const objType = this.analysis.exprTypes.get(target.object)?.type
		if (!objType || objType.kind !== "array") return []

		const elemSize = typeSize(objType.elementType)
		const code: number[] = []

		// Bounds check
		const indexTemp = this.allocTempLocal(ctx, INT)
		code.push(...this.compileExpr(target.index, ctx))
		code.push(OP_LOCAL_TEE, ...unsignedLEB128(indexTemp))

		code.push(OP_I32_CONST, ...signedLEB128(objType.size))
		code.push(OP_I32_GE_S)
		code.push(OP_IF, BLOCK_VOID)
		ctx.blockDepth++
		code.push(OP_UNREACHABLE)
		code.push(OP_END)
		ctx.blockDepth--

		code.push(OP_LOCAL_GET, ...unsignedLEB128(indexTemp))
		code.push(OP_I32_CONST, ...signedLEB128(0))
		code.push(OP_I32_LT_S)
		code.push(OP_IF, BLOCK_VOID)
		ctx.blockDepth++
		code.push(OP_UNREACHABLE)
		code.push(OP_END)
		ctx.blockDepth--

		// Compute address
		const baseAddr = this.compileAddress(target.object, ctx)
		code.push(...baseAddr)
		code.push(OP_LOCAL_GET, ...unsignedLEB128(indexTemp))
		code.push(OP_I32_CONST, ...signedLEB128(elemSize))
		code.push(OP_I32_MUL)
		code.push(OP_I32_ADD)

		// Store value
		code.push(...this.compileExpr(value, ctx))
		if (isFloat(objType.elementType)) {
			code.push(OP_F32_STORE, 0x02, 0x00)
		} else {
			code.push(OP_I32_STORE, 0x02, 0x00)
		}

		return code
	}

	private compileIndexStoreFromLocal(
		target: { object: Expr; index: Expr },
		tempLocal: number,
		ctx: CompilingFunc,
	): number[] {
		const objType = this.analysis.exprTypes.get(target.object)?.type
		if (!objType || objType.kind !== "array") return []

		const elemSize = typeSize(objType.elementType)
		const code: number[] = []

		// Bounds check (index should already have been computed)
		const indexTemp = this.allocTempLocal(ctx, INT)
		code.push(...this.compileExpr(target.index, ctx))
		code.push(OP_LOCAL_TEE, ...unsignedLEB128(indexTemp))

		code.push(OP_I32_CONST, ...signedLEB128(objType.size))
		code.push(OP_I32_GE_S)
		code.push(OP_IF, BLOCK_VOID)
		ctx.blockDepth++
		code.push(OP_UNREACHABLE)
		code.push(OP_END)
		ctx.blockDepth--

		code.push(OP_LOCAL_GET, ...unsignedLEB128(indexTemp))
		code.push(OP_I32_CONST, ...signedLEB128(0))
		code.push(OP_I32_LT_S)
		code.push(OP_IF, BLOCK_VOID)
		ctx.blockDepth++
		code.push(OP_UNREACHABLE)
		code.push(OP_END)
		ctx.blockDepth--

		// Address
		const baseAddr = this.compileAddress(target.object, ctx)
		code.push(...baseAddr)
		code.push(OP_LOCAL_GET, ...unsignedLEB128(indexTemp))
		code.push(OP_I32_CONST, ...signedLEB128(elemSize))
		code.push(OP_I32_MUL)
		code.push(OP_I32_ADD)

		code.push(OP_LOCAL_GET, ...unsignedLEB128(tempLocal))
		if (isFloat(objType.elementType)) {
			code.push(OP_F32_STORE, 0x02, 0x00)
		} else {
			code.push(OP_I32_STORE, 0x02, 0x00)
		}

		return code
	}

	// --- Address computation ---

	/** Compute the base memory address for an expression (for field/index access) */
	private compileAddress(expr: Expr, ctx: CompilingFunc): number[] {
		if (expr.kind === "Ident") {
			const sym = this.analysis.symbols.get(expr.name)
			if (sym) {
				return [OP_I32_CONST, ...signedLEB128(sym.location)]
			}
		}
		if (expr.kind === "FieldAccess") {
			const objType = this.analysis.exprTypes.get(expr.object)?.type
			if (objType && objType.kind === "struct") {
				const field = objType.fields.find((f) => f.name === expr.field)
				if (field) {
					const code = this.compileAddress(expr.object, ctx)
					if (field.offset > 0) {
						code.push(OP_I32_CONST, ...signedLEB128(field.offset))
						code.push(OP_I32_ADD)
					}
					return code
				}
			}
		}
		if (expr.kind === "IndexAccess") {
			const objType = this.analysis.exprTypes.get(expr.object)?.type
			if (objType && objType.kind === "array") {
				const elemSize = typeSize(objType.elementType)
				const code = this.compileAddress(expr.object, ctx)
				code.push(...this.compileExpr(expr.index, ctx))
				code.push(OP_I32_CONST, ...signedLEB128(elemSize))
				code.push(OP_I32_MUL)
				code.push(OP_I32_ADD)
				return code
			}
		}
		// Default: push 0
		return [OP_I32_CONST, ...signedLEB128(0)]
	}

	// --- Struct literal ---

	private compileStructLiteral(
		_expr: { typeName: string; fields: readonly { name: string; value: Expr }[] },
		_ctx: CompilingFunc,
	): number[] {
		// A struct literal is used in short decl or var init.
		// It gets compiled as part of the store operation.
		// If used as a standalone expression (weird), we'd need a temp.
		// For now, return the first field value (struct literal handling
		// is done in compileCompositeInit for proper multi-local assignment).
		// Actually struct literals should only appear in assignments/declarations,
		// so this path would be unusual. Return 0 for safety.
		return [OP_I32_CONST, ...signedLEB128(0)]
	}

	// --- Composite type helpers ---

	/** Allocate locals for a composite type (struct or array) stored in locals */
	private allocCompositeLocal(ctx: CompilingFunc, name: string, type: RBLType): number {
		// For composite types in local scope, we store in linear memory
		// at a fixed offset past the global memory area.
		// Actually, for simplicity, store composite locals in memory too.
		// We'll allocate memory space for them.

		// For structs/arrays, we use memory. Allocate a "base address" local that
		// points to the memory location.
		// Use the global memory area + a bump allocator for local composites.
		// This is simpler than trying to flatten structs into locals.

		// Actually, for correctness with arrays (dynamic indexing), we MUST use memory.
		// Allocate memory space from the end of globals.
		const size = typeSize(type)
		const baseAddr = this.localMemoryOffset
		this.localMemoryOffset += size

		// Store a local that holds the base address
		const addrLocal = ctx.nextLocalIndex++
		ctx.localDeclTypes.push(WASM_I32)
		ctx.locals.set(name, { index: addrLocal, type })
		// Also store with composite prefix so we know it's an address
		ctx.locals.set(`__composite_${name}`, { index: addrLocal, type })
		// The local will hold the memory address
		// We'll initialize it in the function prologue... actually we'll set it right away.
		// Return a marker that the init code should set the address.
		this.compositeAddresses.set(`${ctx.funcInfo.wasmName}:${name}`, baseAddr)
		return addrLocal
	}

	private localMemoryOffset = 0
	private compositeAddresses = new Map<string, number>()

	/** Compile initialization for a composite local from an expression */
	private compileCompositeInit(
		init: Expr,
		type: RBLType,
		addrLocal: number,
		ctx: CompilingFunc,
	): number[] {
		const code: number[] = []
		// Set the address local to the base address
		const baseAddr = this.getCompositeBaseAddr(ctx, addrLocal)
		code.push(OP_I32_CONST, ...signedLEB128(baseAddr))
		code.push(OP_LOCAL_SET, ...unsignedLEB128(addrLocal))

		if (init.kind === "StructLiteral" && type.kind === "struct") {
			// Initialize each field
			for (const fieldInit of init.fields) {
				const field = type.fields.find((f) => f.name === fieldInit.name)
				if (!field) continue
				// addr + field.offset
				code.push(OP_LOCAL_GET, ...unsignedLEB128(addrLocal))
				if (field.offset > 0) {
					code.push(OP_I32_CONST, ...signedLEB128(field.offset))
					code.push(OP_I32_ADD)
				}
				code.push(...this.compileExpr(fieldInit.value, ctx))
				if (isFloat(field.type)) {
					code.push(OP_F32_STORE, 0x02, 0x00)
				} else {
					code.push(OP_I32_STORE, 0x02, 0x00)
				}
			}
		}

		return code
	}

	private getCompositeBaseAddr(ctx: CompilingFunc, addrLocal: number): number {
		// Find the address for this local
		for (const [key] of this.compositeAddresses) {
			if (key.startsWith(`${ctx.funcInfo.wasmName}:`)) {
				// Check if this is the right one by looking at the local mapping
				for (const [name, info] of ctx.locals) {
					if (info.index === addrLocal && name.startsWith("__composite_")) {
						const varName = name.slice("__composite_".length)
						const fullKey = `${ctx.funcInfo.wasmName}:${varName}`
						const addr = this.compositeAddresses.get(fullKey)
						if (addr !== undefined) return addr + this.analysis.globalMemorySize
					}
				}
			}
		}
		return this.analysis.globalMemorySize
	}

	private compileCompositeStoreToMemory(
		value: Expr,
		type: RBLType,
		baseAddr: number,
		ctx: CompilingFunc,
	): number[] {
		const code: number[] = []
		if (value.kind === "StructLiteral" && type.kind === "struct") {
			for (const fieldInit of value.fields) {
				const field = type.fields.find((f) => f.name === fieldInit.name)
				if (!field) continue
				code.push(OP_I32_CONST, ...signedLEB128(baseAddr + field.offset))
				code.push(...this.compileExpr(fieldInit.value, ctx))
				if (isFloat(field.type)) {
					code.push(OP_F32_STORE, 0x02, 0x00)
				} else {
					code.push(OP_I32_STORE, 0x02, 0x00)
				}
			}
		}
		return code
	}

	/** Get the local slot index for a field within a struct's flattened slots */
	private getFieldSlotIndex(structType: RBLType, fieldName: string): number {
		if (structType.kind !== "struct") return 0
		let slot = 0
		for (const f of structType.fields) {
			if (f.name === fieldName) return slot
			slot += Math.ceil(typeSize(f.type) / 4) // each 4-byte value is one slot
		}
		return 0
	}

	// --- Type resolution helper ---

	private resolveTypeNodeToRBL(node: import("./ast").TypeNode): RBLType {
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
				const elem = this.resolveTypeNodeToRBL(node.elementType)
				return { kind: "array", size: node.size, elementType: elem }
			}
			case "NamedType": {
				const structType = this.analysis.structs.get(node.name)
				if (structType) return structType
				break
			}
		}
		return INT
	}

	// --- Emit WASM binary ---

	private emitBinary(): Uint8Array {
		const bytes: number[] = []

		// Magic number + version
		bytes.push(0x00, 0x61, 0x73, 0x6d) // \0asm
		bytes.push(0x01, 0x00, 0x00, 0x00) // version 1

		// Section 1: Type section
		bytes.push(...this.emitTypeSection())

		// Section 2: Import section
		bytes.push(...this.emitImportSection())

		// Section 3: Function section
		bytes.push(...this.emitFunctionSection())

		// Section 5: Memory section
		bytes.push(...this.emitMemorySection())

		// Section 7: Export section
		bytes.push(...this.emitExportSection())

		// Section 10: Code section
		bytes.push(...this.emitCodeSection())

		return new Uint8Array(bytes)
	}

	private emitTypeSection(): number[] {
		if (this.typeSignatures.length === 0) return []

		const types: number[][] = []
		for (const sig of this.typeSignatures) {
			const entry: number[] = [0x60] // func type
			entry.push(...unsignedLEB128(sig.params.length))
			entry.push(...sig.params)
			entry.push(...unsignedLEB128(sig.returns.length))
			entry.push(...sig.returns)
			types.push(entry)
		}

		return buildSection(SECTION_TYPE, encodeVector(types))
	}

	private emitImportSection(): number[] {
		if (this.importEntries.length === 0) return []

		const imports: number[][] = []
		for (const imp of this.importEntries) {
			const entry: number[] = []
			entry.push(...encodeString(imp.module))
			entry.push(...encodeString(imp.name))
			entry.push(0x00) // import kind: function
			entry.push(...unsignedLEB128(imp.typeIndex))
			imports.push(entry)
		}

		return buildSection(SECTION_IMPORT, encodeVector(imports))
	}

	private emitFunctionSection(): number[] {
		if (this.localFuncs.length === 0) return []

		const typeIndices: number[][] = []
		for (const func of this.localFuncs) {
			typeIndices.push(unsignedLEB128(func.typeIndex))
		}

		return buildSection(SECTION_FUNCTION, encodeVector(typeIndices))
	}

	private emitMemorySection(): number[] {
		// Calculate needed pages (64KB each)
		const totalMemory = this.analysis.globalMemorySize + this.localMemoryOffset + 65536
		const pages = Math.max(1, Math.ceil(totalMemory / 65536))

		const content: number[] = [
			...unsignedLEB128(1), // 1 memory
			0x00, // limits: no maximum
			...unsignedLEB128(pages),
		]

		return buildSection(SECTION_MEMORY, content)
	}

	private emitExportSection(): number[] {
		const exports: number[][] = []

		// Export memory
		exports.push([...encodeString("memory"), EXPORT_MEMORY, ...unsignedLEB128(0)])

		// Export functions
		for (const func of this.localFuncs) {
			const funcIdx = this.funcIndex.get(func.name)
			if (funcIdx === undefined) continue

			// Export tick, init, and event handlers
			const info = this.analysis.funcs.get(func.name)
			if (!info) continue

			if (info.wasmName === "tick" || info.wasmName === "init" || info.isEvent) {
				exports.push([...encodeString(info.wasmName), EXPORT_FUNC, ...unsignedLEB128(funcIdx)])
			}
		}

		return buildSection(SECTION_EXPORT, encodeVector(exports))
	}

	private emitCodeSection(): number[] {
		if (this.localFuncs.length === 0) return []

		const bodies: number[][] = []
		for (const func of this.localFuncs) {
			// Each code entry is size-prefixed
			const sizeAndBody: number[] = [...unsignedLEB128(func.body.length), ...func.body]
			bodies.push(sizeAndBody)
		}

		return buildSection(SECTION_CODE, encodeVector(bodies))
	}
}
