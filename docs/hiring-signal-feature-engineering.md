# Hiring-Signal Feature Engineering & Model Training Playbook

> **Status:** Living document — update as new signals are validated.
> **Owner:** ML team  
> **Last updated:** 2026-06-11

---

## Table of Contents

1. [Context & Motivation](#1-context--motivation)
2. [Available Data Signals](#2-available-data-signals)
3. [Feature Definitions & Engineering Notes](#3-feature-definitions--engineering-notes)
4. [Example Training Row](#4-example-training-row)
5. [Data Exploration Checklist](#5-data-exploration-checklist)
6. [Step-Wise Model Training Playbook](#6-step-wise-model-training-playbook)
7. [Evaluation Metrics](#7-evaluation-metrics)
8. [Common Pitfalls & Mitigations](#8-common-pitfalls--mitigations)
9. [Open Questions & Next Steps](#9-open-questions--next-steps)

---

## 1. Context & Motivation

Embedding-based skill matching successfully pairs candidates to job descriptions at a semantic
level. However, two candidates whose skill embeddings are nearly identical can receive very
different hiring outcomes. This gap means there are **structured signals beyond skills** that
influence hiring decisions.

**Goal of this document:**  
Give the team a shared vocabulary for each signal, a clear feature-engineering recipe, and a
repeatable playbook for training and iterating on a hiring-outcome prediction model.

**Target model output:**  
`hiring_outcome ∈ {0 = rejected, 1 = advanced/hired}` — binary classification, although
multi-class (rejected / shortlisted / hired) is a stretch goal noted in
[Section 6](#6-step-wise-model-training-playbook).

---

## 2. Available Data Signals

| # | Signal | Raw source | Type |
|---|--------|-----------|------|
| 1 | Skill overlap % | Candidate skills ∩ JD required skills | Numeric [0–1] |
| 2 | Missing required skills | Count of JD-required skills absent from candidate | Integer ≥ 0 |
| 3 | Years of experience | Total professional tenure | Numeric ≥ 0 |
| 4 | Relevant experience | Years in roles similar to the target role | Numeric ≥ 0 |
| 5 | Industry experience | Years in the same industry as the hiring company | Numeric ≥ 0 |
| 6 | Leadership experience | Years in roles with direct reports or P&L ownership | Numeric ≥ 0 |
| 7 | Education match | Degree level / field vs. JD requirement | Binary or ordinal |
| 8 | Certification match | Count of JD-listed certifications held by candidate | Integer ≥ 0 |
| 9 | Employment stability | Average tenure per employer | Numeric (months) |
| 10 | Embedding similarity | Cosine similarity between candidate and JD embeddings | Numeric [0–1] |

> **Why not only embeddings?**  
> Embeddings capture *what* skills exist; structured signals capture *how much*, *how long*, and
> *in what context*. Together they explain variance that either alone cannot.

---

## 3. Feature Definitions & Engineering Notes

### 3.1 `skill_overlap_pct`

```
skill_overlap_pct = |candidate_skills ∩ jd_required_skills| / |jd_required_skills|
```

- Normalise to `[0, 1]`.  
- Use the **required** skills list, not the "nice-to-have" list, as the denominator.  
- When `|jd_required_skills| == 0` (no required skills listed), set to `1.0` to avoid
  division-by-zero; flag this row for manual review.
- Consider a **weighted variant** where rare/senior skills contribute more than common ones
  (IDF weighting over the skill corpus).

---

### 3.2 `missing_required_skills`

```
missing_required_skills = |jd_required_skills| - |candidate_skills ∩ jd_required_skills|
```

- Raw integer; consider log-transforming (`log1p`) if the distribution is skewed.  
- May be highly correlated with `skill_overlap_pct`. Check VIF before including both in
  linear models; keep both in tree-based models (they capture different aspects of the gap).

---

### 3.3 `experience_gap_years`

```
experience_gap_years = jd_min_years_required - candidate_total_years_experience
```

- **Positive** → candidate is under-experienced; **negative** → over-experienced.  
- If the JD has no minimum, set `jd_min_years_required = 0` and document as "open req."  
- Clip at `[-10, +10]` to reduce outlier influence.  
- Over-experience (large negative) may also signal a mismatch; consider a quadratic term or
  absolute value variant: `abs_experience_gap_years`.

---

### 3.4 `relevant_experience_years`

- Count only roles whose title / description semantically matches the target role family
  (use the existing embedding model to score each past role against the JD).  
- Threshold: cosine similarity ≥ 0.75 qualifies a role as "relevant."  
- Adjust the threshold per role family (technical roles may need a tighter threshold).

---

### 3.5 `industry_experience_years`

- Define "same industry" via NAICS or a custom industry taxonomy.  
- Map each past employer to an industry code (can be done via company name lookup or
  candidate-provided SIC code).  
- Sum months in matching industry codes; divide by 12 for years.

---

### 3.6 `leadership_years`

- Infer from job title keywords: *manager, director, VP, head of, lead, principal, owner*,
  or from explicit "direct reports" fields if available.  
- Count the total tenure (years) across qualifying roles.  
- For IC roles (no direct reports expected) this feature should be zeroed out or the model
  trained per role-family so leadership is only scored where relevant.

---

### 3.7 `education_match`

Ordinal encoding of degree level vs. JD requirement:

| Value | Meaning |
|-------|---------|
| `-1` | Candidate degree below JD minimum |
| `0` | Exact match (or no requirement stated) |
| `1` | Candidate degree above JD minimum |

For field-of-study matching, create a secondary binary feature `education_field_match`:
- `1` if the candidate's major/field overlaps with the JD-specified field(s).  
- Use keyword list or embedding similarity for non-exact matches.

---

### 3.8 `certification_match`

```
certification_match = |candidate_certifications ∩ jd_listed_certifications|
```

- Binary (`0`/`1`) when the JD lists one or two certifications.  
- Integer count when the JD lists three or more.  
- Normalise by `|jd_listed_certifications|` for a `certification_match_pct` variant analogous
  to `skill_overlap_pct`.

---

### 3.9 `employment_stability`

```
employment_stability = mean(tenure_months per employer)
```

- Exclude internships and contract positions shorter than 3 months.  
- Current role contributes partial tenure up to the observation date.  
- Low values (< 12 months average) may indicate job-hopping; very high values (> 60 months)
  may signal risk-aversion in fast-moving roles — context-dependent.  
- Consider a `job_count_last_5_years` complementary feature to separate "stable" from
  "stagnant."

---

### 3.10 `embedding_similarity`

- Cosine similarity between the candidate's aggregated skill/bio embedding and the JD
  embedding produced by the existing embedding model.  
- Already in `[0, 1]`; no further normalisation needed.  
- This is the **anchor feature** — all other features explain *why* two candidates at the
  same `embedding_similarity` score diverge.

---

## 4. Example Training Row

Below is a fully annotated example of one training row, showing the schema the model consumes:

```json
{
  "candidate_id": "cand_abc123",
  "job_id": "job_xyz789",

  // ── Skill signals ──────────────────────────────────────────
  "skill_overlap_pct": 1.0,          // 100 % of required skills covered
  "missing_required_skills": 0,      // no gaps

  // ── Experience signals ─────────────────────────────────────
  "experience_gap_years": 3,         // 3 yrs over the JD minimum (over-qualified)
  "relevant_experience_years": 6.0,  // 6 yrs in directly relevant roles
  "industry_experience_years": 4.0,  // 4 yrs in target industry
  "leadership_years": 2,             // 2 yrs managing people or P&L

  // ── Fit signals ────────────────────────────────────────────
  "industry_match": 1,               // 1 = same industry, 0 = different
  "education_match": 1,              // 1 = above minimum degree requirement
  "education_field_match": 1,        // 1 = matching field of study
  "certification_match": 1,          // holds all listed certs

  // ── Stability signal ───────────────────────────────────────
  "employment_stability_months": 28, // avg 28 months per employer

  // ── Embedding signal ───────────────────────────────────────
  "embedding_similarity": 0.87,      // high semantic alignment

  // ── Label ──────────────────────────────────────────────────
  "hiring_outcome": 1                // 1 = advanced / hired
}
```

> **Note on the label:** `hiring_outcome` reflects the *actual* hiring decision recorded in
> the ATS. Bias in historical decisions flows directly into the label — see
> [Section 8](#8-common-pitfalls--mitigations) for mitigation strategies.

---

## 5. Data Exploration Checklist

Run through every item below before kicking off model training. Log results in an exploration
notebook (suggested: `notebooks/01_eda_hiring_signals.ipynb`).

### 5.1 Dataset Inventory

- [ ] Total rows (candidate–job pairs) with labels
- [ ] Date range of decisions; note any policy/process changes mid-period
- [ ] Label balance: `hiring_outcome == 1` prevalence (expect < 20 % for most pipelines)
- [ ] Missing value rates per feature (target < 5 % per feature; document any > 10 %)
- [ ] Number of unique jobs; number of unique candidates (leakage risk if a candidate appears
      in both train and test)

### 5.2 Univariate Analysis

For each numeric feature:
- [ ] Distribution plot (histogram + KDE)
- [ ] Median, mean, std, p5, p95
- [ ] Flag heavy tails (skewness > 2 → consider log-transform)
- [ ] Flag near-zero variance (std < 0.01 → drop or investigate)

For each binary/ordinal feature:
- [ ] Frequency table
- [ ] Proportion of `hiring_outcome == 1` per category

### 5.3 Bivariate Analysis

- [ ] Correlation matrix (Pearson for numeric; Cramér's V for categoricals)
- [ ] `skill_overlap_pct` vs. `missing_required_skills` — expect high negative correlation;
      decide which to keep for linear models
- [ ] `embedding_similarity` vs. `skill_overlap_pct` — embeddings may already encode skill
      overlap; measure redundancy
- [ ] Box plots of each feature split by `hiring_outcome`

### 5.4 Leakage & Temporal Checks

- [ ] Confirm features are computable *before* the hiring decision date
- [ ] Confirm `embedding_similarity` is from a model snapshot that predates the decision
- [ ] Split dataset chronologically (train on decisions before `YYYY-MM-DD`, test after) to
      simulate deployment conditions; **do not random-split**

### 5.5 Fairness Audit (Pre-Model)

- [ ] Compute `hiring_outcome == 1` rate per demographic group (if available) — flag groups
      with rates more than 2× the overall rate for post-model disparate-impact analysis
- [ ] Check feature distributions per group; proxy features (e.g. certain degree fields) may
      encode demographic information

---

## 6. Step-Wise Model Training Playbook

Follow the steps in order. Complete each step's exit criteria before advancing.

---

### Step 0 — Environment Setup

```bash
# Install Python deps
uv sync

# Install ML extras (add to pyproject.toml if not present)
uv add scikit-learn pandas numpy matplotlib seaborn shap imbalanced-learn

# Create notebook directory
mkdir -p notebooks
```

Suggested directory layout for this effort:

```
notebooks/
  01_eda_hiring_signals.ipynb
  02_baseline_model.ipynb
  03_feature_selection.ipynb
  04_tuning_and_evaluation.ipynb
  05_fairness_analysis.ipynb
app/ml/
  hiring_predictor.py       # inference wrapper
  feature_builder.py        # builds a feature dict from raw candidate/job objects
tests/
  features/
    test_hiring_predictor.py
```

---

### Step 1 — Build the Training Dataset

**Goal:** Produce a clean `DataFrame` with all features and labels.

1. Query the ATS/database for all candidate–job decision records with a known outcome.
2. For each record, call `feature_builder.build(candidate, job)` → returns the feature dict
   from [Section 4](#4-example-training-row).
3. Save as `data/hiring_signals_raw.parquet` (gitignored).
4. Run the [Data Exploration Checklist](#5-data-exploration-checklist) in
   `notebooks/01_eda_hiring_signals.ipynb`.

**Exit criteria:**
- Dataset has ≥ 500 labelled rows (ideally ≥ 2 000)
- Missing rate < 10 % per feature
- No target leakage identified

---

### Step 2 — Baseline Model (Logistic Regression)

**Goal:** Establish a simple, interpretable baseline to beat.

```python
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import StratifiedGroupKFold

FEATURES = [
    "skill_overlap_pct", "missing_required_skills", "experience_gap_years",
    "relevant_experience_years", "industry_experience_years", "leadership_years",
    "industry_match", "education_match", "education_field_match",
    "certification_match", "employment_stability_months", "embedding_similarity",
]
TARGET = "hiring_outcome"

pipeline = Pipeline([
    ("scaler", StandardScaler()),
    ("clf", LogisticRegression(class_weight="balanced", max_iter=1000)),
])

# Use StratifiedGroupKFold with group=candidate_id to prevent candidate-level leakage
cv = StratifiedGroupKFold(n_splits=5)
```

**Metrics to record:**
- ROC-AUC, Average Precision (PR-AUC), F1 @ 0.5 threshold
- Calibration curve — the model's probability output will be used downstream as a ranking
  score, so calibration matters

**Exit criteria:**
- ROC-AUC > 0.65 on held-out fold  
- Model coefficients are directionally sensible (e.g. `skill_overlap_pct` coefficient > 0)

---

### Step 3 — Feature Selection & Importance

**Goal:** Remove redundant or noisy features to improve generalisation and reduce maintenance.

```python
import shap

# Train a Random Forest to get feature importances
from sklearn.ensemble import RandomForestClassifier

rf = RandomForestClassifier(n_estimators=200, class_weight="balanced", random_state=42)
rf.fit(X_train, y_train)

explainer = shap.TreeExplainer(rf)
shap_values = explainer.shap_values(X_val)
shap.summary_plot(shap_values[1], X_val, feature_names=FEATURES)
```

**Decision rules:**
- Drop features with mean |SHAP| < 0.005 across the validation set
- If `skill_overlap_pct` and `missing_required_skills` have VIF > 10 in the linear model,
  keep only `skill_overlap_pct` (it's bounded [0,1] and easier to explain)
- Document every dropped feature and the reason — they may become relevant as the dataset grows

**Exit criteria:**
- Final feature list documented and frozen for Step 4
- No feature pair with Pearson |r| > 0.95 remaining in the set

---

### Step 4 — Model Selection & Hyperparameter Tuning

**Goal:** Find the best model architecture for the feature set.

Candidates to compare:

| Model | Pros | Cons |
|-------|------|------|
| Logistic Regression | Interpretable, calibrated | Misses interactions |
| Gradient Boosting (XGBoost / LightGBM) | Handles interactions, robust to scale | Less interpretable |
| Random Forest | Stable, low variance | Slower inference |
| MLP (shallow) | Can learn nonlinear combos | Needs more data, harder to debug |

```python
from sklearn.model_selection import RandomizedSearchCV
from xgboost import XGBClassifier

param_dist = {
    "n_estimators": [100, 300, 500],
    "max_depth": [3, 4, 6],
    "learning_rate": [0.01, 0.05, 0.1],
    "subsample": [0.7, 0.8, 1.0],
    "scale_pos_weight": [5, 10, 20],  # handles class imbalance
}

search = RandomizedSearchCV(
    XGBClassifier(eval_metric="aucpr", random_state=42),
    param_distributions=param_dist,
    n_iter=40,
    scoring="average_precision",
    cv=cv,
    n_jobs=-1,
    random_state=42,
)
search.fit(X_train, y_train, groups=groups_train)
```

**Handling class imbalance options (pick one, compare):**
1. `class_weight="balanced"` / `scale_pos_weight`
2. SMOTE oversampling (from `imbalanced-learn`) — apply only inside the CV fold, not before
3. Threshold tuning on calibrated probabilities

**Exit criteria:**
- Best model ROC-AUC ≥ 0.72 on held-out test set (chronologically split)
- PR-AUC ≥ 0.40
- Model file serialised to `app/ml/hiring_predictor.pkl`

---

### Step 5 — Calibration & Threshold Selection

**Goal:** Ensure probability outputs mean what they say and set an operating threshold.

```python
from sklearn.calibration import CalibratedClassifierCV, calibration_curve

# Wrap the best model in Platt scaling / isotonic calibration
calibrated = CalibratedClassifierCV(best_model, cv="prefit", method="isotonic")
calibrated.fit(X_cal, y_cal)  # calibration set (held-out, not used in tuning)

# Plot calibration curve
prob_true, prob_pred = calibration_curve(y_test, calibrated.predict_proba(X_test)[:, 1], n_bins=10)
```

**Threshold selection:**
- Plot Precision-Recall tradeoff across thresholds
- Choose threshold that maximises **F-beta** where beta reflects business priority
  (beta > 1 = recall matters more; beta < 1 = precision matters more)
- Document chosen threshold and business rationale

**Exit criteria:**
- Calibration curve visually close to the diagonal (Brier score < 0.15)
- Threshold documented with explicit recall / precision at that threshold

---

### Step 6 — Fairness & Bias Evaluation

**Goal:** Confirm the model does not amplify demographic disparities present in historical data.

```python
# Using fairlearn
from fairlearn.metrics import MetricFrame, selection_rate, false_negative_rate

mf = MetricFrame(
    metrics={"selection_rate": selection_rate, "fnr": false_negative_rate},
    y_true=y_test,
    y_pred=predictions,
    sensitive_features=sensitive_df,  # e.g. gender, race if available; use proxies otherwise
)
mf.by_group
```

**Red flags to act on:**
- Selection rate disparity ratio > 0.8 (80 % rule)
- False-negative rate gap > 0.10 across groups (model systematically screening out one group)

**Mitigations if issues found:**
- Adversarial debiasing (fairlearn `ExponentiatedGradient`)
- Remove or re-weight proxy features
- Post-processing threshold adjustment per group

**Exit criteria:**
- Fairness report documented in `notebooks/05_fairness_analysis.ipynb`
- Any disparities above thresholds have an acknowledged mitigation plan

---

### Step 7 — Integration & Serving

**Goal:** Wrap the model for use inside the Keera backend.

```python
# app/ml/feature_builder.py
from dataclasses import dataclass
import numpy as np

@dataclass
class HiringFeatures:
    skill_overlap_pct: float
    missing_required_skills: int
    experience_gap_years: float
    relevant_experience_years: float
    industry_experience_years: float
    leadership_years: float
    industry_match: int
    education_match: int
    education_field_match: int
    certification_match: int
    employment_stability_months: float
    embedding_similarity: float

    def to_array(self) -> np.ndarray:
        return np.array([[
            self.skill_overlap_pct, self.missing_required_skills,
            self.experience_gap_years, self.relevant_experience_years,
            self.industry_experience_years, self.leadership_years,
            self.industry_match, self.education_match, self.education_field_match,
            self.certification_match, self.employment_stability_months,
            self.embedding_similarity,
        ]])
```

```python
# app/ml/hiring_predictor.py
import pickle
from pathlib import Path
from .feature_builder import HiringFeatures

_MODEL_PATH = Path(__file__).parent / "hiring_predictor.pkl"

class HiringPredictor:
    def __init__(self):
        with open(_MODEL_PATH, "rb") as f:
            self._model = pickle.load(f)

    def predict_proba(self, features: HiringFeatures) -> float:
        """Return P(hiring_outcome=1) for a candidate–job pair."""
        return float(self._model.predict_proba(features.to_array())[0, 1])
```

Wire a route in `routes/web.py` to expose this as `/api/hiring-score` if needed by the frontend.

**Exit criteria:**
- Unit tests in `tests/features/test_hiring_predictor.py` pass
- P50 inference latency < 20 ms (measured locally)
- Model version and training date stored in the pickle metadata

---

### Step 8 — Monitoring & Iteration

Once deployed, track:

| Metric | Target | Action if breached |
|--------|--------|--------------------|
| Score distribution drift (PSI) | PSI < 0.1 | Investigate new data distribution |
| Label quality (if feedback loop exists) | > 90 % of labels within 30 days | Alert data-eng |
| Model ROC-AUC on fresh labels | ≥ 0.70 | Trigger re-training pipeline |
| Feature missing rate | < 5 % per feature | Alert enrichment pipeline |

Set a **scheduled re-training run** (quarterly minimum, monthly preferred) as the dataset grows.

---

## 7. Evaluation Metrics

| Metric | Why it matters here |
|--------|-------------------|
| **ROC-AUC** | Threshold-agnostic ranking quality; the primary headline metric |
| **PR-AUC (Average Precision)** | Critical when positive class is rare (< 20 %); AUC can look great even if precision is poor |
| **F-beta @ chosen threshold** | Ties the model to business priorities (recruit more / filter more) |
| **Calibration (Brier score)** | Probability outputs are used as a ranking score downstream |
| **Fairness: selection-rate ratio** | Regulatory and ethical requirement |
| **Fairness: FNR gap** | Ensures no group is systematically screened out |

---

## 8. Common Pitfalls & Mitigations

### Temporal Leakage
**Problem:** Random train/test splits allow future information to inform past predictions.  
**Mitigation:** Always split chronologically; use `StratifiedGroupKFold` with `group=candidate_id` inside the training window.

### Label Bias (Historical Hiring Decisions)
**Problem:** Past hiring decisions reflect recruiter biases, not ground-truth candidate quality.  
**Mitigation:** Treat the model as a *decision-support* tool, not a decision-maker. Surface SHAP explanations per prediction. Audit outputs quarterly.

### Skill Vocabulary Drift
**Problem:** Skill names change over time ("React" → "React 18", "ML" → "GenAI"). Old matches break.  
**Mitigation:** Use embedding similarity (Step 10) rather than exact string match for skill overlap when skill vocabulary drifts.

### Over-Indexing on `embedding_similarity`
**Problem:** If `embedding_similarity` is the dominant feature, the structured features add no value over the existing embedding model.  
**Mitigation:** Evaluate feature importance without `embedding_similarity`; the structured features should contribute meaningfully even after it is removed.

### Class Imbalance
**Problem:** Most candidates are rejected; a model that always predicts rejection has high accuracy but is useless.  
**Mitigation:** Never report accuracy alone. Use PR-AUC and F-beta. Apply `class_weight="balanced"` or SMOTE.

### Feature–Label Alignment
**Problem:** Feature values computed at a different point in time than the label date.  
**Mitigation:** All features must reflect the candidate's profile *as of the application date*, not the current profile snapshot.

---

## 9. Open Questions & Next Steps

| # | Question | Owner | Priority |
|---|----------|-------|----------|
| 1 | What is the minimum viable dataset size before training is meaningful? | ML team | High |
| 2 | Should `leadership_years` be zeroed for IC roles, or trained per role-family? | ML + Product | High |
| 3 | Which demographic attributes are available for fairness analysis? | Data Eng | High |
| 4 | Is there a feedback loop from hiring managers to label quality (e.g. "hired but poor fit")? | PM + Product | Medium |
| 5 | Should we move to multi-class labels (rejected / shortlisted / hired)? | PM | Medium |
| 6 | What is the acceptable inference latency budget in the candidate-ranking flow? | Engineering | Medium |
| 7 | Can we enrich `industry_experience_years` via LinkedIn/company-data APIs? | Data Eng | Low |
| 8 | Is `employment_stability` penalised unfairly for people who took career breaks? | Fairness review | Low |

---

*End of document. Raise a PR to update signals, thresholds, or playbook steps as the model evolves.*
