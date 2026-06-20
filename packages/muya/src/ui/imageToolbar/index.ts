/** 图片浮动工具栏：复制、预览、下载、对齐与编辑。 */
import type { ReferenceElement } from '@floating-ui/dom';
import type { VNode } from 'snabbdom';
import type Format from '../../block/base/format';
import type { Muya } from '../../index';

import type { ImageToken } from '../../inlineRenderer/types';
import type { Icon } from './config';
import { CLASS_NAMES } from '../../config';
import { getImageSrc } from '../../utils/image';
import { h, patch } from '../../utils/snabbdom';
import BaseFloat from '../baseFloat';
import icons from './config';
import './index.css';

const defaultOptions = {
    placement: 'top' as const,
    offsetOptions: {
        mainAxis: 10,
        crossAxis: 0,
        alignmentAxis: 0,
    },
    showArrow: false,
};

export class ImageToolBar extends BaseFloat {
    static pluginName = 'imageToolbar';
    private _oldVNode: VNode | null = null;
    private _imageInfo: {
        token: ImageToken;
        imageId: string;
    } | null = null;

    private _icons: Icon[] = icons;
    private _reference: ReferenceElement | null = null;
    private _block: Format | null = null;
    private _toolbarContainer: HTMLDivElement = document.createElement('div');

    constructor(muya: Muya, options = {}) {
        const name = 'mu-image-toolbar';
        const opts = Object.assign({}, defaultOptions, options);

        super(muya, name, opts);

        this.container!.appendChild(this._toolbarContainer);
        this.floatBox!.classList.add('mu-image-toolbar-container');

        this.listen();
    }

    override hide() {
        this._oldVNode = null;
        super.hide();
    }

    override listen() {
        const { eventCenter } = this.muya;
        super.listen();
        eventCenter.on('muya-image-toolbar', ({ block, reference, imageInfo }) => {
            this._reference = reference;
            if (reference) {
                this._block = block;
                this._imageInfo = imageInfo;
                this._render();
                setTimeout(() => {
                    const liveReference = this._resolveReference() ?? reference;
                    this.show(liveReference);
                }, 0);
            }
            else {
                this.hide();
            }
        });
    }

    private _resolveReference(): ReferenceElement | null {
        const { _imageInfo: imageInfo } = this;
        if (!imageInfo)
            return null;

        const wrapper = this.muya.domNode.querySelector<HTMLElement>(
            `#${CSS.escape(imageInfo.imageId)}`,
        );
        if (!wrapper)
            return null;

        const imageContainer = wrapper.querySelector<HTMLElement>(
            `.${CLASS_NAMES.MU_IMAGE_CONTAINER}`,
        );
        if (!imageContainer)
            return null;

        return {
            getBoundingClientRect: (): DOMRect => {
                const rect = imageContainer.getBoundingClientRect();
                // 位置取图片容器，宽高取外层 wrapper（与旧版 VirtualElement width/height 行为一致）
                return new DOMRect(rect.x, rect.y, wrapper.offsetWidth, wrapper.offsetHeight);
            },
        };
    }

    private _render() {
        const {
            _icons: icons,
            _oldVNode: oldVNode,
            _toolbarContainer: toolbarContainer,
            _imageInfo: imageInfo,
        } = this;
        const { i18n } = this.muya;
        const { attrs } = imageInfo!.token;
        const dataAlign = attrs['data-align'];
        const children = icons.map((i) => {
            const iconWrapperSelector = 'div.icon-wrapper';
            const icon = h(
                'i.icon',
                h(
                    'i.icon-inner',
                    {
                        style: {
                            'background': `url(${i.icon}) no-repeat`,
                            'background-size': '100%',
                        },
                    },
                    '',
                ),
            );
            const iconWrapper = h(iconWrapperSelector, icon);
            let itemSelector = `li.item.${i.type}`;

            if (i.type === dataAlign || (!dataAlign && i.type === 'inline'))
                itemSelector += '.active';

            return h(
                itemSelector,
                {
                    dataset: {
                        tip: i.tooltip,
                    },
                    attrs: {
                        title: i18n.t(i.tooltip),
                    },
                    on: {
                        click: (event) => {
                            this._selectItem(event, i);
                        },
                    },
                },
                iconWrapper,
            );
        });

        const vnode = h('ul', children);

        patch(oldVNode ?? toolbarContainer, vnode);
        this._oldVNode = vnode;
    }

    private _getImageSrc() {
        const { _imageInfo: imageInfo } = this;
        if (!imageInfo)
            return '';

        const tokenSrc = imageInfo.token.attrs?.src || imageInfo.token.src || '';
        const renderedSrc = document.querySelector<HTMLImageElement>(
            `#${imageInfo.imageId} img`,
        )?.getAttribute('src') || '';

        return getImageSrc(tokenSrc).src || renderedSrc;
    }

    private _selectItem(event: Event, item: Icon) {
        event.preventDefault();
        event.stopPropagation();

        const { _imageInfo: imageInfo } = this;

        switch (item.type) {
            // 复制图片到剪贴板
            case 'copy': {
                const src = this._getImageSrc();
                if (imageInfo && src) {
                    this.muya.eventCenter.emit('copy-image', {
                        src,
                    });
                }

                return this.hide();
            }

            case 'preview': {
                const src = this._getImageSrc();
                if (src) {
                    this.muya.eventCenter.emit('preview-image', {
                        data: src,
                    });
                }

                return this.hide();
            }

            case 'download': {
                const src = this._getImageSrc();
                if (src) {
                    this.muya.eventCenter.emit('download-image', {
                        data: src,
                        filename: imageInfo!.token.attrs?.title || imageInfo!.token.attrs?.alt || imageInfo!.token.src,
                    });
                }

                return this.hide();
            }

            case 'delete':
                this._block!.deleteImage(imageInfo!);
                // 隐藏图片变换控件
                this.muya.eventCenter.emit('muya-transformer', {
                    reference: null,
                });

                return this.hide();

                // 编辑图片（alt、title、替换等）
            case 'edit': {
                const rect = this._reference!.getBoundingClientRect();
                const reference = {
                    getBoundingClientRect() {
                        rect.height = 0;

                        return rect;
                    },
                };
                // 隐藏图片缩放条
                this.muya.eventCenter.emit('muya-transformer', {
                    reference: null,
                });

                this.muya.eventCenter.emit('muya-image-selector', {
                    block: this._block,
                    reference,
                    imageInfo,
                });

                return this.hide();
            }

            case 'inline':
                // fall through
            case 'left':
                // fall through
            case 'center':
                // fall through
            case 'right': {
                this._block!.updateImage(this._imageInfo!, 'data-align', item.type);

                return this.hide();
            }
        }
    }
}
