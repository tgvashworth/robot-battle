const STORAGE_KEY = "robot-battle-ui"

export interface PersistedUI {
	activeFilename?: string | null
	rosterFilenames?: string[]
	activeTab?: "edit" | "battle"
	fileSources?: Record<string, string>
}

export function loadPersistedUI(): PersistedUI {
	try {
		const raw = localStorage.getItem(STORAGE_KEY)
		if (!raw) return {}
		return JSON.parse(raw) as PersistedUI
	} catch {
		return {}
	}
}

export function savePersistedUI(patch: Partial<PersistedUI>) {
	try {
		const current = loadPersistedUI()
		localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...patch }))
	} catch {
		// localStorage unavailable
	}
}
