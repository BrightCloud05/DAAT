import { cn } from '@/lib/utils'

/**
 * The BISEO mark: a deconstructed B — a stem and two bowls — on the product
 * blue. Same geometry as assets/icon.png (scripts/generate-app-icon.py),
 * drawn inline as SVG so it stays sharp at any size, needs no bundled image,
 * and renders identically in light and dark.
 *
 * Deliberately not an upstream logo: an MIT licence grants rights to the
 * code, never to someone else's brand.
 */
export function BrandMark({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      className={cn('inline-flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-[22.5%]', className)}
      {...props}
    >
      <svg viewBox="0 0 512 512" className="size-full" role="img" aria-label="BISEO">
        <rect width="512" height="512" rx="115" fill="#007AFF" />
        {/* Stem, held apart from the bowls so the gaps survive at 16px. */}
        <rect x="120" y="96" width="56" height="320" rx="28" fill="#fff" />
        <path d="M208 96h72a80 80 0 0 1 0 160h-72V96Zm40 40v80h32a40 40 0 0 0 0-80h-32Z" fill="#fff" />
        <path d="M208 256h88a80 80 0 0 1 0 160h-88V256Zm40 40v80h48a40 40 0 0 0 0-80h-48Z" fill="#fff" />
      </svg>
    </span>
  )
}
