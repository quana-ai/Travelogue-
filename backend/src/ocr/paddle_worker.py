import base64
import contextlib
import io
import json
import os
import sys
import traceback

ocr = None


def respond(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def get_ocr():
    global ocr
    if ocr is None:
        from paddleocr import PaddleOCR

        with contextlib.redirect_stdout(sys.stderr), contextlib.redirect_stderr(sys.stderr):
            ocr = PaddleOCR(
                use_doc_orientation_classify=False,
                use_doc_unwarping=False,
                use_textline_orientation=False,
            )
    return ocr


def result_text(result):
    payload = getattr(result, "json", result)
    if callable(payload):
        payload = payload()
    if isinstance(payload, str):
        payload = json.loads(payload)
    if isinstance(payload, dict):
        payload = payload.get("res", payload)
        texts = payload.get("rec_texts", [])
        return [str(text).strip() for text in texts if str(text).strip()]
    return []


def recognize(image_data):
    import numpy as np
    from PIL import Image

    image_bytes = base64.b64decode(image_data, validate=True)
    with Image.open(io.BytesIO(image_bytes)) as source:
        image = np.asarray(source.convert("RGB"))

    pipeline = get_ocr()
    with contextlib.redirect_stdout(sys.stderr), contextlib.redirect_stderr(sys.stderr):
        results = pipeline.predict(input=image)
        lines = []
        for result in results:
            lines.extend(result_text(result))
    return "\n".join(lines)


def main():
    for line in sys.stdin:
        try:
            request = json.loads(line)
            respond({"text": recognize(request["image"])})
        except Exception as error:
            traceback.print_exc(file=sys.stderr)
            respond({"error": str(error)})


if __name__ == "__main__":
    os.environ.setdefault("PADDLE_PDX_CACHE_HOME", os.path.join(os.getcwd(), ".paddlex"))
    main()
