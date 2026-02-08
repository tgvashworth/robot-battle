import { useEffect } from "react"
import { BattleTab } from "./battle/BattleTab"
import { EditTab } from "./edit/EditTab"
import { useRobotFileStore } from "./store/robotFileStore"

export function App() {
	const loadFromManifest = useRobotFileStore((s) => s.loadFromManifest)

	useEffect(() => {
		loadFromManifest()
	}, [loadFromManifest])

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				height: "100vh",
				overflow: "hidden",
			}}
		>
			<header
				style={{
					padding: "12px 24px",
					background: "#ffffff",
					borderBottom: "1px solid #e0e0e0",
					flexShrink: 0,
				}}
			>
				<h1
					style={{
						fontSize: 18,
						fontWeight: 600,
						color: "#1a1a1a",
						letterSpacing: "-0.01em",
					}}
				>
					Robot Battle
				</h1>
			</header>
			<div
				style={{
					display: "flex",
					flex: 1,
					minHeight: 0,
					overflow: "hidden",
				}}
			>
				<div
					style={{
						width: "50%",
						minWidth: 320,
						borderRight: "1px solid #e0e0e0",
						overflow: "hidden",
						display: "flex",
						flexDirection: "column",
						background: "#ffffff",
					}}
				>
					<EditTab />
				</div>
				<div
					style={{
						width: "50%",
						overflow: "auto",
						background: "#f5f5f5",
					}}
				>
					<BattleTab />
				</div>
			</div>
		</div>
	)
}
