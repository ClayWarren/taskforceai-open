---@diagnostic disable: undefined-global

--- Atomic progress update for TaskForceAI engine tasks.
---@class Task
---@field status string
---@field agentStatuses table
---@field toolEvents table
---@field budgetUsage table?
---@field updatedAt number
---@field progressVersion number?

local function decode_json_arg(value, err_msg)
	local ok, decoded, decode_err = pcall(cjson.decode, value)
	if not ok then
		return nil, err_msg .. ": " .. tostring(decoded)
	end
	-- Redis Lua cjson may report decode failures as (nil, err) instead of throwing.
	if decode_err ~= nil then
		return nil, err_msg .. ": " .. tostring(decode_err)
	end
	return decoded, nil
end

local function json_kind(raw)
	if type(raw) ~= "string" then
		return nil
	end
	local first_char = string.match(raw, "^%s*(.)")
	if first_char == "[" then
		return "array"
	end
	if first_char == "{" then
		return "object"
	end
	if string.match(raw, "^%s*null%s*$") then
		return "null"
	end
	return nil
end

local function ensure_object(value, kind, err_msg)
	if type(value) ~= "table" or kind ~= "object" then
		return err_msg
	end
	return nil
end

local function ensure_array(value, kind, err_msg, item_validator)
	if type(value) ~= "table" or kind ~= "array" then
		return err_msg
	end
	local max_index = #value
	for key, item in pairs(value) do
		if type(key) ~= "number" or key < 1 or math.floor(key) ~= key or key > max_index then
			return err_msg
		end
		if item_validator then
			local item_err = item_validator(item)
			if item_err then
				return item_err
			end
		end
	end
	return nil
end

local function ensure_table_item(item, err_msg)
	if type(item) ~= "table" then
		return err_msg
	end
	return nil
end

if #KEYS ~= 1 or #ARGV ~= 6 then
	return { err = "invalid args" }
end

local val = redis.call("GET", KEYS[1])
if not val then
	return { err = "task not found" }
end

-- Safely decode current task state
local ok, task = pcall(cjson.decode, val)
if not ok or type(task) ~= "table" or type(task.status) ~= "string" then
	return { err = "corrupt task data" }
end

-- Only update if the task is still in flight
if task.status ~= "processing" then
	return { err = "task not processing" }
end

-- Update fields. We decode inputs to ensure they are stored as JSON objects, not escaped strings.
local agent_statuses_kind = json_kind(ARGV[1])
local agent_statuses, agent_statuses_err = decode_json_arg(ARGV[1], "invalid agentStatuses json")
if agent_statuses_err then
	return { err = agent_statuses_err }
end
if agent_statuses == cjson.null then
	if agent_statuses_kind ~= "null" then
		return { err = "invalid agentStatuses shape" }
	end
	-- A nil agentStatuses argument means this update only carries another
	-- progress field. Preserve existing status snapshots instead of forcing
	-- every tool update to re-marshal them.
else
	local agent_statuses_shape_err = ensure_array(
		agent_statuses,
		agent_statuses_kind,
		"invalid agentStatuses shape",
		function(item)
			return ensure_table_item(item, "invalid agentStatuses shape")
		end
	)
	if agent_statuses_shape_err then
		return { err = agent_statuses_shape_err }
	end
	task.agentStatuses = agent_statuses
end

local tool_events_kind = json_kind(ARGV[2])
local tool_events, tool_events_err = decode_json_arg(ARGV[2], "invalid toolEvents json")
if tool_events_err then
	return { err = tool_events_err }
end
if tool_events == cjson.null then
	if tool_events_kind ~= "null" then
		return { err = "invalid toolEvents shape" }
	end
	-- A nil toolEvents argument means this is a status-only pulse. Preserve
	-- existing tool usage so live progress ticks do not erase streamed calls.
else
	local tool_events_shape_err = ensure_array(tool_events, tool_events_kind, "invalid toolEvents shape", function(item)
		return ensure_table_item(item, "invalid toolEvents shape")
	end)
	if tool_events_shape_err then
		return { err = tool_events_shape_err }
	end
	task.toolEvents = tool_events
end

local budget_usage_kind = json_kind(ARGV[3])
local budget_usage, budget_usage_err = decode_json_arg(ARGV[3], "invalid budgetUsage json")
if budget_usage_err then
	return { err = budget_usage_err }
end
if budget_usage == cjson.null then
	if budget_usage_kind ~= "null" then
		return { err = "invalid budgetUsage shape" }
	end
	task.budgetUsage = nil
else
	local budget_usage_shape_err = ensure_object(budget_usage, budget_usage_kind, "invalid budgetUsage shape")
	if budget_usage_shape_err then
		return { err = budget_usage_shape_err }
	end
	task.budgetUsage = budget_usage
end

local updated_at = tonumber(ARGV[4])
if not updated_at or math.floor(updated_at) ~= updated_at then
	return { err = "invalid updatedAt" }
end

local existing_updated_at = nil
if task.updatedAt ~= nil then
	existing_updated_at = tonumber(task.updatedAt)
	if not existing_updated_at or math.floor(existing_updated_at) ~= existing_updated_at then
		return { err = "corrupt task data" }
	end
end
if existing_updated_at and updated_at < existing_updated_at then
	return { err = "stale updatedAt" }
end

local progress_version = tonumber(ARGV[6])
if not progress_version or progress_version <= 0 or math.floor(progress_version) ~= progress_version then
	return { err = "invalid progressVersion" }
end

local existing_progress_version = nil
if task.progressVersion ~= nil then
	existing_progress_version = tonumber(task.progressVersion)
	if
		not existing_progress_version
		or existing_progress_version <= 0
		or math.floor(existing_progress_version) ~= existing_progress_version
	then
		return { err = "corrupt task data" }
	end
elseif existing_updated_at then
	-- Backward compatibility for tasks created before progressVersion existed.
	existing_progress_version = math.floor(existing_updated_at * 1000000)
end
if existing_progress_version and progress_version <= existing_progress_version then
	return { err = "stale progressVersion" }
end

task.updatedAt = updated_at
-- Redis Lua cjson stores large integers with limited significant digits.
-- progressVersion is UnixMicro-scale, so readers use a decimal/big-float path
-- and tolerate the tiny rounding window as an advisory stale-update guard.
task.progressVersion = progress_version

-- Re-serialize and save while refreshing TTL to the provided duration.
local newVal = cjson.encode(task)
local ttl_seconds = tonumber(ARGV[5])
if not ttl_seconds or ttl_seconds <= 0 or math.floor(ttl_seconds) ~= ttl_seconds then
	return { err = "invalid ttl" }
end
redis.call("SET", KEYS[1], newVal, "EX", ttl_seconds)

return "OK"
