// Desktop-side styled-HTML export wrapper for the @muyajs/core engine.
//
// Primary path: clone the live editor DOM (`EditorToHtml`) so PDF/HTML export
// matches on-screen rendering (`.mu-table` zoom, theme, blockSyntax CSS).
// Fallback: `MarkdownToHtml` re-renders markdown when no editor instance exists
// (unit tests, headless callers).

import type { Muya } from '@muyajs/core'
import { EditorToHtml, MarkdownToHtml } from '@muyajs/core'
import { sanitize, EXPORT_DOMPURIFY_CONFIG } from './dompurify'

export interface HeaderFooterPart {
  type?: number
  left?: string
  center?: string
  right?: string
}

export interface ExportStyledHtmlOptions {
  title?: string
  printOptimization?: boolean
  extraCss?: string
  /** Pre-rendered TOC HTML (from `getHtmlToc`). Injected at `[TOC]`. */
  toc?: string
  header?: HeaderFooterPart | null
  footer?: HeaderFooterPart | null
  headerFooterStyled?: boolean
  /** Content width in px — editor column width for table scaling. */
  contentWidth?: number
  /** Max table width in px — printable page width for PDF/print. */
  maxTableWidth?: number
}

const HEADER_FOOTER_CSS = `
:root { --footerHeaderBorderColor: #1c1c1c; }
table.page-container { width: 100%; border-collapse: collapse; }
table.page-container > tbody,
table.page-container > tbody > tr,
table.page-container > tbody > tr > td { display: block; width: 100%; }
table.page-container > tbody > tr > td { overflow-wrap: anywhere; }
table.page-container > thead,
table.page-container > tfoot { display: table-header-group; }
.page-header .hf-container,
.page-footer-fake .hf-container,
.page-footer .hf-container { display: flex; justify-content: space-between; font-size: 0.75em; font-weight: 400; }
.page-header { display: table-header-group; }
.page-header .hf-container { margin-bottom: 16px; }
.page-header.styled .hf-container { padding-bottom: 1px; border-bottom: 1px solid var(--footerHeaderBorderColor); }
.page-header .hf-container > div { flex: 1; max-height: 100px; overflow: hidden; }
.page-header .header-content-left { text-align: left; margin-right: 4px; }
.page-header .header-content { text-align: center; }
.page-header .header-content-right { text-align: right; margin-left: 4px; }
.page-header.single .header-content-left,
.page-header.single .header-content-right { display: none; }
.page-footer-fake { display: table-footer-group; }
.page-footer-fake .hf-container { margin-top: 16px; visibility: hidden; }
.page-footer { position: fixed; bottom: 0; left: 0; right: 0; }
.page-footer.styled .hf-container { padding-top: 1px; border-top: 1px solid var(--footerHeaderBorderColor); }
.page-footer .hf-container > div { flex: 1; white-space: nowrap; overflow: hidden; }
.page-footer .footer-content-left { text-align: left; margin-right: 14px; }
.page-footer .footer-content { text-align: center; }
.page-footer .footer-content-right { text-align: right; margin-left: 14px; }
.page-footer.single .footer-content-left,
.page-footer.single .footer-content-right { display: none; }
`

const HF_TABLE_START = '<table class="page-container">'
const HF_TABLE_END = '</table>'
const HF_TABLE_FOOTER = `<tfoot class="page-footer-fake"><tr><td>
  <div class="hf-container">&nbsp;</div>
</td></tr></tfoot>`

const styledClass = (value: boolean | undefined): string => {
  if (value === undefined) return ''
  return value ? ' styled' : ' simple'
}

const createTableHeader = (header: HeaderFooterPart, headerFooterStyled?: boolean): string => {
  const { type, left = '', center = '', right = '' } = header
  const headerClass = (type === 1 ? 'single' : '') + styledClass(headerFooterStyled)
  return `<thead class="page-header ${headerClass}"><tr><th>
  <div class="hf-container">
    <div class="header-content-left">${left}</div>
    <div class="header-content">${center}</div>
    <div class="header-content-right">${right}</div>
  </div>
</th></tr></thead>`
}

