import { useState } from "react"
import type { Tab } from "./TabBar"
import { TabBar } from "./TabBar"
import { BattleTab } from "./battle/BattleTab"
import { EditTab } from "./edit/EditTab"

export function App() {
	const [tab, setTab] = useState<Tab>("edit")

	return (
		<div style={{ fontFamily: "monospace", padding: 16, maxWidth: 900 }}>
			<h1>Robot Battle</h1>

			<TabBar activeTab={tab} onTabChange={setTab} />

			{tab === "edit" && <EditTab />}
			{tab === "battle" && <BattleTab />}
		</div>
	)
}
