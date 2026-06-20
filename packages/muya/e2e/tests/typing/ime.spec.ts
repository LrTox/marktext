import { expect, test } from '../fixtures/muya';
import {
    commitListItemIme,
    commitPinyinParagraph,
    commitTableCellIme,
    expectActiveTextToContain,
    IME_FIXTURES,
    probe,
    simulatePinyinMidComposition,
} from '../helpers/imeDriver';
import { getMarkdown } from '../helpers/api';
import { editor } from '../helpers/selectors';

/**
 * IME composition specs.
 *
 * Playwright's `page.keyboard.type` doesn't simulate IME — `KeyboardEvent`s
 * dispatched through CDP bypass the OS input-method layer, so synthetic CJK
 * pinyin entry never produces a `compositionstart` → `compositionend` pair.
 *
 * Instead, we drive the editor through the same DOM event sequence a real IME
 * would: dispatch `compositionstart` on the active content block's domNode,
 * mutate the DOM textContent to mirror what the IME would insert at each
 * candidate keystroke (firing `input` events with `isComposing: true` —
 * these are short-circuited by `format.inputHandler` while `isComposed` is
 * truthy), then dispatch `compositionend` with the final committed text.
 *
 * Assertion contract: text lands in state via the post-compositionend
 * `inputHandler` call (see `Content.composeHandler` in
 * `packages/core/src/block/base/content.ts`) — *not* during the input
 * burst. We verify state both ways: it must be unchanged mid-composition
 * and updated after compositionend.
 */

test.describe('IME composition', () => {
    // Synthetic CompositionEvent / InputEvent dispatch is unreliable on
    // WebKit. CompositionEvent is delivered, but the inputHandler that
    // composeHandler invokes (or the trailing `insertCompositionText`
    // input) reads stale block state about 60% of the time under the
    // 3-project parallel matrix. Real-user IME is exercised manually;
    // unit tests in `packages/core/src/block/base/__tests__/autoPair.spec.ts`
    // cover the composeHandler branches directly. Skipping the engine
    // pending a CDP-driven IME injection (Playwright #1112).
    test.skip(({ browserName }) => browserName === 'webkit', 'Synthetic IME unreliable on WebKit — see BACKLOG');

    test('CJK pinyin commits text to a paragraph only after compositionend', async ({ page }) => {
        await page.evaluate(() => window.muya!.setContent('hello '));
        const para = page.locator(editor.paragraph).first();
        await para.click();
        await page.keyboard.press('End');

        // Sanity: before composition, state matches DOM.
        const before = await probe(page, 'before');
        expect(before.isComposed).toBe(false);
        expect(before.text).toBe('hello ');

        // Drive a candidate flow that mimics pinyin entry of 你好 via
        // intermediate syllables before the user selects 你好 from the
        // candidate list. Inputs DO NOT mutate state.
        const mid = await simulatePinyinMidComposition(page);

        // Block is mid-composition; state still holds the pre-composition text.
        expect(mid.isComposed).toBe(true);
        expect(mid.text).toBe('hello ');

        // Commit 你好. Move the selection to the end of the final-text
        // textNode FIRST so `getCursor()` inside inputHandler returns a
        // sane offset on every engine, then dispatch compositionend AND
        // a trailing `input` (inputType: insertCompositionText,
        // isComposing: false) — real browsers fire both in that order,
        // and WebKit specifically wires `insertCompositionText` to the
        // input pathway so we get a state-update even if the
        // composeHandler's compositionend → inputHandler call misses
        // under load.
        await commitPinyinParagraph(page, 'hello 你好');

        await expectActiveTextToContain(page, '你好');
        const after = await probe(page, 'after');
        expect(after.isComposed).toBe(false);
        expect(after.text.startsWith('hello')).toBe(true);

        const md = await getMarkdown(page);
        expect(md).toContain('你好');
    });

    test('CJK pinyin commits text inside a list item', async ({ page }) => {
        // Seed a bullet list directly — focus routing through the slash menu
        // is finicky on WebKit, and the focus dance isn't what we're testing
        // here. We're testing IME inside a list-item content block.
        await page.evaluate(() => window.muya!.setContent('- seed\n'));
        const bullet = page.locator(editor.bulletList).first();
        await expect(bullet).toBeVisible();

        const liPara = bullet.locator(editor.paragraph).first();
        await liPara.click();
        await page.keyboard.press('End');
        // Wait for activeContentBlock to point inside the bullet list.
        await expect.poll(async () => page.evaluate(() => {
            const block = window.muya!.editor.activeContentBlock;
            if (!block)
                return false;
            let p = block.parent;
            while (p) {
                if (p.blockName === 'bullet-list')
                    return true;
                p = p.parent;
            }
            return false;
        })).toBe(true);

        // Compositionstart + compositionend pair committing 测试 after the
        // existing `seed` content — verify state wires through list-item
        // content blocks too.
        await commitListItemIme(page, '测试', '测试');

        await expectActiveTextToContain(page, '测试');
        const after = await probe(page, 'after');
        expect(after.isComposed).toBe(false);

        const md = await getMarkdown(page);
        expect(md).toContain('测试');
    });

    test('CJK pinyin commits text inside a table cell (non-empty cell)', async ({ page }) => {
        // tableCell content has its own compositionstart/end branch (see
        // packages/core/src/block/content/tableCell/index.ts:262) that
        // inserts a zero-width-space placeholder when the cell is EMPTY
        // at compositionstart, then strips the last char on compositionend
        // to compensate for a Safari quirk. Synthetic composition with
        // pre-set DOM text would mis-trip that branch and lose the last
        // committed char — so seed the cell with a non-empty value first
        // and compose on top of it, which is the more common user flow
        // anyway.
        await page.evaluate(() => window.muya!.setContent(''));
        await page.locator(editor.paragraph).first().click();
        await page.keyboard.type('| a | b |');
        await page.keyboard.press('Enter');
        const table = page.locator(editor.table).first();
        await expect(table).toBeVisible();

        // First body cell (second table row; first row is the header).
        const firstBodyCell = table.locator('tr').nth(1).locator('td').first();
        await firstBodyCell.click();
        // Seed the cell so tableCell.composeHandler does NOT take the
        // ZWSP placeholder branch (this.text !== '').
        await page.keyboard.type('x');
        await expect(firstBodyCell).toContainText('x');

        await commitTableCellIme(
            page,
            'x中文',
            '中文',
            IME_FIXTURES.pinyinZhCandidates,
        );

        await expectActiveTextToContain(page, '中文');
        const after = await probe(page, 'after');
        expect(after.isComposed).toBe(false);
        expect(after.text).toContain('x');
        expect(after.text).toContain('中文');

        const md = await getMarkdown(page);
        expect(md).toContain('中文');
    });
});
