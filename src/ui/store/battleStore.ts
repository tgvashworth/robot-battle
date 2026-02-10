import { create } from "zustand"
import type { GameState } from "../../../spec/simulation"
import { loadPersistedUI, savePersistedUI } from "./persistence"
import { useRobotFileStore } from "./robotFileStore"

export type BattleStatus = "idle" | "running" | "finished"

export interface RosterEntry {
	readonly id: string
	readonly fileId: string
}

export interface DebugEntry {
	readonly tick: number
	readonly type: "int" | "float" | "angle"
	readonly value: number
}

function saveRosterFilenames(roster: RosterEntry[]) {
	const files = useRobotFileStore.getState().files
	const filenames = roster
		.map((r) => files.find((f) => f.id === r.fileId)?.filename)
		.filter((n): n is string => n != null)
	savePersistedUI({ rosterFilenames: filenames })
}

export interface BattleState {
	status: BattleStatus
	speed: number
	currentTick: number
	totalTicks: number
	battleLog: string[]
	tickCount: number
	seed: number
	currentState: GameState | null
	roster: RosterEntry[]
	robotDebugLogs: Record<string, DebugEntry[]>
	addToRoster: (fileId: string) => void
	removeFromRoster: (id: string) => void
	restoreRoster: () => void
	startBattle: () => void
	stop: () => void
	setStatus: (status: BattleStatus) => void
	setSpeed: (speed: number) => void
	setCurrentTick: (tick: number) => void
	setTotalTicks: (total: number) => void
	setBattleLog: (log: string[]) => void
	setTickCount: (count: number) => void
	setSeed: (seed: number) => void
	setCurrentState: (state: GameState | null) => void
	setRobotDebugLogs: (logs: Record<string, DebugEntry[]>) => void
}

export const useBattleStore = create<BattleState>((set) => ({
	status: "idle",
	speed: 1,
	currentTick: 0,
	totalTicks: 0,
	battleLog: [],
	tickCount: 2000,
	seed: 12345,
	currentState: null,
	roster: [],
	robotDebugLogs: {},

	addToRoster: (fileId: string) => {
		set((state) => {
			const roster = [...state.roster, { id: crypto.randomUUID(), fileId }]
			saveRosterFilenames(roster)
			return { roster }
		})
	},

	removeFromRoster: (id: string) => {
		set((state) => {
			const roster = state.roster.filter((r) => r.id !== id)
			saveRosterFilenames(roster)
			return { roster }
		})
	},

	restoreRoster: () => {
		const persisted = loadPersistedUI()
		if (!persisted.rosterFilenames?.length) return
		const files = useRobotFileStore.getState().files
		const entries: RosterEntry[] = []
		for (const filename of persisted.rosterFilenames) {
			const file = files.find((f) => f.filename === filename)
			if (file) {
				entries.push({ id: crypto.randomUUID(), fileId: file.id })
			}
		}
		if (entries.length > 0) {
			set({ roster: entries })
		}
	},

	startBattle: () => {
		set({ status: "running", currentTick: 0, battleLog: [], currentState: null })
	},

	stop: () => {
		set({ status: "idle" })
	},

	setStatus: (status: BattleStatus) => {
		set({ status })
	},

	setSpeed: (speed: number) => {
		set({ speed })
	},

	setCurrentTick: (tick: number) => {
		set({ currentTick: tick })
	},

	setTotalTicks: (total: number) => {
		set({ totalTicks: total })
	},

	setBattleLog: (log: string[]) => {
		set({ battleLog: log })
	},

	setTickCount: (count: number) => {
		set({ tickCount: count })
	},

	setSeed: (seed: number) => {
		set({ seed })
	},

	setCurrentState: (currentState: GameState | null) => {
		set({ currentState })
	},

	setRobotDebugLogs: (robotDebugLogs: Record<string, DebugEntry[]>) => {
		set({ robotDebugLogs })
	},
}))
