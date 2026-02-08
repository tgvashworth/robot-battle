import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands"
import { go } from "@codemirror/lang-go"
import {
	bracketMatching,
	defaultHighlightStyle,
	foldGutter,
	indentOnInput,
	syntaxHighlighting,
} from "@codemirror/language"
import { EditorState } from "@codemirror/state"
import {
	EditorView,
	highlightActiveLine,
	highlightActiveLineGutter,
	keymap,
	lineNumbers,
} from "@codemirror/view"
import { useCallback, useEffect, useRef } from "react"

const darkTheme = EditorView.theme(
	{
		"&": {
			backgroundColor: "#1e1e2e",
			color: "#cdd6f4",
			flex: "1",
			fontSize: "13px",
		},
		".cm-content": {
			caretColor: "#f5e0dc",
			fontFamily: "monospace",
			lineHeight: "1.6",
		},
		".cm-cursor": {
			borderLeftColor: "#f5e0dc",
		},
		"&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
			backgroundColor: "#45475a",
		},
		".cm-gutters": {
			backgroundColor: "#181825",
			color: "#6c7086",
			border: "none",
			borderRight: "1px solid #313244",
		},
		".cm-activeLineGutter": {
			backgroundColor: "#1e1e2e",
			color: "#a6adc8",
		},
		".cm-activeLine": {
			backgroundColor: "#21213580",
		},
		".cm-matchingBracket": {
			backgroundColor: "#45475a",
			color: "#f5e0dc",
		},
		".cm-foldGutter": {
			color: "#6c7086",
		},
	},
	{ dark: true },
)

interface CodeEditorProps {
	value: string
	onChange: (value: string) => void
}

export function CodeEditor({ value, onChange }: CodeEditorProps) {
	const containerRef = useRef<HTMLDivElement>(null)
	const viewRef = useRef<EditorView | null>(null)
	const onChangeRef = useRef(onChange)
	onChangeRef.current = onChange

	const valueRef = useRef(value)
	valueRef.current = value

	const createView = useCallback(() => {
		const container = containerRef.current
		if (!container) return

		if (viewRef.current) {
			viewRef.current.destroy()
		}

		const state = EditorState.create({
			doc: valueRef.current,
			extensions: [
				lineNumbers(),
				highlightActiveLine(),
				highlightActiveLineGutter(),
				history(),
				foldGutter(),
				indentOnInput(),
				bracketMatching(),
				syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
				go(),
				keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
				darkTheme,
				EditorView.updateListener.of((update) => {
					if (update.docChanged) {
						onChangeRef.current(update.state.doc.toString())
					}
				}),
			],
		})

		viewRef.current = new EditorView({ state, parent: container })
	}, [])

	useEffect(() => {
		createView()
		return () => {
			viewRef.current?.destroy()
			viewRef.current = null
		}
	}, [createView])

	useEffect(() => {
		const view = viewRef.current
		if (!view) return
		const current = view.state.doc.toString()
		if (current !== value) {
			view.dispatch({
				changes: { from: 0, to: current.length, insert: value },
			})
		}
	}, [value])

	return (
		<div
			ref={containerRef}
			style={{
				flex: 1,
				display: "flex",
				flexDirection: "column",
				overflow: "hidden",
				borderLeft: "1px solid #e0e0e0",
			}}
		/>
	)
}
