import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { EditTab } from "../edit/EditTab"
import { EXAMPLE_SOURCE, useRobotFileStore } from "../store/robotFileStore"

function resetStore() {
	useRobotFileStore.setState(useRobotFileStore.getInitialState())
}

afterEach(() => {
	cleanup()
	resetStore()
})

describe("EditTab", () => {
	it("textarea value matches the source of the active file", () => {
		render(<EditTab />)
		const textarea = screen.getByRole("textbox") as HTMLTextAreaElement
		expect(textarea.value).toBe(EXAMPLE_SOURCE)
	})

	it("typing in textarea calls updateSource on the store", () => {
		render(<EditTab />)
		const textarea = screen.getByRole("textbox") as HTMLTextAreaElement

		fireEvent.change(textarea, { target: { value: "new code here" } })

		const { files, activeFileId } = useRobotFileStore.getState()
		const activeFile = files.find((f) => f.id === activeFileId)
		expect(activeFile!.source).toBe("new code here")
	})

	it("switching active file updates textarea content", () => {
		// Create a second file and give it some source
		useRobotFileStore.getState().createFile("Tracker.rbl")
		const { files } = useRobotFileStore.getState()
		const tracker = files.find((f) => f.filename === "Tracker.rbl")!
		useRobotFileStore.getState().updateSource(tracker.id, "tracker source")

		render(<EditTab />)
		const textarea = screen.getByRole("textbox") as HTMLTextAreaElement

		// Active file is Tracker (set by createFile)
		expect(textarea.value).toBe("tracker source")

		// Switch to SpinBot by clicking in the sidebar
		fireEvent.click(screen.getByText("SpinBot.rbl"))

		expect(textarea.value).toBe(EXAMPLE_SOURCE)
	})

	it("renders the sidebar alongside the editor", () => {
		render(<EditTab />)
		// Sidebar shows the file list heading
		expect(screen.getByText("Files")).toBeDefined()
		// Editor heading
		expect(screen.getByText("Editor")).toBeDefined()
		// The default file is shown in sidebar
		expect(screen.getByText("SpinBot.rbl")).toBeDefined()
	})

	it("creating a new robot via sidebar switches the textarea to empty source", () => {
		render(<EditTab />)
		const textarea = screen.getByRole("textbox") as HTMLTextAreaElement

		// Initially has SpinBot source
		expect(textarea.value).toBe(EXAMPLE_SOURCE)

		// Create a new robot
		fireEvent.click(screen.getByText("+ New Robot"))

		// Textarea should now be empty (new file has empty source)
		expect(textarea.value).toBe("")
	})
})
