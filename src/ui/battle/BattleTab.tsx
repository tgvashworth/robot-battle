import { useCallback, useEffect, useRef, useState } from "react"
import type { BattleRenderer, GameLoop, RenderOptions } from "../../../spec/renderer"
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

const DISPLAY_OPTIONS: { key: keyof RenderOptions; label: string }[] = [
	{ key: "showScanArcs", label: "Scan arcs" },
	{ key: "showHealthBars", label: "Health bars" },
	{ key: "showNames", label: "Names" },
	{ key: "showGrid", label: "Grid" },
]

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
	const [displayMenuOpen, setDisplayMenuOpen] = useState(false)
	const [displayOpts, setDisplayOpts] = useState<Partial<RenderOptions>>({
		showScanArcs: true,
		showHealthBars: true,
		showNames: true,
		showGrid: true,
	})
	const displayMenuRef = useRef<HTMLDivElement>(null)

	// Close display menu on outside click
	useEffect(() => {
		if (!displayMenuOpen) return
		function handleClick(e: MouseEvent) {
			if (displayMenuRef.current && !displayMenuRef.current.contains(e.target as Node)) {
				setDisplayMenuOpen(false)
			}
		}
		document.addEventListener("mousedown", handleClick)
		return () => document.removeEventListener("mousedown", handleClick)
	}, [displayMenuOpen])

	const toggleDisplayOpt = useCallback(
		(key: keyof RenderOptions) => {
			const next = { ...displayOpts, [key]: !displayOpts[key] }
			setDisplayOpts(next)
			rendererRef.current?.setOptions(next)
		},
		[displayOpts],
	)

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
		<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
			<div
				style={{
					padding: "6px 10px",
					background: "#ffffff",
					borderRadius: 6,
					border: "1px solid #e0e0e0",
					display: "flex",
					flexDirection: "column",
					gap: 6,
				}}
			>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 6,
						flexWrap: "wrap",
					}}
				>
					<select
						id="add-robot-select"
						style={{
							fontSize: 12,
							padding: "3px 6px",
							borderRadius: 4,
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
					{roster.map((entry) => {
						const file = files.find((f) => f.id === entry.fileId)
						if (!file) return null
						return (
							<div
								key={entry.id}
								style={{
									display: "inline-flex",
									alignItems: "center",
									gap: 3,
									padding: "1px 5px 1px 7px",
									borderRadius: 4,
									background: "#eef2ff",
									border: "1px solid #c7d2fe",
									fontSize: 11,
									lineHeight: 1.6,
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
										fontSize: 12,
										padding: "0 1px",
										lineHeight: 1,
									}}
									title="Remove"
								>
									x
								</button>
							</div>
						)
					})}
					{roster.length === 0 && (
						<span style={{ color: "#999", fontSize: 12 }}>No robots added.</span>
					)}
				</div>
				<div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
					<button
						type="button"
						onClick={handleBattle}
						style={{
							padding: "4px 12px",
							fontSize: 12,
							fontWeight: 600,
							background: "#2563eb",
							color: "#ffffff",
							border: "1px solid #1d4ed8",
							borderRadius: 4,
							cursor: "pointer",
						}}
					>
						Run Battle
					</button>
					<div ref={displayMenuRef} style={{ position: "relative" }}>
						<button
							type="button"
							onClick={() => setDisplayMenuOpen(!displayMenuOpen)}
							style={{
								padding: "4px 8px",
								fontSize: 12,
								borderRadius: 4,
								border: "1px solid #d0d0d0",
								background: displayMenuOpen ? "#f0f0f0" : "#fff",
								color: "#555",
								cursor: "pointer",
							}}
						>
							Display
						</button>
						{displayMenuOpen && (
							<div
								style={{
									position: "absolute",
									top: "100%",
									left: 0,
									marginTop: 2,
									background: "#fff",
									border: "1px solid #d0d0d0",
									borderRadius: 4,
									padding: "4px 0",
									zIndex: 10,
									boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
									minWidth: 140,
								}}
							>
								{DISPLAY_OPTIONS.map((opt) => (
									<label
										key={opt.key}
										style={{
											display: "flex",
											alignItems: "center",
											gap: 6,
											padding: "3px 10px",
											fontSize: 12,
											color: "#333",
											cursor: "pointer",
											whiteSpace: "nowrap",
										}}
									>
										<input
											type="checkbox"
											checked={displayOpts[opt.key] !== false}
											onChange={() => toggleDisplayOpt(opt.key)}
											style={{ margin: 0 }}
										/>
										{opt.label}
									</label>
								))}
							</div>
						)}
					</div>
					<label
						style={{
							display: "flex",
							alignItems: "center",
							gap: 4,
							color: "#666",
							fontSize: 12,
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
								width: 70,
								fontFamily: "'SF Mono', 'Fira Code', Menlo, Consolas, monospace",
								fontSize: 12,
								background: "#ffffff",
								color: "#1a1a1a",
								border: "1px solid #d0d0d0",
								borderRadius: 4,
								padding: "3px 6px",
							}}
						/>
					</label>
					<label
						style={{
							display: "flex",
							alignItems: "center",
							gap: 4,
							color: "#666",
							fontSize: 12,
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
								width: 70,
								fontFamily: "'SF Mono', 'Fira Code', Menlo, Consolas, monospace",
								fontSize: 12,
								background: "#ffffff",
								color: "#1a1a1a",
								border: "1px solid #d0d0d0",
								borderRadius: 4,
								padding: "3px 6px",
							}}
						/>
					</label>
				</div>
				{hasFrames && (
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: 6,
							flexWrap: "wrap",
							borderTop: "1px solid #f0f0f0",
							paddingTop: 6,
						}}
					>
						<button type="button" onClick={handlePlayPause} style={{ minWidth: 44, fontSize: 11 }}>
							{isPaused ? "Play" : "Pause"}
						</button>
						<button
							type="button"
							onClick={handleStep}
							style={{ minWidth: 36, fontSize: 11 }}
							title="Step one tick forward"
						>
							Step
						</button>
						<div style={{ display: "flex", alignItems: "center", gap: 3 }}>
							<span style={{ color: "#888", fontSize: 11 }}>Speed:</span>
							{SPEED_OPTIONS.map((s) => (
								<button
									key={s}
									type="button"
									onClick={() => handleSpeedChange(s)}
									style={{
										minWidth: 26,
										padding: "2px 4px",
										fontSize: 11,
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
								fontSize: 11,
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
							style={{ flexGrow: 1, minWidth: 80 }}
						/>
					</div>
				)}
			</div>

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
			{hasFrames && (
				<>
					<RobotStatusPanel />
					{battleLog.length > 0 && (
						<pre
							style={{
								padding: 8,
								background: "#f8f8f8",
								border: "1px solid #e0e0e0",
								borderRadius: 4,
								color: "#444",
								fontSize: 11,
								lineHeight: 1.5,
								maxHeight: 120,
								overflowY: "auto",
								whiteSpace: "pre-wrap",
								margin: 0,
							}}
						>
							{battleLog.join("\n")}
						</pre>
					)}
				</>
			)}
		</div>
	)
}
