// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "kst",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "kst", targets: ["KstApp"])],
    targets: [
        .target(name: "KstNativeCore"),
        .executableTarget(name: "KstApp", dependencies: ["KstNativeCore"]),
        .executableTarget(name: "KstNativeChecks", dependencies: ["KstNativeCore"], path: "Tests/KstNativeCoreTests"),
        .executableTarget(name: "KstIconPrep", path: "Tools/IconPrep")
    ]
)
