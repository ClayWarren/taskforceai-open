package enginecoreadapter

import (
	"context"
	"os"

	enginecoretools "github.com/TaskForceAI/core/pkg/enginecore/tools"
)

type enginecoreFileSiteWriter struct{}

func (enginecoreFileSiteWriter) WriteSite(_ context.Context, request enginecoretools.SiteWriteRequest) error {
	return os.WriteFile(request.Path, request.Content, 0o600)
}
