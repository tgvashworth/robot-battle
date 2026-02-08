import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { FileListSidebar } from "../edit/FileListSidebar"
import { useRobotFileStore } from "../store/robotFileStore"

function resetStore() {
	useRobotFileStore.setState(useRobotFileStore.getInitialState())
}

afterEach(() => {
	cleanup()
	resetStore()
})

describe("FileListSidebar", () => {
	it("renders a list item for each file in the store", () => {
		render(<FileListSidebar />)
		const { files } = useRobotFileStore.getState()
		for (const file of files) {
			expect(screen.getByText(file.filename)).toBeDefined()
		}
	})

	it("renders multiple files", () => {
		useRobotFileStore.getState().createFile("Tracker.rbl")
		render(<FileListSidebar />)
		expect(screen.getByText("SpinBot.rbl")).toBeDefined()
		expect(screen.getByText("Tracker.rbl")).toBeDefined()
	})

	it("clicking a file name calls setActiveFile with that file's id", () => {
		useRobotFileStore.getState().createFile("Tracker.rbl")
		const { files } = useRobotFileStore.getState()
		const spinBotId = files.find((f) => f.filename === "SpinBot.rbl")!.id

		render(<FileListSidebar />)
		fireEvent.click(screen.getByText("SpinBot.rbl"))

		expect(useRobotFileStore.getState().activeFileId).toBe(spinBotId)
	})

	it("clicking '+ New Robot' creates a new file that appears in the list", () => {
		render(<FileListSidebar />)
		const filesBefore = useRobotFileStore.getState().files.length

		fireEvent.click(screen.getByText("+ New Robot"))

		const filesAfter = useRobotFileStore.getState().files
		expect(filesAfter.length).toBe(filesBefore + 1)

		// The new file should appear in the DOM
		const newFile = filesAfter[filesAfter.length - 1]!
		expect(screen.getByText(newFile.filename)).toBeDefined()
	})

	it("clicking delete button removes the file", () => {
		useRobotFileStore.getState().createFile("Tracker.rbl")
		render(<FileListSidebar />)

		const trackerDeleteBtn = screen.getByLabelText("Delete Tracker.rbl")
		fireEvent.click(trackerDeleteBtn)

		const { files } = useRobotFileStore.getState()
		expect(files.find((f) => f.filename === "Tracker.rbl")).toBeUndefined()
		expect(files).toHaveLength(1)
	})

	it("highlights the active file", () => {
		useRobotFileStore.getState().createFile("Tracker.rbl")
		const { files, activeFileId } = useRobotFileStore.getState()
		const activeFile = files.find((f) => f.id === activeFileId)!

		render(<FileListSidebar />)

		const activeSpan = screen.getByText(activeFile.filename)
		expect(activeSpan.style.fontWeight).toBe("bold")
	})
})
