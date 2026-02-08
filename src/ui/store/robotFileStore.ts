import { create } from "zustand"
import type { RobotFile } from "../../../spec/ui"

export interface RobotFileState {
	files: RobotFile[]
	activeFileId: string | null
	createFile: (filename: string) => void
	deleteFile: (id: string) => void
	updateSource: (id: string, source: string) => void
	setActiveFile: (id: string) => void
	toggleSelected: (id: string) => void
	loadFromManifest: () => Promise<void>
}

export const useRobotFileStore = create<RobotFileState>((set, get) => ({
	files: [],
	activeFileId: null,

	createFile: (filename: string) => {
		const newFile: RobotFile = {
			id: crypto.randomUUID(),
			filename,
			source: "",
			lastModified: Date.now(),
			selected: true,
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
			files: state.files.map((f) => (f.id === id ? { ...f, source, lastModified: Date.now() } : f)),
		}))
	},

	setActiveFile: (id: string) => {
		set({ activeFileId: id })
	},

	toggleSelected: (id: string) => {
		set((state) => ({
			files: state.files.map((f) => (f.id === id ? { ...f, selected: !f.selected } : f)),
		}))
	},

	loadFromManifest: async () => {
		// Don't reload if files are already loaded
		if (get().files.length > 0) return

		try {
			const manifestResponse = await fetch("/robots/manifest.json")
			const manifest: unknown = await manifestResponse.json()
			if (!Array.isArray(manifest)) return

			const loadedFiles: RobotFile[] = []
			for (const filename of manifest) {
				if (typeof filename !== "string") continue
				try {
					const sourceResponse = await fetch(`/robots/${filename}`)
					const source = await sourceResponse.text()
					loadedFiles.push({
						id: crypto.randomUUID(),
						filename,
						source,
						lastModified: Date.now(),
						selected: true,
					})
				} catch {
					// Skip files that fail to load
				}
			}

			if (loadedFiles.length > 0) {
				set({
					files: loadedFiles,
					activeFileId: loadedFiles[0]!.id,
				})
			}
		} catch {
			// If manifest fetch fails, leave store empty
		}
	},
}))
