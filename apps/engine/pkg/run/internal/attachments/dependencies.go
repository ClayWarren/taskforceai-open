package attachments

import redis "github.com/TaskForceAI/infrastructure/redis/pkg"

type Dependencies struct {
	RedisClient       func() (redis.Cmdable, error)
	MarshalCollection func(any) ([]byte, error)
	MarshalInfo       func(any) ([]byte, error)
}
