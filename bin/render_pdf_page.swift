import PDFKit
import Foundation

guard CommandLine.arguments.count >= 4 else {
    fputs("Usage: render_pdf_page <pdf-path> <page-num-1-based> <out-png-path> [scale]\n", stderr)
    exit(1)
}

let pdfPath = CommandLine.arguments[1]
let pageNum = Int(CommandLine.arguments[2]) ?? 1
let outPath = CommandLine.arguments[3]
let scale = CommandLine.arguments.count >= 5 ? (Double(CommandLine.arguments[4]) ?? 1.5) : 1.5

let pdfURL = URL(fileURLWithPath: pdfPath)
guard let doc = PDFDocument(url: pdfURL) else {
    fputs("Error: cannot open PDF at \(pdfPath)\n", stderr)
    exit(2)
}

guard pageNum >= 1 && pageNum <= doc.pageCount else {
    fputs("Error: page \(pageNum) out of range (1...\(doc.pageCount))\n", stderr)
    exit(3)
}

guard let page = doc.page(at: pageNum - 1) else {
    fputs("Error: failed to load page \(pageNum)\n", stderr)
    exit(4)
}

let bounds = page.bounds(for: .mediaBox)
let targetSize = CGSize(width: bounds.width * CGFloat(scale), height: bounds.height * CGFloat(scale))
let image = page.thumbnail(of: targetSize, for: .mediaBox)

guard let tiff = image.tiffRepresentation,
      let rep = NSBitmapImageRep(data: tiff),
      let png = rep.representation(using: .png, properties: [:]) else {
    fputs("Error: failed to generate PNG data\n", stderr)
    exit(5)
}

do {
    try png.write(to: URL(fileURLWithPath: outPath))
    print("SUCCESS:\(png.count)")
} catch {
    fputs("Error: failed to write file: \(error)\n", stderr)
    exit(6)
}
