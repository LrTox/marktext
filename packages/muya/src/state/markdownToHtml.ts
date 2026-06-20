/** Markdown 转 HTML 导出：内联样式、渲染图表、注入标题 id、表格缩放。 */
import type { Muya } from '../muya';
import githubMarkdownCss from 'github-markdown-css/github-markdown-light.css?inline';
import katexCss from 'katex/dist/katex.css?inline';
import prismCss from 'prismjs/themes/prism.css?inline';
import exportStyle from '../assets/styles/exportStyle.css?inline';
import { EXPORT_DOMPURIFY_CONFIG } from '../config';
import { isHTMLElement, sanitize, unescapeHTML } from '../utils';
import loadRenderer from '../utils/diagram';
import { fitExportTablesInContainer } from '../utils/fitExportTables';
import { injectExportHeadingIds } from '../utils/injectExportHeadingIds';

import { getHighlightHtml } from '../utils/marked';

// 核心样式表内联进导出文档，使输出自包含，可离线/CSP/隔离环境渲染。
// 若从 CDN 引用，保存的 .html 在无网络时会无样式，对离线桌面编辑器是回归。
// 调用方可通过 generate({ inlineStyles: false }) 显式选择较轻的 CDN 链接壳。
const BASE_STYLESHEETS = [githubMarkdownCss, katexCss, prismCss];

// inlineStyles 为 false 时使用的 CDN <link> 标签。与旧版默认输出保持一致。
const CDN_STYLESHEET_LINKS = `  <!-- https://cdnjs.com/libraries/github-markdown-css -->
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/github-markdown-css/5.2.0/github-markdown-light.css" integrity="sha512-n5zPz6LZB0QV1eraRj4OOxRbsV7a12eAGfFcrJ4bBFxxAwwYDp542z5M0w24tKPEhKk2QzjjIpR5hpOjJtGGoA==" crossorigin="anonymous" referrerpolicy="no-referrer" />
  <!-- https://katex.org/docs/browser -->
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.css" integrity="sha384-GvrOXuhMATgEsSwCs4smul74iXGOixntILdUW9XmUC6+HX0sLNAK3q71HotJqlAn" crossorigin="anonymous">
  <!-- https://cdnjs.com/libraries/prism -->
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/prism/9000.0.1/themes/prism.min.css" integrity="sha512-/mZ1FHPkg6EKcxo0fKXF51ak6Cr2ocgDi5ytaTBjsQZIH/RNs6GF6+oId/vPe3eJB836T36nXwVh/WBl/cWT4w==" crossorigin="anonymous" referrerpolicy="no-referrer" />`;

export class MarkdownToHtml {
    private _exportContainer: HTMLDivElement | null = null;

    constructor(public markdown: string, private _muya?: Muya) {}

