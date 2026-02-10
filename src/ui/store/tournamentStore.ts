import { create } from "zustand"
import type { GameResult, TournamentStanding } from "../../simulation/tournament"

export type TournamentStatus = "idle" | "running" | "finished"

export interface TournamentState {
	status: TournamentStatus
	gameCount: number
	currentGameIndex: number
	standings: TournamentStanding[]
	gameResults: GameResult[]
	abortRequested: boolean

	setGameCount: (count: number) => void
	setStatus: (status: TournamentStatus) => void
	setCurrentGameIndex: (index: number) => void
	updateResults: (standings: TournamentStanding[], result: GameResult) => void
	requestAbort: () => void
	reset: () => void
}

export const useTournamentStore = create<TournamentState>((set) => ({
	status: "idle",
	gameCount: 10,
	currentGameIndex: 0,
	standings: [],
	gameResults: [],
	abortRequested: false,

	setGameCount: (gameCount: number) => {
		set({ gameCount })
	},

	setStatus: (status: TournamentStatus) => {
		set({ status })
	},

	setCurrentGameIndex: (currentGameIndex: number) => {
		set({ currentGameIndex })
	},

	updateResults: (standings: TournamentStanding[], result: GameResult) => {
		set((state) => ({
			standings,
			gameResults: [...state.gameResults, result],
			currentGameIndex: result.gameIndex + 1,
		}))
	},

	requestAbort: () => {
		set({ abortRequested: true })
	},

	reset: () => {
		set({
			status: "idle",
			currentGameIndex: 0,
			standings: [],
			gameResults: [],
			abortRequested: false,
		})
	},
}))
