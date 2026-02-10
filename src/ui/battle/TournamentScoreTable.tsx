import { useTournamentStore } from "../store/tournamentStore"

const MONO_FONT = "'SF Mono', 'Fira Code', Menlo, Consolas, monospace"

export function TournamentScoreTable() {
	const standings = useTournamentStore((s) => s.standings)
	const currentGameIndex = useTournamentStore((s) => s.currentGameIndex)
	const gameCount = useTournamentStore((s) => s.gameCount)
	const status = useTournamentStore((s) => s.status)

	if (standings.length === 0) return null

	return (
		<div
			style={{
				padding: "8px 10px",
				background: "#ffffff",
				borderRadius: 6,
				border: "1px solid #e0e0e0",
			}}
		>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					marginBottom: 6,
				}}
			>
				<span style={{ fontSize: 12, fontWeight: 600, color: "#333" }}>Tournament Standings</span>
				<span
					style={{
						fontSize: 11,
						color: status === "running" ? "#2563eb" : "#666",
						fontFamily: MONO_FONT,
					}}
				>
					{status === "running"
						? `Game ${currentGameIndex}/${gameCount}`
						: `${gameCount} games completed`}
				</span>
			</div>
			<table
				style={{
					width: "100%",
					borderCollapse: "collapse",
					fontSize: 12,
				}}
			>
				<thead>
					<tr
						style={{
							borderBottom: "2px solid #e0e0e0",
							color: "#888",
							fontSize: 11,
						}}
					>
						<th style={{ textAlign: "left", padding: "3px 6px", fontWeight: 500 }}>#</th>
						<th style={{ textAlign: "left", padding: "3px 6px", fontWeight: 500 }}>Robot</th>
						<th
							style={{
								textAlign: "right",
								padding: "3px 6px",
								fontWeight: 500,
								fontFamily: MONO_FONT,
							}}
						>
							Points
						</th>
						<th
							style={{
								textAlign: "right",
								padding: "3px 6px",
								fontWeight: 500,
								fontFamily: MONO_FONT,
							}}
						>
							Wins
						</th>
						<th
							style={{
								textAlign: "right",
								padding: "3px 6px",
								fontWeight: 500,
								fontFamily: MONO_FONT,
							}}
						>
							Win%
						</th>
						<th
							style={{
								textAlign: "right",
								padding: "3px 6px",
								fontWeight: 500,
								fontFamily: MONO_FONT,
							}}
						>
							Games
						</th>
					</tr>
				</thead>
				<tbody>
					{standings.map((standing, index) => {
						const winPct =
							standing.gamesPlayed > 0
								? ((standing.wins / standing.gamesPlayed) * 100).toFixed(1)
								: "0.0"
						return (
							<tr
								key={standing.rosterId}
								style={{
									borderBottom: "1px solid #f0f0f0",
									background: index === 0 ? "#fefce8" : undefined,
								}}
							>
								<td
									style={{
										padding: "4px 6px",
										fontFamily: MONO_FONT,
										color: index === 0 ? "#854d0e" : "#666",
										fontWeight: index === 0 ? 600 : 400,
									}}
								>
									{index + 1}
								</td>
								<td
									style={{
										padding: "4px 6px",
										color: "#333",
										fontWeight: index === 0 ? 600 : 400,
									}}
								>
									{standing.name}
								</td>
								<td
									style={{
										padding: "4px 6px",
										textAlign: "right",
										fontFamily: MONO_FONT,
										color: "#333",
										fontWeight: 600,
									}}
								>
									{standing.points}
								</td>
								<td
									style={{
										padding: "4px 6px",
										textAlign: "right",
										fontFamily: MONO_FONT,
										color: "#666",
									}}
								>
									{standing.wins}
								</td>
								<td
									style={{
										padding: "4px 6px",
										textAlign: "right",
										fontFamily: MONO_FONT,
										color: "#666",
									}}
								>
									{winPct}%
								</td>
								<td
									style={{
										padding: "4px 6px",
										textAlign: "right",
										fontFamily: MONO_FONT,
										color: "#999",
									}}
								>
									{standing.gamesPlayed}
								</td>
							</tr>
						)
					})}
				</tbody>
			</table>
			{status === "running" && (
				<div
					style={{
						marginTop: 6,
						height: 3,
						background: "#e5e7eb",
						borderRadius: 2,
						overflow: "hidden",
					}}
				>
					<div
						style={{
							height: "100%",
							width: `${(currentGameIndex / gameCount) * 100}%`,
							background: "#2563eb",
							borderRadius: 2,
							transition: "width 0.15s ease",
						}}
					/>
				</div>
			)}
		</div>
	)
}
