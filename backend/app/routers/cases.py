import uuid
import json
from pathlib import Path

from fastapi import (
    APIRouter,
    Depends,
    UploadFile,
    File,
    HTTPException
)

from sqlalchemy.orm import Session

from app.database import get_db

from app.models import (
    Case,
    User,
    MissingPerson,
    UnidentifiedBody,
    Match
)

from app.schemas import (
    MissingPersonCreate,
    UnidentifiedBodyCreate
)

from app.ai.face_service import (
    generate_face_embedding,
    compare_embedding_with_database
)


router = APIRouter(
    prefix="/cases",
    tags=["Cases"]
)


# =========================================================
# CONFIGURATION
# =========================================================

# OpenCV SFace reference threshold.
# This is used only to classify a result as a potential match.
HIGH_SIMILARITY_THRESHOLD = 0.75
REVIEW_SIMILARITY_THRESHOLD = 0.50

def classify_similarity(similarity: float) -> str:
    if similarity >= HIGH_SIMILARITY_THRESHOLD:
        return "POTENTIAL"
    if similarity >= REVIEW_SIMILARITY_THRESHOLD:
        return "REVIEW"
    return "LOW_SIMILARITY"


# =========================================================
# HELPER — GET OR CREATE DEMO REPORTER
# =========================================================

def get_demo_reporter(db: Session):

    reporter = db.query(User).first()

    if not reporter:

        reporter = User(
            name="Demo Reporter",
            phone="9999999999",
            role="REPORTER",
            phone_verified=True
        )

        db.add(reporter)
        db.commit()
        db.refresh(reporter)

    return reporter


# =========================================================
# HELPER — SAVE AI MATCH
# =========================================================

def _calculate_age_score(person_age, body_age):
    """Return a heuristic age-consistency score from 0-100."""
    try:
        diff = abs(float(person_age) - float(body_age))
    except (TypeError, ValueError):
        return None

    if diff <= 1:
        return 100.0
    if diff <= 3:
        return 90.0
    if diff <= 5:
        return 75.0
    if diff <= 10:
        return 50.0
    return 20.0


def _calculate_gender_score(person_gender, body_gender):
    """Return a simple normalized gender-consistency score."""
    if not person_gender or not body_gender:
        return None

    p = str(person_gender).strip().lower()
    b = str(body_gender).strip().lower()

    if p == b:
        return 100.0

    aliases = {
        "m": "male",
        "man": "male",
        "boy": "male",
        "f": "female",
        "woman": "female",
        "girl": "female",
    }

    return 100.0 if aliases.get(p, p) == aliases.get(b, b) else 0.0


def _calculate_height_score(person_height, body_height):
    """Return a heuristic height-consistency score from 0-100."""
    try:
        diff = abs(float(person_height) - float(body_height))
    except (TypeError, ValueError):
        return None

    if diff <= 2:
        return 100.0
    if diff <= 5:
        return 90.0
    if diff <= 8:
        return 75.0
    if diff <= 12:
        return 50.0
    return 20.0


def _calculate_text_score(person_text, body_text):
    """
    Lightweight keyword-overlap score for physical descriptions.
    This is an explainable heuristic, not an identity probability.
    """
    if not person_text or not body_text:
        return None

    import re

    def words(text):
        return {
            w for w in re.findall(r"[a-zA-Z0-9]+", str(text).lower())
            if len(w) > 2
        }

    a = words(person_text)
    b = words(body_text)

    if not a or not b:
        return 0.0

    intersection = len(a & b)
    union = len(a | b)

    return round((intersection / union) * 100, 2) if union else 0.0


def _calculate_overall_score(face_score, attribute_score, text_score):
    """
    Weighted multi-factor score.

    Default weights:
      Face       = 60%
      Attributes = 25%
      Text/NLP   = 15%

    If a signal is unavailable, its weight is excluded and the
    remaining available weights are normalized.
    """
    weighted_values = []

    if face_score is not None:
        weighted_values.append((float(face_score), 0.60))

    if attribute_score is not None:
        weighted_values.append((float(attribute_score), 0.25))

    if text_score is not None:
        weighted_values.append((float(text_score), 0.15))

    if not weighted_values:
        return 0.0

    total_weight = sum(weight for _, weight in weighted_values)
    score = sum(value * weight for value, weight in weighted_values)

    return round(score / total_weight, 2)