const createRealFooter = (footer: HeaderFooterPart, headerFooterStyled?: boolean): string => {
  const { type, left = '', center = '', right = '' } = footer
  const footerClass = (type === 1 ? 'single' : '') + styledClass(headerFooterStyled)
  return `<div class="page-footer ${footerClass}">
  <div class="hf-container">
    <div class="footer-content-left">${left}</div>
    <div class="footer-content">${center}</div>
    <div class="footer-content-right">${right}</div>
  </div>
</div>`
}

const createTableBody = (article: string): string =>
  `<tbody><tr><td>
  <div class="main-container">
    ${article}
  </div>
</td></tr></tbody>`

const TOC_REG = /^ {0,3}\[TOC\] *$/im

const EDITOR_ARTICLE_RE = /<article class="export-editor-document">([\s\S]*)<\/article>/
const MARKDOWN_ARTICLE_RE = /<article class="markdown-body">([\s\S]*)<\/article>/

const canExportEditorDom = (muya: Muya | null | undefined): muya is Muya => {
  const domNode = muya?.editor?.scrollPage?.domNode
  return !!domNode && domNode.nodeType === 1
}

const injectTocIntoArticle = (article: string, toc: string, markdown: string): string => {
  if (!toc) return article

  if (/<p>\s*\[TOC\]\s*<\/p>/i.test(article)) {
    return article.replace(/<p>\s*\[TOC\]\s*<\/p>/i, toc)
  }
  if (/<p[^>]*>[\s\S]*?\[TOC\][\s\S]*?<\/p>/i.test(article)) {
    return article.replace(/<p[^>]*>[\s\S]*?\[TOC\][\s\S]*?<\/p>/i, toc)
  }
  if (TOC_REG.test(markdown)) {
    return article.replace(TOC_REG, toc)
  }
  return article
}

/**
 * Build a styled, standalone HTML document. Uses the live editor DOM when a Muya
 * instance with a mounted scroll page is available; otherwise falls back to
 * markdown re-render (tests / headless).
 */
export const exportStyledHTML = async(
  muya: Muya,
  markdown: string,
  options: ExportStyledHtmlOptions = {}
): Promise<string> => {
  const { title = '', toc = '', header, footer, headerFooterStyled, contentWidth, maxTableWidth } = options
  let { extraCss = '' } = options

  const appendHeaderFooter = !!header || !!footer
  if (appendHeaderFooter) {
    extraCss = extraCss ? HEADER_FOOTER_CSS + extraCss : HEADER_FOOTER_CSS
  }

  const fullDoc = canExportEditorDom(muya)
    ? new EditorToHtml(muya).generate({
        title,
        extraCSS: extraCss,
        contentWidth,
        maxTableWidth
      })
    : await new MarkdownToHtml(markdown, muya).generate({
        title,
        extraCSS: extraCss,
        contentWidth,
        maxTableWidth
      })

  const articleMatch = EDITOR_ARTICLE_RE.exec(fullDoc) ?? MARKDOWN_ARTICLE_RE.exec(fullDoc)
  let article = articleMatch ? articleMatch[1] : fullDoc
  article = injectTocIntoArticle(article, toc, markdown)

  const articleShell = EDITOR_ARTICLE_RE.test(fullDoc)
    ? `<article class="export-editor-document">${article}</article>`
    : `<article class="markdown-body">${article}</article>`

  let bodyHtml: string
  if (!appendHeaderFooter) {
    bodyHtml = articleShell
  } else {
    let output = HF_TABLE_START
    if (header) output += createTableHeader(header, headerFooterStyled)
    if (footer) {
      output += HF_TABLE_FOOTER
      output = createRealFooter(footer, headerFooterStyled) + output
    }
    output += createTableBody(articleShell)
    output += HF_TABLE_END
    bodyHtml = sanitize(output, EXPORT_DOMPURIFY_CONFIG) as string
  }

  return fullDoc.replace(/<body>[\s\S]*<\/body>/, `<body>\n  ${bodyHtml}\n</body>`)
}
