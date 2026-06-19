import { isHTMLElement } from './index';

/**
 * Recompute `--mu-table-scale` on cloned editor tables (mirrors live `Table#_fitToContainer`).
 */
export function fitEditorTablesForExport(root: HTMLElement, targetWidthPx: number): void {
    if (targetWidthPx <= 0)
        return;

    const figures = root.querySelectorAll('figure.mu-table');
    for (const figureEl of figures) {
        if (!isHTMLElement(figureEl))
            continue;

        const inner = figureEl.querySelector('table.mu-table-inner');
        if (!isHTMLElement(inner))
            continue;

        inner.style.removeProperty('--mu-table-scale');
        figureEl.style.width = `${targetWidthPx}px`;
        figureEl.style.maxWidth = '100%';
        void figureEl.offsetWidth;

        const availableWidth = figureEl.clientWidth || targetWidthPx;
        let naturalWidth = inner.scrollWidth;
        if (naturalWidth <= 0)
            naturalWidth = inner.getBoundingClientRect().width;
        if (naturalWidth <= 0) {
            let fallback = 0;
            for (const row of inner.rows) {
                for (const cell of row.cells)
                    fallback += cell.textContent?.length ?? 0;
            }
            naturalWidth = Math.max(fallback * 8, 1);
        }
        if (availableWidth <= 0)
            continue;

        const scale = Math.min(1, availableWidth / naturalWidth);
        inner.style.setProperty('--mu-table-scale', scale.toFixed(4));
    }
}
