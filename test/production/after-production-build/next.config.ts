import { NextConfig } from 'next'
import { after } from './after'

const nextConfig: NextConfig = {
  experimental: {
    afterProductionBuild: async () => {
      await after()
    },
  },
}

export default nextConfig
