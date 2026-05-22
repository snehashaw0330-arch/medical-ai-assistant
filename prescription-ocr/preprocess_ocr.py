import cv2
import easyocr

image_path = 'prescription-ocr/raw-images/handwritten/img1.jpg'

# Read image
img = cv2.imread(image_path)

# Resize image (important)
img = cv2.resize(img, None, fx=2, fy=2)

# Convert to grayscale
gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

# Bilateral filter (better than normal denoise)
blur = cv2.bilateralFilter(gray, 11, 17, 17)

# Adaptive threshold
thresh = cv2.adaptiveThreshold(
    blur,
    255,
    cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
    cv2.THRESH_BINARY,
    11,
    2
)

# Sharpen image
kernel = cv2.getStructuringElement(
    cv2.MORPH_RECT,
    (1, 1)
)

processed = cv2.morphologyEx(
    thresh,
    cv2.MORPH_CLOSE,
    kernel
)

# Save processed image
cv2.imwrite(
    'prescription-ocr/processed-images/processed.jpg',
    processed
)

# OCR
reader = easyocr.Reader(['en'])

result = reader.readtext(
    'prescription-ocr/processed-images/processed.jpg'
)

print("\n===== EXTRACTED TEXT =====\n")

for item in result:
    print(item[1])