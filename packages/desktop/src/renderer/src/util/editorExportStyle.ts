import { DEFAULT_CODE_FONT_FAMILY, DEFAULT_EDITOR_FONT_FAMILY } from '../config'
import { getThemeStylesheet } from './getThemeStylesheet'

export interface EditorExportAppearance {
  editorTheme: string
  editorFontFamily: string
  fontSize: number
  lineHeight: number | string
  editorLineWidth: string
  codeFontFamily: string
  codeFontSize: number
  customCss?: string
  wrapCodeBlocks?: boolean
  /** Cap `.markdown-body` width for PDF/print (printable page width in px). */
  maxContentWidthPx?: number
}

const MARKDOWN_BODY_THEME_MAP = `
body {
  background: var(--editorBgColor);
  color: var(--editorColor);
}
.export-editor-document {
  background: var(--editorBgColor);
  color: var(--editorColor);
}
.markdown-body {
  background: var(--editorBgColor);
  color: var(--editorColor);
}
.markdown-body h1,
.markdown-body h2,
.markdown-body h3,
.markdown-body h4,
.markdown-body h5,
.markdown-body h6 {
  color: var(--headingColor, var(--editorColor80));
  border-bottom-color: var(--editorColor10);
}
.markdown-body a {
  color: var(--linkColor);
}
.markdown-body strong {
  color: var(--strongColor, var(--editorColor80));
}
.markdown-body em {
  color: var(--emColor, var(--editorColor));
}
.markdown-body blockquote {
  color: var(--blockquoteTextColor);
  border-left-color: var(--blockquoteBorderColor);
}
.markdown-body hr {
  background-color: var(--hrColor);
  border-color: var(--hrColor);
}
.markdown-body table th,
.markdown-body table td {
  border: 1px solid var(--tableBorderColor);
  border-color: var(--tableBorderColor);
  padding: 6px 13px;
  word-break: normal;
  overflow-wrap: break-word;
  white-space: normal;
  vertical-align: top;
}
.markdown-body table thead tr {
  background-color: var(--editorColor04, rgba(0, 0, 0, 0.03));
}
.markdown-body table tbody tr {
  background-color: var(--editorBgColor) !important;
}
.markdown-body table tr:nth-child(2n) {
  background-color: var(--editorBgColor) !important;
}
.markdown-body table th {
  font-weight: 600;
}
.markdown-body table td code,
.markdown-body table th code {
  background: var(--codeBgColor);
  padding: 0.2em 0.35em;
  border-radius: 3px;
  font-size: 0.92em;
}
.markdown-body table tr {
  border-top: none;
}
/* Editor parity: measure natural table width, then zoom-scale when needed. */
.markdown-body table {
  display: table;
  width: max-content;
  max-width: 100%;
  table-layout: auto;
  overflow: visible;
  border-collapse: collapse;
}
.markdown-body table.export-table-fit {
  zoom: var(--export-table-scale, 1);
  transform-origin: top left;
}
.markdown-body pre,
.markdown-body .highlight pre {
  background: var(--codeBlockBgColor);
}
.markdown-body :not(pre) > code {
  background: var(--codeBgColor);
}
.markdown-body .footnotes {
  background: var(--footnoteBgColor);
}
.hf-container {
  color: var(--editorColor80);
}
@media print {
  html,
  body {
    background: var(--editorBgColor) !important;
  }
  .markdown-body table.export-table-fit {
    zoom: var(--export-table-scale, 1) !important;
    transform-origin: top left !important;
  }
  .markdown-body table.export-table-fit th,
  .markdown-body table.export-table-fit td {
    word-break: normal !important;
    overflow-wrap: break-word !important;
    white-space: normal !important;
  }
}
`

const getLineWidthCss = (editorLineWidth: string, maxContentWidthPx?: number): string => {
  if (maxContentWidthPx && maxContentWidthPx > 0) {
    return `.export-editor-document .mu-container,.markdown-body{max-width:${maxContentWidthPx}px;width:100%;}`
  }
  let maxWidth = 'var(--editorAreaWidth, 750px)'
  if (editorLineWidth && /^[0-9]+(?:ch|px|%)$/.test(editorLineWidth)) {
    maxWidth = `min(100%, calc(100px + ${editorLineWidth}))`
  }
  return `.export-editor-document .mu-container,.markdown-body{max-width:${maxWidth};}`
}

