import { AceFactory } from '@adonisjs/core/factories'
import { FileSystem } from '@japa/file-system'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const TEST_DIRECTORY = dirname(fileURLToPath(import.meta.url))

export async function makeAceApp(fs: FileSystem) {
  const ace = await new AceFactory().make(fs.baseUrl, {
    importer: () => {},
  })
  await ace.app.init()
  await ace.app.boot()
  // ace.ui.switchMode('raw')
  return ace
}
