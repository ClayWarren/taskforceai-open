---@diagnostic disable: undefined-global

--- Atomic task-start claim for TaskForceAI engine tasks.
if #KEYS ~= 1 or #ARGV ~= 2 then
	return { err = "invalid args" }
end

local val = redis.call("GET", KEYS[1])
if not val then
	return { err = "task not found" }
end

local ok, task = pcall(cjson.decode, val)
if not ok or type(task) ~= "table" or type(task.status) ~= "string" then
	return { err = "corrupt task data" }
end

if task.status ~= "processing" then
	return { err = "task not processing" }
end

local updated_at = tonumber(ARGV[1])
if not updated_at or math.floor(updated_at) ~= updated_at then
	return { err = "invalid updatedAt" }
end

local existing_updated_at = tonumber(task.updatedAt) or 0
if task.started == true and updated_at - existing_updated_at < 30 then
	return { err = "task already started" }
end

local ttl_seconds = tonumber(ARGV[2])
if not ttl_seconds or ttl_seconds <= 0 or math.floor(ttl_seconds) ~= ttl_seconds then
	return { err = "invalid ttl" }
end

task.started = true
task.updatedAt = updated_at

redis.call("SET", KEYS[1], cjson.encode(task), "EX", ttl_seconds)
return "OK"
