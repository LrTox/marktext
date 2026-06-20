// 源码模式（CodeMirror）索引光标：`{ anchor, focus }`，坐标为 `{ line, ch }`。
// 用于文件夹搜索跳转及 source → WYSIWYG 切换。`line` 与 `ch` 均须为有效数字 ——
// 否则引擎会将缺失的 `ch` 钳制为 0，光标列位置错误。
interface IndexPosition {
  line: number
  ch: number
}

export interface IndexCursor {
  anchor: IndexPosition
  focus: IndexPosition
}

const isIndexPosition = (pos: unknown): pos is IndexPosition => {
  const p = pos as { line?: unknown; ch?: unknown } | null
  return !!p && typeof p.line === 'number' && typeof p.ch === 'number'
}

export const isIndexCursor = (cursor: unknown): cursor is IndexCursor => {
  const c = cursor as { anchor?: unknown; focus?: unknown } | null
  return !!c && isIndexPosition(c.anchor) && isIndexPosition(c.focus)
}

interface CursorEditor {
  setCursor: (cursor: unknown) => void
  setCursorByOffset: (cursor: IndexCursor) => boolean
}

// 将持久化光标恢复到 live 编辑器，按光标形态选择对应引擎 API。
// 索引光标（`{ line, ch }`）须走 `setCursorByOffset`，在 block 树上解析偏移；
// `setCursor` 仅理解 block-key 光标（`{ offset, anchorPath }`），对 `{ line, ch }` 会静默 no-op。
export const applyCursor = (editor: CursorEditor, cursor: unknown): void => {
  if (isIndexCursor(cursor)) {
    editor.setCursorByOffset(cursor)
  } else if (cursor) {
    editor.setCursor(cursor)
  }
}
