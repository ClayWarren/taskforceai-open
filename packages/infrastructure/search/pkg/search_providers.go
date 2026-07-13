package pkg

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	bravesearch "github.com/claywarren/go-brave-search"
)

type BraveConfig struct {
	APIKey    string
	Endpoint  string
	UserAgent string
}

type BraveSearcher interface {
	WebSearch(ctx context.Context, query string, params *bravesearch.WebSearchParams) (*bravesearch.WebSearchResponse, error)
}

const (
	braveWebResultsPerPage = 20
	braveWebMaxOffset      = 0
)

var pubChemStopwordRe = regexp.MustCompile(`(?i)\b(point|group|symmetry)\b`)

// Candidate chemical formula: two or more element-like units (H2, O, Na, Cl4).
// A match must also contain a digit to count, which rejects acronyms like USA.
var chemFormulaRe = regexp.MustCompile(`\b(?:[A-Z][a-z]?\d{0,3}){2,}\b`)

var chemAlnumTokenRe = regexp.MustCompile(`[A-Za-z0-9]+`)

var chemQueryWordRe = regexp.MustCompile(`[a-z]+`)

// Exact-token vocabulary that marks a query as chemistry-relevant.
var chemVocab = map[string]struct{}{
	"chemistry": {}, "chemical": {}, "chemicals": {}, "molecule": {}, "molecules": {},
	"molecular": {}, "compound": {}, "compounds": {}, "reagent": {}, "solvent": {},
	"solute": {}, "stoichiometry": {}, "molarity": {}, "titration": {}, "isotope": {},
	"isotopes": {}, "covalent": {}, "electronegativity": {}, "iupac": {}, "pubchem": {},
	"alkane": {}, "alkene": {}, "alkyne": {}, "aromatic": {}, "hydrocarbon": {},
	"polymer": {}, "amine": {}, "amino": {}, "peptide": {}, "enzyme": {}, "acid": {},
	"acids": {}, "alkali": {}, "ester": {}, "solubility": {}, "melting": {}, "boiling": {},
	"benzene": {}, "toluene": {}, "ethanol": {}, "methanol": {}, "acetone": {},
	"ammonia": {}, "glucose": {}, "sucrose": {}, "caffeine": {},
	"hydrogen": {}, "helium": {}, "lithium": {}, "beryllium": {}, "boron": {},
	"nitrogen": {}, "oxygen": {}, "fluorine": {}, "sodium": {}, "magnesium": {},
	"aluminum": {}, "aluminium": {}, "phosphorus": {}, "sulfur": {}, "sulphur": {},
	"chlorine": {}, "potassium": {}, "calcium": {}, "titanium": {}, "chromium": {},
	"manganese": {}, "cobalt": {}, "nickel": {}, "copper": {}, "zinc": {},
	"arsenic": {}, "bromine": {}, "iodine": {}, "barium": {}, "tungsten": {},
	"platinum": {}, "uranium": {}, "plutonium": {}, "radium": {},
	"xenon": {}, "radon": {},
}

// Anion/functional-group suffixes; only checked on tokens long enough to
// avoid clashing with everyday words.
var chemSuffixes = []string{
	"oxide", "chloride", "bromide", "fluoride", "iodide", "sulfate", "sulphate",
	"sulfide", "nitrate", "nitrite", "phosphate", "carbonate", "hydroxide",
	"cyanide", "acetate", "citrate",
}

// isChemistryRelevant gates the PubChem supplement: it reports whether a
// query plausibly concerns chemistry. A false positive costs one extra API
// call; a false negative just falls back to Brave-only results.
func isChemistryRelevant(query string) bool {
	for _, m := range chemFormulaRe.FindAllString(query, -1) {
		if strings.ContainsAny(m, "0123456789") {
			return true
		}
	}
	for _, tok := range chemAlnumTokenRe.FindAllString(query, -1) {
		if isLikelyLowercaseFormulaToken(tok) {
			return true
		}
	}
	for _, tok := range chemQueryWordRe.FindAllString(strings.ToLower(query), -1) {
		if _, ok := chemVocab[tok]; ok {
			return true
		}
		if len(tok) >= 6 {
			for _, suffix := range chemSuffixes {
				if strings.HasSuffix(tok, suffix) {
					return true
				}
			}
		}
	}
	return false
}

func isLikelyLowercaseFormulaToken(tok string) bool {
	if tok != strings.ToLower(tok) || !strings.ContainsAny(tok, "0123456789") || len(tok) > 12 {
		return false
	}
	firstDigit := strings.IndexFunc(tok, func(r rune) bool {
		return r >= '0' && r <= '9'
	})
	if firstDigit < 1 || firstDigit > 4 {
		return false
	}
	return chemFormulaRe.MatchString(strings.ToUpper(tok))
}

