#!/usr/bin/env python3
"""
OCR bridge script for Travelogue.
Reads an image (or PDF page as PNG) from stdin or a file path argument,
runs OCR using PaddleOCR (primary) or EasyOCR (fallback),
and prints a JSON result to stdout.

Usage:
  python3 ocr_bridge.py <image_path>
  cat image.png | python3 ocr_bridge.py --stdin

Output JSON:
  { "text": "...", "confidence": 85.2, "engine": "paddleocr" }
  or on error:
  { "error": "...", "text": "", "confidence": 0, "engine": "none" }
"""
import json
import sys
import os
import tempfile

def ocr_with_paddleocr(image_path: str) -> dict:
    """Run OCR using PaddleOCR."""
    from paddleocr import PaddleOCR

    # Suppress verbose paddle logging
    import logging
    logging.getLogger('ppocr').setLevel(logging.ERROR)

    ocr = PaddleOCR(
        use_angle_cls=True,
        lang='en',
        show_log=False,
        use_gpu=False,
    )

    result = ocr.ocr(image_path, cls=True)
    if not result or not result[0]:
        return {"text": "", "confidence": 0, "engine": "paddleocr"}

    lines = []
    confidences = []
    for line_result in result[0]:
        if line_result and len(line_result) >= 2:
            text_info = line_result[1]
            if isinstance(text_info, tuple) and len(text_info) >= 2:
                text, conf = text_info[0], text_info[1]
                lines.append(text)
                confidences.append(conf * 100)  # PaddleOCR returns 0-1

    full_text = "\n".join(lines)
    avg_confidence = sum(confidences) / len(confidences) if confidences else 0

    return {
        "text": full_text,
        "confidence": round(avg_confidence, 1),
        "engine": "paddleocr",
    }


def ocr_with_easyocr(image_path: str) -> dict:
    """Run OCR using EasyOCR (fallback)."""
    import easyocr

    reader = easyocr.Reader(['en'], gpu=False, verbose=False)
    results = reader.readtext(image_path)

    if not results:
        return {"text": "", "confidence": 0, "engine": "easyocr"}

    lines = []
    confidences = []
    for (bbox, text, conf) in results:
        lines.append(text)
        confidences.append(conf * 100)

    full_text = "\n".join(lines)
    avg_confidence = sum(confidences) / len(confidences) if confidences else 0

    return {
        "text": full_text,
        "confidence": round(avg_confidence, 1),
        "engine": "easyocr",
    }


def main():
    image_path = None
    stdin_mode = False

    if len(sys.argv) > 1:
        if sys.argv[1] == "--stdin":
            stdin_mode = True
        else:
            image_path = sys.argv[1]
    else:
        print(json.dumps({"error": "No image path provided", "text": "", "confidence": 0, "engine": "none"}))
        sys.exit(1)

    # If reading from stdin, save to a temp file
    if stdin_mode:
        data = sys.stdin.buffer.read()
        if not data:
            print(json.dumps({"error": "No data received on stdin", "text": "", "confidence": 0, "engine": "none"}))
            sys.exit(1)
        tmp = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
        tmp.write(data)
        tmp.close()
        image_path = tmp.name

    if not image_path or not os.path.exists(image_path):
        print(json.dumps({"error": f"Image not found: {image_path}", "text": "", "confidence": 0, "engine": "none"}))
        sys.exit(1)

    # Try PaddleOCR first, fall back to EasyOCR
    try:
        result = ocr_with_paddleocr(image_path)
    except Exception as e:
        try:
            result = ocr_with_easyocr(image_path)
        except Exception as e2:
            result = {
                "error": f"All OCR engines failed. PaddleOCR: {e}. EasyOCR: {e2}",
                "text": "",
                "confidence": 0,
                "engine": "none",
            }

    # Clean up temp file if we created one
    if stdin_mode and image_path:
        try:
            os.unlink(image_path)
        except:
            pass

    print(json.dumps(result))


if __name__ == "__main__":
    main()

