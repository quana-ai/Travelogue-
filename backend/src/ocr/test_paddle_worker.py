import unittest

import numpy as np
from PIL import Image, ImageFilter

from src.ocr.paddle_worker import (
    has_document_text_layout,
    is_sharp_image,
    inspect_document_text_layout,
)


class DocumentLayoutTests(unittest.TestCase):
    def test_receipt_like_text_layout_is_a_recognition_candidate(self):
        boxes = [
            [[100, 100], [500, 100], [500, 130], [100, 130]],
            [[110, 220], [480, 220], [480, 250], [110, 250]],
            [[100, 400], [500, 400], [500, 430], [100, 430]],
            [[130, 700], [470, 700], [470, 730], [130, 730]],
        ]

        self.assertTrue(has_document_text_layout(boxes, 600, 900))

    def test_photo_without_distributed_text_is_rejected_before_recognition(self):
        self.assertFalse(has_document_text_layout([], 1200, 900))
        self.assertFalse(
            has_document_text_layout(
                [
                    [[100, 100], [400, 100], [400, 130], [100, 130]],
                    [[110, 150], [390, 150], [390, 180], [110, 180]],
                ],
                1200,
                900,
            )
        )

    def test_small_blurry_or_unreadable_scan_is_rejected_before_recognition(self):
        boxes = [
            [[5, 5], [80, 5], [80, 15], [5, 15]],
            [[5, 25], [80, 25], [80, 35], [5, 35]],
            [[5, 45], [80, 45], [80, 55], [5, 55]],
            [[5, 65], [80, 65], [80, 75], [5, 75]],
        ]

        self.assertFalse(has_document_text_layout(boxes, 120, 100))

    def test_partial_text_layout_is_marked_blurry(self):
        boxes = [
            [[100, 100], [500, 100], [500, 130], [100, 130]],
            [[100, 350], [500, 350], [500, 380], [100, 380]],
            [[100, 700], [500, 700], [500, 730], [100, 730]],
        ]

        self.assertEqual(inspect_document_text_layout(boxes, 600, 900), (False, "blurry"))

    def test_blurry_image_fails_sharpness_preflight(self):
        sharp = np.full((300, 400, 3), 255, dtype=np.uint8)
        for y in range(40, 260, 20):
            sharp[y:y + 2, 40:360] = 0
        blurry = np.asarray(
            Image.fromarray(sharp).filter(ImageFilter.GaussianBlur(radius=6))
        )

        self.assertTrue(is_sharp_image(sharp))
        self.assertFalse(is_sharp_image(blurry))


if __name__ == "__main__":
    unittest.main()
