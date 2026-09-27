import cv2
from pathlib import Path


# =========================================================
# MODEL PATHS
# =========================================================

MODEL_DIR = (
    Path(__file__).resolve().parents[1]
    / "models"
)

YUNET_MODEL = MODEL_DIR / "face_detection_yunet_2026may.onnx"

SFACE_MODEL = MODEL_DIR / "face_recognition_sface_2021dec.onnx"


# =========================================================
# FACE DETECTION + IMAGE QUALITY
# =========================================================

def analyze_face(image_path: str) -> dict:

    image_path = Path(image_path)

    if not image_path.exists():
        return {
            "face_detected": False,
            "face_count": 0,
            "image_quality": "INVALID",
            "message": "Image file not found"
        }

    image = cv2.imread(str(image_path))

    if image is None:
        return {
            "face_detected": False,
            "face_count": 0,
            "image_quality": "INVALID",
            "message": "Unable to read image"
        }

    height, width = image.shape[:2]

    # -----------------------------------------------------
    # IMAGE QUALITY
    # -----------------------------------------------------

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    blur_score = cv2.Laplacian(
        gray,
        cv2.CV_64F
    ).var()

    if blur_score < 50:
        image_quality = "POOR"

    elif blur_score < 150:
        image_quality = "MODERATE"

    else:
        image_quality = "GOOD"

    # -----------------------------------------------------
    # CHECK YUNET MODEL
    # -----------------------------------------------------

    if not YUNET_MODEL.exists():

        return {
            "face_detected": False,
            "face_count": 0,
            "image_width": width,
            "image_height": height,
            "image_quality": image_quality,
            "blur_score": round(float(blur_score), 2),
            "message": "YuNet model not found"
        }

    # -----------------------------------------------------
    # YUNET FACE DETECTOR
    # -----------------------------------------------------

    detector = cv2.FaceDetectorYN.create(
        str(YUNET_MODEL),
        "",
        (width, height),
        0.6,
        0.3,
        5000
    )

    detector.setInputSize(
        (width, height)
    )

    _, faces = detector.detect(image)

    # -----------------------------------------------------
    # NO FACE
    # -----------------------------------------------------

    if faces is None:

        return {
            "face_detected": False,
            "face_count": 0,
            "image_width": width,
            "image_height": height,
            "image_quality": image_quality,
            "blur_score": round(
                float(blur_score),
                2
            ),
            "message": "No face detected"
        }

    # -----------------------------------------------------
    # FACE INFORMATION
    # -----------------------------------------------------

    face_list = []

    for face in faces:

        x, y, w, h = face[:4]

        confidence = float(
            face[-1]
        )

        face_list.append({
            "x": int(x),
            "y": int(y),
            "width": int(w),
            "height": int(h),
            "confidence": round(
                confidence,
                4
            )
        })

    return {
        "face_detected": True,
        "face_count": len(face_list),
        "faces": face_list,
        "image_width": width,
        "image_height": height,
        "image_quality": image_quality,
        "blur_score": round(
            float(blur_score),
            2
        ),
        "message": (
            f"{len(face_list)} face(s) "
            "detected successfully"
        )
    }


# =========================================================
# FACE EMBEDDING USING SFACE
# =========================================================

