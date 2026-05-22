import os
import easyocr
import pandas as pd
from rapidfuzz import process
import json

# OCR Reader
reader = easyocr.Reader(['en'])

# Load medicine dataset
df = pd.read_csv(
    "datasets/medicines/medicine_dataset.csv",
    low_memory=False
)

# Clean medicine names
medicine_names = (
    df['name']
    .dropna()
    .astype(str)
    .str.lower()
    .str.replace("tablet", "", regex=False)
    .str.replace("capsule", "", regex=False)
    .str.replace("syrup", "", regex=False)
    .str.replace("mg", "", regex=False)
    .str.strip()
    .tolist()
)

# Input image
image_path = "prescription-ocr/processed-images/final/img1.jpg"

# OCR extraction
results = reader.readtext(image_path, detail=0)

detected_medicines = []

# Match OCR words with medicine dataset
for word in results:

    match = process.extractOne(
        word.lower(),
        medicine_names,
        score_cutoff=85
    )

    if match:

        medicine_name = match[0]

        if len(medicine_name) >= 4:
            detected_medicines.append(medicine_name)

# Remove duplicates
detected_medicines = list(set(detected_medicines))

# Create structured JSON
prescription_data = {
    "image": "img1.jpg",
    "medicines": detected_medicines,
    "total_detected": len(detected_medicines)
}

# Print JSON nicely
print("\n===== STRUCTURED PRESCRIPTION JSON =====\n")

print(json.dumps(
    prescription_data,
    indent=4
))