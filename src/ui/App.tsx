import { useCallback, useRef, useState } from "react"
import type { GameState } from "../../spec/simulation"
import { Lexer } from "../compiler"
import { createRenderer } from "../renderer"
import { createBattle, createDefaultConfig, createSpinBot } from "../simulation"

type Tab = "edit" | "battle"

const EXAMPLE_SOURCE = `robot "SpinBot"

var direction int = 1

func tick() {
	setSpeed(50)
	setTurnRate(5)
	fire(1)
}

on scan(distance float, bearing angle) {
	setGunHeading(bearing)
}
`

export function App() {
	const [tab, setTab] = useState<Tab>("edit")
	const [source, setSource] = useState(EXAMPLE_SOURCE)
	const [tokenCount, setTokenCount] = useState<number | null>(null)
	const [battleLog, setBattleLog] = useState<string[]>([])
	const canvasRef = useRef<HTMLCanvasElement>(null)

	const handleTokenize = useCallback(() => {
		const tokens = new Lexer(source).tokenize()
		setTokenCount(tokens.length)
	}, [source])

	const handleBattle = useCallback(() => {
		const config = createDefaultConfig(
			[
				{ name: "SpinBot", color: 0xff4444 },
				{ name: "SpinBot2", color: 0x4444ff },
			],
			{ ticksPerRound: 100 },
		)
		const battle = createBattle(config, [createSpinBot(), createSpinBot()])

		const log: string[] = []
		let lastState: GameState | null = null

		const result = battle.runRound()
		lastState = battle.getState()
		log.push(`Round complete: ${result.totalTicks} ticks, reason: ${result.reason}`)
		for (const p of result.placements) {
			const robot = lastState.robots.find((r) => r.id === p.robotId)
			log.push(`  #${p.place} ${robot?.name ?? "?"} — health: ${p.healthRemaining.toFixed(0)}`)
		}

		setBattleLog(log)

		// If canvas is available, render the final state
		if (canvasRef.current && lastState) {
			const renderer = createRenderer()
			renderer.init(canvasRef.current, config.arena)
			renderer.resize(config.arena.width, config.arena.height)
			renderer.pushFrame(lastState)
			renderer.render(1)
			renderer.destroy()
		}

		battle.destroy()
	}, [])

	return (
		<div style={{ fontFamily: "monospace", padding: 16, maxWidth: 900 }}>
			<h1>Robot Battle</h1>

			<nav style={{ display: "flex", gap: 8, marginBottom: 16 }}>
				{(["edit", "battle"] as const).map((t) => (
					<button
						key={t}
						type="button"
						onClick={() => setTab(t)}
						style={{
							padding: "6px 16px",
							fontWeight: tab === t ? "bold" : "normal",
							background: tab === t ? "#333" : "#111",
							color: "#fff",
							border: "1px solid #444",
							cursor: "pointer",
						}}
					>
						{t.charAt(0).toUpperCase() + t.slice(1)}
					</button>
				))}
			</nav>

			{tab === "edit" && (
				<div>
					<h2>Editor</h2>
					<textarea
						value={source}
						onChange={(e) => setSource(e.target.value)}
						style={{
							width: "100%",
							height: 300,
							fontFamily: "monospace",
							fontSize: 13,
							background: "#1a1a2e",
							color: "#e0e0e0",
							border: "1px solid #444",
							padding: 8,
						}}
					/>
					<div style={{ marginTop: 8 }}>
						<button type="button" onClick={handleTokenize}>
							Tokenize
						</button>
						{tokenCount !== null && <span style={{ marginLeft: 12 }}>{tokenCount} tokens</span>}
					</div>
				</div>
			)}

			{tab === "battle" && (
				<div>
					<h2>Battle</h2>
					<button type="button" onClick={handleBattle}>
						Run Quick Battle (100 ticks)
					</button>
					<div style={{ marginTop: 12 }}>
						<canvas
							ref={canvasRef}
							style={{
								border: "1px solid #444",
								background: "#111118",
								display: "block",
							}}
						/>
					</div>
					{battleLog.length > 0 && (
						<pre style={{ marginTop: 12, color: "#aaa" }}>{battleLog.join("\n")}</pre>
					)}
				</div>
			)}
		</div>
	)
}
