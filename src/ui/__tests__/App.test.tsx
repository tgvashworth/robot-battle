import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { App } from "../App"

afterEach(cleanup)

describe("App", () => {
	it("renders the title", () => {
		render(<App />)
		expect(screen.getByText("Robot Battle")).toBeDefined()
	})

	it("renders tab navigation", () => {
		render(<App />)
		expect(screen.getByText("Battle")).toBeDefined()
	})

	it("starts on the edit tab with editor heading", () => {
		render(<App />)
		expect(screen.getByText("Editor")).toBeDefined()
	})
})
