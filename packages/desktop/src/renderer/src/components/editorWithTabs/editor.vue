<template>
  <div
    class="editor-wrapper"
    :class="[{ typewriter: typewriter, focus: focus, source: sourceCode }]"
    :style="{
      lineHeight: lineHeight,
      fontSize: `${fontSize}px`,
      'font-family': editorFontFamily
        ? `${editorFontFamily}, ${defaultFontFamily}`
        : `${defaultFontFamily}`
    }"
    :dir="textDirection"
  >
    <div
      ref="editorRef"
      class="editor-component"
    />
    <div
      v-show="imageViewerVisible"
      class="image-viewer"
    >
      <span
        class="icon-close"
        @click="setImageViewerVisible(false)"
      >
        <CloseIcon />
      </span>
      <div ref="imageViewerRef" />
    </div>
    <el-dialog
      v-model="dialogTableVisible"
      :show-close="isShowClose"
      :modal="true"
      class="ag-insert-table-dialog"
      width="454px"
      center
      dir="ltr"
    >
      <template #title>
        <div class="dialog-title">
          {{ t('editor.insertTable.title') }}
        </div>
      </template>
      <el-form
        :model="tableChecker"
        :inline="true"
      >
        <el-form-item :label="t('editor.insertTable.rows')">
          <el-input-number
            ref="rowInput"
            v-model="tableChecker.rows"
            size="small"
            controls-position="right"
            :min="1"
            :max="30"
          />
        </el-form-item>
        <el-form-item :label="t('editor.insertTable.columns')">
          <el-input-number
            v-model="tableChecker.columns"
            size="small"
            controls-position="right"
            :min="1"
            :max="20"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="dialogTableVisible = false">
            {{ t('common.cancel') }}
          </el-button>
          <el-button
            type="primary"
            @click="handleDialogTableConfirm"
          >
            {{ t('common.ok') }}
          </el-button>
        </div>
      </template>
    </el-dialog>
    <editor-search v-if="!sourceCode" />
  </div>
</template>

<script setup lang="ts">
/**
 * 桌面端 WYSIWYG 编辑器宿主组件。
 * 挂载 @muyajs/core 引擎、注册 UI 插件、桥接 Pinia/bus 与引擎事件；
 * 负责导出（styledHtml/PDF/print）、打印服务集成及合成历史（保存脏状态追踪）。
 */
import { ref, reactive, watch, onMounted, onBeforeUnmount, nextTick, markRaw } from 'vue'
import log from 'electron-log'
import {
  Muya,
  CodeBlockLanguageSelector,
  EmojiSelector,
  FootnoteTool,
  ImageEditTool,
  ImagePathPicker,
  ImageResizeBar,
  ImageToolBar,
  InlineFormatToolbar,
  LinkTools,
  ParagraphFrontButton,
  ParagraphFrontMenu,
  ParagraphQuickInsertMenu,
  PreviewToolBar,
  TableChessboard,
  TableColumnToolbar,
  TableDragBar,
  TableRowColumMenu,
  wordCount as muyaWordCount,
  en,
  de,
  es,
  fr,
  ja,
  ko,
  pt,
  tr,
  zhCN,
  zhTW,
  type ILocale
} from '@muyajs/core'
import { exportStyledHTML, type HeaderFooterPart } from '@/util/exportHtml'
import { applyCursor, isIndexCursor } from '@/util/cursor'
import EditorSearch from '../search/index.vue'
import bus from '@/bus'
import { DEFAULT_EDITOR_FONT_FAMILY } from '@/config'
import notice from '@/services/notification'
import Printer from '@/services/printService'
import { SpellcheckerLanguageCommand } from '@/commands'
import { SpellChecker } from '@/spellchecker'
import { isOsx, animatedScrollTo } from '@/util'
import { moveImageToFolder, uploadImage } from '@/util/fileSystem'
import { guessClipboardFilePath } from '@/util/clipboard'
import { getCssForOptions, getHtmlToc, buildExportCssOptions, type HtmlTocOptions } from '@/util/pdf'
import { resolveExportContentWidthPx, resolvePrintableWidthPx } from '@/util/editorExportStyle'
import { resolveTocHeadingElement } from '@/util/tocNavigation'
import { addCommonStyle, setEditorWidth, setWrapCodeBlocks } from '@/util/theme'
import { usePreferencesStore } from '@/store/preferences'
import { useEditorStore } from '@/store/editor'
import { useProjectStore } from '@/store/project'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { SyntheticHistory, type IFileHistoryLike } from './syntheticHistory'

// 导入引擎入口会自动注入编辑器 CSS（muya.ts 在加载时引入样式表）。
// 桌面主题仍针对遗留 `ag-*` DOM（主题迁移为独立阶段），与新版 `mu-*` DOM 存在轻微视觉差异属预期。
import '@muyajs/core'
import '@/assets/themes/codemirror/one-dark.css'
import { Close as CloseIcon } from '@element-plus/icons-vue'
import { type InputNumberInstance } from 'element-plus'

const { t } = useI18n()
const STANDAR_Y = 320

// 将桌面语言偏好映射到引擎内置 locale 对象。
const MUYA_LOCALES: Record<string, ILocale> = {
  en,
  de,
  es,
  fr,
  ja,
  ko,
  pt,
  tr,
  'zh-CN': zhCN,
  'zh-TW': zhTW
}

const getMuyaLocale = (language: string): ILocale => MUYA_LOCALES[language] ?? zhCN

// `Muya.use(...)` 会追加到静态 `Muya.plugins` 数组，每次 `init()` 都会实例化完整列表。
// 注册为进程级全局，故用模块级标志守卫——否则同一 renderer 内重挂载（窗口复用/HMR）
// 会重复注册插件并产生重复 UI 处理器。各插件 option 闭包（imageAction/jumpClick）
// 仅读取应用单例 Pinia store，捕获一次即可。
let muyaPluginsRegistered = false

// `@muyajs/core` 的 `Muya` 表面刻意宽松（muya-core.d.ts 中为 `[key: string]: any`）；
// 跨越编辑器边界的调用均依赖此类型，在引擎提供内置类型前实例句柄保持 `any`。
type MuyaInstance = any

// 引擎 `selection-change` / `json-change` 载荷。消费中的 `@muyajs/core` 声明未导出此形状，
// 故在此描述桌面端读取的字段（正文内会再转型）；索引签名保持边界对未枚举字段的宽松性。
interface MuyaChange {
  anchorPath?: Array<string | number>
  focusPath?: Array<string | number>
  anchorBlock?: { text?: string } | null
  focusBlock?: { text?: string } | null
  anchorBlockInfo?: { type?: string; functionType?: string } | null
  focusBlockInfo?: { type?: string; functionType?: string } | null
  affiliation?: EngineAffiliationEntry[]
  anchor?: { offset?: number } | null
  focus?: { offset?: number } | null
  cursorCoords?: { y?: number } | null
  formats?: SelectionFormatLike[]
  [key: string]: unknown
}

const props = defineProps<{
  markdown?: string
  cursor?: unknown
  textDirection: string
  platform?: string
}>()

// 获取 store
const preferencesStore = usePreferencesStore()
const editorStore = useEditorStore()
const projectStore = useProjectStore()

// 用 storeToRefs 从 store 提取响应式属性
const {
  // 偏好设置
  preferLooseListItem,
  autoPairBracket,
  autoPairMarkdownSyntax,
  autoPairQuote,
  bulletListMarker,
  orderListDelimiter,
  tabSize,
  listIndentation,
  frontmatterType,
  superSubScript,
  footnote,
  isHtmlEnabled,
  isGitlabCompatibilityEnabled,
  lineHeight,
  fontSize,
  codeFontSize,
  codeFontFamily,
  codeBlockLineNumbers,
  trimUnnecessaryCodeBlockEmptyLines,
  editorFontFamily,
  hideQuickInsertHint,
  hideLinkPopup,
  autoCheck,
  editorLineWidth,
  wrapCodeBlocks,
  imageInsertAction,
  imagePreferRelativeDirectory,
  imageRelativeDirectoryBase,
  imageRelativeDirectoryName,
  imageFolderPath,
  theme,
  sequenceTheme,
  hideScrollbar,
  spellcheckerEnabled,
  spellcheckerNoUnderline,
  spellcheckerLanguage,
  language,

  // 编辑模式
  typewriter,
  focus,
  sourceCode
} = storeToRefs(preferencesStore)

// 编辑器 store 引用
const { currentFile, tabs } = storeToRefs(editorStore)

// 项目 store 引用
const { projectTree } = storeToRefs(projectStore)

// 组件状态
const defaultFontFamily = DEFAULT_EDITOR_FONT_FAMILY
const selectionChange = ref<unknown>(null)
const editor = ref<MuyaInstance>(null)
const isShowClose = ref(false)
const dialogTableVisible = ref(false)
const imageViewerVisible = ref<boolean | null>(null)
const tableChecker = reactive({
  rows: 4,
  columns: 3
})

