import { create } from "zustand"
import type { RobotFile } from "../../../spec/ui"
import { loadPersistedUI, savePersistedUI } from "./persistence"

export interface RobotFileState {
	files: RobotFile[]
	activeFileId: string | null
	diskSources: Record<string, string>
	createFile: (filename: string) => void
	deleteFile: (id: string) => void
	updateSource: (id: string, source: string) => void
	setActiveFile: (id: string) => void
	toggleSelected: (id: string) => void
	loadFromManifest: () => Promise<void>
	isDirty: (id: string) => boolean
	reloadFromDisk: (id: string) => Promise<void>
	reloadAllFromDisk: () => Promise<void>
}

export const useRobotFileStore = create<RobotFileState>((set, get) => ({
	files: [],
	activeFileId: null,
	diskSources: {},

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
		const file = get().files.find((f) => f.id === id)
		if (file) {
			const persisted = loadPersistedUI()
			const fileSources = { ...persisted.fileSources, [file.filename]: source }
			savePersistedUI({ fileSources })
		}
		set((state) => ({
			files: state.files.map((f) => (f.id === id ? { ...f, source, lastModified: Date.now() } : f)),
		}))
	},

	setActiveFile: (id: string) => {
		const file = get().files.find((f) => f.id === id)
		if (file) savePersistedUI({ activeFilename: file.filename })
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

			const persisted = loadPersistedUI()
			const savedSources = persisted.fileSources ?? {}
			const loadedFiles: RobotFile[] = []
			const diskSources: Record<string, string> = {}

			for (const filename of manifest) {
				if (typeof filename !== "string") continue
				try {
					const sourceResponse = await fetch(`/robots/${filename}`)
					const diskSource = await sourceResponse.text()
					const id = crypto.randomUUID()
					diskSources[id] = diskSource
					loadedFiles.push({
						id,
						filename,
						source: savedSources[filename] ?? diskSource,
						lastModified: Date.now(),
						selected: true,
					})
				} catch {
					// Skip files that fail to load
				}
			}

			if (loadedFiles.length > 0) {
				const restoredFile = persisted.activeFilename
					? loadedFiles.find((f) => f.filename === persisted.activeFilename)
					: undefined
				set({
					files: loadedFiles,
					diskSources,
					activeFileId: restoredFile?.id ?? loadedFiles[0]!.id,
				})
			}
		} catch {
			// If manifest fetch fails, leave store empty
		}
	},

	isDirty: (id: string) => {
		const file = get().files.find((f) => f.id === id)
		const diskSource = get().diskSources[id]
		if (!file || diskSource === undefined) return false
		return file.source !== diskSource
	},

	reloadFromDisk: async (id: string) => {
		const file = get().files.find((f) => f.id === id)
		if (!file) return
		try {
			const resp = await fetch(`/robots/${file.filename}`)
			const diskSource = await resp.text()
			const persisted = loadPersistedUI()
			const fileSources = { ...persisted.fileSources }
			delete fileSources[file.filename]
			savePersistedUI({ fileSources })
			set((state) => ({
				files: state.files.map((f) =>
					f.id === id ? { ...f, source: diskSource, lastModified: Date.now() } : f,
				),
				diskSources: { ...state.diskSources, [id]: diskSource },
			}))
		} catch {
			// Ignore fetch errors
		}
	},

	reloadAllFromDisk: async () => {
		const { files } = get()
		const newFiles = [...files]
		const newDiskSources = { ...get().diskSources }
		const persisted = loadPersistedUI()
		const fileSources = { ...persisted.fileSources }

		for (let i = 0; i < newFiles.length; i++) {
			const file = newFiles[i]!
			try {
				const resp = await fetch(`/robots/${file.filename}`)
				const diskSource = await resp.text()
				newFiles[i] = { ...file, source: diskSource, lastModified: Date.now() }
				newDiskSources[file.id] = diskSource
				delete fileSources[file.filename]
			} catch {
				// Skip files that fail
			}
		}

		savePersistedUI({ fileSources })
		set({ files: newFiles, diskSources: newDiskSources })
	},
}))
