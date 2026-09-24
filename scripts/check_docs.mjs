import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import ts from 'typescript'

const root = process.cwd()
function markdownFiles(directory) {
  const result = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) result.push(...markdownFiles(path))
    else if (entry.isFile() && entry.name.endsWith('.md')) result.push(path)
  }
  return result
}
const documentation = [
  'README.md',
  'CONTRIBUTING.md',
  'examples/basic-app/README.md',
  ...markdownFiles('docs'),
]
for (const path of documentation) {
  const source = readFileSync(path, 'utf8')
  const prose = source.replace(/```[\s\S]*?```/g, '')
  if (source.includes(':::demo')) throw new Error(`Unresolved demo marker in ${path}`)
  for (const [, target] of prose.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    if (/^(?:https?:|mailto:|#)/.test(target)) continue
    const file = target.split('#')[0]
    if (!file || !existsSync(resolve(root, dirname(path), file))) {
      throw new Error(`Broken documentation link in ${path}: ${target}`)
    }
  }
}

const index = ts.createSourceFile('src/index.ts', readFileSync('src/index.ts', 'utf8'), ts.ScriptTarget.Latest, true)
const exported = new Set()
const allExports = new Set()
for (const declaration of index.statements) {
  if (!ts.isExportDeclaration(declaration) || !declaration.exportClause || !ts.isNamedExports(declaration.exportClause)) continue
  for (const symbol of declaration.exportClause.elements) {
    allExports.add(symbol.name.text)
    if (!symbol.isTypeOnly && /^Render[A-Z]/.test(symbol.name.text)) exported.add(symbol.name.text)
  }
}
for (const path of documentation) {
  const markdown = readFileSync(path, 'utf8')
  for (const [, code] of markdown.matchAll(/```(?:ts|tsx|typescript)\n([\s\S]*?)\n```/g)) {
    const snippet = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true)
    if (snippet.parseDiagnostics.length) throw new Error(`Invalid TypeScript snippet in ${path}: ${snippet.parseDiagnostics[0].messageText}`)
    for (const statement of snippet.statements) {
      if (!ts.isImportDeclaration(statement) || statement.moduleSpecifier.text !== 'ds-ui') continue
      const bindings = statement.importClause?.namedBindings
      if (!bindings || !ts.isNamedImports(bindings)) continue
      for (const element of bindings.elements) {
        const name = (element.propertyName ?? element.name).text
        if (!allExports.has(name)) throw new Error(`Undeclared package import in ${path}: ${name}`)
      }
    }
  }
}
const iconManifest = JSON.parse(readFileSync('scripts/icon_manifest.json', 'utf8'))
const iconNames = new Set(iconManifest.icons.map(icon => icon.name))
for (const path of documentation) {
  const markdown = readFileSync(path, 'utf8')
  for (const [, name] of markdown.matchAll(/\bicon\s*:\s*['"]([^'"]+)['"]/g)) {
    if (!iconNames.has(name)) throw new Error(`Unknown icon in ${path}: ${name}`)
  }
}
const catalog = readFileSync('docs/components.md', 'utf8')
const listed = new Set([...catalog.matchAll(/`(Render[A-Za-z0-9]+)`/g)].map(match => match[1]))
const detailed = markdownFiles('docs/components')
  .filter(path => !path.endsWith('/README.md'))
  .map(path => readFileSync(path, 'utf8'))
  .join('\n')
const undocumented = [...exported].filter(name => !new RegExp(`\\b${name}\\b`).test(detailed))
if (undocumented.length) throw new Error(`Render exports missing from component guides: ${undocumented.join(', ')}`)
const missing = [...exported].filter(name => !listed.has(name))
const unknown = [...listed].filter(name => !exported.has(name))
if (missing.length || unknown.length) {
  throw new Error(`Component catalog mismatch: missing ${missing.join(', ') || 'none'}; unknown ${unknown.join(', ') || 'none'}`)
}
console.log(`Documentation verified (${documentation.length} pages, ${exported.size} render exports)`)
