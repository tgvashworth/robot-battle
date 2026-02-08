import { useCallback, useState } from "react"
import { Lexer } from "../../compiler"
import { useRobotFileStore } from "../store/robotFileStore"
import { FileListSidebar } from "./FileListSidebar"

export function EditTab() {
	const files = useRobotFileStore((s) => s.files)
	const activeFileId = useRobotFileStore((s) => s.activeFileId)
	const updateSource = useRobotFileStore((s) => s.updateSource)

	const activeFile = files.find((f) => f.id === activeFileId)
	const source = activeFile?.source ?? ""

	const [tokenCount, setTokenCount] = useState<number | null>(null)

	const handleTokenize = useCallback(() => {
		const tokens = new Lexer(source).tokenize()
		setTokenCount(tokens.length)
	}, [source])

	const handleSourceChange = useCallback(
		(e: React.ChangeEvent<HTMLTextAreaElement>) => {
			if (activeFileId) {
				updateSource(activeFileId, e.target.value)
			}
		},
		[activeFileId, updateSource],
	)

	return (
		<div>
			<h2>Editor</h2>
			<div style={{ display: "flex", gap: 0 }}>
				<FileListSidebar />
				<div style={{ flex: 1, minWidth: 0 }}>
					<textarea
						value={source}
						onChange={handleSourceChange}
						style={{
							width: "100%",
							height: 300,
							fontFamily: "monospace",
							fontSize: 13,
							background: "#1a1a2e",
							color: "#e0e0e0",
							border: "1px solid #444",
							padding: 8,
							boxSizing: "border-box",
						}}
					/>
					<div style={{ marginTop: 8 }}>
						<button type="button" onClick={handleTokenize}>
							Tokenize
						</button>
						{tokenCount !== null && <span style={{ marginLeft: 12 }}>{tokenCount} tokens</span>}
					</div>
				</div>
			</div>
		</div>
	)
}
