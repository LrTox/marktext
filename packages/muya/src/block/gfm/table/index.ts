import type { Muya } from '../../../muya';
import type { ITableRowState, ITableState } from '../../../state/types';
import type { Nullable } from '../../../types';
import type Content from '../../base/content';
import type TableCellContent from '../../content/tableCell';
import type { TBlockPath } from '../../types';
import type TableBodyCell from './cell';
import type TableRow from './row';
import type TableInner from './table';
import diff from 'fast-diff';
import { fromEvent } from 'rxjs';
import { diffToTextOp } from '../../../utils';
import logger from '../../../utils/logger';
import { LinkedList } from '../../base/linkedList/linkedList';
import Parent from '../../base/parent';
import { ScrollPage } from '../../scrollPage';

const debug = logger('table:');

class Table extends Parent {
    override children: LinkedList<TableInner> = new LinkedList();

    static override blockName = 'table';

    private _resizeObserver: ResizeObserver | null = null;

    private _resizeAnimationFrame: number | null = null;

    static create(muya: Muya, state: ITableState) {
        const table = new Table(muya);

        table.append(ScrollPage.loadBlock('table.inner').create(muya, state));

        return table;
    }

    // static createWithRowAndColumn(muya, row, column) {
    //   // TODO
    // }

    static createWithHeader(muya: Muya, header: string[]) {
        const state: ITableState = {
            name: 'table',
            children: [
                {
                    name: 'table.row',
                    children: header.map(c => ({
                        name: 'table.cell',
                        meta: { align: 'none' },
                        text: c,
                    })),
                },
                {
                    name: 'table.row',
                    children: header.map(() => ({
                        name: 'table.cell',
                        meta: { align: 'none' },
                        text: '',
                    })),
                },
            ],
        };

        return this.create(muya, state);
    }

    override get path() {
        const { path: pPath } = this.parent!;
        const offset = this.parent!.offset(this);

        return [...pPath, offset];
    }

    get rowCount() {
        return (this.firstChild as TableInner).length();
    }

    get columnCount() {
        return ((this.firstChild as TableInner).firstChild as TableRow).length();
    }

    constructor(muya: Muya) {
        super(muya);
        this.tagName = 'figure';

        this.classList = ['mu-table'];
        this.createDomNode();
        this._listenDomEvent();
        this._observeResize();
    }

    isEmpty() {
        const state = this.getState();

        return state.children.every(row =>
            row.children.every(cell => cell.text === ''),
        );
    }

    private _listenDomEvent() {
        const { domNode } = this;

        // 修复：防止光标停在表格末尾
        const mousedownHandler = (event: Event) => {
            if (event.target === domNode) {
                event.preventDefault();
                const cursorBlock = this.lastContentInDescendant()!;
                const offset = cursorBlock.text.length;
                cursorBlock.setCursor(offset, offset, true);
            }
        };

        const mousedownObservable = fromEvent(domNode!, 'mousedown');
        mousedownObservable.subscribe(mousedownHandler);
    }

    private _observeResize() {
        if (typeof ResizeObserver === 'undefined' || !this.domNode)
            return;

        this._resizeObserver = new ResizeObserver(() => {
            this._scheduleFitToContainer();
        });
        this._resizeObserver.observe(this.domNode);
        this._scheduleFitToContainer();
    }

    private _scheduleFitToContainer() {
        if (typeof requestAnimationFrame === 'undefined') {
            this._fitToContainer();
            return;
        }

        if (this._resizeAnimationFrame != null)
            cancelAnimationFrame(this._resizeAnimationFrame);

        this._resizeAnimationFrame = requestAnimationFrame(() => {
            this._resizeAnimationFrame = null;
            this._fitToContainer();
        });
    }

