import { useRobotFileStore } from "../store/robotFileStore"

export function FileListSidebar() {
	const files = useRobotFileStore((s) => s.files)
	const activeFileId = useRobotFileStore((s) => s.activeFileId)
	const setActiveFile = useRobotFileStore((s) => s.setActiveFile)
	const createFile = useRobotFileStore((s) => s.createFile)
	const deleteFile = useRobotFileStore((s) => s.deleteFile)

	const handleNewRobot = () => {
		const name = `Robot${files.length + 1}.rbl`
		createFile(name)
	}

	return (
		<div
			style={{
				width: 200,
				minWidth: 200,
				borderRight: "1px solid #444",
				padding: 8,
				display: "flex",
				flexDirection: "column",
				gap: 4,
			}}
		>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					marginBottom: 8,
				}}
			>
				<strong style={{ color: "#e0e0e0" }}>Files</strong>
				<button
					type="button"
					onClick={handleNewRobot}
					style={{
						background: "#2a2a4a",
						color: "#e0e0e0",
						border: "1px solid #555",
						borderRadius: 4,
						padding: "2px 8px",
						cursor: "pointer",
						fontSize: 12,
					}}
				>
					+ New Robot
				</button>
			</div>
			<ul
				style={{
					listStyle: "none",
					margin: 0,
					padding: 0,
					display: "flex",
					flexDirection: "column",
					gap: 2,
				}}
			>
				{files.map((file) => {
					const isActive = file.id === activeFileId
					return (
						<li
							key={file.id}
							style={{
								display: "flex",
								justifyContent: "space-between",
								alignItems: "center",
								padding: "4px 6px",
								borderRadius: 4,
								background: isActive ? "#2a2a4a" : "transparent",
								cursor: "pointer",
							}}
						>
							<button
								type="button"
								onClick={() => setActiveFile(file.id)}
								style={{
									flex: 1,
									color: "#e0e0e0",
									fontWeight: isActive ? "bold" : "normal",
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap",
									background: "none",
									border: "none",
									cursor: "pointer",
									textAlign: "left",
									padding: 0,
									fontFamily: "inherit",
									fontSize: "inherit",
								}}
							>
								{file.filename}
							</button>
							<button
								type="button"
								aria-label={`Delete ${file.filename}`}
								onClick={(e) => {
									e.stopPropagation()
									deleteFile(file.id)
								}}
								style={{
									background: "none",
									border: "none",
									color: "#888",
									cursor: "pointer",
									padding: "0 4px",
									fontSize: 14,
									lineHeight: 1,
								}}
							>
								X
							</button>
						</li>
					)
				})}
			</ul>
		</div>
	)
}
