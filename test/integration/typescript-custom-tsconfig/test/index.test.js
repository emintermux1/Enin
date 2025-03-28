/* eslint-env jest */

import { join } from 'path'
import { nextBuild } from 'next-test-utils'
import { nextTestSetup, FileRef } from 'e2e-utils'

const appDir = join(__dirname, '..')

const warnMessage = /Using tsconfig file:/

describe('Custom TypeScript Config', () => {
  const { next, skipped, isNextDev } = nextTestSetup({
    files: new FileRef(join(__dirname, '..')),
    dependencies: {
      typescript: '5.4.4',
    },
  })

  if (skipped) {
    return
  }

  it('app router: allows a user-specific tsconfig via the next config', async () => {
    const html = await next.render('/')
    expect(html).toContain('bar123')
  })

  it('pages router: allows a user-specific tsconfig via the next config', async () => {
    const html = await next.render('/page')
    expect(html).toContain('bar123')
  })

  it('middleware: allows a user-specific tsconfig via the next config', async () => {
    const html = await next.render('/middleware')
    expect(html).toContain('bar123')
  })
  ;(isNextDev ? describe.skip : describe)('production mode', () => {
    it('should warn when using custom typescript path', async () => {
      const { stdout } = await nextBuild(appDir, [], {
        stdout: true,
      })

      expect(stdout).toMatch(warnMessage)
    })
  })
})
