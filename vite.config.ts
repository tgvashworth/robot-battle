import { resolve } from "node:path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
	base: "/robot-battle/",
	plugins: [react()],
	resolve: {
		alias: {
			"@/compiler": resolve(__dirname, "src/compiler"),
			"@/simulation": resolve(__dirname, "src/simulation"),
			"@/renderer": resolve(__dirname, "src/renderer"),
			"@/ui": resolve(__dirname, "src/ui"),
			"@/spec": resolve(__dirname, "spec"),
		},
	},
	test: {
		globals: false,
		environment: "jsdom",
		include: ["src/**/*.test.{ts,tsx}"],
	},
})
