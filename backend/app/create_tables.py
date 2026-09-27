from app.database import engine, Base
from app import models

print("Creating Pehchaan 2.0 database tables...")

Base.metadata.create_all(bind=engine)

print("All tables created successfully!")