    private _fitToContainer() {
        const tableFigure = this.domNode;
        const tableInner = (this.firstChild as TableInner | null)?.domNode as HTMLTableElement | null;
        if (!tableFigure || !tableInner)
            return;

        tableInner.style.removeProperty('--mu-table-scale');

        const availableWidth = tableFigure.clientWidth;
        const naturalWidth = tableInner.scrollWidth;
        if (availableWidth <= 0 || naturalWidth <= 0)
            return;

        const scale = Math.min(1, availableWidth / naturalWidth);
        tableInner.style.setProperty('--mu-table-scale', scale.toFixed(4));
    }

    queryBlock(path: TBlockPath) {
        // 运行时唯一子节点为 `TableInner`（body 包装），继承 queryBlock mixin，始终存在
        return (this.firstChild as Parent & { queryBlock: (p: TBlockPath) => Parent | Content | undefined }).queryBlock(path);
    }

    protected override empty() {
        if (this.isEmpty())
            return;

        const table = this.children.head;
        if (table == null)
            return;

        table.forEach((row) => {
            (row as TableRow).forEach((cell) => {
                ((cell as TableBodyCell).firstChild as TableCellContent).text = '';
            });
        });
    }

    insertRow(offset: number) {
        const { columnCount } = this;
        const firstRowState = this.getState().children[0];
        const currentRow
            = offset > 0
                ? (this.firstChild as TableInner).find(offset - 1)
                : (this.firstChild as TableInner).find(offset);
        const state = {
            name: 'table.row',
            // eslint-disable-next-line unicorn/no-new-array
            children: [...new Array(columnCount)].map((_, i) => {
                return {
                    name: 'table.cell',
                    meta: {
                        align: firstRowState.children[i].meta.align,
                    },
                    text: '',
                };
            }),
        };

        const rowBlock = ScrollPage.loadBlock('table.row').create(this.muya, state);

        if (offset > 0)
            (this.firstChild as TableInner).insertAfter(rowBlock, currentRow as TableRow);
        else
            (this.firstChild as TableInner).insertBefore(rowBlock, currentRow as TableRow);

        this._scheduleFitToContainer();

        return rowBlock.firstContentInDescendant();
    }

    insertColumn(offset: number, align = 'none') {
        const tableInner = this.firstChild as TableInner;
        let firstCellInNewColumn: Nullable<TableBodyCell> = null;

        tableInner.forEach((row) => {
            const state = {
                name: 'table.cell',
                meta: { align },
                text: '',
            };
            const cell = ScrollPage.loadBlock('table.cell').create(this.muya, state);
            const ref = (row as TableRow).find(offset);

            (row as TableRow).insertBefore(cell, ref as TableBodyCell);
            if (!firstCellInNewColumn)
                firstCellInNewColumn = cell;
        });

        this._scheduleFitToContainer();

        return firstCellInNewColumn!.firstChild as TableCellContent;
    }

    removeRow(offset: number): Nullable<Content> {
        const inner = this.firstChild as TableInner;
        const row = inner.find(offset);
        if (row == null)
            return;

        // 在 detach 前捕获仍附着的相邻行，供调用方放置 caret。
        // 优先下一行，否则上一行；若删除后无行，则捕获表格外 content，
        // 避免 caret 落在即将 detach 的表内。
        const survivor = (row.next as TableRow | null) ?? (row.prev as TableRow | null);
        // 同时抓取表格外 fallback，整表删除时使用。
        // `nextContentInContext` / `prev` 会走出表格。
        const outsideContent
            = this.nextContentInContext() ?? this.previousContentInContext();

        row.remove();

        if (survivor == null) {
            this.remove();
            return outsideContent ?? null;
        }

        this._scheduleFitToContainer();

        return (survivor.firstChild as TableBodyCell).firstChild as TableCellContent;
    }

