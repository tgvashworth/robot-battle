import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { EditTab } from "../edit/EditTab"
import { useRobotFileStore } from "../store/robotFileStore"

const TEST_SOURCE = 'robot "SpinBot"\nfunc tick() {}\n'

function resetStore() {
	useRobotFileStore.setState(useRobotFileStore.getInitialState())
}

function seedSpinBot() {
	const id = crypto.randomUUID()
	useRobotFileStore.setState({
		files: [
			{
				id,
				filename: "SpinBot.rbl",
				source: TEST_SOURCE,
				lastModified: Date.now(),
				selected: true,
			},
		],
		activeFileId: id,
	})
}

afterEach(() => {
	cleanup()
	resetStore()
})

beforeEach(() => {
	seedSpinBot()
})

describe("EditTab", () => {
	it("renders the sidebar alongside the editor", () => {
		render(<EditTab />)
		expect(screen.getByText("Files")).toBeDefined()
		expect(screen.getByText("SpinBot.rbl")).toBeDefined()
	})

	it("store updateSource updates the active file", () => {
		const { activeFileId } = useRobotFileStore.getState()
		useRobotFileStore.getState().updateSource(activeFileId!, "new code here")

		const { files } = useRobotFileStore.getState()
		const activeFile = files.find((f) => f.id === activeFileId)
		expect(activeFile!.source).toBe("new code here")
	})

	it("creating a new robot via sidebar switches active file", () => {
		render(<EditTab />)

		fireEvent.click(screen.getByText("+ New Robot"))

		const { files, activeFileId } = useRobotFileStore.getState()
		const activeFile = files.find((f) => f.id === activeFileId)
		expect(activeFile!.source).toBe("")
	})

	it("clicking a file in sidebar switches active file", () => {
		useRobotFileStore.getState().createFile("Tracker.rbl")
		const { files } = useRobotFileStore.getState()
		const tracker = files.find((f) => f.filename === "Tracker.rbl")!
		useRobotFileStore.getState().updateSource(tracker.id, "tracker source")

		render(<EditTab />)

		fireEvent.click(screen.getByText("SpinBot.rbl"))

		const state = useRobotFileStore.getState()
		const activeFile = state.files.find((f) => f.id === state.activeFileId)
		expect(activeFile!.source).toBe(TEST_SOURCE)
	})
})
