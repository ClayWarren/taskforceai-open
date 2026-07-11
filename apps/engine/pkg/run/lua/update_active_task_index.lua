local key = KEYS[1]
local taskID = ARGV[1]
local active = ARGV[2] == "1"
local ttlSeconds = tonumber(ARGV[3])
local maxIDs = tonumber(ARGV[4])

if not taskID or taskID == "" then
	return 1
end
if not ttlSeconds or ttlSeconds <= 0 then
	return redis.error_reply("invalid ttl")
end
if not maxIDs or maxIDs <= 0 then
	return redis.error_reply("invalid max ids")
end

local taskIDs = {}
local rawIndex = redis.call("GET", key)
if rawIndex and rawIndex ~= "" then
	local ok, decoded = pcall(cjson.decode, rawIndex)
	if not ok or type(decoded) ~= "table" then
		return redis.error_reply("decode active task index")
	end
	taskIDs = decoded
end

local nextTaskIDs = {}
local seen = false
for i = 1, #taskIDs do
	local existingTaskID = taskIDs[i]
	local keep = true
	if existingTaskID == taskID then
		seen = true
		if not active then
			keep = false
		end
	end
	if keep then
		nextTaskIDs[#nextTaskIDs + 1] = existingTaskID
	end
end

if active and not seen then
	nextTaskIDs[#nextTaskIDs + 1] = taskID
end

while #nextTaskIDs > maxIDs do
	table.remove(nextTaskIDs, 1)
end

local encoded = "[]"
if #nextTaskIDs > 0 then
	encoded = cjson.encode(nextTaskIDs)
end
redis.call("SET", key, encoded, "EX", ttlSeconds)
return 1