// 模板 ref
const editorRef = ref<HTMLDivElement | null>(null)
const imageViewerRef = ref<HTMLDivElement | null>(null)
const rowInput = ref<InputNumberInstance | null>(null)

// 非响应式变量
let printer: Printer | null = null
let spellchecker: any = null
let switchLanguageCommand: SpellcheckerLanguageCommand | null = null
let imageViewer: SimpleImageViewer | null = null
// 引擎无 `scroll` 事件；直接在滚动容器上监听。
let scrollHandler: ((e: Event) => void) | null = null

// 引擎 undo/redo 历史（`getHistory()`）与桌面 store 的 `tab.history`（保存/脏状态追踪，单独迁移）形状不同。
// 故在此按标签页保存真实引擎历史以供会话内切换恢复，并向 store 提供合成（桌面形状）历史。
const engineHistoryByTab = new Map<string, unknown>()

// 用户切入源码模式瞬间捕获的 WYSIWYG 光标。
// 源码模式期间焦点在 CodeMirror，标签页交还时（`replaceContent`）实时 DOM 选区已不在 muya 树内。
// 在此暂存进入源码前的光标，作为 `replaceContent` 重建边界的 restore-selection，
// 使交还后首次 undo 将光标恢复到进入源码模式时的位置。
let preSourceModeSelection: unknown = null

// 按标签页的单调保存追踪 id 分配器。合成历史条目 id 为基于实时文档内容的单调、永不复用 id
// （见 `syntheticHistory.ts`），而非引擎 undo 栈深度：深度在同一栈高会被不同文档复用，
// 导致明显重新编辑过的标签页被误判为干净（Phase G — G6）。
// 引擎经 `setContent` 重载文档（会清空引擎历史）时重置，使重载内容成为 id-0 基线，
// 与 store 种下的 `lastSavedHistoryId: 0` 一致。
const syntheticHistoryByTab = new Map<string, SyntheticHistory>()
const getSyntheticHistory = (id: string, baselineContent: string): SyntheticHistory => {
  let tracker = syntheticHistoryByTab.get(id)
  if (!tracker) {
    tracker = new SyntheticHistory(baselineContent)
    syntheticHistoryByTab.set(id, tracker)
  }
  return tracker
}
// 将标签页的 id 分配器按给定内容重新设为基线（id 0）。`setContent` 重载文档后调用，使新加载内容视为干净。
const resetSyntheticHistory = (id: string, baselineContent: string): void => {
  syntheticHistoryByTab.set(id, new SyntheticHistory(baselineContent))
}
const makeSyntheticHistory = (id: string, content: string): IFileHistoryLike => {
  return getSyntheticHistory(id, content).build(content)
}
// 清理已关闭标签页的 per-tab 簿记。标签 id 在会话内唯一，不修剪则这些 map
// （及每个 `SyntheticHistory` 的 content→id map）会随开关标签无限增长。
// 由对 store 活跃标签 id 集合的 watcher 驱动。
const pruneClosedTabState = (liveTabIds: Set<string>): void => {
  for (const id of engineHistoryByTab.keys()) {
    if (!liveTabIds.has(id)) engineHistoryByTab.delete(id)
  }
  for (const id of syntheticHistoryByTab.keys()) {
    if (!liveTabIds.has(id)) syntheticHistoryByTab.delete(id)
  }
}

interface SelectionFormatLike {
  type: string
  [key: string]: unknown
}

// 容器 `blockName` → 遗留 `functionType`。引擎 affiliation 条目带 `blockName` 但无遗留 `functionType`，
// 而桌面菜单状态构建器对 `pre`/`figure` 容器（表格检测与格式菜单禁用）依赖后者。
// 在此重新推导，使 `createApplicationMenuState` 现有 `pre`/`figure` 分支生效。
// `code$` / `multiplemath` / `frontmatter` / `html` / `table` 值与遗留 muyajs 词汇一致
// （`createApplicationMenuState` 的 `/frontmatter|html|multiplemath|code$/` 测试与 `=== 'table'` 检查）。
const CONTAINER_FUNCTION_TYPE: Record<string, string> = {
  'code-block': 'fencecode',
  frontmatter: 'frontmatter',
  table: 'table',
  'html-block': 'html',
  'math-block': 'multiplemath',
  diagram: 'diagram'
}

interface EngineAffiliationEntry {
  type: string
  blockName: string
  listType?: string
  listItemType?: string
  isLooseListItem?: boolean
  [key: string]: unknown
}

// 引擎 `selection-change` 载荷（自 #4410）携带 `affiliation` 链（共享祖先段落类型块，由外向内）
// 及端点 `anchorBlockInfo`/`focusBlockInfo`（内容叶节点：`type: 'span'` + `functionType`），
// 及实时 `anchorBlock`/`focusBlock` 引用（含 `.text`）。
// 桌面应用菜单状态构建器（`createApplicationMenuState`）与 `SELECTION_CHANGE` 中选中文本推导
// 针对遗留 `{ start, end, affiliation }` 形状编写，故将新载荷映射为：
//   - `start.type`/`end.type` 取自叶信息（`'span'`）以触发 `start.type === 'span'` 守卫，
//   - `start.block.functionType`/`end.block.functionType` 取自叶信息以点亮代码内容/表格单元检测，
//   - `start.block.text`/`end.block.text` 取自实时块以便 store 仍可切片选中文本（`SELECTION_CHANGE` → 搜索预填），
//   - `affiliation` 原样透传（条目已含 `type` 与 `listType`/`listItemType`/`isLooseListItem`），
//     并在 `pre`/`figure` 容器上补充推导的 `functionType` 供表格/代码围栏键使用。
const adaptSelectionChange = (changes: MuyaChange) => {
  const anchorPath = (changes.anchorPath ?? []) as Array<string | number>
  const focusPath = (changes.focusPath ?? anchorPath) as Array<string | number>
  const anchorBlock = changes.anchorBlock as { text?: string } | null | undefined
  const focusBlock = changes.focusBlock as { text?: string } | null | undefined
  const anchorInfo = changes.anchorBlockInfo as
    | { type?: string; functionType?: string }
    | null
    | undefined
  const focusInfo = changes.focusBlockInfo as
    | { type?: string; functionType?: string }
    | null
    | undefined
  const rawAffiliation = (changes.affiliation ?? []) as EngineAffiliationEntry[]
  const affiliation = rawAffiliation.map((entry) => {
    const functionType =
      entry.type === 'pre' || entry.type === 'figure'
        ? CONTAINER_FUNCTION_TYPE[entry.blockName]
        : undefined
    return functionType ? { ...entry, functionType } : entry
  })
  return {
    start: {
      key: anchorPath.join('/'),
      offset: (changes.anchor?.offset ?? 0) as number,
      block: { text: anchorBlock?.text, functionType: anchorInfo?.functionType },
      type: anchorInfo?.type
    },
    end: {
      key: focusPath.join('/'),
      offset: (changes.focus?.offset ?? 0) as number,
      block: { text: focusBlock?.text, functionType: focusInfo?.functionType },
      type: focusInfo?.type
    },
    affiliation
  }
}

// 从引擎选区构建可 JSON 序列化的光标（去掉实时块引用以经受缓冲状态往返）。`setCursor` 从 `anchorPath`/`focusPath` 重新解析目标块。
const serializeCursor = (
  selection: {
    anchor?: { offset: number }
    focus?: { offset: number }
    anchorPath?: Array<string | number>
    focusPath?: Array<string | number>
  } | null
) => {
  if (!selection) return null
  return {
    anchor: selection.anchor ? { offset: selection.anchor.offset } : null,
    focus: selection.focus ? { offset: selection.focus.offset } : null,
    anchorPath: selection.anchorPath,
    focusPath: selection.focusPath
  }
}

class SimpleImageViewer {
  container: HTMLElement
  scale: number
  translateX: number
  translateY: number
  isDragging: boolean
  startX: number
  startY: number
  img!: HTMLImageElement
  _onWheel!: (e: WheelEvent) => void
  _onMousedown!: (e: MouseEvent) => void
  _onMousemove!: (e: MouseEvent) => void
  _onMouseup!: () => void

  constructor (container: HTMLElement, { url }: { url: string }) {
    this.container = container
    this.scale = 1
    this.translateX = 0
    this.translateY = 0
    this.isDragging = false
    this.startX = 0
    this.startY = 0
    this._init(url)
  }

  _init (url: string) {
    this.container.innerHTML = ''
    this.img = document.createElement('img')
    this.img.src = url
    this.img.style.cssText =
      'max-width:90vw;max-height:90vh;object-fit:contain;transform-origin:center center;user-select:none;display:block;'
    this.img.draggable = false
    this.container.appendChild(this.img)
    this._bindEvents()
  }

  _updateTransform () {
    this.img.style.transform = `translate(${this.translateX}px,${this.translateY}px) scale(${this.scale})`
  }

