import { useCallback } from "react"
import { useRobotFileStore } from "../store/robotFileStore"
import { CodeEditor } from "./CodeEditor"
import { FileListSidebar } from "./FileListSidebar"

export function EditTab() {
	const files = useRobotFileStore((s) => s.files)
	const activeFileId = useRobotFileStore((s) => s.activeFileId)
	const updateSource = useRobotFileStore((s) => s.updateSource)

	const activeFile = files.find((f) => f.id === activeFileId)
	const source = activeFile?.source ?? ""

	const handleSourceChange = useCallback(
		(value: string) => {
			if (activeFileId) {
				updateSource(activeFileId, value)
			}
		},
		[activeFileId, updateSource],
	)

	return (
		<div style={{ display: "flex", flex: 1, minHeight: 0 }}>
			<FileListSidebar />
			<div
				style={{
					flex: 1,
					minWidth: 0,
					display: "flex",
					flexDirection: "column",
				}}
			>
				<CodeEditor value={source} onChange={handleSourceChange} />
			</div>
		</div>
	)
}
