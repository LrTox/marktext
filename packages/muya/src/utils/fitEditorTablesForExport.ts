import { isHTMLElement } from './index';

const MEASURE_SANDBOX_CLASS = 'mt-export-measure-sandbox';

/** Measure natural table width in an off-screen sandbox (detached / hidden ancestors). */
const measureEditorTableNaturalWidth = (inner: HTMLTableElement): number => {
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
};

const resolveContainerWidth = (root: HTMLElement, targetWidthPx: number): number => {
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
};

/**
 * Recompute `--mu-table-scale` on cloned editor tables (mirrors live `Table#_fitToContainer`).
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
        if (!isHTMLElement(inner))
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
        // Inline zoom — printToPDF may ignore CSS-variable-based zoom on tables.
        inner.style.zoom = scaleText;
    }
}
