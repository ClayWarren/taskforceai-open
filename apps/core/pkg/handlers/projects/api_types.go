package projects

import "time"

// CreateProjectRequest is validated by Huma via minLength/maxLength; keep validate tags for any non-Huma code paths.
type CreateProjectRequest struct {
	Name               string   `json:"name" validate:"required,min=1,max=100" minLength:"1" maxLength:"100"`
	Description        *string  `json:"description,omitempty" validate:"omitempty,max=500" maxLength:"500"`
	CustomInstructions *string  `json:"custom_instructions,omitempty" validate:"omitempty,max=2000" maxLength:"2000"`
	Icon               *string  `json:"icon,omitempty" validate:"omitempty,max=100" maxLength:"100"`
	Color              *string  `json:"color,omitempty" validate:"omitempty,hexcolor" pattern:"^#[0-9A-Fa-f]{6}$"`
	Tags               []string `json:"tags,omitempty" validate:"omitempty,max=10" maxItems:"10"`
}

type ProjectResponse struct {
	ID                 int32     `json:"id"`
	Name               string    `json:"name"`
	Description        *string   `json:"description"`
	CustomInstructions *string   `json:"custom_instructions"`
	CreatedAt          time.Time `json:"created_at"`
}
