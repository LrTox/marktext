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

/** Remove editor-only UI and interaction state from a cloned `.mu-container` tree. */
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
