import { useCallback, useEffect, useRef, useState } from "react"
import type { BattleRenderer, GameLoop } from "../../../spec/renderer"
import type { GameState, RobotModule } from "../../../spec/simulation"
import { compile, createDebugLog, instantiate } from "../../compiler"
import type { RobotDebugLog } from "../../compiler"
import { createGameLoop, createRenderer, createReplaySource } from "../../renderer"
import type { ReplayTickSource } from "../../renderer/replay-source"
import { createBattle, createDefaultConfig } from "../../simulation"
import { useBattleStore } from "../store/battleStore"
import { useRobotFileStore } from "../store/robotFileStore"
import { RobotStatusPanel } from "./RobotStatusPanel"

const SPEED_OPTIONS = [0.5, 1, 2, 4] as const

export function BattleTab() {
	const battleLog = useBattleStore((s) => s.battleLog)
	const setBattleLog = useBattleStore((s) => s.setBattleLog)
	const speed = useBattleStore((s) => s.speed)
	const setSpeed = useBattleStore((s) => s.setSpeed)
	const currentTick = useBattleStore((s) => s.currentTick)
	const setCurrentTick = useBattleStore((s) => s.setCurrentTick)
	const totalTicks = useBattleStore((s) => s.totalTicks)
	const setTotalTicks = useBattleStore((s) => s.setTotalTicks)
	const status = useBattleStore((s) => s.status)
	const setStatus = useBattleStore((s) => s.setStatus)
	const tickCount = useBattleStore((s) => s.tickCount)
	const setTickCount = useBattleStore((s) => s.setTickCount)
	const seed = useBattleStore((s) => s.seed)
	const setSeed = useBattleStore((s) => s.setSeed)
	const setCurrentState = useBattleStore((s) => s.setCurrentState)
	const setRobotDebugLogs = useBattleStore((s) => s.setRobotDebugLogs)

	const canvasRef = useRef<HTMLCanvasElement>(null)
	const rendererRef = useRef<BattleRenderer | null>(null)
	const gameLoopRef = useRef<GameLoop | null>(null)
	const replaySourceRef = useRef<ReplayTickSource | null>(null)
	const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

	const [isPaused, setIsPaused] = useState(true)

	// Poll the replay source for currentTick updates during playback
	useEffect(() => {
		if (status !== "running" || isPaused) {
			if (tickIntervalRef.current) {
				clearInterval(tickIntervalRef.current)
				tickIntervalRef.current = null
			}
			return
		}

		tickIntervalRef.current = setInterval(() => {
			const source = replaySourceRef.current
			if (source) {
				const tick = source.currentTick()
				setCurrentTick(tick)
				const frame = source.frameAt(tick > 0 ? tick - 1 : 0)
				if (frame) {
					setCurrentState(frame)
				}
				if (!source.hasNext()) {
					setIsPaused(true)
					setStatus("finished")
					gameLoopRef.current?.pause()
				}
			}
		}, 50)

		return () => {
			if (tickIntervalRef.current) {
				clearInterval(tickIntervalRef.current)
				tickIntervalRef.current = null
			}
		}
	}, [status, isPaused, setCurrentTick, setStatus, setCurrentState])

	// Cleanup renderer and game loop on unmount
	useEffect(() => {
		return () => {
			gameLoopRef.current?.destroy()
			gameLoopRef.current = null
			rendererRef.current?.destroy()
			rendererRef.current = null
			replaySourceRef.current = null
		}
	}, [])

	const destroyGameLoop = useCallback(() => {
		gameLoopRef.current?.destroy()
		gameLoopRef.current = null
		replaySourceRef.current = null
	}, [])

	const files = useRobotFileStore((s) => s.files)
	const roster = useBattleStore((s) => s.roster)
	const addToRoster = useBattleStore((s) => s.addToRoster)
	const removeFromRoster = useBattleStore((s) => s.removeFromRoster)

	const handleBattle = useCallback(async () => {
		// Clean up previous game loop
		destroyGameLoop()

		// Resolve roster entries to files (same file can appear multiple times)
		const selectedFiles = roster
			.map((entry) => files.find((f) => f.id === entry.fileId))
			.filter((f): f is (typeof files)[number] => f != null)

		// Compile all robot files to WASM modules
		const compiledRobots: {
			name: string
			color: number
			module: RobotModule
			debugLog: RobotDebugLog
		}[] = []
		const compileLog: string[] = []
		const COLORS = [0xff4444, 0x4444ff, 0x44ff44, 0xffff44, 0xff44ff, 0x44ffff]

		// Shared tick counter that the simulation will advance
		let currentSimTick = 0
		const getSimTick = () => currentSimTick

		for (let i = 0; i < selectedFiles.length; i++) {
			const file = selectedFiles[i]!
			const result = compile(file.source)
			if (!result.success || !result.wasm) {
				compileLog.push(`[${file.filename}] Compile errors:`)
				for (const e of result.errors.errors) {
					compileLog.push(`  Line ${e.line}:${e.column}: ${e.message}`)
				}
				continue
			}
			try {
				const debugLog = createDebugLog(getSimTick)
				const module = await instantiate(result.wasm, debugLog)
				// Extract robot name from the source (first string after "robot")
				const nameMatch = file.source.match(/robot\s+"([^"]+)"/)
				const name = nameMatch?.[1] ?? file.filename.replace(".rbl", "")
				compiledRobots.push({ name, color: COLORS[i % COLORS.length]!, module, debugLog })
				compileLog.push(`[${file.filename}] Compiled OK → "${name}"`)
			} catch (e) {
				compileLog.push(`[${file.filename}] WASM instantiation failed: ${e}`)
			}
		}

		if (compiledRobots.length === 0) {
			setBattleLog([...compileLog, "", "No robots compiled successfully."])
			return
		}

		const config = createDefaultConfig(
			compiledRobots.map((r) => ({ name: r.name, color: r.color })),
			{ ticksPerRound: tickCount, masterSeed: seed },
		)
		const battle = createBattle(
			config,
			compiledRobots.map((r) => r.module),
		)

		// Collect all frames by ticking through the battle
		const frames: GameState[] = []
		// Capture the initial state before any ticks
		frames.push(battle.getState())

		while (!battle.isRoundOver()) {
			currentSimTick = battle.getTick() + 1
			const result = battle.tick()
			frames.push(result.state)
		}

		// Build the battle log from the final state
		const lastState = frames[frames.length - 1]!
		const log: string[] = [...compileLog, ""]
		log.push(`Round complete: ${frames.length - 1} ticks`)
		const sortedRobots = [...lastState.robots].sort((a, b) => {
			if (a.alive !== b.alive) return a.alive ? -1 : 1
			return b.health - a.health
		})
		for (let i = 0; i < sortedRobots.length; i++) {
			const robot = sortedRobots[i]!
			log.push(`  #${i + 1} ${robot.name} — health: ${robot.health.toFixed(0)}`)
		}

		// Append debug/trap messages from each robot and build per-tick debug logs
		const debugLines: string[] = []
		const perRobotDebugLogs: Record<
			string,
			{ tick: number; type: "int" | "float" | "angle"; value: number }[]
		> = {}
		for (const robot of compiledRobots) {
			const entries: { tick: number; type: "int" | "float" | "angle"; value: number }[] = []
			const messages = robot.debugLog.getMessages()
			for (const msg of messages) {
				if (msg.type === "trap") {
					debugLines.push(
						`[${robot.name}] TRAP in ${msg.functionName}: ${msg.error} (tick ${msg.tick})`,
					)
				} else if (msg.type === "debug_int") {
					debugLines.push(`[${robot.name}] debug: ${msg.value} (tick ${msg.tick})`)
					entries.push({ tick: msg.tick, type: "int", value: msg.value })
				} else if (msg.type === "debug_float") {
					debugLines.push(`[${robot.name}] debug: ${msg.value} (tick ${msg.tick})`)
					entries.push({ tick: msg.tick, type: "float", value: msg.value })
				} else if (msg.type === "debug_angle") {
					debugLines.push(`[${robot.name}] debug: ${msg.value}° (tick ${msg.tick})`)
					entries.push({ tick: msg.tick, type: "angle", value: msg.value })
				}
			}
			perRobotDebugLogs[robot.name] = entries
		}
		if (debugLines.length > 0) {
			log.push("")
			log.push(...debugLines)
		}

		setBattleLog(log)
		setRobotDebugLogs(perRobotDebugLogs)

		battle.destroy()

		// Set up the renderer if canvas is available
		if (!canvasRef.current) return

		// Reuse existing renderer if possible, otherwise create a new one
		let renderer = rendererRef.current
		if (renderer) {
			renderer.reset()
		} else {
			renderer = createRenderer()
			rendererRef.current = renderer
			renderer.init(canvasRef.current, config.arena)
			await renderer.ready
		}
		renderer.resize(config.arena.width, config.arena.height)

		// Create replay source and game loop
		const replaySource = createReplaySource(frames)
		replaySourceRef.current = replaySource

		const gameLoop = createGameLoop(replaySource, renderer)
		gameLoopRef.current = gameLoop

		// Update store with totals
		setTotalTicks(frames.length)
		setCurrentTick(0)
		setCurrentState(frames[0] ?? null)
		setStatus("running")

		// Start playback
		gameLoop.setSpeed(speed)
		gameLoop.start()
		setIsPaused(false)
	}, [
		destroyGameLoop,
		setBattleLog,
		setTotalTicks,
		setCurrentTick,
		setCurrentState,
		setStatus,
		speed,
		files,
		roster,
		tickCount,
		seed,
		setRobotDebugLogs,
	])

	const handlePlayPause = useCallback(() => {
		const loop = gameLoopRef.current
		if (!loop) return

		if (isPaused) {
			// If we're at the end, seek back to start
			const source = replaySourceRef.current
			if (source && !source.hasNext()) {
				source.seekTo(0)
				setCurrentTick(0)
				setStatus("running")
			}
			loop.resume()
			setIsPaused(false)
		} else {
			loop.pause()
			setIsPaused(true)
		}
	}, [isPaused, setCurrentTick, setStatus])

	const handleSpeedChange = useCallback(
		(newSpeed: number) => {
			setSpeed(newSpeed)
			gameLoopRef.current?.setSpeed(newSpeed)
		},
		[setSpeed],
	)

	const handleSeek = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const tick = Number(e.target.value)
			const source = replaySourceRef.current
			const renderer = rendererRef.current
			const loop = gameLoopRef.current
			if (!source || !renderer || !loop) return

			// Pause during seek
			const wasPaused = isPaused
			if (!wasPaused) {
				loop.pause()
			}

			// Seek the source
			source.seekTo(tick)
			setCurrentTick(tick)

			// Update robot status panel
			const stateFrame = source.frameAt(tick > 0 ? tick - 1 : 0)
			if (stateFrame) {
				setCurrentState(stateFrame)
			}

			// Push the frame at this position to the renderer so it displays
			const frame = source.frameAt(tick)
			const prevFrame = tick > 0 ? source.frameAt(tick - 1) : undefined
			if (prevFrame) {
				renderer.pushFrame(prevFrame)
			}
			if (frame) {
				renderer.pushFrame(frame)
				renderer.render(1)
			}

			if (!wasPaused) {
				loop.resume()
			} else {
				setIsPaused(true)
			}

			// Update status if seeking back from finished
			if (source.hasNext()) {
				setStatus("running")
			}
		},
		[isPaused, setCurrentTick, setCurrentState, setStatus],
	)

	const handleStep = useCallback(() => {
		const loop = gameLoopRef.current
		const source = replaySourceRef.current
		if (!loop || !source) return

		if (!isPaused) {
			loop.pause()
			setIsPaused(true)
		}

		loop.step()
		const tick = source.currentTick()
		setCurrentTick(tick)
		const frame = source.frameAt(tick > 0 ? tick - 1 : 0)
		if (frame) {
			setCurrentState(frame)
		}

		if (!source.hasNext()) {
			setStatus("finished")
		}
	}, [isPaused, setCurrentTick, setCurrentState, setStatus])

	const hasFrames = totalTicks > 0

	return (
		<div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
			<div
				style={{
					padding: 12,
					background: "#ffffff",
					borderRadius: 8,
					border: "1px solid #e0e0e0",
				}}
			>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						marginBottom: roster.length > 0 ? 8 : 0,
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
						Battle Roster
					</strong>
					<div style={{ display: "flex", alignItems: "center", gap: 6 }}>
						<select
							id="add-robot-select"
							style={{
								fontSize: 13,
								padding: "4px 8px",
								borderRadius: 6,
								border: "1px solid #d0d0d0",
								background: "#fff",
								color: "#333",
							}}
							defaultValue=""
							onChange={(e) => {
								if (e.target.value) {
									addToRoster(e.target.value)
									e.target.value = ""
								}
							}}
						>
							<option value="" disabled>
								Add robot...
							</option>
							{files.map((file) => (
								<option key={file.id} value={file.id}>
									{file.filename}
								</option>
							))}
						</select>
					</div>
				</div>
				{roster.length > 0 && (
					<div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
						{roster.map((entry) => {
							const file = files.find((f) => f.id === entry.fileId)
							if (!file) return null
							return (
								<div
									key={entry.id}
									style={{
										display: "flex",
										alignItems: "center",
										gap: 6,
										padding: "4px 8px 4px 10px",
										borderRadius: 6,
										background: "#eef2ff",
										border: "1px solid #c7d2fe",
										fontSize: 13,
									}}
								>
									{file.filename}
									<button
										type="button"
										onClick={() => removeFromRoster(entry.id)}
										style={{
											background: "none",
											border: "none",
											cursor: "pointer",
											color: "#999",
											fontSize: 14,
											padding: "0 2px",
											lineHeight: 1,
										}}
										title="Remove"
									>
										x
									</button>
								</div>
							)
						})}
					</div>
				)}
				{roster.length === 0 && (
					<div style={{ color: "#999", fontSize: 13 }}>
						No robots added. Use the dropdown above to add robots to the battle.
					</div>
				)}
			</div>

			<div style={{ display: "flex", alignItems: "center", gap: 12 }}>
				<button
					type="button"
					onClick={handleBattle}
					style={{
						padding: "8px 20px",
						fontSize: 14,
						fontWeight: 600,
						background: "#2563eb",
						color: "#ffffff",
						border: "1px solid #1d4ed8",
						borderRadius: 6,
					}}
				>
					Run Battle ({tickCount} ticks)
				</button>
				<label
					style={{
						display: "flex",
						alignItems: "center",
						gap: 6,
						color: "#666",
						fontSize: 13,
					}}
				>
					Ticks:
					<input
						type="number"
						min={1}
						max={100000}
						value={tickCount}
						onChange={(e) => {
							const val = Number(e.target.value)
							if (val > 0) {
								setTickCount(val)
							}
						}}
						style={{
							width: 80,
							fontFamily: "'SF Mono', 'Fira Code', Menlo, Consolas, monospace",
							fontSize: 13,
							background: "#ffffff",
							color: "#1a1a1a",
							border: "1px solid #d0d0d0",
							borderRadius: 6,
							padding: "4px 8px",
						}}
					/>
				</label>
				<label
					style={{
						display: "flex",
						alignItems: "center",
						gap: 6,
						color: "#666",
						fontSize: 13,
					}}
				>
					Seed:
					<input
						type="number"
						value={seed}
						onChange={(e) => {
							const val = Number(e.target.value)
							if (!Number.isNaN(val)) {
								setSeed(val)
							}
						}}
						style={{
							width: 80,
							fontFamily: "'SF Mono', 'Fira Code', Menlo, Consolas, monospace",
							fontSize: 13,
							background: "#ffffff",
							color: "#1a1a1a",
							border: "1px solid #d0d0d0",
							borderRadius: 6,
							padding: "4px 8px",
						}}
					/>
				</label>
			</div>

			<div>
				<canvas
					ref={canvasRef}
					style={{
						border: "1px solid #e0e0e0",
						borderRadius: 8,
						background: "#111118",
						display: "block",
						maxWidth: "100%",
					}}
				/>
				<RobotStatusPanel />
			</div>
			{hasFrames && (
				<div
					style={{
						padding: "8px 12px",
						display: "flex",
						alignItems: "center",
						gap: 8,
						flexWrap: "wrap",
						background: "#ffffff",
						borderRadius: 8,
						border: "1px solid #e0e0e0",
					}}
				>
					<button type="button" onClick={handlePlayPause} style={{ minWidth: 60 }}>
						{isPaused ? "Play" : "Pause"}
					</button>
					<button
						type="button"
						onClick={handleStep}
						style={{ minWidth: 50 }}
						title="Step one tick forward"
					>
						Step
					</button>
					<div style={{ display: "flex", alignItems: "center", gap: 4 }}>
						<span style={{ color: "#888", fontSize: 12 }}>Speed:</span>
						{SPEED_OPTIONS.map((s) => (
							<button
								key={s}
								type="button"
								onClick={() => handleSpeedChange(s)}
								style={{
									minWidth: 32,
									padding: "4px 8px",
									fontSize: 12,
									fontWeight: speed === s ? "bold" : "normal",
									background: speed === s ? "#e0e0e0" : undefined,
									borderColor: speed === s ? "#b0b0b0" : undefined,
								}}
							>
								{s}x
							</button>
						))}
					</div>
					<span
						style={{
							color: "#666",
							fontSize: 12,
							fontFamily: "'SF Mono', 'Fira Code', Menlo, Consolas, monospace",
						}}
					>
						{currentTick} / {totalTicks}
					</span>
					<input
						type="range"
						min={0}
						max={totalTicks}
						value={currentTick}
						onChange={handleSeek}
						style={{ flexGrow: 1, minWidth: 120 }}
					/>
				</div>
			)}
			{battleLog.length > 0 && (
				<pre
					style={{
						padding: 12,
						background: "#ffffff",
						border: "1px solid #e0e0e0",
						borderRadius: 8,
						color: "#444",
						fontSize: 12,
						lineHeight: 1.6,
						maxHeight: 200,
						overflowY: "auto",
						whiteSpace: "pre-wrap",
					}}
				>
					{battleLog.join("\n")}
				</pre>
			)}
		</div>
	)
}
