import type Format from '../block/base/format';
import type { Muya } from '../muya';
import type Selection from './index';
import type { IImageSelectionData } from './types';
import { BLOCK_DOM_PROPERTY, CLASS_NAMES } from '../config';
import { isHTMLElement, isKeyboardEvent } from '../utils';
import { getImageInfo, getImageSrc } from '../utils/image';
import { findContentDOM } from './dom';
import { SelectionType } from './types';

class ImageSelection {
    selected: IImageSelectionData | null = null;

    constructor(private _muya: Muya, private _selection: Selection) {}

    attach(): void {
        const { eventCenter, domNode } = this._muya;
        eventCenter.attachDOMEvent(domNode, 'click', this._handleClick);
        eventCenter.attachDOMEvent(document, 'click', this._handleDocClick);
        eventCenter.attachDOMEvent(document, 'keydown', this._handleKeydown);
    }

    clear(): void {
        this.selected = null;
    }

    private _handleDocClick = (): void => {
        this.selected = null;
    };

    private _handleClick = (event: Event): void => {
        const { target } = event;
        if (!isHTMLElement(target))
            return;
        const imageWrapper = target.closest<HTMLElement>(`.${CLASS_NAMES.MU_INLINE_IMAGE}`);
        this.selected = null;
        if (imageWrapper)
            this._handleClickInlineImage(event, imageWrapper);
    };

    private _handleKeydown = (event: Event): void => {
        if (!isKeyboardEvent(event))
            return;

        const { key } = event;
        const { selected } = this;
        if (!selected)
            return;

        if (key === ' ') {
            event.preventDefault();
            this._previewSelectedImage(selected);
            return;
        }

        if (/^(?:Backspace|Delete|Enter)$/.test(key)) {
            event.preventDefault();
            const { block, ...imageInfo } = selected;
            block.deleteImage(imageInfo);
            this._selection.activate(SelectionType.TEXT);
        }
    };

    private _previewSelectedImage(selected: IImageSelectionData) {
        const { token, imageId } = selected;
        const tokenSrc = token.src || token.attrs.src || '';
        const imgSrc
            = this._muya.domNode
                .querySelector<HTMLImageElement>(`#${imageId} img`)
                ?.getAttribute('src') ?? '';
        const src = getImageSrc(tokenSrc).src || imgSrc;

        if (src) {
            this._muya.eventCenter.emit('preview-image', {
                data: src,
            });
        }
    }

    private _handleClickInlineImage(event: Event, imageWrapper: HTMLElement) {
        event.preventDefault();
        event.stopPropagation();
        const { eventCenter } = this._muya;
        const imageInfo = getImageInfo(imageWrapper);
        const { target } = event;
        if (!(target instanceof Node))
            return;
        const deleteContainer = isHTMLElement(target)
            ? target.closest('.mu-image-icon-close')
            : null;
        const contentDom = findContentDOM(target);

        if (!contentDom)
            return;

        const contentBlock = contentDom[BLOCK_DOM_PROPERTY] as Format;

        if (deleteContainer) {
            contentBlock.deleteImage(imageInfo);

            return;
        }

        const imageContainer = imageWrapper.querySelector<HTMLElement>(
            `.${CLASS_NAMES.MU_IMAGE_CONTAINER}`,
        );
        const clickedInsideImage = isHTMLElement(target)
            && (target.tagName === 'IMG'
                || target === imageContainer
                || !!imageContainer?.contains(target));

        if (clickedInsideImage && imageContainer) {
            if (target.tagName === 'IMG' && event instanceof MouseEvent && (event.metaKey || event.ctrlKey)) {
                const tokenSrc = imageInfo.token.src || imageInfo.token.attrs.src || '';
                const imgTarget = target as HTMLImageElement;
                const src = getImageSrc(tokenSrc).src || imgTarget.getAttribute('src') || '';
                if (src) {
                    eventCenter.emit('format-click', {
                        event,
                        formatType: 'image',
                        data: src,
                    });
                }
            }

            const reference = {
                getBoundingClientRect: () => imageContainer.getBoundingClientRect(),
                width: imageWrapper.offsetWidth,
                height: imageWrapper.offsetHeight,
            };

            eventCenter.emit('muya-image-toolbar', {
                block: contentBlock,
                reference,
                imageInfo,
            });

            // 从被点击 wrapper 直接解析 image container。
            // 同 src（及段落 offset）的图片 DOM id 重复，`document.querySelector('#id ...')`
            // 会命中第一个，缩放条会挂到错误图片上。
            eventCenter.emit('muya-transformer', {
                block: contentBlock,
                reference: imageContainer,
                imageInfo,
            });

            this._selection.selectImage(Object.assign({}, imageInfo, { block: contentBlock }));

            return;
        }

        if (
            imageWrapper.classList.contains(CLASS_NAMES.MU_EMPTY_IMAGE)
            || imageWrapper.classList.contains(CLASS_NAMES.MU_IMAGE_FAIL)
        ) {
            const rect = imageWrapper.getBoundingClientRect();
            const reference = {
                getBoundingClientRect: () => rect,
                width: imageWrapper.offsetWidth,
                height: imageWrapper.offsetHeight,
            };
            eventCenter.emit('muya-image-selector', {
                block: contentBlock,
                reference,
                imageInfo,
            });
        }
    }
}

export default ImageSelection;
