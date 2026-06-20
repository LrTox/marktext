/**
 * 克隆实时编辑器 DOM 并生成自包含 HTML，供 PDF/HTML 导出使用。
 * 与 Markdown 重渲染路径（MarkdownToHtml）互补。
 */
import type { Muya } from '../muya';
import katexCss from 'katex/dist/katex.css?inline';
import blockSyntaxCss from '../assets/styles/blockSyntax.css?inline';
import exportEditorCss from '../assets/styles/exportEditor.css?inline';
import indexCss from '../assets/styles/index.css?inline';
import inlineSyntaxCss from '../assets/styles/inlineSyntax.css?inline';
import prismCss from '../assets/styles/prismjs/light.theme.css?inline';
import { EXPORT_DOMPURIFY_CONFIG } from '../config';
import { isHTMLElement, sanitize } from '../utils';
import { cleanEditorExportDom } from '../utils/cleanEditorExportDom';
import { fitEditorTablesForExport } from '../utils/fitEditorTablesForExport';
import { injectExportHeadingIds } from '../utils/injectExportHeadingIds';

const EDITOR_EXPORT_STYLESHEETS = [
    indexCss,
    blockSyntaxCss,
    inlineSyntaxCss,
    prismCss,
    katexCss,
    exportEditorCss,
];

export class EditorToHtml {
    constructor(private _muya: Muya) {}

    private _getScrollPageContainer(): HTMLElement | null {
        const domNode = this._muya.editor?.scrollPage?.domNode;
        return isHTMLElement(domNode) ? domNode : null;
    }

    /**
     * 克隆实时编辑器 DOM（`.mu-container`）用于导出。
     * 保留 `.mu-table-inner { zoom: var(--mu-table-scale) }` 表格缩放效果。
     */
    renderHtml(options: { contentWidth?: number; maxTableWidth?: number } = {}): string {
        const source = this._getScrollPageContainer();
        if (!source)
            throw new Error('Editor scroll page is not available for export.');

        const targetWidth = options.maxTableWidth && options.maxTableWidth > 0
            ? options.maxTableWidth
            : options.contentWidth;

        const clone = source.cloneNode(true) as HTMLElement;
        cleanEditorExportDom(clone);
        injectExportHeadingIds(clone);

        if (targetWidth && targetWidth > 0)
            fitEditorTablesForExport(clone, targetWidth);

        return `<article class="export-editor-document">${clone.outerHTML}</article>`;
    }

    generate(
        options: {
            title?: string;
            extraCSS?: string;
            contentWidth?: number;
            maxTableWidth?: number;
        } = {},
    ): string {
        const { title = '', extraCSS = '', contentWidth, maxTableWidth } = options;
        const html = this.renderHtml({ contentWidth, maxTableWidth });
        const baseStyles = EDITOR_EXPORT_STYLESHEETS
            .map(css => `  <style>${css}</style>`)
            .join('\n');

        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${sanitize(title, EXPORT_DOMPURIFY_CONFIG, true)}</title>
${baseStyles}
  <style>${extraCSS}</style>
</head>
<body>
  ${html}
</body>
</html>`;
    }
}