    private async _renderMermaid() {
        const codes = this._exportContainer!.querySelectorAll(
            'code.language-mermaid',
        );
        for (const code of codes) {
            const preEle = code.parentNode;
            if (!isHTMLElement(preEle))
                continue;
            const mermaidContainer = document.createElement('div');
            mermaidContainer.innerHTML = sanitize(
                unescapeHTML(code.innerHTML),
                EXPORT_DOMPURIFY_CONFIG,
                true,
            ) as string;
            mermaidContainer.classList.add('mermaid');
            preEle.replaceWith(mermaidContainer);
        }
        const mermaid = await loadRenderer('mermaid');
        mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            theme: this._muya?.options.mermaidTheme ?? 'default',
        });
        await mermaid.run({
            nodes: [...this._exportContainer!.querySelectorAll('div.mermaid')],
        });
        if (this._muya) {
            mermaid.initialize({
                securityLevel: 'strict',
                theme: this._muya.options.mermaidTheme,
            });
        }
    }

    private async _renderDiagram() {
        const selector
            = 'code.language-vega-lite, code.language-plantuml, code.language-flowchart, code.language-sequence';
        const codes = this._exportContainer!.querySelectorAll(selector);

        for (const code of codes) {
            const rawCode = unescapeHTML(code.innerHTML);
            const functionType = (() => {
                if (/plantuml/.test(code.className))
                    return 'plantuml';
                else if (/flowchart/.test(code.className))
                    return 'flowchart';
                else if (/sequence/.test(code.className))
                    return 'sequence';
                else
                    return 'vega-lite';
            })();
            const render = await loadRenderer(functionType);
            const preParent = code.parentNode;
            if (!isHTMLElement(preParent))
                continue;
            const diagramContainer = document.createElement('div');
            diagramContainer.classList.add(functionType);
            preParent.replaceWith(diagramContainer);
            const options = {};
            if (functionType === 'vega-lite') {
                Object.assign(options, {
                    actions: false,
                    tooltip: false,
                    renderer: 'svg',
                    theme: this._muya?.options.vegaTheme ?? 'latimes',
                });
            }
            else if (functionType === 'sequence') {
                Object.assign(options, {
                    theme: this._muya?.options.sequenceTheme ?? 'hand',
                });
            }

            try {
                if (functionType === 'plantuml') {
                    const diagram = render.parse(rawCode, this._muya?.options.plantumlServer);
                    diagramContainer.innerHTML = '';
                    diagram.insertImgElement(diagramContainer);
                }
                else if (functionType === 'flowchart' || functionType === 'sequence') {
                    const diagram = render.parse(rawCode);
                    diagramContainer.innerHTML = '';
                    diagram.drawSVG(diagramContainer, options);
                }
                else if (functionType === 'vega-lite') {
                    await render(diagramContainer, JSON.parse(rawCode), options);
                }
            }
            catch {
                diagramContainer.innerHTML = '< Invalid Diagram >';
            }
        }
    }

    // 将过宽表格缩放至导出内容宽度（与编辑器 Table#_fitToContainer 一致）。
    private _fitExportTables(measureWidthPx: number, capWidthPx?: number) {
        const container = this._exportContainer;
        if (!container)
            return;

        container.classList.add('markdown-body');
        container.style.boxSizing = 'border-box';
        const targetWidth = capWidthPx && capWidthPx > 0
            ? capWidthPx
            : measureWidthPx;
        if (targetWidth > 0) {
            container.style.width = `${targetWidth}px`;
            container.style.maxWidth = `${targetWidth}px`;
        }

        fitExportTablesInContainer(container, measureWidthPx, capWidthPx);
    }

    // 用 marked 渲染纯 HTML
    async renderHtml(contentWidth?: number, maxTableWidth?: number) {
        let html = getHighlightHtml(this.markdown, {
            superSubScript: this._muya?.options?.superSubScript ?? true,
            footnote: this._muya?.options?.footnote ?? false,
            isGitlabCompatibilityEnabled:
        this._muya?.options?.isGitlabCompatibilityEnabled ?? true,
            math: this._muya?.options?.math ?? true,
        });

        html = sanitize(html, EXPORT_DOMPURIFY_CONFIG, false) as string;

        const exportContainer = (this._exportContainer
            = document.createElement('div'));
        exportContainer.classList.add('ag-render-container', 'markdown-body');
        exportContainer.innerHTML = html;
        document.body.appendChild(exportContainer);

        // 导出路径仅渲染 mermaid/图表的浅色主题…
        await this._renderMermaid();
        await this._renderDiagram();

        // 为导出标题注入 GitHub 兼容 slug id，使 [TOC] / getHtmlToc 的 href="#slug" 可解析。
        // 仅作用于本导出 DOM；一致性渲染器 renderToStaticHTML 有意保持不变。
        injectExportHeadingIds(exportContainer);

        if (contentWidth && contentWidth > 0)
            this._fitExportTables(contentWidth, maxTableWidth);

        let result = exportContainer.innerHTML;
        exportContainer.remove();

        // 为输出 HTML 补全箭头 marker（flowchart/sequence 等 SVG）
        // TODO: JOCS，这些代码是否仍需要？
        const paths = document.querySelectorAll('path[id^=raphael-marker-]');
        const def = '<defs style="-webkit-tap-highlight-color: rgba(0, 0, 0, 0);">';
        result = result.replace(def, () => {
            let str = '';
            for (const path of paths)
                str += path.outerHTML;

            return `${def}${str}`;
        });

        this._exportContainer = null;

        return `<article class="markdown-body">${result}</article>`;
    }

    /**
     * 生成带样式的完整 HTML 文档。
     *
     * @param options 文档选项。
     * @param options.title 文档 <title>。
     * @param options.extraCSS 追加在基础样式表之后的 CSS。
     * @param options.inlineStyles 内联核心样式表以实现离线自包含（默认 true）；传 false 则回退为 CDN link。
     * @param options.contentWidth 编辑器内容宽度（px），用于计算表格 zoom。
     * @param options.maxTableWidth 表格最大宽度（px），PDF/打印页宽上限。
     */
    async generate(
        options: {
            title?: string;
            extraCSS?: string;
            inlineStyles?: boolean;
            /** 编辑器内容宽度（px），用于计算表格 zoom（与编辑器一致）。 */
            contentWidth?: number;
            /** 表格最大宽度（px），PDF/打印页宽上限。 */
            maxTableWidth?: number;
        } = {},
    ) {
        const html = await this.renderHtml(options.contentWidth, options.maxTableWidth);

        // extraCSS 可能在 await renderHtml 期间已被外部更新。
        const { title = '', extraCSS = '', inlineStyles = true } = options;

        const baseStyles = inlineStyles
            ? BASE_STYLESHEETS.map(css => `  <style>${css}</style>`).join('\n')
            : CDN_STYLESHEET_LINKS;

        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${sanitize(title, EXPORT_DOMPURIFY_CONFIG, true)}</title>
${baseStyles}
  <style>${exportStyle}</style>
  <style>${extraCSS}</style>
</head>
<body>
  ${html}
</body>
</html>`;
    }
}
