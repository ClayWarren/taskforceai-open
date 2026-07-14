package projects

import "time"

// CreateProjectRequest is validated by Huma via minLength/maxLength; keep validate tags for any non-Huma code paths.
type CreateProjectRequest struct {
	Name               string  `json:"name" validate:"required,min=1,max=100" minLength:"1" maxLength:"100"`
	Description        *string `json:"description,omitempty" validate:"omitempty,max=500" maxLength:"500"`
	CustomInstructions *string `json:"custom_instructions,omitempty" validate:"omitempty,max=2000" maxLength:"2000"`
}

type UpdateProjectRequest struct {
	Name string `json:"name" validate:"required,min=1,max=100" minLength:"1" maxLength:"100"`
}

type ProjectResponse struct {
	ID                 int32     `json:"id"`
	Name               string    `json:"name"`
	Description        *string   `json:"description"`
	CustomInstructions *string   `json:"custom_instructions"`
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`
}