  _bindEvents () {
    this._onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const factor = e.deltaY < 0 ? 1.1 : 0.9
      this.scale = Math.max(0.1, Math.min(10, this.scale * factor))
      this._updateTransform()
    }
    this._onMousedown = (e: MouseEvent) => {
      if (e.button !== 0) return
      this.isDragging = true
      this.startX = e.clientX - this.translateX
      this.startY = e.clientY - this.translateY
      this.container.style.cursor = 'grabbing'
      e.preventDefault()
    }
    this._onMousemove = (e: MouseEvent) => {
      if (!this.isDragging) return
      this.translateX = e.clientX - this.startX
      this.translateY = e.clientY - this.startY
      this._updateTransform()
    }
    this._onMouseup = () => {
      this.isDragging = false
      this.container.style.cursor = 'grab'
    }
    this.container.addEventListener('wheel', this._onWheel, { passive: false })
    this.container.addEventListener('mousedown', this._onMousedown)
    document.addEventListener('mousemove', this._onMousemove)
    document.addEventListener('mouseup', this._onMouseup)
  }

  destroy () {
    this.container.removeEventListener('wheel', this._onWheel)
    this.container.removeEventListener('mousedown', this._onMousedown)
    document.removeEventListener('mousemove', this._onMousemove)
    document.removeEventListener('mouseup', this._onMouseup)
    this.container.innerHTML = ''
  }
}

// 侦听器
// 标签关闭时修剪 per-tab 引擎/合成历史簿记，避免 map（及其 content→id map）在长会话中累积陈旧条目。
// 监听 id 集合开销低——仅在标签增删时触发。
watch(
  () => tabs.value.map((t) => t.id),
  (ids) => {
    pruneClosedTabState(new Set(ids))
  }
)

watch(typewriter, (value) => {
  if (value) {
    scrollToCursor()
  }
})

watch(focus, (value) => {
  if (editor.value) {
    editor.value.setFocusMode(value)
  }
})

watch(fontSize, (value, oldValue) => {
  if (value !== oldValue && editor.value) {
    editor.value.setFont({ fontSize: value })
  }
})

watch(lineHeight, (value, oldValue) => {
  if (value !== oldValue && editor.value) {
    editor.value.setFont({ lineHeight: value })
  }
})

watch(preferLooseListItem, (value, oldValue) => {
  if (value !== oldValue && editor.value) {
    editor.value.setOptions({
      preferLooseListItem: value
    })
  }
})

watch(tabSize, (value, oldValue) => {
  if (value !== oldValue && editor.value) {
    editor.value.setTabSize(value)
  }
})

watch(theme, (value, oldValue) => {
  if (value !== oldValue && editor.value) {
    // 约定：任意 dark 系列主题需包含 dark `word`。
    if (/dark/i.test(value)) {
      editor.value.setOptions(
        {
          mermaidTheme: 'dark',
          vegaTheme: 'dark'
        },
        true
      )
    } else {
      editor.value.setOptions(
        {
          mermaidTheme: 'default',
          vegaTheme: 'latimes'
        },
        true
      )
    }
  }
})

watch(sequenceTheme, (value, oldValue) => {
  if (value !== oldValue && editor.value) {
    editor.value.setOptions({ sequenceTheme: value }, true)
  }
})

watch(() => preferencesStore.plantumlServer, (value, oldValue) => {
  if (value !== oldValue && editor.value) {
    editor.value.setOptions({ plantumlServer: value }, true)
  }
})

watch(listIndentation, (value, oldValue) => {
  if (value !== oldValue && editor.value) {
    editor.value.setListIndentation(value)
  }
})

watch(frontmatterType, (value, oldValue) => {
  if (value !== oldValue && editor.value) {
    editor.value.setOptions({ frontmatterType: value })
  }
})

watch(superSubScript, (value, oldValue) => {
  if (value !== oldValue && editor.value) {
    editor.value.setOptions({ superSubScript: value }, true)
  }
})

watch(footnote, (value, oldValue) => {
  if (value !== oldValue && editor.value) {
    editor.value.setOptions({ footnote: value }, true)
  }
})

watch(isHtmlEnabled, (value, oldValue) => {
  if (value !== oldValue && editor.value) {
    editor.value.setOptions({ disableHtml: !value }, true)
  }
})

watch(isGitlabCompatibilityEnabled, (value, oldValue) => {
  if (value !== oldValue && editor.value) {
    editor.value.setOptions({ isGitlabCompatibilityEnabled: value }, true)
  }
})

watch(hideQuickInsertHint, (value, oldValue) => {
  if (value !== oldValue && editor.value) {
    editor.value.setOptions({ hideQuickInsertHint: value })
  }
})

watch(editorLineWidth, (value, oldValue) => {
  if (value !== oldValue) {
    setEditorWidth(value)
  }
})

watch(wrapCodeBlocks, (value, oldValue) => {
  if (value !== oldValue) {
    setWrapCodeBlocks(value)
  }
})

watch(autoPairBracket, (value, oldValue) => {
  if (value !== oldValue && editor.value) {
    editor.value.setOptions({ autoPairBracket: value })
  }
})

watch(autoPairMarkdownSyntax, (value, oldValue) => {
  if (value !== oldValue && editor.value) {
    editor.value.setOptions({ autoPairMarkdownSyntax: value })
  }
})

watch(autoPairQuote, (value, oldValue) => {
  if (value !== oldValue && editor.value) {
    editor.value.setOptions({ autoPairQuote: value })
  }
})

watch(trimUnnecessaryCodeBlockEmptyLines, (value, oldValue) => {
  if (value !== oldValue && editor.value) {
    editor.value.setOptions({ trimUnnecessaryCodeBlockEmptyLines: value })
  }
})

watch(bulletListMarker, (value, oldValue) => {
  if (value !== oldValue && editor.value) {
    editor.value.setOptions({ bulletListMarker: value })
  }
})

watch(orderListDelimiter, (value, oldValue) => {
  if (value !== oldValue && editor.value) {
    editor.value.setOptions({ orderListDelimiter: value })
  }
})

watch(hideLinkPopup, (value, oldValue) => {
  if (value !== oldValue && editor.value) {
    editor.value.setOptions({ hideLinkPopup: value })
  }
})

watch(autoCheck, (value, oldValue) => {
  if (value !== oldValue && editor.value) {
    editor.value.setOptions({ autoCheck: value })
  }
})

watch(codeFontSize, (value, oldValue) => {
  if (value !== oldValue) {
    addCommonStyle({
      codeFontSize: value,
      codeFontFamily: codeFontFamily.value,
      hideScrollbar: hideScrollbar.value
    })
  }
})

watch(codeBlockLineNumbers, (value, oldValue) => {
  if (value !== oldValue && editor.value) {
    editor.value.setOptions({ codeBlockLineNumbers: value }, true)
  }
})

watch(codeFontFamily, (value, oldValue) => {
  if (value !== oldValue) {
    addCommonStyle({
      codeFontSize: codeFontSize.value,
      codeFontFamily: value,
      hideScrollbar: hideScrollbar.value
    })
  }
})

watch(hideScrollbar, (value, oldValue) => {
  if (value !== oldValue) {
    addCommonStyle({
      codeFontSize: codeFontSize.value,
      codeFontFamily: codeFontFamily.value,
      hideScrollbar: value
    })
  }
})

watch(spellcheckerEnabled, (value, oldValue) => {
  if (value !== oldValue) {
    // 设置 Muya 拼写检查容器属性。
    editor.value.setOptions({ spellcheckEnabled: value })

    // 禁用原生拼写检查器
    if (value) {
      spellchecker.activateSpellchecker(spellcheckerLanguage.value)
    } else {
      spellchecker.deactivateSpellchecker()
    }
  }
})

watch(spellcheckerNoUnderline, (value, oldValue) => {
  if (value !== oldValue) {
    // 设置 Muya 拼写检查容器属性。
    editor.value.setOptions({ spellcheckEnabled: !value })
  }
})

watch(spellcheckerLanguage, (value, oldValue) => {
  if (value !== oldValue) {
    spellchecker.lang = value
  }
})

watch(currentFile, (value, oldValue) => {
  if (value && value !== oldValue) {
    scrollToCursor(0)
    // 按需隐藏浮动工具。
    if (editor.value) {
      editor.value.hideAllFloatTools()
    }
  }
})

watch(
  sourceCode,
  (value, oldValue) => {
    if (value && value !== oldValue) {
      if (editor.value) {
        editor.value.hideAllFloatTools()
        // 仅在进入源码模式时即时计算 WYSIWYG 光标为源码 markdown `{ line, ch }` 索引光标（Phase G — G7），
        // 并在 sourceCode.vue 挂载前写入标签（`flush: 'sync'` 保证子组件 onMounted 读取
        // `props.muyaIndexCursor` 前已更新）。此为 `setCursorByOffset` 源码→WYSIWYG 路径的逆操作。
        // 在此计算而非每次 json-change/selection-change 计算，避免每次击键/移动光标时序列化整篇文档，并保证值新鲜。
        if (currentFile.value) {
          currentFile.value.muyaIndexCursor = editor.value.getCursorOffset() ?? null
        }
        // 同时捕获块键光标（与 getCursorOffset 读取的同一新鲜选区），供交还后 undo 恢复——见 `preSourceModeSelection`。
        preSourceModeSelection = editor.value.getSelection()
      }
    }
  },
  { flush: 'sync' }
)

