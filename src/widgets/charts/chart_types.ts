import type { Color } from '../../theme/theme'

export type ChartX = number | string | Date

export interface ChartPoint {
  x: ChartX
  y: number
}

export interface ChartSeries {
  name: string
  data: ChartPoint[]
  color?: Color
}

export interface BarChartSeries {
  name: string
  data: number[]
  color?: Color
}

export interface DonutChartSegment {
  label: string
  value: number
  color?: Color
}

export interface ChartDomain {
  min: number
  max: number
}

export type ChartAxisType = 'auto' | 'linear' | 'time' | 'category'
export type ChartDecimationMode = 'none' | 'minMax'
export type ChartAnnotationAxis = 'x' | 'y' | 'value'
export type ChartAnnotationType = 'line' | 'range' | 'event'
export type ChartAnnotationLineStyle = 'solid' | 'dashed'
export type ChartAnnotationLabelPosition = 'start' | 'center' | 'end'
export type ChartAxisRole = 'x' | 'y' | 'value' | 'category'
export type ChartDataState = 'ready' | 'loading' | 'empty' | 'error'
export type ChartLegendMode = 'static' | 'toggle'
export type ChartStackMode = 'none' | 'stacked' | 'percent'
export type ChartTooltipMode = 'item' | 'axis'
export type ChartViewportChangeReason =
  | 'api'
  | 'pan'
  | 'wheel'
  | 'reset'
  | 'rangePan'
  | 'rangeResize'
  | 'rangeJump'
export type ChartWheelZoomModifier = 'none' | 'ctrl' | 'meta' | 'shift' | 'alt' | 'ctrlOrMeta'
export type ChartSeriesVisibilityChangeReason = 'api' | 'legendToggle'

export interface ChartViewportChangeEvent {
  viewport: ChartDomain
  fullDomain: ChartDomain
  reason: ChartViewportChangeReason
}

export interface ChartAnnotationBase {
  id?: string
  label?: string
  color?: Color
  opacity?: number
  lineWidth?: number
  lineStyle?: ChartAnnotationLineStyle
  labelPosition?: ChartAnnotationLabelPosition
}

export interface ChartLineAnnotation extends ChartAnnotationBase {
  type: 'line'
  axis: ChartAnnotationAxis
  value: ChartX | number
}

export interface ChartRangeAnnotation extends ChartAnnotationBase {
  type: 'range'
  axis: ChartAnnotationAxis
  min: ChartX | number
  max: ChartX | number
}

export interface ChartEventAnnotation extends ChartAnnotationBase {
  type: 'event'
  x: ChartX
}

export type ChartAnnotation = ChartLineAnnotation | ChartRangeAnnotation | ChartEventAnnotation

export interface ChartAnnotationLayout {
  annotationIndex: number
  type: ChartAnnotationType
  axis: 'x' | 'y'
  id?: string
  label?: string
  x: number
  y: number
  width: number
  height: number
  value?: number
  min?: number
  max?: number
}

export interface ChartAxisLabelFormatterContext {
  axis: ChartAxisRole
  axisType: ChartAxisType
  value: number
  label: string
  index?: number
  domain: ChartDomain
}

export type ChartAxisLabelFormatter = (
  value: number,
  context: ChartAxisLabelFormatterContext,
) => string

export interface ChartAxisOptions {
  tickCount?: number
  labelFormatter?: ChartAxisLabelFormatter
  unit?: string
  min?: number
  max?: number
  showLabels?: boolean
  maxLabelLength?: number
}

export interface ChartStateOptions {
  dataState?: ChartDataState
  emptyMessage?: string
  loadingMessage?: string
  errorMessage?: string
}

export interface ChartStateDebugState {
  state: ChartDataState
  message: string
}

export interface ChartSeriesVisibilityChangeEvent {
  seriesIndex: number
  seriesName: string
  visible: boolean
  visibleSeries: number[]
  hiddenSeries: number[]
  reason: ChartSeriesVisibilityChangeReason
}

export interface ChartSegmentVisibilityChangeEvent {
  segmentIndex: number
  label: string
  visible: boolean
  visibleSegments: number[]
  hiddenSegments: number[]
  reason: ChartSeriesVisibilityChangeReason
}

export interface ChartPlotRect {
  x: number
  y: number
  width: number
  height: number
}

export interface ChartPadding {
  left: number
  right: number
  top: number
  bottom: number
}

export interface ChartPointLayout {
  seriesIndex: number
  pointIndex: number
  x: number
  y: number
  value: number
  stackBase?: number
  stackValue?: number
  stackTotal?: number
  stackRatio?: number
  label: string
  seriesName: string
}

export interface ChartTooltipItem {
  label: string
  value: string
  color?: Color
}

export interface ChartTooltipDebugState {
  title?: string
  items: ChartTooltipItem[]
  x: number
  y: number
  width: number
  height: number
}

export interface ChartBarLayout {
  seriesIndex: number
  categoryIndex: number
  x: number
  y: number
  width: number
  height: number
  value: number
  stackBase?: number
  stackValue?: number
  stackTotal?: number
  stackRatio?: number
  category: string
  seriesName: string
}

export interface DonutSegmentLayout {
  index: number
  label: string
  value: number
  ratio: number
  startAngle: number
  endAngle: number
  color: Color
}

export type SparklineVariant = 'line' | 'area' | 'bar'
export type BarChartOrientation = 'vertical' | 'horizontal'
