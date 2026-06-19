// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { fitExportTablesInContainer } from '../fitExportTables';

describe('fitExportTablesInContainer', () => {
    it('marks every markdown table with export-table-fit and editor-style zoom', () => {
        const container = document.createElement('div');
        container.className = 'markdown-body';
        container.style.width = '400px';
        container.innerHTML = `
          <table>
            <thead><tr><th>A</th><th>B</th></tr></thead>
            <tbody><tr><td>one</td><td>two</td></tr></tbody>
          </table>
        `;
        document.body.appendChild(container);

        fitExportTablesInContainer(container, 400, 400);

        const table = container.querySelector('table')!;
        expect(table.classList.contains('export-table-fit')).toBe(true);
        expect(table.style.getPropertyValue('--export-table-scale')).toBeTruthy();
        expect(table.style.zoom).toBeTruthy();

        container.remove();
    });

    it('zoom-scales tables wider than the cap width (editor Table#_fitToContainer parity)', () => {
        const container = document.createElement('div');
        container.className = 'markdown-body';
        container.style.width = '200px';
        container.innerHTML = `
          <table>
            <tr>
              <td>AAAAAAAAAAAAAAAA</td>
              <td>BBBBBBBBBBBBBBBB</td>
              <td>CCCCCCCCCCCCCCCC</td>
              <td>DDDDDDDDDDDDDDDD</td>
              <td>EEEEEEEEEEEEEEEE</td>
            </tr>
          </table>
        `;
        document.body.appendChild(container);

        fitExportTablesInContainer(container, 200, 200);

        expect(container.querySelector('.export-table-scale-host')).toBeNull();
        const table = container.querySelector('table')!;
        expect(Number.parseFloat(table.style.zoom)).toBeLessThan(1);
        expect(Number.parseFloat(table.style.width)).toBeGreaterThan(200);

        container.remove();
    });

    it('skips page-container layout tables', () => {
        const container = document.createElement('div');
        container.innerHTML = `
          <table class="page-container">
            <tr><td><table><tr><td>inner</td></tr></table></td></tr>
          </table>
        `;
        document.body.appendChild(container);

        fitExportTablesInContainer(container, 400, 400);

        expect(container.querySelector('.page-container')!.classList.contains('export-table-fit')).toBe(false);
        expect(container.querySelector('.page-container table:not(.page-container)')!.classList.contains('export-table-fit')).toBe(true);

        container.remove();
    });
});
