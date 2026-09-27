import uuid
from datetime import datetime

from sqlalchemy import (
    Column,
    String,
    Integer,
    Float,
    Text,
    Boolean,
    DateTime,
    ForeignKey,
)

from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(150), nullable=False)
    phone = Column(String(20), unique=True, nullable=False)
    email = Column(String(150), unique=True, nullable=True)
    password_hash = Column(String(255), nullable=True)
    role = Column(String(30), nullable=False, default="REPORTER")
    phone_verified = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    cases = relationship(
        "Case",
        foreign_keys="Case.reported_by",
        back_populates="reporter"
    )


class Case(Base):
    __tablename__ = "cases"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    case_number = Column(String(50), unique=True, nullable=False)
    case_type = Column(String(30), nullable=False)
    status = Column(String(30), nullable=False, default="PENDING_VERIFICATION")

    reported_by = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=False
    )

    verified_by = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=True
    )

    verification_notes = Column(Text, nullable=True)
    verified_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(
        DateTime,
        default=datetime.utcnow,
        onupdate=datetime.utcnow
    )

    reporter = relationship(
        "User",
        foreign_keys=[reported_by],
        back_populates="cases"
    )


class MissingPerson(Base):
    __tablename__ = "missing_persons"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    case_id = Column(
        UUID(as_uuid=True),
        ForeignKey("cases.id"),
        unique=True,
        nullable=False
    )

    name = Column(String(150), nullable=False)
    age = Column(Integer, nullable=True)
    gender = Column(String(30), nullable=True)
    height_cm = Column(Float, nullable=True)

    last_seen_location = Column(String(255), nullable=True)
    last_seen_date = Column(DateTime, nullable=True)

    description = Column(Text, nullable=True)

    photo_path = Column(
        String(500),
        nullable=True
    )

    # AI FACE EMBEDDING
    face_embedding = Column(
        Text,
        nullable=True
    )

    created_at = Column(
        DateTime,
        default=datetime.utcnow
    )


class UnidentifiedBody(Base):
    __tablename__ = "unidentified_bodies"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    case_id = Column(
        UUID(as_uuid=True),
        ForeignKey("cases.id"),
        unique=True,
        nullable=False
    )

    estimated_age = Column(Integer, nullable=True)
    gender = Column(String(30), nullable=True)
    estimated_height_cm = Column(Float, nullable=True)

    found_location = Column(String(255), nullable=True)
    found_date = Column(DateTime, nullable=True)

    physical_description = Column(
        Text,
        nullable=True
    )

    photo_path = Column(
        String(500),
        nullable=True
    )

    # AI FACE EMBEDDING
    face_embedding = Column(
        Text,
        nullable=True
    )

    created_at = Column(
        DateTime,
        default=datetime.utcnow
    )


class Match(Base):
    __tablename__ = "matches"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    missing_person_id = Column(
        UUID(as_uuid=True),
        ForeignKey("missing_persons.id"),
        nullable=False
    )

    unidentified_body_id = Column(
        UUID(as_uuid=True),
        ForeignKey("unidentified_bodies.id"),
        nullable=False
    )

    face_score = Column(Float, nullable=True)
    attribute_score = Column(Float, nullable=True)
    text_score = Column(Float, nullable=True)

    overall_score = Column(
        Float,
        nullable=False
    )

    explanation = Column(
        Text,
        nullable=True
    )

    status = Column(
        String(30),
        nullable=False,
        default="POTENTIAL"
    )

    created_at = Column(
        DateTime,
        default=datetime.utcnow
    )


class Evidence(Base):
    __tablename__ = "evidence"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    case_id = Column(
        UUID(as_uuid=True),
        ForeignKey("cases.id"),
        nullable=False
    )

    file_type = Column(
        String(50),
        nullable=False
    )

    file_path = Column(
        String(500),
        nullable=False
    )

    uploaded_by = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=False
    )

    created_at = Column(
        DateTime,
        default=datetime.utcnow
    )


class OTPVerification(Base):
    __tablename__ = "otp_verifications"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    phone = Column(
        String(20),
        nullable=False
    )

    otp_hash = Column(
        String(255),
        nullable=False
    )

    purpose = Column(
        String(50),
        nullable=False
    )

    expires_at = Column(
        DateTime,
        nullable=False
    )

    verified_at = Column(
        DateTime,
        nullable=True
    )

    attempts = Column(
        Integer,
        default=0
    )

    created_at = Column(
        DateTime,
        default=datetime.utcnow
    )