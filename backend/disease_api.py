from fastapi import APIRouter
from pydantic import BaseModel
import pandas as pd
import joblib

router = APIRouter()

# Load model + encoder
model = joblib.load(
    "disease-prediction/models/disease_model.pkl"
)

encoder = joblib.load(
    "disease-prediction/models/label_encoder.pkl"
)

# Load dataset columns
df = pd.read_csv(
    "disease-prediction/datasets/Training.csv"
)

symptom_columns = df.drop(
    "prognosis",
    axis=1
).columns


# Request body
class SymptomsRequest(BaseModel):
    symptoms: list[str]


@router.post("/predict-disease")
def predict_disease(data: SymptomsRequest):

    try:

        # Create empty symptom dictionary
        input_data = {}

        for symptom in symptom_columns:
            input_data[symptom] = 0

        # Set entered symptoms = 1
        for symptom in data.symptoms:

            symptom = symptom.strip().lower()

            if symptom in input_data:
                input_data[symptom] = 1

        # Convert to dataframe
        input_df = pd.DataFrame([input_data])

        # Predict
        prediction = model.predict(input_df)[0]

        # Decode label
        disease = encoder.inverse_transform(
            [prediction]
        )[0]

        return {
            "predicted_disease": disease
        }

    except Exception as e:

        print(e)

        return {
            "error": str(e)
        }