// 方法
const jumpClick = (linkInfo: { href: string }) => {
  const { href } = linkInfo
  editorStore.FORMAT_LINK_CLICK({ data: { href }, dirname: window.DIRNAME })
}

interface ImagePathSuggestion {
  type: 'directory' | 'file' | string
  file: string
  [key: string]: unknown
}

const imagePathAutoComplete = async (src: string) => {
  const files = (await editorStore.ASK_FOR_IMAGE_AUTO_PATH(src)) as unknown as ImagePathSuggestion[]
  return files.map((f) => {
    const iconClass = f.type === 'directory' ? 'icon-folder' : 'icon-image'
    return Object.assign(f, { iconClass, text: f.file + (f.type === 'directory' ? '/' : '') })
  })
}

const imageAction = async (
  image: string | File,
  id: string | null,
  alt: string = ''
): Promise<string> => {
  // TODO(Refactor): 重构此方法。
  if (!currentFile.value) return ''
  const { filename, pathname: currentPathname } = currentFile.value

  // 确定当前工作目录。
  // 相对文件保存图片；否则在项目根可用时使用项目根。
  const isTabSavedOnDisk = !!currentPathname
  let relativeBasePath: string | null = isTabSavedOnDisk
    ? window.path.dirname(currentPathname)
    : null
  if (isTabSavedOnDisk && imageRelativeDirectoryBase.value !== 'file' && projectTree.value) {
    const { pathname: rootPath } = projectTree.value as { pathname?: string }
    if (rootPath && window.fileUtils.isChildOfDirectory(rootPath, currentPathname)) {
      // 相对根目录保存资源。
      relativeBasePath = rootPath
    }
  }

  const getResolvedImagePath = (imagePath: string) => {
    const replacement = isTabSavedOnDisk
      ? filename.replace(/\.[^/.]+$/, '') // 不含扩展名的文件名
      : ''
    return imagePath.replace(/\${filename}/g, replacement)
  }

  const resolvedGlobalImageFolderPath = getResolvedImagePath(imageFolderPath.value)
  const resolvedImageRelativeDirectoryName = getResolvedImagePath(imageRelativeDirectoryName.value) // 示例：assets/
  const resolvedImageRelativeFullDirectoryPath = relativeBasePath
    ? window.path.join(relativeBasePath, resolvedImageRelativeDirectoryName)
    : null // 示例：/root/dir/assets
  let destImagePath = ''
  switch (imageInsertAction.value) {
    case 'upload': {
      try {
        // 传入完整 preferences state 对象，避免解引用不存在的 .value
        destImagePath = (await uploadImage(
          currentPathname,
          image,
          preferencesStore.$state as unknown as import('@/util/fileSystem').UploadImagePreferences
        )) as string
      } catch (err) {
        notice.notify({
          title: 'Upload Image',
          type: 'warning',
          message: err as string
        })
        destImagePath = (await moveImageToFolder(
          currentPathname,
          image,
          resolvedGlobalImageFolderPath
        )) as string
      }
      break
    }
    case 'folder': {
      if (isTabSavedOnDisk && imagePreferRelativeDirectory.value) {
        // `image` 可能是路径字符串（粘贴/拖拽/图片选择器）——传入 `currentPathname`，
        // 使 moveImageToFolder 可通过 `path.dirname(pathname)` 解析相对路径，而非在 `dirname(null)` 上崩溃。
        destImagePath = (await moveImageToFolder(
          currentPathname,
          image,
          resolvedImageRelativeFullDirectoryPath as string,
          true,
          currentPathname
        )) as string
      } else {
        destImagePath = (await moveImageToFolder(
          currentPathname,
          image,
          resolvedGlobalImageFolderPath
        )) as string
      }
      break
    }
    case 'path': {
      if (typeof image === 'string') {
        // 输入为本地路径。
        destImagePath = image
      } else {
        // 输入为二进制时保存并移动到图片文件夹。

        // 标签已落盘时尊重用户偏好。
        if (isTabSavedOnDisk && imagePreferRelativeDirectory.value) {
          destImagePath = (await moveImageToFolder(
            null as unknown as string,
            image,
            resolvedImageRelativeFullDirectoryPath as string,
            true,
            currentPathname
          )) as string
        } else {
          destImagePath = (await moveImageToFolder(
            currentPathname,
            image,
            resolvedGlobalImageFolderPath
          )) as string
        }
      }
      break
    }
  }

  if (id && sourceCode.value) {
    bus.emit('image-action', {
      id,
      result: destImagePath,
      alt
    })
  }
  return destImagePath
}

// 将引擎 `imageAction` 契约（`{ src, alt, title }`）适配为桌面 `imageAction(image, id, alt)`。
// 引擎处理单次行内图片编辑（无 `id` 往返/源码模式 bus 事件），故 `id` 传 `null`。
const muyaImageAction = (state: { src: string; alt?: string; title?: string }): Promise<string> =>
  imageAction(state.src, null, state.alt ?? '')

const imagePathPicker = () => {
  return editorStore.ASK_FOR_IMAGE_PATH()
}

const keyup = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    setImageViewerVisible(false)
  }
}

const setImageViewerVisible = (status: boolean) => {
  imageViewerVisible.value = status
  if (!status && imageViewer) {
    imageViewer.destroy()
    imageViewer = null
  }
}

const switchSpellcheckLanguage = (languageCode: unknown) => {
  const { isEnabled } = spellchecker

  // 此方法也会从 bus 调用，继续前须校验状态。
  if (!isEnabled) {
    throw new Error(t('editor.spellcheck.disabledError'))
  }

  spellchecker
    .switchLanguage(languageCode)
    .then((langCode: string | null | undefined) => {
      if (!langCode) {
        // 因缺少词典无法切换语言，拼写检查器处于无效状态。
        notice.notify({
          title: t('editor.spellcheck.title'),
          type: 'warning',
          message: t('editor.spellcheck.languageMissing', { languageCode: languageCode as string })
        })
      }
    })
    .catch((error: unknown) => {
      log.error(
        t('editor.spellcheck.errorSwitchingLanguage', { languageCode: languageCode as string })
      )
      log.error(error)

      const errMsg = (error as { message?: string } | null | undefined)?.message ?? String(error)
      notice.notify({
        title: t('editor.spellcheck.title'),
        type: 'error',
        message: t('editor.spellcheck.switchError', {
          languageCode: languageCode as string,
          error: errMsg
        })
      })
    })
}

const handleInvalidateImageCache = () => {
  if (editor.value) {
    editor.value.invalidateImageCache()
  }
}

const openSpellcheckerLanguageCommand = () => {
  if (!isOsx) {
    bus.emit('show-command-palette', switchLanguageCommand)
  }
}

const replaceMisspelling = (payload: unknown) => {
  const { word, replacement } = payload as { word: string; replacement: string }
  if (editor.value) {
    editor.value.replaceCurrentWordInlineUnsafe(word, replacement)
  }
}

const handleUndo = () => {
  if (editor.value) {
    editor.value.undo()
  }
}

const handleRedo = () => {
  if (editor.value) {
    editor.value.redo()
  }
}

const handleSelectAll = () => {
  if (sourceCode.value) {
    return
  }

  if (editor.value && editor.value.hasFocus()) {
    editor.value.selectAll()
  } else {
    const activeElement = document.activeElement as HTMLElement | null
    const nodeName = activeElement?.nodeName
    if (nodeName === 'INPUT' || nodeName === 'TEXTAREA') {
      const selectable = activeElement as HTMLInputElement | HTMLTextAreaElement | null
      if (selectable && typeof selectable.select === 'function') {
        selectable.select()
      }
    }
  }
}

// 自定义 copyAsRich、copyAsHtml、pasteAsPlainText。
// `copyAsRich` 将渲染 HTML 写入 `text/html`、纯文本写入 `text/plain`，
// 粘贴到 Word/邮件可得富文本格式（`copyAsHtml` 则清空 `text/html` 并将 HTML 源码放入 `text/plain`）。
const COPY_PASTE_METHOD_MAP: Record<string, 'copyAsRich' | 'copyAsHtml' | 'pasteAsPlainText'> = {
  copyAsRich: 'copyAsRich',
  copyAsHtml: 'copyAsHtml',
  pasteAsPlainText: 'pasteAsPlainText'
}
const handleCopyPaste = (type: unknown) => {
  if (editor.value) {
    const method = COPY_PASTE_METHOD_MAP[type as string]
    if (method) editor.value[method]()
  }
}

const insertImage = (src: unknown) => {
  if (!sourceCode.value) {
    editor.value && editor.value.insertImage({ src })
  }
}