    removeColumn(offset: number): Nullable<Content> {
        const { columnCount } = this;
        if (offset < 0 || offset >= columnCount) {
            debug.warn(`column at ${offset} is not existed.`);
            return;
        }

        const table = this.firstChild as TableInner;
        if (this.columnCount === 1) {
            // 整表删除时与 removeRow 相同：表格外 fallback，勿将 caret 留在 detach 子树内
            const outsideContent
                = this.nextContentInContext() ?? this.previousContentInContext();
            this.remove();
            return outsideContent ?? null;
        }

        // 变异前捕获首行相邻单元格，供删除列后 setCursor 到仍附着的 cell。
        // 新架构按列循环删除，每列一次。
        const firstRow = table.firstChild as TableRow;
        const targetCellInFirstRow = firstRow.find(offset) as TableBodyCell | null;
        const neighbourCell
            = (targetCellInFirstRow?.next as TableBodyCell | null)
                ?? (targetCellInFirstRow?.prev as TableBodyCell | null);

        table.forEach((row) => {
            const cell = (row as TableRow).find(offset);
            if (cell)
                cell.remove();
        });

        this._scheduleFitToContainer();

        return (neighbourCell?.firstChild as TableCellContent | undefined) ?? null;
    }

    alignColumn(offset: number, value: string) {
        const { columnCount } = this;
        if (offset < 0 || offset >= columnCount) {
            debug.warn(`Column at ${offset} is not existed.`);
            return;
        }

        const table = this.firstChild as TableInner;
        table.forEach((row) => {
            const cell = (row as TableRow).find(offset) as TableBodyCell;
            if (cell) {
                const { align: oldValue } = cell;
                cell.align = oldValue === value ? 'none' : value;
                // 派发变更以更新 json state
                const diffs = diff(oldValue, cell.align);
                const { path } = cell;
                path.push('meta', 'align');

                this.jsonState.editOperation(path, diffToTextOp(diffs));
            }
        });

        this._scheduleFitToContainer();
    }

    /**
     * 按（row, column）零基偏移解析 body 单元格；越界返回 `null`。
     * 供跨单元格选区控制器在 anchor 与 focus 单元格间遍历矩形使用。
     */
    cellAt(row: number, column: number): Nullable<TableBodyCell> {
        const rowBlock = (this.firstChild as TableInner).find(row) as TableRow | undefined;
        if (rowBlock == null)
            return null;

        return (rowBlock.find(column) as TableBodyCell | undefined) ?? null;
    }

    /**
     * 构建由 (`startRow`, `startColumn`) 与 (`endRow`, `endColumn`) Inclusive 界定的矩形单元格块的 `ITableState`。
     * 边界可任意顺序传入（会归一化）并钳制到表尺寸，复制的矩形经 `StateToMarkdown` 可往返为 GFM 表格 markdown。
     * 首行选中行成为结果子表的表头行，保留各单元格对齐。
     */
    getSubTableState(
        startRow: number,
        startColumn: number,
        endRow: number,
        endColumn: number,
    ): ITableState {
        const { rowCount, columnCount } = this;
        const minRow = Math.max(0, Math.min(startRow, endRow));
        const maxRow = Math.min(rowCount - 1, Math.max(startRow, endRow));
        const minColumn = Math.max(0, Math.min(startColumn, endColumn));
        const maxColumn = Math.min(columnCount - 1, Math.max(startColumn, endColumn));

        const children: ITableState['children'] = [];
        for (let r = minRow; r <= maxRow; r++) {
            const cells: ITableRowState['children'] = [];
            for (let c = minColumn; c <= maxColumn; c++) {
                const cell = this.cellAt(r, c);
                if (cell)
                    cells.push(cell.getState());
            }
            children.push({ name: 'table.row', children: cells });
        }

        return { name: 'table', children };
    }

    override getState(): ITableState {
        return (this.firstChild as TableInner).getState();
    }

    override remove(source = 'user') {
        this._resizeObserver?.disconnect();
        this._resizeObserver = null;

        if (this._resizeAnimationFrame != null && typeof cancelAnimationFrame !== 'undefined') {
            cancelAnimationFrame(this._resizeAnimationFrame);
            this._resizeAnimationFrame = null;
        }

        return super.remove(source);
    }
}

export default Table;
