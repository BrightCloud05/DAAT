import { cn } from '@/lib/utils'

const assetPath = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`

/**
 * The Daat mark — the same artwork as the app icon, not a redrawn stand-in.
 *
 * It renders the actual shipped icon (public/hermes.png, written by
 * scripts/build-app-icon.py alongside assets/icon.icns), so the mark in the
 * app and the icon in the Dock can never drift apart: rebuild the icon and
 * this follows. The squircle and its transparent margin are already baked
 * into that file, which is why nothing here masks or rounds it.
 *
 * Deliberately not an upstream logo: an MIT licence grants rights to the
 * code, never to someone else's brand.
 */
export function BrandMark({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span className={cn('inline-flex size-14 shrink-0 items-center justify-center', className)} {...props}>
      <img alt="" className="size-full object-contain" src={assetPath('hermes.png')} />
    </span>
  )
}
