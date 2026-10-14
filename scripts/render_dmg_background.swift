import Cocoa

let width: CGFloat = 660
let height: CGFloat = 400
let scale: CGFloat = 2.0 // @2x Retina

let imageSize = NSSize(width: width * scale, height: height * scale)
let image = NSImage(size: imageSize)

image.lockFocus()

guard let context = NSGraphicsContext.current?.cgContext else {
    fatalError("Failed to get graphics context")
}

// Scale for retina
context.scaleBy(x: scale, y: scale)

// In Cocoa, (0,0) is bottom-left. Let's flip coordinate system to top-left for easier positioning
context.translateBy(x: 0, y: height)
context.scaleBy(x: 1.0, y: -1.0)

// 1. Background Gradient
let colorSpace = CGColorSpaceCreateDeviceRGB()
let bgColors = [
    CGColor(red: 16/255.0, green: 24/255.0, blue: 40/255.0, alpha: 1.0), // #101828
    CGColor(red: 10/255.0, green: 14/255.0, blue: 23/255.0, alpha: 1.0), // #0a0e17
    CGColor(red: 6/255.0, green: 9/255.0, blue: 15/255.0, alpha: 1.0)     // #06090f
] as CFArray
let locations: [CGFloat] = [0.0, 0.6, 1.0]
if let gradient = CGGradient(colorsSpace: colorSpace, colors: bgColors, locations: locations) {
    context.drawRadialGradient(
        gradient,
        startCenter: CGPoint(x: width / 2, y: 120),
        startRadius: 20,
        endCenter: CGPoint(x: width / 2, y: height / 2),
        endRadius: 400,
        options: [.drawsBeforeStartingLocation, .drawsAfterEndingLocation]
    )
}

// 2. Subtle Grid Pattern
context.setStrokeColor(CGColor(red: 1.0, green: 1.0, blue: 1.0, alpha: 0.03))
context.setLineWidth(1.0)
let gridSize: CGFloat = 24.0
for x in stride(from: 0, through: width, by: gridSize) {
    context.move(to: CGPoint(x: x, y: 0))
    context.addLine(to: CGPoint(x: x, y: height))
}
for y in stride(from: 0, through: height, by: gridSize) {
    context.move(to: CGPoint(x: 0, y: y))
    context.addLine(to: CGPoint(x: width, y: y))
}
context.strokePath()

// 3. Glowing Ambient Circles behind icon targets
func drawGlow(center: CGPoint, radius: CGFloat, color: CGColor) {
    context.saveGState()
    let glowColors = [color, CGColor(red: 0, green: 0, blue: 0, alpha: 0)] as CFArray
    if let glowGrad = CGGradient(colorsSpace: colorSpace, colors: glowColors, locations: [0.0, 1.0]) {
        context.drawRadialGradient(glowGrad, startCenter: center, startRadius: 0, endCenter: center, endRadius: radius, options: [])
    }
    context.restoreGState()
}

// Left glow (Cyan) & Right glow (Indigo)
drawGlow(
    center: CGPoint(x: 180, y: 170),
    radius: 120,
    color: CGColor(red: 56/255.0, green: 189/255.0, blue: 248/255.0, alpha: 0.20)
)
drawGlow(
    center: CGPoint(x: 480, y: 170),
    radius: 120,
    color: CGColor(red: 99/255.0, green: 102/255.0, blue: 241/255.0, alpha: 0.20)
)

// 4. Subtle Dashed Target Outlines for Icon Drop Zones
func drawTargetBox(center: CGPoint, strokeColor: CGColor, fillColor: CGColor) {
    let boxSize: CGFloat = 132
    let rect = CGRect(x: center.x - boxSize/2, y: center.y - boxSize/2, width: boxSize, height: boxSize)
    let path = CGPath(roundedRect: rect, cornerWidth: 26, cornerHeight: 26, transform: nil)
    
    // Fill
    context.setFillColor(fillColor)
    context.addPath(path)
    context.fillPath()
    
    // Dashed Stroke
    context.setStrokeColor(strokeColor)
    context.setLineWidth(1.5)
    let dash: [CGFloat] = [6.0, 5.0]
    context.setLineDash(phase: 0, lengths: dash)
    context.addPath(path)
    context.strokePath()
    context.setLineDash(phase: 0, lengths: [])
}

