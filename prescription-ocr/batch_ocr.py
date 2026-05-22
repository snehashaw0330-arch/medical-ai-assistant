import os
import cv2
import easyocr
import pandas as pd
from rapidfuzz import process

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

# Folder path
input_folder = "prescription-ocr/processed-images/final"

print("\n===== SMART PRESCRIPTION ANALYZER =====\n")

# Loop through all images
for image_name in os.listdir(input_folder):

    image_path = os.path.join(input_folder, image_name)

    print(f"\nProcessing: {image_name}")

    # OCR extraction
    results = reader.readtext(image_path, detail=0)

    corrected_medicines = []

    # Loop through OCR words
    for word in results:

        match = process.extractOne(
            word.lower(),
            medicine_names,
            score_cutoff=75
        )

        if match:

            medicine_name = match[0]
            confidence = match[1]

            # Remove garbage short words
            if len(medicine_name) < 4:
                continue

            # Keep only high confidence matches
            if confidence >= 85:
                corrected_medicines.append(medicine_name)

    print("\nDetected Medicines:")

    unique_medicines = list(set(corrected_medicines))

    if unique_medicines:
        for med in unique_medicines:
            print(f"- {med}")
    else:
        print("No medicine detected")

print("\nAnalysis Completed")