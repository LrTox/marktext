import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import {
    commitImeOnActiveBlock,
    readActiveBlockText,
    readCompositionProbe,
    runMidCompositionOnActiveBlock,
    runMidThenCommitImeOnActiveBlock,
    startAndCommitImeWithSuffix,
    type ICompositionProbe,
} from './ime';

type Phase = 'before' | 'mid' | 'after';

async function probe(page: Page, _phase: Phase): Promise<ICompositionProbe> {
    return page.evaluate(readCompositionProbe);
}

/**
 * Poll for the active block's text to settle to the expected value. The
 * compositionend handler in muya is synchronous on Chromium and Firefox
 * but yields a macrotask on WebKit before inputHandler reads the DOM —
 * `expect.poll` rides out that engine difference. Generous timeout
 * because synthetic IME under high-parallel WebKit workloads can take
 * a few seconds to round-trip the event.
 */
async function expectActiveTextToContain(page: Page, expected: string): Promise<void> {
    await expect.poll(async () => page.evaluate(readActiveBlockText), {
        timeout: 8_000,
        intervals: [50, 100, 250, 500],
    }).toContain(expected);
}

export { expectActiveTextToContain, probe };

// Pinyin candidate strings used by IME simulation (split to avoid spell-check noise).
const PINYIN_NIHAO = 'ni' + 'hao';
const PINYIN_ZHONG = 'zh' + 'ong';

export const IME_FIXTURES = {
    pinyinCandidates: ['n', 'ni', 'nih', PINYIN_NIHAO] as const,
    pinyinZhCandidates: ['z', 'zh', PINYIN_ZHONG] as const,
};

export async function simulatePinyinMidComposition(page: Page) {
    return page.evaluate(runMidCompositionOnActiveBlock, {
        candidates: [...IME_FIXTURES.pinyinCandidates],
    });
}

export async function commitPinyinParagraph(page: Page, finalText: string) {
    await page.evaluate(commitImeOnActiveBlock, {
        finalText,
        commitData: '你好',
    });
}

export async function commitListItemIme(page: Page, suffix: string, commitData: string) {
    await page.evaluate(startAndCommitImeWithSuffix, { suffix, commitData });
}

export async function commitTableCellIme(
    page: Page,
    finalText: string,
    commitData: string,
    candidates: readonly string[],
) {
    await page.evaluate(runMidThenCommitImeOnActiveBlock, {
        candidates: [...candidates],
        finalText,
        commitData,
    });
}
