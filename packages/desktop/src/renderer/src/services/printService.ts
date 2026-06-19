// Resolve an <img>'s src for static (PDF) print (GH#678): a relative local
// path is resolved to an absolute `file://` URL against the current document
// directory; URLs, `data:` URIs, and already-absolute / `file://` srcs are
// left untouched. Ported from the legacy muyajs `getImageInfo(src)` so the
// desktop no longer depends on the muyajs engine (@muyajs/core's `getImageInfo`
// takes a DOM element, and its `getImageSrc` would double-prefix `file://`).
import { fitEditorTablesForExport, fitExportTablesInContainer } from '@muyajs/core'

const IMAGE_EXT_REG = /\.(?:jpeg|jpg|png|gif|svg|webp)(?=\?|$)/i

const PRINT_STYLE_ID = 'mt-print-export-styles'

export interface PrintTableFitOptions {
  contentWidth?: number
  maxTableWidth?: number
}

function resolveImageSrcForStaticPrint(src: string): string {
  if (!src) return src
  // Already a URL or data: URI — leave as-is (avoids `file://file://…`).
  if (/^(?:https?:|file:|data:)/i.test(src)) return src
  // Only rewrite recognised local image paths (mirrors muyajs's IMAGE_EXT_REG
  // gate) — leave anything else untouched, e.g. an extensionless absolute
  // server path `/api/image?id=…` must not become `file:///api/image…`.
  if (!IMAGE_EXT_REG.test(src)) return src
  // Absolute local image path (POSIX / UNC / Windows drive) → file://.
  if (/^(?:\/|\\\\|[a-zA-Z]:[\\/])/.test(src)) return `file://${src}`
  // Relative local image path — resolve against the document directory.
  if (window.DIRNAME) return `file://${window.path.resolve(window.DIRNAME, src)}`
  return src
}

/** Split a full export HTML document into injectable styles and body markup. */
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
   * Prepare document export and append a hidden print container to the window.
   * Everything outside of this hidden print container will be hidden with display: none.
   *
   * @param html HTML string
   * @param renderStatic Render for static files like PDF documents
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

    // Fix images when rendering for static files like PDF (GH#678).
    if (renderStatic) {
      // Traverse through the DOM tree and fix all relative image sources.
      const images = printContainer.getElementsByTagName('img')
      for (const image of Array.from(images)) {
        const rawSrc = image.getAttribute('src') ?? ''
        image.src = resolveImageSrcForStaticPrint(rawSrc)
      }
    }

    document.body.appendChild(printContainer)

    const pageWidth = tableFit?.maxTableWidth ?? tableFit?.contentWidth ?? 0
    if (pageWidth > 0) {
      // Must be measurable before print — default `display:none` yields clientWidth/scrollWidth 0.
      printContainer.classList.add('mt-print-measure')
      printContainer.style.width = `${pageWidth}px`
      printContainer.style.maxWidth = `${pageWidth}px`
    }

    void printContainer.offsetWidth

    const markdownBodies = printContainer.querySelectorAll('.markdown-body')
    let availableWidth = pageWidth
    for (const body of markdownBodies) {
      const width = (body as HTMLElement).clientWidth
      if (width > 0)
        availableWidth = width
    }

    if (availableWidth > 0) {
      const usesEditorDom = !!printContainer.querySelector('.export-editor-document')
      if (usesEditorDom)
        fitEditorTablesForExport(printContainer, availableWidth)
      else
        fitExportTablesInContainer(printContainer, availableWidth, availableWidth)
    }
  }

  /**
   * Remove the print container from the window.
   */
  clearup(): void {
    if (this.container) {
      this.container.remove()
    }
    document.getElementById(PRINT_STYLE_ID)?.remove()
  }
}

export default MarkdownPrint
