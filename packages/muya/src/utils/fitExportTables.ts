import { isHTMLElement } from './index';

function isExportTable(value: Element): value is HTMLTableElement {
    if (value instanceof HTMLTableElement)
        return true;
    // happy-dom / jsdom 可能无法通过 `instanceof HTMLTableElement`
    return value.tagName === 'TABLE' && isHTMLElement(value);
}

export interface IFitExportTablesOptions {
    /** 编辑器/内容列宽度（px） */
    measureWidthPx: number;
    /** 可打印页宽（px）— 设置后表格按此宽度缩放（PDF/打印） */
    capWidthPx?: number;
}

const MEASURE_SANDBOX_CLASS = 'mt-export-measure-sandbox';

/** 在可见离屏沙箱中测量表格自然尺寸（祖先为 display:none 时仍可用）。 */
function measureTableNaturalSize(table: HTMLTableElement): { width: number; height: number } {
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
}

function unwrapExportTable(table: HTMLTableElement) {
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
}

function resetTableFitStyles(table: HTMLTableElement) {
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
}

/**
 * 将 Markdown 导出表格缩放到目标宽度（与编辑器 `Table#_fitToContainer` 一致）。
 * 跳过 PDF 页眉页脚等布局用表（如 `.page-container`）。
 *
 * 在 `<table>` 上使用内联 `zoom`，与编辑器 `.mu-table-inner` 机制相同。
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
        // 与编辑器一致：`.mu-table-inner { zoom: var(--mu-table-scale, 1) }`
        table.style.zoom = scale.toFixed(4);
    }
}
