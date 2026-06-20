/**
 * @muyajs/core 包入口 —— 对外导出 Muya 类、UI 插件、状态/HTML 工具及类型。
 */
export type { ILocale } from './i18n/types';
export { de, en, es, fr, ja, ko, pt, tr, zhCN, zhTW } from './locales';

export { Muya } from './muya';
export { EditorToHtml } from './state/editorToHtml';
export type { ITocItem } from './state/getTOC';
export { MarkdownToHtml } from './state/markdownToHtml';
export { renderToStaticHTML } from './state/renderToStaticHTML';
export type { IRenderToStaticHTMLOptions } from './state/renderToStaticHTML';
export type { TState } from './state/types';
export type { IMuyaOptions } from './types';

export { CodeBlockLanguageSelector } from './ui/codeBlockLanguageSelector';
// 导出 UI 工具组件
export { EmojiSelector } from './ui/emojiSelector';
export { FootnoteTool } from './ui/footnoteTool';
export { ImageEditTool } from './ui/imageEditTool';
export { ImagePathPicker } from './ui/imagePicker';
export type { IImagePathSuggestion } from './ui/imagePicker';
export { ImageResizeBar } from './ui/imageResizeBar';
export { ImageToolBar } from './ui/imageToolbar';
export { InlineFormatToolbar } from './ui/inlineFormatToolbar';
export { default as LinkTools } from './ui/linkTools';
export { ParagraphFrontButton } from './ui/paragraphFrontButton';
export { ParagraphFrontMenu } from './ui/paragraphFrontMenu';
export { ParagraphQuickInsertMenu } from './ui/paragraphQuickInsertMenu';
export { PreviewToolBar } from './ui/previewToolBar';
export { default as TableChessboard } from './ui/tableChessboard';
export { TableColumnToolbar } from './ui/tableColumnToolbar';
export { TableDragBar } from './ui/tableDragBar';
export { TableRowColumMenu } from './ui/tableRowColumMenu';
export { fitEditorTablesForExport } from './utils/fitEditorTablesForExport';
export { fitExportTablesInContainer } from './utils/fitExportTables';
export type { IFitExportTablesOptions } from './utils/fitExportTables';
export type { IImageInfo } from './utils/image';
export { getImageInfo } from './utils/image';
export { escapeHTML, sanitize, unescapeHTML, wordCount } from './utils/index';
export { generateGithubSlug } from './utils/slug';
