import AppKit

guard CommandLine.arguments.count == 3 else { fatalError("Usage: KstIconPrep <source PNG> <square PNG>") }
let source = URL(fileURLWithPath: CommandLine.arguments[1])
let destination = URL(fileURLWithPath: CommandLine.arguments[2])
let sourceBytes = try Data(contentsOf: source)
guard let sourceBitmap = NSBitmapImageRep(data: sourceBytes) else { fatalError("Cannot decode source icon") }
let sourceCorner = sourceBitmap.colorAt(x: 0, y: 0)?.alphaComponent ?? 1
let sourceCenter = sourceBitmap.colorAt(x: sourceBitmap.pixelsWide / 2, y: sourceBitmap.pixelsHigh / 2)?.alphaComponent ?? 1
print("Source icon alpha: corner=\(sourceCorner), between eyes=\(sourceCenter)")
guard sourceCorner < 0.01, sourceCenter < 0.01 else { fatalError("Source icon must be transparent at the corner and between eyes") }
guard let image = NSImage(contentsOf: source), image.size.width > 0, image.size.height > 0,
      let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 1024, pixelsHigh: 1024, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
      let context = NSGraphicsContext(bitmapImageRep: bitmap) else { fatalError("Cannot read or prepare icon image") }
let scale = min(1024 / image.size.width, 1024 / image.size.height)
let size = NSSize(width: image.size.width * scale, height: image.size.height * scale)
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = context
context.cgContext.clear(CGRect(x: 0, y: 0, width: 1024, height: 1024))
image.draw(in: NSRect(x: (1024 - size.width) / 2, y: (1024 - size.height) / 2, width: size.width, height: size.height), from: .zero, operation: .sourceOver, fraction: 1)
NSGraphicsContext.restoreGraphicsState()
guard let png = bitmap.representation(using: .png, properties: [:]) else { fatalError("Cannot encode square icon") }
try png.write(to: destination)
guard bitmap.colorAt(x: 0, y: 0)?.alphaComponent == 0,
      bitmap.colorAt(x: 1023, y: 1023)?.alphaComponent == 0 else { fatalError("Icon corners must remain transparent") }
print("Prepared aspect-fit transparent icon; source eye geometry preserved.")
