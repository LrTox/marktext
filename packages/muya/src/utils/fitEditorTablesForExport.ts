import { isHTMLElement } from './index';

function isEditorTableInner(value: Element | null): value is HTMLTableElement {
    if (!value)
        return false;
    if (value instanceof HTMLTableElement)
        return true;
    // happy-dom / jsdom 可能无法通过 `instanceof HTMLTableElement`
    return value.tagName === 'TABLE' && isHTMLElement(value);
}

const MEASURE_SANDBOX_CLASS = 'mt-export-measure-sandbox';

/** 在离屏沙箱中测量表格自然宽度（祖先 detached 或 hidden 时仍可用）。 */
function measureEditorTableNaturalWidth(inner: HTMLTableElement): number {
    const sandbox = document.createElement('div');
    sandbox.className = MEASURE_SANDBOX_CLASS;
    sandbox.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;display:block;width:max-content;max-width:none;';

    const clone = inner.cloneNode(true) as HTMLTableElement;
    clone.style.removeProperty('--mu-table-scale');
    clone.style.zoom = '1';
    clone.style.width = 'max-content';
    clone.style.maxWidth = 'none';
    clone.style.tableLayout = 'auto';
    sandbox.appendChild(clone);
    document.body.appendChild(sandbox);
    void clone.offsetWidth;

    let naturalWidth = clone.scrollWidth;
    if (naturalWidth <= 0)
        naturalWidth = clone.getBoundingClientRect().width;
    if (naturalWidth <= 0)
        naturalWidth = clone.offsetWidth;

    sandbox.remove();

    if (naturalWidth <= 0) {
        let fallback = 0;
        for (const row of inner.rows) {
            for (const cell of row.cells)
                fallback += cell.textContent?.length ?? 0;
        }
        naturalWidth = Math.max(fallback * 8, 1);
    }

    return Math.ceil(naturalWidth);
}

function resolveContainerWidth(root: HTMLElement, targetWidthPx: number): number {
    const container = root.querySelector('.export-editor-document .mu-container')
        ?? root.querySelector('.mu-container')
        ?? root;

    if (!isHTMLElement(container))
        return targetWidthPx;

    void container.offsetWidth;
    const measured = container.clientWidth;
    if (measured > 0)
        return Math.min(targetWidthPx, measured);

    return targetWidthPx;
}

/**
 * 在克隆的编辑器表格上重算 `--mu-table-scale`（与实时 `Table#_fitToContainer` 一致）。
 */
export function fitEditorTablesForExport(root: HTMLElement, targetWidthPx: number): void {
    if (targetWidthPx <= 0)
        return;

    const containerWidth = resolveContainerWidth(root, targetWidthPx);
    const figures = root.querySelectorAll('figure.mu-table');

    for (const figureEl of figures) {
        if (!isHTMLElement(figureEl))
            continue;

        const inner = figureEl.querySelector('table.mu-table-inner');
        if (!isEditorTableInner(inner))
            continue;

        inner.style.removeProperty('--mu-table-scale');
        inner.style.zoom = '1';

        figureEl.style.width = '100%';
        figureEl.style.maxWidth = `${containerWidth}px`;
        void figureEl.offsetWidth;

        const availableWidth = figureEl.clientWidth > 0 ? figureEl.clientWidth : containerWidth;
        const naturalWidth = measureEditorTableNaturalWidth(inner);
        if (availableWidth <= 0 || naturalWidth <= 0)
            continue;

        const scale = Math.min(1, availableWidth / naturalWidth);
        const scaleText = scale.toFixed(4);
        inner.style.setProperty('--mu-table-scale', scaleText);
        // 内联 zoom — printToPDF 可能忽略基于 CSS 变量的表格 zoom
        inner.style.zoom = scaleText;
    }
}
