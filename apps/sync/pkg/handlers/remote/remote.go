package remote

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base32"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/jackc/pgx/v5"
	goredis "github.com/redis/go-redis/v9"

	adapterauth "github.com/TaskForceAI/adapters/pkg/auth"
	"github.com/TaskForceAI/adapters/pkg/db"
	"github.com/TaskForceAI/adapters/pkg/handler"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
)

const (
	pairingTTL          = 10 * time.Minute
	resultTTL           = 5 * time.Minute
	maxPollWait         = 10 * time.Second
	maxCommands         = int64(100)
	maxStreamLength     = int64(200)
	remotePollTTL       = 30 * time.Second
	remotePollSlots     = 4
	pairingClaimTTL     = 30 * time.Second
	remoteCommandMaxAge = 5 * time.Minute
)

var (
	errRemotePollActive   = errors.New("remote command poll already active")
	errRemotePollCapacity = errors.New("remote long-poll capacity reached")
)

type QueriesResolver func(context.Context) (*db.Queries, error)
type RedisResolver func() (redis.Cmdable, error)

type blockingStreamReader interface {
	XReadBlock(context.Context, string, string, int64, time.Duration) ([]goredis.XMessage, error)
}

type targetBody struct {
	DeviceName       string `json:"deviceName" minLength:"1" maxLength:"120"`
	AllowConnections bool   `json:"allowConnections"`
	KeepAwake        bool   `json:"keepAwake"`
}

type targetInput struct {
	Body             targetBody
	DeviceID         string `header:"X-Device-Id"`
	DeviceCredential string `header:"X-Device-Credential"`
	UserAgent        string `header:"User-Agent"`
	handler.AuthContext
}

type pairingCodeInput struct {
	Body struct {
		DeviceName string `json:"deviceName" minLength:"1" maxLength:"120"`
	}
	DeviceID         string `header:"X-Device-Id"`
	DeviceCredential string `header:"X-Device-Credential"`
	handler.AuthContext
}

type pairInput struct {
	Body struct {
		Code       string `json:"code" minLength:"8" maxLength:"32"`
		DeviceName string `json:"deviceName" minLength:"1" maxLength:"120"`
	}
	DeviceID         string `header:"X-Device-Id"`
	DeviceCredential string `header:"X-Device-Credential"`
	UserAgent        string `header:"User-Agent"`
	handler.AuthContext
}

type deviceInput struct {
	DeviceID         string `header:"X-Device-Id"`
	DeviceCredential string `header:"X-Device-Credential"`
	handler.AuthContext
}

type controllerInput struct {
	TargetDeviceID     string `header:"X-Device-Id"`
	ControllerDeviceID string `path:"controllerDeviceId"`
	DeviceCredential   string `header:"X-Device-Credential"`
	handler.AuthContext
}

type targetPathInput struct {
	TargetDeviceID     string `path:"targetDeviceId"`
	ControllerDeviceID string `header:"X-Device-Id"`
	DeviceCredential   string `header:"X-Device-Credential"`
	handler.AuthContext
}

type rpcInput struct {
	TargetDeviceID     string `path:"targetDeviceId"`
	ControllerDeviceID string `header:"X-Device-Id"`
	DeviceCredential   string `header:"X-Device-Credential"`
	Body               struct {
		Request json.RawMessage `json:"request"`
	}
	handler.AuthContext
}

type commandPollInput struct {
	TargetDeviceID   string `path:"targetDeviceId"`
	DeviceID         string `header:"X-Device-Id"`
	DeviceCredential string `header:"X-Device-Credential"`
	LastID           string `query:"lastId" default:"0"`
	WaitMS           int    `query:"waitMs" default:"0" minimum:"0" maximum:"10000"`
	handler.AuthContext
}

type commandResultInput struct {
	TargetDeviceID   string `path:"targetDeviceId"`
	CommandID        string `path:"commandId"`
	DeviceID         string `header:"X-Device-Id"`
	DeviceCredential string `header:"X-Device-Credential"`
	Body             struct {
		Response json.RawMessage `json:"response"`
	}
	handler.AuthContext
}

