package server

import "time"

const (
	// VercelFunctionMaxDurationSeconds is the Pro/Enterprise Fluid Compute maximum duration.
	VercelFunctionMaxDurationSeconds = 800

	// VercelFunctionMaxDuration is the maximum wall-clock runtime for a Vercel Function request.
	VercelFunctionMaxDuration = time.Duration(VercelFunctionMaxDurationSeconds) * time.Second

	// VercelFunctionServerWriteTimeout keeps standalone HTTP servers from undercutting Vercel streams.
	VercelFunctionServerWriteTimeout = VercelFunctionMaxDuration + 40*time.Second
)
