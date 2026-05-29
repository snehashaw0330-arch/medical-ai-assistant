"""Google Cloud Vision provider (alternative).

DOCUMENT_TEXT_DETECTION is Google's strongest handwriting model. Unlike the
vision-LLM providers it returns plain text + word confidences (no field
parsing), so the pipeline's field-extraction layer does the structuring.

Install: ``pip install google-cloud-vision`` and set
``GOOGLE_APPLICATION_CREDENTIALS`` to your service-account JSON path.
"""

from __future__ import annotations

from backend.ocr.providers.base import OCRSegment, OCRProvider, RawOCRResult


class GoogleVisionProvider(OCRProvider):
    name = "google_vision"

    def __init__(self) -> None:
        try:
            from google.cloud import vision  # type: ignore
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(
                "google-cloud-vision not installed. "
                "Run: pip install google-cloud-vision"
            ) from exc
        self._vision = vision
        self._client = vision.ImageAnnotatorClient()

    def extract(self, image_path: str) -> RawOCRResult:
        with open(image_path, "rb") as f:
            content = f.read()
        image = self._vision.Image(content=content)
        # Hint that the page is handwritten English.
        ctx = self._vision.ImageContext(language_hints=["en"])
        response = self._client.document_text_detection(image=image, image_context=ctx)
        if response.error.message:
            raise RuntimeError(f"Vision API error: {response.error.message}")

        annotation = response.full_text_annotation
        full_text = annotation.text if annotation else ""

        segments: list[OCRSegment] = []
        if annotation:
            for page in annotation.pages:
                for block in page.blocks:
                    for paragraph in block.paragraphs:
                        words = []
                        confs = []
                        for word in paragraph.words:
                            w = "".join(s.text for s in word.symbols)
                            words.append(w)
                            confs.append(word.confidence or 0.0)
                        line = " ".join(words).strip()
                        if line:
                            avg = sum(confs) / len(confs) if confs else None
                            segments.append(OCRSegment(text=line, confidence=avg))

        return RawOCRResult(
            provider=self.name, full_text=full_text, segments=segments
        )
