import { InvariantError } from '../../shared/lib/invariant-error'
import { isThenable } from '../../shared/lib/is-thenable'
import { workUnitAsyncStorage } from './work-unit-async-storage.external'

/** in DynamicIO, `import(...)` will be transformed into `trackDynamicImport(import(...))` */
export function trackDynamicImport<TExports extends Record<string, any>>(
  modulePromise: Promise<TExports>
): Promise<TExports> {
  if (!isThenable(modulePromise)) {
    // We're expecting `import()` to always return a promise. If it's not, something's very wrong.
    throw new InvariantError('Expected the argument to be a promise')
  }

  const workUnitStore = workUnitAsyncStorage.getStore()
  let cacheSignal =
    workUnitStore && workUnitStore.type === 'prerender'
      ? workUnitStore.cacheSignal
      : null

  if (cacheSignal) {
    // we expect the caller to look like `trackDynamicImport(import(...))`.
    // if that's true, then we're in the same microtick (and thus we didn't begin the read too late)
    cacheSignal.beginRead()

    const onSettled = cacheSignal.endRead.bind(cacheSignal)
    modulePromise.then(onSettled, onSettled)
  }
  return modulePromise
}

export function trackAsyncFunction<TFn extends (...args: any[]) => any>(
  name: string,
  func: TFn
): TFn {
  // it'd be confusing to see `__turbopack_require__` in a callstack twice, so disambiguate
  const wrapperName = 'tracked' + name

  return {
    [wrapperName]: function (this: unknown) {
      const result = func.call(this, arguments)
      if (isThenable(result)) {
        return trackDynamicImport(result)
      } else {
        return result
      }
    },
  }[wrapperName] as TFn
}
