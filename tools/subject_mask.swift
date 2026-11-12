// Cut-out mask for a portrait using Apple's on-device Vision subject lifting (macOS 14+).
// usage: swift tools/subject_mask.swift photo.png mask.png
// Writes a greyscale PNG the same size as the photo: white = person, black = background.
import CoreImage
import Foundation
import Vision

let args = CommandLine.arguments
guard args.count == 3 else {
  print("usage: swift subject_mask.swift <photo> <mask.png>")
  exit(2)
}
let input = URL(fileURLWithPath: args[1])
let output = URL(fileURLWithPath: args[2])

let handler = VNImageRequestHandler(url: input)
let request = VNGenerateForegroundInstanceMaskRequest()
try handler.perform([request])
guard let observation = request.results?.first else {
  print("No subject found")
  exit(1)
}
let buffer = try observation.generateScaledMaskForImage(forInstances: observation.allInstances, from: handler)
let mask = CIImage(cvPixelBuffer: buffer)
try CIContext().writePNGRepresentation(of: mask, to: output, format: .L8, colorSpace: CGColorSpaceCreateDeviceGray())
print("mask:", CVPixelBufferGetWidth(buffer), "x", CVPixelBufferGetHeight(buffer))