const getFontCss = (appearance: EditorExportAppearance): string => {
  const { editorFontFamily, fontSize, lineHeight, codeFontFamily, codeFontSize } = appearance
  return `.hf-container,.export-editor-document .mu-container,.markdown-body{
font-family:"${editorFontFamily}",${DEFAULT_EDITOR_FONT_FAMILY};
font-size:${fontSize}px;
line-height:${lineHeight};
}
.export-editor-document .mu-container code,
.export-editor-document .mu-container pre,
.export-editor-document .mu-container pre code,
.markdown-body code,
.markdown-body pre,
.markdown-body pre code {
font-family:${codeFontFamily},${DEFAULT_CODE_FONT_FAMILY};
font-size:${codeFontSize}px;
}`
}

const getCodeWrapCss = (wrapCodeBlocks: boolean): string => {
  if (wrapCodeBlocks) {
    return '.markdown-body pre code{white-space:pre-wrap;word-break:break-word;}'
  }
  return ''
}

/** Build CSS that maps the active editor theme onto exported `.markdown-body`. */
export const getEditorExportAppearanceCss = (appearance: EditorExportAppearance): string => {
  let css = getThemeStylesheet(appearance.editorTheme)
  css += MARKDOWN_BODY_THEME_MAP
  css += getLineWidthCss(appearance.editorLineWidth, appearance.maxContentWidthPx)
  css += getFontCss(appearance)
  css += getCodeWrapCss(appearance.wrapCodeBlocks ?? false)
  if (appearance.customCss) {
    css += appearance.customCss
  }
  return css
}

const PAGE_SIZES_MM: Record<string, { w: number; h: number }> = {
  A3: { w: 297, h: 420 },
  A4: { w: 210, h: 297 },
  A5: { w: 148, h: 210 },
  Legal: { w: 215.9, h: 355.6 },
  Letter: { w: 215.9, h: 279.4 },
  Tabloid: { w: 279.4, h: 431.8 }
}

/** Editor content column width in px (matches `--editorAreaWidth` / line-width pref). */
export const resolveExportContentWidthPx = (editorLineWidth: string): number => {
  if (editorLineWidth && /^([0-9]+)(px|ch|%)$/.test(editorLineWidth)) {
    const match = /^([0-9]+)(px|ch|%)$/.exec(editorLineWidth)!
    const num = parseInt(match[1], 10)
    if (match[2] === 'px') return num + 100
    if (match[2] === 'ch') return num * 8 + 100
  }
  return 750
}

const mmToPx = (mm: number): number => (mm / 25.4) * 96

/** Printable page width in px for PDF/print exports. */
export const resolvePrintableWidthPx = (exportOptions: {
  pageSize?: string
  pageSizeWidth?: number
  pageSizeHeight?: number
  isLandscape?: boolean
  pageMarginLeft?: number
  pageMarginRight?: number
}): number => {
  let pageWidthMm: number
  let pageHeightMm: number
  if (exportOptions.pageSize === 'custom') {
    pageWidthMm = exportOptions.pageSizeWidth ?? 210
    pageHeightMm = exportOptions.pageSizeHeight ?? 297
  } else {
    const size = PAGE_SIZES_MM[exportOptions.pageSize ?? 'A4'] ?? PAGE_SIZES_MM.A4
    pageWidthMm = size.w
    pageHeightMm = size.h
  }
  if (exportOptions.isLandscape) {
    ;[pageWidthMm, pageHeightMm] = [pageHeightMm, pageWidthMm]
  }
  const marginLeft = exportOptions.pageMarginLeft ?? 15
  const marginRight = exportOptions.pageMarginRight ?? 15
  return mmToPx(pageWidthMm - marginLeft - marginRight)
}
