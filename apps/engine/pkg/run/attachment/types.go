package attachment

// File represents a binary attachment whose payload is stored separately.
type File struct {
	ID       string `json:"id" doc:"Unique identifier for the attachment"`
	Data     []byte `json:"-"`
	MimeType string `json:"mime_type" doc:"File MIME type"`
	Name     string `json:"name" doc:"Original filename"`
	Size     int64  `json:"size" doc:"File size in bytes"`
}

// Collection carries all files associated with a task.
type Collection struct {
	Files []File `json:"files,omitempty"`
}

type Info struct {
	MimeType string `json:"mimeType"`
	Name     string `json:"name"`
	Size     int64  `json:"size"`
}

const (
	CollectionKeyPrefix = "attachment_cache:"
	BlobKeyPrefix       = "attachment_meta:"
	InfoKeyPrefix       = "attachment_info:"
)
