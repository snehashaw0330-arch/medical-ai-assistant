"""Production training pipeline for the disease-prediction model.

Run from the repo root:  python disease-prediction/train_model.py

What this does differently from a naive ``RandomForest().fit()``:

* Cleans the dataset (drops the junk trailing ``Unnamed`` column that was being
  trained as a phantom feature).
* Reports the duplicate-row problem and evaluates on DEDUPLICATED data with
  StratifiedKFold so the score reflects generalization, not memorization.
* Compares several models on honest metrics (macro-F1, log-loss, top-1/top-3).
* Calibrates probabilities (CalibratedClassifierCV) so confidence scores mean
  something instead of RandomForest's clumped pseudo-probabilities.
* Persists ONE versioned bundle (model + classes + feature names + symptom/
  disease co-occurrence stats used for explainability and suggestions).
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import f1_score, log_loss, top_k_accuracy_score
from sklearn.model_selection import StratifiedKFold, cross_val_predict
from sklearn.preprocessing import LabelEncoder

ROOT = Path(__file__).resolve().parent.parent
TRAIN_CSV = ROOT / "disease-prediction" / "datasets" / "Training.csv"
OUT_DIR = ROOT / "disease-prediction" / "models"
BUNDLE_PATH = OUT_DIR / "disease_bundle.pkl"


def load_clean() -> tuple[pd.DataFrame, pd.Series]:
    df = pd.read_csv(TRAIN_CSV)
    junk = [c for c in df.columns if str(c).startswith("Unnamed")]
    if junk:
        print(f"[clean] dropping junk columns: {junk}")
        df = df.drop(columns=junk)
    df.columns = [c.strip() for c in df.columns]
    y = df["prognosis"].astype(str).str.strip()
    X = df.drop(columns=["prognosis"]).fillna(0).astype(int)
    return X, y


def report_data_quality(X: pd.DataFrame, y: pd.Series) -> pd.DataFrame:
    full = X.assign(prognosis=y)
    dup = full.duplicated().sum()
    print("\n===== DATA QUALITY =====")
    print(f"rows={len(full)}  features={X.shape[1]}  diseases={y.nunique()}")
    print(f"duplicate rows: {dup} ({dup/len(full)*100:.1f}%)  -> "
          f"{len(full)-dup} unique")
    print("avg symptoms/row:", round(X.sum(axis=1).mean(), 1))
    # Deduplicate for honest evaluation.
    uniq = full.drop_duplicates().reset_index(drop=True)
    print(f"[eval] using {len(uniq)} unique rows for cross-validation")
    return uniq


def evaluate(models: dict, Xu: np.ndarray, yu_enc: np.ndarray, classes) -> dict:
    n_classes = len(classes)
    min_class = np.bincount(yu_enc).min()
    cv = StratifiedKFold(n_splits=min(3, int(min_class)), shuffle=True, random_state=42)
    results = {}
    print("\n===== MODEL COMPARISON (deduplicated, stratified CV) =====")
    print(f"{'model':<22}{'top1':>8}{'top3':>8}{'macroF1':>10}{'logloss':>10}")
    for name, clf in models.items():
        proba = cross_val_predict(clf, Xu, yu_enc, cv=cv, method="predict_proba")
        pred = proba.argmax(1)
        top1 = (pred == yu_enc).mean()
        top3 = top_k_accuracy_score(yu_enc, proba, k=3, labels=range(n_classes))
        f1 = f1_score(yu_enc, pred, average="macro")
        ll = log_loss(yu_enc, proba, labels=range(n_classes))
        results[name] = {"top1": top1, "top3": top3, "macro_f1": f1, "log_loss": ll}
        print(f"{name:<22}{top1:>8.3f}{top3:>8.3f}{f1:>10.3f}{ll:>10.3f}")
    return results


def cooccurrence(X: pd.DataFrame, y: pd.Series, classes) -> np.ndarray:
    """P(symptom | disease): row per class, col per symptom. For explanations."""
    mat = np.zeros((len(classes), X.shape[1]))
    for i, c in enumerate(classes):
        mat[i] = X[y == c].mean(axis=0).values
    return mat


def main() -> None:
    X, y = load_clean()
    feature_names = list(X.columns)
    uniq = report_data_quality(X, y)

    Xu = uniq.drop(columns=["prognosis"]).values
    le = LabelEncoder()
    yu_enc = le.fit_transform(uniq["prognosis"])
    classes = list(le.classes_)

    candidates = {
        "logreg": LogisticRegression(max_iter=2000, C=1.0),
        "random_forest": RandomForestClassifier(n_estimators=300, random_state=42),
        "hist_gbdt": HistGradientBoostingClassifier(random_state=42),
    }
    metrics = evaluate(candidates, Xu, yu_enc, classes)

    # Pick best by macro-F1, tie-break on log-loss.
    best_name = min(metrics, key=lambda k: (-metrics[k]["macro_f1"], metrics[k]["log_loss"]))
    print(f"\n[select] best base model: {best_name}")

    # Calibrate the winner for trustworthy confidence scores.
    min_class = int(np.bincount(yu_enc).min())
    calib = CalibratedClassifierCV(
        candidates[best_name],
        method="sigmoid",
        cv=min(3, min_class),
    )
    calib.fit(Xu, yu_enc)

    bundle = {
        "version": 2,
        "model": calib,
        "base_model": best_name,
        "classes": classes,
        "feature_names": feature_names,
        "cooccurrence": cooccurrence(X, y, classes),   # P(symptom|disease)
        "prevalence": X.mean(axis=0).values,           # P(symptom) overall
        "metrics": metrics,
        "metadata": {
            "trained_at": datetime.now(timezone.utc).isoformat(),
            "n_rows": int(len(X)),
            "n_unique_rows": int(len(uniq)),
            "n_features": len(feature_names),
            "n_classes": len(classes),
            "sklearn": __import__("sklearn").__version__,
        },
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(bundle, BUNDLE_PATH)
    print(f"\n[save] bundle -> {BUNDLE_PATH}")
    print(json.dumps(bundle["metadata"], indent=2))


if __name__ == "__main__":
    main()
