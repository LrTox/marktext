/** PDF/HTML 导出 CSS 与 TOC 生成：合并导出选项、编辑器外观与 GitHub 兼容 slug。 */
import { escapeHTML, unescapeHTML, generateGithubSlug } from '@muyajs/core'
import academicTheme from '@/assets/themes/export/academic.theme.css?inline'
import liberTheme from '@/assets/themes/export/liber.theme.css?inline'
import { deepClone } from '@/util'
import { sanitize, EXPORT_DOMPURIFY_CONFIG } from '../util/dompurify'
import {
  getEditorExportAppearanceCss,
  resolvePrintableWidthPx,
  type EditorExportAppearance
} from './editorExportStyle'
import type { PreferencesState } from '../store/preferences'

export interface PdfCssOptions {
  type?: string
  pageMarginTop?: number
  pageMarginRight?: number
  pageMarginBottom?: number
  pageMarginLeft?: number
  fontFamily?: string
  fontSize?: number
  lineHeight?: number | string
  autoNumberingHeadings?: boolean
  showFrontMatter?: boolean
  theme?: string | null
  headerFooterFontSize?: number
  /** 已设置且 theme 为空时，导出继承编辑器主题/字体/行宽。 */
  editorAppearance?: EditorExportAppearance
  [key: string]: unknown
}

export const getCssForOptions = async(options: PdfCssOptions): Promise<string> => {
  const {
    type,
    pageMarginTop,
    pageMarginRight,
    pageMarginBottom,
    pageMarginLeft,
    fontFamily,
    fontSize,
    lineHeight,
    autoNumberingHeadings,
    showFrontMatter,
    theme,
    headerFooterFontSize,
    editorAppearance
  } = options
  const isPrintable = type !== 'styledHtml'
  const useEditorAppearance = !theme && editorAppearance

  let output = ''
  if (isPrintable) {
    output += `@media print{@page{
      margin: ${pageMarginTop}mm ${pageMarginRight}mm ${pageMarginBottom}mm ${pageMarginLeft}mm;}}`
  }

  if (useEditorAppearance) {
    output += getEditorExportAppearanceCss(editorAppearance)
  } else {
    // 字体选项（导出主题或旧版 GitHub 默认值）
    output += '.markdown-body{'
    if (fontFamily) {
      output += `font-family:"${fontFamily}",${FALLBACK_FONT_FAMILIES};`
      output = `.hf-container{font-family:"${fontFamily}",${FALLBACK_FONT_FAMILIES};}${output}`
    }
    if (fontSize) {
      output += `font-size:${fontSize}px;`
    }
    if (lineHeight) {
      output += `line-height:${lineHeight};`
    }
    output += '}'
  }

  // 通过 CSS 自动为标题编号
  if (autoNumberingHeadings) {
    output += autoNumberingHeadingsCss
  }

  // 隐藏 front matter
  if (!showFrontMatter) {
    output += 'pre.front-matter{display:none!important;}'
  }

  if (theme) {
    if (theme === 'academic') {
      output += academicTheme
    } else if (theme === 'liber') {
      output += liberTheme
    } else {
      // 从磁盘读取主题
      const { userDataPath } = window.marktext!.paths as { userDataPath: string }
      const themePath = window.path.join(userDataPath, 'themes/export', theme)
      if (await window.fileUtils.isFile(themePath)) {
        try {
          const buf = await window.fileUtils.readFile(themePath)
          const themeCSS =
            buf instanceof Uint8Array ? new TextDecoder('utf-8').decode(buf) : String(buf)
          output += themeCSS
        } catch (_) {
          // 忽略错误
        }
      }
    }
  }

  if (headerFooterFontSize) {
    output += `.page-header .hf-container,
    .page-footer-fake .hf-container,
    .page-footer .hf-container {
      font-size: ${headerFooterFontSize}px;
    }`
  }

  return unescapeHTML(sanitize(escapeHTML(output), EXPORT_DOMPURIFY_CONFIG))
}

