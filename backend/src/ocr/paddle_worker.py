import base64
import contextlib
import io
import json
import os
import sys
import traceback

detector = None
ocr = None


def respond(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def result_payload(result):
    payload = getattr(result, "json", result)
    if callable(payload):
        payload = payload()
    if isinstance(payload, str):
        payload = json.loads(payload)
    if isinstance(payload, dict):
        return payload.get("res", payload)
    return {}


def get_detector():
    global detector
    if detector is None:
        from paddleocr import TextDetection

        with contextlib.redirect_stdout(sys.stderr), contextlib.redirect_stderr(sys.stderr):
            detector = TextDetection(model_name="PP-OCRv5_server_det", device="cpu")
    return detector


def get_ocr():
    global ocr
    if ocr is None:
        from paddleocr import PaddleOCR

        with contextlib.redirect_stdout(sys.stderr), contextlib.redirect_stderr(sys.stderr):
            ocr = PaddleOCR(
                text_detection_model_name="PP-OCRv5_server_det",
                text_recognition_model_name="en_PP-OCRv5_mobile_rec",
                use_doc_orientation_classify=False,
                use_doc_unwarping=False,
                use_textline_orientation=False,
                device="cpu",
            )
    return ocr


def decode_image(image_data):
    import numpy as np
    from PIL import Image

    image_bytes = base64.b64decode(image_data, validate=True)
    with Image.open(io.BytesIO(image_bytes)) as source:
        rgb = source.convert("RGB")
        return np.asarray(rgb), rgb.size


def has_document_text_layout(boxes, width, height):
    return inspect_document_text_layout(boxes, width, height)[0]


def inspect_document_text_layout(boxes, width, height):
    if min(width, height) < 160:
        return False, "unreadable"
    if len(boxes) < 2:
        return False, "unreadable"

    x_coordinates = []
    y_coordinates = []
    for polygon in boxes:
        points = polygon.tolist() if hasattr(polygon, "tolist") else polygon
        if not points:
            continue
        x_coordinates.extend(float(point[0]) for point in points)
        y_coordinates.extend(float(point[1]) for point in points)

    if len(y_coordinates) < 4:
        return False, "unreadable"

    vertical_coverage = (max(y_coordinates) - min(y_coordinates)) / height
    horizontal_coverage = (max(x_coordinates) - min(x_coordinates)) / width
    if len(boxes) >= 4 and vertical_coverage >= 0.18 and horizontal_coverage >= 0.12:
        return True, "readable"
    if vertical_coverage >= 0.10 and horizontal_coverage >= 0.08:
        return False, "blurry"
    return False, "unreadable"


def is_sharp_image(image):
    import numpy as np

    gray = np.dot(image[..., :3], [0.299, 0.587, 0.114]).astype(np.float32)
    if min(gray.shape) < 3:
        return False
    laplacian = (
        4 * gray[1:-1, 1:-1]
        - gray[:-2, 1:-1]
        - gray[2:, 1:-1]
        - gray[1:-1, :-2]
        - gray[1:-1, 2:]
    )
    return float(laplacian.var()) >= 8


def detect_document_candidate(image_data):
    image, (width, height) = decode_image(image_data)
    if min(width, height) < 160:
        return False, "unreadable"

    with contextlib.redirect_stdout(sys.stderr), contextlib.redirect_stderr(sys.stderr):
        results = get_detector().predict(input=image)
    boxes = []
    for result in results:
        payload = result_payload(result)
        boxes.extend(payload.get("dt_polys", []))
    candidate, quality = inspect_document_text_layout(boxes, width, height)
    if candidate and not is_sharp_image(image):
        return False, "blurry"
    return candidate, quality


def recognize(image_data):
    image, _ = decode_image(image_data)
    with contextlib.redirect_stdout(sys.stderr), contextlib.redirect_stderr(sys.stderr):
        results = get_ocr().predict(input=image)
    texts = []
    scores = []
    for result in results:
        payload = result_payload(result)
        for text in payload.get("rec_texts", []):
            cleaned = str(text).strip()
            if cleaned:
                texts.append(cleaned)
        for score in payload.get("rec_scores", []):
            try:
                scores.append(float(score))
            except (TypeError, ValueError):
                continue
    confidence = sum(scores) / len(scores) * 100 if scores else 0
    return {"text": "\n".join(texts), "confidence": confidence}


def main():
    for line in sys.stdin:
        try:
            request = json.loads(line)
            mode = request.get("mode")
            if mode == "detect":
                candidate, quality = detect_document_candidate(request["image"])
                respond({"candidate": candidate, "quality": quality})
            elif mode == "recognize":
                respond(recognize(request["image"]))
            else:
                raise ValueError("Unsupported PaddleOCR worker operation.")
        except Exception as error:
            traceback.print_exc(file=sys.stderr)
            respond({"error": str(error)})


if __name__ == "__main__":
    os.environ.setdefault("PADDLE_PDX_CACHE_HOME", os.path.join(os.getcwd(), ".paddlex"))
    main()
