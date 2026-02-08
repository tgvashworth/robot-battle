import { create } from "zustand"

export type BattleStatus = "idle" | "running" | "finished"

export interface BattleState {
	status: BattleStatus
	speed: number
	currentTick: number
	totalTicks: number
	battleLog: string[]
	startBattle: () => void
	stop: () => void
	setStatus: (status: BattleStatus) => void
	setSpeed: (speed: number) => void
	setBattleLog: (log: string[]) => void
}

export const useBattleStore = create<BattleState>((set) => ({
	status: "idle",
	speed: 1,
	currentTick: 0,
	totalTicks: 0,
	battleLog: [],

	startBattle: () => {
		set({ status: "running", currentTick: 0, battleLog: [] })
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

	setBattleLog: (log: string[]) => {
		set({ battleLog: log })
	},
}))
