from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, RedirectResponse

from app.routers import cases


app = FastAPI(
    title="Pehchaan 2.0",
    description="AI-powered identification platform",
    version="2.0.0"
)

# Enable CORS for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount Uploads directory for serving images
UPLOAD_DIR = Path(__file__).resolve().parents[1] / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

# Include API Routers
app.include_router(cases.router)

# Mount Frontend directory if present
FRONTEND_DIR = Path(__file__).resolve().parents[2] / "frontend"
if FRONTEND_DIR.exists():
    app.mount("/portal", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="portal")


@app.get("/")
def root():
    index_file = FRONTEND_DIR / "index.html"
    if index_file.exists():
        return RedirectResponse(url="/portal/")
    return {
        "message": "Pehchaan 2.0 API is running",
        "version": "2.0.0",
        "docs_url": "/docs"
    }


@app.get("/health")
def health():
    return {
        "status": "healthy"
    }