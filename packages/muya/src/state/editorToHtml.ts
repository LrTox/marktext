import type { Muya } from '../muya';
import blockSyntaxCss from '../assets/styles/blockSyntax.css?inline';
import exportEditorCss from '../assets/styles/exportEditor.css?inline';
import indexCss from '../assets/styles/index.css?inline';
import inlineSyntaxCss from '../assets/styles/inlineSyntax.css?inline';
import prismCss from '../assets/styles/prismjs/light.theme.css?inline';
import katexCss from 'katex/dist/katex.css?inline';
import { EXPORT_DOMPURIFY_CONFIG } from '../config';
import { cleanEditorExportDom } from '../utils/cleanEditorExportDom';
import { fitEditorTablesForExport } from '../utils/fitEditorTablesForExport';
import { injectExportHeadingIds } from '../utils/injectExportHeadingIds';
import { isHTMLElement, sanitize } from '../utils';

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
     * Clone the live editor DOM (`.mu-container`) for export.
     * Preserves `.mu-table-inner { zoom: var(--mu-table-scale) }` scaling.
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
