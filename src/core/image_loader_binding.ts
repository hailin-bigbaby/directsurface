import type { ImageLoader } from './image_loader'
import { WebImageLoader } from './web_image_loader'
let browserLoader: ImageLoader | undefined
export function resolveImageLoader(): ImageLoader { return browserLoader ??= new WebImageLoader() }
