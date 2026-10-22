import { ProcurementError, type Amounts } from './model'

export function scaled(value: string, precision: number): bigint {
  if (typeof value !== 'string' || value.length > 24 || !/^\d+(?:\.\d+)?$/.test(value)) throw new ProcurementError('INVALID_NUMBER', '请输入非负十进制数值')
  const [whole, fraction = ''] = value.split('.')
  if (fraction.length > precision) throw new ProcurementError('PRECISION', `最多允许 ${precision} 位小数`)
  if (BigInt(whole) > 1_000_000n) throw new ProcurementError('NUMBER_RANGE', '演示数值不能超过 1,000,000')
  return BigInt(whole) * 10n ** BigInt(precision) + BigInt(fraction.padEnd(precision, '0') || '0')
}
export function decimal(value: bigint, precision: number): string {
  const negative = value < 0n; const n = negative ? -value : value
  const digits = n.toString().padStart(precision + 1, '0')
  const output = precision ? `${digits.slice(0, -precision)}.${digits.slice(-precision)}`.replace(/\.?0+$/, '') : digits
  return (negative ? '-' : '') + output
}
export function halfUp(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n) throw new ProcurementError('INVALID_NUMBER', '金额计算范围无效')
  return (numerator * 2n + denominator) / (2n * denominator)
}
export function quantityInBase(quantity: string, factor: string, precision: number): string {
  const q = scaled(quantity, precision)
  if (q <= 0n) throw new ProcurementError('QUANTITY', '采购数量必须大于 0')
  const numerator = scaled(quantity, 3) * scaled(factor, 3)
  if (numerator % 1000n) throw new ProcurementError('UNIT_PRECISION', '换算后的基本单位数量不能精确表示')
  return decimal(numerator / 1000n, 3)
}
export function calculateAmounts(quantity: string, unitPrice: string, taxBps: number): Amounts {
  if (!Number.isInteger(taxBps) || taxBps < 0 || taxBps > 10000) throw new ProcurementError('TAX', '报价税率无效')
  const gross = halfUp(scaled(quantity, 3) * scaled(unitPrice, 4), 100_000n)
  const net = halfUp(gross * 10_000n, BigInt(10_000 + taxBps))
  return { grossCents: String(gross), netCents: String(net), taxCents: String(gross - net) }
}
export function sumAmounts(values: Amounts[]): Amounts {
  const sum = (key: keyof Amounts) => values.reduce((total, value) => total + BigInt(value[key]), 0n).toString()
  return { grossCents: sum('grossCents'), netCents: sum('netCents'), taxCents: sum('taxCents') }
}
export function money(cents: string): string {
  const n = BigInt(cents); const negative = n < 0n; const digits = (negative ? -n : n).toString().padStart(3, '0')
  return `${negative ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`
}
