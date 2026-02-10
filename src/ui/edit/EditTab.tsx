import { useCallback, useEffect, useRef, useState } from "react"
import { compile } from "../../compiler"
import { useRobotFileStore } from "../store/robotFileStore"
import type { Diagnostic } from "./CodeEditor"
import { CodeEditor } from "./CodeEditor"
import { FileListSidebar } from "./FileListSidebar"

interface CompileStatus {
	errorCount: number
	warningCount: number
}

function mapErrorsToDiagnostics(
	source: string,
	errors: { line: number; column: number; message: string }[],
): Diagnostic[] {
	const lineOffsets: number[] = [0]
	for (let i = 0; i < source.length; i++) {
		if (source[i] === "\n") {
			lineOffsets.push(i + 1)
		}
	}

	const diagnostics: Diagnostic[] = []
	for (const err of errors) {
		const lineIdx = err.line - 1
		const offset = lineOffsets[lineIdx]
		if (offset == null) continue
		const from = offset + (err.column - 1)
		// Extend "to" to end of the token or at least 1 character
		const lineEnd = lineOffsets[lineIdx + 1] ?? source.length
		const to = Math.min(from + 1, lineEnd)
		diagnostics.push({
			from,
			to,
			severity: "error",
			message: err.message,
		})
	}
	return diagnostics
}

export function EditTab() {
	const files = useRobotFileStore((s) => s.files)
	const activeFileId = useRobotFileStore((s) => s.activeFileId)
	const updateSource = useRobotFileStore((s) => s.updateSource)

	const activeFile = files.find((f) => f.id === activeFileId)
	const source = activeFile?.source ?? ""

	const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([])
	const [compileStatus, setCompileStatus] = useState<CompileStatus | null>(null)
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const prevFileIdRef = useRef(activeFileId)

	const handleSourceChange = useCallback(
		(value: string) => {
			if (activeFileId) {
				updateSource(activeFileId, value)
			}
		},
		[activeFileId, updateSource],
	)

	// Debounced compilation — also clears immediately when switching files
	useEffect(() => {
		if (timerRef.current) {
			clearTimeout(timerRef.current)
		}

		// Clear diagnostics immediately when switching files
		if (prevFileIdRef.current !== activeFileId) {
			prevFileIdRef.current = activeFileId
			setDiagnostics([])
			setCompileStatus(null)
		}

		if (!source) {
			setDiagnostics([])
			setCompileStatus(null)
			return
		}

		timerRef.current = setTimeout(() => {
			const result = compile(source)
			if (result.success) {
				setDiagnostics([])
				setCompileStatus({ errorCount: 0, warningCount: 0 })
			} else {
				const mapped = mapErrorsToDiagnostics(source, result.errors.errors)
				setDiagnostics(mapped)
				setCompileStatus({
					errorCount: result.errors.errors.length,
					warningCount: 0,
				})
			}
		}, 300)

		return () => {
			if (timerRef.current) {
				clearTimeout(timerRef.current)
			}
		}
	}, [source, activeFileId])

	return (
		<div style={{ display: "flex", flex: 1, minHeight: 0 }}>
			<FileListSidebar />
			<div
				style={{
					flex: 1,
					minWidth: 0,
					minHeight: 0,
					display: "flex",
					flexDirection: "column",
				}}
			>
				<CodeEditor value={source} onChange={handleSourceChange} diagnostics={diagnostics} />
				{compileStatus && (
					<div
						style={{
							padding: "4px 12px",
							fontSize: 12,
							color: compileStatus.errorCount > 0 ? "#dc2626" : "#16a34a",
							background: "#ffffff",
							borderTop: "1px solid #e0e0e0",
							flexShrink: 0,
						}}
					>
						{compileStatus.errorCount > 0
							? `${compileStatus.errorCount} error${compileStatus.errorCount !== 1 ? "s" : ""}`
							: "Compiled OK"}
					</div>
				)}
			</div>
		</div>
	)
}