def save_match(
    db: Session,
    body: UnidentifiedBody,
    match_data: dict
):
    similarity = float(match_data.get("similarity", 0))
    similarity_percent = float(
        match_data.get("similarity_percent", 0)
    )

    missing_person_id = match_data.get("missing_person_id")

    if not missing_person_id:
        return None

    # -----------------------------------------------------
    # GET MISSING PERSON
    # -----------------------------------------------------

    person = (
        db.query(MissingPerson)
        .filter(MissingPerson.id == missing_person_id)
        .first()
    )

    if not person:
        return None

    # -----------------------------------------------------
    # MULTI-FACTOR SCORING
    # -----------------------------------------------------

    face_score = round(
        max(0.0, min(100.0, similarity_percent)),
        2
    )

    age_score = _calculate_age_score(
        person.age,
        body.estimated_age
    )

    gender_score = _calculate_gender_score(
        person.gender,
        body.gender
    )

    height_score = _calculate_height_score(
        person.height_cm,
        body.estimated_height_cm
    )

    attribute_values = [
        score
        for score in (
            age_score,
            gender_score,
            height_score
        )
        if score is not None
    ]

    attribute_score = (
        round(
            sum(attribute_values) / len(attribute_values),
            2
        )
        if attribute_values
        else None
    )

    text_score = _calculate_text_score(
        person.description,
        body.physical_description
    )

    overall_score = _calculate_overall_score(
        face_score=face_score,
        attribute_score=attribute_score,
        text_score=text_score
    )

    # -----------------------------------------------------
    # CLASSIFICATION
    # -----------------------------------------------------

    status = classify_similarity(
        overall_score / 100.0
    )

    # -----------------------------------------------------
    # EXPLANATION
    # -----------------------------------------------------

    explanation = (
        f"Multi-factor AI analysis found "
        f"{face_score:.1f}% facial similarity, "
        f"{attribute_score:.1f}% attribute consistency"
        if attribute_score is not None
        else
        f"Multi-factor AI analysis found "
        f"{face_score:.1f}% facial similarity, "
        f"attribute consistency unavailable"
    )

    if text_score is not None:
        explanation += (
            f", and {text_score:.1f}% physical-description "
            f"similarity."
        )
    else:
        explanation += (
            ", and physical-description similarity was unavailable."
        )

    explanation += (
        f" Composite score: {overall_score:.1f}%. "
        f"Classification: {status}. "
        f"Requires investigator verification."
    )

    # -----------------------------------------------------
    # CHECK EXISTING MATCH
    # -----------------------------------------------------

    existing_match = (
        db.query(Match)
        .filter(
            Match.missing_person_id == missing_person_id,
            Match.unidentified_body_id == body.id
        )
        .first()
    )

    # -----------------------------------------------------
    # UPDATE EXISTING MATCH
    # -----------------------------------------------------

    if existing_match:
        existing_match.face_score = face_score
        existing_match.attribute_score = attribute_score
        existing_match.text_score = text_score
        existing_match.overall_score = overall_score
        existing_match.explanation = explanation
        existing_match.status = status

        return existing_match

    # -----------------------------------------------------
    # CREATE NEW MATCH
    # -----------------------------------------------------

    new_match = Match(
        missing_person_id=missing_person_id,
        unidentified_body_id=body.id,
        face_score=face_score,
        attribute_score=attribute_score,
        text_score=text_score,
        overall_score=overall_score,
        explanation=explanation,
        status=status
    )

    db.add(new_match)

    return new_match


# =========================================================
# CREATE BASIC CASE
# =========================================================

@router.post("/")
def create_case(
    db: Session = Depends(get_db)
):

    reporter = get_demo_reporter(db)

    case = Case(
        case_number=f"PH-{uuid.uuid4().hex[:8].upper()}",
        case_type="MISSING_PERSON",
        status="PENDING_VERIFICATION",
        reported_by=reporter.id
    )

    db.add(case)
    db.commit()
    db.refresh(case)

    return {
        "message": "Case created successfully",
        "case_id": str(case.id),
        "case_number": case.case_number,
        "status": case.status
    }


# =========================================================
# CREATE MISSING PERSON
# =========================================================