// muya 的 search/replace/find 返回实时 Search 实例（循环：Search → muya → … → ScrollPage），
// 每个匹配项带实时 `block` 引用。store 会深克隆（JSON.stringify）载荷，故仅提取搜索 UI 所需的纯 `{ index, matches, value }`。
const toSearchMatches = (result: unknown) => {
  const r = (result ?? {}) as {
    index?: number
    value?: string
    matches?: Array<{ start: number; end: number; match: string }>
  }
  return {
    index: r.index ?? -1,
    matches: (r.matches ?? []).map((m) => ({ start: m.start, end: m.end, match: m.match })),
    value: r.value ?? ''
  }
}

const handleSearch = (payload: unknown) => {
  const { value, opt } = payload as { value: string; opt: unknown }
  editorStore.SEARCH(toSearchMatches(editor.value.search(value, opt)))
  scrollToHighlight()
}

const handReplace = (payload: unknown) => {
  const { value, opt } = payload as { value: string; opt: unknown }
  editorStore.SEARCH(toSearchMatches(editor.value.replace(value, opt)))
}

const handleUploadedImage = (url: unknown, deletionUrl?: unknown) => {
  insertImage(url)
  editorStore.SHOW_IMAGE_DELETION_URL(deletionUrl as string)
}

// `muya.domNode` 为 contenteditable + 滚动容器（继承原挂载点的 `.editor-component` 类与 `overflow:auto`）。
// 遗留引擎将同一元素暴露为 `muya.container`。
const getScrollContainer = (): HTMLElement | null =>
  (editor.value?.domNode as HTMLElement | undefined) ?? null

// 视口相对光标矩形（镜像引擎 `Selection.getCursorCoords` / 遗留 `cursorCoords`）。
// 用于打字机模式与保持光标可见滚动，且不在已提供坐标的 `selection-change` 事件内时。
const getCursorY = (): number | null => {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return null
  const range = sel.getRangeAt(0).cloneRange()
  let rects = range.getClientRects()
  if (rects.length === 0 && range.startContainer) {
    const parent =
      range.startContainer.nodeType === Node.ELEMENT_NODE
        ? (range.startContainer as Element)
        : range.startContainer.parentElement
    rects = parent ? parent.getClientRects() : rects
  }
  return rects.length ? rects[0].y : null
}

const scrollToCursor = (duration = 300) => {
  nextTick(() => {
    const container = getScrollContainer()
    if (!container) return
    const y = getCursorY()
    if (y == null) return
    animatedScrollTo(container, container.scrollTop + y - STANDAR_Y, duration)
  })
}

const scrollToCords = (y: number) => {
  const container = getScrollContainer()
  if (!container) return
  // 视用户先前滚动程度，容器有时尚未完全渲染所有元素，
  // 导致 container.scrollHeight < [已保存的 scrollTop]。
  // 需临时为容器增加 padding，以便设置 scrollTop 时不被钳制。

  const maxScrollHeight = container.scrollHeight - container.clientHeight // 最大滚动高度按此计算
  if (y > maxScrollHeight) {
    const editorId = container.firstElementChild as HTMLElement | null
    if (editorId) {
      editorId.style.paddingBottom = `${y - maxScrollHeight + 100}px` // 100px 为默认编辑器底部 padding
      // 附加 ResizeObserver，在高度“正确”时移除 padding
      resizeObserverForEditor.observe(editorId)
    }
  }
  requestAnimationFrame(() => {
    if (!container) return
    // 等待 padding 生效（若有）
    container.style.visibility = 'visible'
    container.style.pointerEvents = 'auto'
    container.scrollTop = y
  })
}

// 平滑滚动编辑器，使 `anchor` 位于标准顶部偏移。TOC、搜索高亮及其他“揭示元素”调用方共用，
// 将 getBoundingClientRect + animatedScrollTo 计算集中一处。
const scrollElementIntoView = (anchor: Element | null | undefined, duration = 300) => {
  const container = getScrollContainer()
  if (!container || !anchor) return
  const { y } = anchor.getBoundingClientRect()
  animatedScrollTo(container, container.scrollTop + y - STANDAR_Y, duration)
}

const scrollToHighlight = () => {
  return scrollToElement('.mu-highlight')
}

/**
 * 滚动编辑器至 TOC 条目对应标题。slug 仅按文档顺序在顶层标题中解析的原因见 `resolveTocHeadingElement`。
 * @param slug 来自 `scroll-to-header` bus 事件的 TOC 条目 slug。
 */
const scrollToHeader = (slug: unknown) => {
  const container = getScrollContainer()
  if (!container) return
  scrollElementIntoView(resolveTocHeadingElement(container, editorStore.listToc, slug))
}

const scrollToElement = (selector: string) => {
  // 滚动至搜索高亮词
  scrollElementIntoView(document.querySelector(selector))
}

const handleFindAction = (action: unknown) => {
  editorStore.SEARCH(toSearchMatches(editor.value.find(action)))
  scrollToHighlight()
}

interface ExportOptions {
  type: string
  header?: unknown
  footer?: unknown
  headerFooterStyled?: unknown
  htmlTitle?: string
  pageSize?: string
  pageSizeWidth?: number
  pageSizeHeight?: number
  isLandscape?: boolean
  [key: string]: unknown
}

const handleExport = async (options: unknown) => {
  const opts = options as ExportOptions
  const { type, headerFooterStyled, htmlTitle } = opts

  if (!/^pdf|print|styledHtml$/.test(type)) {
    throw new Error(`Invalid type to export: "${type}".`)
  }

  if (!editor.value) {
    notice.notify({
      title: t('editor.export.failed', { type: type.toUpperCase() }),
      type: 'error',
      message: t('editor.export.error')
    })
    return
  }

  try {
    const extraCss = await getCssForOptions(
      buildExportCssOptions(opts as Record<string, unknown>, preferencesStore.$state)
    )
    const htmlToc = getHtmlToc(editor.value.getTOC(), opts as unknown as HtmlTocOptions)
    const markdown = editor.value.getMarkdown()
    const header = (opts.header ?? null) as HeaderFooterPart | null
    const footer = (opts.footer ?? null) as HeaderFooterPart | null
    const contentWidth = resolveExportContentWidthPx(preferencesStore.editorLineWidth)
    const maxTableWidth = type === 'styledHtml' ? undefined : resolvePrintableWidthPx(opts)

    switch (type) {
      case 'styledHtml': {
        try {
          const content = await exportStyledHTML(editor.value, markdown, {
            title: htmlTitle || '',
            printOptimization: false,
            extraCss,
            toc: htmlToc,
            contentWidth,
            maxTableWidth
          })
          editorStore.EXPORT({ type, content })
        } catch (err) {
          log.error('Failed to export document:', err)
          notice.notify({
            title: t('editor.export.failed', { type: htmlTitle || 'html' }),
            type: 'error',
            message:
            (err as { message?: string } | null | undefined)?.message ?? t('editor.export.error')
          })
        }
        break
      }
      case 'pdf': {
      // 注：须通过 Electron 设置页面尺寸。
        try {
          const { pageSize, pageSizeWidth, pageSizeHeight, isLandscape } = opts
          const pageOptions = {
            pageSize,
            pageSizeWidth,
            pageSizeHeight,
            isLandscape
          }

          const html = await exportStyledHTML(editor.value, markdown, {
            title: '',
            printOptimization: true,
            extraCss,
            toc: htmlToc,
            header,
            footer,
            headerFooterStyled: headerFooterStyled as boolean | undefined,
            contentWidth,
            maxTableWidth
          })
          printer!.renderMarkdown(html, true, { contentWidth, maxTableWidth })
          editorStore.EXPORT({ type, pageOptions })
        } catch (err) {
          log.error('Failed to export document:', err)
          notice.notify({
            title: t('editor.export.failed', { type: 'PDF' }),
            type: 'error',
            message: t('editor.export.errorExporting', { type: htmlTitle || 'PDF' })
          })
          handlePrintServiceClearup()
        }
        break
      }
      case 'print': {
      // 注：打印不支持页面尺寸或方向。
        try {
          const html = await exportStyledHTML(editor.value, markdown, {
            title: '',
            printOptimization: true,
            extraCss,
            toc: htmlToc,
            header,
            footer,
            headerFooterStyled: headerFooterStyled as boolean | undefined,
            contentWidth,
            maxTableWidth
          })
          printer!.renderMarkdown(html, true, { contentWidth, maxTableWidth })
          editorStore.PRINT_RESPONSE()
        } catch (err) {
          log.error('Failed to export document:', err)
          notice.notify({
            title: t('editor.print.failed'),
            type: 'error',
            message: t('editor.print.error', { title: htmlTitle || '' })
          })
          handlePrintServiceClearup()
        }
        break
      }
    }
  } catch (err) {
    log.error('Failed to export document:', err)
    notice.notify({
      title: t('editor.export.failed', { type: type.toUpperCase() }),
      type: 'error',
      message:
        (err as { message?: string } | null | undefined)?.message ?? t('editor.export.error')
    })
    handlePrintServiceClearup()
  }
}

