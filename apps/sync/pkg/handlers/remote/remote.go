package remote

import (
	"context"
	"crypto/rand"
	"encoding/base32"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	goredis "github.com/redis/go-redis/v9"

	adapterauth "github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/handler"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
)

const (
	pairingTTL      = 10 * time.Minute
	resultTTL       = 5 * time.Minute
	maxCommands     = int64(100)
	maxStreamLength = int64(200)
)

type QueriesResolver func(context.Context) (*db.Queries, error)
type RedisResolver func() (redis.Cmdable, error)

type targetBody struct {
	DeviceName       string `json:"deviceName" minLength:"1" maxLength:"120"`
	AllowConnections bool   `json:"allowConnections"`
	KeepAwake        bool   `json:"keepAwake"`
}

type targetInput struct {
	Body      targetBody
	DeviceID  string `header:"X-Device-Id"`
	UserAgent string `header:"User-Agent"`
	handler.AuthContext
}

type pairingCodeInput struct {
	Body struct {
		DeviceName string `json:"deviceName" minLength:"1" maxLength:"120"`
	}
	DeviceID string `header:"X-Device-Id"`
	handler.AuthContext
}

type pairInput struct {
	Body struct {
		Code       string `json:"code" minLength:"8" maxLength:"32"`
		DeviceName string `json:"deviceName" minLength:"1" maxLength:"120"`
	}
	DeviceID  string `header:"X-Device-Id"`
	UserAgent string `header:"User-Agent"`
	handler.AuthContext
}

type deviceInput struct {
	DeviceID string `header:"X-Device-Id"`
	handler.AuthContext
}

type controllerInput struct {
	TargetDeviceID     string `header:"X-Device-Id"`
	ControllerDeviceID string `path:"controllerDeviceId"`
	handler.AuthContext
}

type targetPathInput struct {
	TargetDeviceID     string `path:"targetDeviceId"`
	ControllerDeviceID string `header:"X-Device-Id"`
	handler.AuthContext
}

type rpcInput struct {
	targetPathInput
	Body struct {
		Request json.RawMessage `json:"request"`
	}
}

type commandPollInput struct {
	TargetDeviceID string `path:"targetDeviceId"`
	DeviceID       string `header:"X-Device-Id"`
	LastID         string `query:"lastId" default:"0"`
	handler.AuthContext
}

type commandResultInput struct {
	TargetDeviceID string `path:"targetDeviceId"`
	CommandID      string `path:"commandId"`
	DeviceID       string `header:"X-Device-Id"`
	Body           struct {
		Response json.RawMessage `json:"response"`
	}
	handler.AuthContext
}

type commandResultPollInput struct {
	TargetDeviceID     string `path:"targetDeviceId"`
	CommandID          string `path:"commandId"`
	ControllerDeviceID string `header:"X-Device-Id"`
	handler.AuthContext
}

type pairingChallenge struct {
	UserID         string `json:"userId"`
	TargetDeviceID string `json:"targetDeviceId"`
	TargetName     string `json:"targetName"`
}

type remoteCommand struct {
	ID                 string          `json:"id"`
	ControllerDeviceID string          `json:"controllerDeviceId"`
	Request            json.RawMessage `json:"request"`
	CreatedAt          time.Time       `json:"createdAt"`
}

type storedResult struct {
	ControllerDeviceID string          `json:"controllerDeviceId"`
	Response           json.RawMessage `json:"response"`
}

type remoteTarget struct {
	DeviceID         string    `json:"deviceId"`
	DeviceName       string    `json:"deviceName"`
	AllowConnections bool      `json:"allowConnections"`
	KeepAwake        bool      `json:"keepAwake"`
	LastSeenAt       time.Time `json:"lastSeenAt"`
}

type remoteController struct {
	DeviceID        string    `json:"deviceId"`
	DeviceName      string    `json:"deviceName"`
	UserAgent       string    `json:"userAgent,omitempty"`
	LastConnectedAt time.Time `json:"lastConnectedAt"`
	Capabilities    []string  `json:"capabilities"`
}

