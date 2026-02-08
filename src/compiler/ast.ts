// AST Node definitions for the RBL language.
// These types represent the untyped parse tree produced by the parser.

export interface Span {
	readonly line: number
	readonly column: number
}

// --- Top-level declarations ---

export interface Program {
	readonly kind: "Program"
	readonly robotName: string
	readonly consts: ConstDecl[]
	readonly types: TypeDecl[]
	readonly globals: VarDecl[]
	readonly funcs: FuncDecl[]
	readonly events: EventDecl[]
	readonly span: Span
}

export interface ConstDecl {
	readonly kind: "ConstDecl"
	readonly name: string
	readonly value: Expr
	readonly span: Span
}

export interface TypeDecl {
	readonly kind: "TypeDecl"
	readonly name: string
	readonly fields: FieldDef[]
	readonly span: Span
}

export interface FieldDef {
	readonly name: string
	readonly typeNode: TypeNode
	readonly span: Span
}

export interface VarDecl {
	readonly kind: "VarDecl"
	readonly name: string
	readonly typeNode: TypeNode
	readonly init: Expr | null
	readonly span: Span
}

export interface FuncDecl {
	readonly kind: "FuncDecl"
	readonly name: string
	readonly params: ParamDef[]
	readonly returnType: TypeNode[]
	readonly body: Block
	readonly span: Span
}

export interface EventDecl {
	readonly kind: "EventDecl"
	readonly name: string
	readonly params: ParamDef[]
	readonly body: Block
	readonly span: Span
}

export interface ParamDef {
	readonly name: string
	readonly typeNode: TypeNode
	readonly span: Span
}

// --- Type nodes (syntax-level, before resolution) ---

export type TypeNode = PrimitiveType | ArrayType | NamedType

export interface PrimitiveType {
	readonly kind: "PrimitiveType"
	readonly name: "int" | "float" | "bool" | "angle"
	readonly span: Span
}

export interface ArrayType {
	readonly kind: "ArrayType"
	readonly size: number
	readonly elementType: TypeNode
	readonly span: Span
}

export interface NamedType {
	readonly kind: "NamedType"
	readonly name: string
	readonly span: Span
}

// --- Statements ---

export type Stmt =
	| VarStmt
	| ShortDeclStmt
	| AssignStmt
	| IfStmt
	| ForStmt
	| SwitchStmt
	| ReturnStmt
	| BreakStmt
	| ContinueStmt
	| ExprStmt
	| Block

export interface Block {
	readonly kind: "Block"
	readonly stmts: Stmt[]
	readonly span: Span
}

export interface VarStmt {
	readonly kind: "VarStmt"
	readonly name: string
	readonly typeNode: TypeNode
	readonly init: Expr | null
	readonly span: Span
}

export interface ShortDeclStmt {
	readonly kind: "ShortDeclStmt"
	readonly names: string[]
	readonly values: Expr[]
	readonly span: Span
}

export interface AssignStmt {
	readonly kind: "AssignStmt"
	readonly target: Expr
	readonly op: "=" | "+=" | "-=" | "*=" | "/="
	readonly value: Expr
	readonly span: Span
}

export interface IfStmt {
	readonly kind: "IfStmt"
	readonly condition: Expr
	readonly then: Block
	readonly else_: Block | IfStmt | null
	readonly span: Span
}

export interface ForStmt {
	readonly kind: "ForStmt"
	readonly init: ShortDeclStmt | AssignStmt | null
	readonly condition: Expr | null
	readonly post: AssignStmt | null
	readonly body: Block
	readonly span: Span
}

export interface SwitchStmt {
	readonly kind: "SwitchStmt"
	readonly tag: Expr
	readonly cases: CaseClause[]
	readonly span: Span
}

export interface CaseClause {
	readonly kind: "CaseClause"
	readonly values: Expr[]
	readonly isDefault: boolean
	readonly body: Stmt[]
	readonly span: Span
}

export interface ReturnStmt {
	readonly kind: "ReturnStmt"
	readonly values: Expr[]
	readonly span: Span
}

export interface BreakStmt {
	readonly kind: "BreakStmt"
	readonly span: Span
}

export interface ContinueStmt {
	readonly kind: "ContinueStmt"
	readonly span: Span
}

export interface ExprStmt {
	readonly kind: "ExprStmt"
	readonly expr: Expr
	readonly span: Span
}

// --- Expressions ---

export type Expr =
	| IntLiteral
	| FloatLiteral
	| BoolLiteral
	| StringLiteral
	| Ident
	| UnaryExpr
	| BinaryExpr
	| CallExpr
	| FieldAccess
	| IndexAccess
	| StructLiteral
	| GroupExpr

export interface IntLiteral {
	readonly kind: "IntLiteral"
	readonly value: number
	readonly span: Span
}

export interface FloatLiteral {
	readonly kind: "FloatLiteral"
	readonly value: number
	readonly span: Span
}

export interface BoolLiteral {
	readonly kind: "BoolLiteral"
	readonly value: boolean
	readonly span: Span
}

export interface StringLiteral {
	readonly kind: "StringLiteral"
	readonly value: string
	readonly span: Span
}

export interface Ident {
	readonly kind: "Ident"
	readonly name: string
	readonly span: Span
}

export interface UnaryExpr {
	readonly kind: "UnaryExpr"
	readonly op: "-" | "!"
	readonly operand: Expr
	readonly span: Span
}

export type BinaryOp =
	| "+"
	| "-"
	| "*"
	| "/"
	| "%"
	| "=="
	| "!="
	| "<"
	| ">"
	| "<="
	| ">="
	| "&&"
	| "||"
	| "&"
	| "|"
	| "^"
	| "<<"
	| ">>"

export interface BinaryExpr {
	readonly kind: "BinaryExpr"
	readonly op: BinaryOp
	readonly left: Expr
	readonly right: Expr
	readonly span: Span
}

export interface CallExpr {
	readonly kind: "CallExpr"
	readonly callee: string
	readonly args: Expr[]
	readonly span: Span
}

export interface FieldAccess {
	readonly kind: "FieldAccess"
	readonly object: Expr
	readonly field: string
	readonly span: Span
}

export interface IndexAccess {
	readonly kind: "IndexAccess"
	readonly object: Expr
	readonly index: Expr
	readonly span: Span
}

export interface StructLiteral {
	readonly kind: "StructLiteral"
	readonly typeName: string
	readonly fields: StructFieldInit[]
	readonly span: Span
}

export interface StructFieldInit {
	readonly name: string
	readonly value: Expr
	readonly span: Span
}

export interface GroupExpr {
	readonly kind: "GroupExpr"
	readonly expr: Expr
	readonly span: Span
}
