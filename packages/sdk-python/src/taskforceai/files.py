"""File types and models for TaskForceAI SDK."""

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class File(BaseModel):
    """Represents an uploaded file."""

    id: str = Field(min_length=1)
    filename: str = Field(min_length=1)
    purpose: str = Field(min_length=1)
    bytes: int = Field(ge=0)
    created_at: datetime
    mime_type: Optional[str] = Field(default=None, min_length=1)


class FileUploadOptions(BaseModel):
    """Options for uploading a file."""

    purpose: Optional[str] = None
    mime_type: Optional[str] = None


class FileListResponse(BaseModel):
    """Response containing a list of files."""

    files: List[File]
    total: int = Field(ge=0)