const handlePrintServiceClearup = () => {
  printer!.clearup()
}

// 将当前选区推送到应用菜单/工具栏状态。每次 muya selection-change 调用，
// 段落后操作后再调用一次：无操作动作（如列表/引用内的“段落”）不触发 selection-change，
// 否则已点击复选菜单项的 OS 勾选标记会残留。
const pushSelectionMenuState = (changes: MuyaChange) => {
  editorStore.SELECTION_CHANGE({
    ...adaptSelectionChange(changes),
    // 读取实时块树（O(1)），而非 getState()（会深克隆整篇文档）——每次光标移动都会执行。
    hasFrontMatter: editor.value?.editor?.scrollPage?.firstChild?.blockName === 'frontmatter'
  })
  // 活动行内格式随 selection-change 附带——据此驱动格式菜单/工具栏状态。
  editorStore.SELECTION_FORMATS((changes.formats ?? []) as SelectionFormatLike[])
}

const handleEditParagraph = (type: unknown) => {
  if (type === 'table') {
    tableChecker.rows = 4
    tableChecker.columns = 3
    dialogTableVisible.value = true
    nextTick(() => {
      rowInput.value?.focus()
    })
  } else if (editor.value) {
    editor.value.updateParagraph(type)
    // 重新同步菜单，避免无操作动作（如列表/引用内“段落”）使已点击复选项保持勾选。
    // 真实转换会触发自己的 selection-change 并再次同步。
    if (selectionChange.value) {
      pushSelectionMenuState(selectionChange.value as MuyaChange)
    }
  }
}

// 处理 `duplicate`、`delete`、`create paragraph below`
const handleParagraph = (type: unknown) => {
  if (editor.value) {
    switch (type) {
      case 'duplicate': {
        return editor.value.duplicate()
      }
      case 'createParagraph': {
        return editor.value.insertParagraph('after', '', true)
      }
      case 'deleteParagraph': {
        return editor.value.deleteParagraph()
      }
      default:
        console.error(`unknow paragraph edit type: ${type}`)
    }
  }
}

const handleInlineFormat = (type: unknown) => {
  editor.value && editor.value.format(type)
}

const handleDialogTableConfirm = () => {
  dialogTableVisible.value = false
  editor.value && editor.value.createTable(tableChecker)
}

interface FileLoadedPayload {
  id?: string
  markdown?: string
  cursor?: unknown
}

// 监听 `open-single-file` 事件，仅在打开新文件时调用。
const setMarkdownToEditor = (payload: unknown) => {
  const { id, markdown: newMarkdown, cursor: newCursor } = (payload ?? {}) as FileLoadedPayload
  if (editor.value) {
    // `setContent` 重置文档并清空 undo 历史；仅在此之后设置光标（新打开文件无历史可恢复）。
    editor.value.setContent(newMarkdown ?? '')
    // 新加载内容为本标签干净基线（id 0）。重新播种单调保存追踪分配器，使 undo 回此内容再次视为干净
    // （与 store 的 `lastSavedHistoryId: 0` 一致）。
    // 从引擎自身序列化的加载文档播种（非原始载荷），以匹配后续 `json-change` 发出的 markdown——
    // 引擎往返可能规范化尾部换行/空白。
    if (id) {
      resetSyntheticHistory(id, editor.value.getMarkdown())
    }
    if (newCursor) {
      applyCursor(editor.value, newCursor)
      // 文件夹搜索跳转携带索引光标；新打开文件默认滚到顶部，需揭示解析后的光标。
      if (isIndexCursor(newCursor)) {
        scrollToCursor()
      }
    }
    // `setContent` 同步重建块树但不触发 `json-change`，故显式播种 TOC（否则保持空直至首次编辑，切换文件仍显示上一文件 TOC）。
    editorStore.UPDATE_TOC(editor.value.getTOC())
  }
}

interface FileChangePayload {
  id?: string
  markdown?: string
  cursor?: unknown
  renderCursor?: boolean
  history?: unknown
  scrollTop?: number
  muyaIndexCursor?: unknown
  blocks?: unknown
}

// 监听源码模式或切换标签等引起的 markdown 变更
const handleFileChange = (payload: unknown) => {
  const {
    id,
    markdown: newMarkdown,
    cursor: newCursor,
    muyaIndexCursor,
    history: payloadHistory,
    scrollTop
  } = (payload ?? {}) as FileChangePayload
  if (!editor.value) return
  const container = getScrollContainer()
  if (!container) return

  if (typeof newMarkdown === 'string') {
    // 从源码模式返回：源码模式期间 WYSIWYG 引擎从未卸载（index.vue 用 `v-if` 覆盖），
    // 仍持有进入源码前的文档与 undo 历史。经 `replaceContent` 将源码模式批量编辑记录为
    // 单一引擎 undo 边界（PG14 对等）：交还后首次 Ctrl+Z 一步撤销整个源码模式变更，
    // 与遗留 muyajs 全状态快照历史一致。`replaceContent` 构建完全可逆的整文档 ot-json1 op，
    // 经完整块树重建应用 undo/redo（非增量 pick/drop 遍历），任意块类型变更可安全往返。
    //
    // 检测：仅 sourceCode.vue 的 onBeforeUnmount 发出带源码模式索引光标、无块键 `cursor`、
    // 无 `history` 的 `file-changed`（见 sourceCode.vue ~L368）。editor.ts 中每次标签切换/重载
    // 均同时携带 `cursor` 与 `history`，故要求二者缺失可可靠隔离 WYSIWYG←源码交还与
    // 仅重放 `muyaIndexCursor` 的标签激活。
    const isSourceModeHandoff =
      isIndexCursor(muyaIndexCursor) && !newCursor && payloadHistory == null

    if (isSourceModeHandoff) {
      // 将源码模式批量编辑记录为单一 undo 边界。文档未变时为 no-op（返回 false），
      // 历史/内容已匹配——无论哪种情况下方仍需重映射光标。
      editor.value.replaceContent(newMarkdown, preSourceModeSelection)
      preSourceModeSelection = null
      editorStore.UPDATE_TOC(editor.value.getTOC())
      // 将 CodeMirror `{ line, ch }` 光标映射为块键光标，使 WYSIWYG 光标落在源码模式位置（PG2）。
      editor.value.setCursorByOffset(muyaIndexCursor)
    } else {
      // 标签切换/程序化内容交换：`setContent` 替换文档并清空历史，之后恢复 per-tab 保存的真实引擎历史——
      // 保留会话内标签切换的 undo/redo。载荷中的 `history` 为合成桌面形状历史（保存追踪），非引擎历史。
      editor.value.setContent(newMarkdown)
      // 标签切换不触发 `json-change`，故重新播种 TOC（否则返回已打开标签仍显示其他标签 TOC）。
      editorStore.UPDATE_TOC(editor.value.getTOC())
      if (newCursor) {
        applyCursor(editor.value, newCursor)
      } else if (isIndexCursor(muyaIndexCursor)) {
        // 引擎尚无历史的标签的源码模式交还（如加载后首次交互）：回退为仅重映射光标。
        // 引擎内部自行执行 setContent 流程，故之后恢复历史。
        editor.value.setCursorByOffset(muyaIndexCursor)
      }
      const savedEngineHistory = id ? engineHistoryByTab.get(id) : undefined
      if (savedEngineHistory) {
        editor.value.setHistory(savedEngineHistory)
      }
      // 保存追踪分配器首次见到的标签：在任意编辑前用引擎序列化播种干净基线。
      // 已有追踪器的标签为 no-op——切回须保留现有 content→id map。
      if (id) {
        getSyntheticHistory(id, editor.value.getMarkdown())
      }
    }
  } else if (newCursor) {
    applyCursor(editor.value, newCursor)
  }

  if (typeof scrollTop === 'number') {
    container.style.visibility = 'hidden'
    container.style.pointerEvents = 'none'
    scrollToCords(scrollTop)
  } else {
    container.style.visibility = 'visible'
    container.style.pointerEvents = 'auto'
    scrollToCursor(0)
  }
}

const handleInsertParagraph = (location: unknown) => {
  editor.value && editor.value.insertParagraph(location)
}

const blurEditor = () => {
  editor.value?.blur(false, true)
}

const focusEditor = () => {
  editor.value?.focus()
}

// 焦点陷阱模态框（命令面板）打开时，先释放编辑器 contenteditable 焦点。
// element-plus 的 el-dialog 关闭时会将焦点还原到先前聚焦元素；在选区未提交时还原到引擎 contenteditable
// 会使焦点陷阱与引擎选区处理冲突并冻结 renderer。预先 blur 可移除编辑器作为还原目标，避免循环。
const handleModalOpening = () => {
  if (editor.value && editor.value.hasFocus()) {
    editor.value.blur(true, true)
  }
}

