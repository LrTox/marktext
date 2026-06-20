/** 导出前清理克隆 DOM：移除工具栏、选区样式等编辑器专用节点与属性。 */

const EDITOR_UI_SELECTORS = [
    '.mu-copy-header-link',
    '.mu-table-drag-container',
    '.mu-table-bar-tools',
].join(',');

const STRIP_CLASSES = [
    'mu-table-cell-selected',
    'mu-table-cell-border-top',
    'mu-table-cell-border-right',
    'mu-table-cell-border-bottom',
    'mu-table-cell-border-left',
    'mu-active',
    'mu-focus',
];

/** 从克隆的 `.mu-container` 树中移除仅编辑器使用的 UI 与交互状态。 */
export function cleanEditorExportDom(root: HTMLElement): void {
    root.querySelectorAll(EDITOR_UI_SELECTORS).forEach(node => node.remove());

    root.querySelectorAll('[contenteditable]').forEach((node) => {
        node.removeAttribute('contenteditable');
    });

    root.querySelectorAll('[spellcheck]').forEach((node) => {
        node.removeAttribute('spellcheck');
    });

    for (const className of STRIP_CLASSES) {
        root.querySelectorAll(`.${className}`).forEach((node) => {
            node.classList.remove(className);
        });
    }
}