func RegisterHandlers(api huma.API, resolveQueries QueriesResolver, resolveRedis RedisResolver) {
	huma.Register(api, huma.Operation{OperationID: "remote-target-upsert", Method: http.MethodPut, Path: "/api/v1/remote/target", Tags: []string{"Remote"}}, func(ctx context.Context, input *targetInput) (*struct{ Body remoteTarget }, error) {
		q, userID, err := dependencies(ctx, input.User, resolveQueries)
		if err != nil {
			return nil, err
		}
		deviceID, err := requiredDeviceID(input.DeviceID)
		if err != nil {
			return nil, err
		}
		name := strings.TrimSpace(input.Body.DeviceName)
		_, err = q.UpsertSyncDevice(ctx, db.UpsertSyncDeviceParams{UserID: userID, DeviceID: deviceID, DeviceName: &name, UserAgent: optionalString(input.UserAgent)})
		if err != nil {
			return nil, huma.Error500InternalServerError("Failed to register Remote device")
		}
		row, err := q.UpsertRemoteTarget(ctx, db.UpsertRemoteTargetParams{UserID: userID, DeviceID: deviceID, DeviceName: name, AllowConnections: input.Body.AllowConnections, KeepAwake: input.Body.KeepAwake})
		if err != nil {
			return nil, huma.Error500InternalServerError("Failed to update Remote device")
		}
		return &struct{ Body remoteTarget }{Body: targetFromRow(row)}, nil
	})

	huma.Register(api, huma.Operation{OperationID: "remote-pairing-code", Method: http.MethodPost, Path: "/api/v1/remote/pairing-code", Tags: []string{"Remote"}}, func(ctx context.Context, input *pairingCodeInput) (*struct {
		Body struct {
			Code      string `json:"code"`
			ExpiresIn int    `json:"expiresIn"`
		}
	}, error) {
		q, userID, err := dependencies(ctx, input.User, resolveQueries)
		if err != nil {
			return nil, err
		}
		deviceID, err := requiredDeviceID(input.DeviceID)
		if err != nil {
			return nil, err
		}
		target, err := q.GetRemoteTarget(ctx, db.GetRemoteTargetParams{UserID: userID, DeviceID: deviceID})
		if err != nil || !target.AllowConnections {
			return nil, huma.Error409Conflict("Enable Remote connections on this Mac first")
		}
		client, err := resolveRedis()
		if err != nil || client == nil {
			return nil, huma.Error503ServiceUnavailable("Remote relay unavailable")
		}
		code, err := pairingCode()
		if err != nil {
			return nil, huma.Error500InternalServerError("Failed to create pairing code")
		}
		challenge, _ := json.Marshal(pairingChallenge{UserID: userID, TargetDeviceID: deviceID, TargetName: target.DeviceName})
		if err := client.Set(ctx, pairingKey(code), challenge, pairingTTL); err != nil {
			return nil, huma.Error503ServiceUnavailable("Remote relay unavailable")
		}
		body := struct {
			Code      string `json:"code"`
			ExpiresIn int    `json:"expiresIn"`
		}{Code: code, ExpiresIn: int(pairingTTL.Seconds())}
		return &struct {
			Body struct {
				Code      string `json:"code"`
				ExpiresIn int    `json:"expiresIn"`
			}
		}{Body: body}, nil
	})

	huma.Register(api, huma.Operation{OperationID: "remote-pair", Method: http.MethodPost, Path: "/api/v1/remote/pair", Tags: []string{"Remote"}}, func(ctx context.Context, input *pairInput) (*struct{ Body remoteTarget }, error) {
		q, userID, err := dependencies(ctx, input.User, resolveQueries)
		if err != nil {
			return nil, err
		}
		controllerID, err := requiredDeviceID(input.DeviceID)
		if err != nil {
			return nil, err
		}
		client, err := resolveRedis()
		if err != nil || client == nil {
			return nil, huma.Error503ServiceUnavailable("Remote relay unavailable")
		}
		code := normalizeCode(input.Body.Code)
		raw, err := consumePairingChallenge(ctx, client, code, userID)
		if errors.Is(err, redis.ErrKeyNotFound) || errors.Is(err, goredis.Nil) {
			return nil, huma.Error410Gone("Pairing code expired")
		}
		if errors.Is(err, errPairingAccountMismatch) {
			return nil, huma.Error403Forbidden("Pairing code is not valid for this account")
		}
		if err != nil {
			return nil, huma.Error503ServiceUnavailable("Remote relay unavailable")
		}
		var challenge pairingChallenge
		if json.Unmarshal([]byte(raw), &challenge) != nil || challenge.UserID != userID {
			return nil, huma.Error403Forbidden("Pairing code is not valid for this account")
		}
		target, err := q.GetRemoteTarget(ctx, db.GetRemoteTargetParams{UserID: userID, DeviceID: challenge.TargetDeviceID})
		if err != nil || !target.AllowConnections {
			return nil, huma.Error409Conflict("Remote connections are disabled on this Mac")
		}
		name := strings.TrimSpace(input.Body.DeviceName)
		_, err = q.UpsertSyncDevice(ctx, db.UpsertSyncDeviceParams{UserID: userID, DeviceID: controllerID, DeviceName: &name, UserAgent: optionalString(input.UserAgent)})
		if err != nil {
			return nil, huma.Error500InternalServerError("Failed to register controller")
		}
		_, err = q.UpsertRemoteConnection(ctx, db.UpsertRemoteConnectionParams{UserID: userID, TargetDeviceID: challenge.TargetDeviceID, ControllerDeviceID: controllerID})
		if err != nil {
			return nil, huma.Error500InternalServerError("Failed to save Remote connection")
		}
		return &struct{ Body remoteTarget }{Body: targetFromRow(target)}, nil
	})

	huma.Register(api, huma.Operation{OperationID: "remote-connection-list", Method: http.MethodGet, Path: "/api/v1/remote/connections", Tags: []string{"Remote"}}, func(ctx context.Context, input *deviceInput) (*struct {
		Body struct {
			Devices []remoteTarget `json:"devices"`
		}
	}, error) {
		q, userID, err := dependencies(ctx, input.User, resolveQueries)
		if err != nil {
			return nil, err
		}
		controllerID, err := requiredDeviceID(input.DeviceID)
		if err != nil {
			return nil, err
		}
		rows, err := q.ListRemoteConnectionsForController(ctx, db.ListRemoteConnectionsForControllerParams{UserID: userID, ControllerDeviceID: controllerID})
		if err != nil {
			return nil, huma.Error500InternalServerError("Failed to list Remote connections")
		}
		devices := make([]remoteTarget, 0, len(rows))
		for _, row := range rows {
			online := row.AllowConnections && time.Since(row.TargetLastSeenAt.Time) < 15*time.Second
			devices = append(devices, remoteTarget{DeviceID: row.TargetDeviceID, DeviceName: row.TargetName, AllowConnections: online, KeepAwake: row.KeepAwake, LastSeenAt: row.TargetLastSeenAt.Time})
		}
		body := struct {
			Devices []remoteTarget `json:"devices"`
		}{Devices: devices}
		return &struct {
			Body struct {
				Devices []remoteTarget `json:"devices"`
			}
		}{Body: body}, nil
	})

	huma.Register(api, huma.Operation{OperationID: "remote-controller-list", Method: http.MethodGet, Path: "/api/v1/remote/controllers", Tags: []string{"Remote"}}, func(ctx context.Context, input *deviceInput) (*struct {
		Body struct {
			Devices []remoteController `json:"devices"`
		}
	}, error) {
		q, userID, err := dependencies(ctx, input.User, resolveQueries)
		if err != nil {
			return nil, err
		}
		targetID, err := requiredDeviceID(input.DeviceID)
		if err != nil {
			return nil, err
		}
		rows, err := q.ListRemoteControllersForTarget(ctx, db.ListRemoteControllersForTargetParams{UserID: userID, TargetDeviceID: targetID})
		if err != nil {
			return nil, huma.Error500InternalServerError("Failed to list Remote controllers")
		}
		devices := make([]remoteController, 0, len(rows))
		for _, row := range rows {
			devices = append(devices, remoteController{DeviceID: row.ControllerDeviceID, DeviceName: valueOr(row.ControllerName, "Mobile device"), UserAgent: valueOr(row.ControllerUserAgent, ""), LastConnectedAt: row.LastUsedAt.Time, Capabilities: row.Capabilities})
		}
		body := struct {
			Devices []remoteController `json:"devices"`
		}{Devices: devices}
		return &struct {
			Body struct {
				Devices []remoteController `json:"devices"`
			}
		}{Body: body}, nil
	})

	huma.Register(api, huma.Operation{OperationID: "remote-controller-revoke", Method: http.MethodDelete, Path: "/api/v1/remote/controllers/{controllerDeviceId}", Tags: []string{"Remote"}}, func(ctx context.Context, input *controllerInput) (*struct{ Body map[string]bool }, error) {
		q, userID, err := dependencies(ctx, input.User, resolveQueries)
		if err != nil {
			return nil, err
		}
		targetID, err := requiredDeviceID(input.TargetDeviceID)
		if err != nil {
			return nil, err
		}
		if err := q.RevokeRemoteConnection(ctx, db.RevokeRemoteConnectionParams{UserID: userID, TargetDeviceID: targetID, ControllerDeviceID: strings.TrimSpace(input.ControllerDeviceID)}); err != nil {
			return nil, huma.Error500InternalServerError("Failed to revoke Remote access")
		}
		return &struct{ Body map[string]bool }{Body: map[string]bool{"success": true}}, nil
	})

	huma.Register(api, huma.Operation{OperationID: "remote-rpc-enqueue", Method: http.MethodPost, Path: "/api/v1/remote/devices/{targetDeviceId}/rpc", Tags: []string{"Remote"}}, func(ctx context.Context, input *rpcInput) (*struct {
		Body struct {
			CommandID string `json:"commandId"`
		}
	}, error) {
		q, userID, err := dependencies(ctx, input.User, resolveQueries)
		if err != nil {
			return nil, err
		}
		controllerID, err := requiredDeviceID(input.ControllerDeviceID)
		if err != nil {
			return nil, err
		}
		if len(input.Body.Request) == 0 || !json.Valid(input.Body.Request) {
			return nil, huma.Error400BadRequest("Valid JSON-RPC request is required")
		}
		active, err := q.IsActiveRemoteConnection(ctx, db.IsActiveRemoteConnectionParams{UserID: userID, TargetDeviceID: input.TargetDeviceID, ControllerDeviceID: controllerID})
		if err != nil || !active {
			return nil, huma.Error403Forbidden("Remote connection is not active")
		}
		client, err := resolveRedis()
		if err != nil || client == nil {
			return nil, huma.Error503ServiceUnavailable("Remote relay unavailable")
		}
		commandID, err := randomHex(16)
		if err != nil {
			return nil, huma.Error500InternalServerError("Failed to create Remote command")
		}
		command := remoteCommand{ID: commandID, ControllerDeviceID: controllerID, Request: input.Body.Request, CreatedAt: time.Now().UTC()}
		encoded, _ := json.Marshal(command)
		if _, err := client.XAdd(ctx, commandStream(userID, input.TargetDeviceID), map[string]any{"command": string(encoded)}); err != nil {
			return nil, huma.Error503ServiceUnavailable("Remote relay unavailable")
		}
		_, _ = client.XTrimMaxLen(ctx, commandStream(userID, input.TargetDeviceID), maxStreamLength)
		_ = q.TouchRemoteConnection(ctx, db.TouchRemoteConnectionParams{UserID: userID, TargetDeviceID: input.TargetDeviceID, ControllerDeviceID: controllerID})
		body := struct {
			CommandID string `json:"commandId"`
		}{CommandID: commandID}
		return &struct {
			Body struct {
				CommandID string `json:"commandId"`
			}
		}{Body: body}, nil
	})

	huma.Register(api, huma.Operation{OperationID: "remote-command-poll", Method: http.MethodGet, Path: "/api/v1/remote/devices/{targetDeviceId}/commands", Tags: []string{"Remote"}}, func(ctx context.Context, input *commandPollInput) (*struct {
		Body struct {
			Commands []remoteCommand `json:"commands"`
			LastID   string          `json:"lastId"`
		}
	}, error) {
		q, userID, err := dependencies(ctx, input.User, resolveQueries)
		if err != nil {
			return nil, err
		}
		deviceID, err := requiredDeviceID(input.DeviceID)
		if err != nil || deviceID != input.TargetDeviceID {
			return nil, huma.Error403Forbidden("Remote target mismatch")
		}
		target, err := q.GetRemoteTarget(ctx, db.GetRemoteTargetParams{UserID: userID, DeviceID: deviceID})
		if err != nil || !target.AllowConnections {
			return nil, huma.Error403Forbidden("Remote connections are disabled")
		}
		_ = q.TouchRemoteTarget(ctx, db.TouchRemoteTargetParams{UserID: userID, DeviceID: deviceID})
		client, err := resolveRedis()
		if err != nil || client == nil {
			return nil, huma.Error503ServiceUnavailable("Remote relay unavailable")
		}
		lastID := strings.TrimSpace(input.LastID)
		if lastID == "" {
			lastID = "0"
		}
		messages, err := client.XRead(ctx, commandStream(userID, deviceID), lastID, maxCommands)
		if err != nil {
			return nil, huma.Error503ServiceUnavailable("Remote relay unavailable")
		}
		commands := make([]remoteCommand, 0, len(messages))
		for _, message := range messages {
			lastID = message.ID
			raw := fmt.Sprintf("%v", message.Values["command"])
			var command remoteCommand
			if json.Unmarshal([]byte(raw), &command) != nil {
				continue
			}
			active, activeErr := q.IsActiveRemoteConnection(ctx, db.IsActiveRemoteConnectionParams{UserID: userID, TargetDeviceID: deviceID, ControllerDeviceID: command.ControllerDeviceID})
			if activeErr == nil && active {
				commands = append(commands, command)
			}
		}
		body := struct {
			Commands []remoteCommand `json:"commands"`
			LastID   string          `json:"lastId"`
		}{Commands: commands, LastID: lastID}
		return &struct {
			Body struct {
				Commands []remoteCommand `json:"commands"`
				LastID   string          `json:"lastId"`
			}
		}{Body: body}, nil
	})

	huma.Register(api, huma.Operation{OperationID: "remote-command-result-put", Method: http.MethodPut, Path: "/api/v1/remote/devices/{targetDeviceId}/commands/{commandId}/result", Tags: []string{"Remote"}}, func(ctx context.Context, input *commandResultInput) (*struct{ Body map[string]bool }, error) {
		_, userID, err := dependencies(ctx, input.User, resolveQueries)
		if err != nil {
			return nil, err
		}
		deviceID, err := requiredDeviceID(input.DeviceID)
		if err != nil || deviceID != input.TargetDeviceID {
			return nil, huma.Error403Forbidden("Remote target mismatch")
		}
		if len(input.Body.Response) == 0 || !json.Valid(input.Body.Response) {
			return nil, huma.Error400BadRequest("Valid JSON-RPC response is required")
		}
		client, err := resolveRedis()
		if err != nil || client == nil {
			return nil, huma.Error503ServiceUnavailable("Remote relay unavailable")
		}
		// The controller ID is copied from the command by the trusted desktop worker.
		var envelope struct {
			ControllerDeviceID string          `json:"controllerDeviceId"`
			Response           json.RawMessage `json:"response"`
		}
		if json.Unmarshal(input.Body.Response, &envelope) != nil || envelope.ControllerDeviceID == "" || len(envelope.Response) == 0 {
			return nil, huma.Error400BadRequest("Remote result envelope is invalid")
		}
		encoded, _ := json.Marshal(storedResult{ControllerDeviceID: envelope.ControllerDeviceID, Response: envelope.Response})
		if err := client.Set(ctx, resultKey(userID, input.TargetDeviceID, input.CommandID), encoded, resultTTL); err != nil {
			return nil, huma.Error503ServiceUnavailable("Remote relay unavailable")
		}
		return &struct{ Body map[string]bool }{Body: map[string]bool{"success": true}}, nil
	})

	huma.Register(api, huma.Operation{OperationID: "remote-command-result-get", Method: http.MethodGet, Path: "/api/v1/remote/devices/{targetDeviceId}/commands/{commandId}/result", Tags: []string{"Remote"}}, func(ctx context.Context, input *commandResultPollInput) (*struct {
		Body struct {
			Status   string          `json:"status"`
			Response json.RawMessage `json:"response,omitempty"`
		}
	}, error) {
		q, userID, err := dependencies(ctx, input.User, resolveQueries)
		if err != nil {
			return nil, err
		}
		controllerID, err := requiredDeviceID(input.ControllerDeviceID)
		if err != nil {
			return nil, err
		}
		active, err := q.IsActiveRemoteConnection(ctx, db.IsActiveRemoteConnectionParams{UserID: userID, TargetDeviceID: input.TargetDeviceID, ControllerDeviceID: controllerID})
		if err != nil || !active {
			return nil, huma.Error403Forbidden("Remote connection is not active")
		}
		client, err := resolveRedis()
		if err != nil || client == nil {
			return nil, huma.Error503ServiceUnavailable("Remote relay unavailable")
		}
		raw, err := client.Get(ctx, resultKey(userID, input.TargetDeviceID, input.CommandID))
		body := struct {
			Status   string          `json:"status"`
			Response json.RawMessage `json:"response,omitempty"`
		}{Status: "pending"}
		if errors.Is(err, redis.ErrKeyNotFound) {
			return &struct {
				Body struct {
					Status   string          `json:"status"`
					Response json.RawMessage `json:"response,omitempty"`
				}
			}{Body: body}, nil
		}
		if err != nil {
			return nil, huma.Error503ServiceUnavailable("Remote relay unavailable")
		}
		var result storedResult
		if json.Unmarshal([]byte(raw), &result) != nil || result.ControllerDeviceID != controllerID {
			return nil, huma.Error403Forbidden("Remote result is not available to this device")
		}
		body.Status = "complete"
		body.Response = result.Response
		return &struct {
			Body struct {
				Status   string          `json:"status"`
				Response json.RawMessage `json:"response,omitempty"`
			}
		}{Body: body}, nil
	})
}

