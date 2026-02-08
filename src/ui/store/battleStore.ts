import { create } from "zustand"
import type { GameState } from "../../../spec/simulation"

export type BattleStatus = "idle" | "running" | "finished"

export interface BattleState {
	status: BattleStatus
	speed: number
	currentTick: number
	totalTicks: number
	battleLog: string[]
	tickCount: number
	currentState: GameState | null
	startBattle: () => void
	stop: () => void
	setStatus: (status: BattleStatus) => void
	setSpeed: (speed: number) => void
	setCurrentTick: (tick: number) => void
	setTotalTicks: (total: number) => void
	setBattleLog: (log: string[]) => void
	setTickCount: (count: number) => void
	setCurrentState: (state: GameState | null) => void
}

export const useBattleStore = create<BattleState>((set) => ({
	status: "idle",
	speed: 1,
	currentTick: 0,
	totalTicks: 0,
	battleLog: [],
	tickCount: 2000,
	currentState: null,

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

	setCurrentState: (currentState: GameState | null) => {
		set({ currentState })
	},
}))