@router.post("/missing-person")
def create_missing_person(
    data: MissingPersonCreate,
    db: Session = Depends(get_db)
):

    reporter = get_demo_reporter(db)

    case = Case(
        case_number=f"PH-{uuid.uuid4().hex[:8].upper()}",
        case_type="MISSING_PERSON",
        status="PENDING_VERIFICATION",
        reported_by=reporter.id
    )

    db.add(case)
    db.commit()
    db.refresh(case)

    missing_person = MissingPerson(
        case_id=case.id,
        name=data.name,
        age=data.age,
        gender=data.gender,
        height_cm=data.height_cm,
        last_seen_location=data.last_seen_location,
        last_seen_date=data.last_seen_date,
        description=data.description
    )

    db.add(missing_person)
    db.commit()
    db.refresh(missing_person)

    return {
        "message": "Missing person report created successfully",
        "case_id": str(case.id),
        "case_number": case.case_number,
        "missing_person_id": str(missing_person.id),
        "status": case.status
    }


# =========================================================
# UPLOAD MISSING PERSON PHOTO
# =========================================================

@router.post("/missing-person/{missing_person_id}/photo")
async def upload_missing_person_photo(
    missing_person_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):

    missing_person = (
        db.query(MissingPerson)
        .filter(
            MissingPerson.id == missing_person_id
        )
        .first()
    )

    if not missing_person:

        raise HTTPException(
            status_code=404,
            detail="Missing person not found"
        )

    allowed_extensions = {
        ".jpg",
        ".jpeg",
        ".png",
        ".webp"
    }

    extension = Path(
        file.filename or ""
    ).suffix.lower()

    if extension not in allowed_extensions:

        raise HTTPException(
            status_code=400,
            detail="Only JPG, JPEG, PNG and WEBP images are allowed"
        )

    upload_directory = (
        Path(__file__).resolve().parents[2]
        / "uploads"
    )

    upload_directory.mkdir(
        parents=True,
        exist_ok=True
    )

    new_filename = (
        f"{uuid.uuid4().hex}"
        f"{extension}"
    )

    file_path = upload_directory / new_filename

    with open(
        file_path,
        "wb"
    ) as buffer:

        while chunk := await file.read(
            1024 * 1024
        ):

            buffer.write(chunk)

    relative_path = str(
        file_path.relative_to(
            Path(__file__).resolve().parents[2]
        )
    )

    missing_person.photo_path = relative_path

    # -----------------------------------------------------
    # Generate AI face embedding
    # -----------------------------------------------------

    embedding_result = generate_face_embedding(
        str(file_path)
    )

    if embedding_result["success"]:

        missing_person.face_embedding = json.dumps(
            embedding_result["embedding"]
        )

    db.commit()
    db.refresh(missing_person)

    return {
        "message": "Missing person photo uploaded successfully",
        "missing_person_id": str(
            missing_person.id
        ),
        "photo_path": relative_path,
        "face_detected": embedding_result["success"],
        "ai_message": embedding_result["message"]
    }


# =========================================================
# CREATE UNIDENTIFIED BODY
# =========================================================

@router.post("/unidentified-body")
def create_unidentified_body(
    data: UnidentifiedBodyCreate,
    db: Session = Depends(get_db)
):

    reporter = get_demo_reporter(db)

    case = Case(
        case_number=f"PH-{uuid.uuid4().hex[:8].upper()}",
        case_type="UNIDENTIFIED_BODY",
        status="PENDING_VERIFICATION",
        reported_by=reporter.id
    )

    db.add(case)
    db.commit()
    db.refresh(case)

    body = UnidentifiedBody(
        case_id=case.id,
        estimated_age=data.estimated_age,
        gender=data.gender,
        estimated_height_cm=data.estimated_height_cm,
        found_location=data.found_location,
        found_date=data.found_date,
        physical_description=data.physical_description
    )

    db.add(body)
    db.commit()
    db.refresh(body)

    return {
        "message": "Unidentified body case created successfully",
        "case_id": str(case.id),
        "case_number": case.case_number,
        "unidentified_body_id": str(body.id),
        "status": case.status
    }


# =========================================================
# UPLOAD UNIDENTIFIED BODY PHOTO + AI MATCHING
# + SAVE MATCHES TO DATABASE
# =========================================================

