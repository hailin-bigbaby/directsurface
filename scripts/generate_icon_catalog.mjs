import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = resolve(repoRoot, 'scripts/icon_manifest.json')
const generatedPath = resolve(repoRoot, 'src/widgets/icon_catalog.generated.ts')
const checkOnly = process.argv.includes('--check')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

validateManifest(manifest)

const generatedSource = renderGeneratedModule(manifest)
const outputs = [[generatedPath, generatedSource]]

let stale = false
for (const [path, content] of outputs) {
  const current = readFileOrEmpty(path)
  if (current === content) continue
  stale = true
  if (!checkOnly) writeFileSync(path, content)
  console.log(`${checkOnly ? 'Stale' : 'Generated'} ${relative(repoRoot, path)}`)
}

if (checkOnly && stale) process.exitCode = 1
if (!stale) console.log(`Icon catalog is up to date (${manifest.icons.length} icons)`)

function validateManifest(value) {
  if (value.schemaVersion !== 2) throw new Error(`Unsupported icon manifest schema: ${value.schemaVersion}`)
  if (!Array.isArray(value.categories) || !Array.isArray(value.icons)) throw new Error('Invalid icon manifest collections')
  const categoryIds = new Set(value.categories.map(category => category.id))
  if (categoryIds.size !== value.categories.length) throw new Error('Duplicate icon category id')
  const names = new Set()
  for (const icon of value.icons) {
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(icon.name)) throw new Error(`Invalid icon name: ${icon.name}`)
    if (names.has(icon.name)) throw new Error(`Duplicate icon name: ${icon.name}`)
    if (!categoryIds.has(icon.category)) throw new Error(`Unknown category for icon ${icon.name}: ${icon.category}`)
    names.add(icon.name)
  }
  const iconsByName = new Map(value.icons.map(icon => [icon.name, icon]))
  for (const icon of value.icons) {
    if (icon.pathRef !== undefined) {
      if (typeof icon.pathRef !== 'string' || !iconsByName.has(icon.pathRef)) throw new Error(`Unknown pathRef for icon ${icon.name}: ${icon.pathRef}`)
      if (icon.pathRef === icon.name) throw new Error(`Icon cannot reference its own path: ${icon.name}`)
      if (icon.viewBoxSize !== undefined || icon.pathData !== undefined) throw new Error(`Referenced icon must not duplicate path data: ${icon.name}`)
      if (icon.opticalVariants !== undefined) throw new Error(`Referenced icon must inherit optical variants: ${icon.name}`)
    } else {
      if (!Number.isFinite(icon.viewBoxSize) || icon.viewBoxSize <= 0) throw new Error(`Invalid viewBox for icon: ${icon.name}`)
      if (typeof icon.pathData !== 'string' || !icon.pathData.startsWith('M')) throw new Error(`Invalid path data for icon: ${icon.name}`)
      validateOpticalVariants(icon)
    }
    resolvePathOwner(icon, iconsByName)
  }
}

function validateOpticalVariants(icon) {
  if (icon.opticalVariants === undefined) return
  if (!icon.opticalVariants || typeof icon.opticalVariants !== 'object' || Array.isArray(icon.opticalVariants)) {
    throw new Error(`Invalid optical variants for icon: ${icon.name}`)
  }
  const entries = Object.entries(icon.opticalVariants)
  if (entries.length === 0) throw new Error(`Empty optical variants for icon: ${icon.name}`)
  for (const [key, variant] of entries) {
    const nominalSize = Number(key)
    if (!Number.isInteger(nominalSize) || nominalSize <= 0 || String(nominalSize) !== key) {
      throw new Error(`Invalid optical size for icon ${icon.name}: ${key}`)
    }
    if (!variant || !Number.isFinite(variant.viewBoxSize) || variant.viewBoxSize <= 0) {
      throw new Error(`Invalid optical viewBox for icon ${icon.name}: ${key}`)
    }
    if (typeof variant.pathData !== 'string' || !variant.pathData.startsWith('M')) {
      throw new Error(`Invalid optical path for icon ${icon.name}: ${key}`)
    }
    if (typeof variant.sourceAsset !== 'string' || !variant.sourceAsset.endsWith('.svg')) {
      throw new Error(`Invalid optical source asset for icon ${icon.name}: ${key}`)
    }
  }
  const defaultVariant = icon.opticalVariants[String(icon.viewBoxSize)]
  if (!defaultVariant || defaultVariant.viewBoxSize !== icon.viewBoxSize || defaultVariant.pathData !== icon.pathData) {
    throw new Error(`Default optical variant does not match icon path: ${icon.name}`)
  }
}

