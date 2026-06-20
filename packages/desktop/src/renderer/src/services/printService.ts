// 解析 PDF 等静态打印场景下 <img> 的 src（GH#678）：相对本地路径按当前文档目录
// 解析为绝对 `file://` URL；http(s)、data: 及已是绝对/`file://` 的地址保持不变。
// 自 legacy muyajs 的 `getImageInfo(src)` 移植，桌面端不再依赖旧引擎。
import { fitEditorTablesForExport, fitExportTablesInContainer } from '@muyajs/core'

const IMAGE_EXT_REG = /\.(?:jpeg|jpg|png|gif|svg|webp)(?=\?|$)/i

const PRINT_STYLE_ID = 'mt-print-export-styles'

export interface PrintTableFitOptions {
  contentWidth?: number
  maxTableWidth?: number
}

function resolveImageSrcForStaticPrint(src: string): string {
  if (!src) return src
  // 已是 URL 或 data: URI，原样返回（避免 `file://file://…` 重复前缀）。
  if (/^(?:https?:|file:|data:)/i.test(src)) return src
  // 仅改写可识别的本地图片路径（与 muyajs IMAGE_EXT_REG 一致）；其余不动，
  // 例如无扩展名的 `/api/image?id=…` 不应变成 `file:///api/image…`。
  if (!IMAGE_EXT_REG.test(src)) return src
  // 绝对本地路径（POSIX / UNC / Windows 盘符）→ file://
  if (/^(?:\/|\\\\|[a-zA-Z]:[\\/])/.test(src)) return `file://${src}`
  // 相对本地图片路径 — 相对文档目录解析
  if (window.DIRNAME) return `file://${window.path.resolve(window.DIRNAME, src)}`
  return src
}

/** 将完整导出 HTML 拆分为可注入的样式与正文片段。 */
const parseExportDocument = (html: string): { styles: string; bodyContent: string } => {
  if (!/<html[\s>]/i.test(html)) {
    return { styles: '', bodyContent: html }
  }

  const doc = new DOMParser().parseFromString(html, 'text/html')
  const styles = Array.from(doc.querySelectorAll('style'))
    .map((node) => node.textContent ?? '')
    .join('\n')
  const bodyContent = doc.body?.innerHTML?.trim() ? doc.body.innerHTML : html
  return { styles, bodyContent }
}

class MarkdownPrint {
  private container: HTMLElement | null = null

  /**
   * 准备文档导出，并向页面追加隐藏的打印容器。
   * 该容器外的内容在打印时通过 display:none 隐藏。
   *
   * @param html HTML 字符串
   * @param renderStatic 是否为 PDF 等静态文件渲染
   */
  renderMarkdown(
    html: string,
    renderStatic?: boolean,
    tableFit?: PrintTableFitOptions
  ): void {
    this.clearup()
    const { styles, bodyContent } = parseExportDocument(html)

    if (styles) {
      let styleEl = document.getElementById(PRINT_STYLE_ID) as HTMLStyleElement | null
      if (!styleEl) {
        styleEl = document.createElement('style')
        styleEl.id = PRINT_STYLE_ID
        document.head.appendChild(styleEl)
      }
      styleEl.textContent = styles
    }

    const printContainer = document.createElement('article')
    printContainer.classList.add('print-container')
    this.container = printContainer
    printContainer.innerHTML = bodyContent

    // PDF 等静态导出时修正图片路径（GH#678）
    if (renderStatic) {
      const images = printContainer.getElementsByTagName('img')
      for (const image of Array.from(images)) {
        const rawSrc = image.getAttribute('src') ?? ''
        image.src = resolveImageSrcForStaticPrint(rawSrc)
      }
    }

    document.body.appendChild(printContainer)

    const pageWidth = tableFit?.maxTableWidth ?? tableFit?.contentWidth ?? 0
    if (pageWidth > 0) {
      // 打印前必须可测量 — 默认 display:none 会导致 clientWidth/scrollWidth 为 0
      printContainer.classList.add('mt-print-measure')
      printContainer.style.width = `${pageWidth}px`
      printContainer.style.maxWidth = `${pageWidth}px`
    }

    // 触发布局回流以便测量表格宽度
    printContainer.getBoundingClientRect()

    let availableWidth = pageWidth
    const exportContainer = printContainer.querySelector('.export-editor-document .mu-container') as HTMLElement | null
    if (exportContainer) {
      const measured = exportContainer.clientWidth
      if (measured > 0) { availableWidth = measured }
    } else {
      const markdownBodies = printContainer.querySelectorAll('.markdown-body')
      for (const body of markdownBodies) {
        const width = (body as HTMLElement).clientWidth
        if (width > 0) { availableWidth = width }
      }
    }

    if (availableWidth > 0) {
      const usesEditorDom = !!printContainer.querySelector('.export-editor-document')
      if (usesEditorDom) { fitEditorTablesForExport(printContainer, availableWidth) } else { fitExportTablesInContainer(printContainer, availableWidth, availableWidth) }
    }

    // 布局测量完成 — 离屏测量样式不应进入 printToPDF
    printContainer.classList.remove('mt-print-measure')
    printContainer.style.width = ''
    printContainer.style.maxWidth = ''
  }

  /** 从页面移除打印容器与注入样式。 */
  clearup(): void {
    if (this.container) {
      this.container.remove()
    }
    document.getElementById(PRINT_STYLE_ID)?.remove()
  }
}

export default MarkdownPrint