@router.post(
    "/unidentified-body/{body_id}/photo"
)
async def upload_body_photo(
    body_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):

    # -----------------------------------------------------
    # FIND BODY
    # -----------------------------------------------------

    body = (
        db.query(UnidentifiedBody)
        .filter(
            UnidentifiedBody.id == body_id
        )
        .first()
    )

    if not body:

        raise HTTPException(
            status_code=404,
            detail="Unidentified body not found"
        )

    # -----------------------------------------------------
    # VALIDATE FILE
    # -----------------------------------------------------

    allowed_extensions = {
        ".jpg",
        ".jpeg",
        ".png",
        ".webp"
    }

    extension = Path(
        file.filename or ""
    ).suffix.lower()

    if extension not in allowed_extensions:

        raise HTTPException(
            status_code=400,
            detail="Only JPG, JPEG, PNG and WEBP images are allowed"
        )

    # -----------------------------------------------------
    # SAVE PHOTO
    # -----------------------------------------------------

    upload_directory = (
        Path(__file__).resolve().parents[2]
        / "uploads"
    )

    upload_directory.mkdir(
        parents=True,
        exist_ok=True
    )

    new_filename = (
        f"body_{uuid.uuid4().hex}"
        f"{extension}"
    )

    file_path = upload_directory / new_filename

    with open(
        file_path,
        "wb"
    ) as buffer:

        while chunk := await file.read(
            1024 * 1024
        ):

            buffer.write(chunk)

    relative_path = str(
        file_path.relative_to(
            Path(__file__).resolve().parents[2]
        )
    )

    body.photo_path = relative_path

    # -----------------------------------------------------
    # GENERATE BODY FACE EMBEDDING
    # -----------------------------------------------------

    embedding_result = generate_face_embedding(
        str(file_path)
    )

    if not embedding_result["success"]:

        db.commit()

        return {
            "message": "Photo uploaded, but no usable face was detected",
            "body_id": str(body.id),
            "photo_path": relative_path,
            "face_detected": False,
            "ai_message": embedding_result["message"],
            "matches": []
        }

    # -----------------------------------------------------
    # SAVE BODY EMBEDDING
    # -----------------------------------------------------

    body.face_embedding = json.dumps(
        embedding_result["embedding"]
    )

    # -----------------------------------------------------
    # GET ALL MISSING PEOPLE WITH EMBEDDINGS
    # -----------------------------------------------------

    missing_people = (
        db.query(MissingPerson)
        .filter(
            MissingPerson.face_embedding.isnot(None)
        )
        .all()
    )

    stored_embeddings = []

    for person in missing_people:

        try:

            embedding = json.loads(
                person.face_embedding
            )

            stored_embeddings.append({
                "missing_person_id": str(
                    person.id
                ),
                "name": person.name,
                "embedding": embedding
            })

        except Exception:

            continue

    # -----------------------------------------------------
    # RUN AI MATCHING
    # -----------------------------------------------------

    matches = compare_embedding_with_database(
        embedding_result["embedding"],
        stored_embeddings
    )

    # -----------------------------------------------------
    # SAVE MATCHES TO DATABASE
    # -----------------------------------------------------

    saved_matches = []

    for match_data in matches[:10]:

        saved_match = save_match(
            db=db,
            body=body,
            match_data=match_data
        )

        if saved_match:

            saved_matches.append({
                "match_id": str(
                    saved_match.id
                ),
                "missing_person_id": str(
                    saved_match.missing_person_id
                ),
                "unidentified_body_id": str(
                    saved_match.unidentified_body_id
                ),
                "name": match_data.get("name"),
                "similarity": match_data.get(
                    "similarity"
                ),
                "similarity_percent": match_data.get(
                    "similarity_percent"
                ),
                "overall_score": saved_match.overall_score,
                "status": saved_match.status,
                "explanation": saved_match.explanation
            })

    # -----------------------------------------------------
    # COMMIT EVERYTHING
    # -----------------------------------------------------

    db.commit()

    return {
        "message": "Body photo processed and matches saved successfully",
        "body_id": str(body.id),
        "photo_path": relative_path,

        "face_detected": True,

        "face_confidence": embedding_result[
            "face_confidence"
        ],

        "candidates_checked": len(
            stored_embeddings
        ),

        "matches_saved": len(
            saved_matches
        ),

        "matches": saved_matches
    }


# =========================================================
# GET SAVED MATCHES FOR A BODY
# =========================================================