drawTargetBox(
    center: CGPoint(x: 180, y: 170),
    strokeColor: CGColor(red: 56/255.0, green: 189/255.0, blue: 248/255.0, alpha: 0.35),
    fillColor: CGColor(red: 56/255.0, green: 189/255.0, blue: 248/255.0, alpha: 0.03)
)
drawTargetBox(
    center: CGPoint(x: 480, y: 170),
    strokeColor: CGColor(red: 99/255.0, green: 102/255.0, blue: 241/255.0, alpha: 0.35),
    fillColor: CGColor(red: 99/255.0, green: 102/255.0, blue: 241/255.0, alpha: 0.03)
)

// 5. Arrow & Flow in Center
context.saveGState()
// Shadow/Glow for arrow
context.setShadow(
    offset: CGSize(width: 0, height: 0),
    blur: 14.0,
    color: CGColor(red: 56/255.0, green: 189/255.0, blue: 248/255.0, alpha: 0.6)
)

let arrowPath = CGMutablePath()
let startX: CGFloat = 280
let endX: CGFloat = 375
let arrowY: CGFloat = 166

arrowPath.move(to: CGPoint(x: startX, y: arrowY))
arrowPath.addLine(to: CGPoint(x: endX, y: arrowY))

// Arrow head
arrowPath.move(to: CGPoint(x: endX - 16, y: arrowY - 14))
arrowPath.addLine(to: CGPoint(x: endX, y: arrowY))
arrowPath.addLine(to: CGPoint(x: endX - 16, y: arrowY + 14))

context.addPath(arrowPath)
context.setStrokeColor(CGColor(red: 56/255.0, green: 189/255.0, blue: 248/255.0, alpha: 0.95))
context.setLineWidth(5.0)
context.setLineCap(.round)
context.setLineJoin(.round)
context.strokePath()
context.restoreGState()

// Flip context back for drawing text with NSAttributedString (NSAttributedString uses standard AppKit coords)
context.scaleBy(x: 1.0, y: -1.0)
context.translateBy(x: 0, y: -height)

// 6. Text Elements using AppKit
func drawText(_ text: String, point: CGPoint, font: NSFont, color: NSColor, alignCenter: Bool = false) {
    let style = NSMutableParagraphStyle()
    if alignCenter { style.alignment = .center }
    let attrs: [NSAttributedString.Key: Any] = [
        .font: font,
        .foregroundColor: color,
        .paragraphStyle: style
    ]
    let str = NSAttributedString(string: text, attributes: attrs)
    let size = str.size()
    let drawPoint = alignCenter ? CGPoint(x: point.x - size.width/2, y: point.y - size.height/2) : point
    str.draw(at: drawPoint)
}

// Top Title & Subtitle
// Remember in AppKit flipped context: y=0 is bottom, so top is y = height - 40
drawText("DriveMate", point: CGPoint(x: width/2 - 38, y: height - 38), font: NSFont.systemFont(ofSize: 19, weight: .bold), color: NSColor.white, alignCenter: false)
drawText("PRO", point: CGPoint(x: width/2 + 54, y: height - 36), font: NSFont.systemFont(ofSize: 10, weight: .black), color: NSColor(calibratedRed: 0.22, green: 0.74, blue: 0.97, alpha: 1.0), alignCenter: false)

drawText("Drag DriveMate into Applications to install", point: CGPoint(x: width/2, y: height - 64), font: NSFont.systemFont(ofSize: 13, weight: .medium), color: NSColor(calibratedWhite: 0.75, alpha: 1.0), alignCenter: true)

// Text below Arrow
drawText("DRAG & DROP", point: CGPoint(x: 330, y: height - 204), font: NSFont.systemFont(ofSize: 10, weight: .heavy), color: NSColor(calibratedWhite: 0.55, alpha: 1.0), alignCenter: true)

// Footer text
drawText("High-Speed Public Google Drive Downloader • 100% Native Desktop App", point: CGPoint(x: width/2, y: 24), font: NSFont.systemFont(ofSize: 11, weight: .regular), color: NSColor(calibratedWhite: 0.40, alpha: 1.0), alignCenter: true)

image.unlockFocus()

// Save PNG
guard let tiffData = image.tiffRepresentation,
      let bitmap = NSBitmapImageRep(data: tiffData),
      let pngData = bitmap.representation(using: .png, properties: [:]) else {
    fatalError("Failed to convert image to PNG")
}

let outputPath = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "desktop/dmg-background.png"
let outputURL = URL(fileURLWithPath: outputPath)
try pngData.write(to: outputURL)
print("✅ DMG background rendered successfully to: \(outputPath) (\(Int(imageSize.width))x\(Int(imageSize.height)))")
