package remote

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/TaskForceAI/adapters/pkg/db"
	adapterhandler "github.com/TaskForceAI/adapters/pkg/handler"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"
	goredis "github.com/redis/go-redis/v9"
)

const (
	remoteWebSocketReadLimit = 4 << 20
	remoteWebSocketWait      = 5 * time.Second
	remoteWebSocketPongWait  = 15 * time.Second
)

var remoteWebSocketUpgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		// Remote hosts are native clients. Reject browser-originated upgrades so a
		// malicious page cannot reuse ambient credentials or probe local state.
		return strings.TrimSpace(r.Header.Get("Origin")) == ""
	},
}

type remoteWebSocketEnvelope struct {
	Type               string          `json:"type"`
	Commands           []remoteCommand `json:"commands,omitempty"`
	LastID             string          `json:"lastId,omitempty"`
	CommandID          string          `json:"commandId,omitempty"`
	ControllerDeviceID string          `json:"controllerDeviceId,omitempty"`
	Response           json.RawMessage `json:"response,omitempty"`
}

type remoteWebSocketStreamResult struct {
	messages []goredis.XMessage
	err      error
}

// WebSocketHandler serves the durable Remote host relay. Redis remains the
// source of truth, so reconnects can resume from the desktop's last command ID
// even when Vercel places the next socket on a different Function instance.
func WebSocketHandler(resolveQueries QueriesResolver, resolveRedis RedisResolver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := adapterhandler.GetAuthenticatedUser(r)
		if user == nil || user.ID <= 0 {
			adapterhandler.JSONError(w, http.StatusUnauthorized, "Unauthorized")
			return
		}
		q, err := resolveQueries(r.Context())
		if err != nil || q == nil {
			adapterhandler.JSONError(w, http.StatusServiceUnavailable, "Remote service unavailable")
			return
		}
		deviceID, err := requiredDeviceID(r.Header.Get("X-Device-Id"))
		if err != nil || deviceID != chi.URLParam(r, "targetDeviceId") {
			adapterhandler.JSONError(w, http.StatusForbidden, "Remote target mismatch")
			return
		}
		target, err := q.GetRemoteTarget(r.Context(), db.GetRemoteTargetParams{
			UserID: strconv.Itoa(user.ID), DeviceID: deviceID,
		})
		if err != nil || !target.AllowConnections {
			adapterhandler.JSONError(w, http.StatusForbidden, "Remote connections are disabled")
			return
		}
		if err := verifyDeviceCredential(
			r.Context(), q, strconv.Itoa(user.ID), deviceID,
			r.Header.Get("X-Device-Credential"),
		); err != nil {
			adapterhandler.JSONError(w, http.StatusForbidden, "Remote device credential is invalid")
			return
		}
		client, err := resolveRedis()
		if err != nil || client == nil {
			adapterhandler.JSONError(w, http.StatusServiceUnavailable, "Remote relay unavailable")
			return
		}
		lease, err := acquireRemotePollLease(r.Context(), client, strconv.Itoa(user.ID), deviceID)
		if err != nil {
			adapterhandler.JSONError(w, http.StatusConflict, "Remote relay is already connected")
			return
		}
		defer lease.release(r.Context())

		conn, err := remoteWebSocketUpgrader.Upgrade(w, r, nil)
		if err != nil {
			slog.Warn("Failed to upgrade Remote WebSocket", "deviceId", deviceID, "error", err)
			return
		}
		defer conn.Close()

		lastID := strings.TrimSpace(r.URL.Query().Get("lastId"))
		if lastID == "" {
			lastID = "0"
		}
		_ = q.TouchRemoteTarget(r.Context(), db.TouchRemoteTargetParams{
			UserID: strconv.Itoa(user.ID), DeviceID: deviceID,
		})
		if err := serveRemoteWebSocket(
			r.Context(), conn, q, client, lease, strconv.Itoa(user.ID), deviceID, lastID,
		); err != nil && !websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
			slog.Debug("Remote WebSocket disconnected", "deviceId", deviceID, "error", err)
		}
	}
}

