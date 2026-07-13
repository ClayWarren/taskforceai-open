package pkg

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/TaskForceAI/core/pkg/agent"
	coreengine "github.com/TaskForceAI/core/pkg/engine"
)

const defaultGatewayImageGenerationURL = "https://ai-gateway.vercel.sh/v1/chat/completions"

var (
	marshalGatewayImageRequest = json.Marshal
	doGatewayImageRequest      = func(req *http.Request) (*http.Response, error) {
		return (&http.Client{Timeout: 3 * time.Minute}).Do(req)
	}
)

type gatewayImageRequest struct {
	Model      string                `json:"model"`
	Messages   []gatewayImageMessage `json:"messages"`
	Modalities []string              `json:"modalities"`
	Stream     bool                  `json:"stream"`
}

type gatewayImageMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type gatewayImageResponse struct {
	Choices []gatewayImageChoice `json:"choices"`
}

type gatewayImageChoice struct {
	Message gatewayImageChoiceMessage `json:"message"`
}

type gatewayImageChoiceMessage struct {
	Content string              `json:"content"`
	Images  []gatewayImageEntry `json:"images"`
}

type gatewayImageEntry struct {
	Type     string                 `json:"type"`
	ImageURL gatewayImageURLPayload `json:"image_url"`
}

type gatewayImageURLPayload struct {
	URL string `json:"url"`
}

func gatewayImageEndpoint(baseURL string) string {
	base := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if base == "" || strings.Contains(base, "api.openai.com") {
		return defaultGatewayImageGenerationURL
	}
	if strings.HasSuffix(base, "/chat/completions") {
		return base
	}
	if strings.HasSuffix(base, "/v1") {
		return base + "/chat/completions"
	}
	return base + "/v1/chat/completions"
}

func gatewayImageModelID(modelID string) string {
	return coreengine.NormalizeImageGenerationModelID(modelID)
}

func (a *GeminiAdapter) generateGatewayImage(ctx context.Context, params agent.ChatCompletionCreateParams, prompt string) (*agent.ChatCompletion, error) {
	token, _ := gatewayVideoAuth(a.cfg.Gateway.APIKey)
	if token == "" {
		return nil, fmt.Errorf("AI Gateway credentials are required for image generation")
	}

	payload := gatewayImageRequest{
		Model: gatewayImageModelID(params.Model),
		Messages: []gatewayImageMessage{{
			Role:    string(agent.RoleUser),
			Content: prompt,
		}},
		Modalities: []string{"text", "image"},
		Stream:     false,
	}
	body, err := marshalGatewayImageRequest(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal image generation request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, gatewayImageEndpoint(a.cfg.Gateway.BaseURL), bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create image generation request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	for key, value := range a.cfg.Gateway.DefaultHeaders {
		req.Header.Set(key, value)
	}

	resp, err := doGatewayImageRequest(req)
	if err != nil {
		return nil, fmt.Errorf("image generation request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		errorBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, gatewayStatusError("image generation", resp.StatusCode, errorBody)
	}

	var completion gatewayImageResponse
	if err := json.NewDecoder(io.LimitReader(resp.Body, 20*1024*1024)).Decode(&completion); err != nil {
		return nil, fmt.Errorf("parse image generation response: %w", err)
	}

	for _, choice := range completion.Choices {
		for _, image := range choice.Message.Images {
			if !strings.EqualFold(image.Type, "image_url") {
				continue
			}
			imageURL := strings.TrimSpace(image.ImageURL.URL)
			if imageURL == "" {
				continue
			}
			if !strings.HasPrefix(imageURL, "data:image/") && !strings.HasPrefix(imageURL, "https://") {
				continue
			}
			return &agent.ChatCompletion{
				ID: "gateway-image",
				Choices: []agent.ChatCompletionChoice{{
					Message: agent.ChatCompletionMessage{
						Role:    agent.RoleAssistant,
						Content: fmt.Sprintf("![Generated Image](%s)", imageURL),
					},
				}},
			}, nil
		}
	}

	return nil, fmt.Errorf("image generation returned no images")
}
