package files

import "github.com/danielgtaylor/huma/v2"

// RegisterHandlers registers the developer file handlers.
func RegisterHandlers(api huma.API, q FilesQueries) {
	registerStorageSummaryHandler(api, q)
	registerUploadFileHandler(api, q)
	registerCreateUploadTokenHandler(api, q)
	registerCompleteUploadHandler(api, q)
	registerListFilesHandler(api, q)
	registerGetFileHandler(api, q)
	registerDownloadFileHandler(api, q)
	registerDeleteFileHandler(api, q)
}
