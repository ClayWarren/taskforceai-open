/** Represents an uploaded file. */
export interface File {
  id: string;
  filename: string;
  purpose: string;
  bytes: number;
  created_at: string;
  mime_type?: string;
}

/** Options for uploading a file. */
export interface FileUploadOptions {
  purpose?: string;
  mime_type?: string;
}

/** Response containing a list of files. */
export interface FileListResponse {
  files: File[];
  total: number;
}

/** Response for direct-to-blob upload token creation. */
export interface FileUploadTokenResponse {
  file_id: string;
  upload_url: string;
  upload_token: string;
  pathname: string;
  expires_at: number;
  max_bytes: number;
}

/** Request payload for completing a direct upload. */
export interface FileUploadCompleteRequest {
  file_id: string;
  pathname: string;
  filename: string;
  purpose?: string;
  mime_type?: string;
}