@router.get(
    "/unidentified-body/{body_id}/matches"
)
def get_body_matches(
    body_id: str,
    db: Session = Depends(get_db)
):

    body = (
        db.query(UnidentifiedBody)
        .filter(
            UnidentifiedBody.id == body_id
        )
        .first()
    )

    if not body:

        raise HTTPException(
            status_code=404,
            detail="Unidentified body not found"
        )

    matches = (
        db.query(Match)
        .filter(
            Match.unidentified_body_id == body.id
        )
        .order_by(
            Match.overall_score.desc()
        )
        .all()
    )

    results = []

    for match in matches:

        person = (
            db.query(MissingPerson)
            .filter(
                MissingPerson.id ==
                match.missing_person_id
            )
            .first()
        )

        results.append({
            "match_id": str(match.id),
            "missing_person_id": str(
                match.missing_person_id
            ),
            "unidentified_body_id": str(
                match.unidentified_body_id
            ),
            "name": person.name if person else None,
            "face_score": match.face_score,
            "attribute_score": match.attribute_score,
            "text_score": match.text_score,
            "overall_score": match.overall_score,
            "status": match.status,
            "explanation": match.explanation,
            "created_at": (
                match.created_at.isoformat()
                if match.created_at
                else None
            )
        })

    return {
        "body_id": str(body.id),
        "matches_found": len(results),
        "matches": results
    }


# =========================================================
# DASHBOARD STATS
# =========================================================

@router.get("/stats")
def get_case_stats(db: Session = Depends(get_db)):
    return {
        "total_cases": db.query(Case).count(),
        "missing_persons_count": db.query(MissingPerson).count(),
        "unidentified_bodies_count": db.query(UnidentifiedBody).count(),
        "potential_matches_count": db.query(Match).filter(Match.status == "POTENTIAL").count()
    }


# =========================================================
# GET ALL MISSING PERSONS
# =========================================================

@router.get("/missing-persons")
def get_missing_persons(db: Session = Depends(get_db)):
    people = db.query(MissingPerson).order_by(MissingPerson.created_at.desc()).all()
    results = []
    for person in people:
        case = db.query(Case).filter(Case.id == person.case_id).first()
        results.append({
            "id": str(person.id),
            "case_id": str(person.case_id),
            "case_number": case.case_number if case else None,
            "name": person.name,
            "age": person.age,
            "gender": person.gender,
            "height_cm": person.height_cm,
            "last_seen_location": person.last_seen_location,
            "last_seen_date": person.last_seen_date.isoformat() if person.last_seen_date else None,
            "description": person.description,
            "photo_path": person.photo_path,
            "status": case.status if case else None,
            "created_at": person.created_at.isoformat() if person.created_at else None
        })
    return results


# =========================================================
# GET ALL UNIDENTIFIED BODIES
# =========================================================

@router.get("/unidentified-bodies")
def get_unidentified_bodies(db: Session = Depends(get_db)):
    bodies = db.query(UnidentifiedBody).order_by(UnidentifiedBody.created_at.desc()).all()
    results = []
    for body in bodies:
        case = db.query(Case).filter(Case.id == body.case_id).first()
        results.append({
            "id": str(body.id),
            "case_id": str(body.case_id),
            "case_number": case.case_number if case else None,
            "estimated_age": body.estimated_age,
            "gender": body.gender,
            "estimated_height_cm": body.estimated_height_cm,
            "found_location": body.found_location,
            "found_date": body.found_date.isoformat() if body.found_date else None,
            "physical_description": body.physical_description,
            "photo_path": body.photo_path,
            "status": case.status if case else None,
            "created_at": body.created_at.isoformat() if body.created_at else None
        })
    return results


# =========================================================
# GET ALL SAVED MATCHES
# =========================================================

@router.get("/matches")
def get_all_matches(db: Session = Depends(get_db)):
    matches = db.query(Match).order_by(Match.overall_score.desc()).all()
    results = []
    for match in matches:
        person = db.query(MissingPerson).filter(MissingPerson.id == match.missing_person_id).first()
        body = db.query(UnidentifiedBody).filter(UnidentifiedBody.id == match.unidentified_body_id).first()
        results.append({
            "id": str(match.id),
            "missing_person_id": str(match.missing_person_id),
            "unidentified_body_id": str(match.unidentified_body_id),
            "missing_person_name": person.name if person else "Unknown",
            "missing_person_age": person.age if person else None,
            "missing_person_gender": person.gender if person else None,
            "missing_person_last_seen": person.last_seen_location if person else None,
            "missing_person_photo": person.photo_path if person else None,
            "body_estimated_age": body.estimated_age if body else None,
            "body_location": body.found_location if body else None,
            "body_photo": body.photo_path if body else None,
            "face_score": match.face_score or 0,
            "attribute_score": match.attribute_score or 0,
            "text_score": match.text_score or 0,
            "overall_score": match.overall_score or 0,
            "status": match.status,
            "explanation": match.explanation,
            "created_at": match.created_at.isoformat() if match.created_at else None
        })
    return results


