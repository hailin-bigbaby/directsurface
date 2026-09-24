// TextMeasurer: 文字测量 LRU 缓存
// 避免每次 performLayout 都创建临时 canvas

const CACHE_SIZE = 4096

interface CacheEntry {
  width: number
  key: string
}

class LRUCache {
  private map = new Map<string, number>()
  private readonly maxSize: number

  constructor(maxSize: number) {
    this.maxSize = maxSize
  }

  get(key: string): number | undefined {
    const val = this.map.get(key)
    if (val === undefined) return undefined
    // 移到末尾（最近使用）
    this.map.delete(key)
    this.map.set(key, val)
    return val
  }

  set(key: string, val: number): void {
    if (this.map.has(key)) this.map.delete(key)
    else if (this.map.size >= this.maxSize) {
      // 删除最久未使用（Map 迭代顺序是插入顺序）
      const firstKey = this.map.keys().next().value
      if (firstKey !== undefined) this.map.delete(firstKey)
    }
    this.map.set(key, val)
  }
}

// 全局共享一个离屏 canvas 用于测量
let _measureCanvas: HTMLCanvasElement | null = null
let _measureCtx: CanvasRenderingContext2D | null = null

function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (_measureCtx) return _measureCtx
  if (
    typeof document === 'undefined'
    || typeof HTMLCanvasElement === 'undefined'
    || typeof CanvasRenderingContext2D === 'undefined'
  ) {
    return null
  }
  _measureCanvas = document.createElement('canvas')
  _measureCanvas.width = 1
  _measureCanvas.height = 1
  _measureCtx = _measureCanvas.getContext('2d')
  return _measureCtx
}

function estimateTextWidth(text: string, fontSize: number): number {
  // 在 jsdom 等没有 2D canvas 的环境里给出稳定的近似宽度，
  // 这样 layout 相关测试不需要额外 mock 文字测量。
  return text.length * fontSize * 0.6
}

const _cache = new LRUCache(CACHE_SIZE)

export const TextMeasurer = {
  /**
   * 测量文字宽度（带缓存）
   */
  measureWidth(
    text: string,
    fontSize: number,
    fontFamily: string,
    fontWeight?: string | number,
    fontStyle?: 'normal' | 'italic',
  ): number {
    if (!text) return 0
    const key = `${fontStyle ?? ''}|${fontWeight ?? ''}|${fontSize}|${fontFamily}|${text}`
    const cached = _cache.get(key)
    if (cached !== undefined) return cached

    const ctx = getMeasureCtx()
    let width: number
    if (!ctx) {
      width = estimateTextWidth(text, fontSize)
    } else {
      ctx.font = [fontStyle === 'italic' ? 'italic' : '', fontWeight ?? '', `${fontSize}px`, fontFamily].filter(Boolean).join(' ')
      width = ctx.measureText(text).width
    }
    _cache.set(key, width)
    return width
  },

  /**
   * 测量文字高度（行高估算）
   */
  lineHeight(fontSize: number): number {
    return fontSize * 1.4
  },

  /**
   * 清空缓存（字体变化时调用）
   */
  clearCache(): void {
    _cache['map'].clear()
    _measureCanvas = null
    _measureCtx = null
  },
}
