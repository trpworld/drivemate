// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "DriveMateHelper",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(
            name: "DriveMateHelper",
            targets: ["DriveMateHelper"]
        )
    ],
    targets: [
        .executableTarget(
            name: "DriveMateHelper",
            path: "Sources/DriveMateHelper"
        )
    ]
)