// macOS 编辑 → 截图。主进程捕获区域、保存 PNG 并传入路径。
// Electron 42 Chromium 中 `document.execCommand('paste')` 不再触发，故经引擎在光标处插入图片（`imageAction` → upload/folder/path）。
const handleScreenShot = (filePath?: unknown) => {
  if (editor.value && typeof filePath === 'string' && filePath) {
    editor.value.pasteImage(filePath)
  }
}

const handleResetPaddingBottom = () => {
  const container = getScrollContainer()
  if (!container) return
  const firstChild = container.firstElementChild as HTMLElement | null
  if (!firstChild) return
  const newScollableHeightWithoutPadding =
    container.scrollHeight - container.clientHeight - parseFloat(firstChild.style.paddingBottom)

  if (currentFile.value && newScollableHeightWithoutPadding > currentFile.value.scrollTop) {
    container.style.paddingBottom = ''
    resizeObserverForEditor.unobserve(firstChild) // 已移除 padding，取消观察 #ag-editor-id
  }
}

const handleLanguageChanged = (newLocale?: unknown) => {
  if (editor.value) {
    const locale = typeof newLocale === 'string' ? newLocale : language.value
    editor.value.locale(getMuyaLocale(locale))
  }
}
const resizeObserverForEditor = new ResizeObserver(handleResetPaddingBottom)

onMounted(() => {
  printer = new Printer()
  const ele = editorRef.value
  if (!ele) return

  // 每个 renderer 进程仅注册一次引擎 UI 插件（见 `muyaPluginsRegistered`）。
  // 图片编辑工具接收桌面图片回调；LinkTools 接收 ctrl/cmd 点击跳转处理器。
  if (!muyaPluginsRegistered) {
    muyaPluginsRegistered = true
    Muya.use(TableChessboard)
    Muya.use(ParagraphQuickInsertMenu)
    Muya.use(CodeBlockLanguageSelector)
    Muya.use(EmojiSelector)
    Muya.use(ImagePathPicker)
    Muya.use(ImageEditTool, {
      imageAction: muyaImageAction,
      imagePathPicker,
      imagePathAutoComplete
    })
    Muya.use(ImageResizeBar)
    Muya.use(ImageToolBar)
    Muya.use(InlineFormatToolbar)
    Muya.use(ParagraphFrontButton)
    Muya.use(ParagraphFrontMenu)
    Muya.use(PreviewToolBar)
    Muya.use(LinkTools, {
      jumpClick
    })
    Muya.use(FootnoteTool)
    Muya.use(TableColumnToolbar)
    Muya.use(TableDragBar)
    Muya.use(TableRowColumMenu)
  }

  const options: Record<string, unknown> = {
    focusMode: focus.value,
    markdown: props.markdown,
    locale: getMuyaLocale(language.value),
    preferLooseListItem: preferLooseListItem.value,
    autoPairBracket: autoPairBracket.value,
    autoPairMarkdownSyntax: autoPairMarkdownSyntax.value,
    trimUnnecessaryCodeBlockEmptyLines: trimUnnecessaryCodeBlockEmptyLines.value,
    autoPairQuote: autoPairQuote.value,
    bulletListMarker: bulletListMarker.value,
    orderListDelimiter: orderListDelimiter.value,
    tabSize: tabSize.value,
    fontSize: fontSize.value,
    lineHeight: lineHeight.value,
    codeBlockLineNumbers: codeBlockLineNumbers.value,
    listIndentation: listIndentation.value,
    frontmatterType: frontmatterType.value,
    superSubScript: superSubScript.value,
    footnote: footnote.value,
    disableHtml: !isHtmlEnabled.value,
    isGitlabCompatibilityEnabled: isGitlabCompatibilityEnabled.value,
    hideQuickInsertHint: hideQuickInsertHint.value,
    hideLinkPopup: hideLinkPopup.value,
    autoCheck: autoCheck.value,
    sequenceTheme: sequenceTheme.value,
    plantumlServer: preferencesStore.plantumlServer,
    spellcheckEnabled: spellcheckerEnabled.value,
    // 粘贴时解析 OS 剪贴板为本地文件路径（来自文件的图片）。
    clipboardFilePath: guessClipboardFilePath,
    // 读取 OS 剪贴板纯文本供“粘贴为纯文本”（execCommand('paste') 不再触发）。
    clipboardText: () => window.electron.clipboard.readText(),
    // 图片持久化回调由引擎剪贴板与拖放处理器从 `muya.options.*` 读取
    // （与上方 ImageEditTool 插件选项不同）。缺少时本地文件拖放、截图/二进制剪贴板粘贴、
    // 粘贴图片文件复制到 assets 会静默 no-op 或插入原始路径。
    imageAction: muyaImageAction,
    getPathForFile: (file: File) => window.electron.webUtils.getPathForFile(file)
  }

  if (/dark/i.test(theme.value)) {
    Object.assign(options, {
      mermaidTheme: 'dark',
      vegaTheme: 'dark'
    })
  } else {
    Object.assign(options, {
      mermaidTheme: 'default',
      vegaTheme: 'latimes'
    })
  }

  // `markRaw` 防止 Vue 将 Muya 实例包入响应式 Proxy。
  // 引擎持有实时 DOM 节点与块树引用并通过 snabbdom 修补 DOM；代理会破坏身份检查导致文档树无法渲染。
  const muya = markRaw(new Muya(ele, options))
  // 新引擎构造后须显式 init()（构建文档树并实例化已注册 UI 插件）。
  muya.init()
  editor.value = muya
  // 首篇文档经构造选项设置，不触发 `file-loaded` / `setMarkdownToEditor`——在此播种 TOC。
  editorStore.UPDATE_TOC(muya.getTOC())

  // 为挂载加载的文档播种保存追踪基线（原因同 setMarkdownToEditor）。
  // 否则分配器在首次 `json-change`（即首次编辑后）才惰性创建，干净内容永无 id 0，
  // undo 回磁盘内容无法再视为干净（PG15）。
  if (currentFile.value?.id) {
    getSyntheticHistory(currentFile.value.id, muya.getMarkdown())
  }

  const container = getScrollContainer()!

  // 监听语言变更并更新引擎 locale。
  bus.on('language-changed', handleLanguageChanged)

  // 创建拼写检查包装器，按偏好启用拼写检查。
  spellchecker = new SpellChecker(spellcheckerEnabled.value, spellcheckerLanguage.value)

  // 注册命令面板切换拼写检查语言的条目。
  switchLanguageCommand = new SpellcheckerLanguageCommand(spellchecker)
  setTimeout(() => bus.emit('cmd::register-command', switchLanguageCommand), 100)

  if (typewriter.value) {
    scrollToCursor()
  }

  // 监听 bus 事件。
  bus.on('file-loaded', setMarkdownToEditor)
  bus.on('invalidate-image-cache', handleInvalidateImageCache)
  bus.on('undo', handleUndo)
  bus.on('redo', handleRedo)
  bus.on('selectAll', handleSelectAll)
  bus.on('export', handleExport)
  bus.on('print-service-clearup', handlePrintServiceClearup)
  bus.on('paragraph', handleEditParagraph)
  bus.on('format', handleInlineFormat)
  bus.on('searchValue', handleSearch)
  bus.on('replaceValue', handReplace)
  bus.on('find-action', handleFindAction)
  bus.on('insert-image', insertImage)
  bus.on('image-uploaded', handleUploadedImage)
  bus.on('file-changed', handleFileChange)
  bus.on('editor-blur', blurEditor)
  bus.on('editor-focus', focusEditor)
  bus.on('copyAsRich', handleCopyPaste)
  bus.on('copyAsHtml', handleCopyPaste)
  bus.on('pasteAsPlainText', handleCopyPaste)
  bus.on('duplicate', handleParagraph)
  bus.on('createParagraph', handleParagraph)
  bus.on('deleteParagraph', handleParagraph)
  bus.on('insertParagraph', handleInsertParagraph)
  bus.on('scroll-to-header', scrollToHeader)
  bus.on('screenshot-captured', handleScreenShot)
  bus.on('show-command-palette', handleModalOpening)
  bus.on('switch-spellchecker-language', switchSpellcheckLanguage)
  bus.on('open-command-spellchecker-switch-language', openSpellcheckerLanguageCommand)
  bus.on('replace-misspelling', replaceMisspelling)

  // 引擎在每次文档变更时发出底层 `json-change`（{ op, source, prevDoc, doc }）；
  // 桌面内容变更管道需要派生文档快照（markdown / 字数 / 光标 / 历史 / TOC / 块 AST），
  // 故在此计算——镜像遗留引擎 `dispatchChange` 载荷。
  editor.value.on('json-change', () => {
    // 此事件可能在标签切换之后才触发。若仅依赖 currentFile 可能导致无效更新，故需 id 标识各标签变更。
    if (!currentFile.value || !editor.value) return
    const { id } = currentFile.value
    if (!id) return
    const markdown = editor.value.getMarkdown()
    // 暂存真实引擎历史以供会话内标签切换恢复。合成保存追踪 id 由实时文档内容派生
    // （单调、永不复用——见 `syntheticHistory.ts`），而非引擎 undo 栈深度（会被复用并误判重新编辑标签为干净，Phase G — G6）。
    const engineHistory = editor.value.getHistory()
    engineHistoryByTab.set(id, engineHistory)
    editorStore.LISTEN_FOR_CONTENT_CHANGE({
      id,
      markdown,
      wordCount: muyaWordCount(markdown),
      cursor: serializeCursor(editor.value.getSelection()),
      // 合成桌面形状历史，使 store 保存/脏状态追踪继续工作（引擎历史形状不兼容）。
      history: makeSyntheticHistory(id, markdown),
      toc: editor.value.getTOC(),
      blocks: editor.value.getState()
    })
  })

  // 引擎不发出 `scroll`；直接在滚动容器监听，以便桌面持久化各标签 scroll 位置。
  scrollHandler = () => {
    if (currentFile.value) {
      editorStore.updateScrollPosition(currentFile.value.id, container.scrollTop)
    }
  }
  container.addEventListener('scroll', scrollHandler, { passive: true })

  // 点击标题悬停复制链接触发 `heading-copy-link` 并携带稳定 slug；
  // 将匹配的 GitHub 锚点复制到剪贴板（经 `listToc.find(i => i.slug === key)` 解析）。
  editor.value.on('heading-copy-link', ({ key }: { key: string }) => {
    editorStore.copyGithubSlug(key)
  })

  editor.value.on(
    'format-click',
    ({ event, formatType, data }: { event: MouseEvent; formatType: string; data: unknown }) => {
      const ctrlOrMeta = (isOsx && event.metaKey) || (!isOsx && event.ctrlKey)
      if (formatType === 'link' && ctrlOrMeta) {
        editorStore.FORMAT_LINK_CLICK({
          data: data as { href: string; [key: string]: unknown },
          dirname: window.DIRNAME
        })
      } else if (formatType === 'image' && ctrlOrMeta) {
        if (imageViewer) {
          imageViewer.destroy()
        }
        if (imageViewerRef.value) {
          imageViewer = new SimpleImageViewer(imageViewerRef.value, { url: data as string })
          setImageViewerVisible(true)
        }
      }
    }
  )

  editor.value.on('preview-image', ({ data }: { data: string }) => {
    if (imageViewer) {
      imageViewer.destroy()
    }
    if (imageViewerRef.value) {
      imageViewer = new SimpleImageViewer(imageViewerRef.value, { url: data })
      setImageViewerVisible(true)
    }
  })

  editor.value.on('copy-image', async ({ src }: { src: string }) => {
    try {
      const copied = await window.electron.clipboard.writeImage(src)
      notice.notify({
        title: copied ? 'Image copied' : 'Failed to copy image',
        message: '',
        type: copied ? 'primary' : 'error',
        time: 2000
      })
    } catch (error) {
      log.error('Failed to copy image.', error)
      notice.notify({
        title: 'Failed to copy image',
        message: error instanceof Error ? error.message : String(error),
        type: 'error'
      })
    }
  })

  editor.value.on('download-image', async ({
    data,
    filename
  }: {
    data: string
    filename?: string
  }) => {
    try {
      const result = await window.fileUtils.saveImageAs(data, filename)
      if (!result.canceled) {
        notice.notify({
          title: 'Image saved',
          message: result.filePath || '',
          type: 'primary',
          time: 3000
        })
      }
    } catch (error) {
      log.error('Failed to save image.', error)
      notice.notify({
        title: 'Failed to save image',
        message: error instanceof Error ? error.message : String(error),
        type: 'error'
      })
    }
  })

  editor.value.on('selection-change', (changes: MuyaChange) => {
    const y = (changes.cursorCoords?.y ?? null) as number | null
    if (y != null) {
      if (typewriter.value) {
        const startPosition = container.scrollTop
        const toPosition = startPosition + y - STANDAR_Y

        // 避免微抖动与不必要的滚动。
        if (Math.abs(startPosition - toPosition) > 2) {
          animatedScrollTo(container, toPosition, 100)
        }
      }

      // 修复 #628：光标过低时自动滚动至可见区域。
      if (container.clientHeight - y < 100) {
        // editableHeight 为编辑器允许的最低光标位置（距顶部）。
        const editableHeight = container.clientHeight - 100
        animatedScrollTo(container, container.scrollTop + (y - editableHeight), 0)
      }
    }

    selectionChange.value = changes
    // 持久化光标，使点击/方向键移动（不触发 `json-change`）在会话内标签切换后仍可恢复——
    // `tab.cursor` 由 `handleFileChange` 在重新激活时重放。开销低：仅序列化光标。
    if (currentFile.value?.id && editor.value) {
      editorStore.PERSIST_CURSOR(currentFile.value.id, serializeCursor(editor.value.getSelection()))
    }
    pushSelectionMenuState(changes)
  })

  document.addEventListener('keyup', keyup)

  setWrapCodeBlocks(wrapCodeBlocks.value)
  setEditorWidth(editorLineWidth.value)
})

