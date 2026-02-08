import { afterEach, describe, expect, it } from "vitest"
import { useBattleStore } from "../store/battleStore"

function resetStore() {
	useBattleStore.setState(useBattleStore.getInitialState())
}

afterEach(resetStore)

describe("battleStore", () => {
	it("starts with idle status", () => {
		const { status } = useBattleStore.getState()
		expect(status).toBe("idle")
	})

	it("starts with empty battle log", () => {
		const { battleLog } = useBattleStore.getState()
		expect(battleLog).toEqual([])
	})

	it("starts with default speed of 1", () => {
		const { speed } = useBattleStore.getState()
		expect(speed).toBe(1)
	})

	it("starts with default tick count of 2000", () => {
		const { tickCount } = useBattleStore.getState()
		expect(tickCount).toBe(2000)
	})

	it("transitions to running on startBattle", () => {
		useBattleStore.getState().startBattle()
		const { status, currentTick, battleLog } = useBattleStore.getState()
		expect(status).toBe("running")
		expect(currentTick).toBe(0)
		expect(battleLog).toEqual([])
	})

	it("transitions to idle on stop", () => {
		useBattleStore.getState().startBattle()
		useBattleStore.getState().stop()
		expect(useBattleStore.getState().status).toBe("idle")
	})

	it("sets status directly", () => {
		useBattleStore.getState().setStatus("finished")
		expect(useBattleStore.getState().status).toBe("finished")
	})

	it("sets speed", () => {
		useBattleStore.getState().setSpeed(5)
		expect(useBattleStore.getState().speed).toBe(5)
	})

	it("sets battle log", () => {
		const log = ["Round 1 complete", "SpinBot wins"]
		useBattleStore.getState().setBattleLog(log)
		expect(useBattleStore.getState().battleLog).toEqual(log)
	})

	it("clears battle log on startBattle", () => {
		useBattleStore.getState().setBattleLog(["old log"])
		useBattleStore.getState().startBattle()
		expect(useBattleStore.getState().battleLog).toEqual([])
	})

	it("sets tick count", () => {
		useBattleStore.getState().setTickCount(5000)
		expect(useBattleStore.getState().tickCount).toBe(5000)
	})
})
