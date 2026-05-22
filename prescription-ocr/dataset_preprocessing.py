import os
import cv2

input_folder = "./prescription-ocr/raw-images/handwritten"
output_folder = "./prescription-ocr/processed-images/final"

os.makedirs(output_folder, exist_ok=True)

for filename in os.listdir(input_folder):

    image_path = os.path.join(input_folder, filename)

    img = cv2.imread(image_path)

    if img is None:
        continue

    img = cv2.resize(img, None, fx=2, fy=2)

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    blur = cv2.bilateralFilter(gray, 11, 17, 17)

    thresh = cv2.adaptiveThreshold(
        blur,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        11,
        2
    )

    output_path = os.path.join(output_folder, filename)

    cv2.imwrite(output_path, thresh)

    print(f"Processed: {filename}")

print("Done")