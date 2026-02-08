import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { App } from "../App"
import { useRobotFileStore } from "../store/robotFileStore"

function resetStore() {
	useRobotFileStore.setState(useRobotFileStore.getInitialState())
}

afterEach(() => {
	cleanup()
	resetStore()
})

describe("App", () => {
	it("renders the title", () => {
		render(<App />)
		expect(screen.getByText("Robot Battle")).toBeDefined()
	})

	it("renders both editor and battle panels side by side", () => {
		render(<App />)
		// Editor panel shows file list
		expect(screen.getByText("Files")).toBeDefined()
		// Battle panel shows run button
		expect(screen.getByRole("button", { name: /Run Battle/ })).toBeDefined()
	})

	it("shows robot files when loaded into the store", () => {
		const id = crypto.randomUUID()
		useRobotFileStore.setState({
			files: [
				{
					id,
					filename: "SpinBot.rbl",
					source: 'robot "SpinBot"\n',
					lastModified: Date.now(),
					selected: true,
				},
			],
			activeFileId: id,
		})
		render(<App />)
		expect(screen.getAllByText("SpinBot.rbl").length).toBeGreaterThan(0)
	})
})
