// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { cleanEditorExportDom } from '../cleanEditorExportDom';
import { fitEditorTablesForExport } from '../fitEditorTablesForExport';

describe('cleanEditorExportDom', () => {
    it('removes copy-link affordances and contenteditable attributes', () => {
        const root = document.createElement('div');
        root.className = 'mu-container';
        root.innerHTML = `
          <h2 id="x">Title<span class="mu-copy-header-link"></span></h2>
          <p contenteditable="true">text</p>
        `;
        cleanEditorExportDom(root);
        expect(root.querySelector('.mu-copy-header-link')).toBeNull();
        expect(root.querySelector('[contenteditable]')).toBeNull();
    });
});

describe('fitEditorTablesForExport', () => {
    it('sets --mu-table-scale on .mu-table-inner', () => {
        const root = document.createElement('div');
        root.style.width = '200px';
        root.innerHTML = `
          <figure class="mu-table" style="width:200px">
            <table class="mu-table-inner">
              <tr>
                <td>AAAAAAAAAAAA</td><td>BBBBBBBBBBBB</td><td>CCCCCCCCCCCC</td>
              </tr>
            </table>
          </figure>
        `;
        document.body.appendChild(root);
        fitEditorTablesForExport(root, 200);
        const inner = root.querySelector('.mu-table-inner') as HTMLElement;
        expect(inner.style.getPropertyValue('--mu-table-scale')).toBeTruthy();
        root.remove();
    });
});
