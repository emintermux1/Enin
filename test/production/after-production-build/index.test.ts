import { nextTestSetup } from 'e2e-utils'
import { findAllTelemetryEvents } from 'next-test-utils'

describe('afterProductionBuild', () => {
  const { next } = nextTestSetup({
    files: __dirname,
    env: {
      NEXT_TELEMETRY_DEBUG: '1',
    },
  })

  it('should run afterProductionBuild', async () => {
    const output = next.cliOutput
    expect(output).toContain('')
    expect(output).toContain('Total files in .next folder')

    // Ensure telemetry event is recorded
    const events = findAllTelemetryEvents(output, 'NEXT_BUILD_FEATURE_USAGE')
    expect(events).toContainEqual({
      featureName: 'afterProductionBuild',
      invocationCount: 1,
    })
  })

  it('should not execute afterProductionBuild if compilation fails', async () => {
    try {
      await next.stop()
      await next.patchFile('app/layout.tsx', (content) => {
        return content + '{'
      })

      const getCliOutput = next.getCliOutputFromHere()
      await next.build()
      expect(getCliOutput()).not.toContain('Total files in .next folder')
    } finally {
      await next.patchFile('app/layout.tsx', (content) => {
        return content.slice(0, -1)
      })
    }
  })

  it('should throw an error', async () => {
    try {
      await next.stop()
      await next.patchFile('next.config.ts', (content) => {
        return content.replace(
          `import { after } from './after'`,
          `import { after } from './bad-after'`
        )
      })

      const getCliOutput = next.getCliOutputFromHere()
      await next.build()
      expect(getCliOutput()).toContain('error after production build')
    } finally {
      await next.patchFile('next.config.ts', (content) => {
        return content.replace(
          `import { after } from './bad-after'`,
          `import { after } from './after'`
        )
      })
    }
  })
})
