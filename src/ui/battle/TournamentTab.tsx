import { useCallback } from "react"
import type { RobotModule } from "../../../spec/simulation"
import { compile, instantiate } from "../../compiler"
import { DEFAULT_SCORING } from "../../simulation/defaults"
import type { TournamentRobotEntry } from "../../simulation/tournament"
import { calculateStandings, runTournamentAsync } from "../../simulation/tournament"
import { useBattleStore } from "../store/battleStore"
import { useRobotFileStore } from "../store/robotFileStore"
import { useTournamentStore } from "../store/tournamentStore"
import { TournamentScoreTable } from "./TournamentScoreTable"

const COLORS = [0xff4444, 0x4444ff, 0x44ff44, 0xffff44, 0xff44ff, 0x44ffff]

export function TournamentTab() {
	const files = useRobotFileStore((s) => s.files)
	const roster = useBattleStore((s) => s.roster)
	const addToRoster = useBattleStore((s) => s.addToRoster)
	const removeFromRoster = useBattleStore((s) => s.removeFromRoster)
	const setBattleLog = useBattleStore((s) => s.setBattleLog)
	const tickCount = useBattleStore((s) => s.tickCount)
	const setTickCount = useBattleStore((s) => s.setTickCount)
	const seed = useBattleStore((s) => s.seed)
	const setSeed = useBattleStore((s) => s.setSeed)

	const tournamentStatus = useTournamentStore((s) => s.status)
	const tournamentGameCount = useTournamentStore((s) => s.gameCount)
	const setTournamentGameCount = useTournamentStore((s) => s.setGameCount)
	const setTournamentStatus = useTournamentStore((s) => s.setStatus)
	const tournamentUpdateResults = useTournamentStore((s) => s.updateResults)
	const tournamentReset = useTournamentStore((s) => s.reset)
	const tournamentRequestAbort = useTournamentStore((s) => s.requestAbort)

	const handleTournament = useCallback(async () => {
		tournamentReset()

		const rosterWithFiles = roster
			.map((entry) => {
				const file = files.find((f) => f.id === entry.fileId)
				return file ? { entry, file } : null
			})
			.filter((x): x is NonNullable<typeof x> => x != null)

		const compiledEntries: {
			rosterId: string
			name: string
			color: number
			wasmBytes: Uint8Array
		}[] = []
		const compileLog: string[] = []

		for (let i = 0; i < rosterWithFiles.length; i++) {
			const { entry, file } = rosterWithFiles[i]!
			const result = compile(file.source)
			if (!result.success || !result.wasm) {
				compileLog.push(`[${file.filename}] Compile errors:`)
				for (const e of result.errors.errors) {
					compileLog.push(`  Line ${e.line}:${e.column}: ${e.message}`)
				}
				continue
			}
			const nameMatch = file.source.match(/robot\s+"([^"]+)"/)
			const baseName = nameMatch?.[1] ?? file.filename.replace(".rbl", "")
			compiledEntries.push({
				rosterId: entry.id,
				name: baseName,
				color: COLORS[i % COLORS.length]!,
				wasmBytes: result.wasm,
			})
			compileLog.push(`[${file.filename}] Compiled OK`)
		}

		if (compiledEntries.length === 0) {
			setBattleLog([...compileLog, "", "No robots compiled successfully."])
			return
		}

		const nameCount = new Map<string, number>()
		for (const e of compiledEntries) {
			nameCount.set(e.name, (nameCount.get(e.name) ?? 0) + 1)
		}
		const nameIndex = new Map<string, number>()
		const entries: TournamentRobotEntry[] = compiledEntries.map((e) => {
			const count = nameCount.get(e.name) ?? 1
			if (count > 1) {
				const idx = (nameIndex.get(e.name) ?? 0) + 1
				nameIndex.set(e.name, idx)
				return { rosterId: e.rosterId, name: `${e.name} #${idx}`, color: e.color }
			}
			return { rosterId: e.rosterId, name: e.name, color: e.color }
		})

		setBattleLog(compileLog)
		setTournamentStatus("running")

		const scoring = DEFAULT_SCORING

		try {
			await runTournamentAsync(
				{
					entries,
					gameCount: tournamentGameCount,
					baseSeed: seed,
					ticksPerRound: tickCount,
					scoring,
				},
				async () => {
					const modules: RobotModule[] = []
					for (const compiled of compiledEntries) {
						const module = await instantiate(compiled.wasmBytes)
						modules.push(module)
					}
					return modules
				},
				{
					onGameComplete: (_gameIndex, result) => {
						const allResults = [...useTournamentStore.getState().gameResults, result]
						const standings = calculateStandings(entries, allResults, scoring)
						tournamentUpdateResults(standings, result)
					},
					shouldAbort: () => useTournamentStore.getState().abortRequested,
				},
			)
		} catch (e) {
			const currentLog = useBattleStore.getState().battleLog
			setBattleLog([...currentLog, "", `Tournament error: ${e}`])
		}

		setTournamentStatus("finished")
	}, [
		tournamentReset,
		roster,
		files,
		setBattleLog,
		setTournamentStatus,
		tournamentGameCount,
		seed,
		tickCount,
		tournamentUpdateResults,
	])

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
					{tournamentStatus === "running" ? (
						<button
							type="button"
							onClick={tournamentRequestAbort}
							style={{
								padding: "4px 12px",
								fontSize: 12,
								fontWeight: 600,
								background: "#dc2626",
								color: "#ffffff",
								border: "1px solid #b91c1c",
								borderRadius: 4,
								cursor: "pointer",
							}}
						>
							Stop Tournament
						</button>
					) : (
						<button
							type="button"
							onClick={handleTournament}
							style={{
								padding: "4px 12px",
								fontSize: 12,
								fontWeight: 600,
								background: "#059669",
								color: "#ffffff",
								border: "1px solid #047857",
								borderRadius: 4,
								cursor: "pointer",
							}}
						>
							Run Tournament
						</button>
					)}
					<label
						style={{
							display: "flex",
							alignItems: "center",
							gap: 4,
							color: "#666",
							fontSize: 12,
						}}
					>
						Games:
						<input
							type="number"
							min={1}
							max={10000}
							value={tournamentGameCount}
							onChange={(e) => {
								const val = Number(e.target.value)
								if (val > 0) {
									setTournamentGameCount(val)
								}
							}}
							style={{
								width: 60,
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
			</div>

			<TournamentScoreTable />
		</div>
	)
}
