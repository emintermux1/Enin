import fs from 'fs/promises'
import path from 'path'

export async function after() {
  const nextDir = path.join(process.cwd(), '.next')

  try {
    const files = await fs.readdir(nextDir, { recursive: true })
    console.log(`Total files in .next folder: ${files.length}`)
  } catch (err) {
    console.error('Error reading .next directory:', err)
  }
}
