package pkg

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestIsChemistryRelevant(t *testing.T) {
	t.Parallel()

	relevant := []string{
		"H2O boiling point at altitude",
		"C6H12O6 structure",
		"c6h12o6 structure",
		"solubility of caffeine in water",
		"benzene point group symmetry",
		"molecular weight of aspirin",
		"sodium chloride crystal lattice",
		"what is the pKa of acetic acid",
		"potassium permanganate reaction",
		"copper sulfate solution color",
		"IUPAC name for CH3COOH",
		// "peroxide" is not in the vocabulary and is not a formula token, but is
		// long enough to be matched by the "oxide" anion suffix rule.
		"peroxide bleaching agent",
	}
	for _, q := range relevant {
		assert.True(t, isChemistryRelevant(q), "expected chemistry-relevant: %q", q)
	}

	irrelevant := []string{
		"best pizza in Austin",
		"mercury retrograde meaning astrology",
		"gold price today",
		"premium subscription pricing comparison",
		"how to lead a team meeting",
		"weather in Paris this weekend",
		"USA visa requirements",
		"iron man movie release order",
		"TypeScript generics tutorial",
		"iphone15pro camera specs",
		"",
	}
	for _, q := range irrelevant {
		assert.False(t, isChemistryRelevant(q), "expected not chemistry-relevant: %q", q)
	}
}

func TestSearchSkipsPubChemForNonChemistryQueries(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"type":"search","web":{"results":[{"title":"Result","url":"https://example.com","description":"desc"}]}}`))
	}))
	defer server.Close()

	g, err := NewSearchGateway(BraveConfig{
		APIKey:   "key",
		Endpoint: server.URL + "/web/search",
	})
	require.NoError(t, err)

	mockClient := new(MockHttpClient)
	g.httpClient = mockClient

	res, err := g.Search(context.Background(), SearchParams{
		OriginalQuery:  "best pizza in Austin",
		EffectiveQuery: "best pizza in Austin",
		MaxResults:     1,
	})

	require.NoError(t, err)
	require.NotNil(t, res)
	assert.Equal(t, "brave", res.ProviderLabel)
	mockClient.AssertNotCalled(t, "Get")
}