def generate_face_embedding(
    image_path: str
) -> dict:

    image_path = Path(image_path)

    if not image_path.exists():

        return {
            "success": False,
            "message": "Image file not found"
        }

    image = cv2.imread(
        str(image_path)
    )

    if image is None:

        return {
            "success": False,
            "message": "Unable to read image"
        }

    height, width = image.shape[:2]

    # -----------------------------------------------------
    # CHECK MODELS
    # -----------------------------------------------------

    if not YUNET_MODEL.exists():

        return {
            "success": False,
            "message": "YuNet model not found"
        }

    if not SFACE_MODEL.exists():

        return {
            "success": False,
            "message": "SFace model not found"
        }

    # -----------------------------------------------------
    # DETECT FACE WITH YUNET
    # -----------------------------------------------------

    detector = cv2.FaceDetectorYN.create(
        str(YUNET_MODEL),
        "",
        (width, height),
        0.6,
        0.3,
        5000
    )

    detector.setInputSize(
        (width, height)
    )

    _, faces = detector.detect(
        image
    )

    if faces is None or len(faces) == 0:

        return {
            "success": False,
            "message": "No face detected"
        }

    # -----------------------------------------------------
    # SELECT HIGHEST CONFIDENCE FACE
    # -----------------------------------------------------

    face = max(
        faces,
        key=lambda x: float(x[-1])
    )

    face_confidence = float(
        face[-1]
    )

    # -----------------------------------------------------
    # LOAD SFACE
    # -----------------------------------------------------

    recognizer = cv2.FaceRecognizerSF.create(
        str(SFACE_MODEL),
        ""
    )

    # -----------------------------------------------------
    # ALIGN + CROP FACE
    # -----------------------------------------------------

    aligned_face = recognizer.alignCrop(
        image,
        face
    )

    # -----------------------------------------------------
    # GENERATE FEATURE
    # -----------------------------------------------------

    feature = recognizer.feature(
        aligned_face
    )

    embedding = feature.flatten().tolist()

    return {
        "success": True,
        "embedding_size": len(
            embedding
        ),
        "embedding": embedding,
        "face_confidence": round(
            face_confidence,
            4
        ),
        "message": (
            "Face embedding generated "
            "successfully"
        )
    }


# =========================================================
# COMPARE TWO IMAGES
# =========================================================

def compare_faces(
    image1_path: str,
    image2_path: str
) -> dict:

    embedding1 = generate_face_embedding(
        image1_path
    )

    embedding2 = generate_face_embedding(
        image2_path
    )

    if not embedding1["success"]:

        return {
            "success": False,
            "message": (
                f"First image: "
                f"{embedding1['message']}"
            )
        }

    if not embedding2["success"]:

        return {
            "success": False,
            "message": (
                f"Second image: "
                f"{embedding2['message']}"
            )
        }

    import numpy as np

    feature1 = np.array(
        embedding1["embedding"],
        dtype=np.float32
    ).reshape(1, -1)

    feature2 = np.array(
        embedding2["embedding"],
        dtype=np.float32
    ).reshape(1, -1)

    recognizer = cv2.FaceRecognizerSF.create(
        str(SFACE_MODEL),
        ""
    )

    similarity = recognizer.match(
        feature1,
        feature2,
        cv2.FaceRecognizerSF_FR_COSINE
    )

    similarity = float(
        similarity
    )

    similarity_percent = round(
        similarity * 100,
        2
    )

    if similarity >= 0.363:
        result = "POTENTIAL_MATCH"
    else:
        result = "LOW_SIMILARITY"

    return {
        "success": True,
        "similarity": round(
            similarity,
            4
        ),
        "similarity_percent": (
            similarity_percent
        ),
        "result": result,
        "message": (
            "Face comparison completed "
            "successfully"
        )
    }


# =========================================================
# COMPARE EMBEDDING WITH DATABASE
# =========================================================

def compare_embedding_with_database(
    query_embedding: list,
    stored_embeddings: list
) -> list:

    import numpy as np

    recognizer = cv2.FaceRecognizerSF.create(
        str(SFACE_MODEL),
        ""
    )

    results = []

    query = np.array(
        query_embedding,
        dtype=np.float32
    ).reshape(1, -1)

    for item in stored_embeddings:

        try:

            candidate = np.array(
                item["embedding"],
                dtype=np.float32
            ).reshape(1, -1)

            similarity = recognizer.match(
                query,
                candidate,
                cv2.FaceRecognizerSF_FR_COSINE
            )

            similarity = float(
                similarity
            )

            results.append({
                "missing_person_id": (
                    item["missing_person_id"]
                ),
                "name": item.get("name"),

                "similarity": round(
                    similarity,
                    4
                ),

                "similarity_percent": round(
                    similarity * 100,
                    2
                )
            })

        except Exception as e:

            print(
                f"Could not compare with "
                f"{item.get('missing_person_id')}: {e}"
            )

    results.sort(
        key=lambda x: x["similarity"],
        reverse=True
    )

    return results


# =========================================================
# AGE MATCHING
# =========================================================