onBeforeUnmount(() => {
  bus.off('file-loaded', setMarkdownToEditor)
  bus.off('invalidate-image-cache', handleInvalidateImageCache)
  bus.off('undo', handleUndo)
  bus.off('redo', handleRedo)
  bus.off('selectAll', handleSelectAll)
  bus.off('export', handleExport)
  bus.off('print-service-clearup', handlePrintServiceClearup)
  bus.off('paragraph', handleEditParagraph)
  bus.off('format', handleInlineFormat)
  bus.off('searchValue', handleSearch)
  bus.off('replaceValue', handReplace)
  bus.off('find-action', handleFindAction)
  bus.off('insert-image', insertImage)
  bus.off('image-uploaded', handleUploadedImage)
  bus.off('file-changed', handleFileChange)
  bus.off('editor-blur', blurEditor)
  bus.off('editor-focus', focusEditor)
  bus.off('copyAsRich', handleCopyPaste)
  bus.off('copyAsHtml', handleCopyPaste)
  bus.off('pasteAsPlainText', handleCopyPaste)
  bus.off('duplicate', handleParagraph)
  bus.off('createParagraph', handleParagraph)
  bus.off('deleteParagraph', handleParagraph)
  bus.off('insertParagraph', handleInsertParagraph)
  bus.off('scroll-to-header', scrollToHeader)
  bus.off('screenshot-captured', handleScreenShot)
  bus.off('show-command-palette', handleModalOpening)
  bus.off('switch-spellchecker-language', switchSpellcheckLanguage)
  bus.off('open-command-spellchecker-switch-language', openSpellcheckerLanguageCommand)
  bus.off('replace-misspelling', replaceMisspelling)
  bus.off('language-changed', handleLanguageChanged)

  document.removeEventListener('keyup', keyup)

  // 移除手动 scroll 监听；引擎 `on(...)` 监听器由 `destroy()` → `eventCenter.unsubscribeAll()` 拆除。
  if (scrollHandler && editor.value) {
    const container = getScrollContainer()
    container?.removeEventListener('scroll', scrollHandler)
  }
  scrollHandler = null

  resizeObserverForEditor.disconnect()

  if (imageViewer) {
    imageViewer.destroy()
    imageViewer = null
  }

  if (editor.value) {
    editor.value.destroy()
    editor.value = null
  }
})
</script>

<style>
/* 原有样式 */
.editor-wrapper {
  height: 100%;
  position: relative;
  flex: 1;
  color: var(--editorColor);
}

.ag-insert-table-dialog {
  & .el-form--inline {
    display: flex;
    flex-wrap: nowrap;
    justify-content: space-between;
    align-items: center;
  }
  & .el-form--inline .el-form-item {
    margin-right: 0;
  }
  & .el-input-number {
    width: 100px;
    min-width: 0;
  }
  & .el-button {
    font-size: 13px;
    width: 70px;
  }
}

.editor-wrapper.source {
  position: absolute;
  z-index: -1;
  top: 0;
  left: 0;
  overflow: hidden;
}

.editor-component {
  height: 100%;
  overflow: auto;
  box-sizing: border-box;
  cursor: default;
  overflow-anchor: none !important;
}

.editor-component .mu-container {
  padding-top: 20px;
  padding-bottom: 100vh;
}

.typewriter .editor-component {
  padding-top: calc(50vh - 136px);
  padding-bottom: calc(50vh - 54px);
}

.image-viewer {
  position: fixed;
  backdrop-filter: blur(5px);
  top: 0;
  right: 0;
  left: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  z-index: 11;
  & .icon-close {
    z-index: 1000;
    width: 30px;
    height: 30px;
    position: absolute;
    top: 50px;
    left: 50px;
    display: block;
    color: #efefef;
    & svg {
      width: 100%;
      height: 100%;
    }
  }
}

.image-viewer > div {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  overflow: hidden;
}
</style>
