export async function after() {
  throw new Error('error after production build')
}