/** 合并导出对话框选项与当前编辑器偏好，用于生成 CSS。 */
export const buildExportCssOptions = (
  exportOptions: Record<string, unknown>,
  preferences: PreferencesState
): PdfCssOptions => {
  const exportTheme = exportOptions.theme as string | null | undefined
  const fontSettingsOverwrite = !!exportOptions.fontSettingsOverwrite
  const cssOptions = { ...exportOptions } as PdfCssOptions

  if (!exportTheme) {
    const appearance: EditorExportAppearance = {
      editorTheme: preferences.theme,
      editorFontFamily: preferences.editorFontFamily,
      fontSize: fontSettingsOverwrite
        ? Number(exportOptions.fontSize ?? preferences.fontSize)
        : preferences.fontSize,
      lineHeight: fontSettingsOverwrite
        ? ((exportOptions.lineHeight ?? preferences.lineHeight) as number | string)
        : preferences.lineHeight,
      editorLineWidth: preferences.editorLineWidth,
      codeFontFamily: preferences.codeFontFamily,
      codeFontSize: preferences.codeFontSize,
      customCss: preferences.customCss,
      wrapCodeBlocks: preferences.wrapCodeBlocks
    }
    if (fontSettingsOverwrite) {
      const family = exportOptions.fontFamily as string | null | undefined
      if (family) {
        appearance.editorFontFamily = family
      }
    }
    cssOptions.editorAppearance = appearance
    if (exportOptions.type !== 'styledHtml') {
      appearance.maxContentWidthPx = resolvePrintableWidthPx(
        exportOptions as Parameters<typeof resolvePrintableWidthPx>[0]
      )
    }
  } else if (fontSettingsOverwrite) {
    const family = exportOptions.fontFamily as string | null | undefined
    if (family) {
      cssOptions.fontFamily = family
    }
    if (exportOptions.fontSize != null) {
      cssOptions.fontSize = Number(exportOptions.fontSize)
    }
    if (exportOptions.lineHeight != null) {
      cssOptions.lineHeight = exportOptions.lineHeight as number | string
    }
  }

  return cssOptions
}

export interface TocEntry {
  lvl: number
  content: string
  slug?: string
  [key: string]: unknown
}

export interface HtmlTocOptions {
  tocIncludeTopHeading?: boolean
  tocTitle?: string
  [key: string]: unknown
}

// 复刻 @muyajs/core 的 MarkdownToHtml#_injectHeadingIds slug 逻辑，
// 使 TOC 的 href="#slug" 与引擎写入 <h1>..<h6> 的 id 完全一致：
// GitHub 兼容 base slug（空文本时回退为 heading），按文档顺序用递增 -N 后缀去重。
// 在完整标题列表上计算（早于下方渲染过滤），以保持与引擎全文档扫描一致的去重序列。
const assignHeadingSlugs = (tocList: TocEntry[]): void => {
  const seen = new Set<string>()
  for (const entry of tocList) {
    const base = generateGithubSlug(entry.content) || 'heading'
    let slug = base
    let n = 1
    while (seen.has(slug)) {
      slug = `${base}-${n++}`
    }
    seen.add(slug)
    entry.slug = slug
  }
}

const generateHtmlToc = (
  tocList: TocEntry[],
  currentLevel: number,
  options: HtmlTocOptions
): string => {
  if (!tocList || tocList.length === 0) {
    return ''
  }

  const topLevel = tocList[0].lvl
  if (!options.tocIncludeTopHeading && topLevel <= 1) {
    tocList.shift()
    return generateHtmlToc(tocList, currentLevel, options)
  } else if (topLevel <= currentLevel) {
    return ''
  }

  const shifted = tocList.shift() as TocEntry
  const { content, lvl, slug } = shifted

  let html = `<li><span><a class="toc-h${lvl}" href="#${slug}">${content}</a><span class="dots"></span></span>`

  // 生成子项
  if (tocList.length !== 0 && tocList[0].lvl > lvl) {
    html += '<ul>' + generateHtmlToc(tocList, lvl, options) + '</ul>'
  }

  html += '</li>' + generateHtmlToc(tocList, currentLevel, options)
  return html
}

export const getHtmlToc = (toc: TocEntry[], options: HtmlTocOptions = {}): string => {
  const list = deepClone(toc)
  assignHeadingSlugs(list)
  const tocList = generateHtmlToc(list, 0, options)
  if (!tocList) {
    return ''
  }

  const title = options.tocTitle ? options.tocTitle : 'Table of Contents'
  const html = `<div class="toc-container"><p class="toc-title">${title}</p><ul class="toc-list">${tocList}</ul></div>`
  return sanitize(html, EXPORT_DOMPURIFY_CONFIG)
}

// 勿用 "Noto Color Emoji"：会导致 PDF 体积达数 MB 且 emoji 显示异常。
const FALLBACK_FONT_FAMILIES =
  '"Open Sans","Segoe UI","Helvetica Neue",Helvetica,Arial,sans-serif,"Apple Color Emoji","Segoe UI Emoji"'

const autoNumberingHeadingsCss = `body {counter-reset: h2}
h2 {counter-reset: h3}
h3 {counter-reset: h4}
h4 {counter-reset: h5}
h5 {counter-reset: h6}
h2:before {counter-increment: h2; content: counter(h2) ". "}
h3:before {counter-increment: h3; content: counter(h2) "." counter(h3) ". "}
h4:before {counter-increment: h4; content: counter(h2) "." counter(h3) "." counter(h4) ". "}
h5:before {counter-increment: h5; content: counter(h2) "." counter(h3) "." counter(h4) "." counter(h5) ". "}
h6:before {counter-increment: h6; content: counter(h2) "." counter(h3) "." counter(h4) "." counter(h5) "." counter(h6) ". "}
h2.nocount:before, h3.nocount:before, h4.nocount:before, h5.nocount:before, h6.nocount:before { content: ""; counter-increment: none }`
