import { afterEach, describe, expect, it } from "vitest"
import { useRobotFileStore } from "../store/robotFileStore"

function resetStore() {
	useRobotFileStore.setState(useRobotFileStore.getInitialState())
}

afterEach(resetStore)

describe("robotFileStore", () => {
	it("starts with an empty files array", () => {
		const { files, activeFileId } = useRobotFileStore.getState()
		expect(files).toHaveLength(0)
		expect(activeFileId).toBeNull()
	})

	it("creates a new file and sets it active", () => {
		useRobotFileStore.getState().createFile("Tracker.rbl")
		const { files, activeFileId } = useRobotFileStore.getState()
		expect(files).toHaveLength(1)
		const newFile = files.find((f) => f.filename === "Tracker.rbl")
		expect(newFile).toBeDefined()
		expect(newFile!.source).toBe("")
		expect(newFile!.selected).toBe(true)
		expect(activeFileId).toBe(newFile!.id)
	})

	it("deletes a file", () => {
		useRobotFileStore.getState().createFile("SpinBot.rbl")
		const { files } = useRobotFileStore.getState()
		const id = files[0]!.id
		useRobotFileStore.getState().deleteFile(id)
		const state = useRobotFileStore.getState()
		expect(state.files).toHaveLength(0)
		expect(state.activeFileId).toBeNull()
	})

	it("deletes a file and falls back to first remaining file", () => {
		useRobotFileStore.getState().createFile("SpinBot.rbl")
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
		useRobotFileStore.getState().createFile("SpinBot.rbl")
		const { files } = useRobotFileStore.getState()
		const id = files[0]!.id
		useRobotFileStore.getState().updateSource(id, "new source code")
		const updated = useRobotFileStore.getState().files.find((f) => f.id === id)
		expect(updated!.source).toBe("new source code")
	})

	it("updates lastModified when source changes", () => {
		useRobotFileStore.getState().createFile("SpinBot.rbl")
		const { files } = useRobotFileStore.getState()
		const id = files[0]!.id
		const originalModified = files[0]!.lastModified
		useRobotFileStore.getState().updateSource(id, "changed")
		const updated = useRobotFileStore.getState().files.find((f) => f.id === id)
		expect(updated!.lastModified).toBeGreaterThanOrEqual(originalModified)
	})

	it("sets active file", () => {
		useRobotFileStore.getState().createFile("SpinBot.rbl")
		useRobotFileStore.getState().createFile("Other.rbl")
		const { files } = useRobotFileStore.getState()
		const spinBotId = files.find((f) => f.filename === "SpinBot.rbl")!.id
		useRobotFileStore.getState().setActiveFile(spinBotId)
		expect(useRobotFileStore.getState().activeFileId).toBe(spinBotId)
	})

	it("toggles selected state of a file", () => {
		useRobotFileStore.getState().createFile("SpinBot.rbl")
		const { files } = useRobotFileStore.getState()
		const id = files[0]!.id
		expect(files[0]!.selected).toBe(true)

		useRobotFileStore.getState().toggleSelected(id)
		const toggled = useRobotFileStore.getState().files.find((f) => f.id === id)
		expect(toggled!.selected).toBe(false)

		useRobotFileStore.getState().toggleSelected(id)
		const toggledBack = useRobotFileStore.getState().files.find((f) => f.id === id)
		expect(toggledBack!.selected).toBe(true)
	})

	it("creates files with selected defaulting to true", () => {
		useRobotFileStore.getState().createFile("Bot1.rbl")
		useRobotFileStore.getState().createFile("Bot2.rbl")
		const { files } = useRobotFileStore.getState()
		for (const file of files) {
			expect(file.selected).toBe(true)
		}
	})
})
