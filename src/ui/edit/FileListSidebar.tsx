import { useRobotFileStore } from "../store/robotFileStore"

export function FileListSidebar() {
	const files = useRobotFileStore((s) => s.files)
	const activeFileId = useRobotFileStore((s) => s.activeFileId)
	const setActiveFile = useRobotFileStore((s) => s.setActiveFile)
	const createFile = useRobotFileStore((s) => s.createFile)
	const deleteFile = useRobotFileStore((s) => s.deleteFile)
	const isDirty = useRobotFileStore((s) => s.isDirty)
	const reloadFromDisk = useRobotFileStore((s) => s.reloadFromDisk)
	const reloadAllFromDisk = useRobotFileStore((s) => s.reloadAllFromDisk)

	const handleNewRobot = () => {
		const name = `Robot${files.length + 1}.rbl`
		createFile(name)
	}

	return (
		<div
			style={{
				width: 200,
				minWidth: 200,
				padding: "12px 8px",
				display: "flex",
				flexDirection: "column",
				gap: 4,
				background: "#fafafa",
				borderRight: "1px solid #e0e0e0",
				overflowY: "auto",
			}}
		>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					marginBottom: 8,
					padding: "0 4px",
				}}
			>
				<strong
					style={{
						fontSize: 12,
						color: "#666",
						textTransform: "uppercase",
						letterSpacing: "0.04em",
					}}
				>
					Files
				</strong>
				<button
					type="button"
					onClick={handleNewRobot}
					style={{
						fontSize: 12,
						padding: "2px 8px",
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
					const dirty = isDirty(file.id)
					return (
						<li
							key={file.id}
							style={{
								display: "flex",
								justifyContent: "space-between",
								alignItems: "center",
								padding: "4px 8px",
								borderRadius: 6,
								background: isActive ? "#e8e8e8" : "transparent",
							}}
						>
							<button
								type="button"
								onClick={() => setActiveFile(file.id)}
								style={{
									flex: 1,
									color: isActive ? "#1a1a1a" : "#444",
									fontWeight: isActive ? "bold" : "normal",
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap",
									background: "none",
									border: "none",
									cursor: "pointer",
									textAlign: "left",
									padding: 0,
									fontSize: 13,
								}}
							>
								{file.filename}
							</button>
							{dirty && (
								<button
									type="button"
									aria-label={`Reload ${file.filename} from disk`}
									title="Modified — reload from disk"
									onClick={(e) => {
										e.stopPropagation()
										reloadFromDisk(file.id)
									}}
									style={{
										background: "none",
										border: "none",
										cursor: "pointer",
										padding: "0 2px",
										fontSize: 11,
										lineHeight: 1,
										color: "#ca8a04",
										flexShrink: 0,
									}}
								>
									&#x21bb;
								</button>
							)}
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
									color: "#aaa",
									cursor: "pointer",
									padding: "0 4px",
									fontSize: 13,
									lineHeight: 1,
									borderRadius: 4,
								}}
							>
								X
							</button>
						</li>
					)
				})}
			</ul>
			<button
				type="button"
				onClick={() => reloadAllFromDisk()}
				style={{
					fontSize: 11,
					color: "#888",
					background: "none",
					border: "none",
					cursor: "pointer",
					padding: "4px 8px",
					textAlign: "left",
				}}
			>
				&#x21bb; Reload all from disk
			</button>
		</div>
	)
}