def calculate_age_score(
    body_age,
    person_age
) -> dict:

    if body_age is None or person_age is None:

        return {
            "score": None,
            "explanation": "Age data unavailable"
        }

    difference = abs(
        float(body_age) -
        float(person_age)
    )

    # Exact / very close ages
    if difference <= 1:
        score = 100

    elif difference <= 3:
        score = 90

    elif difference <= 5:
        score = 75

    elif difference <= 10:
        score = 50

    else:
        score = 20

    return {
        "score": score,
        "difference": round(
            difference,
            1
        ),
        "explanation": (
            f"Estimated age difference: "
            f"{round(difference, 1)} years"
        )
    }


# =========================================================
# GENDER MATCHING
# =========================================================

def calculate_gender_score(
    body_gender,
    person_gender
) -> dict:

    if not body_gender or not person_gender:

        return {
            "score": None,
            "explanation": (
                "Gender data unavailable"
            )
        }

    body_value = str(
        body_gender
    ).strip().lower()

    person_value = str(
        person_gender
    ).strip().lower()

    if body_value == person_value:

        return {
            "score": 100,
            "explanation": (
                "Gender information is consistent"
            )
        }

    return {
        "score": 0,
        "explanation": (
            "Gender information is inconsistent"
        )
    }


# =========================================================
# HEIGHT MATCHING
# =========================================================

def calculate_height_score(
    body_height,
    person_height
) -> dict:

    if (
        body_height is None
        or person_height is None
    ):

        return {
            "score": None,
            "explanation": (
                "Height data unavailable"
            )
        }

    difference = abs(
        float(body_height) -
        float(person_height)
    )

    if difference <= 2:
        score = 100

    elif difference <= 5:
        score = 90

    elif difference <= 8:
        score = 75

    elif difference <= 12:
        score = 50

    else:
        score = 20

    return {
        "score": score,
        "difference": round(
            difference,
            1
        ),
        "explanation": (
            f"Estimated height difference: "
            f"{round(difference, 1)} cm"
        )
    }


# =========================================================
# TEXT / DESCRIPTION MATCHING
# =========================================================

def calculate_text_score(
    body_description,
    person_description
) -> dict:

    if (
        not body_description
        or not person_description
    ):

        return {
            "score": None,
            "explanation": (
                "Description data unavailable"
            )
        }

    # Simple keyword-overlap baseline.
    # This is intentionally transparent and
    # can later be replaced with an embedding model.

    body_words = set(
        str(body_description)
        .lower()
        .replace(",", " ")
        .replace(".", " ")
        .split()
    )

    person_words = set(
        str(person_description)
        .lower()
        .replace(",", " ")
        .replace(".", " ")
        .split()
    )

    if not body_words or not person_words:

        return {
            "score": None,
            "explanation": (
                "Description data unavailable"
            )
        }

    common_words = (
        body_words &
        person_words
    )

    union_words = (
        body_words |
        person_words
    )

    overlap = (
        len(common_words) /
        len(union_words)
    )

    score = round(
        overlap * 100,
        2
    )

    return {
        "score": score,
        "common_terms": sorted(
            common_words
        ),
        "explanation": (
            f"Description keyword similarity: "
            f"{score}%"
        )
    }


# =========================================================
# MULTI-FACTOR OVERALL SCORE
# =========================================================

def calculate_overall_match_score(
    face_score,
    attribute_score,
    text_score
) -> dict:

    available_scores = []

    if face_score is not None:
        available_scores.append(
            ("face", float(face_score), 0.60)
        )

    if attribute_score is not None:
        available_scores.append(
            ("attribute", float(attribute_score), 0.25)
        )

    if text_score is not None:
        available_scores.append(
            ("text", float(text_score), 0.15)
        )

    if not available_scores:

        return {
            "overall_score": 0,
            "explanation": (
                "No matching signals available"
            )
        }

    total_weight = sum(
        item[2]
        for item in available_scores
    )

    weighted_score = sum(
        score * weight
        for _, score, weight
        in available_scores
    ) / total_weight

    overall_score = round(
        weighted_score,
        2
    )

    explanation_parts = []

    if face_score is not None:

        explanation_parts.append(
            f"Face: {round(face_score, 2)}%"
        )

    if attribute_score is not None:

        explanation_parts.append(
            f"Attributes: "
            f"{round(attribute_score, 2)}%"
        )

    if text_score is not None:

        explanation_parts.append(
            f"Description: "
            f"{round(text_score, 2)}%"
        )

    return {
        "overall_score": overall_score,
        "explanation": " | ".join(
            explanation_parts
        )
    }