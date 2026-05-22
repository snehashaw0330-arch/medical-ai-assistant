import pandas as pd
from rapidfuzz import process

# Load medicine dataset
df = pd.read_csv("datasets/medicines/medicine_dataset.csv")

# Get medicine names
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

# OCR output samples
ocr_words = [
    "Paracetmol",
    "Azitromicin",
    "Amoxilin",
    "Dolo650"
]

print("\n===== MEDICINE MATCHING =====\n")

for word in ocr_words:
    match = process.extractOne(
    word.lower(),
    medicine_names,
    score_cutoff=70
)

    if match:
        print(f"OCR Word      : {word}")
        print(f"Matched Drug  : {match[0]}")
        print(f"Confidence    : {match[1]}")
        print("-----------------------------")