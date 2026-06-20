import type { Placement, ReferenceElement } from '@floating-ui/dom';
import type { Muya } from '../../index';
import type { IBaseOptions } from '../types';
import { autoUpdate, computePosition, flip, offset } from '@floating-ui/dom';
import { EVENT_KEYS } from '../../config';

import { isHTMLElement, isKeyboardEvent, noop } from '../../utils';
import { findScrollContainer } from '../../utils/dom';

import './index.css';

function defaultOptions() {
    return {
        placement: 'bottom-start' as Placement,
        offsetOptions: {
            mainAxis: 10,
            crossAxis: 0,
            alignmentAxis: 0,
        },
        showArrow: false,
    };
}

const BUTTON_GROUP = ['mu-table-drag-bar', 'mu-front-button'];

abstract class BaseFloat {
    protected options: IBaseOptions;
    public status: boolean = false;
    public floatBox: HTMLElement | null = null;
    public container: HTMLElement | null = null;
    private _lastScrollTop: number | null = null;
    protected cb: (...args: unknown[]) => void = noop;

    private _cleanup: (() => void) | null = null;
    private _resizeObserver: ResizeObserver | null = null;

    constructor(
        public muya: Muya,
        public name: string,
        options = {},
    ) {
        this.options = Object.assign({}, defaultOptions(), options);
        this.init();
    }

    init() {
        const floatBox = document.createElement('div');
        const container = document.createElement('div');
        // 用于记住当前显示的 float 容器
        container.classList.add(this.name);
        container.classList.add('mu-float-container');
        floatBox.classList.add('mu-float-wrapper');

        floatBox.appendChild(container);
        document.body.appendChild(floatBox);

        this.floatBox = floatBox;
        this.container = container;

        // 容器尺寸随内容变化，floatBox 需跟随 container 尺寸
        const resizeObserver = (this._resizeObserver = new ResizeObserver(() => {
            // 使用 requestAnimationFrame 避免 "ResizeObserver loop completed" 警告
            requestAnimationFrame(() => {
                const { offsetWidth, offsetHeight } = container;

                Object.assign(floatBox.style, {
                    width: `${offsetWidth}px`,
                    height: `${offsetHeight}px`,
                });
            });
        }));

        resizeObserver.observe(container);
    }

    listen() {
        const { eventCenter, domNode } = this.muya;
        const { floatBox } = this;

        const keydownHandler = (event: Event) => {
            if (isKeyboardEvent(event) && event.key === EVENT_KEYS.Escape)
                this.hide();
        };

        /**
         * 编辑器垂直滚动超过一定范围后，用户焦点已离开 float，需隐藏 float
         */
        const scrollHandler = (event: Event) => {
            if (!isHTMLElement(event.target))
                return;
            if (typeof this._lastScrollTop !== 'number') {
                this._lastScrollTop = event.target.scrollTop;

                return;
            }

            // 滚动距离大于 50px 时隐藏 float
            if (
                this.status
                && Math.abs(event.target.scrollTop - this._lastScrollTop) > 50
            ) {
                this.hide();
            }
        };

        eventCenter.attachDOMEvent(document, 'click', this.hide.bind(this));
        eventCenter.attachDOMEvent(floatBox!, 'click', (event) => {
            event.stopPropagation();
            event.preventDefault();
        });
        eventCenter.attachDOMEvent(domNode, 'keydown', keydownHandler);
        eventCenter.attachDOMEvent(findScrollContainer(domNode), 'scroll', scrollHandler);
    }

    hide() {
        if (!this.status)
            return;

        const { eventCenter } = this.muya;
        const { floatBox } = this;
        this.status = false;

        if (this._cleanup) {
            this._cleanup();
            this._cleanup = null;
        }

        if (floatBox) {
            Object.assign(floatBox.style, {
                opacity: 0,
                top: '-9999px',
                left: '-9999px',
            });
        }

        this.cb = noop;
        this._lastScrollTop = null;

        if (BUTTON_GROUP.includes(this.name))
            eventCenter.emit('muya-float-button', this, false);
        else eventCenter.emit('muya-float', this, false);
    }

    // `cb` 为通用「已选择」回调。各 float 以自有参数调用（如 emojiSelector → `(item)`，
    // tableChessboard → `(row, column)`）。参数位 `never[]` 可接受任意具体回调形态。
    show(reference: ReferenceElement, cb: (...args: never[]) => void = noop) {
        const { floatBox } = this;
        const { eventCenter } = this.muya;
        const { placement, offsetOptions } = this.options;
        if (!floatBox) {
            throw new Error('The float box is not existed.');
        }
        if (this._cleanup) {
            this._cleanup();
            this._cleanup = null;
        }

        // 参数声明为 `never[]` 以接受任意回调形态；字段存为 `unknown[]` 供内部转发
        this.cb = cb as (...args: unknown[]) => void;

        const cleanup = autoUpdate(reference, floatBox, () => {
            computePosition(reference, floatBox, {
                placement,
                middleware: [offset(offsetOptions), flip()],
            }).then(({ x, y }) => {
                // `computePosition` 异步：resolve 前可能已 hide() 或更新的 show()。
                // 此时仍应用会设 `opacity: 1` 但 status 未恢复，下次 hide() 早退导致 float 卡住可见。
                // 除非本 pass 仍为 active，否则放弃应用。
                if (this._cleanup !== cleanup)
                    return;
                Object.assign(floatBox.style, {
                    left: `${x}px`,
                    top: `${y}px`,
                    opacity: 1,
                });
            }).catch(() => {
                if (this._cleanup === cleanup)
                    this.hide();
            });
        });
        this._cleanup = cleanup;

        this.status = true;

        if (BUTTON_GROUP.includes(this.name))
            eventCenter.emit('muya-float-button', this, true);
        else eventCenter.emit('muya-float', this, true);
    }

    destroy() {
        if (this.container && this._resizeObserver)
            this._resizeObserver.unobserve(this.container);

        if (this._cleanup) {
            this._cleanup();
            this._cleanup = null;
        }

        this.floatBox?.remove();
    }
}

export default BaseFloat;
