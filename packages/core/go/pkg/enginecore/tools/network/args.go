package network

import "github.com/TaskForceAI/core/pkg/enginecore/tools/internal/toolutil"

type webFetchArgs struct {
	url string
}

func parseWebFetchArgs(args map[string]any) webFetchArgs {
	return webFetchArgs{url: toolutil.GetString(args, "url")}
}
