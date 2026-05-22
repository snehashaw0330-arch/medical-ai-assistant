import easyocr

# Load OCR model
reader = easyocr.Reader(['en'])

# Read image
result = reader.readtext('prescription-ocr/raw-images/handwritten/img1.jpg')

# Print detected text
for item in result:
    print(item[1])