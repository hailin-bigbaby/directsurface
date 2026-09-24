import { DrawList } from '../../rendering/draw_list'
import type { PaintContext } from '../../rendering/paint_context'
import { withAlpha } from './chart_palette'
import type { ChartPlotRect, ChartStateDebugState, ChartStateOptions } from './chart_types'

const DEFAULT_EMPTY_MESSAGE = '暂无数据'
const DEFAULT_LOADING_MESSAGE = '加载中'
const DEFAULT_ERROR_MESSAGE = '数据加载失败'

export function resolveChartState(options: ChartStateOptions, hasData: boolean): ChartStateDebugState {
  const state = options.dataState ?? (hasData ? 'ready' : 'empty')
  return {
    state,
    message: chartStateMessage(options, state),
  }
}

export function isChartReady(state: ChartStateDebugState): boolean {
  return state.state === 'ready'
}

export function paintChartState(
  dl: DrawList,
  context: PaintContext,
  rect: ChartPlotRect,
  state: ChartStateDebugState,
): void {
  if (state.state === 'ready' || rect.width <= 0 || rect.height <= 0) return
  const theme = context.theme
  const bg = state.state === 'error'
    ? theme.statusDangerBg
    : withAlpha(theme.surfacePanel, 0.72)
  const border = state.state === 'error'
    ? theme.statusDangerBorder
    : withAlpha(theme.borderSubtle, 0.85)
  const textColor = state.state === 'error'
    ? theme.accentDanger
    : state.state === 'loading'
      ? theme.loadingTextColor
      : theme.textDisabled
  dl.fillRect(rect.x, rect.y, rect.width, rect.height, bg, 4)
  dl.strokeRect(rect.x, rect.y, rect.width, rect.height, border, 1, 4)
  dl.fillText(
    state.message,
    rect.x + rect.width / 2,
    rect.y + rect.height / 2,
    textColor,
    Math.max(10, theme.fontSize - 1),
    theme.fontFamily,
    'center',
    'middle',
    state.state === 'error' ? 600 : undefined,
  )
}

function chartStateMessage(options: ChartStateOptions, state: ChartStateDebugState['state']): string {
  switch (state) {
    case 'loading':
      return options.loadingMessage ?? DEFAULT_LOADING_MESSAGE
    case 'empty':
      return options.emptyMessage ?? DEFAULT_EMPTY_MESSAGE
    case 'error':
      return options.errorMessage ?? DEFAULT_ERROR_MESSAGE
    case 'ready':
      return ''
  }
}
