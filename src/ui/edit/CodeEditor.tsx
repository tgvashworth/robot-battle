import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands"
import {
	HighlightStyle,
	bracketMatching,
	foldGutter,
	indentOnInput,
	syntaxHighlighting,
} from "@codemirror/language"
import { type Diagnostic, lintGutter, setDiagnostics } from "@codemirror/lint"
import { EditorState } from "@codemirror/state"
import {
	EditorView,
	highlightActiveLine,
	highlightActiveLineGutter,
	keymap,
	lineNumbers,
} from "@codemirror/view"
import { tags } from "@lezer/highlight"
import { useCallback, useEffect, useRef } from "react"
import { rbl } from "./rbl-language"

const darkTheme = EditorView.theme(
	{
		"&": {
			backgroundColor: "#1e1e1e",
			color: "#d4d4d4",
			flex: "1",
			fontSize: "13px",
		},
		".cm-content": {
			caretColor: "#aeafad",
			fontFamily: "'SF Mono', 'Fira Code', Menlo, Consolas, monospace",
			lineHeight: "1.6",
		},
		".cm-cursor": {
			borderLeftColor: "#aeafad",
		},
		"&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
			backgroundColor: "#264f78",
		},
		".cm-gutters": {
			backgroundColor: "#1e1e1e",
			color: "#858585",
			border: "none",
			borderRight: "1px solid #333",
		},
		".cm-activeLineGutter": {
			backgroundColor: "#2a2a2a",
			color: "#c6c6c6",
		},
		".cm-activeLine": {
			backgroundColor: "#2a2d2e50",
		},
		".cm-matchingBracket": {
			backgroundColor: "#0064001a",
			outline: "1px solid #888",
		},
		".cm-foldGutter": {
			color: "#858585",
		},
	},
	{ dark: true },
)

const rblHighlightStyle = HighlightStyle.define([
	{ tag: tags.keyword, color: "#569cd6" },
	{ tag: tags.typeName, color: "#4ec9b0" },
	{ tag: tags.string, color: "#ce9178" },
	{ tag: tags.number, color: "#b5cea8" },
	{ tag: tags.bool, color: "#569cd6" },
	{ tag: tags.comment, color: "#6a9955", fontStyle: "italic" },
	{ tag: tags.operator, color: "#d4d4d4" },
	{ tag: tags.variableName, color: "#9cdcfe" },
	{ tag: tags.special(tags.variableName), color: "#dcdcaa" },
	{ tag: tags.labelName, color: "#c586c0" },
	{ tag: tags.bracket, color: "#d4d4d4" },
])

export type { Diagnostic }

interface CodeEditorProps {
	value: string
	onChange: (value: string) => void
	diagnostics?: Diagnostic[]
}

export function CodeEditor({ value, onChange, diagnostics }: CodeEditorProps) {
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
				syntaxHighlighting(rblHighlightStyle),
				rbl(),
				keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
				lintGutter(),
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

	useEffect(() => {
		const view = viewRef.current
		if (!view) return
		view.dispatch(setDiagnostics(view.state, diagnostics ?? []))
	}, [diagnostics])

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
