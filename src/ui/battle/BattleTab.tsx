import { useCallback, useEffect, useRef } from "react"
import type { BattleRenderer } from "../../../spec/renderer"
import type { GameState } from "../../../spec/simulation"
import { createRenderer } from "../../renderer"
import { createBattle, createDefaultConfig, createSpinBot } from "../../simulation"
import { useBattleStore } from "../store/battleStore"

export function BattleTab() {
	const battleLog = useBattleStore((s) => s.battleLog)
	const setBattleLog = useBattleStore((s) => s.setBattleLog)
	const canvasRef = useRef<HTMLCanvasElement>(null)
	const rendererRef = useRef<BattleRenderer | null>(null)

	// Cleanup renderer on unmount
	useEffect(() => {
		return () => {
			rendererRef.current?.destroy()
			rendererRef.current = null
		}
	}, [])

	const handleBattle = useCallback(async () => {
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
			// Destroy previous renderer if one exists
			if (rendererRef.current) {
				rendererRef.current.destroy()
			}
			const renderer = createRenderer()
			rendererRef.current = renderer
			renderer.init(canvasRef.current, config.arena)
			await renderer.ready
			renderer.resize(config.arena.width, config.arena.height)
			renderer.pushFrame(lastState)
			renderer.render(1)
		}

		battle.destroy()
	}, [setBattleLog])

	return (
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
	)
}
