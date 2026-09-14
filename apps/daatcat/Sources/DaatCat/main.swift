/*
 DAAT Cat — RunCat-style menu bar monitor connected to DAAT.

 Cat animation assets & speed-mapping approach adapted from
 "Menubar RunCat" by Takuto Nakamura (Kyome22), Apache License 2.0.
 OpenAI OAuth usage endpoints follow the approach documented by
 CodexBar (steipete/CodexBar).
*/

import AppKit

// Offscreen preview mode: renders the popover UI to a PNG and exits.
// Used so the build can be visually verified without screen recording perms.
if ProcessInfo.processInfo.environment["DAATCAT_PREVIEW"] != nil {
    MainActor.assumeIsolated {
        PreviewRenderer.renderAndExit()
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory) // menu bar only, no Dock icon
app.run()
