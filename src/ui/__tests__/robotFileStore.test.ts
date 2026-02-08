import { afterEach, describe, expect, it } from "vitest"
import { useRobotFileStore } from "../store/robotFileStore"

function resetStore() {
	useRobotFileStore.setState(useRobotFileStore.getInitialState())
}

afterEach(resetStore)

describe("robotFileStore", () => {
	it("seeds with a default SpinBot file", () => {
		const { files, activeFileId } = useRobotFileStore.getState()
		expect(files).toHaveLength(1)
		expect(files[0]!.filename).toBe("SpinBot.rbl")
		expect(files[0]!.source).toContain('robot "SpinBot"')
		expect(activeFileId).toBe(files[0]!.id)
	})

	it("creates a new file and sets it active", () => {
		useRobotFileStore.getState().createFile("Tracker.rbl")
		const { files, activeFileId } = useRobotFileStore.getState()
		expect(files).toHaveLength(2)
		const newFile = files.find((f) => f.filename === "Tracker.rbl")
		expect(newFile).toBeDefined()
		expect(newFile!.source).toBe("")
		expect(activeFileId).toBe(newFile!.id)
	})

	it("deletes a file", () => {
		const { files } = useRobotFileStore.getState()
		const id = files[0]!.id
		useRobotFileStore.getState().deleteFile(id)
		const state = useRobotFileStore.getState()
		expect(state.files).toHaveLength(0)
		expect(state.activeFileId).toBeNull()
	})

	it("deletes a file and falls back to first remaining file", () => {
		useRobotFileStore.getState().createFile("Tracker.rbl")
		const { files } = useRobotFileStore.getState()
		const trackerId = files.find((f) => f.filename === "Tracker.rbl")!.id
		const spinBotId = files.find((f) => f.filename === "SpinBot.rbl")!.id

		// Active is Tracker (set by createFile), delete it
		useRobotFileStore.getState().deleteFile(trackerId)
		const state = useRobotFileStore.getState()
		expect(state.files).toHaveLength(1)
		expect(state.activeFileId).toBe(spinBotId)
	})

	it("updates source of a file", () => {
		const { files } = useRobotFileStore.getState()
		const id = files[0]!.id
		useRobotFileStore.getState().updateSource(id, "new source code")
		const updated = useRobotFileStore.getState().files.find((f) => f.id === id)
		expect(updated!.source).toBe("new source code")
	})

	it("updates lastModified when source changes", () => {
		const { files } = useRobotFileStore.getState()
		const id = files[0]!.id
		const originalModified = files[0]!.lastModified
		useRobotFileStore.getState().updateSource(id, "changed")
		const updated = useRobotFileStore.getState().files.find((f) => f.id === id)
		expect(updated!.lastModified).toBeGreaterThanOrEqual(originalModified)
	})

	it("sets active file", () => {
		useRobotFileStore.getState().createFile("Other.rbl")
		const { files } = useRobotFileStore.getState()
		const spinBotId = files.find((f) => f.filename === "SpinBot.rbl")!.id
		useRobotFileStore.getState().setActiveFile(spinBotId)
		expect(useRobotFileStore.getState().activeFileId).toBe(spinBotId)
	})
})