function renderGeneratedModule(value) {
  const iconsByName = new Map(value.icons.map(icon => [icon.name, icon]))
  const names = value.icons.map(icon => `  '${icon.name}',`).join('\n')
  const categories = value.categories.map(category => `  '${category.id}': '${escapeSingleQuote(category.label)}',`).join('\n')
  const metadata = value.icons.map(icon =>
    `  { name: '${icon.name}', category: '${icon.category}' },`
  ).join('\n')
  const glyphs = value.icons.filter(icon => icon.pathRef === undefined).map(icon =>
    `  '${icon.name}': { viewBoxSize: ${icon.viewBoxSize}, pathData: '${escapeSingleQuote(icon.pathData)}' },`
  ).join('\n')
  const variantOwners = value.icons.filter(icon => icon.pathRef === undefined && icon.opticalVariants !== undefined)
  const variantGlyphs = variantOwners.map(icon => {
    const variants = Object.entries(icon.opticalVariants)
      .sort(([left], [right]) => Number(left) - Number(right))
      .map(([size, variant]) => Number(size) === icon.viewBoxSize
        ? `{ nominalSize: ${size}, definition: builtInIconGlyphs['${icon.name}']! }`
        : `{ nominalSize: ${size}, definition: { viewBoxSize: ${variant.viewBoxSize}, pathData: '${escapeSingleQuote(variant.pathData)}' } }`)
      .join(', ')
    return `  '${icon.name}': [${variants}],`
  }).join('\n')
  const paths = value.icons.map(icon =>
    `  '${icon.name}': builtInIconGlyphs['${resolvePathOwner(icon, iconsByName).name}']!,`
  ).join('\n')
  const opticalPaths = value.icons
    .filter(icon => resolvePathOwner(icon, iconsByName).opticalVariants !== undefined)
    .map(icon => `  '${icon.name}': builtInIconGlyphVariants['${resolvePathOwner(icon, iconsByName).name}']!,`)
    .join('\n')
  return `// Generated by scripts/generate_icon_catalog.mjs from scripts/icon_manifest.json. Do not edit.\n\n` +
    `export const builtInIconNames = [\n${names}\n] as const\n\n` +
    `export type IconName = typeof builtInIconNames[number]\n\n` +
    `export const builtInIconCategoryLabels = {\n${categories}\n} as const\n\n` +
    `export type IconCategory = keyof typeof builtInIconCategoryLabels\n\n` +
    `export interface BuiltInIconMetadata {\n` +
    `  readonly name: IconName\n` +
    `  readonly category: IconCategory\n` +
    `}\n\n` +
    `export const builtInIconCatalog: readonly BuiltInIconMetadata[] = [\n${metadata}\n]\n\n` +
    `export interface IconPathDefinition {\n` +
    `  readonly viewBoxSize: number\n` +
    `  readonly pathData: string\n` +
    `}\n\n` +
    `export interface IconOpticalVariant {\n` +
    `  readonly nominalSize: number\n` +
    `  readonly definition: IconPathDefinition\n` +
    `}\n\n` +
    `const builtInIconGlyphs: Record<string, IconPathDefinition> = {\n${glyphs}\n}\n\n` +
    `const builtInIconGlyphVariants: Record<string, readonly IconOpticalVariant[]> = {\n${variantGlyphs}\n}\n\n` +
    `export const builtInIconPaths: Record<IconName, IconPathDefinition> = {\n${paths}\n}\n\n` +
    `export const builtInIconOpticalVariants: Partial<Record<IconName, readonly IconOpticalVariant[]>> = {\n${opticalPaths}\n}\n`
}

function resolvePathOwner(icon, iconsByName) {
  const visited = new Set()
  let current = icon
  while (current.pathRef !== undefined) {
    if (visited.has(current.name)) throw new Error(`Circular icon pathRef: ${[...visited, current.name].join(' -> ')}`)
    visited.add(current.name)
    current = iconsByName.get(current.pathRef)
    if (!current) throw new Error(`Unknown pathRef for icon ${icon.name}: ${current?.pathRef}`)
  }
  return current
}

function readFileOrEmpty(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

function escapeSingleQuote(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'")
}
