package taskcontrol

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"

	"github.com/TaskForceAI/core/pkg/orchestrator"
	taskcontract "github.com/TaskForceAI/go-engine/pkg/run/task"
	redis "github.com/TaskForceAI/infrastructure/redis/pkg"
)

const (
	taskSteeringStreamPrefix = "task:steering:"
	maxTaskSteeringBytes     = 16 * 1024
	maxTaskSteeringEntries   = 64
)

const appendTaskSteeringScript = `
local stream = KEYS[1]
local input = ARGV[1]
local maxBytes = tonumber(ARGV[2])
local maxEntries = tonumber(ARGV[3])
local ttlSeconds = tonumber(ARGV[4])
local totalBytes = 0
local entries = redis.call("XRANGE", stream, "-", "+")

for _, entry in ipairs(entries) do
  local fields = entry[2]
  for index = 1, #fields, 2 do
    if fields[index] == "input" then
      totalBytes = totalBytes + string.len(fields[index + 1])
    end
  end
end

if redis.call("EXISTS", stream) == 1 then
  redis.call("EXPIRE", stream, ttlSeconds)
end

if #entries >= maxEntries or totalBytes + string.len(input) > maxBytes then
  return 0
end

redis.call("XADD", stream, "*", "input", input)
redis.call("XTRIM", stream, "MAXLEN", maxEntries)
redis.call("EXPIRE", stream, ttlSeconds)
return 1
`

var (
	ErrTaskSteeringEmpty    = errors.New("task steering input is empty")
	ErrTaskSteeringTooLarge = errors.New("task steering input is too large")
	ErrTaskSteeringQuota    = errors.New("task steering quota exceeded")
)

func taskSteeringStream(taskID string) string {
	return taskSteeringStreamPrefix + taskID
}

func SendTaskSteeringWithClient(ctx context.Context, taskID, input string, getRedisClient func() (redis.Cmdable, error)) error {
	input = strings.TrimSpace(input)
	if input == "" {
		return ErrTaskSteeringEmpty
	}
	if len(input) > maxTaskSteeringBytes {
		return fmt.Errorf("%w: max=%d bytes", ErrTaskSteeringTooLarge, maxTaskSteeringBytes)
	}
	if getRedisClient == nil {
		getRedisClient = RedisClientGetter
	}
	client, err := getRedisClient()
	if err != nil {
		return fmt.Errorf("get steering store: %w", err)
	}
	if client == nil {
		return errors.New("steering store unavailable")
	}
	accepted, err := client.Eval(
		ctx,
		appendTaskSteeringScript,
		[]string{taskSteeringStream(taskID)},
		input,
		orchestrator.MaxPendingSteeringBytes,
		maxTaskSteeringEntries,
		strconv.FormatInt(int64(taskcontract.TTL.Seconds()), 10),
	).Int64()
	if err != nil {
		return fmt.Errorf("persist task steering: %w", err)
	}
	if accepted != 1 {
		return fmt.Errorf("%w: max=%d bytes", ErrTaskSteeringQuota, orchestrator.MaxPendingSteeringBytes)
	}
	return nil
}

var SendTaskSteering = func(ctx context.Context, taskID, input string) error {
	return SendTaskSteeringWithClient(ctx, taskID, input, RedisClientGetter)
}

func NewTaskSteeringProviderWithClient(taskID string, getRedisClient func() (redis.Cmdable, error)) orchestrator.SteeringProvider {
	if getRedisClient == nil {
		getRedisClient = RedisClientGetter
	}
	var mu sync.Mutex
	lastID := "0-0"
	return func(ctx context.Context) ([]string, error) {
		mu.Lock()
		defer mu.Unlock()
		client, err := getRedisClient()
		if err != nil || client == nil {
			return nil, err
		}
		messages, err := client.XRead(ctx, taskSteeringStream(taskID), lastID, maxTaskSteeringEntries)
		if err != nil {
			return nil, err
		}
		inputs := make([]string, 0, len(messages))
		for _, message := range messages {
			lastID = message.ID
			if input := strings.TrimSpace(fmt.Sprint(message.Values["input"])); input != "" && input != "<nil>" {
				inputs = append(inputs, input)
			}
		}
		return inputs, nil
	}
}
