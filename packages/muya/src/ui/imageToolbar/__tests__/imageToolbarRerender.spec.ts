// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import icons from '../config';
import { CLASS_NAMES } from '../../../config';
import { Muya } from '../../../muya';
import { ImageToolBar } from '../index';

const bootedMuyas: Muya[] = [];
const bootedToolbars: ImageToolBar[] = [];

beforeEach(() => {
    window.MUYA_VERSION = 'test';
    if (typeof globalThis.ResizeObserver === 'undefined') {
        globalThis.ResizeObserver = class {
            observe() {}
            unobserve() {}
            disconnect() {}
        } as never;
    }
});

afterEach(() => {
    while (bootedToolbars.length)
        bootedToolbars.pop()!.destroy();
    while (bootedMuyas.length)
        bootedMuyas.pop()!.destroy();
    delete (window as Partial<Window>).MUYA_VERSION;
});

function boot(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    bootedToolbars.push(new ImageToolBar(muya));
    bootedMuyas.push(muya);
    return muya;
}

function injectImage(muya: Muya, src: string): HTMLImageElement {
    const wrapper = muya.domNode.querySelector<HTMLElement>(
        `span.${CLASS_NAMES.MU_INLINE_IMAGE}`,
    )!;
    const container = wrapper.querySelector<HTMLElement>(
        `.${CLASS_NAMES.MU_IMAGE_CONTAINER}`,
    )!;
    const img = document.createElement('img');
    img.setAttribute('src', src);
    container.appendChild(img);
    return img;
}

function clickImage(img: HTMLImageElement) {
    img.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

function toolbarItemCount(): number {
    return document.querySelectorAll('.mu-image-toolbar li.item').length;
}

function toolbarOpacity(): number {
    const wrapper = document.querySelector('.mu-image-toolbar')
        ?.closest('.mu-float-wrapper') as HTMLElement | null;
    return Number.parseFloat(wrapper?.style.opacity || '0');
}

async function waitForToolbarShown() {
    await new Promise<void>((resolve) => {
        setTimeout(resolve, 100);
    });
}

describe('ImageToolBar rerender on repeated clicks', () => {
    it('keeps the full new toolbar visible after a second single click', async () => {
        const src = 'https://example.com/pic.png';
        const muya = boot(`![alt](${src})`);
        const img = injectImage(muya, src);

        clickImage(img);
        await waitForToolbarShown();

        expect(toolbarItemCount()).toBe(icons.length);
        expect(toolbarOpacity()).toBeGreaterThan(0);
        expect(document.querySelector('.mu-image-toolbar li.item.copy')).toBeTruthy();

        clickImage(img);
        await waitForToolbarShown();

        expect(toolbarItemCount()).toBe(icons.length);
        expect(toolbarOpacity()).toBeGreaterThan(0);
        expect(document.querySelector('.mu-image-toolbar li.item.copy')).toBeTruthy();
        expect(document.querySelector('.mu-image-toolbar li.item.download')).toBeTruthy();
    });

    it('keeps all toolbar actions after a third consecutive single click', async () => {
        const src = 'https://example.com/pic.png';
        const muya = boot(`![alt](${src})`);
        const img = injectImage(muya, src);

        for (let i = 0; i < 3; i++)
            clickImage(img);

        await waitForToolbarShown();

        expect(toolbarItemCount()).toBe(icons.length);
        for (const icon of icons)
            expect(document.querySelector(`.mu-image-toolbar li.item.${icon.type}`)).toBeTruthy();
    });

    it('rebuilds the full toolbar after an explicit hide event', async () => {
        const src = 'https://example.com/pic.png';
        const muya = boot(`![alt](${src})`);
        const img = injectImage(muya, src);

        clickImage(img);
        await waitForToolbarShown();
        expect(toolbarItemCount()).toBe(icons.length);

        muya.eventCenter.emit('muya-image-toolbar', { reference: null });
        expect(toolbarOpacity()).toBe(0);

        clickImage(img);
        await waitForToolbarShown();

        expect(toolbarItemCount()).toBe(icons.length);
    });
});
