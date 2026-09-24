// Curves: 缓动函数

export type CurveFunction = (t: number) => number

export const Curves = {
  linear: (t: number) => t,

  easeIn: (t: number) => t * t,

  easeOut: (t: number) => t * (2 - t),

  easeInOut: (t: number) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,

  easeInCubic: (t: number) => t * t * t,

  easeOutCubic: (t: number) => (--t) * t * t + 1,

  easeInOutCubic: (t: number) =>
    t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1,

  elasticOut: (t: number) => {
    if (t === 0 || t === 1) return t
    const p = 0.3
    return Math.pow(2, -10 * t) * Math.sin(((t - p / 4) * (2 * Math.PI)) / p) + 1
  },

  bounceOut: (t: number) => {
    if (t < 1 / 2.75) return 7.5625 * t * t
    if (t < 2 / 2.75) { t -= 1.5 / 2.75; return 7.5625 * t * t + 0.75 }
    if (t < 2.5 / 2.75) { t -= 2.25 / 2.75; return 7.5625 * t * t + 0.9375 }
    t -= 2.625 / 2.75
    return 7.5625 * t * t + 0.984375
  },

  spring: (t: number) => {
    // 简单弹簧：过冲后回弹
    return 1 - Math.cos(t * Math.PI * 4.5) * Math.exp(-t * 6)
  },
} as const satisfies Record<string, CurveFunction>