func serveRemoteWebSocket(
	ctx context.Context,
	conn *websocket.Conn,
	q *db.Queries,
	client redis.Cmdable,
	lease *remotePollLease,
	userID string,
	deviceID string,
	lastID string,
) error {
	blockingClient, ok := client.(blockingStreamReader)
	if !ok {
		return errors.New("blocking Redis stream reads are unavailable")
	}
	conn.SetReadLimit(remoteWebSocketReadLimit)
	_ = conn.SetReadDeadline(time.Now().Add(remoteWebSocketPongWait))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(remoteWebSocketPongWait))
	})
	results := make(chan remoteWebSocketEnvelope, 32)
	readErrors := make(chan error, 1)
	go readRemoteWebSocket(conn, results, readErrors)
	streamResults := make(chan remoteWebSocketStreamResult, 1)
	readCommands := func(cursor string) {
		go func() {
			messages, err := blockingClient.XReadBlock(
				ctx, commandStream(userID, deviceID), cursor, maxCommands, remoteWebSocketWait,
			)
			streamResults <- remoteWebSocketStreamResult{messages: messages, err: err}
		}()
	}
	readCommands(lastID)
	heartbeat := time.NewTicker(remoteWebSocketWait)
	defer heartbeat.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case err := <-readErrors:
			return err
		case result := <-results:
			if err := storeWebSocketResult(ctx, client, userID, deviceID, result); err != nil {
				return err
			}
			if result.LastID != "" {
				if err := conn.WriteJSON(remoteWebSocketEnvelope{
					Type: "resultAck", CommandID: result.CommandID, LastID: result.LastID,
				}); err != nil {
					return err
				}
			}
		case stream := <-streamResults:
			if stream.err != nil && !errors.Is(stream.err, goredis.Nil) {
				return stream.err
			}
			commands, nextID := decodeRemoteCommands(
				ctx, q, userID, deviceID, stream.messages, lastID,
			)
			lastID = nextID
			if len(commands) > 0 {
				if err := conn.WriteJSON(remoteWebSocketEnvelope{
					Type: "commands", Commands: commands, LastID: lastID,
				}); err != nil {
					return err
				}
			}
			readCommands(lastID)
		case <-heartbeat.C:
			if err := lease.refresh(ctx); err != nil {
				return err
			}
			_ = q.TouchRemoteTarget(ctx, db.TouchRemoteTargetParams{
				UserID: userID, DeviceID: deviceID,
			})
			if err := conn.WriteControl(
				websocket.PingMessage, []byte("remote"), time.Now().Add(time.Second),
			); err != nil {
				return err
			}
		}
	}
}

func readRemoteWebSocket(conn *websocket.Conn, results chan<- remoteWebSocketEnvelope, readErrors chan<- error) {
	for {
		var envelope remoteWebSocketEnvelope
		if err := conn.ReadJSON(&envelope); err != nil {
			readErrors <- err
			return
		}
		if envelope.Type != "result" {
			continue
		}
		results <- envelope
	}
}

func storeWebSocketResult(
	ctx context.Context,
	client redis.Cmdable,
	userID string,
	deviceID string,
	envelope remoteWebSocketEnvelope,
) error {
	if strings.TrimSpace(envelope.CommandID) == "" ||
		strings.TrimSpace(envelope.ControllerDeviceID) == "" || len(envelope.Response) == 0 {
		return errors.New("remote WebSocket result envelope is invalid")
	}
	return storeRemoteResult(
		ctx, client, userID, deviceID, envelope.CommandID,
		envelope.ControllerDeviceID, envelope.Response,
	)
}

func decodeRemoteCommands(
	ctx context.Context,
	q *db.Queries,
	userID string,
	deviceID string,
	messages []goredis.XMessage,
	lastID string,
) ([]remoteCommand, string) {
	commands := make([]remoteCommand, 0, len(messages))
	for _, message := range messages {
		lastID = message.ID
		raw := fmt.Sprintf("%v", message.Values["command"])
		var command remoteCommand
		if json.Unmarshal([]byte(raw), &command) != nil {
			continue
		}
		active, err := q.IsActiveRemoteConnection(ctx, db.IsActiveRemoteConnectionParams{
			UserID: userID, TargetDeviceID: deviceID, ControllerDeviceID: command.ControllerDeviceID,
		})
		if err == nil && active {
			commands = append(commands, command)
		}
	}
	return commands, lastID
}

func (lease *remotePollLease) refresh(ctx context.Context) error {
	const script = `
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("pexpire", KEYS[1], ARGV[2])
end
return 0
`
	for _, key := range lease.keys {
		refreshed, err := lease.client.Eval(
			ctx, script, []string{key}, lease.token, remotePollTTL.Milliseconds(),
		).Int()
		if err != nil {
			return fmt.Errorf("refresh remote relay lease: %w", err)
		}
		if refreshed == 0 {
			return errors.New("remote relay lease expired")
		}
	}
	return nil
}
