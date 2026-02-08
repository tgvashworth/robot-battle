export type Tab = "edit" | "battle"

interface TabBarProps {
	activeTab: Tab
	onTabChange: (tab: Tab) => void
}

const TABS: readonly Tab[] = ["edit", "battle"]

export function TabBar({ activeTab, onTabChange }: TabBarProps) {
	return (
		<nav style={{ display: "flex", gap: 8, marginBottom: 16 }}>
			{TABS.map((t) => (
				<button
					key={t}
					type="button"
					onClick={() => onTabChange(t)}
					style={{
						padding: "6px 16px",
						fontWeight: activeTab === t ? "bold" : "normal",
						background: activeTab === t ? "#333" : "#111",
						color: "#fff",
						border: "1px solid #444",
						cursor: "pointer",
					}}
				>
					{t.charAt(0).toUpperCase() + t.slice(1)}
				</button>
			))}
		</nav>
	)
}