func FetchBraveResults(ctx context.Context, client BraveSearcher, query string, maxResults int) ([]SearchResultItem, error) {
	return fetchBraveResults(ctx, client, query, clampBraveMaxResults(maxResults), braveWebMaxOffset)
}

func fetchBraveResults(ctx context.Context, client BraveSearcher, query string, target int, maxOffset int) ([]SearchResultItem, error) {
	if client == nil {
		return nil, fmt.Errorf("brave search client is not configured")
	}

	results := make([]SearchResultItem, 0, target)
	pageSize := min(target, braveWebResultsPerPage)

	for offset := 0; offset <= maxOffset && len(results) < target; offset++ {
		params := &bravesearch.WebSearchParams{
			Count:  pageSize,
			Offset: offset,
		}

		resp, err := client.WebSearch(ctx, query, params)
		if err != nil {
			if len(results) > 0 {
				break
			}
			return nil, fmt.Errorf("brave search failed for query '%s': %w", query, err)
		}

		if resp.Web == nil || len(resp.Web.Results) == 0 {
			break
		}

		for _, item := range resp.Web.Results {
			if hasBraveResultURL(results, item.URL) {
				continue
			}
			snippet := strings.TrimSpace(item.Description)
			title := item.Title
			if title == "" {
				title = item.URL
			}
			results = append(results, SearchResultItem{
				Title:   title,
				URL:     item.URL,
				Snippet: snippet,
				Content: snippet,
			})
			if len(results) >= target {
				break
			}
		}

		if len(resp.Web.Results) < pageSize {
			break
		}
	}

	return results, nil
}

func hasBraveResultURL(results []SearchResultItem, targetURL string) bool {
	for i := range results {
		if results[i].URL == targetURL {
			return true
		}
	}
	return false
}

func clampBraveMaxResults(maxResults int) int {
	if maxResults <= 0 {
		return braveWebResultsPerPage
	}
	return min(maxResults, braveWebResultsPerPage*(braveWebMaxOffset+1))
}

func FetchPubChemResultsWithUserAgent(ctx context.Context, client IHttpClient, query string, tokens []string, userAgent string) ([]SearchResultItem, error) {
	stopwordStripped := strings.TrimSpace(pubChemStopwordRe.ReplaceAllString(query, " "))
	tokenQuery := strings.Join(tokens, " ")
	headers := searchHeaders(userAgent)

	var lastErr error
	for _, attempt := range uniquePubChemAttempts(stopwordStripped, tokenQuery, query) {
		u := "https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/" + url.PathEscape(attempt) + "/synonyms/JSON"
		body, status, err := client.Get(ctx, u, headers)
		if err != nil {
			lastErr = fmt.Errorf("pubchem request failed for %q: %w", attempt, err)
			continue
		}
		if status == 404 {
			continue
		}
		if status != 200 {
			lastErr = fmt.Errorf("pubchem request failed for %q: status %d", attempt, status)
			continue
		}

		var resp PubChemResponse
		if err := json.Unmarshal(body, &resp); err != nil {
			lastErr = fmt.Errorf("pubchem response parse failed for %q: %w", attempt, err)
			continue
		}

		if len(resp.InformationList.Information) == 0 {
			continue
		}

		info := resp.InformationList.Information[0]
		if len(info.Synonym) == 0 {
			continue
		}

		synonyms := info.Synonym
		if len(synonyms) > 5 {
			synonyms = synonyms[:5]
		}

		snippet := fmt.Sprintf("PubChem synonyms: %s", strings.Join(synonyms, ", "))
		urlStr := "https://pubchem.ncbi.nlm.nih.gov/"
		if info.CID != 0 {
			urlStr = "https://pubchem.ncbi.nlm.nih.gov/compound/" + strconv.Itoa(info.CID)
		}

		return []SearchResultItem{{
			Title:   "PubChem data for " + attempt,
			URL:     urlStr,
			Snippet: snippet,
			Content: snippet,
		}}, nil
	}

	if lastErr != nil {
		return nil, lastErr
	}

	return []SearchResultItem{}, nil
}

func uniquePubChemAttempts(stopwordStripped, tokenQuery, query string) []string {
	var attempts [3]string
	count := 0
	add := func(attempt string) {
		if attempt == "" {
			return
		}
		for i := 0; i < count; i++ {
			if attempts[i] == attempt {
				return
			}
		}
		attempts[count] = attempt
		count++
	}

	add(stopwordStripped)
	add(tokenQuery)
	add(query)
	return attempts[:count]
}

func searchHeaders(userAgent string) map[string]string {
	userAgent = strings.TrimSpace(userAgent)
	if userAgent == "" || len(userAgent) > maxSearchUserAgentBytes {
		return nil
	}
	return map[string]string{"User-Agent": userAgent}
}
