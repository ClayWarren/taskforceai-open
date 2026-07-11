package orchestrator

// IsGeneratedFileRequest reports whether a prompt clearly asks TaskForceAI to
// create a downloadable generated file such as XLSX, PDF, DOCX, PPTX, CSV, ZIP,
// PNG, or SVG.
func IsGeneratedFileRequest(q string) bool {
	return isGeneratedFileRequest(q)
}
