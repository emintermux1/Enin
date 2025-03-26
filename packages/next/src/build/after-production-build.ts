import type { NextConfigComplete } from '../server/config-shared'
import type { Span } from '../trace'

import * as Log from './output/log'
import createSpinner from './spinner'
import isError from '../lib/is-error'
import type { Telemetry } from '../telemetry/storage'
import { EVENT_BUILD_FEATURE_USAGE } from '../telemetry/events/build'

export async function runAfterProductionBuild({
  config,
  buildSpan,
  telemetry,
}: {
  config: NextConfigComplete
  buildSpan: Span
  telemetry: Telemetry
}): Promise<void> {
  const afterProductionBuild = config.experimental.afterProductionBuild

  if (!afterProductionBuild) {
    return
  }

  telemetry.record([
    {
      eventName: EVENT_BUILD_FEATURE_USAGE,
      payload: {
        featureName: 'afterProductionBuild',
        invocationCount: 1,
      },
    },
  ])

  const afterBuildSpinner = createSpinner('Running afterProductionBuild')

  try {
    await buildSpan
      .traceChild('after-production-build')
      .traceAsyncFn(async () => {
        await afterProductionBuild()
      })

    afterBuildSpinner?.stopAndPersist()
  } catch (err) {
    afterBuildSpinner?.stopAndPersist()

    // Handle specific known errors differently if needed
    if (isError(err)) {
      Log.error(`Failed to run afterProductionBuild: ${err.message}`)
    }

    throw err
  }
}
