export default async function Page() {
  await __turbopack_load__('some-chunk')
  return null
}
