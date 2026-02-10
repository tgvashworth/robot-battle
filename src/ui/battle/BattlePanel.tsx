import { useState } from "react"
import { BattleTab } from "./BattleTab"
import { TournamentTab } from "./TournamentTab"

type PanelMode = "battle" | "tournament"

export function BattlePanel() {
	const [mode, setMode] = useState<PanelMode>("battle")

	return (
		<div style={{ padding: "6px 8px", display: "flex", flexDirection: "column", gap: 6 }}>
			<div
				style={{
					display: "flex",
					gap: 0,
					borderRadius: 6,
					overflow: "hidden",
					border: "1px solid #d0d0d0",
					alignSelf: "flex-start",
				}}
			>
				<button
					type="button"
					onClick={() => setMode("battle")}
					style={{
						padding: "4px 14px",
						fontSize: 12,
						fontWeight: 600,
						border: "none",
						cursor: "pointer",
						background: mode === "battle" ? "#2563eb" : "#f5f5f5",
						color: mode === "battle" ? "#ffffff" : "#666",
						borderRight: "1px solid #d0d0d0",
					}}
				>
					Battle
				</button>
				<button
					type="button"
					onClick={() => setMode("tournament")}
					style={{
						padding: "4px 14px",
						fontSize: 12,
						fontWeight: 600,
						border: "none",
						cursor: "pointer",
						background: mode === "tournament" ? "#059669" : "#f5f5f5",
						color: mode === "tournament" ? "#ffffff" : "#666",
					}}
				>
					Tournament
				</button>
			</div>
			{mode === "battle" ? <BattleTab /> : <TournamentTab />}
		</div>
	)
}