type commandResultPollInput struct {
	TargetDeviceID     string `path:"targetDeviceId"`
	CommandID          string `path:"commandId"`
	ControllerDeviceID string `header:"X-Device-Id"`
	DeviceCredential   string `header:"X-Device-Credential"`
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
	registerRemoteTarget(api, resolveQueries)
	registerPairingCode(api, resolveQueries, resolveRedis)
	registerPairing(api, resolveQueries, resolveRedis)
	registerConnectionList(api, resolveQueries)
	registerControllerList(api, resolveQueries)
	registerControllerRevoke(api, resolveQueries)
	registerRPCEnqueue(api, resolveQueries, resolveRedis)
	registerCommandPoll(api, resolveQueries, resolveRedis)
	registerCommandResultPut(api, resolveQueries, resolveRedis)
	registerCommandResultGet(api, resolveQueries, resolveRedis)
}

func registerRemoteTarget(api huma.API, resolveQueries QueriesResolver) {
	huma.Register(api, huma.Operation{OperationID: "remote-target-upsert", Method: http.MethodPut, Path: "/api/v1/remote/target", Tags: []string{"Remote"}}, func(ctx context.Context, input *targetInput) (*struct{ Body remoteTarget }, error) {
		q, userID, err := dependencies(ctx, input.User, resolveQueries)
		if err != nil {
			return nil, err
		}
		deviceID, err := requiredDeviceID(input.DeviceID)
		if err != nil {
			return nil, err
		}
		if err := claimDeviceCredential(ctx, q, userID, deviceID, input.DeviceCredential); err != nil {
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
}

func registerPairingCode(api huma.API, resolveQueries QueriesResolver, resolveRedis RedisResolver) {
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
		if err := verifyDeviceCredential(ctx, q, userID, deviceID, input.DeviceCredential); err != nil {
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
}

func registerPairing(api huma.API, resolveQueries QueriesResolver, resolveRedis RedisResolver) {
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
		if _, err := requiredDeviceCredential(input.DeviceCredential); err != nil {
			return nil, err
		}
		code := normalizeCode(input.Body.Code)
		challenge, releaseClaim, completeClaim, err := reservePairingChallenge(ctx, client, code, userID)
		if errors.Is(err, redis.ErrKeyNotFound) || errors.Is(err, goredis.Nil) {
			return nil, huma.Error410Gone("Pairing code expired")
		}
		if errors.Is(err, errPairingAccountMismatch) {
			return nil, huma.Error403Forbidden("Pairing code is not valid for this account")
		}
		if errors.Is(err, errPairingClaimed) {
			return nil, huma.Error409Conflict("Pairing code is already being claimed")
		}
		if err != nil {
			return nil, huma.Error503ServiceUnavailable("Remote relay unavailable")
		}
		defer releaseClaim()
		target, err := q.GetRemoteTarget(ctx, db.GetRemoteTargetParams{UserID: userID, DeviceID: challenge.TargetDeviceID})
		if err != nil || !target.AllowConnections {
			return nil, huma.Error409Conflict("Remote connections are disabled on this Mac")
		}
		if err := claimDeviceCredential(ctx, q, userID, controllerID, input.DeviceCredential); err != nil {
			return nil, err
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
		if err := completeClaim(); err != nil {
			return nil, huma.Error503ServiceUnavailable("Remote relay unavailable")
		}
		return &struct{ Body remoteTarget }{Body: targetFromRow(target)}, nil
	})
}

func registerConnectionList(api huma.API, resolveQueries QueriesResolver) {
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
		if err := verifyDeviceCredential(ctx, q, userID, controllerID, input.DeviceCredential); err != nil {
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
}

func registerControllerList(api huma.API, resolveQueries QueriesResolver) {
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
		if err := verifyDeviceCredential(ctx, q, userID, targetID, input.DeviceCredential); err != nil {
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
}

func registerControllerRevoke(api huma.API, resolveQueries QueriesResolver) {
	huma.Register(api, huma.Operation{OperationID: "remote-controller-revoke", Method: http.MethodDelete, Path: "/api/v1/remote/controllers/{controllerDeviceId}", Tags: []string{"Remote"}}, func(ctx context.Context, input *controllerInput) (*struct{ Body map[string]bool }, error) {
		q, userID, err := dependencies(ctx, input.User, resolveQueries)
		if err != nil {
			return nil, err
		}
		targetID, err := requiredDeviceID(input.TargetDeviceID)
		if err != nil {
			return nil, err
		}
		if err := verifyDeviceCredential(ctx, q, userID, targetID, input.DeviceCredential); err != nil {
			return nil, err
		}
		if err := q.RevokeRemoteConnection(ctx, db.RevokeRemoteConnectionParams{UserID: userID, TargetDeviceID: targetID, ControllerDeviceID: strings.TrimSpace(input.ControllerDeviceID)}); err != nil {
			return nil, huma.Error500InternalServerError("Failed to revoke Remote access")
		}
		return &struct{ Body map[string]bool }{Body: map[string]bool{"success": true}}, nil
	})
}

func registerRPCEnqueue(api huma.API, resolveQueries QueriesResolver, resolveRedis RedisResolver) {
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
		if err := verifyDeviceCredential(ctx, q, userID, controllerID, input.DeviceCredential); err != nil {
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
}

func registerCommandPoll(api huma.API, resolveQueries QueriesResolver, resolveRedis RedisResolver) {
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
		if err := verifyDeviceCredential(ctx, q, userID, deviceID, input.DeviceCredential); err != nil {
			return nil, err
		}
		// An outstanding HTTP long poll is an active desktop connection. Refresh at
		// both edges so proxy/WebSocket fallback latency cannot make it appear
		// offline while the poll is waiting for commands.
		_ = q.TouchRemoteTarget(ctx, db.TouchRemoteTargetParams{UserID: userID, DeviceID: deviceID})
		client, err := resolveRedis()
		if err != nil || client == nil {
			return nil, huma.Error503ServiceUnavailable("Remote relay unavailable")
		}
		lastID := strings.TrimSpace(input.LastID)
		if lastID == "" {
			lastID = "$"
		}
		wait := min(time.Duration(input.WaitMS)*time.Millisecond, maxPollWait)
		messages, err := readRemoteCommands(ctx, client, userID, deviceID, lastID, wait)
		if errors.Is(err, errRemotePollActive) || errors.Is(err, errRemotePollCapacity) {
			return nil, huma.Error429TooManyRequests(err.Error())
		}
		if err != nil {
			return nil, huma.Error503ServiceUnavailable("Remote relay unavailable")
		}
		_ = q.TouchRemoteTarget(ctx, db.TouchRemoteTargetParams{UserID: userID, DeviceID: deviceID})
		commands, lastID := decodeRemoteCommands(ctx, q, userID, deviceID, messages, lastID)
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
}

func registerCommandResultPut(api huma.API, resolveQueries QueriesResolver, resolveRedis RedisResolver) {
	huma.Register(api, huma.Operation{OperationID: "remote-command-result-put", Method: http.MethodPut, Path: "/api/v1/remote/devices/{targetDeviceId}/commands/{commandId}/result", Tags: []string{"Remote"}}, func(ctx context.Context, input *commandResultInput) (*struct{ Body map[string]bool }, error) {
		q, userID, err := dependencies(ctx, input.User, resolveQueries)
		if err != nil {
			return nil, err
		}
		deviceID, err := requiredDeviceID(input.DeviceID)
		if err != nil || deviceID != input.TargetDeviceID {
			return nil, huma.Error403Forbidden("Remote target mismatch")
		}
		if err := verifyDeviceCredential(ctx, q, userID, deviceID, input.DeviceCredential); err != nil {
			return nil, err
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
		if err := storeRemoteResult(
			ctx, client, userID, input.TargetDeviceID, input.CommandID,
			envelope.ControllerDeviceID, envelope.Response,
		); err != nil {
			return nil, huma.Error503ServiceUnavailable("Remote relay unavailable")
		}
		return &struct{ Body map[string]bool }{Body: map[string]bool{"success": true}}, nil
	})
}

func storeRemoteResult(
	ctx context.Context,
	client redis.Cmdable,
	userID string,
	deviceID string,
	commandID string,
	controllerDeviceID string,
	response json.RawMessage,
) error {
	encoded, err := json.Marshal(storedResult{
		ControllerDeviceID: controllerDeviceID,
		Response:           response,
	})
	if err != nil {
		return err
	}
	return client.Set(ctx, resultKey(userID, deviceID, commandID), encoded, resultTTL)
}

func registerCommandResultGet(api huma.API, resolveQueries QueriesResolver, resolveRedis RedisResolver) {
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
		if err := verifyDeviceCredential(ctx, q, userID, controllerID, input.DeviceCredential); err != nil {
			return nil, err
		}
		authorized, err := q.IsAuthorizedRemoteConnection(ctx, db.IsAuthorizedRemoteConnectionParams{UserID: userID, TargetDeviceID: input.TargetDeviceID, ControllerDeviceID: controllerID})
		if err != nil || !authorized {
			return nil, huma.Error403Forbidden("Remote connection is not authorized")
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

func requiredDeviceCredential(value string) (string, error) {
	value = strings.TrimSpace(value)
	if len(value) < 43 || len(value) > 128 {
		return "", huma.Error401Unauthorized("Remote device credential required")
	}
	return value, nil
}

func deviceCredentialHash(value string) string {
	digest := sha256.Sum256([]byte(value))
	return hex.EncodeToString(digest[:])
}

func claimDeviceCredential(
	ctx context.Context,
	q *db.Queries,
	userID string,
	deviceID string,
	rawCredential string,
) error {
	credential, err := requiredDeviceCredential(rawCredential)
	if err != nil {
		return err
	}
	digest := deviceCredentialHash(credential)
	if err := q.ClaimRemoteDeviceCredential(ctx, db.ClaimRemoteDeviceCredentialParams{
		UserID: userID, DeviceID: deviceID, CredentialHash: digest,
	}); err != nil {
		return huma.Error503ServiceUnavailable("Remote device authentication unavailable")
	}
	return compareDeviceCredential(ctx, q, userID, deviceID, digest)
}

func verifyDeviceCredential(
	ctx context.Context,
	q *db.Queries,
	userID string,
	deviceID string,
	rawCredential string,
) error {
	credential, err := requiredDeviceCredential(rawCredential)
	if err != nil {
		return err
	}
	return compareDeviceCredential(ctx, q, userID, deviceID, deviceCredentialHash(credential))
}

func compareDeviceCredential(
	ctx context.Context,
	q *db.Queries,
	userID string,
	deviceID string,
	digest string,
) error {
	stored, err := q.GetRemoteDeviceCredentialHash(ctx, db.GetRemoteDeviceCredentialHashParams{
		UserID: userID, DeviceID: deviceID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return huma.Error403Forbidden("Remote device is not authorized")
	}
	if err != nil {
		return huma.Error503ServiceUnavailable("Remote device authentication unavailable")
	}
	if subtle.ConstantTimeCompare([]byte(stored), []byte(digest)) != 1 {
		return huma.Error403Forbidden("Remote device credential mismatch")
	}
	return nil
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

type remotePollLease struct {
	client redis.Cmdable
	keys   []string
	token  string
}

func readRemoteCommands(ctx context.Context, client redis.Cmdable, userID, deviceID, lastID string, wait time.Duration) ([]goredis.XMessage, error) {
	if wait <= 0 {
		return client.XRead(ctx, commandStream(userID, deviceID), lastID, maxCommands)
	}
	blockingClient, ok := client.(blockingStreamReader)
	if !ok {
		return nil, errors.New("blocking Redis stream reads are unavailable")
	}
	lease, err := acquireRemotePollLease(ctx, client, userID, deviceID)
	if err != nil {
		return nil, err
	}
	defer lease.release(ctx)
	return blockingClient.XReadBlock(ctx, commandStream(userID, deviceID), lastID, maxCommands, wait)
}

func remotePollDeviceLeaseKey(userID, deviceID string) string {
	digest := sha256.Sum256([]byte(userID + "\x00" + deviceID))
	return "remote:poll:device:" + hex.EncodeToString(digest[:])
}

func remotePollUserSlotKey(userID string, slot int) string {
	digest := sha256.Sum256([]byte(userID))
	return fmt.Sprintf("remote:poll:user:%s:%d", hex.EncodeToString(digest[:]), slot)
}

func acquireRemotePollLease(ctx context.Context, client redis.Cmdable, userID, deviceID string) (*remotePollLease, error) {
	token, err := randomHex(16)
	if err != nil {
		return nil, fmt.Errorf("create remote poll lease token: %w", err)
	}
	deviceKey := remotePollDeviceLeaseKey(userID, deviceID)
	acquired, err := client.SetNX(ctx, deviceKey, []byte(token), remotePollTTL)
	if err != nil {
		return nil, fmt.Errorf("acquire remote device poll lease: %w", err)
	}
	if !acquired {
		return nil, errRemotePollActive
	}
	lease := &remotePollLease{client: client, keys: []string{deviceKey}, token: token}
	for slot := range remotePollSlots {
		slotKey := remotePollUserSlotKey(userID, slot)
		acquired, err = client.SetNX(ctx, slotKey, []byte(token), remotePollTTL)
		if err != nil {
			lease.release(ctx)
			return nil, fmt.Errorf("acquire remote user poll slot: %w", err)
		}
		if acquired {
			lease.keys = append(lease.keys, slotKey)
			return lease, nil
		}
	}
	lease.release(ctx)
	return nil, errRemotePollCapacity
}

func (lease *remotePollLease) release(parent context.Context) {
	const script = `
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
end
return 0
`
	ctx, cancel := context.WithTimeout(context.WithoutCancel(parent), 2*time.Second)
	defer cancel()
	for _, key := range lease.keys {
		if err := lease.client.Eval(ctx, script, []string{key}, lease.token).Err(); err != nil {
			slog.Warn("Failed to release remote poll lease", "key", key, "error", err)
		}
	}
}

var readRandom = rand.Read

func pairingCode() (string, error) {
	var raw [5]byte
	if _, err := readRandom(raw[:]); err != nil {
		return "", err
	}
	code := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(raw[:])
	return code[:4] + "-" + code[4:8], nil
}

func randomHex(size int) (string, error) {
	raw := make([]byte, size)
	if _, err := readRandom(raw); err != nil {
		return "", err
	}
	return hex.EncodeToString(raw), nil
}

var (
	errPairingAccountMismatch = errors.New("pairing account mismatch")
	errPairingClaimed         = errors.New("pairing code is already being claimed")
)

func reservePairingChallenge(ctx context.Context, client redis.Cmdable, code, userID string) (pairingChallenge, func(), func() error, error) {
	raw, err := client.Get(ctx, pairingKey(code))
	if err != nil {
		return pairingChallenge{}, func() {}, func() error { return nil }, err
	}
	var challenge pairingChallenge
	if json.Unmarshal([]byte(raw), &challenge) != nil || challenge.UserID != userID {
		return pairingChallenge{}, func() {}, func() error { return nil }, errPairingAccountMismatch
	}
	token, err := randomHex(16)
	if err != nil {
		return pairingChallenge{}, func() {}, func() error { return nil }, err
	}
	claimKey := pairingKey(code) + ":claim"
	claimed, err := client.SetNX(ctx, claimKey, []byte(token), pairingClaimTTL)
	if err != nil {
		return pairingChallenge{}, func() {}, func() error { return nil }, err
	}
	if !claimed {
		return pairingChallenge{}, func() {}, func() error { return nil }, errPairingClaimed
	}
	currentRaw, err := client.Get(ctx, pairingKey(code))
	if err != nil || currentRaw != raw {
		releasePairingClaim(context.WithoutCancel(ctx), client, claimKey, token)
		if err != nil {
			return pairingChallenge{}, func() {}, func() error { return nil }, err
		}
		return pairingChallenge{}, func() {}, func() error { return nil }, redis.ErrKeyNotFound
	}
	release := func() {
		releasePairingClaim(context.WithoutCancel(ctx), client, claimKey, token)
	}
	complete := func() error {
		const script = `
if redis.call("get", KEYS[2]) ~= ARGV[1] then return 0 end
redis.call("del", KEYS[1])
redis.call("del", KEYS[2])
return 1`
		deleted, err := client.Eval(ctx, script, []string{pairingKey(code), claimKey}, token).Int()
		if err != nil {
			return err
		}
		if deleted != 1 {
			return errors.New("pairing claim expired")
		}
		return nil
	}
	return challenge, release, complete, nil
}

func releasePairingClaim(ctx context.Context, client redis.Cmdable, claimKey, token string) {
	const script = `
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
end
return 0`
	_ = client.Eval(ctx, script, []string{claimKey}, token).Err()
}
