from fastapi import FastAPI

from app.routes import router

app = FastAPI(title="Chewing-Music Study")
app.include_router(router, prefix="/api")
