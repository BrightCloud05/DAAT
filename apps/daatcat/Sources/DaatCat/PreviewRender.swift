import AppKit
import SwiftUI

/// DAATCAT_PREVIEW=1 mode: samples real metrics for a few seconds, renders
/// the popover to a PNG (DAATCAT_PREVIEW_OUT or ./daatcat-preview.png), exits.
/// Lets the UI be verified headlessly, without screen-recording permission.
enum PreviewRenderer {
    @MainActor
    static func renderAndExit() -> Never {
        let stats = SystemStatsEngine()
        let codex = CodexUsageProvider()
        let daat = DaatProgressProvider()
        stats.start()
        codex.start()
        daat.start()

        // Let two CPU deltas land and give the usage fetch a moment.
        RunLoop.main.run(until: Date().addingTimeInterval(5.5))

        let view = PopoverView(stats: stats, codex: codex, daat: daat, scrollable: false, closePopover: {})
            .frame(width: 372)
            .fixedSize(horizontal: false, vertical: true)
            .background(.regularMaterial)

        let renderer = ImageRenderer(content: view)
        renderer.scale = 2.0

        let outPath = ProcessInfo.processInfo.environment["DAATCAT_PREVIEW_OUT"]
            ?? "daatcat-preview.png"

        guard let cgImage = renderer.cgImage else {
            FileHandle.standardError.write(Data("preview: render failed\n".utf8))
            exit(1)
        }
        let rep = NSBitmapImageRep(cgImage: cgImage)
        guard let png = rep.representation(using: .png, properties: [:]) else {
            FileHandle.standardError.write(Data("preview: png encode failed\n".utf8))
            exit(1)
        }
        do {
            try png.write(to: URL(fileURLWithPath: outPath))
            print("preview written: \(outPath)")
            exit(0)
        } catch {
            FileHandle.standardError.write(Data("preview: \(error)\n".utf8))
            exit(1)
        }
    }
}
