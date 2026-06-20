/** Browser-side helpers for Playwright `page.evaluate`. */

export interface ICompositionProbe {
    isComposed: boolean;
    text: string;
}

function readComposedFlag(block: unknown): boolean {
    return (block as { isComposed?: boolean } | null)?.isComposed === true;
}

export function readCompositionProbe(): ICompositionProbe {
    const block = window.muya!.editor.activeContentBlock;
    return {
        isComposed: readComposedFlag(block),
        text: block?.text ?? '',
    };
}

export function readActiveBlockText(): string {
    return window.muya!.editor.activeContentBlock?.text ?? '';
}

export function stripZwsp(text: string): string {
    return text.replace(/\u200B/g, '');
}

export function replaceNodeTextAndSelectEnd(node: HTMLElement, finalText: string): void {
    while (node.firstChild)
        node.removeChild(node.firstChild);
    const textNode = document.createTextNode(finalText);
    node.appendChild(textNode);
    const range = document.createRange();
    range.setStart(textNode, finalText.length);
    range.collapse(true);
    const sel = document.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
}

export function dispatchCompositionStart(node: HTMLElement): void {
    node.dispatchEvent(new CompositionEvent('compositionstart', {
        bubbles: true,
        cancelable: true,
        data: '',
    }));
}

export function dispatchCompositionCandidates(
    node: HTMLElement,
    original: string,
    candidates: string[],
): ICompositionProbe {
    const block = window.muya!.editor.activeContentBlock!;
    for (const c of candidates) {
        node.textContent = original + c;
        node.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            cancelable: true,
            data: c,
            inputType: 'insertCompositionText',
            isComposing: true,
        }));
    }
    return {
        isComposed: readComposedFlag(block),
        text: block.text,
    };
}

export function dispatchCompositionCommit(node: HTMLElement, data: string): void {
    node.dispatchEvent(new CompositionEvent('compositionend', {
        bubbles: true,
        cancelable: true,
        data,
    }));
    node.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        data,
        inputType: 'insertCompositionText',
        isComposing: false,
    }));
}

export interface ICommitImeOptions {
    finalText: string;
    commitData: string;
}

export function commitImeOnActiveBlock({ finalText, commitData }: ICommitImeOptions): void {
    const block = window.muya!.editor.activeContentBlock!;
    const node = block.domNode as HTMLElement;
    replaceNodeTextAndSelectEnd(node, finalText);
    dispatchCompositionCommit(node, commitData);
}

export interface IRunMidCompositionOptions {
    candidates: string[];
}

export function runMidCompositionOnActiveBlock(
    { candidates }: IRunMidCompositionOptions,
): ICompositionProbe {
    const block = window.muya!.editor.activeContentBlock!;
    const node = block.domNode as HTMLElement;
    const original = stripZwsp(node.textContent ?? '');
    dispatchCompositionStart(node);
    return dispatchCompositionCandidates(node, original, candidates);
}

export interface IStartAndCommitImeOptions {
    finalText: string;
    commitData: string;
}

export function startAndCommitImeOnActiveBlock(
    { finalText, commitData }: IStartAndCommitImeOptions,
): void {
    const block = window.muya!.editor.activeContentBlock!;
    const node = block.domNode as HTMLElement;
    dispatchCompositionStart(node);
    replaceNodeTextAndSelectEnd(node, finalText);
    dispatchCompositionCommit(node, commitData);
}

export function startAndCommitImeWithSuffix(options: { suffix: string; commitData: string }): void {
    const block = window.muya!.editor.activeContentBlock!;
    const node = block.domNode as HTMLElement;
    const original = stripZwsp(node.textContent ?? '');
    startAndCommitImeOnActiveBlock({
        finalText: original + options.suffix,
        commitData: options.commitData,
    });
}

export interface IRunMidThenCommitOptions {
    candidates: string[];
    finalText: string;
    commitData: string;
}

export function runMidThenCommitImeOnActiveBlock(
    { candidates, finalText, commitData }: IRunMidThenCommitOptions,
): void {
    const block = window.muya!.editor.activeContentBlock!;
    const node = block.domNode as HTMLElement;
    const original = stripZwsp(node.textContent ?? '');
    dispatchCompositionStart(node);
    dispatchCompositionCandidates(node, original, candidates);
    replaceNodeTextAndSelectEnd(node, finalText);
    dispatchCompositionCommit(node, commitData);
}
