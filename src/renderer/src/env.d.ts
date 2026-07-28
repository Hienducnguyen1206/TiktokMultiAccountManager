/// <reference types="vite/client" />
import type { HnvApi } from '@shared/types'

declare global {
  interface Window {
    hnv: HnvApi
  }
}

export {}
