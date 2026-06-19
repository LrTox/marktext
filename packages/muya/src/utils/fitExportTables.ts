import { isHTMLElement } from './index';

const isExportTable = (value: Element): value is HTMLTableElement => {
    if (value instanceof HTMLTableElement)
        return true;
    // happy-dom / jsdom may not pass `instanceof HTMLTableElement`.
    return value.tagName === 'TABLE' && isHTMLElement(value);
};

export interface FitExportTablesOptions {
    /** Editor / content column width in px. */
    measureWidthPx: number;
    /** Printable page width in px — when set, tables fill this width (PDF/print). */
    capWidthPx?: number;
}

const MEASURE_SANDBOX_CLASS = 'mt-export-measure-sandbox';

/** Measure natural table size in a visible off-screen sandbox (works when ancestors are `display:none`). */
const measureTableNaturalSize = (table: HTMLTableElement): { width: number; height: number } => {
    const sandbox = document.createElement('div');
    sandbox.className = `markdown-body ${MEASURE_SANDBOX_CLASS}`;
    sandbox.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;display:block;width:max-content;max-width:none;';

    const clone = table.cloneNode(true) as HTMLTableElement;
    clone.style.display = 'table';
    clone.style.tableLayout = 'auto';
    clone.style.width = 'max-content';
    clone.style.maxWidth = 'none';
    clone.style.minWidth = 'max-content';
    clone.style.zoom = '1';
    clone.style.transform = 'none';
    sandbox.appendChild(clone);
    document.body.appendChild(sandbox);
    void clone.offsetWidth;

    let width = clone.scrollWidth;
    if (width <= 0)
        width = clone.getBoundingClientRect().width;
    if (width <= 0)
        width = clone.offsetWidth;

    let height = clone.offsetHeight;
    if (height <= 0)
        height = clone.getBoundingClientRect().height;

    sandbox.remove();

    if (width <= 0) {
        let fallback = 0;
        for (const row of table.rows) {
            let rowWidth = 0;
            for (const cell of row.cells)
                rowWidth += cell.textContent?.length ?? 0;
            fallback = Math.max(fallback, rowWidth * 8);
        }
        width = Math.max(fallback, 1);
    }

    return {
        width: Math.ceil(width),
        height: Math.max(Math.ceil(height), 1),
    };
};

const unwrapExportTable = (table: HTMLTableElement) => {
    let parent = table.parentElement;
    if (parent?.classList.contains('export-table-scale-inner'))
        parent = parent.parentElement;
    if (parent?.classList.contains('export-table-scale-host')) {
        parent.parentNode?.insertBefore(table, parent);
        parent.remove();
        return;
    }

    const legacyWrapper = table.parentElement;
    if (legacyWrapper?.classList.contains('export-table-wrapper')) {
        legacyWrapper.parentNode?.insertBefore(table, legacyWrapper);
        legacyWrapper.remove();
    }
};

const resetTableFitStyles = (table: HTMLTableElement) => {
    table.classList.remove('export-table-fit');
    table.style.removeProperty('zoom');
    table.style.removeProperty('--export-table-scale');
    table.style.removeProperty('transform');
    table.style.removeProperty('transform-origin');
    table.style.removeProperty('min-width');
    table.style.removeProperty('height');
    table.style.width = 'auto';
    table.style.maxWidth = 'none';
    table.style.tableLayout = 'auto';
    table.style.display = 'table';
};

/**
 * Scale markdown export tables to fit a target width (mirrors editor `Table#_fitToContainer`).
 * Skips layout tables such as `.page-container` used for PDF headers/footers.
 *
 * Uses inline `zoom` on the `<table>` — same mechanism as editor `.mu-table-inner`.
 */
export function fitExportTablesInContainer(
    container: HTMLElement,
    measureWidthPx: number,
    capWidthPx?: number,
): void {
    const targetWidth = capWidthPx && capWidthPx > 0
        ? capWidthPx
        : measureWidthPx;

    if (targetWidth <= 0)
        return;

    const tables = container.querySelectorAll('table');
    for (const tableEl of tables) {
        if (!isExportTable(tableEl) || tableEl.classList.contains('page-container'))
            continue;

        const table = tableEl;

        unwrapExportTable(table);
        resetTableFitStyles(table);

        const { width: naturalWidth } = measureTableNaturalSize(table);
        if (naturalWidth <= 0)
            continue;

        const scale = Math.min(1, targetWidth / naturalWidth);
        table.classList.add('export-table-fit');
        table.style.width = `${naturalWidth}px`;
        table.style.maxWidth = 'none';
        table.style.tableLayout = 'auto';
        table.style.setProperty('--export-table-scale', scale.toFixed(4));
        // Editor parity: `.mu-table-inner { zoom: var(--mu-table-scale, 1) }`
        table.style.zoom = scale.toFixed(4);
    }
}
