// Merge branding overrides into an installed openvscode-server's product.json.
//
//   node merge-product.js <product.json> <overrides.json>
//
// Merge rather than replace: product.json also holds the Open VSX gallery config and the
// commit/quality fields the server needs at runtime, and clobbering those bricks it.
// Keys starting with "_" are documentation, not product fields. A key set to null is DELETED
// rather than set to null — some workbench checks are `key in product` or truthiness of a nested
// field, so a null left behind is not the same as the key being absent, and absent is what
// defaultChatAgent needs.
const fs = require('node:fs')
const [, , productPath, overridesPath] = process.argv
if (!productPath || !overridesPath) {
  console.error('usage: node merge-product.js <product.json> <overrides.json>')
  process.exit(1)
}
const product = JSON.parse(fs.readFileSync(productPath, 'utf8'))
const overrides = JSON.parse(fs.readFileSync(overridesPath, 'utf8'))
const removed = []
for (const [key, value] of Object.entries(overrides)) {
  if (key.startsWith('_')) continue
  if (value === null) {
    if (key in product) removed.push(key)
    delete product[key]
    continue
  }
  product[key] = value
}
fs.writeFileSync(productPath, `${JSON.stringify(product, null, 2)}\n`)
console.log(`    nameLong=${product.nameLong} gallery=${product.extensionsGallery ? 'preserved' : 'ABSENT'}`)
console.log(`    removed=${removed.length ? removed.join(',') : '(none)'}`)