func dependencies(ctx context.Context, user *adapterauth.AuthenticatedUser, resolve QueriesResolver) (*db.Queries, string, error) {
	if user == nil || user.ID <= 0 {
		return nil, "", huma.Error401Unauthorized("Unauthorized")
	}
	q, err := resolve(ctx)
	if err != nil || q == nil {
		return nil, "", huma.Error503ServiceUnavailable("Remote service unavailable")
	}
	return q, strconv.Itoa(user.ID), nil
}

func requiredDeviceID(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > 200 {
		return "", huma.Error400BadRequest("Device ID is required")
	}
	return value, nil
}

func optionalString(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}
func valueOr(value *string, fallback string) string {
	if value == nil || strings.TrimSpace(*value) == "" {
		return fallback
	}
	return *value
}
func targetFromRow(row db.RemoteTarget) remoteTarget {
	return remoteTarget{DeviceID: row.DeviceID, DeviceName: row.DeviceName, AllowConnections: row.AllowConnections, KeepAwake: row.KeepAwake, LastSeenAt: row.LastSeenAt.Time}
}
func normalizeCode(value string) string {
	return strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(value), "-", ""))
}
func pairingKey(code string) string { return "remote:pairing:" + normalizeCode(code) }
func commandStream(userID, deviceID string) string {
	return "remote:commands:" + userID + ":" + deviceID
}
func resultKey(userID, deviceID, commandID string) string {
	return "remote:result:" + userID + ":" + deviceID + ":" + commandID
}

func pairingCode() (string, error) {
	var raw [5]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	code := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(raw[:])
	return code[:4] + "-" + code[4:8], nil
}

func randomHex(size int) (string, error) {
	raw := make([]byte, size)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return hex.EncodeToString(raw), nil
}

var errPairingAccountMismatch = errors.New("pairing account mismatch")

func consumePairingChallenge(ctx context.Context, client redis.Cmdable, code, userID string) (string, error) {
	const script = `
local raw = redis.call("GET", KEYS[1])
if not raw then return nil end
local ok, challenge = pcall(cjson.decode, raw)
if not ok or tostring(challenge.userId) ~= ARGV[1] then return "__REMOTE_ACCOUNT_MISMATCH__" end
redis.call("DEL", KEYS[1])
return raw
`
	result, err := client.Eval(ctx, script, []string{pairingKey(code)}, userID).Result()
	if err != nil {
		return "", err
	}
	raw, ok := result.(string)
	if !ok {
		return "", redis.ErrKeyNotFound
	}
	if raw == "__REMOTE_ACCOUNT_MISMATCH__" {
		return "", errPairingAccountMismatch
	}
	return raw, nil
}
