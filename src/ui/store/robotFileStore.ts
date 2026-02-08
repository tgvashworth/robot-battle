import { create } from "zustand"
import type { RobotFile } from "../../../spec/ui"

export const EXAMPLE_SOURCE = `robot "SpinBot"

var direction int = 1

func tick() {
	setSpeed(50)
	setTurnRate(5)
	fire(1)
}

on scan(distance float, bearing angle) {
	setGunHeading(bearing)
}
`

function createDefaultFile(): RobotFile {
	return {
		id: crypto.randomUUID(),
		filename: "SpinBot.rbl",
		source: EXAMPLE_SOURCE,
		lastModified: Date.now(),
	}
}

export interface RobotFileState {
	files: RobotFile[]
	activeFileId: string | null
	createFile: (filename: string) => void
	deleteFile: (id: string) => void
	updateSource: (id: string, source: string) => void
	setActiveFile: (id: string) => void
}

export const useRobotFileStore = create<RobotFileState>((set) => {
	const defaultFile = createDefaultFile()
	return {
		files: [defaultFile],
		activeFileId: defaultFile.id,

		createFile: (filename: string) => {
			const newFile: RobotFile = {
				id: crypto.randomUUID(),
				filename,
				source: "",
				lastModified: Date.now(),
			}
			set((state) => ({
				files: [...state.files, newFile],
				activeFileId: newFile.id,
			}))
		},

		deleteFile: (id: string) => {
			set((state) => {
				const files = state.files.filter((f) => f.id !== id)
				const activeFileId = state.activeFileId === id ? (files[0]?.id ?? null) : state.activeFileId
				return { files, activeFileId }
			})
		},

		updateSource: (id: string, source: string) => {
			set((state) => ({
				files: state.files.map((f) =>
					f.id === id ? { ...f, source, lastModified: Date.now() } : f,
				),
			}))
		},

		setActiveFile: (id: string) => {
			set({ activeFileId: id })
		},
	}
})
