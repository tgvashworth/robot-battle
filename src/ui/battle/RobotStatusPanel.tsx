import { useMemo } from "react"
import { useBattleStore } from "../store/battleStore"

function colorToHex(color: number): string {
	return `#${color.toString(16).padStart(6, "0")}`
}

function formatDebugValue(type: "int" | "float" | "angle", value: number): string {
	if (type === "int") return String(value)
	if (type === "angle") return `${value.toFixed(1)}°`
	return value.toFixed(2)
}

export function RobotStatusPanel() {
	const currentState = useBattleStore((s) => s.currentState)
	const currentTick = useBattleStore((s) => s.currentTick)
	const robotDebugLogs = useBattleStore((s) => s.robotDebugLogs)

	// Build per-robot debug values for current tick
	const tickDebugValues = useMemo(() => {
		const result: Record<string, { type: "int" | "float" | "angle"; value: number }[]> = {}
		for (const [name, entries] of Object.entries(robotDebugLogs)) {
			const values = entries.filter((e) => e.tick === currentTick)
			if (values.length > 0) {
				result[name] = values
			}
		}
		return result
	}, [robotDebugLogs, currentTick])

	if (!currentState) return null

	return (
		<div
			style={{
				display: "flex",
				flexWrap: "wrap",
				gap: 8,
				padding: "8px 0",
			}}
		>
			{currentState.robots.map((robot) => {
				const debugValues = tickDebugValues[robot.name]
				return (
					<div
						key={robot.id}
						style={{
							display: "flex",
							alignItems: "center",
							gap: 8,
							padding: "6px 10px",
							background: "#ffffff",
							border: "1px solid #e0e0e0",
							borderRadius: 6,
							opacity: robot.alive ? 1 : 0.5,
							minWidth: 180,
						}}
					>
						<div
							style={{
								width: 8,
								height: 8,
								borderRadius: "50%",
								background: colorToHex(robot.color),
								flexShrink: 0,
							}}
						/>
						<div style={{ flex: 1, minWidth: 0 }}>
							<div
								style={{
									display: "flex",
									alignItems: "center",
									justifyContent: "space-between",
									gap: 6,
									marginBottom: 2,
								}}
							>
								<span
									style={{
										fontSize: 12,
										fontWeight: 600,
										color: "#1a1a1a",
										overflow: "hidden",
										textOverflow: "ellipsis",
										whiteSpace: "nowrap",
									}}
								>
									{robot.name}
								</span>
								{!robot.alive && (
									<span
										style={{
											fontSize: 10,
											color: "#dc2626",
											fontWeight: 600,
											flexShrink: 0,
										}}
									>
										DEAD
									</span>
								)}
							</div>
							<div
								style={{
									display: "flex",
									alignItems: "center",
									gap: 4,
								}}
							>
								<div
									style={{
										flex: 1,
										height: 4,
										background: "#e0e0e0",
										borderRadius: 2,
										overflow: "hidden",
									}}
								>
									<div
										style={{
											width: `${Math.max(0, robot.health)}%`,
											height: "100%",
											background:
												robot.health > 50 ? "#16a34a" : robot.health > 25 ? "#ca8a04" : "#dc2626",
											borderRadius: 2,
											transition: "width 0.1s ease",
										}}
									/>
								</div>
								<span
									style={{
										fontSize: 10,
										color: "#666",
										fontFamily: "'SF Mono', 'Fira Code', Menlo, Consolas, monospace",
										minWidth: 28,
										textAlign: "right",
									}}
								>
									{Math.round(robot.health)}
								</span>
							</div>
							<div
								style={{
									fontSize: 10,
									color: "#888",
									fontFamily: "'SF Mono', 'Fira Code', Menlo, Consolas, monospace",
									marginTop: 2,
									lineHeight: 1.4,
								}}
							>
								pos: ({robot.x.toFixed(0)}, {robot.y.toFixed(0)}) hdg: {robot.heading.toFixed(0)}°
								spd: {robot.speed.toFixed(1)}
								<br />
								gun: {robot.gunHeading.toFixed(0)}° radar: {robot.radarHeading.toFixed(0)}°
							</div>
							{debugValues && debugValues.length > 0 && (
								<div
									style={{
										fontSize: 10,
										color: "#b45309",
										fontFamily: "'SF Mono', 'Fira Code', Menlo, Consolas, monospace",
										marginTop: 2,
										lineHeight: 1.4,
										background: "#fffbeb",
										padding: "2px 4px",
										borderRadius: 3,
										border: "1px solid #fde68a",
									}}
								>
									{debugValues.map((d, i) => (
										<span key={`${d.type}-${i}`}>
											{i > 0 && " | "}
											{formatDebugValue(d.type, d.value)}
										</span>
									))}
								</div>
							)}
						</div>
					</div>
				)
			})}
		</div>
	)
}
