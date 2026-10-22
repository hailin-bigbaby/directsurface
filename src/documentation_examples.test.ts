import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

it('type-checks the updated grid, navigation, and inspector examples without host placeholders', () => {
  const cases = [
    ['docs/components/data/data-grid.md', 'maxRowHeight: 180'],
    ['docs/components/navigation/dock-workbench.md', 'function guardGridNavigation'],
    ['docs/devtools.md', 'preserveState: true'],
  ] as const
  const sources = new Map<string, { text: string; document: string }>()
  for (const [document, marker] of cases) {
    const blocks = [...readFileSync(document, 'utf8').matchAll(/```(?:ts|typescript)\n([\s\S]*?)```/g)]
      .map(match => match[1]!).filter(code => code.includes(marker))
    expect(blocks, document).toHaveLength(1)
    sources.set(`${process.cwd()}/.virtual-doc-${sources.size}.ts`, { text: blocks[0]! + '\nexport {}', document })
  }
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true, noUncheckedIndexedAccess: true, skipLibCheck: true, noEmit: true,
    baseUrl: process.cwd(), paths: { directsurface: ['src/index.ts'] },
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
  }
  const host = ts.createCompilerHost(options), original = host.getSourceFile.bind(host)
  host.getSourceFile = (name, version, onError, createNew) => sources.has(name)
    ? ts.createSourceFile(name, sources.get(name)!.text, version, true)
    : original(name, version, onError, createNew)
  const program = ts.createProgram([...sources.keys()], options, host)
  const failures = ts.getPreEmitDiagnostics(program).filter(d => d.file && sources.has(d.file.fileName))
    .map(d => `${sources.get(d.file!.fileName)!.document}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`)
  expect(failures).toEqual([])
}, 30000)