# =========================================================
# DELETE MISSING PERSON
# =========================================================

@router.delete("/missing-person/{missing_person_id}")
def delete_missing_person(missing_person_id: str, db: Session = Depends(get_db)):
    person = db.query(MissingPerson).filter(MissingPerson.id == missing_person_id).first()
    if not person:
        raise HTTPException(status_code=404, detail="Missing person not found")
    db.query(Match).filter(Match.missing_person_id == person.id).delete(synchronize_session=False)
    case = db.query(Case).filter(Case.id == person.case_id).first()
    db.delete(person)
    if case:
        db.delete(case)
    db.commit()
    return {"message": "Missing person deleted successfully", "id": missing_person_id}


# =========================================================
# DELETE UNIDENTIFIED BODY
# =========================================================

@router.delete("/unidentified-body/{body_id}")
def delete_unidentified_body(body_id: str, db: Session = Depends(get_db)):
    body = db.query(UnidentifiedBody).filter(UnidentifiedBody.id == body_id).first()
    if not body:
        raise HTTPException(status_code=404, detail="Unidentified body not found")
    db.query(Match).filter(Match.unidentified_body_id == body.id).delete(synchronize_session=False)
    case = db.query(Case).filter(Case.id == body.case_id).first()
    db.delete(body)
    if case:
        db.delete(case)
    db.commit()
    return {"message": "Unidentified body deleted successfully", "id": body_id}


# =========================================================
# DELETE MATCH
# =========================================================

@router.delete("/match/{match_id}")
def delete_match(match_id: str, db: Session = Depends(get_db)):
    match = db.query(Match).filter(Match.id == match_id).first()
    if not match:
        raise HTTPException(status_code=404, detail="Match not found")
    db.delete(match)
    db.commit()
    return {"message": "Match record dismissed successfully", "id": match_id}


# =========================================================
# DIRECT AI MATCH ENDPOINT
# =========================================================

@router.post("/match")
async def match_unidentified_body(
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):

    allowed_extensions = {
        ".jpg",
        ".jpeg",
        ".png",
        ".webp"
    }

    extension = Path(
        file.filename or ""
    ).suffix.lower()

    if extension not in allowed_extensions:

        raise HTTPException(
            status_code=400,
            detail="Only JPG, JPEG, PNG and WEBP images are allowed"
        )

    upload_directory = (
        Path(__file__).resolve().parents[2]
        / "uploads"
    )

    upload_directory.mkdir(
        parents=True,
        exist_ok=True
    )

    filename = (
        f"body_match_"
        f"{uuid.uuid4().hex}"
        f"{extension}"
    )

    file_path = upload_directory / filename

    with open(
        file_path,
        "wb"
    ) as buffer:

        while chunk := await file.read(
            1024 * 1024
        ):

            buffer.write(chunk)

    # -----------------------------------------------------
    # GENERATE EMBEDDING
    # -----------------------------------------------------

    embedding_result = generate_face_embedding(
        str(file_path)
    )

    if not embedding_result["success"]:

        raise HTTPException(
            status_code=400,
            detail=embedding_result["message"]
        )

    # -----------------------------------------------------
    # GET MISSING PEOPLE
    # -----------------------------------------------------

    missing_people = (
        db.query(MissingPerson)
        .filter(
            MissingPerson.face_embedding.isnot(None)
        )
        .all()
    )

    stored_embeddings = []

    for person in missing_people:

        try:

            embedding = json.loads(
                person.face_embedding
            )

            stored_embeddings.append({
                "missing_person_id": str(
                    person.id
                ),
                "name": person.name,
                "embedding": embedding
            })

        except Exception:

            continue

    # -----------------------------------------------------
    # AI MATCHING
    # -----------------------------------------------------

    matches = compare_embedding_with_database(
        embedding_result["embedding"],
        stored_embeddings
    )

    # -----------------------------------------------------
    # RETURN RESULTS
    # -----------------------------------------------------

    formatted_matches = []

    for match in matches[:10]:

        similarity = float(
            match.get("similarity", 0)
        )

        similarity_percent = float(
            match.get("similarity_percent", 0)
        )

        status = classify_similarity(similarity)

        formatted_matches.append({
            **match,
            "status": status
        })

    return {
        "success": True,
        "message": "AI matching completed successfully",
        "face_confidence": embedding_result[
            "face_confidence"
        ],
        "candidates_checked": len(
            stored_embeddings
        ),
        "matches": formatted_matches
    }