package pkg

type SearchParams struct {
	Provider       string
	OriginalQuery  string
	EffectiveQuery string
	PrimaryQuery   string
	FallbackQuery  string
	MaxResults     int
	UserAgent      string
	Tokens         []string
}

type SearchResultItem struct {
	Title   string `json:"title"`
	URL     string `json:"url"`
	Snippet string `json:"snippet"`
	Content string `json:"content"`
}

type SearchGatewayResult struct {
	Results       []SearchResultItem `json:"results"`
	ProviderLabel string             `json:"providerLabel"`
}
