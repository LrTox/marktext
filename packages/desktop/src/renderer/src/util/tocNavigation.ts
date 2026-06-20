// 将侧边栏 TOC 条目（slug）映射到编辑器 DOM 中对应的标题元素，供调用方滚动定位。
//
// `@muyajs/core` 的 slug 是稳定的 per-block id，不会写入标题 DOM，因此 `#slug` 选择器无法匹配。
// `getTOC` 按文档顺序枚举标题，故将 slug 解析为其在列表中的索引，再取 DOM 中同索引的标题。
//
// DOM 查询必须与 `getTOC` 枚举的集合完全一致。`getTOC` 仅遍历顶层 `scrollPage` 子块（不递归），
// 这些块是 scrollPage 根元素（`.mu-container`）的直接子节点。
// 宿主传入的滚动容器（`getScrollContainer()`，即 muya 根 `.mu-editor`）包裹 `.mu-container` ——
// 标题在其下一层 —— 因此锚点为 `.mu-container > hN`，而非滚动容器自身的直接子节点。
// 嵌套在 blockquote / 列表项中的标题，或 raw-HTML 块内的 `<h1>`–`<h6>`，并非 `.mu-container` 的直接子节点；
// 无范围的 `querySelectorAll('h1..h6')` 会把它们计入并导致后续索引偏移，滚动到错误标题。
export const TOP_LEVEL_HEADINGS_SELECTOR =
  '.mu-container > h1, .mu-container > h2, .mu-container > h3, .mu-container > h4, .mu-container > h5, .mu-container > h6'

export const resolveTocHeadingElement = (
  container: Element,
  listToc: ReadonlyArray<{ slug?: unknown }>,
  slug: unknown
): Element | null => {
  const index = listToc.findIndex((item) => item.slug === slug)
  if (index < 0) return null
  const headings = container.querySelectorAll(TOP_LEVEL_HEADINGS_SELECTOR)
  return headings[index] ?? null
}
