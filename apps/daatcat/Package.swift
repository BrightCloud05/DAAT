// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "DaatCat",
    platforms: [
        .macOS(.v13)
    ],
    targets: [
        .executableTarget(
            name: "DaatCat",
            path: "Sources/DaatCat"
        )
    ]
)
