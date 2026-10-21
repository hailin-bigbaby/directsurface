import { readFileSync } from 'node:fs'

const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
const tag = process.argv[2]
const expectedTag = `v${manifest.version}`

if (tag !== expectedTag) {
  throw new Error(`Release tag ${tag ?? '(missing)'} must match package version ${expectedTag}`)
}
if (lock.version !== manifest.version || lock.packages[''].version !== manifest.version) {
  throw new Error('package-lock.json version must match package.json')
}

console.log(`Release version verified: ${expectedTag}`)
